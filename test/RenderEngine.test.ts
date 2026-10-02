import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { injectSampleShapes } from '../src/state/injectSampleShapes.ts';

// Mock simple de Canvas y CanvasRenderingContext2D para testing en entorno headless Node
function createMockCanvas(): { canvas: HTMLCanvasElement; calls: string[] } {
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
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    arc: () => calls.push('arc'),
    rect: () => calls.push('rect'),
    roundRect: () => calls.push('roundRect'),
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    setLineDash: () => calls.push('setLineDash'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };

  const mockCanvas = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    getContext: (contextId: string) => {
      if (contextId === '2d') return mockCtx as CanvasRenderingContext2D;
      return null;
    },
  } as unknown as HTMLCanvasElement;

  return { canvas: mockCanvas, calls };
}

describe('RenderEngine - Canvas 2D & isDirty Loop', () => {
  it('inicializa y obtiene el contexto 2D sin errores', () => {
    const { canvas } = createMockCanvas();
    const manager = new StateManager();
    const engine = new RenderEngine(canvas, manager, { highDpi: false });

    assert.equal(engine.renderCount, 0);
  });

  it('ejecuta el renderizado de figuras mediante Canvas 2D', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();
    injectSampleShapes(manager);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.equal(engine.renderCount, 1);
    assert.ok(calls.includes('roundRect') || calls.includes('rect'), 'Debe dibujar rectángulos');
    assert.ok(calls.includes('ellipse'), 'Debe dibujar elipses');
    assert.ok(calls.includes('fill'), 'Debe rellenar figuras');
  });

  it('el bucle solo ejecuta render() cuando el flag isDirty está activo', async () => {
    const { canvas } = createMockCanvas();
    const manager = new StateManager();
    injectSampleShapes(manager);

    // En este punto isDirty es true por las inserciones
    assert.equal(manager.isDirty, true);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });

    // Mockeamos requestAnimationFrame para controlar manualmente los ticks
    let animationCallback: ((time: number) => void) | null = null;
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCAF = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      animationCallback = cb;
      return 101;
    };
    globalThis.cancelAnimationFrame = () => {
      animationCallback = null;
    };

    try {
      engine.start();

      // Tick 1: isDirty = true -> render() se ejecuta y se limpia isDirty
      assert.ok(animationCallback !== null, 'RAF debe haber sido registrado');
      (animationCallback as any)(16.6);

      assert.equal(engine.renderCount, 1);
      assert.equal(manager.isDirty, false);

      // Tick 2: isDirty = false -> NO debe ejecutarse render()
      (animationCallback as any)(33.3);
      assert.equal(engine.renderCount, 1, 'No debe renderizar cuando isDirty es false');

      // Modificamos el estado (añadir nodo) -> isDirty pasa a true
      manager.addShape('layer-default', {
        id: 'new-rect',
        type: 'rectangle',
        name: 'Nuevo Rect',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
      });

      assert.equal(manager.isDirty, true);

      // Tick 3: isDirty = true -> render() se ejecuta de nuevo
      (animationCallback as any)(50.0);
      assert.equal(engine.renderCount, 2, 'Debe renderizar al detectar isDirty = true');
      assert.equal(manager.isDirty, false);

      engine.stop();
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
      globalThis.cancelAnimationFrame = originalCAF;
    }
  });

  it('dibuja la caja delimitadora (bounding box) azul y los 4 manejadores cuando un nodo está seleccionado', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();
    injectSampleShapes(manager);

    // Seleccionar el primer nodo (rectángulo)
    const firstShapeId = manager.getState().children[0].children[0].id;
    manager.selectNode(firstShapeId);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    // Debe haber ejecutado strokeRect (para la bounding box y los 4 manejadores)
    const strokeRectCalls = calls.filter((c) => c === 'strokeRect');
    // 1 para la bounding box + 4 para los 4 manejadores de esquina = 5
    assert.ok(strokeRectCalls.length >= 5, 'Debe dibujar la bounding box y los 4 manejadores con strokeRect');

    const fillRectCalls = calls.filter((c) => c === 'fillRect');
    // Al menos 4 para el relleno de los 4 manejadores (+ 1 si hay fondo)
    assert.ok(fillRectCalls.length >= 4, 'Debe rellenar los 4 manejadores');
  });
});
