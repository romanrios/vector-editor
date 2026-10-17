import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { SetVisibilityCommand } from '../src/commands/SetVisibilityCommand.ts';
import { SetLockedCommand } from '../src/commands/SetLockedCommand.ts';
import { MoveStepCommand } from '../src/commands/MoveStepCommand.ts';
import { setupUIBindings } from '../src/main.ts';
import { InputController } from '../src/input/InputController.ts';
import { SelectionOperations } from '../src/input/SelectionOperations.ts';
import type { Document, Layer, Group, Rectangle, Ellipse, Path, Text } from '../src/types/scene-graph.ts';

// Mock DOM Node compatible con Node test runner
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  private _innerHTML: string = '';
  public open: boolean = true;
  public clickCount: number = 0;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName;
  }

  public get innerHTML(): string {
    return this._innerHTML;
  }

  public set innerHTML(val: string) {
    this._innerHTML = val;
    if (val === '') {
      this.children = [];
    }
  }

  public get className(): string {
    return Array.from(this.classes).join(' ');
  }

  public set className(val: string) {
    this.classes.clear();
    if (val) {
      val.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }

  public get classList() {
    return {
      add: (cls: string) => this.classes.add(cls),
      remove: (cls: string) => this.classes.delete(cls),
      contains: (cls: string) => this.classes.has(cls),
      toggle: (cls: string, force?: boolean) => {
        if (force !== undefined) {
          if (force) this.classes.add(cls);
          else this.classes.delete(cls);
          return force;
        }
        if (this.classes.has(cls)) {
          this.classes.delete(cls);
          return false;
        }
        this.classes.add(cls);
        return true;
      },
    };
  }

  public getContext(id: string) {
    if (id === '2d') {
      return {
        font: '16px sans-serif',
        textAlign: 'left',
        textBaseline: 'top',
        measureText: (text: string) => ({
          width: text.length * 8,
          actualBoundingBoxAscent: 12,
          actualBoundingBoxDescent: 4,
        }),
      };
    }
    return null;
  }

  public getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    };
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public addEventListener(event: string, listener: (e: any) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  public removeEventListener(event: string, listener: (e: any) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  public click(eventInit: any = {}): void {
    this.clickCount++;
    const set = this.listeners.get('click');
    if (set) {
      const ev = {
        type: 'click',
        target: this,
        currentTarget: this,
        stopPropagation: () => {},
        preventDefault: () => {},
        ...eventInit,
      };
      for (const listener of set) {
        listener(ev);
      }
    }
  }

  public appendChild(child: MockElement): void {
    child.parentElement = this;
    this.children.push(child);
  }

  public querySelector<T = MockElement>(selector: string): T | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const findClass = (el: MockElement): MockElement | null => {
        for (const c of el.children) {
          if (c.classes.has(cls)) return c;
          const res = findClass(c);
          if (res) return res;
        }
        return null;
      };
      return findClass(this) as T | null;
    }
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      const findId = (el: MockElement): MockElement | null => {
        for (const c of el.children) {
          if (c.id === id) return c;
          const res = findId(c);
          if (res) return res;
        }
        return null;
      };
      return findId(this) as T | null;
    }
    if (selector.includes('[data-node-id="')) {
      const match = selector.match(/\[data-node-id="([^"]+)"\]/);
      if (match) {
        const targetId = match[1];
        const findDataId = (el: MockElement): MockElement | null => {
          for (const c of el.children) {
            if (c.getAttribute('data-node-id') === targetId) return c;
            const res = findDataId(c);
            if (res) return res;
          }
          return null;
        };
        return findDataId(this) as T | null;
      }
    }
    return null;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const collect = (el: MockElement) => {
        for (const c of el.children) {
          if (c.classes.has(cls)) results.push(c);
          collect(c);
        }
      };
      collect(this);
    }
    return results;
  }
}

function createSampleDocument(): Document {
  const rect: Rectangle = {
    id: 'rect-1',
    type: 'rectangle',
    name: 'Rectángulo Base',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    fill: '#38bdf8',
    stroke: '#0284c7',
    strokeWidth: 2,
    visible: true,
    locked: false,
  };

  const ellipse: Ellipse = {
    id: 'ellipse-1',
    type: 'ellipse',
    name: 'Círculo Guía',
    x: 400,
    y: 200,
    radiusX: 60,
    radiusY: 60,
    fill: '#ef4444',
    visible: true,
    locked: false,
  };

  const path: Path = {
    id: 'path-1',
    type: 'path',
    name: 'Trazo Curvo',
    x: 150,
    y: 350,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
    stroke: '#10b981',
    strokeWidth: 3,
    visible: true,
    locked: false,
  };

  const text: Text = {
    id: 'text-1',
    type: 'text',
    name: 'Título Principal',
    x: 200,
    y: 80,
    text: 'Hola Vectedit',
    fontSize: 24,
    fill: '#ffffff',
    visible: true,
    locked: false,
  };

  const group: Group = {
    id: 'group-1',
    type: 'group',
    name: 'Grupo Destacado',
    visible: true,
    locked: false,
    children: [ellipse, path],
  };

  const layer1: Layer = {
    id: 'layer-1',
    type: 'layer',
    name: 'Capa Principal',
    visible: true,
    locked: false,
    children: [rect, group, text],
  };

  return {
    id: 'doc-root',
    type: 'document',
    name: 'Documento',
    width: 800,
    height: 600,
    children: [layer1],
  };
}

describe('Panel de Capas y Árbol de Objetos (Layers Panel)', () => {
  let doc: Document;
  let commandManager: CommandManager;
  let stateManager: StateManager;

  beforeEach(() => {
    doc = createSampleDocument();
    commandManager = new CommandManager();
    stateManager = new StateManager(doc, commandManager);
  });

  describe('1. StateManager: setNodeVisibility y setNodeLocked', () => {
    it('setNodeVisibility altera la visibilidad de figuras, grupos y capas de forma inmutable', () => {
      // 1. Ocultar figura hoja
      const changedRect = stateManager.setNodeVisibility('rect-1', false);
      assert.strictEqual(changedRect, true);
      assert.strictEqual(stateManager.findNode('rect-1')?.visible, false);
      assert.strictEqual(stateManager.isEffectivelyVisible('rect-1'), false);

      // Si ya está oculto, retorna false (sin cambios)
      assert.strictEqual(stateManager.setNodeVisibility('rect-1', false), false);

      // Mostrar nuevamente
      assert.strictEqual(stateManager.setNodeVisibility('rect-1', true), true);
      assert.strictEqual(stateManager.findNode('rect-1')?.visible, true);
      assert.strictEqual(stateManager.isEffectivelyVisible('rect-1'), true);

      // 2. Ocultar Grupo afecta a sus descendientes mediante isEffectivelyVisible
      stateManager.setNodeVisibility('group-1', false);
      assert.strictEqual(stateManager.findNode('group-1')?.visible, false);
      assert.strictEqual(stateManager.isEffectivelyVisible('group-1'), false);
      assert.strictEqual(stateManager.isEffectivelyVisible('ellipse-1'), false);
      assert.strictEqual(stateManager.isEffectivelyVisible('path-1'), false);

      // 3. Ocultar Capa afecta a todo el contenido de la capa
      stateManager.setNodeVisibility('layer-1', false);
      assert.strictEqual(stateManager.isEffectivelyVisible('rect-1'), false);
      assert.strictEqual(stateManager.isEffectivelyVisible('text-1'), false);
    });

    it('setNodeLocked altera el bloqueo y deselecciona automáticamente si estaba seleccionado', () => {
      stateManager.setSelection(['rect-1']);
      assert.deepStrictEqual(stateManager.getSelection(), ['rect-1']);

      // Bloquear figura seleccionada -> se retira de la selección
      const changed = stateManager.setNodeLocked('rect-1', true);
      assert.strictEqual(changed, true);
      assert.strictEqual(stateManager.findNode('rect-1')?.locked, true);
      assert.strictEqual(stateManager.isEffectivelyLocked('rect-1'), true);
      assert.deepStrictEqual(stateManager.getSelection(), []);

      // Si ya está bloqueado, no-op
      assert.strictEqual(stateManager.setNodeLocked('rect-1', true), false);

      // Desbloquear figura
      stateManager.setNodeLocked('rect-1', false);
      assert.strictEqual(stateManager.findNode('rect-1')?.locked, false);
      assert.strictEqual(stateManager.isEffectivelyLocked('rect-1'), false);
    });

    it('bloquear un grupo deselecciona el grupo y a cualquier descendiente seleccionado', () => {
      stateManager.setSelection(['group-1']);
      assert.deepStrictEqual(stateManager.getSelection(), ['group-1']);

      stateManager.setNodeLocked('group-1', true);
      assert.strictEqual(stateManager.findNode('group-1')?.locked, true);
      assert.strictEqual(stateManager.isEffectivelyLocked('ellipse-1'), true);
      assert.deepStrictEqual(stateManager.getSelection(), []);
    });

    it('reorderNodeStep sube y baja un nodo de nivel dentro de su contenedor padre', () => {
      // layer-1 children: [rect-1 (0), group-1 (1), text-1 (2)]
      const layer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer.children[0].id, 'rect-1');
      assert.strictEqual(layer.children[1].id, 'group-1');
      assert.strictEqual(layer.children[2].id, 'text-1');

      // Subir rect-1 un paso (de 0 a 1)
      const movedUp = stateManager.reorderNodeStep('rect-1', 'up');
      assert.strictEqual(movedUp, true);
      const afterUp = (stateManager.findNode('layer-1') as Layer).children;
      assert.strictEqual(afterUp[0].id, 'group-1');
      assert.strictEqual(afterUp[1].id, 'rect-1');
      assert.strictEqual(afterUp[2].id, 'text-1');

      // Intentar subir text-1 cuando ya está en el tope -> retorna false (sin cambios)
      const noopUp = stateManager.reorderNodeStep('text-1', 'up');
      assert.strictEqual(noopUp, false);

      // Bajar rect-1 un paso (de 1 a 0)
      const movedDown = stateManager.reorderNodeStep('rect-1', 'down');
      assert.strictEqual(movedDown, true);
      const afterDown = (stateManager.findNode('layer-1') as Layer).children;
      assert.strictEqual(afterDown[0].id, 'rect-1');
      assert.strictEqual(afterDown[1].id, 'group-1');
    });
  });

  describe('2. Patrón Command: SetVisibilityCommand, SetLockedCommand, MoveStepCommand', () => {
    it('SetVisibilityCommand conmuta visibilidad y soporta Undo y Redo', () => {
      const cmd = new SetVisibilityCommand(stateManager, 'text-1', false);
      assert.strictEqual(cmd.isAlreadyAtTarget, false);

      commandManager.executeCommand(cmd);
      assert.strictEqual(stateManager.findNode('text-1')?.visible, false);

      commandManager.undo();
      assert.strictEqual(stateManager.findNode('text-1')?.visible, true);

      commandManager.redo();
      assert.strictEqual(stateManager.findNode('text-1')?.visible, false);
    });

    it('SetLockedCommand conmuta bloqueo y soporta Undo y Redo', () => {
      const cmd = new SetLockedCommand(stateManager, 'text-1', true);
      assert.strictEqual(cmd.isAlreadyAtTarget, false);

      commandManager.executeCommand(cmd);
      assert.strictEqual(stateManager.findNode('text-1')?.locked, true);

      commandManager.undo();
      assert.strictEqual(stateManager.findNode('text-1')?.locked, false);

      commandManager.redo();
      assert.strictEqual(stateManager.findNode('text-1')?.locked, true);
    });

    it('MoveStepCommand reordena el apilado y es reversible con Undo/Redo', () => {
      // Inicial: [rect-1, group-1, text-1]
      const cmd = new MoveStepCommand(stateManager, 'rect-1', 'up');
      assert.strictEqual(cmd.fromIndex, 0);
      assert.strictEqual(cmd.toIndex, 1);
      assert.strictEqual(cmd.isAlreadyAtTarget, false);

      commandManager.executeCommand(cmd);
      let layer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer.children[0].id, 'group-1');
      assert.strictEqual(layer.children[1].id, 'rect-1');

      commandManager.undo();
      layer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer.children[0].id, 'rect-1');
      assert.strictEqual(layer.children[1].id, 'group-1');

      commandManager.redo();
      layer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer.children[0].id, 'group-1');
      assert.strictEqual(layer.children[1].id, 'rect-1');
    });

    it('MoveStepCommand en el extremo detecta isAlreadyAtTarget = true', () => {
      // rect-1 está en índice 0, no puede bajar más
      const cmdDown = new MoveStepCommand(stateManager, 'rect-1', 'down');
      assert.strictEqual(cmdDown.isAlreadyAtTarget, true);

      // text-1 está en índice 2 (último), no puede subir más
      const cmdUp = new MoveStepCommand(stateManager, 'text-1', 'up');
      assert.strictEqual(cmdUp.isAlreadyAtTarget, true);
    });
  });

  describe('3. Restricciones en Canvas y Selección con nodos bloqueados', () => {
    it('SelectionOperations no permite eliminar figuras efectivamente bloqueadas', () => {
      stateManager.setNodeLocked('rect-1', true);
      // Forzar selección directa
      stateManager.setSelection(['rect-1']);

      const ops = new SelectionOperations(stateManager, commandManager);
      const deleted = ops.deleteSelected();
      assert.strictEqual(deleted, false);
      assert.notStrictEqual(stateManager.findNode('rect-1'), null);
    });

    it('SelectionOperations no permite duplicar figuras efectivamente bloqueadas', () => {
      stateManager.setNodeLocked('rect-1', true);
      stateManager.setSelection(['rect-1']);

      const ops = new SelectionOperations(stateManager, commandManager);
      const duplicated = ops.duplicate();
      assert.strictEqual(duplicated, null);
    });
  });

  describe('4. Interfaz UI: Sincronización del Árbol de Capas en el DOM', () => {
    let mockElements: Record<string, MockElement>;
    let cleanupUI: (() => void) | null = null;

    beforeEach(() => {
      mockElements = {
        '#viewport-canvas': new MockElement('viewport-canvas', 'canvas'),
        '#tool-select': new MockElement('tool-select', 'button'),
        '#tool-direct-select': new MockElement('tool-direct-select', 'button'),
        '#tool-hand': new MockElement('tool-hand', 'button'),
        '#tool-pen': new MockElement('tool-pen', 'button'),
        '#tool-rectangle': new MockElement('tool-rectangle', 'button'),
        '#tool-ellipse': new MockElement('tool-ellipse', 'button'),
        '#tool-text': new MockElement('tool-text', 'button'),
        '#btn-undo': new MockElement('btn-undo', 'button'),
        '#btn-redo': new MockElement('btn-redo', 'button'),
        '#btn-delete-selection': new MockElement('btn-delete-selection', 'button'),
        '#tab-btn-properties': new MockElement('tab-btn-properties', 'button'),
        '#tab-btn-layers': new MockElement('tab-btn-layers', 'button'),
        '#panel-tab-properties': new MockElement('panel-tab-properties', 'div'),
        '#panel-tab-layers': new MockElement('panel-tab-layers', 'div'),
        '#btn-layer-move-up': new MockElement('btn-layer-move-up', 'button'),
        '#btn-layer-move-down': new MockElement('btn-layer-move-down', 'button'),
        '#btn-layer-delete': new MockElement('btn-layer-delete', 'button'),
        '#layers-count-badge': new MockElement('layers-count-badge', 'span'),
        '#layers-tree': new MockElement('layers-tree', 'div'),
        '#layers-empty-state': new MockElement('layers-empty-state', 'div'),
        '#no-selection-state': new MockElement('no-selection-state', 'div'),
        '#selection-state': new MockElement('selection-state', 'div'),
        '#section-transform': new MockElement('section-transform', 'details'),
        '#section-appearance': new MockElement('section-appearance', 'details'),
        '#section-artboard': new MockElement('section-artboard', 'details'),
      };

      // Inyectar en globalThis.document
      (globalThis as any).document = {
        querySelector: (sel: string) => mockElements[sel] ?? null,
        querySelectorAll: (_sel: string) => [],
        createElement: (tag: string) => new MockElement('', tag),
        addEventListener: () => {},
        removeEventListener: () => {},
        activeElement: null,
      };

      const canvas = mockElements['#viewport-canvas'] as unknown as HTMLCanvasElement;
      const inputController = new InputController(canvas, stateManager, commandManager);
      const res = setupUIBindings(inputController, commandManager, stateManager);
      cleanupUI = res.cleanup;
    });

    afterEach(() => {
      cleanupUI?.();
      delete (globalThis as any).document;
    });

    it('alternar entre pestañas Propiedades y Capas cambia clases active y visibilidad', () => {
      const tabProps = mockElements['#tab-btn-properties'];
      const tabLayers = mockElements['#tab-btn-layers'];
      const panelProps = mockElements['#panel-tab-properties'];
      const panelLayers = mockElements['#panel-tab-layers'];

      // Inicialmente en propiedades
      assert.strictEqual(tabProps.classList.contains('active'), true);

      // Clic en pestaña Capas
      tabLayers.click();
      assert.strictEqual(tabLayers.classList.contains('active'), true);
      assert.strictEqual(tabProps.classList.contains('active'), false);
      assert.strictEqual(panelLayers.style.display, 'flex');
      assert.strictEqual(panelProps.style.display, 'none');

      // Clic en pestaña Propiedades
      tabProps.click();
      assert.strictEqual(tabProps.classList.contains('active'), true);
      assert.strictEqual(tabLayers.classList.contains('active'), false);
      assert.strictEqual(panelProps.style.display, 'flex');
      assert.strictEqual(panelLayers.style.display, 'none');
    });

    it('renderLayersTree genera filas para Capas, Grupos y Figuras hoja con sangría', () => {
      const tree = mockElements['#layers-tree'];
      assert.ok(tree.children.length > 0);

      // Debe haber filas para layer-1, group-1, rect-1, ellipse-1, path-1, text-1
      const layerRow = tree.querySelector('[data-node-id="layer-1"]');
      const groupRow = tree.querySelector('[data-node-id="group-1"]');
      const rectRow = tree.querySelector('[data-node-id="rect-1"]');
      const textRow = tree.querySelector('[data-node-id="text-1"]');

      assert.ok(layerRow, 'Fila de capa debe existir');
      assert.ok(groupRow, 'Fila de grupo debe existir');
      assert.ok(rectRow, 'Fila de rect-1 debe existir');
      assert.ok(textRow, 'Fila de text-1 debe existir');
    });

    it('selección sincronizada: seleccionar en el canvas actualiza la clase is-selected en el árbol', () => {
      const tree = mockElements['#layers-tree'];

      stateManager.setSelection(['rect-1']);

      const rectRow = tree.querySelector('[data-node-id="rect-1"]');
      const textRow = tree.querySelector('[data-node-id="text-1"]');

      assert.ok(rectRow);
      assert.ok(textRow);
      assert.strictEqual(rectRow.classList.contains('is-selected'), true);
      assert.strictEqual(textRow.classList.contains('is-selected'), false);

      stateManager.setSelection(['text-1']);
      const updatedRectRow = tree.querySelector('[data-node-id="rect-1"]');
      const updatedTextRow = tree.querySelector('[data-node-id="text-1"]');
      assert.ok(updatedRectRow);
      assert.ok(updatedTextRow);
      assert.strictEqual(updatedRectRow.classList.contains('is-selected'), false);
      assert.strictEqual(updatedTextRow.classList.contains('is-selected'), true);
    });

    it('selección sincronizada: hacer clic en una fila del árbol selecciona el elemento', () => {
      const tree = mockElements['#layers-tree'];
      const rectRow = tree.querySelector('[data-node-id="rect-1"]');
      assert.ok(rectRow);

      rectRow.click();
      assert.deepStrictEqual(stateManager.getSelection(), ['rect-1']);

      // Shift+clic añade a la selección
      const textRow = tree.querySelector('[data-node-id="text-1"]');
      assert.ok(textRow);
      textRow.click({ shiftKey: true });
      assert.strictEqual(stateManager.isSelected('rect-1'), true);
      assert.strictEqual(stateManager.isSelected('text-1'), true);
    });

    it('botón de ojo (visibilidad) en la fila ejecuta SetVisibilityCommand y soporta Undo/Redo', () => {
      const tree = mockElements['#layers-tree'];
      const rectRow = tree.querySelector('[data-node-id="rect-1"]');
      assert.ok(rectRow);

      const eyeBtn = rectRow.querySelector('.tree-btn-visibility');
      assert.ok(eyeBtn);

      // Clic en ojo para ocultar
      eyeBtn.click();
      assert.strictEqual(stateManager.findNode('rect-1')?.visible, false);

      // Undo restaura visibilidad
      commandManager.undo();
      assert.strictEqual(stateManager.findNode('rect-1')?.visible, true);

      // Redo vuelve a ocultar
      commandManager.redo();
      assert.strictEqual(stateManager.findNode('rect-1')?.visible, false);
    });

    it('botón de candado (bloqueo) en la fila ejecuta SetLockedCommand y soporta Undo/Redo', () => {
      const tree = mockElements['#layers-tree'];
      const textRow = tree.querySelector('[data-node-id="text-1"]');
      assert.ok(textRow);

      const lockBtn = textRow.querySelector('.tree-btn-lock');
      assert.ok(lockBtn);

      // Clic en candado para bloquear
      lockBtn.click();
      assert.strictEqual(stateManager.findNode('text-1')?.locked, true);

      // Undo restaura desbloqueado
      commandManager.undo();
      assert.strictEqual(stateManager.findNode('text-1')?.locked, false);

      // Redo vuelve a bloquear
      commandManager.redo();
      assert.strictEqual(stateManager.findNode('text-1')?.locked, true);
    });

    it('botones de subir y bajar en la barra de herramientas del panel de capas reordenan el apilado', () => {
      const btnMoveUp = mockElements['#btn-layer-move-up'];
      const btnMoveDown = mockElements['#btn-layer-move-down'];

      // Inicialmente en layer-1: [rect-1 (0), group-1 (1), text-1 (2)]
      stateManager.setSelection(['rect-1']);

      // rect-1 puede subir pero no bajar
      assert.strictEqual(btnMoveUp.disabled, false);
      assert.strictEqual(btnMoveDown.disabled, true);

      btnMoveUp.click();
      let layer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer.children[0].id, 'group-1');
      assert.strictEqual(layer.children[1].id, 'rect-1');

      // Ahora en posición 1 puede subir o bajar
      assert.strictEqual(btnMoveDown.disabled, false);
      btnMoveDown.click();
      layer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer.children[0].id, 'rect-1');
      assert.strictEqual(layer.children[1].id, 'group-1');
    });
  });
});
