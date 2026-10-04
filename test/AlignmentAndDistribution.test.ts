import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { BatchCommand } from '../src/commands/BatchCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import {
  computeAlignment,
  computeDistribution,
} from '../src/utils/geometry.ts';
import type { Rectangle, Path } from '../src/types/scene-graph.ts';

// Mock DOM minimalista para pruebas de bindings de UI
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public innerHTML: string = '';
  public files: any[] = [];
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
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.stopPropagation) e.stopPropagation = () => {};
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

  public focus(): void {
    if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
  }

  public appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public closest(selector: string): MockElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      let curr: MockElement | null = this;
      while (curr) {
        if (curr.classes.has(cls)) return curr;
        curr = curr.parentElement;
      }
    }
    return null;
  }

  public contains(target: any): boolean {
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
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

function setupMockDOM() {
  const elements: Record<string, MockElement> = {
    '.menu-bar': new MockElement('menu-bar', 'nav'),
    '#menu-btn-file': new MockElement('menu-btn-file', 'button'),
    '#menu-btn-edit': new MockElement('menu-btn-edit', 'button'),
    '#menu-btn-object': new MockElement('menu-btn-object', 'button'),
    '#menu-btn-view': new MockElement('menu-btn-view', 'button'),
    '#menu-btn-help': new MockElement('menu-btn-help', 'button'),
    '#menu-dropdown-file': new MockElement('menu-dropdown-file', 'div'),
    '#menu-dropdown-edit': new MockElement('menu-dropdown-edit', 'div'),
    '#menu-dropdown-object': new MockElement('menu-dropdown-object', 'div'),
    '#menu-dropdown-view': new MockElement('menu-dropdown-view', 'div'),
    '#menu-dropdown-help': new MockElement('menu-dropdown-help', 'div'),
    '#menu-item-import': new MockElement('menu-item-import', 'button'),
    '#menu-item-export': new MockElement('menu-item-export', 'button'),
    '#menu-item-undo': new MockElement('menu-item-undo', 'button'),
    '#menu-item-redo': new MockElement('menu-item-redo', 'button'),
    '#menu-item-copy': new MockElement('menu-item-copy', 'button'),
    '#menu-item-paste': new MockElement('menu-item-paste', 'button'),
    '#menu-item-duplicate': new MockElement('menu-item-duplicate', 'button'),
    '#menu-item-delete': new MockElement('menu-item-delete', 'button'),
    '#menu-item-bring-to-front': new MockElement('menu-item-bring-to-front', 'button'),
    '#menu-item-send-to-back': new MockElement('menu-item-send-to-back', 'button'),
    '#menu-item-zoom-in': new MockElement('menu-item-zoom-in', 'button'),
    '#menu-item-zoom-out': new MockElement('menu-item-zoom-out', 'button'),
    '#menu-item-zoom-fit': new MockElement('menu-item-zoom-fit', 'button'),
    '#menu-item-zoom-100': new MockElement('menu-item-zoom-100', 'button'),
    '#menu-item-shortcuts': new MockElement('menu-item-shortcuts', 'button'),
    '#shortcuts-dialog': new MockElement('shortcuts-dialog', 'dialog'),
    '#btn-close-shortcuts': new MockElement('btn-close-shortcuts', 'button'),
    '#shortcuts-dialog-list': new MockElement('shortcuts-dialog-list', 'div'),
    '#file-import-input': new MockElement('file-import-input', 'input'),
    '#btn-undo': new MockElement('btn-undo', 'button'),
    '#btn-redo': new MockElement('btn-redo', 'button'),
    '#btn-export': new MockElement('btn-export', 'button'),
    '#btn-import': new MockElement('btn-import', 'button'),
    '#btn-duplicate': new MockElement('btn-duplicate', 'button'),
    '#btn-bring-to-front': new MockElement('btn-bring-to-front', 'button'),
    '#btn-send-to-back': new MockElement('btn-send-to-back', 'button'),
    '#btn-delete-selection': new MockElement('btn-delete-selection', 'button'),

    // Submenús Alinear y Distribuir
    '#menu-item-align': new MockElement('menu-item-align', 'button'),
    '#menu-dropdown-align': new MockElement('menu-dropdown-align', 'div'),
    '#menu-item-align-left': new MockElement('menu-item-align-left', 'button'),
    '#menu-item-align-center-h': new MockElement('menu-item-align-center-h', 'button'),
    '#menu-item-align-right': new MockElement('menu-item-align-right', 'button'),
    '#menu-item-align-top': new MockElement('menu-item-align-top', 'button'),
    '#menu-item-align-center-v': new MockElement('menu-item-align-center-v', 'button'),
    '#menu-item-align-bottom': new MockElement('menu-item-align-bottom', 'button'),

    '#menu-item-distribute': new MockElement('menu-item-distribute', 'button'),
    '#menu-dropdown-distribute': new MockElement('menu-dropdown-distribute', 'div'),
    '#menu-item-distribute-h': new MockElement('menu-item-distribute-h', 'button'),
    '#menu-item-distribute-v': new MockElement('menu-item-distribute-v', 'button'),

    // Panel de propiedades: Sección Alinear
    '#section-align': new MockElement('section-align', 'details'),
    '#btn-align-left': new MockElement('btn-align-left', 'button'),
    '#btn-align-center-h': new MockElement('btn-align-center-h', 'button'),
    '#btn-align-right': new MockElement('btn-align-right', 'button'),
    '#btn-distribute-h': new MockElement('btn-distribute-h', 'button'),
    '#btn-align-top': new MockElement('btn-align-top', 'button'),
    '#btn-align-center-v': new MockElement('btn-align-center-v', 'button'),
    '#btn-align-bottom': new MockElement('btn-align-bottom', 'button'),
    '#btn-distribute-v': new MockElement('btn-distribute-v', 'button'),
  };

  const doc = {
    activeElement: null as any,
    querySelector: (sel: string) => elements[sel] || null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as any).document = doc;
  return { elements, doc };
}

describe('Alineación y Distribución de Figuras', () => {
  describe('1. Lógica pura de alineación (computeAlignment)', () => {
    it('alinea a la izquierda (left) con figuras de distinto tamaño', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 10, width: 100, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 200, y: 20, width: 40, height: 60 };

      const entries = computeAlignment([r1, r2], 'left');
      // r1 ya está en minX=50, solo r2 debe moverse de x=200 a x=50
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 'r2');
      assert.equal(entries[0].x, 50);
      assert.equal(entries[0].y, 20);
    });

    it('centra horizontalmente (center-h) con figuras de distinto tamaño', () => {
      // r1: x=0..100 (ancho 100, centro 50)
      // r2: x=100..300 (ancho 200, centro 200)
      // Caja combinada: 0..300, centro global = 150
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 10, width: 100, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 100, y: 20, width: 200, height: 60 };

      const entries = computeAlignment([r1, r2], 'center-h');
      assert.equal(entries.length, 2);

      // r1 nuevo centro = 150 -> nuevo x = 150 - 50 = 100
      const e1 = entries.find((e) => e.id === 'r1')!;
      assert.ok(e1);
      assert.equal(e1.x, 100);

      // r2 nuevo centro = 150 -> nuevo x = 150 - 100 = 50
      const e2 = entries.find((e) => e.id === 'r2')!;
      assert.ok(e2);
      assert.equal(e2.x, 50);
    });

    it('alinea a la derecha (right) con figuras de distinto tamaño', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 10, width: 100, height: 40 }; // maxX=150
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 200, y: 20, width: 80, height: 60 };  // maxX=280

      const entries = computeAlignment([r1, r2], 'right');
      // r2 ya termina en maxX=280. r1 debe terminar en 280 (x = 280 - 100 = 180)
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 'r1');
      assert.equal(entries[0].x, 180);
      assert.equal(entries[0].y, 10);
    });

    it('alinea arriba (top) con figuras de distinto tamaño', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 30, width: 50, height: 100 }; // minY=30
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 80, y: 120, width: 40, height: 40 };  // minY=120

      const entries = computeAlignment([r1, r2], 'top');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 'r2');
      assert.equal(entries[0].x, 80);
      assert.equal(entries[0].y, 30);
    });

    it('centra verticalmente (center-v) con figuras de distinto tamaño', () => {
      // r1: y=0..100 (alto 100, centro 50)
      // r2: y=100..300 (alto 200, centro 200)
      // Caja combinada: 0..300, centro global = 150
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 0, width: 40, height: 100 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 20, y: 100, width: 60, height: 200 };

      const entries = computeAlignment([r1, r2], 'center-v');
      assert.equal(entries.length, 2);

      const e1 = entries.find((e) => e.id === 'r1')!;
      assert.equal(e1.y, 100); // centro 150 - 50 = 100

      const e2 = entries.find((e) => e.id === 'r2')!;
      assert.equal(e2.y, 50); // centro 150 - 100 = 50
    });

    it('alinea abajo (bottom) con figuras de distinto tamaño', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 50, height: 80 };  // maxY=90
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 80, y: 50, width: 40, height: 150 }; // maxY=200

      const entries = computeAlignment([r1, r2], 'bottom');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 'r1');
      assert.equal(entries[0].y, 120); // 200 - 80 = 120
    });

    it('alinea correctamente considerando el AABB exacto de una figura rotada', () => {
      // rRot: cuadrado 100x100 en (100, 100) rotado 45°
      // centro = (150, 150), radio = 50 * sqrt(2) ≈ 70.7107
      // minX ≈ 79.2893, maxX ≈ 220.7107
      const rRot: Rectangle = {
        id: 'r-rot',
        type: 'rectangle',
        name: 'Rotated',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 45,
      };

      const r2: Rectangle = {
        id: 'r2',
        type: 'rectangle',
        name: 'Normal',
        x: 300,
        y: 100,
        width: 50,
        height: 50,
      };

      // Alinear a la izquierda: la caja combinada tiene minX = rRot.aabb.minX ≈ 79.2893
      const entriesLeft = computeAlignment([rRot, r2], 'left');
      assert.equal(entriesLeft.length, 1);
      assert.equal(entriesLeft[0].id, 'r2');
      const expectedMinX = 150 - 50 * Math.SQRT2;
      assert.ok(Math.abs(entriesLeft[0].x - expectedMinX) < 1e-4);

      // Alinear a la derecha: la caja combinada tiene maxX = r2.aabb.maxX = 350
      const entriesRight = computeAlignment([rRot, r2], 'right');
      assert.equal(entriesRight.length, 1);
      assert.equal(entriesRight[0].id, 'r-rot');
      const rotMaxX = 150 + 50 * Math.SQRT2;
      const dx = 350 - rotMaxX;
      assert.ok(Math.abs(entriesRight[0].x - (100 + dx)) < 1e-4);
    });

    it('alinea un Path y preserva/traslada sus puntos mediante updateShapesPosition', () => {
      const stateManager = new StateManager();
      const pathShape: Path = {
        id: 'p1',
        type: 'path',
        name: 'Path 1',
        x: 100,
        y: 100,
        points: [
          { x: 100, y: 100, handleOut: { x: 120, y: 110 } },
          { x: 150, y: 140, handleIn: { x: 140, y: 130 } },
        ],
      };
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'R1',
        x: 20,
        y: 50,
        width: 40,
        height: 40,
      };

      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, pathShape);
      stateManager.addShape(layerId, rect);

      // minX global = 20 (de rect). Path tiene minX = 100.
      const entries = computeAlignment([pathShape, rect], 'left');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 'p1');
      assert.equal(entries[0].x, 20); // dx = -80

      // Aplicar las entradas devueltas con updateShapesPosition
      stateManager.updateShapesPosition(entries);

      const updatedPath = stateManager.findNode('p1') as Path;
      assert.equal(updatedPath.x, 20);
      assert.equal(updatedPath.points[0].x, 20);
      assert.equal(updatedPath.points[0].handleOut!.x, 40);
      assert.equal(updatedPath.points[1].x, 70);
      assert.equal(updatedPath.points[1].handleIn!.x, 60);
    });

    it('devuelve lista vacía cuando las figuras ya están alineadas', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 10, width: 100, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 50, y: 60, width: 80, height: 40 };

      // Ya están alineadas a la izquierda (ambas minX = 50)
      const entries = computeAlignment([r1, r2], 'left');
      assert.equal(entries.length, 0);
    });

    it('devuelve lista vacía si hay menos de 2 figuras', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 10, width: 100, height: 40 };
      assert.deepEqual(computeAlignment([r1], 'left'), []);
      assert.deepEqual(computeAlignment([], 'left'), []);
    });
  });

  describe('2. Lógica pura de distribución (computeDistribution)', () => {
    it('distribuye horizontalmente 3 figuras con espacios desiguales dejando extremos fijos', () => {
      // S0: x=0, w=20 -> [0, 20]
      // S1: x=30, w=20 -> [30, 50] (gap inicial 1 = 10)
      // S2: x=100, w=20 -> [100, 120] (gap inicial 2 = 50)
      // Span entre extremos: 100 - 20 = 80
      // Ancho intermedio: 20
      // Espacio restante: 60 -> 2 gaps de 30 px cada uno
      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 0, y: 10, width: 20, height: 20 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 30, y: 10, width: 20, height: 20 };
      const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 100, y: 10, width: 20, height: 20 };

      const entries = computeDistribution([s0, s1, s2], 'horizontal');

      // Solo s1 debe moverse (los extremos s0 y s2 se mantienen completamente fijos)
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 's1');
      assert.equal(entries[0].x, 50); // 20 + 30 = 50

      // Verificamos los gaps resultantes:
      // gap(s0, s1) = 50 - 20 = 30
      // gap(s1, s2) = 100 - (50 + 20) = 30
    });

    it('distribuye verticalmente 4 figuras con espacios desiguales dejando extremos fijos', () => {
      // S0: y=0, h=10 -> [0, 10]
      // S1: y=20, h=20 -> [20, 40]
      // S2: y=80, h=10 -> [80, 90]
      // S3: y=120, h=30 -> [120, 150]
      // Span entre extremos: 120 - 10 = 110
      // Altura intermedia: 20 + 10 = 30
      // Espacio restante: 110 - 30 = 80 -> 3 gaps de 80 / 3 ≈ 26.6667 px
      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 10, y: 0, width: 20, height: 10 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 10, y: 20, width: 20, height: 20 };
      const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 10, y: 80, width: 20, height: 10 };
      const s3: Rectangle = { id: 's3', type: 'rectangle', name: 'S3', x: 10, y: 120, width: 20, height: 30 };

      const entries = computeDistribution([s0, s1, s2, s3], 'vertical');

      assert.equal(entries.length, 2);
      const e1 = entries.find((e) => e.id === 's1')!;
      const e2 = entries.find((e) => e.id === 's2')!;

      const gap = 80 / 3;
      const expectedY1 = 10 + gap;
      const expectedY2 = expectedY1 + 20 + gap;

      assert.ok(Math.abs(e1.y - expectedY1) < 1e-4);
      assert.ok(Math.abs(e2.y - expectedY2) < 1e-4);
    });

    it('ordena por posición espacial y no por orden de selección en el array', () => {
      // Pasamos las figuras en orden inverso: [s2, s0, s1]
      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 0, y: 10, width: 20, height: 20 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 30, y: 10, width: 20, height: 20 };
      const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 100, y: 10, width: 20, height: 20 };

      const entries = computeDistribution([s2, s0, s1], 'horizontal');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, 's1');
      assert.equal(entries[0].x, 50);
    });

    it('devuelve lista vacía si las figuras ya están equitativamente distribuidas', () => {
      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 0, y: 10, width: 20, height: 20 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 50, y: 10, width: 20, height: 20 };
      const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 100, y: 10, width: 20, height: 20 };

      const entries = computeDistribution([s0, s1, s2], 'horizontal');
      assert.equal(entries.length, 0);
    });

    it('requiere 3 o más figuras (devuelve lista vacía con menos de 3)', () => {
      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 0, y: 10, width: 20, height: 20 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 50, y: 10, width: 20, height: 20 };

      assert.deepEqual(computeDistribution([s0, s1], 'horizontal'), []);
      assert.deepEqual(computeDistribution([s0], 'horizontal'), []);
      assert.deepEqual(computeDistribution([], 'horizontal'), []);
    });
  });

  describe('3. Comandos e Historial (BatchCommand y Undo/Redo)', () => {
    it('alignSelection ejecuta UN BatchCommand y se revierte completamente con un único Ctrl+Z', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(undefined, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 10, width: 100, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 200, y: 20, width: 40, height: 60 };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, r1);
      stateManager.addShape(layerId, r2);
      stateManager.setSelection(['r1', 'r2']);

      const initialUndoCount = commandManager.undoCount;

      // Ejecutar alineación
      const success = inputController.alignSelection('left');
      assert.equal(success, true);

      // Verificamos que se añadió exactamente 1 comando al historial y es un BatchCommand
      assert.equal(commandManager.undoCount, initialUndoCount + 1);
      const lastCmd = (commandManager as any).undoStack[commandManager.undoCount - 1];
      assert.ok(lastCmd instanceof BatchCommand);

      // Posición tras alinear
      const shape2After = stateManager.findNode('r2') as Rectangle;
      assert.equal(shape2After.x, 50);

      // Un único Undo revierte todo
      commandManager.undo();
      const shape2Reverted = stateManager.findNode('r2') as Rectangle;
      assert.equal(shape2Reverted.x, 200);

      // Redo vuelve a aplicar la alineación
      commandManager.redo();
      const shape2Redone = stateManager.findNode('r2') as Rectangle;
      assert.equal(shape2Redone.x, 50);
    });

    it('figuras ya alineadas no registran nada en el historial ni ejecutan comandos', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(undefined, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 10, width: 100, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 50, y: 60, width: 80, height: 40 };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, r1);
      stateManager.addShape(layerId, r2);
      stateManager.setSelection(['r1', 'r2']);

      const initialUndoCount = commandManager.undoCount;

      // Intentar alinear cuando ya están en minX=50
      const success = inputController.alignSelection('left');
      assert.equal(success, false);
      assert.equal(commandManager.undoCount, initialUndoCount);
    });

    it('distributeSelection ejecuta UN BatchCommand y un único Ctrl+Z revierte todos los cambios', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(undefined, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 0, y: 10, width: 20, height: 20 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 30, y: 10, width: 20, height: 20 };
      const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 100, y: 10, width: 20, height: 20 };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, s0);
      stateManager.addShape(layerId, s1);
      stateManager.addShape(layerId, s2);
      stateManager.setSelection(['s0', 's1', 's2']);

      const initialUndoCount = commandManager.undoCount;

      const success = inputController.distributeSelection('horizontal');
      assert.equal(success, true);
      assert.equal(commandManager.undoCount, initialUndoCount + 1);
      const lastCmd = (commandManager as any).undoStack[commandManager.undoCount - 1];
      assert.ok(lastCmd instanceof BatchCommand);

      const s1After = stateManager.findNode('s1') as Rectangle;
      assert.equal(s1After.x, 50);

      // Un único Undo revierte
      commandManager.undo();
      const s1Reverted = stateManager.findNode('s1') as Rectangle;
      assert.equal(s1Reverted.x, 30);
    });

    it('distribuir figuras ya distribuidas no registra nada en el historial', () => {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(undefined, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const s0: Rectangle = { id: 's0', type: 'rectangle', name: 'S0', x: 0, y: 10, width: 20, height: 20 };
      const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 50, y: 10, width: 20, height: 20 };
      const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 100, y: 10, width: 20, height: 20 };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, s0);
      stateManager.addShape(layerId, s1);
      stateManager.addShape(layerId, s2);
      stateManager.setSelection(['s0', 's1', 's2']);

      const initialUndoCount = commandManager.undoCount;
      const success = inputController.distributeSelection('horizontal');
      assert.equal(success, false);
      assert.equal(commandManager.undoCount, initialUndoCount);
    });
  });

  describe('4. Interfaz de usuario: sincronización de menús y botones según selección', () => {
    it('sincroniza menús y botones con 0, 1, 2 y 3 figuras seleccionadas', () => {
      const { elements } = setupMockDOM();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 30, height: 30 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 50, y: 10, width: 30, height: 30 };
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 90, y: 10, width: 30, height: 30 };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, r1);
      stateManager.addShape(layerId, r2);
      stateManager.addShape(layerId, r3);

      const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

      const menuBtnObject = elements['#menu-btn-object'];
      const menuItemAlign = elements['#menu-item-align'];
      const menuItemAlignLeft = elements['#menu-item-align-left'];
      const menuItemDistribute = elements['#menu-item-distribute'];
      const menuItemDistributeH = elements['#menu-item-distribute-h'];

      const sectionAlign = elements['#section-align'];
      const btnAlignLeft = elements['#btn-align-left'];
      const btnDistributeH = elements['#btn-distribute-h'];

      // --- Caso A: 0 figuras seleccionadas ---
      stateManager.setSelection([]);
      assert.equal(menuBtnObject.disabled, true);
      assert.equal(menuItemAlign.disabled, true);
      assert.equal(menuItemAlignLeft.disabled, true);
      assert.equal(menuItemDistribute.disabled, true);
      assert.equal(menuItemDistributeH.disabled, true);
      assert.equal(sectionAlign.style.display, 'none');

      // --- Caso B: 1 figura seleccionada ---
      stateManager.setSelection(['r1']);
      assert.equal(menuBtnObject.disabled, false); // Objeto habilitado (para traer al frente/fondo)
      assert.equal(menuItemAlign.disabled, true);  // Alinear requiere >= 2
      assert.equal(menuItemAlignLeft.disabled, true);
      assert.equal(menuItemDistribute.disabled, true); // Distribuir requiere >= 3
      assert.equal(menuItemDistributeH.disabled, true);
      assert.equal(sectionAlign.style.display, 'none');

      // --- Caso C: 2 figuras seleccionadas ---
      stateManager.setSelection(['r1', 'r2']);
      assert.equal(menuBtnObject.disabled, false);
      assert.equal(menuItemAlign.disabled, false); // Alinear habilitado
      assert.equal(menuItemAlignLeft.disabled, false);
      assert.equal(menuItemDistribute.disabled, true); // Distribuir aún deshabilitado
      assert.equal(menuItemDistributeH.disabled, true);
      assert.equal(sectionAlign.style.display, 'block'); // Sección panel visible
      assert.equal(btnAlignLeft.disabled, false); // Botones de alinear habilitados
      assert.equal(btnDistributeH.disabled, true); // Botones de distribuir deshabilitados

      // --- Caso D: 3 figuras seleccionadas ---
      stateManager.setSelection(['r1', 'r2', 'r3']);
      assert.equal(menuBtnObject.disabled, false);
      assert.equal(menuItemAlign.disabled, false);
      assert.equal(menuItemAlignLeft.disabled, false);
      assert.equal(menuItemDistribute.disabled, false); // Distribuir habilitado
      assert.equal(menuItemDistributeH.disabled, false);
      assert.equal(sectionAlign.style.display, 'block');
      assert.equal(btnAlignLeft.disabled, false);
      assert.equal(btnDistributeH.disabled, false); // Botones de distribuir habilitados

      cleanup();
    });

    it('clic en botones del panel y del menú invoca las acciones de InputController', () => {
      const { elements } = setupMockDOM();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 10, width: 30, height: 30 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 100, y: 10, width: 30, height: 30 };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, r1);
      stateManager.addShape(layerId, r2);
      stateManager.setSelection(['r1', 'r2']);

      const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

      // Clic en botón del panel de alinear a la izquierda
      const btnAlignLeft = elements['#btn-align-left'];
      btnAlignLeft.click();

      const r2After = stateManager.findNode('r2') as Rectangle;
      assert.equal(r2After.x, 20);

      cleanup();
    });
  });
});
