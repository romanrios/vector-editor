import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { StateManager } from '../src/state/StateManager.ts';
import {
  calculateAnchoredSnapping,
  calculateSnapping,
  getSelectionBounds,
  getSelectionBoxHandles,
  getSelectionHandles,
} from '../src/utils/geometry.ts';
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

    it('al escalar considera otros puntos alineables si el punto fijo ya coincide y ajusta ambos ejes', () => {
      const moving: AABB = {
        minX: 10, minY: 20, maxX: 110, maxY: 120, width: 100, height: 100,
      };
      const target: AABB = {
        minX: 10, minY: 20, maxX: 113, maxY: 124, width: 103, height: 104,
      };

      const result = calculateAnchoredSnapping(moving, [target], 0, 0, 5);
      assert.equal(result.dx, 3);
      assert.equal(result.dy, 4);
      assert.deepEqual(result.guides.map((guide) => guide.axis), ['x', 'y']);
      assert.deepEqual(result.guides[0], {
        axis: 'x', position: 61.5, start: 20, end: 124,
      });
      assert.deepEqual(result.guides[1], {
        axis: 'y', position: 72, start: 10, end: 113,
      });
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

  it('ajusta la vista previa y la forma creada a los objetos cercanos', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    stateManager.addShape(layerId, {
      id: 'creation-target', type: 'rectangle', name: 'Target',
      x: 100, y: 100, width: 20, height: 20,
    });

    const canvas = createCanvas();
    const controller = new InputController(canvas, stateManager, new CommandManager());
    controller.setTool('rectangle');
    canvas.dispatch('mousedown', { clientX: 40, clientY: 40, button: 0 });
    canvas.dispatch('mousemove', { clientX: 98, clientY: 98 });

    assert.equal(controller.shapePreview?.width, 60);
    assert.equal(controller.shapePreview?.height, 60);
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'x' && guide.position === 100));
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'y' && guide.position === 100));

    canvas.dispatch('mouseup', { clientX: 98, clientY: 98, button: 0 });
    const created = stateManager.getState().children[0].children.find(
      (node) => node.id !== 'creation-target'
    ) as Rectangle;
    assert.equal(created.width, 60);
    assert.equal(created.height, 60);
    assert.deepEqual(controller.activeGuides, []);
    controller.destroy();
  });

  it('crea y escala en ambos ejes aunque el borde fijo ya esté alineado a la mesa de trabajo', () => {
    const creationState = new StateManager();
    const creationLayerId = creationState.getState().children[0].id;
    creationState.addShape(creationLayerId, {
      id: 'corner-target-create', type: 'rectangle', name: 'Target',
      x: 103, y: 103, width: 30, height: 30,
    });
    const creationCanvas = createCanvas();
    const creationController = new InputController(
      creationCanvas,
      creationState,
      new CommandManager()
    );
    creationController.setTool('rectangle');
    creationCanvas.dispatch('mousedown', { clientX: 0, clientY: 0, button: 0 });
    creationCanvas.dispatch('mousemove', { clientX: 101, clientY: 101 });
    assert.equal(creationController.shapePreview?.width, 103);
    assert.equal(creationController.shapePreview?.height, 103);
    assert.deepEqual(creationController.activeGuides.map((guide) => guide.axis), ['x', 'y']);
    creationCanvas.dispatch('mouseup', { clientX: 101, clientY: 101, button: 0 });
    creationController.destroy();

    const resizeState = new StateManager();
    const resizeLayerId = resizeState.getState().children[0].id;
    const moving: Rectangle = {
      id: 'corner-moving', type: 'rectangle', name: 'Moving',
      x: 0, y: 0, width: 100, height: 100,
    };
    resizeState.addShape(resizeLayerId, moving);
    resizeState.addShape(resizeLayerId, {
      id: 'corner-target-resize', type: 'rectangle', name: 'Target',
      x: 103, y: 103, width: 30, height: 30,
    });
    resizeState.selectNode(moving.id);
    const resizeCanvas = createCanvas();
    const resizeController = new InputController(resizeCanvas, resizeState, new CommandManager());
    const bottomRight = getSelectionHandles(moving, 8, 30).find(
      (handle) => handle.type === 'bottom-right'
    )!;
    resizeCanvas.dispatch('mousedown', {
      clientX: (bottomRight.minX + bottomRight.maxX) / 2,
      clientY: (bottomRight.minY + bottomRight.maxY) / 2,
      button: 0,
    });
    resizeCanvas.dispatch('mousemove', { clientX: 101, clientY: 101 });
    const resized = resizeState.findNode(moving.id) as Rectangle;
    assert.equal(resized.width, 103);
    assert.equal(resized.height, 103);
    assert.deepEqual(resizeController.activeGuides.map((guide) => guide.axis), ['x', 'y']);
    resizeCanvas.dispatch('mouseup', { clientX: 101, clientY: 101, button: 0 });
    resizeController.destroy();
  });

  it('corrige el doble del delta cuando se ajusta el centro durante creación o escalado', () => {
    const createState = new StateManager();
    const createLayerId = createState.getState().children[0].id;
    createState.addShape(createLayerId, {
      id: 'center-create-target', type: 'rectangle', name: 'Center target',
      x: 60, y: 100, width: 20, height: 20,
    });
    const creationCanvas = createCanvas();
    const createController = new InputController(creationCanvas, createState, new CommandManager());
    createController.setTool('rectangle');
    creationCanvas.dispatch('mousedown', { clientX: 40, clientY: 40, button: 0 });
    creationCanvas.dispatch('mousemove', { clientX: 98, clientY: 98 });
    assert.equal(createController.shapePreview?.x! + createController.shapePreview?.width! / 2, 70);
    creationCanvas.dispatch('mouseup', { clientX: 98, clientY: 98, button: 0 });
    const created = createState.getState().children[0].children.find(
      (node) => node.id !== 'center-create-target'
    ) as Rectangle;
    assert.equal(created.x + created.width / 2, 70);
    createController.destroy();

    const resizeState = new StateManager();
    const resizeLayerId = resizeState.getState().children[0].id;
    const moving: Rectangle = {
      id: 'center-resize-moving', type: 'rectangle', name: 'Moving',
      x: 50, y: 50, width: 20, height: 20,
    };
    resizeState.addShape(resizeLayerId, moving);
    resizeState.addShape(resizeLayerId, {
      id: 'center-resize-target', type: 'rectangle', name: 'Center target',
      x: 65, y: 50, width: 20, height: 20,
    });
    resizeState.selectNode(moving.id);
    const resizeCanvas = createCanvas();
    const resizeController = new InputController(resizeCanvas, resizeState, new CommandManager());
    const bottomRight = getSelectionHandles(moving, 8, 30).find(
      (handle) => handle.type === 'bottom-right'
    )!;
    const handleX = (bottomRight.minX + bottomRight.maxX) / 2;
    const handleY = (bottomRight.minY + bottomRight.maxY) / 2;
    resizeCanvas.dispatch('mousedown', { clientX: handleX, clientY: handleY, button: 0 });
    resizeCanvas.dispatch('mousemove', { clientX: 98, clientY: handleY });
    const resized = resizeState.findNode(moving.id) as Rectangle;
    assert.equal(resized.x + resized.width / 2, 75);
    resizeCanvas.dispatch('mouseup', { clientX: 98, clientY: handleY, button: 0 });
    resizeController.destroy();
  });

  it('ajusta el borde redimensionado a un objeto cercano y confirma el tamaño ajustado', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const moving: Rectangle = {
      id: 'resize-moving', type: 'rectangle', name: 'Moving',
      x: 50, y: 50, width: 20, height: 20,
    };
    stateManager.addShape(layerId, moving);
    stateManager.addShape(layerId, {
      id: 'resize-target', type: 'rectangle', name: 'Target',
      x: 100, y: 50, width: 20, height: 20,
    });
    stateManager.selectNode(moving.id);

    const canvas = createCanvas();
    const controller = new InputController(canvas, stateManager, new CommandManager());
    const bottomRight = getSelectionHandles(moving, 8, 30).find(
      (handle) => handle.type === 'bottom-right'
    )!;
    const handleX = (bottomRight.minX + bottomRight.maxX) / 2;
    const handleY = (bottomRight.minY + bottomRight.maxY) / 2;

    canvas.dispatch('mousedown', { clientX: handleX, clientY: handleY, button: 0 });
    canvas.dispatch('mousemove', { clientX: 98, clientY: handleY });
    assert.equal((stateManager.findNode(moving.id) as Rectangle).width, 50);
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'x' && guide.position === 100));

    canvas.dispatch('mouseup', { clientX: 98, clientY: handleY, button: 0 });
    assert.equal((stateManager.findNode(moving.id) as Rectangle).width, 50);
    assert.deepEqual(controller.activeGuides, []);
    controller.destroy();
  });

  it('ajusta el borde de una multiselección mientras se escala', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;
    const first: Rectangle = {
      id: 'scale-first', type: 'rectangle', name: 'First',
      x: 50, y: 50, width: 20, height: 20,
    };
    const second: Rectangle = {
      id: 'scale-second', type: 'rectangle', name: 'Second',
      x: 80, y: 50, width: 20, height: 20,
    };
    stateManager.addShape(layerId, first);
    stateManager.addShape(layerId, second);
    stateManager.setSelection([first.id, second.id]);
    stateManager.addShape(layerId, {
      id: 'scale-target', type: 'rectangle', name: 'Target',
      x: 150, y: 100, width: 20, height: 20,
    });

    const canvas = createCanvas();
    const controller = new InputController(canvas, stateManager, new CommandManager());
    const bounds = getSelectionBounds(stateManager.getSelectedNodes())!;
    const bottomRight = getSelectionBoxHandles(bounds, 8, 30).find(
      (handle) => handle.type === 'bottom-right'
    )!;
    const handleX = (bottomRight.minX + bottomRight.maxX) / 2;
    const handleY = (bottomRight.minY + bottomRight.maxY) / 2;

    canvas.dispatch('mousedown', { clientX: handleX, clientY: handleY, button: 0 });
    canvas.dispatch('mousemove', { clientX: 148, clientY: 98 });

    const scaledBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
    assert.equal(scaledBounds.maxX, 150);
    assert.equal(scaledBounds.maxY, 100);
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'x' && guide.position === 150));
    assert.ok(controller.activeGuides.some((guide) => guide.axis === 'y' && guide.position === 100));

    canvas.dispatch('mouseup', { clientX: 148, clientY: 98, button: 0 });
    assert.deepEqual(controller.activeGuides, []);
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
