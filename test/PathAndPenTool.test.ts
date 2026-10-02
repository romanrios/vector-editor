import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { isPointInPath, getPathAABB } from '../src/utils/geometry.ts';
import type { Path } from '../src/types/scene-graph.ts';

// Mock simple de Canvas para Node.js
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

describe('Primitiva Path, Herramienta Pluma y Hit-Testing No Rectangular', () => {
  it('calcula AABB para un Path considerando puntos y manejadores Bézier', () => {
    const path: Path = {
      id: 'p1',
      type: 'path',
      name: 'Path 1',
      x: 100,
      y: 100,
      points: [
        { x: 100, y: 100, handleOut: { x: 150, y: 50 } },
        { x: 200, y: 100, handleIn: { x: 180, y: 160 } },
      ],
      stroke: '#000',
      strokeWidth: 2,
    };

    const aabb = getPathAABB(path);
    assert.equal(aabb.minX, 100);
    assert.equal(aabb.maxX, 200);
    assert.equal(aabb.minY, 50, 'Debe considerar el handleOut superior en Y: 50');
    assert.equal(aabb.maxY, 160, 'Debe considerar el handleIn inferior en Y: 160');
  });

  it('ejecuta Hit-Testing no rectangular distinguiendo la curva de su AABB vacío', () => {
    // Curva en forma de U que deja el centro superior vacío dentro de su AABB
    const uCurve: Path = {
      id: 'u-curve',
      type: 'path',
      name: 'Curva U',
      x: 100,
      y: 100,
      points: [
        { x: 100, y: 100, handleOut: { x: 100, y: 250 } },
        { x: 300, y: 100, handleIn: { x: 300, y: 250 } },
      ],
      stroke: '#38bdf8',
      strokeWidth: 4,
    };

    // 1. Punto directamente sobre la base inferior de la curva U (~200, 212)
    assert.equal(isPointInPath(200, 212, uCurve), true, 'Punto sobre la curva debe colisionar');

    // 2. Punto en el área cóncava vacía (200, 120):
    // Está DENTRO del AABB rectangular de la curva, pero FUERA del trazado no rectangular
    assert.equal(isPointInPath(200, 120, uCurve), false, 'Punto en la concavidad no debe colisionar');
  });

  it('herramienta Pluma: crea punto de ancla al hacer clic y define manejadores al arrastrar', () => {
    const manager = new StateManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, manager);

    // Activar modo pluma
    controller.setTool('pen');
    assert.equal(controller.currentTool, 'pen');

    // 1. Clic para definir primer punto de ancla en (100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });

    const activePathId = controller.activePenPathId;
    assert.ok(activePathId !== null, 'Debe haber creado un trazado activo');

    let currentPath = manager.findNode(activePathId) as Path;
    assert.equal(currentPath.type, 'path');
    assert.equal(currentPath.points.length, 1);
    assert.equal(currentPath.points[0].x, 100);
    assert.equal(currentPath.points[0].y, 100);

    // 2. Arrastrar a (150, 80) para definir punto de control saliente (handleOut) y simétrico (handleIn)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 80 });

    currentPath = manager.findNode(activePathId) as Path;
    const pt0 = currentPath.points[0];
    assert.deepEqual(pt0.handleOut, { x: 150, y: 80 });
    // handleIn simétrico: 2 * 100 - 150 = 50, 2 * 100 - 80 = 120
    assert.deepEqual(pt0.handleIn, { x: 50, y: 120 });

    // 3. Soltar mouse (mouseup)
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 80 });

    // 4. Clic para agregar segundo punto de ancla en (250, 200)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 250, clientY: 200 });
    // Arrastrar a (280, 220)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 280, clientY: 220 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 280, clientY: 220 });

    currentPath = manager.findNode(activePathId) as Path;
    assert.equal(currentPath.points.length, 2, 'Debe contener 2 puntos de ancla');
    assert.equal(currentPath.points[1].x, 250);
    assert.equal(currentPath.points[1].y, 200);

    // Finalizar el trazado
    controller.finishActivePath();
    assert.equal(controller.activePenPathId, null);

    controller.destroy();
  });

  it('RenderEngine invoca bezierCurveTo al renderizar un nodo Path', () => {
    const manager = new StateManager();
    const canvas = createMockCanvas();

    const sampleBezierPath: Path = {
      id: 'test-bezier-path',
      type: 'path',
      name: 'Test Path',
      x: 50,
      y: 50,
      points: [
        { x: 50, y: 50, handleOut: { x: 80, y: 30 } },
        { x: 150, y: 50, handleIn: { x: 120, y: 70 } },
      ],
      stroke: '#38bdf8',
      strokeWidth: 2,
    };

    manager.addShape(manager.getState().children[0].id, sampleBezierPath);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.ok(canvas.calls.includes('bezierCurveTo'), 'RenderEngine debe usar bezierCurveTo para nodos Path');
    assert.ok(canvas.calls.includes('stroke'), 'RenderEngine debe aplicar trazo al Path');
  });

  it('RenderEngine aplica rotación al renderizar un nodo Path con rotation', () => {
    const manager = new StateManager();
    const canvas = createMockCanvas();

    const rotatedPath: Path = {
      id: 'rotated-path-render',
      type: 'path',
      name: 'Rotated Path',
      x: 100,
      y: 100,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      rotation: 45,
      stroke: '#38bdf8',
      strokeWidth: 2,
    };

    manager.addShape(manager.getState().children[0].id, rotatedPath);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.ok(canvas.calls.includes('rotate'), 'Debe invocar rotate en el contexto cuando el Path tiene rotation');
    assert.ok(canvas.calls.includes('translate'), 'Debe invocar translate para centrar la rotación');
  });

  it('getPathAABB calcula el AABB considerando la rotación del Path', () => {
    // Línea horizontal de (100, 150) a (200, 150), rotada 90 grados alrededor de su centro (150, 150)
    // Tras rotar 90 grados, pasa a ser una línea vertical de (150, 100) a (150, 200)
    const horizontalLine: Path = {
      id: 'rot-line',
      type: 'path',
      name: 'Rotated Line',
      x: 100,
      y: 150,
      points: [
        { x: 100, y: 150 },
        { x: 200, y: 150 },
      ],
      rotation: 90,
    };

    const aabb = getPathAABB(horizontalLine);
    assert.ok(Math.abs(aabb.minX - 150) < 1e-4, 'minX debe ser ~150');
    assert.ok(Math.abs(aabb.maxX - 150) < 1e-4, 'maxX debe ser ~150');
    assert.ok(Math.abs(aabb.minY - 100) < 1e-4, 'minY debe ser ~100');
    assert.ok(Math.abs(aabb.maxY - 200) < 1e-4, 'maxY debe ser ~200');
  });

  it('isPointInPath detecta colisiones sobre un trazado rotado', () => {
    // Línea horizontal de (100, 150) a (200, 150) rotada 90 grados -> pasa a ser vertical en X=150, de Y=100 a Y=200
    const rotatedLine: Path = {
      id: 'rot-hit-test',
      type: 'path',
      name: 'Rotated Hit Test',
      x: 100,
      y: 150,
      points: [
        { x: 100, y: 150 },
        { x: 200, y: 150 },
      ],
      rotation: 90,
      stroke: '#000',
      strokeWidth: 4,
    };

    // Un punto en (150, 150) está sobre la línea rotada
    assert.equal(isPointInPath(150, 150, rotatedLine), true);

    // Un punto en (150, 180) está sobre la línea rotada
    assert.equal(isPointInPath(150, 180, rotatedLine), true);

    // Un punto en (120, 150) estaba sobre la línea original NO rotada, pero NO sobre la rotada
    assert.equal(isPointInPath(120, 150, rotatedLine), false);
  });
});
