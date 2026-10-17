import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { MoveNodeCommand } from '../src/commands/MoveNodeCommand.ts';
import { setupUIBindings } from '../src/main.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Document, Layer, Rectangle, Ellipse } from '../src/types/scene-graph.ts';

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
      width: 240,
      height: 28,
      right: 240,
      bottom: 28,
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

  public dispatchEvent(e: any): boolean {
    const set = this.listeners.get(e.type);
    if (set) {
      const dataStore = new Map<string, string>();
      const ev = {
        type: e.type,
        target: this,
        currentTarget: this,
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: {
          setData: (k: string, v: string) => dataStore.set(k, v),
          getData: (k: string) => dataStore.get(k) ?? '',
          effectAllowed: 'all',
          dropEffect: 'none',
        },
        ...e,
      };
      for (const listener of set) {
        listener(ev);
      }
    }
    return true;
  }

  public click(eventInit: any = {}): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', ...eventInit });
  }

  public contains(other: MockElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    let curr = other.parentElement;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
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

  public focus(): void {}
  public select(): void {}
}

function createSampleDocument(): Document {
  const rect1: Rectangle = {
    id: 'rect-1',
    type: 'rectangle',
    name: 'Rectángulo 1',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    fill: '#ff0000',
    stroke: 'none',
    strokeWidth: 0,
    visible: true,
    locked: false,
  };

  const rect2: Rectangle = {
    id: 'rect-2',
    type: 'rectangle',
    name: 'Rectángulo 2',
    x: 120,
    y: 10,
    width: 100,
    height: 100,
    fill: '#00ff00',
    stroke: 'none',
    strokeWidth: 0,
    visible: true,
    locked: false,
  };

  const ellipse1: Ellipse = {
    id: 'ellipse-1',
    type: 'ellipse',
    name: 'Elipse 1',
    x: 50,
    y: 50,
    radiusX: 40,
    radiusY: 40,
    fill: '#0000ff',
    stroke: 'none',
    strokeWidth: 0,
    visible: true,
    locked: false,
  };

  const layer1: Layer = {
    id: 'layer-1',
    type: 'layer',
    name: 'Capa 1',
    visible: true,
    locked: false,
    children: [rect1, rect2],
  };

  const layer2: Layer = {
    id: 'layer-2',
    type: 'layer',
    name: 'Capa 2',
    visible: true,
    locked: false,
    children: [ellipse1],
  };

  return {
    id: 'doc-root',
    type: 'document',
    name: 'Documento Test DragDrop',
    width: 800,
    height: 600,
    children: [layer1, layer2],
  };
}

describe('Arrastrar y Soltar (Drag and Drop) Elementos y Capas', () => {
  let stateManager: StateManager;
  let commandManager: CommandManager;

  beforeEach(() => {
    commandManager = new CommandManager();
    stateManager = new StateManager(createSampleDocument(), commandManager);
  });

  describe('1. MoveNodeCommand (Comando Reversible)', () => {
    it('reordena capas dentro del documento (subir y bajar)', () => {
      // Inicialmente: children = [layer-1, layer-2]
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-1');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-2');

      // Mover layer-1 a la posición 1 (hacia arriba)
      const cmd = new MoveNodeCommand(stateManager, 'layer-1', 'doc-root', 1);
      assert.strictEqual(cmd.isAlreadyAtTarget, false);
      assert.strictEqual(cmd.sourceIndex, 0);
      assert.strictEqual(cmd.targetIndex, 1);

      commandManager.executeCommand(cmd);
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-2');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-1');

      // Undo restaura el orden original
      commandManager.undo();
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-1');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-2');

      // Redo vuelve a aplicar el reordenamiento
      commandManager.redo();
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-2');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-1');
    });

    it('reordena figuras dentro de la misma capa (subir y bajar)', () => {
      const layer1 = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer1.children[0].id, 'rect-1');
      assert.strictEqual(layer1.children[1].id, 'rect-2');

      // Mover rect-1 a la posición 1
      const cmd = new MoveNodeCommand(stateManager, 'rect-1', 'layer-1', 1);
      assert.strictEqual(cmd.isAlreadyAtTarget, false);

      commandManager.executeCommand(cmd);
      const updatedLayer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(updatedLayer.children[0].id, 'rect-2');
      assert.strictEqual(updatedLayer.children[1].id, 'rect-1');

      // Undo
      commandManager.undo();
      const revertedLayer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(revertedLayer.children[0].id, 'rect-1');
      assert.strictEqual(revertedLayer.children[1].id, 'rect-2');
    });

    it('mueve una figura de una capa a otra capa preservando Undo/Redo', () => {
      // Mover rect-1 de layer-1 a layer-2
      const cmd = new MoveNodeCommand(stateManager, 'rect-1', 'layer-2', 0);
      assert.strictEqual(cmd.sourceParentId, 'layer-1');
      assert.strictEqual(cmd.targetParentId, 'layer-2');

      commandManager.executeCommand(cmd);

      const layer1 = stateManager.findNode('layer-1') as Layer;
      const layer2 = stateManager.findNode('layer-2') as Layer;
      assert.strictEqual(layer1.children.length, 1);
      assert.strictEqual(layer1.children[0].id, 'rect-2');
      assert.strictEqual(layer2.children.length, 2);
      assert.strictEqual(layer2.children[0].id, 'rect-1');
      assert.strictEqual(layer2.children[1].id, 'ellipse-1');

      // Undo restaura rect-1 en layer-1
      commandManager.undo();
      const undoneLayer1 = stateManager.findNode('layer-1') as Layer;
      const undoneLayer2 = stateManager.findNode('layer-2') as Layer;
      assert.strictEqual(undoneLayer1.children.length, 2);
      assert.strictEqual(undoneLayer1.children[0].id, 'rect-1');
      assert.strictEqual(undoneLayer2.children.length, 1);
      assert.strictEqual(undoneLayer2.children[0].id, 'ellipse-1');
    });

    it('detecta isAlreadyAtTarget cuando el nodo ya está en la posición solicitada', () => {
      const cmdSame = new MoveNodeCommand(stateManager, 'rect-1', 'layer-1', 0);
      assert.strictEqual(cmdSame.isAlreadyAtTarget, true);
    });

    it('rechaza mover una capa dentro de otra capa o dentro de una figura', () => {
      const cmd = new MoveNodeCommand(stateManager, 'layer-1', 'layer-2', 0);
      assert.strictEqual(cmd.isAlreadyAtTarget, true);
    });

    it('rechaza mover una figura directamente bajo el Document', () => {
      const cmd = new MoveNodeCommand(stateManager, 'rect-1', 'doc-root', 0);
      assert.strictEqual(cmd.isAlreadyAtTarget, true);
    });
  });

  describe('2. Interfaz UI: Arrastrar y soltar en el árbol de capas (#layers-tree)', () => {
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
        '#btn-add-layer': new MockElement('btn-add-layer', 'button'),
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

    it('cada fila del árbol tiene atributo draggable="true" y el tirador .tree-drag-handle', () => {
      const tree = mockElements['#layers-tree'];
      const layerRow = tree.querySelector('[data-node-id="layer-1"]');
      const rectRow = tree.querySelector('[data-node-id="rect-1"]');

      assert.ok(layerRow);
      assert.ok(rectRow);
      assert.strictEqual(layerRow.getAttribute('draggable'), 'true');
      assert.strictEqual(rectRow.getAttribute('draggable'), 'true');

      const layerHandle = layerRow.querySelector('.tree-drag-handle');
      const rectHandle = rectRow.querySelector('.tree-drag-handle');
      assert.ok(layerHandle);
      assert.ok(rectHandle);
    });

    it('dragstart añade la clase is-dragging a la fila arrastrada', () => {
      const tree = mockElements['#layers-tree'];
      const layer1Row = tree.querySelector('[data-node-id="layer-1"]');
      assert.ok(layer1Row);

      layer1Row.dispatchEvent({ type: 'dragstart' });
      assert.strictEqual(layer1Row.classList.contains('is-dragging'), true);
    });

    it('dragover añade indicadores visuales drop-indicator-top y drop-indicator-bottom', () => {
      const tree = mockElements['#layers-tree'];
      const layer1Row = tree.querySelector('[data-node-id="layer-1"]');
      const layer2Row = tree.querySelector('[data-node-id="layer-2"]');
      assert.ok(layer1Row);
      assert.ok(layer2Row);

      // Iniciar arrastre de layer-1
      layer1Row.dispatchEvent({ type: 'dragstart' });

      // Pasar sobre layer-2 en la mitad superior (top)
      layer2Row.dispatchEvent({ type: 'dragover', clientY: 5 });
      assert.strictEqual(layer2Row.classList.contains('drop-indicator-top'), true);
      assert.strictEqual(layer2Row.classList.contains('drop-indicator-bottom'), false);

      // Pasar sobre layer-2 en la mitad inferior (bottom)
      layer2Row.dispatchEvent({ type: 'dragover', clientY: 25 });
      assert.strictEqual(layer2Row.classList.contains('drop-indicator-top'), false);
      assert.strictEqual(layer2Row.classList.contains('drop-indicator-bottom'), true);

      // dragleave limpia los indicadores
      layer2Row.dispatchEvent({ type: 'dragleave' });
      assert.strictEqual(layer2Row.classList.contains('drop-indicator-top'), false);
      assert.strictEqual(layer2Row.classList.contains('drop-indicator-bottom'), false);
    });

    it('arrastrar y soltar una capa sobre otra capa reordena las capas con Undo/Redo', () => {
      const tree = mockElements['#layers-tree'];
      // En el árbol: layer-2 está arriba (índice 1 en doc), layer-1 está abajo (índice 0 en doc)
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-1');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-2');

      const layer1Row = tree.querySelector('[data-node-id="layer-1"]');
      const layer2Row = tree.querySelector('[data-node-id="layer-2"]');
      assert.ok(layer1Row);
      assert.ok(layer2Row);

      // Arrastrar layer-1 hacia arriba y soltar sobre la parte superior de layer-2
      layer1Row.dispatchEvent({ type: 'dragstart' });
      layer2Row.dispatchEvent({ type: 'dragover', clientY: 5 }); // mitad superior
      layer2Row.dispatchEvent({ type: 'drop', clientY: 5 });
      layer1Row.dispatchEvent({ type: 'dragend' });

      // Ahora layer-1 debe estar en el índice 1 (arriba) y layer-2 en el índice 0 (abajo)
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-2');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-1');

      // Undo restaura el orden original
      commandManager.undo();
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-1');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-2');
    });

    it('arrastrar y soltar una figura dentro de la misma capa reordena el apilado', () => {
      const tree = mockElements['#layers-tree'];
      // En layer-1: [rect-1 (0), rect-2 (1)]
      // Visualmente: rect-2 arriba, rect-1 abajo
      const rect1Row = tree.querySelector('[data-node-id="rect-1"]');
      const rect2Row = tree.querySelector('[data-node-id="rect-2"]');
      assert.ok(rect1Row);
      assert.ok(rect2Row);

      // Arrastrar rect-1 hacia arriba y soltar en la parte superior de rect-2
      rect1Row.dispatchEvent({ type: 'dragstart' });
      rect2Row.dispatchEvent({ type: 'dragover', clientY: 5 });
      rect2Row.dispatchEvent({ type: 'drop', clientY: 5 });
      rect1Row.dispatchEvent({ type: 'dragend' });

      const layer1 = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(layer1.children[0].id, 'rect-2');
      assert.strictEqual(layer1.children[1].id, 'rect-1');

      // Undo restaura el orden
      commandManager.undo();
      const revertedLayer = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(revertedLayer.children[0].id, 'rect-1');
      assert.strictEqual(revertedLayer.children[1].id, 'rect-2');
    });

    it('arrastrar y soltar una figura sobre otra capa la traslada a esa capa', () => {
      const tree = mockElements['#layers-tree'];
      const rect1Row = tree.querySelector('[data-node-id="rect-1"]');
      const layer2Row = tree.querySelector('[data-node-id="layer-2"]');
      assert.ok(rect1Row);
      assert.ok(layer2Row);

      // Arrastrar rect-1 sobre layer-2
      rect1Row.dispatchEvent({ type: 'dragstart' });
      layer2Row.dispatchEvent({ type: 'dragover', clientY: 14 }); // en el centro = inside
      layer2Row.dispatchEvent({ type: 'drop', clientY: 14 });
      rect1Row.dispatchEvent({ type: 'dragend' });

      const layer1 = stateManager.findNode('layer-1') as Layer;
      const layer2 = stateManager.findNode('layer-2') as Layer;
      assert.strictEqual(layer1.children.length, 1);
      assert.strictEqual(layer1.children[0].id, 'rect-2');
      assert.strictEqual(layer2.children.length, 2);
      assert.strictEqual(layer2.children[1].id, 'rect-1');

      // Undo restaura la figura a su capa original
      commandManager.undo();
      const undoneLayer1 = stateManager.findNode('layer-1') as Layer;
      assert.strictEqual(undoneLayer1.children.length, 2);
      assert.strictEqual(undoneLayer1.children[0].id, 'rect-1');
    });

    it('soltar en el área vacía del contenedor #layers-tree coloca el elemento al fondo', () => {
      const tree = mockElements['#layers-tree'];
      const layer2Row = tree.querySelector('[data-node-id="layer-2"]');
      assert.ok(layer2Row);

      // layer-2 está originalmente en índice 1
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-2');

      // Arrastrar layer-2 y soltar en el árbol general (área vacía)
      layer2Row.dispatchEvent({ type: 'dragstart' });
      tree.dispatchEvent({ type: 'dragover' });
      tree.dispatchEvent({ type: 'drop' });
      layer2Row.dispatchEvent({ type: 'dragend' });

      // Ahora layer-2 está al fondo (índice 0)
      assert.strictEqual(stateManager.getState().children[0].id, 'layer-2');
      assert.strictEqual(stateManager.getState().children[1].id, 'layer-1');
    });
  });
});
