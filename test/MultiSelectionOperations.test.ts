import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle, Ellipse, Document } from '../src/types/scene-graph.ts';

// Mock DOM para pruebas unitarias sin jsdom
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public innerHTML: string = '';
  public open: boolean = true;
  public clickCount: number = 0;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName;
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

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.target) e.target = this;
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }

  public click(): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this });
  }

  public appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  public contains(target: any): boolean {
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }

  public focus(): void {
    if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
  }

  public showModal(): void {
    this.setAttribute('open', '');
    this.style.display = 'block';
  }

  public close(): void {
    this.removeAttribute('open');
    this.style.display = 'none';
  }
}

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    focus: () => {},
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  } as unknown as HTMLCanvasElement;
}

function createRect(id: string, name: string, x: number, y: number, fill = '#ff0000', stroke = '#000000', strokeWidth = 2): Rectangle {
  return {
    id,
    type: 'rectangle',
    name,
    x,
    y,
    width: 50,
    height: 50,
    fill,
    stroke,
    strokeWidth,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

function createEllipse(id: string, name: string, x: number, y: number, fill = '#00ff00', stroke = '#000000', strokeWidth = 3): Ellipse {
  return {
    id,
    type: 'ellipse',
    name,
    x,
    y,
    radiusX: 30,
    radiusY: 30,
    fill,
    stroke,
    strokeWidth,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

describe('Operaciones sobre Múltiples Figuras y BatchCommand', () => {
  let stateManager: StateManager;
  let commandManager: CommandManager;
  let canvas: HTMLCanvasElement;
  let controller: InputController;

  beforeEach(() => {
    stateManager = new StateManager();
    commandManager = new CommandManager();
    stateManager.setCommandManager(commandManager);
    canvas = createMockCanvas();
    controller = new InputController(canvas, stateManager, commandManager);
  });

  describe('1. Eliminar (deleteSelected)', () => {
    it('elimina 1 figura y un único Ctrl+Z la restaura en su posición e índice original', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);

      stateManager.setSelection(['r1']);
      assert.equal(controller.deleteSelected(), true);

      // r1 eliminada, r2 permanece
      assert.equal(stateManager.findNode('r1'), null);
      assert.notEqual(stateManager.findNode('r2'), null);
      assert.deepEqual(stateManager.getSelection(), []);

      // Un único Ctrl+Z restaura r1 en el índice 0
      commandManager.undo();
      const layer = stateManager.findNode('layer-default') as any;
      assert.equal(layer.children.length, 2);
      assert.equal(layer.children[0].id, 'r1');
      assert.equal(layer.children[1].id, 'r2');
    });

    it('elimina 2 figuras en una sola entrada (BatchCommand) y un único Ctrl+Z las restaura', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      const r3 = createRect('r3', 'R3', 30, 30);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);

      // Seleccionar r1 y r3 (índices 0 y 2)
      stateManager.setSelection(['r1', 'r3']);
      assert.equal(controller.deleteSelected(), true);

      assert.equal(stateManager.findNode('r1'), null);
      assert.equal(stateManager.findNode('r3'), null);
      assert.notEqual(stateManager.findNode('r2'), null);
      assert.deepEqual(stateManager.getSelection(), []);

      // Un único Ctrl+Z restaura r1 en 0 y r3 en 2
      commandManager.undo();
      const layer = stateManager.findNode('layer-default') as any;
      assert.equal(layer.children.length, 3);
      assert.equal(layer.children[0].id, 'r1');
      assert.equal(layer.children[1].id, 'r2');
      assert.equal(layer.children[2].id, 'r3');
    });

    it('elimina 3 figuras en una sola entrada (BatchCommand) y un único Ctrl+Z las restaura en sus posiciones originales', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      const r3 = createRect('r3', 'R3', 30, 30);
      const r4 = createRect('r4', 'R4', 40, 40);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);
      stateManager.addShape('layer-default', r4);

      // Seleccionar r1, r2, r4
      stateManager.setSelection(['r1', 'r2', 'r4']);
      assert.equal(controller.deleteSelected(), true);

      assert.equal(stateManager.findNode('r1'), null);
      assert.equal(stateManager.findNode('r2'), null);
      assert.equal(stateManager.findNode('r4'), null);
      assert.notEqual(stateManager.findNode('r3'), null);

      // Deshacer con un solo Ctrl+Z restaura el orden exacto [r1, r2, r3, r4]
      commandManager.undo();
      const layer = stateManager.findNode('layer-default') as any;
      assert.equal(layer.children.length, 4);
      assert.equal(layer.children[0].id, 'r1');
      assert.equal(layer.children[1].id, 'r2');
      assert.equal(layer.children[2].id, 'r3');
      assert.equal(layer.children[3].id, 'r4');
    });
  });

  describe('2. Copiar y Pegar (copy & paste)', () => {
    it('copia y pega 1 figura desplazada 10 px, y un segundo pegado a 20 px con un único Ctrl+Z por pegado', () => {
      const r1 = createRect('r1', 'R1', 100, 150);
      stateManager.addShape('layer-default', r1);
      stateManager.setSelection(['r1']);

      assert.equal(controller.copy(), true);
      const pasted1 = controller.paste();
      assert.notEqual(pasted1, null);
      assert.equal(pasted1!.length, 1);
      assert.equal(pasted1![0].x, 110);
      assert.equal(pasted1![0].y, 160);
      assert.deepEqual(stateManager.getSelection(), [pasted1![0].id]);

      // Segundo pegado: offset acumulado a 20 px
      const pasted2 = controller.paste();
      assert.notEqual(pasted2, null);
      assert.equal(pasted2![0].x, 120);
      assert.equal(pasted2![0].y, 170);

      // Un único Ctrl+Z revierte el segundo pegado
      commandManager.undo();
      assert.equal(stateManager.findNode(pasted2![0].id), null);
      assert.notEqual(stateManager.findNode(pasted1![0].id), null);

      // Un único Ctrl+Z adicional revierte el primer pegado
      commandManager.undo();
      assert.equal(stateManager.findNode(pasted1![0].id), null);
    });

    it('copia y pega 2 figuras conservando sus posiciones relativas y orden de apilado relativo', () => {
      const r1 = createRect('r1', 'R1', 50, 50);
      const r2 = createRect('r2', 'R2', 150, 200);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.setSelection(['r1', 'r2']);

      assert.equal(controller.copy(), true);
      const pasted = controller.paste();
      assert.notEqual(pasted, null);
      assert.equal(pasted!.length, 2);

      // Conserva posiciones relativas: dx = 100, dy = 150
      assert.equal(pasted![0].x, 60);
      assert.equal(pasted![0].y, 60);
      assert.equal(pasted![1].x, 160);
      assert.equal(pasted![1].y, 210);

      // Ambas copias quedan seleccionadas
      assert.deepEqual(stateManager.getSelection(), [pasted![0].id, pasted![1].id]);

      // Orden de apilado: pasted[0] antes que pasted[1]
      const layer = stateManager.findNode('layer-default') as any;
      const idx0 = layer.children.findIndex((s: any) => s.id === pasted![0].id);
      const idx1 = layer.children.findIndex((s: any) => s.id === pasted![1].id);
      assert.equal(idx0 < idx1, true);

      // Un único Ctrl+Z elimina ambas copias
      commandManager.undo();
      assert.equal(stateManager.findNode(pasted![0].id), null);
      assert.equal(stateManager.findNode(pasted![1].id), null);
    });

    it('copia y pega 3 figuras con una sola entrada en el historial', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 30, 30);
      const r3 = createRect('r3', 'R3', 50, 50);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);
      stateManager.setSelection(['r1', 'r2', 'r3']);

      controller.copy();
      const pasted = controller.paste();
      assert.notEqual(pasted, null);
      assert.equal(pasted!.length, 3);
      assert.deepEqual(stateManager.getSelection(), pasted!.map((s) => s.id));

      // Un único Ctrl+Z revierte las 3
      assert.equal(commandManager.canUndo(), true);
      commandManager.undo();
      for (const p of pasted!) {
        assert.equal(stateManager.findNode(p.id), null);
      }
    });
  });

  describe('3. Duplicar (duplicate)', () => {
    it('duplica 1 figura y un único Ctrl+Z la revierte', () => {
      const r1 = createRect('r1', 'R1', 40, 40);
      stateManager.addShape('layer-default', r1);
      stateManager.setSelection(['r1']);

      const dup = controller.duplicate();
      assert.notEqual(dup, null);
      assert.equal(dup!.length, 1);
      assert.equal(dup![0].x, 50);
      assert.equal(dup![0].y, 50);
      assert.deepEqual(stateManager.getSelection(), [dup![0].id]);

      commandManager.undo();
      assert.equal(stateManager.findNode(dup![0].id), null);
      assert.notEqual(stateManager.findNode('r1'), null);
    });

    it('duplica 2 figuras conservando orden de apilado relativo y posiciones relativas', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 40, 40);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.setSelection(['r1', 'r2']);

      const dup = controller.duplicate();
      assert.notEqual(dup, null);
      assert.equal(dup!.length, 2);
      assert.equal(dup![0].x, 20);
      assert.equal(dup![0].y, 20);
      assert.equal(dup![1].x, 50);
      assert.equal(dup![1].y, 50);

      // Copias seleccionadas
      assert.deepEqual(stateManager.getSelection(), [dup![0].id, dup![1].id]);

      // Un único Ctrl+Z revierte ambas
      commandManager.undo();
      assert.equal(stateManager.findNode(dup![0].id), null);
      assert.equal(stateManager.findNode(dup![1].id), null);
    });

    it('duplica 3 figuras insertadas arriba de la más alta y un único Ctrl+Z las revierte', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      const r3 = createRect('r3', 'R3', 30, 30);
      const r4 = createRect('r4', 'R4', 40, 40);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);
      stateManager.addShape('layer-default', r4);

      // Seleccionar r1, r2, r3 (dejando r4 arriba)
      stateManager.setSelection(['r1', 'r2', 'r3']);
      const dup = controller.duplicate();
      assert.notEqual(dup, null);
      assert.equal(dup!.length, 3);

      // Deben insertarse arriba de r3 (índice 2): r1' en 3, r2' en 4, r3' en 5, r4 en 6
      const layer = stateManager.findNode('layer-default') as any;
      assert.equal(layer.children.length, 7);
      assert.equal(layer.children[3].id, dup![0].id);
      assert.equal(layer.children[4].id, dup![1].id);
      assert.equal(layer.children[5].id, dup![2].id);
      assert.equal(layer.children[6].id, 'r4');

      // Un único Ctrl+Z restaura el layer original
      commandManager.undo();
      const restoredLayer = stateManager.findNode('layer-default') as any;
      assert.equal(restoredLayer.children.length, 4);
      assert.deepEqual(
        restoredLayer.children.map((s: any) => s.id),
        ['r1', 'r2', 'r3', 'r4']
      );
    });
  });

  describe('4. Traer al frente y Enviar al fondo (bringToFront & sendToBack)', () => {
    it('bringToFront y sendToBack con 1 figura y un único Ctrl+Z', () => {
      const r1 = createRect('r1', 'R1', 0, 0);
      const r2 = createRect('r2', 'R2', 10, 10);
      const r3 = createRect('r3', 'R3', 20, 20);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);

      stateManager.setSelection(['r1']);
      assert.equal(controller.bringToFront(), true);
      let layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r2', 'r3', 'r1']);

      commandManager.undo();
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r2', 'r3']);

      stateManager.setSelection(['r3']);
      assert.equal(controller.sendToBack(), true);
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r3', 'r1', 'r2']);

      commandManager.undo();
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r2', 'r3']);
    });

    it('bringToFront y sendToBack con 2 figuras conservando su orden relativo', () => {
      const r1 = createRect('r1', 'R1', 0, 0);
      const r2 = createRect('r2', 'R2', 10, 10);
      const r3 = createRect('r3', 'R3', 20, 20);
      const r4 = createRect('r4', 'R4', 30, 30);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);
      stateManager.addShape('layer-default', r4);

      // Traer r1 y r3 al frente -> orden relativo r1 antes de r3 conservado al frente
      stateManager.setSelection(['r1', 'r3']);
      assert.equal(controller.bringToFront(), true);
      let layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r2', 'r4', 'r1', 'r3']);

      // Un solo Ctrl+Z restaura el orden exacto inicial
      commandManager.undo();
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r2', 'r3', 'r4']);

      // Enviar r2 y r4 al fondo -> r2 antes de r4 conservado al fondo
      stateManager.setSelection(['r2', 'r4']);
      assert.equal(controller.sendToBack(), true);
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r2', 'r4', 'r1', 'r3']);

      // Un solo Ctrl+Z restaura el orden inicial
      commandManager.undo();
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r2', 'r3', 'r4']);
    });

    it('bringToFront y sendToBack con 3 figuras conservando su orden relativo', () => {
      const r1 = createRect('r1', 'R1', 0, 0);
      const r2 = createRect('r2', 'R2', 10, 10);
      const r3 = createRect('r3', 'R3', 20, 20);
      const r4 = createRect('r4', 'R4', 30, 30);
      const r5 = createRect('r5', 'R5', 40, 40);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);
      stateManager.addShape('layer-default', r4);
      stateManager.addShape('layer-default', r5);

      // Traer r1, r3, r5 al frente -> deben quedar [r2, r4, r1, r3, r5]
      stateManager.setSelection(['r1', 'r3', 'r5']);
      assert.equal(controller.bringToFront(), true);
      let layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r2', 'r4', 'r1', 'r3', 'r5']);

      // Un solo Ctrl+Z restaura el orden exacto inicial
      commandManager.undo();
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r2', 'r3', 'r4', 'r5']);

      // Enviar r1, r3, r5 al fondo -> deben quedar [r1, r3, r5, r2, r4]
      stateManager.setSelection(['r1', 'r3', 'r5']);
      assert.equal(controller.sendToBack(), true);
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r3', 'r5', 'r2', 'r4']);

      // Un solo Ctrl+Z restaura el orden exacto inicial
      commandManager.undo();
      layer = stateManager.findNode('layer-default') as any;
      assert.deepEqual(layer.children.map((s: any) => s.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
    });
  });

  describe('4. Flechas y Fusión con BatchCommand.mergeWith', () => {
    it('mueve 1 figura con flechas y fusiona pulsaciones consecutivas', () => {
      const r1 = createRect('r1', 'R1', 100, 100);
      stateManager.addShape('layer-default', r1);
      stateManager.setSelection(['r1']);

      const t0 = 1000;
      controller.moveSelection(1, 0, t0);
      controller.moveSelection(1, 0, t0 + 100);
      controller.moveSelection(10, 0, t0 + 200);

      const shape = stateManager.findNode('r1') as Rectangle;
      assert.equal(shape.x, 112);

      // Un solo Ctrl+Z revierte todos los movimientos fusionados
      commandManager.undo();
      const reverted = stateManager.findNode('r1') as Rectangle;
      assert.equal(reverted.x, 100);
      assert.equal(commandManager.canUndo(), false);
    });

    it('mueve 2 figuras a la vez y fusiona en BatchCommand.mergeWith', () => {
      const r1 = createRect('r1', 'R1', 10, 20);
      const r2 = createRect('r2', 'R2', 50, 60);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.setSelection(['r1', 'r2']);

      const t0 = 2000;
      controller.moveSelection(1, 0, t0);
      controller.moveSelection(0, 1, t0 + 100);
      controller.moveSelection(10, 10, t0 + 200);

      const s1 = stateManager.findNode('r1') as Rectangle;
      const s2 = stateManager.findNode('r2') as Rectangle;
      assert.equal(s1.x, 21);
      assert.equal(s1.y, 31);
      assert.equal(s2.x, 61);
      assert.equal(s2.y, 71);

      // Un único Ctrl+Z revierte ambas figuras a sus coordenadas iniciales
      commandManager.undo();
      const r1Rev = stateManager.findNode('r1') as Rectangle;
      const r2Rev = stateManager.findNode('r2') as Rectangle;
      assert.equal(r1Rev.x, 10);
      assert.equal(r1Rev.y, 20);
      assert.equal(r2Rev.x, 50);
      assert.equal(r2Rev.y, 60);
      assert.equal(commandManager.canUndo(), false);
    });

    it('mueve 3 figuras a la vez y fusiona en BatchCommand.mergeWith', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      const r3 = createRect('r3', 'R3', 30, 30);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);
      stateManager.setSelection(['r1', 'r2', 'r3']);

      const t0 = 5000;
      controller.moveSelection(5, 5, t0);
      controller.moveSelection(5, 5, t0 + 100);

      const s1 = stateManager.findNode('r1') as Rectangle;
      const s2 = stateManager.findNode('r2') as Rectangle;
      const s3 = stateManager.findNode('r3') as Rectangle;
      assert.equal(s1.x, 20);
      assert.equal(s2.x, 30);
      assert.equal(s3.x, 40);

      // Un solo Ctrl+Z restaura las tres
      commandManager.undo();
      assert.equal((stateManager.findNode('r1') as Rectangle).x, 10);
      assert.equal((stateManager.findNode('r2') as Rectangle).x, 20);
      assert.equal((stateManager.findNode('r3') as Rectangle).x, 30);
      assert.equal(commandManager.canUndo(), false);
    });
  });

  describe('5, 6 y 7. UI: Panel de propiedades, Barra de estado y Menús', () => {
    let elements: Record<string, MockElement>;
    let cleanup: () => void;

    beforeEach(() => {
      elements = {
        '#panel-title': new MockElement('panel-title', 'span'),
        '#status-tool-label': new MockElement('status-tool-label', 'span'),
        '#status-shapes-count': new MockElement('status-shapes-count', 'span'),
        '#status-selection-info': new MockElement('status-selection-info', 'span'),
        '#status-selection-separator': new MockElement('status-selection-separator', 'span'),
        '#no-selection-state': new MockElement('no-selection-state', 'div'),
        '#selection-state': new MockElement('selection-state', 'div'),
        '#input-fill': new MockElement('input-fill', 'input'),
        '#input-stroke': new MockElement('input-stroke', 'input'),
        '#input-stroke-width': new MockElement('input-stroke-width', 'input'),
        '#btn-bring-to-front': new MockElement('btn-bring-to-front', 'button'),
        '#btn-send-to-back': new MockElement('btn-send-to-back', 'button'),
        '#btn-duplicate': new MockElement('btn-duplicate', 'button'),
        '#btn-delete-selection': new MockElement('btn-delete-selection', 'button'),
        '#btn-undo': new MockElement('btn-undo', 'button'),
        '#btn-redo': new MockElement('btn-redo', 'button'),
        '#menu-btn-object': new MockElement('menu-btn-object', 'button'),
        '#menu-item-copy': new MockElement('menu-item-copy', 'button'),
        '#menu-item-paste': new MockElement('menu-item-paste', 'button'),
        '#menu-item-duplicate': new MockElement('menu-item-duplicate', 'button'),
        '#menu-item-delete': new MockElement('menu-item-delete', 'button'),
        '#menu-item-bring-to-front': new MockElement('menu-item-bring-to-front', 'button'),
        '#menu-item-send-to-back': new MockElement('menu-item-send-to-back', 'button'),
        '#menu-item-undo': new MockElement('menu-item-undo', 'button'),
        '#menu-item-redo': new MockElement('menu-item-redo', 'button'),
        '#shortcuts-dialog': new MockElement('shortcuts-dialog', 'dialog'),
        '#shortcuts-dialog-list': new MockElement('shortcuts-dialog-list', 'div'),
        '#btn-close-shortcuts': new MockElement('btn-close-shortcuts', 'button'),
      };



      (globalThis as any).document = {
        querySelector: (sel: string) => {
          for (const part of sel.split(',').map((s) => s.trim())) {
            if (elements[part]) return elements[part];
          }
          return elements[sel] || null;
        },
        querySelectorAll: (_sel: string) => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: (tag: string) => new MockElement('', tag),
      };

      const binding = setupUIBindings(controller, commandManager, stateManager);
      cleanup = binding.cleanup;
    });

    afterEach(() => {
      if (cleanup) {
        cleanup();
      }
      delete (globalThis as any).document;
    });

    it('sincroniza panel de propiedades y barra de estado con 0, 1, 2 y 3 figuras', () => {
      const r1 = createRect('r1', 'Rectángulo 1', 10, 10, '#ff0000', '#000000', 2);
      const e1 = createEllipse('e1', 'Elipse 1', 100, 100, '#00ff00', '#111111', 4);
      const r2 = createRect('r2', 'Rectángulo 2', 200, 200, '#0000ff', '#222222', 6);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', e1);
      stateManager.addShape('layer-default', r2);

      // Con 0 figuras
      stateManager.setSelection([]);
      assert.equal(elements['#panel-title'].textContent, 'PROPIEDADES');
      assert.equal(elements['#no-selection-state'].style.display, 'block');
      assert.equal(elements['#selection-state'].style.display, 'none');
      assert.equal(elements['#status-selection-info'].textContent, '');
      assert.equal(elements['#menu-item-copy'].disabled, true);
      assert.equal(elements['#menu-btn-object'].disabled, true);

      // Con 1 figura
      stateManager.setSelection(['r1']);
      assert.equal(elements['#panel-title'].textContent, 'PROPIEDADES');
      assert.equal(elements['#no-selection-state'].style.display, 'none');
      assert.equal(elements['#selection-state'].style.display, 'block');
      assert.equal(elements['#status-selection-info'].textContent, 'Rectángulo 1 (Rectángulo)');
      assert.equal(elements['#input-fill'].value, '#ff0000');
      assert.equal(elements['#input-stroke'].value, '#000000');
      assert.equal(elements['#input-stroke-width'].value, '2');
      assert.equal(elements['#menu-item-copy'].disabled, false);
      assert.equal(elements['#menu-btn-object'].disabled, false);

      // Con 2 figuras
      stateManager.setSelection(['r1', 'e1']);
      assert.equal(elements['#panel-title'].textContent, '2 figuras seleccionadas');
      assert.equal(elements['#status-selection-info'].textContent, '2 figuras seleccionadas');
      // Controles muestran el valor de la primera figura (r1)
      assert.equal(elements['#input-fill'].value, '#ff0000');
      assert.equal(elements['#menu-item-copy'].disabled, false);
      assert.equal(elements['#menu-btn-object'].disabled, false);

      // Con 3 figuras
      stateManager.setSelection(['r1', 'e1', 'r2']);
      assert.equal(elements['#panel-title'].textContent, '3 figuras seleccionadas');
      assert.equal(elements['#status-selection-info'].textContent, '3 figuras seleccionadas');
      assert.equal(elements['#menu-item-copy'].disabled, false);
      assert.equal(elements['#menu-item-delete'].disabled, false);
      assert.equal(elements['#menu-item-duplicate'].disabled, false);
      assert.equal(elements['#menu-item-bring-to-front'].disabled, false);
      assert.equal(elements['#menu-item-send-to-back'].disabled, false);
      assert.equal(elements['#menu-btn-object'].disabled, false);
    });

    it('aplica cambios de estilo a múltiples figuras con un único BatchCommand en el historial', () => {
      const r1 = createRect('r1', 'R1', 10, 10, '#ff0000', '#000000', 2);
      const r2 = createRect('r2', 'R2', 20, 20, '#00ff00', '#000000', 2);
      const r3 = createRect('r3', 'R3', 30, 30, '#0000ff', '#000000', 2);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);

      stateManager.setSelection(['r1', 'r2', 'r3']);

      // Simular cambio de color de relleno a '#ffff00'
      elements['#input-fill'].value = '#ffff00';
      elements['#input-fill'].dispatchEvent({ type: 'change', target: elements['#input-fill'] });

      // Todas las figuras cambiaron de color
      assert.equal((stateManager.findNode('r1') as Rectangle).fill, '#ffff00');
      assert.equal((stateManager.findNode('r2') as Rectangle).fill, '#ffff00');
      assert.equal((stateManager.findNode('r3') as Rectangle).fill, '#ffff00');

      // Un único Ctrl+Z revierte los 3 colores a sus valores originales
      commandManager.undo();
      assert.equal((stateManager.findNode('r1') as Rectangle).fill, '#ff0000');
      assert.equal((stateManager.findNode('r2') as Rectangle).fill, '#00ff00');
      assert.equal((stateManager.findNode('r3') as Rectangle).fill, '#0000ff');
      assert.equal(commandManager.canUndo(), false);

      // Simular cambio de grosor de trazo a 15
      elements['#input-stroke-width'].value = '15';
      elements['#input-stroke-width'].dispatchEvent({ type: 'change', target: elements['#input-stroke-width'] });
      assert.equal((stateManager.findNode('r1') as Rectangle).strokeWidth, 15);
      assert.equal((stateManager.findNode('r2') as Rectangle).strokeWidth, 15);
      assert.equal((stateManager.findNode('r3') as Rectangle).strokeWidth, 15);

      commandManager.undo();
      assert.equal((stateManager.findNode('r1') as Rectangle).strokeWidth, 2);
      assert.equal((stateManager.findNode('r2') as Rectangle).strokeWidth, 2);
      assert.equal((stateManager.findNode('r3') as Rectangle).strokeWidth, 2);
    });

    it('botones del panel de acciones (duplicar, eliminar) operan sobre todas las seleccionadas', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.setSelection(['r1', 'r2']);

      // Clic en duplicar
      elements['#btn-duplicate'].click();
      let layer = stateManager.findNode('layer-default') as any;
      assert.equal(layer.children.length, 4);

      // Clic en eliminar (las copias quedaron seleccionadas)
      elements['#btn-delete-selection'].click();
      layer = stateManager.findNode('layer-default') as any;
      assert.equal(layer.children.length, 2);
      assert.deepEqual(stateManager.getSelection(), []);
    });
  });

  describe('8. Sanitización de selección en Importar y Deshacer/Rehacer', () => {
    it('loadState deja la selección vacía', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      stateManager.addShape('layer-default', r1);
      stateManager.setSelection(['r1']);
      assert.deepEqual(stateManager.getSelection(), ['r1']);

      const newDoc: Document = {
        id: 'new-doc',
        type: 'document',
        name: 'Nuevo',
        width: 800,
        height: 600,
        children: [
          {
            id: 'layer-1',
            type: 'layer',
            name: 'Capa 1',
            children: [createRect('r1', 'R1 New', 50, 50)],
          },
        ],
      };

      stateManager.loadState(newDoc);
      assert.deepEqual(stateManager.getSelection(), []);
      assert.equal(stateManager.getSelectedNodes().length, 0);
    });

    it('deshacer adición o rehacer eliminación nunca deja IDs inexistentes en getSelection()', () => {
      const r1 = createRect('r1', 'R1', 10, 10);
      const r2 = createRect('r2', 'R2', 20, 20);
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.setSelection(['r1', 'r2']);

      // Eliminar ambas figuras
      controller.deleteSelected();
      assert.deepEqual(stateManager.getSelection(), []);

      // Deshacer eliminación
      commandManager.undo();
      assert.notEqual(stateManager.findNode('r1'), null);
      assert.notEqual(stateManager.findNode('r2'), null);

      // Rehacer eliminación
      commandManager.redo();
      assert.equal(stateManager.findNode('r1'), null);
      assert.equal(stateManager.findNode('r2'), null);
      // getSelection() jamás debe tener 'r1' ni 'r2'
      assert.deepEqual(stateManager.getSelection(), []);
    });
  });
});
