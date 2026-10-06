import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ResizeArtboardCommand } from '../src/commands/ResizeArtboardCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
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
});

// Mock simple de elemento DOM para testear setupUIBindings
class MockUIElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
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

