import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import { TransformShapesCommand } from '../src/commands/TransformShapesCommand.ts';
import { setupPropertiesPanelBindings } from '../src/ui/PropertiesPanelController.ts';
import { isPointInShape } from '../src/utils/geometry.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import type { Rectangle, Ellipse, Document } from '../src/types/scene-graph.ts';

class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public placeholder: string = '';
  public innerHTML: string = '';
  public open: boolean = true;
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

  public hasListener(event: string, listener: (e: any) => void): boolean {
    const set = this.listeners.get(event);
    return set ? set.has(listener) : false;
  }

  public getListenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.preventDefault) e.preventDefault = () => {};
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }
}

function setupMockDOM(): {
  domMap: Record<string, MockElement>;
  groupCornerRadius: MockElement;
  inputCornerRadius: MockElement;
  cleanupGlobal: () => void;
} {
  const domMap: Record<string, MockElement> = {};

  const getOrCreate = (id: string, tag: string = 'div') => {
    if (!domMap[id]) {
      domMap[id] = new MockElement(id, tag);
    }
    return domMap[id];
  };

  const groupCornerRadius = getOrCreate('group-corner-radius');
  const inputCornerRadius = getOrCreate('input-corner-radius', 'input');

  const oldDoc = (globalThis as any).document;
  (globalThis as any).document = {
    querySelector: (selector: string) => {
      const idMatch = selector.match(/#([\w-]+)/);
      if (idMatch) {
        return getOrCreate(idMatch[1]);
      }
      return null;
    },
    querySelectorAll: () => [],
    activeElement: null,
  };

  return {
    domMap,
    groupCornerRadius,
    inputCornerRadius,
    cleanupGlobal: () => {
      (globalThis as any).document = oldDoc;
    },
  };
}

describe('Radio de esquinas (Corner Radius) en Rectángulos', () => {
  describe('1. StateManager y Comandos', () => {
    it('updateShapeDimensions actualiza cornerRadius inmutablemente', () => {
      const stateManager = new StateManager();
      const rect: Rectangle = {
        id: 'rect-1',
        type: 'rectangle',
        name: 'Rect 1',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        cornerRadius: 0,
      };
      stateManager.addShape('layer-default', rect);

      const ok = stateManager.updateShapeDimensions('rect-1', { cornerRadius: 15 });
      assert.strictEqual(ok, true);

      const updated = stateManager.findNode('rect-1') as Rectangle;
      assert.strictEqual(updated.cornerRadius, 15);
      assert.strictEqual(Object.isFrozen(updated), true);
    });

    it('ResizeCommand con cornerRadius soporta execute y undo', () => {
      const stateManager = new StateManager();
      const rect: Rectangle = {
        id: 'rect-2',
        type: 'rectangle',
        name: 'Rect 2',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        cornerRadius: 5,
      };
      stateManager.addShape('layer-default', rect);

      const cmd = new ResizeCommand(
        stateManager,
        'rect-2',
        { cornerRadius: 5 },
        { cornerRadius: 20 }
      );

      cmd.execute();
      assert.strictEqual((stateManager.findNode('rect-2') as Rectangle).cornerRadius, 20);

      cmd.undo();
      assert.strictEqual((stateManager.findNode('rect-2') as Rectangle).cornerRadius, 5);
    });

    it('TransformShapesCommand soporta múltiples rectángulos con cornerRadius y Undo/Redo', () => {
      const stateManager = new StateManager();
      const rectA: Rectangle = {
        id: 'ra',
        type: 'rectangle',
        name: 'RA',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        cornerRadius: 4,
      };
      const rectB: Rectangle = {
        id: 'rb',
        type: 'rectangle',
        name: 'RB',
        x: 60,
        y: 0,
        width: 50,
        height: 50,
        cornerRadius: 8,
      };
      stateManager.addShape('layer-default', rectA);
      stateManager.addShape('layer-default', rectB);

      const cmd = new TransformShapesCommand(stateManager, [
        { id: 'ra', before: { cornerRadius: 4 }, after: { cornerRadius: 12 } },
        { id: 'rb', before: { cornerRadius: 8 }, after: { cornerRadius: 12 } },
      ]);

      cmd.execute();
      assert.strictEqual((stateManager.findNode('ra') as Rectangle).cornerRadius, 12);
      assert.strictEqual((stateManager.findNode('rb') as Rectangle).cornerRadius, 12);

      cmd.undo();
      assert.strictEqual((stateManager.findNode('ra') as Rectangle).cornerRadius, 4);
      assert.strictEqual((stateManager.findNode('rb') as Rectangle).cornerRadius, 8);
    });
  });

  describe('2. Panel de Propiedades e Interacción UI', () => {
    let mockDOM: ReturnType<typeof setupMockDOM>;

    afterEach(() => {
      mockDOM?.cleanupGlobal();
    });

    it('muestra el control #group-corner-radius solo cuando hay un rectángulo seleccionado', () => {
      mockDOM = setupMockDOM();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        cornerRadius: 14,
      };
      const ellipse: Ellipse = {
        id: 'e1',
        type: 'ellipse',
        name: 'Elipse',
        x: 200,
        y: 200,
        radiusX: 40,
        radiusY: 30,
      };
      stateManager.addShape('layer-default', rect);
      stateManager.addShape('layer-default', ellipse);

      const controller = setupPropertiesPanelBindings({
        stateManager,
        commandManager,
        inputController: null as any,
        canvas: null,
      });

      // 1. Sin selección: oculto
      stateManager.setSelection([]);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.groupCornerRadius.style.display, 'none');

      // 2. Rectángulo seleccionado: visible con su radio
      stateManager.setSelection(['r1']);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.groupCornerRadius.style.display, 'flex');
      assert.strictEqual(mockDOM.inputCornerRadius.value, '14');

      // 3. Elipse seleccionada: oculto
      stateManager.setSelection(['e1']);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.groupCornerRadius.style.display, 'none');

      controller.cleanup();
    });

    it('muestra "Mixto" cuando varios rectángulos tienen radios distintos y el valor común si son iguales', () => {
      mockDOM = setupMockDOM();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 0, width: 50, height: 50, cornerRadius: 10 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 60, y: 0, width: 50, height: 50, cornerRadius: 20 };
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 120, y: 0, width: 50, height: 50, cornerRadius: 10 };
      stateManager.addShape('layer-default', r1);
      stateManager.addShape('layer-default', r2);
      stateManager.addShape('layer-default', r3);

      const controller = setupPropertiesPanelBindings({
        stateManager,
        commandManager,
        inputController: null as any,
        canvas: null,
      });

      // Radios distintos: r1 (10) y r2 (20)
      stateManager.setSelection(['r1', 'r2']);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.inputCornerRadius.value, '');
      assert.strictEqual(mockDOM.inputCornerRadius.placeholder, 'Mixto');

      // Radios iguales: r1 (10) y r3 (10)
      stateManager.setSelection(['r1', 'r3']);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.inputCornerRadius.value, '10');
      assert.strictEqual(mockDOM.inputCornerRadius.placeholder, '');

      controller.cleanup();
    });

    it('modificar el input registra comando en el historial con soporte de Undo/Redo', () => {
      mockDOM = setupMockDOM();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 0, width: 100, height: 100, cornerRadius: 6 };
      stateManager.addShape('layer-default', r1);
      stateManager.setSelection(['r1']);

      const controller = setupPropertiesPanelBindings({
        stateManager,
        commandManager,
        inputController: null as any,
        canvas: null,
      });
      controller.syncPropertiesPanel();

      // Focus -> Input -> Change
      mockDOM.inputCornerRadius.dispatchEvent({ type: 'focus' });
      mockDOM.inputCornerRadius.value = '25';
      mockDOM.inputCornerRadius.dispatchEvent({ type: 'input' });

      // Verificamos actualización visual interactiva
      assert.strictEqual((stateManager.findNode('r1') as Rectangle).cornerRadius, 25);

      // Change confirma el comando en el historial
      mockDOM.inputCornerRadius.dispatchEvent({ type: 'change' });
      assert.strictEqual(commandManager.canUndo(), true);

      // Undo restaura a 6
      commandManager.undo();
      assert.strictEqual((stateManager.findNode('r1') as Rectangle).cornerRadius, 6);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.inputCornerRadius.value, '6');

      // Redo vuelve a 25
      commandManager.redo();
      assert.strictEqual((stateManager.findNode('r1') as Rectangle).cornerRadius, 25);
      controller.syncPropertiesPanel();
      assert.strictEqual(mockDOM.inputCornerRadius.value, '25');

      controller.cleanup();
    });
  });

  describe('3. Hit-testing geométrico (isPointInShape)', () => {
    it('detecta puntos dentro del cuerpo y descarta puntos en las esquinas recortadas', () => {
      const rect: Rectangle = {
        id: 'rect-hit',
        type: 'rectangle',
        name: 'Rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        cornerRadius: 20,
      };

      // Centro del rectángulo: debe dar true
      assert.strictEqual(isPointInShape(50, 50, rect), true);

      // Punto en el arco redondeado (esquina superior izquierda, dentro del radio):
      // (10, 10): distancia a (20, 20) es sqrt(100+100) = ~14.14 <= 20
      assert.strictEqual(isPointInShape(10, 10, rect), true);

      // Punto en el extremo de la esquina cortada:
      // (1, 1): distancia a (20, 20) es sqrt(19^2 + 19^2) = ~26.87 > 20 => fuera del rectángulo redondeado!
      assert.strictEqual(isPointInShape(1, 1, rect), false);
    });
  });

  describe('4. Exportación SVG', () => {
    it('genera atributos rx y ry para rectángulos con cornerRadius > 0', () => {
      const doc: Document = {
        id: 'doc',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer',
            children: [
              {
                id: 'r-svg',
                type: 'rectangle',
                name: 'Rect SVG',
                x: 10,
                y: 20,
                width: 120,
                height: 80,
                cornerRadius: 16,
                fill: '#ff0000',
              },
            ],
          },
        ],
      };

      const svg = exportDocumentToSvg(doc);
      assert.ok(svg.includes('rx="16"'), 'Debe incluir rx="16"');
      assert.ok(svg.includes('ry="16"'), 'Debe incluir ry="16"');
    });

    it('no genera rx ni ry si cornerRadius es 0 o undefined', () => {
      const doc: Document = {
        id: 'doc',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer',
            children: [
              {
                id: 'r-zero',
                type: 'rectangle',
                name: 'Rect Zero',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                cornerRadius: 0,
              },
            ],
          },
        ],
      };

      const svg = exportDocumentToSvg(doc);
      assert.ok(!svg.includes('rx='), 'No debe incluir rx si cornerRadius es 0');
      assert.ok(!svg.includes('ry='), 'No debe incluir ry si cornerRadius es 0');
    });
  });
});
