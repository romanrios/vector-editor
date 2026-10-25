import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import {
  getAllSelectionHandles,
  getAllSelectionBoxHandles,
  computeBoxScale,
} from '../src/utils/geometry.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

function createMockCanvas(mockCtx?: any): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    style: { cursor: 'default' },
    width: 1000,
    height: 800,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    getContext: () => mockCtx ?? null,
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('Manejadores laterales para escalar elementos (Illustrator-style)', () => {
  describe('1. Geometría de manejadores laterales', () => {
    it('getAllSelectionHandles retorna 9 manejadores (4 esquinas, 4 laterales y 1 rotación)', () => {
      const rect: Rectangle = {
        id: 'rect-1',
        name: 'Rect 1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 1,
        opacity: 1,
        rotation: 0,
      };

      const handles = getAllSelectionHandles(rect);
      assert.equal(handles.length, 9);

      const types = handles.map((h) => h.type);
      assert.ok(types.includes('top-left'));
      assert.ok(types.includes('top-right'));
      assert.ok(types.includes('bottom-left'));
      assert.ok(types.includes('bottom-right'));
      assert.ok(types.includes('top-center'));
      assert.ok(types.includes('bottom-center'));
      assert.ok(types.includes('left-center'));
      assert.ok(types.includes('right-center'));
      assert.ok(types.includes('rotation-handle'));

      // Verificar posiciones de centro
      const topCenter = handles.find((h) => h.type === 'top-center')!;
      assert.equal((topCenter.minX + topCenter.maxX) / 2, 200);
      assert.equal((topCenter.minY + topCenter.maxY) / 2, 100);

      const bottomCenter = handles.find((h) => h.type === 'bottom-center')!;
      assert.equal((bottomCenter.minX + bottomCenter.maxX) / 2, 200);
      assert.equal((bottomCenter.minY + bottomCenter.maxY) / 2, 200);

      const leftCenter = handles.find((h) => h.type === 'left-center')!;
      assert.equal((leftCenter.minX + leftCenter.maxX) / 2, 100);
      assert.equal((leftCenter.minY + leftCenter.maxY) / 2, 150);

      const rightCenter = handles.find((h) => h.type === 'right-center')!;
      assert.equal((rightCenter.minX + rightCenter.maxX) / 2, 300);
      assert.equal((rightCenter.minY + rightCenter.maxY) / 2, 150);
    });

    it('getAllSelectionBoxHandles retorna 9 manejadores para cajas combinadas', () => {
      const aabb = { minX: 50, minY: 50, maxX: 250, maxY: 150, width: 200, height: 100 };
      const handles = getAllSelectionBoxHandles(aabb);
      assert.equal(handles.length, 9);

      const tc = handles.find((h) => h.type === 'top-center')!;
      assert.equal((tc.minX + tc.maxX) / 2, 150);
      assert.equal((tc.minY + tc.maxY) / 2, 50);

      const bc = handles.find((h) => h.type === 'bottom-center')!;
      assert.equal((bc.minX + bc.maxX) / 2, 150);
      assert.equal((bc.minY + bc.maxY) / 2, 150);

      const lc = handles.find((h) => h.type === 'left-center')!;
      assert.equal((lc.minX + lc.maxX) / 2, 50);
      assert.equal((lc.minY + lc.maxY) / 2, 100);

      const rc = handles.find((h) => h.type === 'right-center')!;
      assert.equal((rc.minX + rc.maxX) / 2, 250);
      assert.equal((rc.minY + rc.maxY) / 2, 100);
    });

    it('computeBoxScale escala correctamente desde los manejadores laterales', () => {
      const origBox = { minX: 100, minY: 100, maxX: 300, maxY: 200, width: 200, height: 100 };

      // top-center: arrastrar hacia arriba 20px (dy = -20) expande la altura a 120
      const resTC = computeBoxScale(origBox, 'top-center', 0, -20, false);
      assert.equal(resTC.anchor.x, 200);
      assert.equal(resTC.anchor.y, 200);
      assert.equal(resTC.sy, 120 / 100);
      assert.equal(resTC.sx, 1);

      // bottom-center: arrastrar hacia abajo 30px (dy = 30) expande la altura a 130
      const resBC = computeBoxScale(origBox, 'bottom-center', 0, 30, false);
      assert.equal(resBC.anchor.x, 200);
      assert.equal(resBC.anchor.y, 100);
      assert.equal(resBC.sy, 130 / 100);
      assert.equal(resBC.sx, 1);

      // left-center: arrastrar hacia la izquierda 40px (dx = -40) expande el ancho a 240
      const resLC = computeBoxScale(origBox, 'left-center', -40, 0, false);
      assert.equal(resLC.anchor.x, 300);
      assert.equal(resLC.anchor.y, 150);
      assert.equal(resLC.sx, 240 / 200);
      assert.equal(resLC.sy, 1);

      // right-center: arrastrar hacia la derecha 50px (dx = 50) expande el ancho a 250
      const resRC = computeBoxScale(origBox, 'right-center', 50, 0, false);
      assert.equal(resRC.anchor.x, 100);
      assert.equal(resRC.anchor.y, 150);
      assert.equal(resRC.sx, 250 / 200);
      assert.equal(resRC.sy, 1);
    });
  });

  describe('2. Cursores de redimensionado para manejadores laterales', () => {
    it('getResizeCursor devuelve el cursor apropiado según el ángulo de rotación', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      // A 0°
      assert.equal(controller.getResizeCursor('top-center', 0), 'ns-resize');
      assert.equal(controller.getResizeCursor('bottom-center', 0), 'ns-resize');
      assert.equal(controller.getResizeCursor('left-center', 0), 'ew-resize');
      assert.equal(controller.getResizeCursor('right-center', 0), 'ew-resize');

      // A 90°
      assert.equal(controller.getResizeCursor('top-center', 90), 'ew-resize');
      assert.equal(controller.getResizeCursor('bottom-center', 90), 'ew-resize');
      assert.equal(controller.getResizeCursor('left-center', 90), 'ns-resize');
      assert.equal(controller.getResizeCursor('right-center', 90), 'ns-resize');

      // A 45°
      assert.equal(controller.getResizeCursor('top-center', 45), 'nesw-resize');
      assert.equal(controller.getResizeCursor('bottom-center', 45), 'nesw-resize');
      assert.equal(controller.getResizeCursor('left-center', 45), 'nwse-resize');
      assert.equal(controller.getResizeCursor('right-center', 45), 'nwse-resize');
    });
  });

  describe('3. Cálculo de dimensiones individuales (calculateResizedDimensions)', () => {
    it('top-center redimensiona solo la altura manteniendo fija la base', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initial = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
      // Arrastrar hacia arriba 40px (dy = -40)
      const res = controller.calculateResizedDimensions(initial, 'top-center', 0, -40);
      assert.equal(res.y, 60);
      assert.equal(res.height, 140);
      assert.equal(res.x, 100);
      assert.equal(res.width, 200);
    });

    it('bottom-center redimensiona solo la altura manteniendo fijo el borde superior', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initial = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
      // Arrastrar hacia abajo 30px (dy = 30)
      const res = controller.calculateResizedDimensions(initial, 'bottom-center', 0, 30);
      assert.equal(res.y, 100);
      assert.equal(res.height, 130);
      assert.equal(res.x, 100);
      assert.equal(res.width, 200);
    });

    it('left-center redimensiona solo el ancho manteniendo fijo el borde derecho', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initial = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
      // Arrastrar hacia la izquierda 50px (dx = -50)
      const res = controller.calculateResizedDimensions(initial, 'left-center', -50, 0);
      assert.equal(res.x, 50);
      assert.equal(res.width, 250);
      assert.equal(res.y, 100);
      assert.equal(res.height, 100);
    });

    it('right-center redimensiona solo el ancho manteniendo fijo el borde izquierdo', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initial = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
      // Arrastrar hacia la derecha 40px (dx = 40)
      const res = controller.calculateResizedDimensions(initial, 'right-center', 40, 0);
      assert.equal(res.x, 100);
      assert.equal(res.width, 240);
      assert.equal(res.y, 100);
      assert.equal(res.height, 100);
    });

    it('manejadores laterales con fromCenter (Alt) escalan simétricamente desde el centro', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initial = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
      // top-center con fromCenter: dy = -20 expande 40px en altura (20 arriba, 20 abajo), centro y = 150 se mantiene
      const res = controller.calculateResizedDimensions(initial, 'top-center', 0, -20, false, true);
      assert.equal(res.height, 140);
      assert.equal(res.y, 80);
      // Centro Y antes: 100 + 50 = 150. Centro Y después: 80 + 70 = 150.
      assert.equal(res.y! + res.height! / 2, 150);
    });

    it('manejadores laterales proyectan delta rotado correctamente', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initial = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
      const res = controller.calculateResizedDimensions(initial, 'bottom-center', 0, 50);
      assert.ok(res.height !== undefined);
    });
  });

  describe('4. Interacción completa de arrastre y Undo/Redo con tiradores laterales', () => {
    it('arrastre interactivo en tirador lateral (top-center) registra ResizeCommand y permite Undo/Redo', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager();
      new InputController(canvas, stateManager, commandManager, { viewportManager });

      const layerId = stateManager.getState().children[0].id;
      const rect: Rectangle = {
        id: 'rect-test-side',
        name: 'Rect Side',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#3b82f6',
        stroke: '#000000',
        strokeWidth: 1,
        opacity: 1,
        rotation: 0,
      };

      stateManager.addNode(layerId, rect);
      stateManager.setSelection(['rect-test-side']);

      // El manejador top-center está en x = 150, y = 100
      // 1. Mouse down en top-center
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 150,
        clientY: 100,
        button: 0,
        shiftKey: false,
        altKey: false,
      });

      // 2. Mouse move arrastrando hacia arriba 30px (y = 70)
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 150,
        clientY: 70,
        button: 0,
        shiftKey: false,
        altKey: false,
      });

      // 3. Mouse up
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 150,
        clientY: 70,
        button: 0,
      });

      const updatedRect = stateManager.findNode('rect-test-side') as Rectangle;
      assert.equal(updatedRect.y, 70);
      assert.equal(updatedRect.height, 130);

      // Undo
      commandManager.undo();
      const reverted = stateManager.findNode('rect-test-side') as Rectangle;
      assert.equal(reverted.y, 100);
      assert.equal(reverted.height, 100);

      // Redo
      commandManager.redo();
      const reapplied = stateManager.findNode('rect-test-side') as Rectangle;
      assert.equal(reapplied.y, 70);
      assert.equal(reapplied.height, 130);
    });

    it('arrastre interactivo en tirador lateral de multi-selección registra TransformShapesCommand y permite Undo/Redo', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager();
      new InputController(canvas, stateManager, commandManager, { viewportManager });

      const layerId = stateManager.getState().children[0].id;
      const rect1: Rectangle = {
        id: 'rect-multi-1',
        name: 'Rect M1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#3b82f6',
        stroke: '#000000',
        strokeWidth: 1,
        opacity: 1,
        rotation: 0,
      };
      const rect2: Rectangle = {
        id: 'rect-multi-2',
        name: 'Rect M2',
        type: 'rectangle',
        x: 250,
        y: 100,
        width: 100,
        height: 100,
        fill: '#10b981',
        stroke: '#000000',
        strokeWidth: 1,
        opacity: 1,
        rotation: 0,
      };

      stateManager.addNode(layerId, rect1);
      stateManager.addNode(layerId, rect2);
      stateManager.setSelection(['rect-multi-1', 'rect-multi-2']);

      // AABB conjunto: minX = 100, minY = 100, maxX = 350, maxY = 200, width = 250, height = 100
      // Manejador right-center está en x = 350, y = 150
      // 1. Mouse down en right-center
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 350,
        clientY: 150,
        button: 0,
        shiftKey: false,
        altKey: false,
      });

      // 2. Mouse move arrastrando hacia la derecha 50px (x = 400)
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 400,
        clientY: 150,
        button: 0,
        shiftKey: false,
        altKey: false,
      });

      // 3. Mouse up
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 400,
        clientY: 150,
        button: 0,
      });

      // Ancho escaló de 250 a 300 (factor 1.2)
      const r1 = stateManager.findNode('rect-multi-1') as Rectangle;
      const r2 = stateManager.findNode('rect-multi-2') as Rectangle;
      assert.equal(r1.width, 120);
      assert.equal(r2.width, 120);

      // Undo
      commandManager.undo();
      const r1Undo = stateManager.findNode('rect-multi-1') as Rectangle;
      const r2Undo = stateManager.findNode('rect-multi-2') as Rectangle;
      assert.equal(r1Undo.width, 100);
      assert.equal(r2Undo.width, 100);

      // Redo
      commandManager.redo();
      const r1Redo = stateManager.findNode('rect-multi-1') as Rectangle;
      assert.equal(r1Redo.width, 120);
    });
  });

  describe('5. RenderEngine dibuja todos los manejadores laterales', () => {
    it('renderSingleShapeSelection dibuja los 8 manejadores de escala más el de rotación', () => {
      const calls: { method: string; args: any[] }[] = [];
      const mockCtx = new Proxy({} as CanvasRenderingContext2D, {
        get(_target, prop: string) {
          return (...args: any[]) => {
            calls.push({ method: prop, args });
            return null;
          };
        },
      });

      const canvas = createMockCanvas(mockCtx);
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;
      const rect: Rectangle = {
        id: 'rect-draw-test',
        name: 'Rect Draw',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#3b82f6',
        stroke: '#000000',
        strokeWidth: 1,
        opacity: 1,
        rotation: 0,
      };

      stateManager.addNode(layerId, rect);
      stateManager.setSelection(['rect-draw-test']);

      const engine = new RenderEngine(canvas, stateManager);
      // Invocar renderSingleShapeSelection(shape, zoom)
      (engine as any).renderSingleShapeSelection(rect, 1);

      // Cada tirador de escala es un strokeRect de 8x8 centrado (args: [x, y, 8, 8])
      const handleStrokes = calls.filter((c) => c.method === 'strokeRect' && c.args[2] === 8 && c.args[3] === 8);
      assert.equal(handleStrokes.length, 8, 'Debe dibujar exactamente 8 tiradores de escala (4 esquinas + 4 laterales)');
    });
  });
});
