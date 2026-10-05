import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { translatePathAnchors } from '../src/utils/geometry.ts';
import type { Path, PathPoint } from '../src/types/scene-graph.ts';

// Mock simple de Canvas para Node.js (de test/PathAndPenTool.test.ts)
function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void; calls: string[] } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const calls: string[] = [];

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setTransform: () => calls.push('setTransform'),
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    bezierCurveTo: () => calls.push('bezierCurveTo'),
    closePath: () => calls.push('closePath'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    rect: () => calls.push('rect'),
    roundRect: () => calls.push('roundRect'),
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    arc: () => calls.push('arc'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    setLineDash: () => calls.push('setLineDash'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };

  return {
    style: { cursor: 'default' },
    width: 1000,
    height: 800,
    calls,
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
    getContext: (id: string) => (id === '2d' ? (mockCtx as CanvasRenderingContext2D) : null),
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
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void; calls: string[] };
}

describe('DirectSelect & translatePathAnchors', () => {
  describe('a) Unit tests de translatePathAnchors', () => {
    it('desplaza ancla con ambos handles', () => {
      const points: PathPoint[] = [
        { x: 10, y: 20, handleIn: { x: 5, y: 15 }, handleOut: { x: 15, y: 25 } },
      ];
      const result = translatePathAnchors(points, new Set([0]), 20, 10);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], {
        x: 30,
        y: 30,
        handleIn: { x: 25, y: 25 },
        handleOut: { x: 35, y: 35 },
      });
      // Comprueba inmutabilidad de la entrada
      assert.equal(points[0].x, 10);
      assert.equal(points[0].y, 20);
      assert.deepEqual(points[0].handleIn, { x: 5, y: 15 });
      assert.deepEqual(points[0].handleOut, { x: 15, y: 25 });
    });

    it('desplaza ancla sin handles', () => {
      const points: PathPoint[] = [{ x: 50, y: 60 }];
      const result = translatePathAnchors(points, new Set([0]), -10, 15);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], { x: 40, y: 75 });
      assert.equal(result[0].handleIn, undefined);
      assert.equal(result[0].handleOut, undefined);
      // Entrada sin cambios
      assert.equal(points[0].x, 50);
      assert.equal(points[0].y, 60);
    });

    it('índice no incluido queda intacto con la misma referencia', () => {
      const pt0: PathPoint = { x: 10, y: 20, handleIn: { x: 5, y: 15 }, handleOut: { x: 15, y: 25 } };
      const pt1: PathPoint = { x: 100, y: 200, handleIn: { x: 80, y: 190 }, handleOut: { x: 120, y: 210 } };
      const points: PathPoint[] = [pt0, pt1];

      const result = translatePathAnchors(points, new Set([0]), 15, -5);

      assert.equal(result.length, 2);
      assert.notEqual(result[0], pt0);
      assert.equal(result[0].x, 25);
      assert.equal(result[0].y, 15);
      // pt1 no fue seleccionado, debe conservar exactamente la misma referencia
      assert.equal(result[1], pt1);
    });
  });

  describe('b) Integración: arrastre de ancla con direct-select y undo', () => {
    it('desplaza ancla, handleIn y handleOut por (+20, +10) y un solo undo restaura todo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-direct-select-test',
        type: 'path',
        name: 'Direct Select Test Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleIn: { x: 80, y: 90 }, handleOut: { x: 120, y: 110 } },
          { x: 200, y: 200, handleIn: { x: 180, y: 200 }, handleOut: { x: 220, y: 200 } },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');

      stateManager.selectNode('path-direct-select-test');

      // 1. Mousedown sobre el ancla 0 en (100, 100)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
      assert.equal(controller.draggedPointIndex, 0);
      assert.equal(controller.dragTarget?.type, 'anchor');

      // 2. Mousemove +20, +10 -> (120, 110)
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 110 });

      // 3. Mouseup en (120, 110)
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 120, clientY: 110 });

      // Verifica que x, y, handleIn y handleOut se desplazaron +20, +10
      const updatedPath = stateManager.findNode('path-direct-select-test') as Path;
      assert.equal(updatedPath.points[0].x, 120);
      assert.equal(updatedPath.points[0].y, 110);
      assert.deepEqual(updatedPath.points[0].handleIn, { x: 100, y: 100 });
      assert.deepEqual(updatedPath.points[0].handleOut, { x: 140, y: 120 });

      // El punto 1 no debe haberse modificado
      assert.deepEqual(updatedPath.points[1], path.points[1]);

      // Verifica que UN solo undo restaura todo
      assert.equal(commandManager.canUndo(), true);
      commandManager.undo();

      const restoredPath = stateManager.findNode('path-direct-select-test') as Path;
      assert.equal(restoredPath.points[0].x, 100);
      assert.equal(restoredPath.points[0].y, 100);
      assert.deepEqual(restoredPath.points[0].handleIn, { x: 80, y: 90 });
      assert.deepEqual(restoredPath.points[0].handleOut, { x: 120, y: 110 });

      controller.destroy();
    });
  });
});
