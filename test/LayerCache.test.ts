import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import {
  LayerCacheManager,
  type CachedRenderEntry,
} from '../src/render/LayerCacheManager.ts';
import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  Rectangle,
  Ellipse,
} from '../src/types/scene-graph.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import type { TextEditRenderState } from '../src/render/types.ts';

// Helper para crear un mock de Canvas y Context2D con soporte de drawImage e inspección
function createMockCanvasWithDrawImage(): {
  canvas: HTMLCanvasElement;
  calls: string[];
  drawImages: Array<{ img: any; dx: number; dy: number; dw?: number; dh?: number }>;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
} {
  const calls: string[] = [];
  const drawImages: Array<{ img: any; dx: number; dy: number; dw?: number; dh?: number }> = [];
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

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
    rect: (x: number, y: number, width: number, height: number) => {
      calls.push('rect');
      rects.push({ x, y, width, height });
    },
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    setLineDash: () => calls.push('setLineDash'),
    drawImage: (img: any, dx: number, dy: number, dw?: number, dh?: number) => {
      calls.push('drawImage');
      drawImages.push({ img, dx, dy, dw, dh });
    },
    font: '10px sans-serif',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
  };

  const mockCanvas = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
    }),
    getContext: (id: string) => {
      if (id === '2d') return mockCtx as CanvasRenderingContext2D;
      return null;
    },
  } as unknown as HTMLCanvasElement;

  return { canvas: mockCanvas, calls, drawImages, rects };
}

// Fábrica de lienzos mock para OffscreenCanvas en Node.js
function createMockOffscreenCanvas(width: number, height: number) {
  const { canvas } = createMockCanvasWithDrawImage();
  (canvas as any).width = width;
  (canvas as any).height = height;
  return canvas;
}

// Helpers para instanciar nodos del Scene Graph con tipos completos
function makeRect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = '#ff0000',
  visible = true
): Rectangle {
  return {
    id,
    type: 'rectangle',
    name: `Rect ${id}`,
    x,
    y,
    width,
    height,
    fill,
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1,
    visible,
  };
}

function makeEllipse(
  id: string,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  fill = '#0000ff'
): Ellipse {
  return {
    id,
    type: 'ellipse',
    name: `Ellipse ${id}`,
    x,
    y,
    radiusX,
    radiusY,
    fill,
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1,
  };
}

function makeLayer(
  id: string,
  name: string,
  children: readonly LayerChildNode[],
  visible = true
): Layer {
  return {
    id,
    type: 'layer',
    name,
    visible,
    children,
  };
}

function makeDoc(children: readonly Layer[]): Document {
  return {
    id: 'doc-1',
    type: 'document',
    name: 'Documento',
    width: 800,
    height: 600,
    artboards: [{ id: 'ab-1', name: 'Mesa 1', x: 0, y: 0, width: 800, height: 600 }],
    children,
  };
}

describe('LayerCacheManager - Aceleración de capas y grupos', () => {
  it('countLeafShapes cuenta figuras hoja ignorando nodos ocultos', () => {
    const manager = new LayerCacheManager();

    const rect1 = makeRect('r1', 10, 10, 50, 50);
    const rect2Hidden = makeRect('r2', 70, 10, 50, 50, '#0f0', false);
    const ellipse1 = makeEllipse('e1', 150, 150, 30, 30);
    const groupInner: Group = {
      id: 'g1',
      type: 'group',
      name: 'Grupo 1',
      children: [ellipse1],
    };
    const groupHidden: Group = {
      id: 'g-hidden',
      type: 'group',
      name: 'Grupo Oculto',
      visible: false,
      children: [rect1],
    };

    const layer = makeLayer('layer-1', 'Capa 1', [rect1, rect2Hidden, groupInner, groupHidden]);

    // rect1 (1) + groupInner con ellipse1 (1) = 2. Los ocultos no se cuentan.
    assert.equal(manager.countLeafShapes(layer), 2);
  });

  it('hasActiveDescendant detecta si la capa o cualquier descendiente está seleccionado', () => {
    const manager = new LayerCacheManager();

    const rect1 = makeRect('r1', 10, 10, 50, 50);
    const group: Group = {
      id: 'g1',
      type: 'group',
      name: 'Grupo',
      children: [rect1],
    };
    const layer = makeLayer('layer-1', 'Capa 1', [group]);

    // Sin selección
    assert.equal(manager.hasActiveDescendant(layer, new Set()), false);

    // Selección de figura externa
    assert.equal(manager.hasActiveDescendant(layer, new Set(['other-id'])), false);

    // Selección de la capa misma
    assert.equal(manager.hasActiveDescendant(layer, new Set(['layer-1'])), true);

    // Selección del grupo descendiente
    assert.equal(manager.hasActiveDescendant(layer, new Set(['g1'])), true);

    // Selección de figura hoja profunda
    assert.equal(manager.hasActiveDescendant(layer, new Set(['r1'])), true);
  });

  it('isEligible verifica visibilidad, figuras mínimas y ausencia de edición activa', () => {
    const manager = new LayerCacheManager({ minShapeCount: 2 });

    const rect1 = makeRect('r1', 10, 10, 50, 50);
    const rect2 = makeRect('r2', 70, 10, 50, 50, '#0f0');

    const layerWith1 = makeLayer('layer-1', 'Capa 1', [rect1]);
    const layerWith2 = makeLayer('layer-2', 'Capa 2', [rect1, rect2]);
    const layerHidden = makeLayer('layer-3', 'Capa 3', [rect1, rect2], false);

    // Menos de minShapeCount (1 < 2)
    assert.equal(manager.isEligible(layerWith1, new Set()), false);

    // Cumple con 2 figuras y sin selección
    assert.equal(manager.isEligible(layerWith2, new Set()), true);

    // Inelegible si está oculta
    assert.equal(manager.isEligible(layerHidden, new Set()), false);

    // Inelegible si una de sus figuras está seleccionada
    assert.equal(manager.isEligible(layerWith2, new Set(['r1'])), false);
  });

  it('calculatePaddedBounds calcula los límites con margen de seguridad adaptado al zoom', () => {
    const manager = new LayerCacheManager({ paddingMargin: 10 });

    const rect1 = makeRect('r1', 100, 100, 200, 150);
    const layer = makeLayer('layer-1', 'Capa', [rect1]);

    // Zoom 1: margen = 10 px
    const boundsZ1 = manager.calculatePaddedBounds(layer, 1);
    assert.ok(boundsZ1);
    assert.equal(boundsZ1.minX, 90);
    assert.equal(boundsZ1.minY, 90);
    assert.equal(boundsZ1.maxX, 310);
    assert.equal(boundsZ1.maxY, 260);
    assert.equal(boundsZ1.width, 220);
    assert.equal(boundsZ1.height, 170);

    // Capa vacía devuelve null
    const emptyLayer = makeLayer('empty', 'Vacía', []);
    assert.equal(manager.calculatePaddedBounds(emptyLayer, 1), null);
  });

  it('get/set e invalidación O(1) por structural sharing', () => {
    const manager = new LayerCacheManager({ zoomTolerance: 0.05 });
    const mockCanvas = createMockOffscreenCanvas(200, 200);

    const layer1 = Object.freeze(makeLayer('layer-1', 'Capa 1', []));

    const entry: CachedRenderEntry = {
      id: 'layer-1',
      nodeRef: layer1,
      canvas: mockCanvas,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 },
      zoom: 1.0,
      dpr: 1.0,
      lastUsedFrame: 1,
    };

    manager.set(entry);

    // Hit exacto
    const hit = manager.get(layer1, 1.0, 1.0);
    assert.equal(hit, entry);
    assert.equal(manager.getStats().hits, 1);

    // Hit dentro de tolerancia de zoom (1.02 está dentro del 5%)
    const hitZoom = manager.get(layer1, 1.02, 1.0);
    assert.equal(hitZoom, entry);
    assert.equal(manager.getStats().hits, 2);

    // Miss fuera de tolerancia de zoom (1.20 supera el 5%)
    const missZoom = manager.get(layer1, 1.2, 1.0);
    assert.equal(missZoom, null);
    assert.equal(manager.getStats().misses, 1);

    // Inmutabilidad / Structural sharing: al mutar la capa, se genera un nuevo objeto Layer
    const layer1Updated = Object.freeze(makeLayer('layer-1', 'Capa 1 Modificada', []));

    // La referencia anterior ya no coincide (layer1Updated !== layer1) -> Miss instantáneo O(1) y desalojo
    const missRef = manager.get(layer1Updated, 1.0, 1.0);
    assert.equal(missRef, null);
    assert.equal(manager.getStats().misses, 2);

    // Ya no existe en el caché
    assert.equal(manager.get(layer1, 1.0, 1.0), null);
  });

  it('prune elimina entradas huérfanas', () => {
    const manager = new LayerCacheManager();
    const mockCanvas = createMockOffscreenCanvas(100, 100);

    const layer1 = makeLayer('l1', 'L1', []);
    const layer2 = makeLayer('l2', 'L2', []);

    manager.set({
      id: 'l1',
      nodeRef: layer1,
      canvas: mockCanvas,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 },
      zoom: 1,
      dpr: 1,
      lastUsedFrame: 1,
    });
    manager.set({
      id: 'l2',
      nodeRef: layer2,
      canvas: mockCanvas,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 },
      zoom: 1,
      dpr: 1,
      lastUsedFrame: 1,
    });

    assert.equal(manager.getStats().entriesCount, 2);

    // Podamos pasando únicamente 'l1'
    manager.prune(['l1']);

    assert.equal(manager.getStats().entriesCount, 1);
    assert.ok(manager.get(layer1, 1, 1));
    assert.equal(manager.get(layer2, 1, 1), null);
  });

  it('clear restablece entradas y estadísticas', () => {
    const manager = new LayerCacheManager();
    const mockCanvas = createMockOffscreenCanvas(50, 50);
    const layer = makeLayer('l1', 'L1', []);

    manager.set({
      id: 'l1',
      nodeRef: layer,
      canvas: mockCanvas,
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50, width: 50, height: 50 },
      zoom: 1,
      dpr: 1,
      lastUsedFrame: 1,
    });

    manager.get(layer, 1, 1); // Hit
    assert.equal(manager.getStats().hits, 1);
    assert.equal(manager.getStats().entriesCount, 1);
    assert.equal(manager.getStats().totalMemoryBytes, 50 * 50 * 4);

    manager.clear();
    assert.equal(manager.getStats().hits, 0);
    assert.equal(manager.getStats().misses, 0);
    assert.equal(manager.getStats().entriesCount, 0);
    assert.equal(manager.getStats().totalMemoryBytes, 0);
  });
});

describe('RenderEngine - Integración de LayerCacheManager', () => {
  it('rasteriza capas estáticas en primer render y reutiliza con drawImage en segundo render', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 50, 50, 100, 80, '#ff0000');
    const rect2 = makeRect('r2', 200, 50, 100, 80, '#00ff00');
    const doc = makeDoc([makeLayer('layer-static', 'Capa Estática', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    assert.ok(engine.layerCacheManager, 'LayerCacheManager debe haberse inicializado');

    // 1. Primer render: rasteriza en caché y dibuja el canvas con drawImage
    engine.render();

    assert.equal(drawImages.length, 1, 'Debe haber bliteado la capa rasterizada con drawImage');
    assert.equal(engine.layerCacheManager.getStats().hits, 0);
    assert.equal(engine.layerCacheManager.getStats().entriesCount, 1);

    // 2. Segundo render (sin modificaciones en el documento, ej. paneo):
    // Debe reutilizar la entrada del caché (Hit) y volver a blitear directamente
    engine.render();

    assert.equal(drawImages.length, 2, 'Segundo render debe volver a blitear desde el caché');
    assert.equal(engine.layerCacheManager.getStats().hits, 1, 'Debe registrar 1 cache hit');
  });

  it('omite la caché y dibuja en vectorial cuando una figura de la capa está seleccionada', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 50, 50, 100, 80, '#ff0000');
    const rect2 = makeRect('r2', 200, 50, 100, 80, '#00ff00');
    const doc = makeDoc([makeLayer('layer-active', 'Capa Activa', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    // Seleccionamos rect1
    stateManager.setSelection(['r1']);

    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    engine.render();

    // Como rect1 está seleccionada, la capa NO debe rasterizarse ni blitearse
    assert.equal(drawImages.length, 0, 'No debe blitear drawImage para capas con selección activa');
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 0);
  });

  it('invalida el caché cuando se modifica una figura de la capa', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 50, 50, 100, 80, '#ff0000');
    const rect2 = makeRect('r2', 200, 50, 100, 80, '#00ff00');
    const doc = makeDoc([makeLayer('layer-mod', 'Capa Modificable', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    // 1. Primer render: se crea la caché
    engine.render();
    assert.equal(drawImages.length, 1);
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 1);

    // 2. Modificamos rect1 vía StateManager (produce nueva referencia inmutable de Layer)
    stateManager.updateShapesPosition([{ id: 'r1', x: 80, y: 50 }]);

    // 3. Siguiente render: detecta el cambio de referencia en O(1), desaloja la entrada obsoleta y vuelve a rasterizar
    engine.render();

    assert.equal(drawImages.length, 2, 'Debe haber bliteado la capa actualizada');
    // Debe haber registrado 1 miss por invalidación estructural
    assert.equal(engine.layerCacheManager?.getStats().misses, 1);
  });

  it('invalida y omite la caché cuando una capa pre-cacheadada pasa a tener una figura seleccionada o en edición de texto', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 50, 50, 100, 80, '#ff0000');
    const rect2 = makeRect('r2', 200, 50, 100, 80, '#00ff00');
    const doc = makeDoc([makeLayer('layer-preload', 'Capa Inicial', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    let activeTextEditing: TextEditRenderState | null = null;
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      textEditProvider: () => activeTextEditing,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    // 1. Primer render al abrir la app: la capa es estática y se cachea
    engine.render();
    assert.equal(drawImages.length, 1, 'Primer render debe cachear y blitear');
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 1);

    // 2. Usuario selecciona r1 sin moverlo (el documento permanece idéntico en memoria)
    stateManager.setSelection(['r1']);
    engine.render();

    // No debe reutilizar la caché stale, sino omitirla e invalidarla
    assert.equal(drawImages.length, 1, 'No debe volver a blitear la caché estática');
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 0, 'La entrada debe haber sido desalojada');

    // 3. Usuario entra a edición de texto sobre r2
    stateManager.setSelection([]);
    activeTextEditing = { textId: 'r2', text: 'Editando' };
    engine.render();

    assert.equal(drawImages.length, 1, 'No debe blitear la capa mientras haya edición de texto activa');
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 0);
  });

  it('soporta caché en grupos estáticos', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 10, 10, 40, 40, '#ff0000');
    const rect2 = makeRect('r2', 60, 10, 40, 40, '#00ff00');

    const group: Group = {
      id: 'group-static',
      type: 'group',
      name: 'Grupo Estático',
      children: [rect1, rect2],
    };

    // La capa tiene solo 1 hijo (el grupo), por lo que la capa no califica (minShapeCount: 2),
    // pero el grupo contiene 2 figuras hoja y sí califica para rasterizarse
    const doc = makeDoc([makeLayer('layer-with-group', 'Capa con Grupo', [group])]);

    const stateManager = new StateManager(doc);
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      layerCacheOptions: {
        minShapeCount: 2,
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    engine.render();
    assert.equal(drawImages.length, 1, 'El grupo estático debe rasterizarse y blitearse con drawImage');

    engine.render();
    assert.equal(drawImages.length, 2, 'El grupo estático debe reutilizarse desde la caché');
    assert.equal(engine.layerCacheManager?.getStats().hits, 1);
  });

  it('limpia las entradas del caché al invocar destroy()', () => {
    const { canvas } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 10, 10, 40, 40, '#ff0000');
    const rect2 = makeRect('r2', 60, 10, 40, 40, '#00ff00');
    const doc = makeDoc([makeLayer('layer-destruct', 'Capa', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    engine.render();
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 1);

    engine.destroy();
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 0);
  });

  it('reutiliza la caché durante el paneo (pan) manteniendo fijas las coordenadas del mundo', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 10, 10, 50, 50, '#f00');
    const rect2 = makeRect('r2', 80, 10, 50, 50, '#0f0');
    const doc = makeDoc([makeLayer('layer-pan', 'Capa Paneo', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    const viewportManager = new ViewportManager();
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      viewportManager,
      enableLayerCache: true,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    // Primer render con viewport en (0, 0)
    engine.render();
    assert.equal(drawImages.length, 1);
    const firstBlit = drawImages[0];

    // Desplazamiento por paneo de 200px en X y 150px en Y
    viewportManager.panBy(200, 150);
    stateManager.markDirty();
    engine.render();

    assert.equal(drawImages.length, 2);
    assert.equal(engine.layerCacheManager?.getStats().hits, 1, 'Debe reutilizar la entrada del caché sin re-rasterizar');

    // Los límites del mundo bliteados (dx, dy, dw, dh) son exactamente iguales
    // ya que la transformación de paneo se aplica en el viewport transform de ctx
    assert.equal(drawImages[1].dx, firstBlit.dx);
    assert.equal(drawImages[1].dy, firstBlit.dy);
    assert.equal(drawImages[1].dw, firstBlit.dw);
    assert.equal(drawImages[1].dh, firstBlit.dh);
  });

  it('reutiliza caché con zoom dentro de la tolerancia y re-rasteriza al superarla', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rect1 = makeRect('r1', 10, 10, 50, 50, '#f00');
    const rect2 = makeRect('r2', 80, 10, 50, 50, '#0f0');
    const doc = makeDoc([makeLayer('layer-zoom', 'Capa Zoom', [rect1, rect2])]);

    const stateManager = new StateManager(doc);
    const viewportManager = new ViewportManager();
    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      viewportManager,
      enableLayerCache: true,
      layerCacheOptions: {
        zoomTolerance: 0.05, // 5% tolerancia
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    // 1. Render base a zoom 1.0
    engine.render();
    assert.equal(drawImages.length, 1);

    // 2. Zoom mínimo del 2% (1.02 <= 1.05 tolerancia)
    viewportManager.setViewport({ zoom: 1.02, panX: 0, panY: 0 });
    stateManager.markDirty();
    engine.render();

    assert.equal(drawImages.length, 2);
    assert.equal(engine.layerCacheManager?.getStats().hits, 1, 'Zoom del 2% debe reutilizar el caché');

    // 3. Zoom mayor del 50% (1.50 > 1.05 tolerancia)
    viewportManager.setViewport({ zoom: 1.5, panX: 0, panY: 0 });
    stateManager.markDirty();
    engine.render();

    assert.equal(drawImages.length, 3);
    assert.equal(engine.layerCacheManager?.getStats().misses, 1, 'Zoom del 50% debe producir miss y re-rasterizar');
  });

  it('en documentos con múltiples capas, almacena en caché la capa estática y dibuja la activa en vector', () => {
    const { canvas, drawImages } = createMockCanvasWithDrawImage();

    const rectStatic1 = makeRect('rs1', 10, 10, 40, 40, '#111');
    const rectStatic2 = makeRect('rs2', 60, 10, 40, 40, '#222');
    const rectActive1 = makeRect('ra1', 10, 100, 40, 40, '#333');
    const rectActive2 = makeRect('ra2', 60, 100, 40, 40, '#444');

    const doc = makeDoc([
      makeLayer('layer-bg', 'Capa Fondo (Estática)', [rectStatic1, rectStatic2]),
      makeLayer('layer-fg', 'Capa Frente (Con Selección)', [rectActive1, rectActive2]),
    ]);

    const stateManager = new StateManager(doc);
    // Seleccionamos la figura de la capa de frente
    stateManager.setSelection(['ra1']);

    const engine = new RenderEngine(canvas, stateManager, {
      highDpi: false,
      enableLayerCache: true,
      layerCacheOptions: {
        canvasFactory: (w, h) => createMockOffscreenCanvas(w, h),
      },
    });

    // 1. Primer render: capa-bg califica para caché (1 drawImage), capa-fg se dibuja en vectorial directo
    engine.render();
    assert.equal(drawImages.length, 1);
    assert.equal(engine.layerCacheManager?.getStats().entriesCount, 1);

    // 2. Segundo render: capa-bg se reutiliza desde caché (segundo drawImage)
    stateManager.markDirty();
    engine.render();
    assert.equal(drawImages.length, 2);
    assert.equal(engine.layerCacheManager?.getStats().hits, 1);
  });
});
