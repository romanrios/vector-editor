import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { StateManager } from '../src/state/StateManager.ts';
import { calculateSnapping } from '../src/utils/geometry.ts';
import type { AABB, Rectangle } from '../src/types/scene-graph.ts';

function createCanvas(): HTMLCanvasElement & { dispatch(type: string, event: unknown): void } {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  return {
    width: 800,
    height: 600,
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    getContext: () => null,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = [...(listeners[type] ?? []), listener];
    },
    removeEventListener: () => {},
    dispatch: (type: string, event: unknown) => {
      for (const listener of listeners[type] ?? []) listener(event);
    },
  } as unknown as HTMLCanvasElement & { dispatch(type: string, event: unknown): void };
}

describe('Guías dinámicas de ajuste (snapping)', () => {
  it('calcula correcciones y guías para alinear bordes y centros en ambos ejes', () => {
    const moving: AABB = {
      minX: 10, minY: 10, maxX: 30, maxY: 30, width: 20, height: 20,
    };
    const target: AABB = {
      minX: 33, minY: 7, maxX: 53, maxY: 27, width: 20, height: 20,
    };

    assert.deepEqual(calculateSnapping(moving, [target]), {
      dx: 3,
      dy: -3,
      guides: [
        { axis: 'x', position: 33, start: 7, end: 27 },
        { axis: 'y', position: 7, start: 13, end: 53 },
      ],
    });

    const centeredTarget: AABB = {
      minX: -30, minY: 100, maxX: 70, maxY: 200, width: 100, height: 100,
    };
    assert.deepEqual(calculateSnapping(moving, [centeredTarget]), {
      dx: 0,
      dy: 0,
      guides: [{ axis: 'x', position: 20, start: 10, end: 200 }],
    });
  });

  it('ajusta el arrastre a un objeto visible no seleccionado y limpia las guías al soltar', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const moving: Rectangle = {
      id: 'moving', type: 'rectangle', name: 'Moving',
      x: 50, y: 50, width: 20, height: 20,
    };
    const target: Rectangle = {
      id: 'target', type: 'rectangle', name: 'Target',
      x: 95, y: 50, width: 20, height: 20,
    };
    stateManager.addShape(layerId, moving);
    stateManager.addShape(layerId, target);

    const canvas = createCanvas();
    const controller = new InputController(canvas, stateManager, new CommandManager());
    canvas.dispatch('mousedown', { clientX: 55, clientY: 55, button: 0 });
    canvas.dispatch('mousemove', { clientX: 77, clientY: 57 });

    const moved = stateManager.findNode(moving.id) as Rectangle;
    assert.equal(moved.x, 75);
    assert.equal(moved.y, 50);
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'x' && guide.position === 95));
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'y' && guide.position === 50));

    canvas.dispatch('mouseup', { clientX: 77, clientY: 57, button: 0 });
    assert.deepEqual(controller.activeGuides, []);
    assert.equal((stateManager.findNode(moving.id) as Rectangle).x, 75);
    controller.destroy();
  });

  it('usa los bordes de la mesa de trabajo como objetivos de ajuste', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const moving: Rectangle = {
      id: 'board-edge-moving', type: 'rectangle', name: 'Near artboard edge',
      x: 8, y: 30, width: 20, height: 20,
    };
    stateManager.addShape(layerId, moving);

    const canvas = createCanvas();
    const controller = new InputController(canvas, stateManager, new CommandManager());
    canvas.dispatch('mousedown', { clientX: 9, clientY: 35, button: 0 });
    canvas.dispatch('mousemove', { clientX: 4, clientY: 35 });

    assert.equal((stateManager.findNode(moving.id) as Rectangle).x, 0);
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'x' && guide.position === 0));
    canvas.dispatch('mouseup', { clientX: 4, clientY: 35, button: 0 });
    controller.destroy();
  });

  it('desactivar las guías inteligentes deshabilita el ajuste y limpia las guías activas', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    stateManager.addShape(layerId, {
      id: 'toggle-moving', type: 'rectangle', name: 'Moving',
      x: 50, y: 50, width: 20, height: 20,
    });
    stateManager.addShape(layerId, {
      id: 'toggle-target', type: 'rectangle', name: 'Target',
      x: 95, y: 50, width: 20, height: 20,
    });

    const canvas = createCanvas();
    const controller = new InputController(canvas, stateManager, new CommandManager());
    canvas.dispatch('mousedown', { clientX: 55, clientY: 55, button: 0 });
    canvas.dispatch('mousemove', { clientX: 77, clientY: 57 });
    assert.ok(controller.activeGuides.length > 0);

    controller.setSmartGuidesEnabled(false);
    assert.deepEqual(controller.activeGuides, []);
    canvas.dispatch('mousemove', { clientX: 77, clientY: 57 });
    assert.deepEqual(controller.activeGuides, []);
    assert.equal((stateManager.findNode('toggle-moving') as Rectangle).x, 72);

    canvas.dispatch('mouseup', { clientX: 77, clientY: 57, button: 0 });
    controller.destroy();
  });
});
