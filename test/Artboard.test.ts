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

  describe('Comportamiento sin clipping (estilo Illustrator / Pasteboard infinito)', () => {
    it('los objetos fuera o desbordando la mesa de trabajo se renderizan completamente sin invocar ctx.clip()', () => {
      const { canvas, calls } = createMockCanvas();
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

      // No debe aplicarse ningún clip
      const clipCall = calls.find((c) => c.method === 'clip');
      assert.equal(clipCall, undefined, 'No debe invocar ctx.clip() para que el workspace exterior muestre todo el contenido');

      // La figura desbordante debe dibujarse íntegramente con sus dimensiones
      const shapeCall = calls.find(
        (c) =>
          (c.method === 'rect' || c.method === 'roundRect') &&
          c.args?.[0] === overflowingRect.x &&
          c.args?.[1] === overflowingRect.y &&
          c.args?.[2] === overflowingRect.width &&
          c.args?.[3] === overflowingRect.height
      );
      assert.ok(shapeCall, 'La figura que desborda debe renderizarse en sus coordenadas completas del mundo');
    });

    it('los objetos fuera de la mesa conservan sus coordenadas y dimensiones intactas en el Scene Graph', () => {
      const { canvas } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const layer = doc.children[0];

      const pasteboardRect: Rectangle = {
        id: 'rect-outside',
        type: 'rectangle',
        name: 'Rect Outside',
        x: doc.width + 200,
        y: doc.height + 150,
        width: 150,
        height: 100,
        fill: '#3b82f6',
      };
      manager.addShape(layer.id, pasteboardRect);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      const shapeInState = manager.findNode('rect-outside') as Rectangle;
      assert.ok(shapeInState, 'La figura debe seguir existiendo en el Scene Graph');
      assert.equal(shapeInState.x, doc.width + 200, 'Coordenada x no debe modificarse');
      assert.equal(shapeInState.y, doc.height + 150, 'Coordenada y no debe modificarse');
      assert.equal(shapeInState.width, 150, 'El ancho no debe modificarse');
      assert.equal(shapeInState.height, 100, 'El alto no debe modificarse');
    });

    it('la selección y sus manejadores funcionan correctamente fuera de los límites de la mesa', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const layer = doc.children[0];

      const outsideRect: Rectangle = {
        id: 'rect-outside-select',
        type: 'rectangle',
        name: 'Rect Outside Select',
        x: doc.width + 100,
        y: doc.height + 100,
        width: 200,
        height: 150,
        fill: '#10b981',
      };
      manager.addShape(layer.id, outsideRect);
      manager.selectNode(outsideRect.id);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      // Debe dibujar la bounding box de la figura seleccionada en el pasteboard
      const bboxCall = calls.find(
        (c) =>
          c.method === 'strokeRect' &&
          c.args?.[0] === outsideRect.x &&
          c.args?.[1] === outsideRect.y &&
          c.args?.[2] === outsideRect.width &&
          c.args?.[3] === outsideRect.height
      );
      assert.ok(bboxCall, 'Debe dibujar la bounding box de selección en el workspace exterior');
    });

    it('la mesa conserva su fondo blanco y sombra en (0, 0, Document.width, Document.height) independientemente de los objetos exteriores', () => {
      const { canvas, fillRects } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const layer = doc.children[0];

      // Añadir figura en el exterior
      manager.addShape(layer.id, {
        id: 'rect-far',
        type: 'rectangle',
        name: 'Far',
        x: -500,
        y: -300,
        width: 100,
        height: 100,
      });

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      const artboardFill = fillRects.find(
        (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
      );
      assert.ok(artboardFill, 'La mesa de trabajo debe seguir delimitada por Document.width y Document.height');
      assert.equal(artboardFill?.fillStyle, '#ffffff');
      assert.ok(artboardFill?.shadowBlur > 0, 'La sombra visual debe seguir presente');
    });

    it('respeta zoom y pan del viewport mostrando el contenido dentro y fuera de la mesa', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();
      const doc = manager.getState();
      const layer = doc.children[0];

      const rectInside: Rectangle = { id: 'r-in', type: 'rectangle', name: 'In', x: 50, y: 50, width: 100, height: 100 };
      const rectOutside: Rectangle = { id: 'r-out', type: 'rectangle', name: 'Out', x: doc.width + 100, y: 50, width: 100, height: 100 };
      manager.addShape(layer.id, rectInside);
      manager.addShape(layer.id, rectOutside);

      const zoom = 0.5;
      const viewportManager = new ViewportManager({ zoom, panX: 200, panY: 100 });

      const engine = new RenderEngine(canvas, manager, {
        highDpi: false,
        viewportManager,
      });
      engine.render();

      // Ambas figuras deben haberse dibujado
      const drawInside = calls.some((c) => (c.method === 'rect' || c.method === 'roundRect') && c.args?.[0] === 50);
      const drawOutside = calls.some((c) => (c.method === 'rect' || c.method === 'roundRect') && c.args?.[0] === doc.width + 100);
      assert.ok(drawInside, 'Debe dibujar la figura interna con zoom y pan');
      assert.ok(drawOutside, 'Debe dibujar la figura externa con zoom y pan');
    });
  });
});
