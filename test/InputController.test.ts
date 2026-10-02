import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { getShapeAABB, isPointInAABB } from '../src/utils/geometry.ts';
import type { Rectangle, Ellipse } from '../src/types/scene-graph.ts';

// Helper para mock de Canvas con eventos en Node.js
function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    style: { cursor: 'default' },
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
    getContext: () => null,
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    // Método auxiliar para disparar eventos simulados
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('InputController & Hit-testing AABB', () => {
  it('calcula AABB y colisión de punto correctamente para Rectangle y Ellipse', () => {
    const rect: Rectangle = {
      id: 'r1',
      type: 'rectangle',
      name: 'Rect',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    };

    const rectAABB = getShapeAABB(rect);
    assert.equal(rectAABB.minX, 100);
    assert.equal(rectAABB.maxX, 300);
    assert.equal(rectAABB.minY, 100);
    assert.equal(rectAABB.maxY, 200);

    assert.equal(isPointInAABB(150, 150, rectAABB), true);
    assert.equal(isPointInAABB(50, 50, rectAABB), false);

    const ellipse: Ellipse = {
      id: 'e1',
      type: 'ellipse',
      name: 'Ellipse',
      x: 300,
      y: 300,
      radiusX: 50,
      radiusY: 30,
    };

    const ellipseAABB = getShapeAABB(ellipse);
    assert.equal(ellipseAABB.minX, 250);
    assert.equal(ellipseAABB.maxX, 350);
    assert.equal(ellipseAABB.minY, 270);
    assert.equal(ellipseAABB.maxY, 330);

    assert.equal(isPointInAABB(300, 300, ellipseAABB), true);
    assert.equal(isPointInAABB(400, 400, ellipseAABB), false);
  });

  it('respeta el Z-index visual realizando hit-testing en orden inverso', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    // Dos rectángulos que se superponen completamente
    const shapeBottom: Rectangle = {
      id: 'shape-bottom',
      type: 'rectangle',
      name: 'Fondo',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    };

    const shapeTop: Rectangle = {
      id: 'shape-top',
      type: 'rectangle',
      name: 'Frente',
      x: 150,
      y: 150,
      width: 100,
      height: 100,
    };

    manager.addNode(layerId, shapeBottom);
    manager.addNode(layerId, shapeTop);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, manager);

    // Punto (160, 160) está dentro de AMBOS rectángulos.
    // El hit-test inverso debe retornar shapeTop (el de mayor Z-index).
    const hit = controller.hitTest(160, 160);
    assert.ok(hit !== null);
    assert.equal(hit.id, 'shape-top');

    // Punto (110, 110) solo está dentro de shapeBottom.
    const hitBottom = controller.hitTest(110, 110);
    assert.ok(hitBottom !== null);
    assert.equal(hitBottom.id, 'shape-bottom');
  });

  it('actualiza el estado marcando el nodo seleccionado con mousedown', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'target-shape',
      type: 'rectangle',
      name: 'Target',
      x: 200,
      y: 200,
      width: 150,
      height: 100,
    };

    manager.addNode(layerId, rect);

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, manager);

    // Simular mousedown sobre la figura (220, 220)
    canvas.dispatchSimulatedEvent('mousedown', {
      clientX: 220,
      clientY: 220,
    });

    const selected = manager.getSelectedNode();
    assert.ok(selected !== null);
    assert.equal(selected.id, 'target-shape');
    assert.equal(selected.selected, true);

    // Simular mousedown en espacio vacío (50, 50) -> deselecciona
    canvas.dispatchSimulatedEvent('mousedown', {
      clientX: 50,
      clientY: 50,
    });

    assert.equal(manager.getSelectedNode(), null);
    controller.destroy();
  });

  it('actualiza el estilo del cursor en mousemove cuando sobrevuela una figura', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'hover-shape',
      type: 'rectangle',
      name: 'Hover Shape',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };

    manager.addNode(layerId, rect);

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, manager);

    // Mover sobre la figura
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 120 });
    assert.equal(canvas.style.cursor, 'pointer');
    assert.equal(controller.hoveredShapeId, 'hover-shape');

    // Mover fuera de la figura
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 300, clientY: 300 });
    assert.equal(canvas.style.cursor, 'default');
    assert.equal(controller.hoveredShapeId, null);

    controller.destroy();
  });
});
