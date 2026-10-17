import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { AddLayerCommand } from '../src/commands/AddLayerCommand.ts';
import { DeleteLayerCommand } from '../src/commands/DeleteLayerCommand.ts';
import { RenameNodeCommand } from '../src/commands/RenameNodeCommand.ts';
import { setupUIBindings } from '../src/main.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Document, Layer, Rectangle } from '../src/types/scene-graph.ts';

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

  public focus(): void {}
  public select(): void {}
}

function createSampleDocumentWithLayers(): Document {
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

  const layer1: Layer = {
    id: 'layer-1',
    type: 'layer',
    name: 'Capa 1',
    visible: true,
    locked: false,
    children: [rect1],
  };

  return {
    id: 'doc-root',
    type: 'document',
    name: 'Documento Test',
    width: 800,
    height: 600,
    children: [layer1],
  };
}

describe('Gestión de Múltiples Capas (Multi-Layer Management)', () => {
  let stateManager: StateManager;
  let commandManager: CommandManager;

  beforeEach(() => {
    commandManager = new CommandManager();
    stateManager = new StateManager(createSampleDocumentWithLayers(), commandManager);
  });

  describe('1. Capa activa y StateManager', () => {
    it('inicializa activeLayerId con la primera capa del documento', () => {
      assert.strictEqual(stateManager.getActiveLayerId(), 'layer-1');
      assert.strictEqual(stateManager.getActiveLayer()?.id, 'layer-1');
    });

    it('setActiveLayerId cambia la capa activa y notifica a los suscriptores', () => {
      const layer2: Layer = {
        id: 'layer-2',
        type: 'layer',
        name: 'Capa 2',
        visible: true,
        locked: false,
        children: [],
      };
      stateManager.addLayer(layer2);

      let notified = false;
      stateManager.subscribe(() => {
        notified = true;
      });

      const success = stateManager.setActiveLayerId('layer-2');
      assert.strictEqual(success, true);
      assert.strictEqual(stateManager.getActiveLayerId(), 'layer-2');
      assert.strictEqual(notified, true);
    });

    it('setActiveLayerId rechaza IDs que no corresponden a capas', () => {
      const success = stateManager.setActiveLayerId('rect-1');
      assert.strictEqual(success, false);
      assert.strictEqual(stateManager.getActiveLayerId(), 'layer-1');
    });

    it('findLayerOfNode encuentra la capa correspondiente a una figura hoja', () => {
      const layer = stateManager.findLayerOfNode('rect-1');
      assert.ok(layer);
      assert.strictEqual(layer.id, 'layer-1');
    });

    it('seleccionar una figura actualiza automáticamente la capa activa a la capa que la contiene', () => {
      const layer2: Layer = {
        id: 'layer-2',
        type: 'layer',
        name: 'Capa 2',
        visible: true,
        locked: false,
        children: [
          {
            id: 'rect-2',
            type: 'rectangle',
            name: 'Rect 2',
            x: 50,
            y: 50,
            width: 80,
            height: 80,
            fill: '#00ff00',
            stroke: 'none',
            strokeWidth: 0,
            visible: true,
            locked: false,
          },
        ],
      };
      stateManager.addLayer(layer2);
      assert.strictEqual(stateManager.getActiveLayerId(), 'layer-1');

      // Seleccionar rect-2 en layer-2
      stateManager.setSelection(['rect-2']);
      assert.strictEqual(stateManager.getActiveLayerId(), 'layer-2');
    });
  });

  describe('2. AddLayerCommand (Crear Capa)', () => {
    it('crea una nueva capa con nombre incremental, la añade al documento y la establece como activa', () => {
      const cmd = new AddLayerCommand(stateManager);
      assert.strictEqual(cmd.name, 'AddLayerCommand');
      assert.ok(cmd.layer.id.startsWith('layer-'));
      assert.strictEqual(cmd.layer.name, 'Capa 2');

      commandManager.executeCommand(cmd);

      const doc = stateManager.getState();
      assert.strictEqual(doc.children.length, 2);
      assert.strictEqual(doc.children[1].id, cmd.layer.id);
      assert.strictEqual(stateManager.getActiveLayerId(), cmd.layer.id);
    });

    it('es completamente reversible con Undo y Redo', () => {
      const cmd = new AddLayerCommand(stateManager, 'Mi Capa Personalizada');
      commandManager.executeCommand(cmd);

      assert.strictEqual(stateManager.getState().children.length, 2);
      assert.strictEqual(stateManager.getActiveLayerId(), cmd.layer.id);

      // Undo restaura capa activa previa y elimina la capa
      commandManager.undo();
      assert.strictEqual(stateManager.getState().children.length, 1);
      assert.strictEqual(stateManager.getActiveLayerId(), 'layer-1');
      assert.strictEqual(stateManager.findNode(cmd.layer.id), null);

      // Redo vuelve a agregar la capa y la hace activa
      commandManager.redo();
      assert.strictEqual(stateManager.getState().children.length, 2);
      assert.strictEqual(stateManager.getActiveLayerId(), cmd.layer.id);
      assert.notStrictEqual(stateManager.findNode(cmd.layer.id), null);
    });
  });

  describe('3. DeleteLayerCommand (Eliminar Capa)', () => {
    it('impide eliminar la única capa existente en el documento', () => {
      assert.strictEqual(stateManager.getState().children.length, 1);

      const cmd = new DeleteLayerCommand(stateManager, 'layer-1');
      assert.strictEqual(cmd.isAllowed, false);

      commandManager.executeCommand(cmd);
      assert.strictEqual(stateManager.getState().children.length, 1);
      assert.notStrictEqual(stateManager.findNode('layer-1'), null);
    });

    it('permite eliminar una capa cuando hay más de una, eliminando sus figuras hijas de forma reversible', () => {
      const addCmd = new AddLayerCommand(stateManager, 'Capa 2');
      commandManager.executeCommand(addCmd);
      assert.strictEqual(stateManager.getState().children.length, 2);

      // Eliminar layer-1 que contiene rect-1
      const delCmd = new DeleteLayerCommand(stateManager, 'layer-1');
      assert.strictEqual(delCmd.isAllowed, true);

      commandManager.executeCommand(delCmd);
      assert.strictEqual(stateManager.getState().children.length, 1);
      assert.strictEqual(stateManager.findNode('layer-1'), null);
      assert.strictEqual(stateManager.findNode('rect-1'), null);
      assert.strictEqual(stateManager.getActiveLayerId(), addCmd.layer.id);

      // Undo restaura layer-1 con su figura rect-1 y su posición
      commandManager.undo();
      assert.strictEqual(stateManager.getState().children.length, 2);
      assert.notStrictEqual(stateManager.findNode('layer-1'), null);
      assert.notStrictEqual(stateManager.findNode('rect-1'), null);

      // Redo vuelve a eliminar
      commandManager.redo();
      assert.strictEqual(stateManager.getState().children.length, 1);
      assert.strictEqual(stateManager.findNode('layer-1'), null);
    });
  });

  describe('4. RenameNodeCommand (Renombrar Capa o Nodo)', () => {
    it('renombra un nodo de forma inmutable y soporta Undo/Redo', () => {
      const cmd = new RenameNodeCommand(stateManager, 'layer-1', 'Capa de Ilustración');
      assert.strictEqual(cmd.oldName, 'Capa 1');
      assert.strictEqual(cmd.newName, 'Capa de Ilustración');
      assert.strictEqual(cmd.isAlreadyAtTarget, false);

      commandManager.executeCommand(cmd);
      assert.strictEqual(stateManager.findNode('layer-1')?.name, 'Capa de Ilustración');

      commandManager.undo();
      assert.strictEqual(stateManager.findNode('layer-1')?.name, 'Capa 1');

      commandManager.redo();
      assert.strictEqual(stateManager.findNode('layer-1')?.name, 'Capa de Ilustración');
    });

    it('detecta isAlreadyAtTarget = true si el nombre no cambia o está vacío', () => {
      const cmdSame = new RenameNodeCommand(stateManager, 'layer-1', 'Capa 1');
      assert.strictEqual(cmdSame.isAlreadyAtTarget, true);

      const cmdEmpty = new RenameNodeCommand(stateManager, 'layer-1', '   ');
      assert.strictEqual(cmdEmpty.isAlreadyAtTarget, true);
    });
  });

  describe('5. Interfaz UI: Barra de herramientas y árbol con múltiples capas', () => {
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

    it('botón #btn-add-layer crea una nueva capa ejecutable con Undo/Redo', () => {
      const btnAdd = mockElements['#btn-add-layer'];
      assert.ok(btnAdd);

      btnAdd.click();
      assert.strictEqual(stateManager.getState().children.length, 2);

      const tree = mockElements['#layers-tree'];
      assert.ok(tree.children.length >= 2);

      commandManager.undo();
      assert.strictEqual(stateManager.getState().children.length, 1);
    });

    it('la capa activa tiene la clase is-active-layer y el badge Activa', () => {
      const tree = mockElements['#layers-tree'];
      const layerRow = tree.querySelector('[data-node-id="layer-1"]');
      assert.ok(layerRow);
      assert.strictEqual(layerRow.classList.contains('is-active-layer'), true);

      const badge = layerRow.querySelector('.tree-layer-badge');
      assert.ok(badge);
      assert.strictEqual(badge.textContent, 'Activa');
    });

    it('con múltiples capas, aparece el botón para eliminar capa y se puede eliminar', () => {
      // Añadir capa 2
      mockElements['#btn-add-layer'].click();
      assert.strictEqual(stateManager.getState().children.length, 2);

      const tree = mockElements['#layers-tree'];
      const layerRow = tree.querySelector('[data-node-id="layer-1"]');
      assert.ok(layerRow);

      const delBtn = layerRow.querySelector('.tree-btn-delete-layer');
      assert.ok(delBtn);

      delBtn.click();
      assert.strictEqual(stateManager.getState().children.length, 1);
      assert.strictEqual(stateManager.findNode('layer-1'), null);

      // Undo restaura la capa eliminada
      commandManager.undo();
      assert.strictEqual(stateManager.getState().children.length, 2);
      assert.notStrictEqual(stateManager.findNode('layer-1'), null);
    });
  });
});
