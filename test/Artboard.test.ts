import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ResizeArtboardCommand } from '../src/commands/ResizeArtboardCommand.ts';
import { AddShapeCommand } from '../src/commands/AddShapeCommand.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import { ARTBOARD_PRESETS, getPresetById, findPresetForSize } from '../src/utils/artboardPresets.ts';
import { serializeDocument, parseDocument, DocumentParseError } from '../src/state/Serializer.ts';
import { injectSampleShapes } from '../src/state/injectSampleShapes.ts';
import type { Rectangle, Document, Path, Ellipse } from '../src/types/scene-graph.ts';

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
    addEventListener: () => {},
    removeEventListener: () => {},
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

  it('soporta pantallas HiDPI (devicePixelRatio > 1) aplicando la transformación combinada dpr * zoom y dibujando la mesa en espacio del mundo', () => {
    const { canvas, calls, fillRects } = createMockCanvas();
    const manager = new StateManager();
    const doc = manager.getState();
    const viewportManager = new ViewportManager({ zoom: 1.5, panX: 40, panY: 60 });

    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      devicePixelRatio: 2,
      innerWidth: 800,
      innerHeight: 600,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    try {
      const engine = new RenderEngine(canvas, manager, {
        highDpi: true,
        viewportManager,
      });
      engine.render();

      // Comprobar que setTransform se invocó con la matriz combinada (dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY)
      // dpr * zoom = 2 * 1.5 = 3
      // dpr * panX = 2 * 40 = 80
      // dpr * panY = 2 * 60 = 120
      const transformCalls = calls.filter((c) => c.method === 'setTransform');
      const combinedTransform = transformCalls.find(
        (c) => c.args && c.args[0] === 3 && c.args[3] === 3 && c.args[4] === 80 && c.args[5] === 120
      );
      assert.ok(combinedTransform, 'Debe aplicar la matriz combinada con dpr = 2 y zoom = 1.5');

      // La mesa se dibuja en coordenadas del mundo (0, 0, width, height)
      const artboardFill = fillRects.find(
        (r) => r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height
      );
      assert.ok(artboardFill, 'Debe renderizar la mesa de trabajo en coordenadas del mundo con fondo blanco');
      assert.equal(artboardFill?.fillStyle, '#ffffff');
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as any).window = originalWindow;
      } else {
        delete (globalThis as any).window;
      }
    }
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

describe('Configuración Manual del Tamaño de la Mesa de Trabajo (StateManager)', () => {
  it('actualiza Document.width y Document.height de forma inmutable conservando capas y figuras intactas', () => {
    const manager = new StateManager();
    const docBefore = manager.getState();
    const layer = docBefore.children[0];

    const rect: Rectangle = {
      id: 'rect-preserved',
      type: 'rectangle',
      name: 'Rect Preserved',
      x: 150,
      y: 250,
      width: 100,
      height: 80,
    };
    manager.addShape(layer.id, rect);

    const docWithShape = manager.getState();
    assert.equal(docWithShape.width, 1920);
    assert.equal(docWithShape.height, 1080);

    // Modificar tamaño de la mesa
    manager.setDocumentSize(1280, 720);

    const docAfter = manager.getState();
    assert.notEqual(docAfter, docWithShape, 'Debe retornar una nueva instancia inmutable');
    assert.equal(docAfter.width, 1280, 'El ancho debe actualizarse a 1280');
    assert.equal(docAfter.height, 720, 'El alto debe actualizarse a 720');
    assert.ok(Object.isFrozen(docAfter), 'El estado del documento debe estar congelado');

    // Comprobar que los objetos y capas existentes no fueron alterados
    const shapeAfter = manager.findNode('rect-preserved') as Rectangle;
    assert.ok(shapeAfter, 'La figura debe seguir existiendo');
    assert.equal(shapeAfter.x, 150);
    assert.equal(shapeAfter.y, 250);
    assert.equal(shapeAfter.width, 100);
    assert.equal(shapeAfter.height, 80);
    assert.equal(docAfter.children[0].children[0], docWithShape.children[0].children[0], 'Las figuras conservan sus referencias exactas');
  });

  it('marca isDirty como true y notifica a los suscriptores cuando las dimensiones cambian', () => {
    const manager = new StateManager();
    let notifications = 0;
    manager.subscribe(() => {
      notifications++;
    });

    manager.setDocumentSize(2560, 1440);
    assert.equal(manager.isDirty, true, 'isDirty debe marcarse como true');
    assert.equal(notifications, 1, 'Debe emitir 1 notificación a los suscriptores');
  });

  it('no altera el estado ni emite notificaciones si las dimensiones son idénticas', () => {
    const manager = new StateManager();
    const docBefore = manager.getState();
    let notifications = 0;
    manager.subscribe(() => {
      notifications++;
    });

    manager.setDocumentSize(docBefore.width, docBefore.height);
    assert.equal(manager.getState(), docBefore, 'La referencia debe permanecer intacta');
    assert.equal(notifications, 0, 'No debe notificar si no hubo cambios');
  });

  it('rechaza valores de 0 arrojando excepción', () => {
    const manager = new StateManager();
    assert.throws(() => manager.setDocumentSize(0, 1080), /mayor a 0/);
    assert.throws(() => manager.setDocumentSize(1920, 0), /mayor a 0/);
  });

  it('rechaza valores negativos arrojando excepción', () => {
    const manager = new StateManager();
    assert.throws(() => manager.setDocumentSize(-500, 1080), /mayor a 0/);
    assert.throws(() => manager.setDocumentSize(1920, -100), /mayor a 0/);
  });

  it('rechaza valores no finitos (NaN, Infinity) arrojando excepción', () => {
    const manager = new StateManager();
    assert.throws(() => manager.setDocumentSize(NaN, 1080), /finito/);
    assert.throws(() => manager.setDocumentSize(1920, NaN), /finito/);
    assert.throws(() => manager.setDocumentSize(Infinity, 1080), /finito/);
    assert.throws(() => manager.setDocumentSize(1920, -Infinity), /finito/);
  });
});

describe('ResizeArtboardCommand y Undo/Redo', () => {
  it('aplica las nuevas dimensiones en execute() y restaura las anteriores en undo()', () => {
    const manager = new StateManager();
    assert.equal(manager.getState().width, 1920);
    assert.equal(manager.getState().height, 1080);

    const cmd = new ResizeArtboardCommand(manager, 1920, 1080, 800, 600);
    assert.equal(cmd.name, 'ResizeArtboardCommand');
    assert.equal(cmd.initialWidth, 1920);
    assert.equal(cmd.initialHeight, 1080);
    assert.equal(cmd.finalWidth, 800);
    assert.equal(cmd.finalHeight, 600);

    // execute
    cmd.execute();
    assert.equal(manager.getState().width, 800);
    assert.equal(manager.getState().height, 600);

    // undo
    cmd.undo();
    assert.equal(manager.getState().width, 1920);
    assert.equal(manager.getState().height, 1080);
  });

  it('se integra limpiamente con CommandManager permitiendo historial de deshacer y rehacer', () => {
    const cmdManager = new CommandManager();
    const stateManager = new StateManager(undefined, cmdManager);

    assert.equal(cmdManager.canUndo(), false);
    assert.equal(cmdManager.canRedo(), false);

    const cmd = new ResizeArtboardCommand(stateManager, 1920, 1080, 1024, 768);
    cmd.execute();
    cmdManager.recordCommand(cmd);
    assert.equal(stateManager.getState().width, 1024);
    assert.equal(stateManager.getState().height, 768);
    assert.equal(cmdManager.canUndo(), true);

    // Deshacer
    cmdManager.undo();
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(cmdManager.canRedo(), true);

    // Rehacer
    cmdManager.redo();
    assert.equal(stateManager.getState().width, 1024);
    assert.equal(stateManager.getState().height, 768);
  });

  it('undo restaura exactamente las dimensiones anteriores y redo restaura exactamente las nuevas dimensiones cíclicamente', () => {
    const cmdManager = new CommandManager();
    const stateManager = new StateManager(undefined, cmdManager);

    const initialW = 1920;
    const initialH = 1080;
    const targetW = 1280;
    const targetH = 720;

    const cmd = new ResizeArtboardCommand(stateManager, initialW, initialH, targetW, targetH);
    cmd.execute();
    cmdManager.recordCommand(cmd);

    assert.equal(stateManager.getState().width, targetW);
    assert.equal(stateManager.getState().height, targetH);

    // Ciclo 1: Undo y Redo
    cmdManager.undo();
    assert.equal(stateManager.getState().width, initialW, 'Undo debe restaurar exactamente el ancho original');
    assert.equal(stateManager.getState().height, initialH, 'Undo debe restaurar exactamente el alto original');

    cmdManager.redo();
    assert.equal(stateManager.getState().width, targetW, 'Redo debe restaurar exactamente el nuevo ancho');
    assert.equal(stateManager.getState().height, targetH, 'Redo debe restaurar exactamente el nuevo alto');

    // Ciclo 2: Repetir para garantizar idempotencia
    cmdManager.undo();
    assert.equal(stateManager.getState().width, initialW);
    assert.equal(stateManager.getState().height, initialH);

    cmdManager.redo();
    assert.equal(stateManager.getState().width, targetW);
    assert.equal(stateManager.getState().height, targetH);
  });

  it('no afecta objetos, posiciones geométricas, jerarquía ni la selección activa del Scene Graph', () => {
    const cmdManager = new CommandManager();
    const stateManager = new StateManager(undefined, cmdManager);
    const layer = stateManager.getState().children[0];

    const rect: Rectangle = {
      id: 'rect-in-board',
      type: 'rectangle',
      name: 'Rectángulo Interior',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      fill: '#38bdf8',
      stroke: '#0284c7',
      strokeWidth: 2,
      rotation: 30,
      opacity: 0.9,
    };
    const ellipse: Ellipse = {
      id: 'ellipse-outside-board',
      type: 'ellipse',
      name: 'Elipse Exterior',
      x: 2500,
      y: 1500,
      radiusX: 80,
      radiusY: 40,
      fill: '#a855f7',
      stroke: '#7e22ce',
    };
    stateManager.addShape(layer.id, rect);
    stateManager.addShape(layer.id, ellipse);

    // Seleccionar ambas figuras
    stateManager.setSelection([rect.id, ellipse.id]);
    assert.deepEqual(stateManager.getSelection(), [rect.id, ellipse.id]);

    const docBefore = stateManager.getState();
    const shapesBeforeRef = docBefore.children[0].children;

    // Ejecutar redimensionado de mesa
    const cmd = new ResizeArtboardCommand(stateManager, 1920, 1080, 800, 600);
    cmd.execute();
    cmdManager.recordCommand(cmd);

    const docAfter = stateManager.getState();
    assert.equal(docAfter.width, 800);
    assert.equal(docAfter.height, 600);

    // Structural sharing: las capas e hijos son idénticos
    assert.equal(docAfter.children, docBefore.children, 'children de capas debe conservar structural sharing');
    assert.equal(docAfter.children[0].children, shapesBeforeRef, 'children de figuras debe ser idéntico');

    // Selección inalterada
    assert.deepEqual(stateManager.getSelection(), [rect.id, ellipse.id], 'La selección no debe cambiar tras ResizeArtboardCommand');

    // Deshacer
    cmdManager.undo();
    const docUndone = stateManager.getState();
    assert.equal(docUndone.width, 1920);
    assert.equal(docUndone.height, 1080);
    const shape0Undone = docUndone.children[0].children[0] as Rectangle;
    const shape1Undone = docUndone.children[0].children[1] as Ellipse;
    assert.equal(shape0Undone.x, 100);
    assert.equal(shape0Undone.y, 100);
    assert.equal(shape0Undone.rotation, 30);
    assert.equal(shape1Undone.x, 2500);
    assert.equal(shape1Undone.y, 1500);
    assert.deepEqual(stateManager.getSelection(), [rect.id, ellipse.id], 'La selección no debe cambiar tras Undo');

    // Rehacer
    cmdManager.redo();
    const docRedone = stateManager.getState();
    assert.equal(docRedone.width, 800);
    assert.equal(docRedone.height, 600);
    const shape0Redone = docRedone.children[0].children[0] as Rectangle;
    const shape1Redone = docRedone.children[0].children[1] as Ellipse;
    assert.equal(shape0Redone.x, 100);
    assert.equal(shape1Redone.x, 2500);
    assert.deepEqual(stateManager.getSelection(), [rect.id, ellipse.id], 'La selección no debe cambiar tras Redo');
  });

  it('se integra en la misma pila lineal de CommandManager intercalándose con otros comandos (AddShape, Translate) sin historial paralelo', () => {
    const cmdManager = new CommandManager();
    const stateManager = new StateManager(undefined, cmdManager);
    const layerId = stateManager.getState().children[0].id;

    // 1. Agregar figura (AddShapeCommand)
    const testShape: Rectangle = {
      id: 'interleaved-rect',
      type: 'rectangle',
      name: 'Figura Intercalada',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    };
    const addCmd = new AddShapeCommand(stateManager, testShape, layerId);
    addCmd.execute();
    cmdManager.recordCommand(addCmd);

    // 2. Redimensionar mesa a HD (1280x720)
    const resizeCmd1 = new ResizeArtboardCommand(stateManager, 1920, 1080, 1280, 720);
    resizeCmd1.execute();
    cmdManager.recordCommand(resizeCmd1);

    // 3. Trasladar figura de (50, 50) a (200, 250)
    const translateCmd = new TranslateCommand(stateManager, testShape.id, 50, 50, 200, 250);
    translateCmd.execute();
    cmdManager.recordCommand(translateCmd);

    // 4. Redimensionar mesa a Cuadrado (1080x1080)
    const resizeCmd2 = new ResizeArtboardCommand(stateManager, 1280, 720, 1080, 1080);
    resizeCmd2.execute();
    cmdManager.recordCommand(resizeCmd2);

    assert.equal(cmdManager.undoCount, 4);
    assert.equal(cmdManager.redoCount, 0);
    assert.equal(stateManager.getState().width, 1080);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.x, 200);

    // Deshacer 1: deshace segundo resize -> mesa vuelve a 1280x720, figura sigue en (200, 250)
    cmdManager.undo();
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.x, 200);

    // Deshacer 2: deshace translate -> figura vuelve a (50, 50), mesa sigue en 1280x720
    cmdManager.undo();
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.x, 50);
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.y, 50);
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);

    // Deshacer 3: deshace primer resize -> mesa vuelve a 1920x1080, figura sigue existiendo en (50, 50)
    cmdManager.undo();
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.x, 50);

    // Deshacer 4: deshace addShape -> figura desaparece, mesa sigue en 1920x1080
    cmdManager.undo();
    assert.equal(stateManager.findNode(testShape.id), null);
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(cmdManager.canUndo(), false);
    assert.equal(cmdManager.redoCount, 4);

    // Rehacer 4 pasos en orden estricto
    cmdManager.redo(); // Restaura figura
    assert.ok(stateManager.findNode(testShape.id) !== null);
    assert.equal(stateManager.getState().width, 1920);

    cmdManager.redo(); // Restaura primer resize (1280x720)
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);

    cmdManager.redo(); // Restaura translate a (200, 250)
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.x, 200);
    assert.equal(stateManager.getState().width, 1280);

    cmdManager.redo(); // Restaura segundo resize a (1080x1080)
    assert.equal(stateManager.getState().width, 1080);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal((stateManager.findNode(testShape.id) as Rectangle)?.x, 200);
    assert.equal(cmdManager.canRedo(), false);
  });

  it('la interfaz de usuario (inputs, presets y botones de historial) se sincroniza reactivamente durante Undo y Redo', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const btnUndo = new MockUIElement('btn-undo', 'button');
    const btnRedo = new MockUIElement('btn-redo', 'button');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#select-artboard-preset': selectPreset,
      '#btn-undo': btnUndo,
      '#btn-redo': btnRedo,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(btnUndo.disabled, true);
    assert.equal(btnRedo.disabled, true);

    // 1. Modificar ancho a 1280 mediante eventos de input y change
    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '1280';
    inputWidth.dispatchEvent({ type: 'input' });
    inputWidth.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(stateManager.getState().width, 1280);
    assert.equal(btnUndo.disabled, false);
    assert.equal(commandManager.undoCount, 1);

    // 2. Modificar alto a 720
    inputHeight.focus();
    (globalThis as any).document.activeElement = inputHeight;
    inputHeight.value = '720';
    inputHeight.dispatchEvent({ type: 'input' });
    inputHeight.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);
    assert.equal(selectPreset.value, 'hd');
    assert.equal(commandManager.undoCount, 2);

    // 3. Clic en botón Undo -> revierte alto a 1080
    btnUndo.dispatchEvent({ type: 'click' });
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1280');
    assert.equal(inputHeight.value, '1080');
    assert.equal(selectPreset.value, 'custom');
    assert.equal(btnRedo.disabled, false);

    // 4. Clic en botón Undo -> revierte ancho a 1920
    btnUndo.dispatchEvent({ type: 'click' });
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1920');
    assert.equal(inputHeight.value, '1080');
    assert.equal(selectPreset.value, 'full-hd');
    assert.equal(btnUndo.disabled, true);

    // 5. Clic en botón Redo -> rehace ancho a 1280
    btnRedo.dispatchEvent({ type: 'click' });
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1280');
    assert.equal(inputHeight.value, '1080');
    assert.equal(btnUndo.disabled, false);

    // 6. Clic en botón Redo -> rehace alto a 720
    btnRedo.dispatchEvent({ type: 'click' });
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);
    assert.equal(inputWidth.value, '1280');
    assert.equal(inputHeight.value, '720');
    assert.equal(selectPreset.value, 'hd');
    assert.equal(btnRedo.disabled, true);

    cleanup();
  });

  it('tras deshacer un cambio, modificar nuevamente las dimensiones registra un nuevo comando con las dimensiones restauradas como base', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const btnUndo = new MockUIElement('btn-undo', 'button');
    const btnRedo = new MockUIElement('btn-redo', 'button');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#select-artboard-preset': selectPreset,
      '#btn-undo': btnUndo,
      '#btn-redo': btnRedo,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Modificar a 1280
    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '1280';
    inputWidth.dispatchEvent({ type: 'input' });
    inputWidth.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(stateManager.getState().width, 1280);

    // Deshacer a 1920
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1920);

    // Modificar ahora a 800
    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '800';
    inputWidth.dispatchEvent({ type: 'input' });
    inputWidth.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(stateManager.getState().width, 800);

    // Al deshacer debe volver a 1920 (no a 1280)
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1920);

    cleanup();
  });
});

// Mock simple de elemento DOM para testear setupUIBindings
class MockUIElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public checked: boolean = false;
  public style: Record<string, string> = {};
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string, tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
  }

  public get classList() {
    return {
      add: (cls: string) => this.classes.add(cls),
      remove: (cls: string) => this.classes.delete(cls),
      contains: (cls: string) => this.classes.has(cls),
      toggle: (cls: string) => {
        if (this.classes.has(cls)) {
          this.classes.delete(cls);
          return false;
        }
        this.classes.add(cls);
        return true;
      },
    };
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public addEventListener(event: string, listener: (e: any) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  public removeEventListener(event: string, listener: (e: any) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  public focus(): void {
    const set = this.listeners.get('focus');
    if (set) {
      for (const listener of set) {
        listener({ type: 'focus', target: this, stopPropagation: () => {} });
      }
    }
  }

  public blur(): void {
    const set = this.listeners.get('blur');
    if (set) {
      for (const listener of set) {
        listener({ type: 'blur', target: this, stopPropagation: () => {} });
      }
    }
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) {
      e.stopPropagation = () => {};
    }
    if (!e.target) {
      e.target = this;
    }
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }
}

describe('Controles de UI de Mesa de Trabajo (setupUIBindings)', () => {
  it('inicializa los campos de ancho y alto con las dimensiones actuales del documento', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(inputWidth.value, '1920', 'El ancho inicial debe reflejar Document.width');
    assert.equal(inputHeight.value, '1080', 'El alto inicial debe reflejar Document.height');

    cleanup();
  });

  it('el evento input actualiza inmediatamente las dimensiones del Document en tiempo real', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Escribir 1440 en ancho
    inputWidth.value = '1440';
    inputWidth.dispatchEvent({ type: 'input' });

    assert.equal(stateManager.getState().width, 1440, 'StateManager debe reflejar inmediatamente el ancho');
    assert.equal(stateManager.getState().height, 1080, 'El alto no debe haberse alterado');

    // Escribir 900 en alto
    inputHeight.value = '900';
    inputHeight.dispatchEvent({ type: 'input' });

    assert.equal(stateManager.getState().width, 1440);
    assert.equal(stateManager.getState().height, 900, 'StateManager debe reflejar inmediatamente el alto');

    cleanup();
  });

  it('ignora valores inválidos o no positivos en evento input sin alterar el estado', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Entrada inválida: 0
    inputWidth.value = '0';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1920, 'No debe aceptar 0');

    // Entrada inválida: negativo
    inputWidth.value = '-250';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1920, 'No debe aceptar valores negativos');

    // Entrada inválida: texto o vacío
    inputWidth.value = 'abc';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1920, 'No debe aceptar texto');

    cleanup();
  });

  it('el evento change consolida la modificación y registra ResizeArtboardCommand en el historial', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Iniciar edición con focus
    inputWidth.focus();
    inputWidth.value = '1600';
    inputWidth.dispatchEvent({ type: 'input' });
    inputWidth.dispatchEvent({ type: 'change' });

    assert.equal(commandManager.canUndo(), true, 'Debe haber registrado un comando en CommandManager');
    assert.equal(stateManager.getState().width, 1600);

    // Deshacer el cambio de tamaño
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1920, 'Undo debe restaurar el ancho inicial');
    assert.equal(inputWidth.value, '1920', 'Undo debe sincronizar el campo de texto');

    // Rehacer el cambio de tamaño
    commandManager.redo();
    assert.equal(stateManager.getState().width, 1600, 'Redo debe reaplicar el nuevo ancho');
    assert.equal(inputWidth.value, '1600', 'Redo debe sincronizar el campo de texto');

    cleanup();
  });

  it('el evento change revierte el input al valor válido actual si el valor es 0, negativo o inválido', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    inputWidth.focus();
    inputWidth.value = '-100';
    inputWidth.dispatchEvent({ type: 'change' });

    assert.equal(inputWidth.value, '1920', 'Debe revertir a 1920');
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(commandManager.canUndo(), false, 'No debe registrar comandos para valores inválidos');

    cleanup();
  });

  it('la tecla Escape revierte la dimensión previa y cancela la edición', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    inputWidth.focus();
    inputWidth.value = '3840';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 3840);

    // Presionar Escape
    inputWidth.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(inputWidth.value, '1920', 'Escape debe restaurar el valor inicial');
    assert.equal(stateManager.getState().width, 1920, 'Escape debe restaurar el StateManager');

    cleanup();
  });

  it('cleanup() desvincula los event listeners de los inputs', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    cleanup();

    // Tras cleanup, los eventos no deben modificar el estado
    inputWidth.value = '500';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1920, 'No debe cambiar tras cleanup');
  });
});

describe('Bloquear proporción en el tamaño de la Mesa de Trabajo', () => {
  it('cuando está activo, modificar ancho recalcula alto proporcionalmente en tiempo real y permite Undo/Redo', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager(); // Inicial: 1920x1080 (16:9)
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Activar bloqueo de proporción
    checkRatio.checked = true;
    checkRatio.dispatchEvent({ type: 'change' });

    // Modificar ancho a 960 (la mitad de 1920)
    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '960';
    inputWidth.dispatchEvent({ type: 'input' });

    // El alto debe haberse recalculado proporcionalmente a 540 (la mitad de 1080)
    assert.equal(inputHeight.value, '540', 'El campo alto debe recalcularse a 540');
    assert.equal(stateManager.getState().width, 960);
    assert.equal(stateManager.getState().height, 540);

    // Confirmar cambio (change)
    inputWidth.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(commandManager.canUndo(), true);

    // Deshacer (Undo): debe restaurar ambos valores (1920x1080)
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1920');
    assert.equal(inputHeight.value, '1080');

    // Rehacer (Redo): debe reaplicar ambos valores (960x540)
    commandManager.redo();
    assert.equal(stateManager.getState().width, 960);
    assert.equal(stateManager.getState().height, 540);
    assert.equal(inputWidth.value, '960');
    assert.equal(inputHeight.value, '540');

    cleanup();
  });

  it('cuando está activo, modificar alto recalcula ancho proporcionalmente en tiempo real y permite Undo/Redo', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager(); // Inicial: 1920x1080
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Activar bloqueo de proporción
    checkRatio.checked = true;
    checkRatio.dispatchEvent({ type: 'change' });

    // Modificar alto al doble: 2160 (el ancho debe duplicarse a 3840)
    inputHeight.focus();
    (globalThis as any).document.activeElement = inputHeight;
    inputHeight.value = '2160';
    inputHeight.dispatchEvent({ type: 'input' });

    assert.equal(inputWidth.value, '3840', 'El campo ancho debe recalcularse a 3840');
    assert.equal(stateManager.getState().width, 3840);
    assert.equal(stateManager.getState().height, 2160);

    // Confirmar cambio (change)
    inputHeight.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(commandManager.canUndo(), true);

    // Deshacer (Undo)
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1920');
    assert.equal(inputHeight.value, '1080');

    // Rehacer (Redo)
    commandManager.redo();
    assert.equal(stateManager.getState().width, 3840);
    assert.equal(stateManager.getState().height, 2160);
    assert.equal(inputWidth.value, '3840');
    assert.equal(inputHeight.value, '2160');

    cleanup();
  });

  it('la proporción inicial se calcula a partir del Document actual (ej. 800x600 con ratio 4:3)', () => {
    const customDoc: Document = {
      id: 'doc-4-3',
      type: 'document',
      name: 'Custom 4:3',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-1',
          type: 'layer',
          name: 'Capa 1',
          children: [],
        },
      ],
    };

    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager(customDoc);
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(inputWidth.value, '800');
    assert.equal(inputHeight.value, '600');

    // Activar bloqueo con documento 800x600
    checkRatio.checked = true;
    checkRatio.dispatchEvent({ type: 'change' });

    // Modificar ancho a 400 -> alto debe ser 300 (4:3)
    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '400';
    inputWidth.dispatchEvent({ type: 'input' });

    assert.equal(inputHeight.value, '300');
    assert.equal(stateManager.getState().width, 400);
    assert.equal(stateManager.getState().height, 300);

    // Modificar alto a 1200 -> ancho debe ser 1600 (4:3)
    (globalThis as any).document.activeElement = inputHeight;
    inputHeight.focus();
    inputHeight.value = '1200';
    inputHeight.dispatchEvent({ type: 'input' });

    assert.equal(inputWidth.value, '1600');
    assert.equal(stateManager.getState().width, 1600);
    assert.equal(stateManager.getState().height, 1200);

    cleanup();
  });

  it('cuando Bloquear proporción NO está activo, las dimensiones se modifican independientemente', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    checkRatio.checked = false; // Inactivo

    // Cambiar solo ancho
    inputWidth.value = '1000';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1000);
    assert.equal(stateManager.getState().height, 1080, 'El alto no debe cambiar');
    assert.equal(inputHeight.value, '1080');

    // Cambiar solo alto
    inputHeight.value = '500';
    inputHeight.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1000, 'El ancho no debe cambiar');
    assert.equal(stateManager.getState().height, 500);
    assert.equal(inputWidth.value, '1000');

    cleanup();
  });

  it('no modifica objetos existentes en el Scene Graph al recalcular proporcionalmente', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const layer = stateManager.getState().children[0];
    const rect: Rectangle = {
      id: 'rect-in-artboard',
      type: 'rectangle',
      name: 'Rect 1',
      x: 100,
      y: 200,
      width: 300,
      height: 150,
    };
    stateManager.addShape(layer.id, rect);

    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    checkRatio.checked = true;
    checkRatio.dispatchEvent({ type: 'change' });

    inputWidth.value = '960';
    inputWidth.dispatchEvent({ type: 'input' });
    inputWidth.dispatchEvent({ type: 'change' });

    const shape = stateManager.findNode('rect-in-artboard') as Rectangle;
    assert.ok(shape, 'La figura debe permanecer en el árbol');
    assert.equal(shape.x, 100, 'x no debe cambiar');
    assert.equal(shape.y, 200, 'y no debe cambiar');
    assert.equal(shape.width, 300, 'width no debe cambiar');
    assert.equal(shape.height, 150, 'height no debe cambiar');

    cleanup();
  });

  it('con Bloquear proporción activo, valores inválidos (0, negativos) son ignorados y revertidos', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    checkRatio.checked = true;
    checkRatio.dispatchEvent({ type: 'change' });

    // Intento con valor negativo en ancho
    inputWidth.value = '-100';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1920, 'No debe aceptar negativos');
    assert.equal(stateManager.getState().height, 1080);

    inputWidth.dispatchEvent({ type: 'change' });
    assert.equal(inputWidth.value, '1920', 'Debe revertir ancho');
    assert.equal(inputHeight.value, '1080', 'Debe revertir alto');

    // Intento con valor 0 en alto
    inputHeight.value = '0';
    inputHeight.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080, 'No debe aceptar 0');

    inputHeight.dispatchEvent({ type: 'change' });
    assert.equal(inputWidth.value, '1920');
    assert.equal(inputHeight.value, '1080');

    cleanup();
  });

  it('con Bloquear proporción activo, la tecla Escape cancela y restaura ambas dimensiones', () => {
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const checkRatio = new MockUIElement('check-artboard-ratio', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#check-artboard-ratio': checkRatio,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    checkRatio.checked = true;
    checkRatio.dispatchEvent({ type: 'change' });

    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '960';
    inputWidth.dispatchEvent({ type: 'input' });
    assert.equal(stateManager.getState().width, 960);
    assert.equal(stateManager.getState().height, 540);

    // Cancelar con Escape
    inputWidth.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(inputWidth.value, '1920', 'Escape debe restaurar ancho');
    assert.equal(inputHeight.value, '1080', 'Escape debe restaurar alto');
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);

    cleanup();
  });
});

describe('Presets de tamaño de la Mesa de Trabajo (Definición y Búsqueda)', () => {
  it('contiene los presets requeridos con sus dimensiones exactas en píxeles', () => {
    const ids = ARTBOARD_PRESETS.map((p) => p.id);
    assert.deepEqual(ids, ['a4-portrait', 'a4-landscape', 'hd', 'full-hd', 'square']);

    const a4Portrait = getPresetById('a4-portrait');
    assert.ok(a4Portrait);
    assert.equal(a4Portrait?.width, 794);
    assert.equal(a4Portrait?.height, 1123);

    const a4Landscape = getPresetById('a4-landscape');
    assert.ok(a4Landscape);
    assert.equal(a4Landscape?.width, 1123);
    assert.equal(a4Landscape?.height, 794);

    const hd = getPresetById('hd');
    assert.ok(hd);
    assert.equal(hd?.width, 1280);
    assert.equal(hd?.height, 720);

    const fullHd = getPresetById('full-hd');
    assert.ok(fullHd);
    assert.equal(fullHd?.width, 1920);
    assert.equal(fullHd?.height, 1080);

    const square = getPresetById('square');
    assert.ok(square);
    assert.equal(square?.width, 1080);
    assert.equal(square?.height, 1080);
  });

  it('findPresetForSize identifica el preset correspondiente o retorna null si es personalizado', () => {
    assert.equal(findPresetForSize(794, 1123)?.id, 'a4-portrait');
    assert.equal(findPresetForSize(1123, 794)?.id, 'a4-landscape');
    assert.equal(findPresetForSize(1280, 720)?.id, 'hd');
    assert.equal(findPresetForSize(1920, 1080)?.id, 'full-hd');
    assert.equal(findPresetForSize(1080, 1080)?.id, 'square');

    assert.equal(findPresetForSize(1500, 900), null, 'Dimensiones arbitrarias deben retornar null (Personalizado)');
    assert.equal(findPresetForSize(1920, 1000), null);
  });

  it('getPresetById retorna undefined para IDs inexistentes', () => {
    assert.equal(getPresetById('inexistente'), undefined);
    assert.equal(getPresetById('custom'), undefined);
  });
});

describe('Selección de Presets de Mesa de Trabajo (setupUIBindings)', () => {
  it('inicializa el selector de presets según las dimensiones del documento actual', () => {
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager(); // Por defecto: 1920x1080
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(selectPreset.value, 'full-hd', 'Debe reconocer inicialmente Full HD (1920x1080)');

    cleanup();
  });

  it('muestra "custom" si las dimensiones iniciales del documento no coinciden con ningún preset', () => {
    const customDoc: Document = {
      id: 'doc-custom',
      type: 'document',
      name: 'Custom',
      width: 1400,
      height: 900,
      children: [{ id: 'l1', type: 'layer', name: 'Capa 1', children: [] }],
    };

    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager(customDoc);
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(selectPreset.value, 'custom', 'Debe reflejar "custom" para 1400x900');

    cleanup();
  });

  it('seleccionar A4 vertical actualiza Document y los inputs a 794 × 1123 px inmediatamente', () => {
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Seleccionar A4 vertical
    selectPreset.value = 'a4-portrait';
    selectPreset.dispatchEvent({ type: 'change' });

    assert.equal(stateManager.getState().width, 794);
    assert.equal(stateManager.getState().height, 1123);
    assert.equal(inputWidth.value, '794');
    assert.equal(inputHeight.value, '1123');
    assert.equal(stateManager.isDirty, true, 'Debe marcar isDirty para renderizado inmediato');

    cleanup();
  });

  it('seleccionar A4 horizontal actualiza Document y los inputs a 1123 × 794 px inmediatamente', () => {
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Seleccionar A4 horizontal
    selectPreset.value = 'a4-landscape';
    selectPreset.dispatchEvent({ type: 'change' });

    assert.equal(stateManager.getState().width, 1123);
    assert.equal(stateManager.getState().height, 794);
    assert.equal(inputWidth.value, '1123');
    assert.equal(inputHeight.value, '794');

    cleanup();
  });

  it('seleccionar HD actualiza a 1280 × 720 px, y Cuadrado a 1080 × 1080 px', () => {
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Cambiar a HD
    selectPreset.value = 'hd';
    selectPreset.dispatchEvent({ type: 'change' });

    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);
    assert.equal(inputWidth.value, '1280');
    assert.equal(inputHeight.value, '720');

    // Cambiar a Cuadrado
    selectPreset.value = 'square';
    selectPreset.dispatchEvent({ type: 'change' });

    assert.equal(stateManager.getState().width, 1080);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1080');
    assert.equal(inputHeight.value, '1080');

    cleanup();
  });

  it('la selección de presets se integra con CommandManager y permite Undo/Redo sincronizando el selector', () => {
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager(); // 1920x1080
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(selectPreset.value, 'full-hd');

    // Cambiar a A4 vertical
    selectPreset.value = 'a4-portrait';
    selectPreset.dispatchEvent({ type: 'change' });

    assert.equal(stateManager.getState().width, 794);
    assert.equal(stateManager.getState().height, 1123);
    assert.equal(commandManager.canUndo(), true);

    // Deshacer (Undo) -> debe volver a Full HD
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1920');
    assert.equal(inputHeight.value, '1080');
    assert.equal(selectPreset.value, 'full-hd', 'El selector debe volver a Full HD tras Undo');

    // Rehacer (Redo) -> debe volver a A4 vertical
    commandManager.redo();
    assert.equal(stateManager.getState().width, 794);
    assert.equal(stateManager.getState().height, 1123);
    assert.equal(inputWidth.value, '794');
    assert.equal(inputHeight.value, '1123');
    assert.equal(selectPreset.value, 'a4-portrait', 'El selector debe volver a A4 vertical tras Redo');

    cleanup();
  });

  it('modificar manualmente el ancho o alto a una medida arbitraria cambia automáticamente el selector a "custom"', () => {
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');

    const domMap: Record<string, MockUIElement> = {
      '#select-artboard-preset': selectPreset,
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(selectPreset.value, 'full-hd');

    // Cambiar manualmente el ancho a 1500
    inputWidth.focus();
    (globalThis as any).document.activeElement = inputWidth;
    inputWidth.value = '1500';
    inputWidth.dispatchEvent({ type: 'input' });
    inputWidth.dispatchEvent({ type: 'change' });
    (globalThis as any).document.activeElement = null;

    assert.equal(selectPreset.value, 'custom', 'Al cambiar manualmente a una medida arbitraria el selector debe ser "custom"');

    cleanup();
  });
});

describe('Persistencia de la Mesa de Trabajo (Exportación, Importación y Validaciones)', () => {
  it('1. exportar un documento conserva width y height en el JSON resultante', () => {
    const manager = new StateManager();
    manager.setDocumentSize(1280, 720);
    const doc = manager.getState();

    // Exportar con formato pretty
    const prettyJson = serializeDocument(doc, true);
    assert.ok(prettyJson.includes('"width": 1280'));
    assert.ok(prettyJson.includes('"height": 720'));
    const parsedPretty = JSON.parse(prettyJson);
    assert.equal(parsedPretty.width, 1280);
    assert.equal(parsedPretty.height, 720);

    // Exportar con formato compacto
    const compactJson = serializeDocument(doc, false);
    const parsedCompact = JSON.parse(compactJson);
    assert.equal(parsedCompact.width, 1280);
    assert.equal(parsedCompact.height, 720);
  });

  it('2. importar un documento conserva width y height y actualiza el StateManager y la UI', async () => {
    const jsonToImport = JSON.stringify({
      id: 'doc-imported-test',
      type: 'document',
      name: 'Documento Importado',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-import-1',
          type: 'layer',
          name: 'Capa 1',
          children: [],
        },
      ],
    });

    // parseDocument valida y deserializa
    const importedDoc = await parseDocument(jsonToImport);
    assert.equal(importedDoc.width, 800);
    assert.equal(importedDoc.height, 600);

    // Configurar entorno DOM para verificar reactividad de UI
    const inputWidth = new MockUIElement('input-artboard-width', 'input');
    const inputHeight = new MockUIElement('input-artboard-height', 'input');
    const selectPreset = new MockUIElement('select-artboard-preset', 'select');

    const domMap: Record<string, MockUIElement> = {
      '#input-artboard-width': inputWidth,
      '#input-artboard-height': inputHeight,
      '#select-artboard-preset': selectPreset,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => domMap[sel] || null,
      querySelectorAll: () => [],
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Dimensiones iniciales del manager por defecto (1920x1080)
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);
    assert.equal(inputWidth.value, '1920');
    assert.equal(inputHeight.value, '1080');

    // Cargar el documento importado
    stateManager.loadState(importedDoc);

    // StateManager conserva las dimensiones
    assert.equal(stateManager.getState().width, 800);
    assert.equal(stateManager.getState().height, 600);

    // La UI reacciona y actualiza los campos de entrada
    assert.equal(inputWidth.value, '800');
    assert.equal(inputHeight.value, '600');
    assert.equal(selectPreset.value, 'custom');

    cleanup();
  });

  it('3. un documento antiguo válido sigue funcionando completamente tras serialización y carga', async () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    const layer0 = manager.getState().children[0];

    // Agregar figura con rotación, opacidad y estilos
    const customRect: Rectangle = {
      id: 'rect-legacy-test',
      type: 'rectangle',
      name: 'Rectángulo Legado',
      x: 150,
      y: 250,
      width: 300,
      height: 150,
      fill: '#f43f5e',
      stroke: '#881337',
      strokeWidth: 4,
      rotation: 45,
      opacity: 0.8,
      cornerRadius: 8,
    };
    manager.addShape(layer0.id, customRect);

    // Agregar un trazado con curvas Bézier
    const customPath: Path = {
      id: 'path-legacy-test',
      type: 'path',
      name: 'Trazado Legado',
      x: 50,
      y: 50,
      points: [
        { x: 50, y: 50, handleOut: { x: 70, y: 30 } },
        { x: 200, y: 200, handleIn: { x: 180, y: 220 } },
      ],
      closed: true,
      fill: '#10b981',
      stroke: '#047857',
      strokeWidth: 2,
    };
    manager.addShape(layer0.id, customPath);

    const docBefore = manager.getState();
    assert.equal(docBefore.width, 1920);
    assert.equal(docBefore.height, 1080);

    // Serializar
    const serialized = serializeDocument(docBefore);

    // Parsear
    const parsedDoc = await parseDocument(serialized);
    assert.equal(parsedDoc.type, 'document');
    assert.equal(parsedDoc.width, 1920);
    assert.equal(parsedDoc.height, 1080);
    assert.equal(parsedDoc.children.length, docBefore.children.length);

    // Cargar en nuevo StateManager
    const newManager = new StateManager();
    newManager.loadState(parsedDoc);

    const docAfter = newManager.getState();
    assert.equal(docAfter.width, 1920);
    assert.equal(docAfter.height, 1080);

    // El documento cargado es totalmente operativo: se pueden modificar dimensiones normalmente
    newManager.setDocumentSize(1000, 1000);
    assert.equal(newManager.getState().width, 1000);
    assert.equal(newManager.getState().height, 1000);
  });

  it('4. las validaciones existentes continúan funcionando y rechazan documentos con dimensiones inválidas o estructura corrupta', async () => {
    // A) Falta width
    const missingWidthJson = JSON.stringify({
      id: 'doc-invalid',
      type: 'document',
      name: 'Sin Ancho',
      height: 600,
      children: [],
    });
    await assert.rejects(
      async () => parseDocument(missingWidthJson),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /width debe ser un número finito > 0/);
        return true;
      }
    );

    // B) width = 0
    const zeroWidthJson = JSON.stringify({
      id: 'doc-invalid',
      type: 'document',
      name: 'Ancho Cero',
      width: 0,
      height: 600,
      children: [],
    });
    await assert.rejects(
      async () => parseDocument(zeroWidthJson),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /width debe ser un número finito > 0/);
        return true;
      }
    );

    // C) width negativo
    const negativeWidthJson = JSON.stringify({
      id: 'doc-invalid',
      type: 'document',
      name: 'Ancho Negativo',
      width: -500,
      height: 600,
      children: [],
    });
    await assert.rejects(
      async () => parseDocument(negativeWidthJson),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /width debe ser un número finito > 0/);
        return true;
      }
    );

    // D) width no numérico / string
    const stringWidthJson = JSON.stringify({
      id: 'doc-invalid',
      type: 'document',
      name: 'Ancho String',
      width: '1000',
      height: 600,
      children: [],
    });
    await assert.rejects(
      async () => parseDocument(stringWidthJson),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /width debe ser un número finito > 0/);
        return true;
      }
    );

    // E) Falta height
    const missingHeightJson = JSON.stringify({
      id: 'doc-invalid',
      type: 'document',
      name: 'Sin Alto',
      width: 800,
      children: [],
    });
    await assert.rejects(
      async () => parseDocument(missingHeightJson),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /height debe ser un número finito > 0/);
        return true;
      }
    );

    // F) height <= 0
    const zeroHeightJson = JSON.stringify({
      id: 'doc-invalid',
      type: 'document',
      name: 'Alto Cero',
      width: 800,
      height: 0,
      children: [],
    });
    await assert.rejects(
      async () => parseDocument(zeroHeightJson),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /height debe ser un número finito > 0/);
        return true;
      }
    );

    // G) Sintaxis JSON corrupta
    await assert.rejects(
      async () => parseDocument('{ "type": "document", width: corrupt }'),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        assert.match(err.message, /Sintaxis JSON inválida/);
        return true;
      }
    );

    // H) Raíz inválida (no objeto)
    await assert.rejects(
      async () => parseDocument('["array"]'),
      (err: any) => {
        assert.ok(err instanceof DocumentParseError);
        return true;
      }
    );
  });

  it('5. Fit Artboard funciona después de importar encajando el viewport a las nuevas dimensiones de la mesa', async () => {
    const canvasSize = { width: 800, height: 600 };
    const viewportManager = new ViewportManager();

    // Documento a importar: 1440 × 900
    const jsonImport = JSON.stringify({
      id: 'doc-imported-fit',
      type: 'document',
      name: 'Doc Fit',
      width: 1440,
      height: 900,
      children: [
        {
          id: 'layer-fit-1',
          type: 'layer',
          name: 'Capa Fit',
          children: [
            {
              id: 'rect-fit-1',
              type: 'rectangle',
              name: 'Rect Fit',
              x: 100,
              y: 100,
              width: 200,
              height: 200,
              fill: '#00ff00',
              stroke: '#000000',
              strokeWidth: 1,
            },
          ],
        },
      ],
    });

    const parsedDoc = await parseDocument(jsonImport);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const { canvas } = createMockCanvas(800, 600);
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    // Cargar estado importado
    stateManager.loadState(parsedDoc);
    assert.equal(stateManager.getState().width, 1440);
    assert.equal(stateManager.getState().height, 900);

    // Ajustar a los límites de la Mesa de Trabajo (0, 0, doc.width, doc.height)
    const artboardBounds = {
      minX: 0,
      minY: 0,
      maxX: parsedDoc.width,
      maxY: parsedDoc.height,
      width: parsedDoc.width,
      height: parsedDoc.height,
    };
    viewportManager.fitToBounds(canvasSize, artboardBounds, 40);

    // Con canvas 800x600 y margen 40:
    // ancho disponible = 800 - 80 = 720
    // alto disponible = 600 - 80 = 520
    // scaleX = 720 / 1440 = 0.5
    // scaleY = 520 / 900 = 0.5777...
    // zoom esperado = min(0.5, 0.5777) = 0.5
    assert.equal(Math.abs(viewportManager.zoom - 0.5) < 1e-4, true);

    // Centro del artboard (720, 450) debe proyectarse en el centro del canvas (400, 300):
    // panX = 400 - 720 * 0.5 = 40
    // panY = 300 - 450 * 0.5 = 75
    assert.equal(Math.abs(viewportManager.panX - 40) < 1e-4, true);
    assert.equal(Math.abs(viewportManager.panY - 75) < 1e-4, true);

    // Ejecutar zoomFit() de InputController después de importar
    inputController.zoomFit();
    assert.ok(viewportManager.zoom > 0);
  });

  it('6. cambiar el tamaño y luego exportar conserva las nuevas dimensiones (con y sin Undo/Redo)', async () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    stateManager.setCommandManager(commandManager);

    // Dimensiones iniciales
    assert.equal(stateManager.getState().width, 1920);
    assert.equal(stateManager.getState().height, 1080);

    // 1) Cambiar tamaño mediante ResizeArtboardCommand a HD (1280 × 720)
    const resizeHdCmd = new ResizeArtboardCommand(stateManager, 1920, 1080, 1280, 720);
    resizeHdCmd.execute();
    commandManager.recordCommand(resizeHdCmd);

    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);

    // Exportar y verificar que conserva 1280 × 720
    const hdJson = serializeDocument(stateManager.getState());
    const parsedHd = await parseDocument(hdJson);
    assert.equal(parsedHd.width, 1280);
    assert.equal(parsedHd.height, 720);

    // 2) Cambiar nuevamente a A4 vertical (794 × 1123)
    const resizeA4Cmd = new ResizeArtboardCommand(stateManager, 1280, 720, 794, 1123);
    resizeA4Cmd.execute();
    commandManager.recordCommand(resizeA4Cmd);

    assert.equal(stateManager.getState().width, 794);
    assert.equal(stateManager.getState().height, 1123);

    // Exportar y verificar que conserva 794 × 1123
    const a4Json = serializeDocument(stateManager.getState());
    const parsedA4 = await parseDocument(a4Json);
    assert.equal(parsedA4.width, 794);
    assert.equal(parsedA4.height, 1123);

    // 3) Deshacer (Undo) -> vuelve a 1280 × 720 y exportar conserva 1280 × 720
    commandManager.undo();
    assert.equal(stateManager.getState().width, 1280);
    assert.equal(stateManager.getState().height, 720);

    const undoJson = serializeDocument(stateManager.getState());
    const parsedUndo = await parseDocument(undoJson);
    assert.equal(parsedUndo.width, 1280);
    assert.equal(parsedUndo.height, 720);

    // 4) Rehacer (Redo) -> vuelve a 794 × 1123 y exportar conserva 794 × 1123
    commandManager.redo();
    assert.equal(stateManager.getState().width, 794);
    assert.equal(stateManager.getState().height, 1123);

    const redoJson = serializeDocument(stateManager.getState());
    const parsedRedo = await parseDocument(redoJson);
    assert.equal(parsedRedo.width, 794);
    assert.equal(parsedRedo.height, 1123);
  });
});



