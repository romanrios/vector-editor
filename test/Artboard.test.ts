import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import type { Rectangle, Document } from '../src/types/scene-graph.ts';

// Helper mock para Canvas y CanvasRenderingContext2D
function createMockCanvas(width: number = 800, height: number = 600) {
  const calls: { method: string; args?: any[] }[] = [];
  const fillRects: { x: number; y: number; w: number; h: number; fillStyle: string; shadowColor: string; shadowBlur: number }[] = [];
  const strokeRects: { x: number; y: number; w: number; h: number; strokeStyle: string; lineWidth: number }[] = [];
  let currentFillStyle = '';
  let currentStrokeStyle = '';
  let currentLineWidth = 1;
  let currentShadowColor = '';
  let currentShadowBlur = 0;
  let currentShadowOffsetX = 0;
  let currentShadowOffsetY = 0;

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => calls.push({ method: 'save' }),
    restore: () => calls.push({ method: 'restore' }),
    setTransform: (a?: any, b?: any, c?: any, d?: any, e?: any, f?: any) => {
      calls.push({ method: 'setTransform', args: [a, b, c, d, e, f] });
    },
    clearRect: (x, y, w, h) => calls.push({ method: 'clearRect', args: [x, y, w, h] }),
    fillRect: (x: number, y: number, w: number, h: number) => {
      calls.push({ method: 'fillRect', args: [x, y, w, h] });
      fillRects.push({
        x,
        y,
        w,
        h,
        fillStyle: currentFillStyle,
        shadowColor: currentShadowColor,
        shadowBlur: currentShadowBlur,
      });
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      calls.push({ method: 'strokeRect', args: [x, y, w, h] });
      strokeRects.push({
        x,
        y,
        w,
        h,
        strokeStyle: currentStrokeStyle,
        lineWidth: currentLineWidth,
      });
    },
    beginPath: () => calls.push({ method: 'beginPath' }),
    moveTo: (x, y) => calls.push({ method: 'moveTo', args: [x, y] }),
    lineTo: (x, y) => calls.push({ method: 'lineTo', args: [x, y] }),
    stroke: () => calls.push({ method: 'stroke' }),
    fill: () => calls.push({ method: 'fill' }),
    clip: () => calls.push({ method: 'clip' }),
    setLineDash: () => calls.push({ method: 'setLineDash' }),
    rect: (x, y, w, h) => calls.push({ method: 'rect', args: [x, y, w, h] }),
    roundRect: (x, y, w, h) => calls.push({ method: 'roundRect', args: [x, y, w, h] }),
    ellipse: () => calls.push({ method: 'ellipse' }),
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(val: any) {
      currentFillStyle = String(val);
    },
    get strokeStyle() {
      return currentStrokeStyle;
    },
    set strokeStyle(val: any) {
      currentStrokeStyle = String(val);
    },
    get lineWidth() {
      return currentLineWidth;
    },
    set lineWidth(val: number) {
      currentLineWidth = val;
    },
    get shadowColor() {
      return currentShadowColor;
    },
    set shadowColor(val: string) {
      currentShadowColor = val;
    },
    get shadowBlur() {
      return currentShadowBlur;
    },
    set shadowBlur(val: number) {
      currentShadowBlur = val;
    },
    get shadowOffsetX() {
      return currentShadowOffsetX;
    },
    set shadowOffsetX(val: number) {
      currentShadowOffsetX = val;
    },
    get shadowOffsetY() {
      return currentShadowOffsetY;
    },
    set shadowOffsetY(val: number) {
      currentShadowOffsetY = val;
    },
    globalAlpha: 1,
  };

  const canvas = {
    width,
    height,
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
    }),
    getContext: (id: string) => {
      if (id === '2d') return mockCtx as CanvasRenderingContext2D;
      return null;
    },
  } as unknown as HTMLCanvasElement;

  return { canvas, mockCtx, calls, fillRects, strokeRects };
}

describe('Representación Visual de la Mesa de Trabajo (Artboard)', () => {
  it('dibuja la mesa de trabajo en (0, 0) con Document.width y Document.height con fondo blanco', () => {
    const { canvas, fillRects } = createMockCanvas();
    const manager = new StateManager();
    const doc = manager.getState();

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    // Debe existir un fillRect que coincida exactamente con la mesa de trabajo (0, 0, doc.width, doc.height)
    const artboardFill = fillRects.find(
      (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
    );
    assert.ok(artboardFill, `Debe dibujar el fondo de la mesa de trabajo en (0, 0, ${doc.width}, ${doc.height})`);
    assert.equal(artboardFill?.fillStyle, '#ffffff', 'El fondo de la mesa de trabajo debe ser blanco');
  });

  it('aplica sombra perimetral (drop-shadow) en la mesa de trabajo', () => {
    const { canvas, fillRects } = createMockCanvas();
    const manager = new StateManager();
    const doc = manager.getState();

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    const artboardFill = fillRects.find(
      (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
    );
    assert.ok(artboardFill);
    assert.ok(artboardFill?.shadowBlur > 0, 'Debe configurar shadowBlur > 0 para la sombra perimetral');
    assert.equal(artboardFill?.shadowColor, 'rgba(0, 0, 0, 0.45)', 'Debe aplicar color de sombra');
  });

  it('escala la sombra y el borde delimitador según el nivel de zoom', () => {
    const { canvas, fillRects, strokeRects } = createMockCanvas();
    const manager = new StateManager();
    const doc = manager.getState();
    const zoom = 2.0;
    const viewportManager = new ViewportManager({ zoom, panX: 100, panY: 50 });

    const engine = new RenderEngine(canvas, manager, {
      highDpi: false,
      viewportManager,
    });
    engine.render();

    const artboardFill = fillRects.find(
      (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
    );
    assert.ok(artboardFill);
    // Con zoom = 2.0, shadowBlur debe ser 24 / 2.0 = 12
    assert.equal(artboardFill?.shadowBlur, 12, 'shadowBlur debe dividirse por el zoom');

    const artboardStroke = strokeRects.find(
      (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
    );
    assert.ok(artboardStroke, 'Debe dibujar el trazo delimitador del artboard');
    // Con zoom = 2.0, lineWidth debe ser 1 / 2.0 = 0.5
    assert.equal(artboardStroke?.lineWidth, 0.5, 'lineWidth debe ser 1 / zoom');
  });

  it('las figuras del Scene Graph se renderizan después de la mesa de trabajo (quedan superpuestas sobre el fondo blanco)', () => {
    const { canvas, calls } = createMockCanvas();
    const manager = new StateManager();
    const doc = manager.getState();
    const layer = doc.children[0];

    const rect: Rectangle = {
      id: 'rect-on-artboard',
      type: 'rectangle',
      name: 'Rect On Artboard',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      fill: '#4F46E5',
    };
    manager.addShape(layer.id, rect);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    // Índice de la llamada a fillRect del artboard
    const artboardCallIndex = calls.findIndex(
      (c) => c.method === 'fillRect' && c.args?.[0] === 0 && c.args?.[1] === 0 && c.args?.[2] === doc.width && c.args?.[3] === doc.height
    );
    assert.ok(artboardCallIndex !== -1, 'El artboard debe dibujarse');

    // Índice del dibujo de la figura
    const shapeCallIndex = calls.findIndex(
      (c) => (c.method === 'rect' || c.method === 'roundRect') && c.args?.[0] === 100 && c.args?.[1] === 100
    );
    assert.ok(shapeCallIndex !== -1, 'La figura debe dibujarse');

    assert.ok(
      artboardCallIndex < shapeCallIndex,
      'La mesa de trabajo debe dibujarse ANTES de las figuras para que queden encima'
    );
  });

  it('permite desactivar el dibujo de la mesa de trabajo con showArtboard: false', () => {
    const { canvas, fillRects } = createMockCanvas();
    const manager = new StateManager();
    const doc = manager.getState();

    const engine = new RenderEngine(canvas, manager, {
      highDpi: false,
      showArtboard: false,
    });
    engine.render();

    const artboardFill = fillRects.find(
      (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
    );
    assert.equal(artboardFill, undefined, 'No debe dibujar la mesa de trabajo cuando showArtboard es false');
  });

  it('utiliza las dimensiones personalizadas del Document cuando Document.width y Document.height cambian', () => {
    const customDoc: Document = {
      id: 'custom-doc',
      type: 'document',
      name: 'Custom Artboard',
      width: 800,
      height: 600,
      children: [
        {
          id: 'custom-layer',
          type: 'layer',
          name: 'Capa 1',
          children: [],
        },
      ],
    };
    const { canvas, fillRects } = createMockCanvas();
    const manager = new StateManager(customDoc);

    const engine = new RenderEngine(canvas, manager, { highDpi: false });
    engine.render();

    const artboardFill = fillRects.find(
      (r) => r.x === 0 && r.y === 0 && r.w === 800 && r.h === 600
    );
    assert.ok(artboardFill, 'Debe dibujar la mesa con las dimensiones 800x600 provistas en el Document');
  });

  describe('Clipping de renderizado de la Mesa de Trabajo', () => {
    it('aplica clipping de renderizado con rect(0, 0, Document.width, Document.height) y ctx.clip()', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      const clipCall = calls.find((c) => c.method === 'clip');
      assert.ok(clipCall, 'Debe invocar ctx.clip() para delimitar el renderizado a la mesa');

      const clipRectCall = calls.find(
        (c) => c.method === 'rect' && c.args?.[0] === 0 && c.args?.[1] === 0 && c.args?.[2] === doc.width && c.args?.[3] === doc.height
      );
      assert.ok(clipRectCall, `Debe definir la ruta de recorte con las medidas exactas de la mesa (0, 0, ${doc.width}, ${doc.height})`);
    });

    it('los objetos que sobresalen siguen existiendo en el Scene Graph con sus coordenadas y dimensiones intactas', () => {
      const { canvas } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const layer = doc.children[0];

      // Figura que sobresale parcialmente del borde derecho e inferior de la mesa
      const overflowingRect: Rectangle = {
        id: 'rect-overflow',
        type: 'rectangle',
        name: 'Rect Overflow',
        x: doc.width - 50,
        y: doc.height - 50,
        width: 300,
        height: 200,
        fill: '#ef4444',
      };
      manager.addShape(layer.id, overflowingRect);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      // Verificar que el Scene Graph NO ha sido mutado en lo absoluto
      const shapeInState = manager.findNode('rect-overflow') as Rectangle;
      assert.ok(shapeInState, 'La figura debe seguir existiendo en el Scene Graph');
      assert.equal(shapeInState.x, doc.width - 50, 'Coordenada x no debe modificarse');
      assert.equal(shapeInState.y, doc.height - 50, 'Coordenada y no debe modificarse');
      assert.equal(shapeInState.width, 300, 'El ancho no debe modificarse');
      assert.equal(shapeInState.height, 200, 'El alto no debe modificarse');
    });

    it('selection overlays y controles de edición se dibujan fuera de la región de recorte (después de restore)', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const layer = doc.children[0];

      const overflowingRect: Rectangle = {
        id: 'rect-overflow-select',
        type: 'rectangle',
        name: 'Rect Overflow Select',
        x: doc.width - 50,
        y: doc.height - 50,
        width: 300,
        height: 200,
        fill: '#ef4444',
      };
      manager.addShape(layer.id, overflowingRect);
      manager.selectNode(overflowingRect.id);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      const clipIndex = calls.findIndex((c) => c.method === 'clip');
      assert.ok(clipIndex !== -1);

      // Buscar el strokeRect de la bounding box seleccionada (después del clip)
      const bboxCallIndex = calls.findIndex(
        (c, idx) =>
          idx > clipIndex &&
          c.method === 'strokeRect' &&
          c.args?.[0] === overflowingRect.x &&
          c.args?.[1] === overflowingRect.y &&
          c.args?.[2] === overflowingRect.width &&
          c.args?.[3] === overflowingRect.height
      );
      assert.ok(
        bboxCallIndex !== -1,
        'La caja delimitadora de selección debe dibujarse DESPUÉS de restaurar el contexto del clip'
      );

      // Verificar que existe al menos un restore entre clip y la bounding box
      const restoreBetween = calls.slice(clipIndex, bboxCallIndex).some((c) => c.method === 'restore');
      assert.ok(restoreBetween, 'Debe restaurarse el contexto para liberar el clip antes del overlay de selección');
    });

    it('permite desactivar el clipping mediante clipToArtboard: false', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();

      const engine = new RenderEngine(canvas, manager, {
        highDpi: false,
        clipToArtboard: false,
      });
      engine.render();

      const clipCall = calls.find((c) => c.method === 'clip');
      assert.equal(clipCall, undefined, 'No debe llamar a ctx.clip() cuando clipToArtboard es false');
    });

    it('respeta zoom y pan del viewport durante el clipping', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const zoom = 2.5;
      const panX = 120;
      const panY = -80;
      const viewportManager = new ViewportManager({ zoom, panX, panY });

      const engine = new RenderEngine(canvas, manager, {
        highDpi: false,
        viewportManager,
      });
      engine.render();

      const setTransformIndex = calls.findIndex((c) => c.method === 'setTransform');
      const clipIndex = calls.findIndex((c) => c.method === 'clip');
      assert.ok(setTransformIndex !== -1);
      assert.ok(clipIndex !== -1);
      assert.ok(
        setTransformIndex < clipIndex,
        'setTransform del viewport debe aplicarse antes del clip para que la matriz escale el recorte'
      );

      // Las coordenadas pasadas a rect siguen siendo las del mundo (0, 0, doc.width, doc.height)
      const clipRect = calls.find(
        (c) => c.method === 'rect' && c.args?.[0] === 0 && c.args?.[1] === 0 && c.args?.[2] === doc.width && c.args?.[3] === doc.height
      );
      assert.ok(clipRect, 'El rect del clip debe mantener las coordenadas del mundo');
    });
  });
});
