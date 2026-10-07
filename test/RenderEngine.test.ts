import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { injectSampleShapes } from '../src/state/injectSampleShapes.ts';
import type { Rectangle, Text } from '../src/types/scene-graph.ts';
import { ViewportManager } from '../src/utils/viewport.ts';

export interface TextCallSnapshot {
  text: string;
  x: number;
  y: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: string;
  globalAlpha: number;
}

// Mock de Canvas y CanvasRenderingContext2D para testing en entorno headless Node
function createMockCanvas(): {
  canvas: HTMLCanvasElement;
  calls: string[];
  textCalls: TextCallSnapshot[];
  transforms: Array<{ a: number; b: number; c: number; d: number; e: number; f: number }>;
  rotations: number[];
  translations: Array<{ x: number; y: number }>;
} {
  const calls: string[] = [];
  const textCalls: TextCallSnapshot[] = [];
  const transforms: Array<{ a: number; b: number; c: number; d: number; e: number; f: number }> = [];
  const rotations: number[] = [];
  const translations: Array<{ x: number; y: number }> = [];

  const stateStack: Array<{
    font: string;
    textAlign: string;
    textBaseline: string;
    fillStyle: string;
    globalAlpha: number;
  }> = [];

  const state = {
    font: '10px sans-serif',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '#000000' as string | CanvasGradient | CanvasPattern,
    strokeStyle: '#000000' as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    globalAlpha: 1,
  };

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => {
      calls.push('save');
      stateStack.push({
        font: state.font,
        textAlign: state.textAlign,
        textBaseline: state.textBaseline,
        fillStyle: String(state.fillStyle),
        globalAlpha: state.globalAlpha,
      });
    },
    restore: () => {
      calls.push('restore');
      const popped = stateStack.pop();
      if (popped) {
        state.font = popped.font;
        state.textAlign = popped.textAlign as CanvasTextAlign;
        state.textBaseline = popped.textBaseline as CanvasTextBaseline;
        state.fillStyle = popped.fillStyle;
        state.globalAlpha = popped.globalAlpha;
      }
    },
    setTransform: (a?: any, b?: any, c?: any, d?: any, e?: any, f?: any) => {
      calls.push('setTransform');
      if (typeof a === 'number') {
        transforms.push({ a, b, c, d, e, f });
      }
    },
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
    translate: (x: number, y: number) => {
      calls.push('translate');
      translations.push({ x, y });
    },
    rotate: (angle: number) => {
      calls.push('rotate');
      rotations.push(angle);
    },
    setLineDash: () => calls.push('setLineDash'),
    fillText: (text: string, x: number, y: number) => {
      calls.push('fillText');
      textCalls.push({
        text,
        x,
        y,
        font: state.font,
        textAlign: state.textAlign,
        textBaseline: state.textBaseline,
        fillStyle: String(state.fillStyle),
        globalAlpha: state.globalAlpha,
      });
    },
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(v: CanvasTextAlign) {
      state.textAlign = v;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(v: CanvasTextBaseline) {
      state.textBaseline = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
    },
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

  return { canvas: mockCanvas, calls, textCalls, transforms, rotations, translations };
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

  it('dibuja la vista previa con trazo punteado cuando es marquee', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();
    const engine = new RenderEngine(canvas, manager, {
      highDpi: false,
      previewProvider: () => ({
        type: 'marquee',
        x: 10,
        y: 10,
        width: 100,
        height: 80,
      }),
    });

    engine.render();

    assert.equal(calls.includes('setLineDash'), true, 'Marquee debe configurar trazo punteado mediante setLineDash');
    assert.equal(calls.includes('rect'), true);
    assert.equal(calls.includes('stroke'), true);
    assert.equal(calls.includes('fill'), true);
  });

  it('dibuja la vista previa de rectangle con estilo real y línea sólida (sin setLineDash)', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();
    const engine = new RenderEngine(canvas, manager, {
      highDpi: false,
      previewProvider: () => ({
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 80,
        fill: '#38bdf8',
        stroke: '#0284c7',
        strokeWidth: 2,
        opacity: 1,
      }),
    });

    engine.render();

    assert.equal(calls.includes('setLineDash'), false, 'No debe usar setLineDash en figuras no-marquee');
    assert.equal(calls.includes('rect'), true, 'Debe dibujar el rectángulo de vista previa');
    assert.equal(calls.includes('stroke'), true, 'Debe aplicar stroke');
    assert.equal(calls.includes('fill'), true, 'Debe aplicar fill');
  });

  it('con "none" en fill, no se invoca fill en la vista previa', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();
    const engine = new RenderEngine(canvas, manager, {
      highDpi: false,
      previewProvider: () => ({
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 80,
        fill: 'none',
        stroke: '#0284c7',
        strokeWidth: 2,
        opacity: 1,
      }),
    });

    engine.render();

    assert.equal(calls.includes('fill'), false, 'No debe invocar fill cuando fill es "none"');
    assert.equal(calls.includes('stroke'), true, 'Debe aplicar stroke si tiene borde');
  });
});

describe('RenderEngine - Renderizado de nodos Text', () => {
  it('renderiza un nodo Text con propiedades básicas y valores por defecto', () => {
    const { canvas, calls, textCalls } = createMockCanvas();
    const manager = new StateManager();
    const textNode: Text = {
      id: 'text-1',
      type: 'text',
      name: 'Texto 1',
      x: 120,
      y: 250,
      text: 'Hola Mundo',
    };
    manager.addShape('layer-default', textNode);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.equal(engine.renderCount, 1);
    assert.ok(calls.includes('fillText'), 'Debe invocar fillText para el nodo Text');
    assert.equal(textCalls.length, 1);
    assert.equal(textCalls[0].text, 'Hola Mundo');
    assert.equal(textCalls[0].x, 120);
    assert.equal(textCalls[0].y, 250);
    assert.equal(textCalls[0].font, '16px sans-serif');
    assert.equal(textCalls[0].textAlign, 'left');
    assert.equal(textCalls[0].textBaseline, 'top');
    assert.equal(textCalls[0].fillStyle, '#000000');
    assert.equal(textCalls[0].globalAlpha, 1);
  });

  it('renderiza un nodo Text con tipografía y estilo personalizados', () => {
    const { canvas, textCalls } = createMockCanvas();
    const manager = new StateManager();
    const textNode: Text = {
      id: 'text-styled',
      type: 'text',
      name: 'Texto Estilizado',
      x: 50,
      y: 80,
      text: 'Tipografía Personalizada',
      fontFamily: 'Inter',
      fontSize: 28,
      fontWeight: 'bold',
      fontStyle: 'italic',
      textAlign: 'center',
      fill: '#38bdf8',
    };
    manager.addShape('layer-default', textNode);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.equal(textCalls.length, 1);
    assert.equal(textCalls[0].text, 'Tipografía Personalizada');
    assert.equal(textCalls[0].x, 50);
    assert.equal(textCalls[0].y, 80);
    assert.equal(textCalls[0].font, 'italic bold 28px Inter');
    assert.equal(textCalls[0].textAlign, 'center');
    assert.equal(textCalls[0].textBaseline, 'top');
    assert.equal(textCalls[0].fillStyle, '#38bdf8');
  });

  it('respeta las distintas opciones de textAlign (left, center, right)', () => {
    const { canvas, textCalls } = createMockCanvas();
    const manager = new StateManager();

    const tLeft: Text = { id: 't-l', type: 'text', name: 'TL', x: 10, y: 10, text: 'L', textAlign: 'left' };
    const tCenter: Text = { id: 't-c', type: 'text', name: 'TC', x: 20, y: 20, text: 'C', textAlign: 'center' };
    const tRight: Text = { id: 't-r', type: 'text', name: 'TR', x: 30, y: 30, text: 'R', textAlign: 'right' };

    manager.addShape('layer-default', tLeft);
    manager.addShape('layer-default', tCenter);
    manager.addShape('layer-default', tRight);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.equal(textCalls.length, 3);
    assert.equal(textCalls[0].textAlign, 'left');
    assert.equal(textCalls[1].textAlign, 'center');
    assert.equal(textCalls[2].textAlign, 'right');
  });

  it('aplica rotación centrada en (x, y) cuando el nodo Text tiene rotation', () => {
    const { canvas, calls, rotations, translations, textCalls } = createMockCanvas();
    const manager = new StateManager();

    const textNode: Text = {
      id: 't-rot',
      type: 'text',
      name: 'Rotado',
      x: 150,
      y: 200,
      text: 'Texto Rotado',
      rotation: 45,
    };
    manager.addShape('layer-default', textNode);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.ok(calls.includes('rotate'), 'Debe llamar a rotate()');
    assert.ok(calls.includes('translate'), 'Debe llamar a translate()');
    assert.ok(rotations.length >= 1);
    assert.equal(rotations[0], (45 * Math.PI) / 180);

    const matchingTranslateTo = translations.find((t) => t.x === 150 && t.y === 200);
    const matchingTranslateBack = translations.find((t) => t.x === -150 && t.y === -200);
    assert.ok(matchingTranslateTo !== undefined, 'Debe trasladar al punto (x, y)');
    assert.ok(matchingTranslateBack !== undefined, 'Debe trasladar de regreso a (-x, -y)');

    assert.equal(textCalls.length, 1);
    assert.equal(textCalls[0].x, 150);
    assert.equal(textCalls[0].y, 200);
  });

  it('respeta la opacidad especificada en el nodo Text', () => {
    const { canvas, textCalls } = createMockCanvas();
    const manager = new StateManager();

    const textNode: Text = {
      id: 't-alpha',
      type: 'text',
      name: 'Alfa',
      x: 100,
      y: 100,
      text: 'Semi transparente',
      opacity: 0.6,
    };
    manager.addShape('layer-default', textNode);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.equal(textCalls.length, 1);
    assert.equal(Math.round(textCalls[0].globalAlpha * 10) / 10, 0.6);
  });

  it('no invoca fillText cuando fill es "none" o "transparent"', () => {
    const { canvas, calls, textCalls } = createMockCanvas();
    const manager = new StateManager();

    const textNone: Text = {
      id: 't-none',
      type: 'text',
      name: 'Sin relleno',
      x: 50,
      y: 50,
      text: 'Invisible',
      fill: 'none',
    };
    const textTrans: Text = {
      id: 't-trans',
      type: 'text',
      name: 'Transparente',
      x: 70,
      y: 70,
      text: 'Transparente',
      fill: 'transparent',
    };

    manager.addShape('layer-default', textNone);
    manager.addShape('layer-default', textTrans);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    assert.equal(calls.includes('fillText'), false, 'No debe invocar fillText con fill="none" o "transparent"');
    assert.equal(textCalls.length, 0);
  });

  it('aísla el estado tipográfico y de transformación mediante save() y restore()', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();

    const textNode: Text = {
      id: 't-iso',
      type: 'text',
      name: 'Texto Aislado',
      x: 10,
      y: 10,
      text: 'Aislado',
      fontFamily: 'Inter',
      fontSize: 30,
      fill: '#ff00ff',
      rotation: 30,
    };
    const rectNode: Rectangle = {
      id: 'r-iso',
      type: 'rectangle',
      name: 'Rect Siguiente',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      fill: '#00ff00',
    };

    manager.addShape('layer-default', textNode);
    manager.addShape('layer-default', rectNode);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    const saveCount = calls.filter((c) => c === 'save').length;
    const restoreCount = calls.filter((c) => c === 'restore').length;
    assert.equal(saveCount, restoreCount, 'La cantidad de save() y restore() debe estar balanceada');
  });

  it('respeta las transformaciones de Viewport (zoom y pan) y devicePixelRatio', () => {
    const { canvas, transforms, textCalls } = createMockCanvas();
    const manager = new StateManager();
    const viewportManager = new ViewportManager({ zoom: 2, panX: 100, panY: 50 });

    const textNode: Text = {
      id: 't-vp',
      type: 'text',
      name: 'Texto Viewport',
      x: 40,
      y: 60,
      text: 'En Viewport',
    };
    manager.addShape('layer-default', textNode);

    const engine = new RenderEngine(canvas, manager, {
      highDpi: false,
      viewportManager,
    });
    engine.render();

    const matchingTransform = transforms.find(
      (t) => t.a === 2 && t.b === 0 && t.c === 0 && t.d === 2 && t.e === 100 && t.f === 50
    );
    assert.ok(matchingTransform !== undefined, 'setTransform debe configurarse con zoom 2 y pan (100, 50)');

    assert.equal(textCalls.length, 1);
    assert.equal(textCalls[0].text, 'En Viewport');
    assert.equal(textCalls[0].x, 40);
    assert.equal(textCalls[0].y, 60);
  });
});

