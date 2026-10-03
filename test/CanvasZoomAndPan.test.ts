import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { InputController } from '../src/input/InputController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

// Helper mock para Canvas y Context2D
function createMockCanvas(width: number = 800, height: number = 600) {
  const transformCalls: number[][] = [];
  const strokes: { lineWidth: number; strokeStyle?: string }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const fillRects: { x: number; y: number; w: number; h: number }[] = [];
  const strokeRects: { x: number; y: number; w: number; h: number }[] = [];
  const lineDashes: number[][] = [];
  const eventListeners = new Map<string, Function[]>();

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => {},
    restore: () => {},
    setTransform: (a?: any, b?: any, c?: any, d?: any, e?: any, f?: any) => {
      if (typeof a === 'number') {
        transformCalls.push([a, b, c, d, e, f]);
      }
    },
    clearRect: () => {},
    fillRect: (x, y, w, h) => {
      fillRects.push({ x, y, w, h });
    },
    strokeRect: (x, y, w, h) => {
      strokeRects.push({ x, y, w, h });
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {
      strokes.push({ lineWidth: mockCtx.lineWidth ?? 1, strokeStyle: mockCtx.strokeStyle as string });
    },
    fill: () => {},
    arc: () => {},
    rect: (x, y, w, h) => {
      rects.push({ x, y, w, h });
    },
    roundRect: (x, y, w, h) => {
      rects.push({ x, y, w, h });
    },
    ellipse: () => {},
    translate: () => {},
    rotate: () => {},
    setLineDash: (segments: number[]) => {
      lineDashes.push([...segments]);
    },
    isPointInPath: () => true,
    isPointInStroke: () => true,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };

  const canvas = {
    width,
    height,
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      width,
      height,
      top: 50,
      left: 100,
      right: 100 + width,
      bottom: 50 + height,
    }),
    getContext: (id: string) => {
      if (id === '2d') return mockCtx as CanvasRenderingContext2D;
      return null;
    },
    addEventListener: (type: string, handler: Function, _options?: any) => {
      let list = eventListeners.get(type);
      if (!list) {
        list = [];
        eventListeners.set(type, list);
      }
      list.push(handler);
    },
    removeEventListener: (type: string, handler: Function) => {
      const list = eventListeners.get(type);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    mockCtx,
    transformCalls,
    strokes,
    rects,
    fillRects,
    strokeRects,
    lineDashes,
    eventListeners,
  };
}

describe('Integración de Vista (Viewport, Zoom y Pan)', () => {
  describe('A) RenderEngine con Viewport', () => {
    it('aplica la matriz de vista combinada con DPR en ctx.setTransform', () => {
      const { canvas, transformCalls } = createMockCanvas(800, 600);
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager({ zoom: 2, panX: 150, panY: -80 });

      const engine = new RenderEngine(canvas, stateManager, {
        highDpi: false,
        viewportManager,
      });

      engine.render();

      // Debe haber llamado a setTransform aplicando zoom y pan
      // setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY)
      // Con dpr = 1: [2, 0, 0, 2, 150, -80]
      const viewMatrix = transformCalls.find(
        (call) => call[0] === 2 && call[3] === 2 && call[4] === 150 && call[5] === -80
      );
      assert.ok(viewMatrix, 'Debe aplicar la matriz de vista [2, 0, 0, 2, 150, -80]');
    });

    it('se suscribe a ViewportManager y redibuja al cambiar zoom o pan', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager();

      const engine = new RenderEngine(canvas, stateManager, {
        highDpi: false,
        viewportManager,
      });
      assert.ok(engine);

      stateManager.clearDirty();
      assert.equal(stateManager.isDirty, false);

      viewportManager.setViewport({ zoom: 3, panX: 100, panY: 50 });
      assert.equal(stateManager.isDirty, true, 'El cambio de viewport debe marcar isDirty');
    });

    it('los elementos de interfaz mantienen tamaño CONSTANTE en pantalla (dividido por zoom)', () => {
      const { canvas, strokeRects } = createMockCanvas();
      const stateManager = new StateManager();
      const targetLayer = stateManager.getState().children[0];

      const rect: Rectangle = {
        id: 'rect-test-1',
        type: 'rectangle',
        name: 'Rect 1',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        fill: '#38bdf8',
        selected: true,
      };
      stateManager.addShape(targetLayer.id, rect);

      const zoom = 4;
      const viewportManager = new ViewportManager({ zoom, panX: 0, panY: 0 });

      const engine = new RenderEngine(canvas, stateManager, {
        highDpi: false,
        viewportManager,
      });

      engine.render();

      // Tiradores de selección: handleSize debe ser 8 / zoom = 2
      const handleRect = strokeRects.find((r) => Math.abs(r.w - 8 / zoom) < 0.001);
      assert.ok(handleRect, `El manejador debe tener ancho 8 / zoom = ${8 / zoom}`);
      assert.equal(handleRect?.w, 2);
      assert.equal(handleRect?.h, 2);
    });

    it('la cuadrícula ajusta su grosor (1 / zoom) y su paso adaptativo según el zoom', () => {
      const { canvas, strokes } = createMockCanvas();
      const stateManager = new StateManager();
      const zoom = 0.5;
      const viewportManager = new ViewportManager({ zoom, panX: 0, panY: 0 });

      const engine = new RenderEngine(canvas, stateManager, {
        highDpi: false,
        viewportManager,
      });

      engine.render();

      // Trazo de la cuadrícula con zoom 0.5 debe tener lineWidth = 1 / 0.5 = 2
      const gridStroke = strokes.find((s) => Math.abs(s.lineWidth - 1 / zoom) < 0.001);
      assert.ok(gridStroke, 'La cuadrícula debe tener lineWidth = 1 / zoom = 2');
    });
  });

  describe('B) InputController: Coordenadas y Hit-Testing', () => {
    it('getLocalCoordinates mapea coordenadas de pantalla a coordenadas del documento con zoom y pan', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager({ zoom: 2, panX: 100, panY: 50 });

      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      // Canvas rect: left: 100, top: 50
      // Mouse clientX: 300, clientY: 150
      // screenX = 300 - 100 = 200, screenY = 150 - 50 = 100
      // worldX = (200 - 100) / 2 = 50
      // worldY = (100 - 50) / 2 = 25
      const mouseEvent = { clientX: 300, clientY: 150 } as MouseEvent;
      const worldPos = controller.getLocalCoordinates(mouseEvent);

      assert.equal(worldPos.x, 50);
      assert.equal(worldPos.y, 25);
    });

    it('la tolerancia de hit test se divide por el zoom (constante en pantalla)', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const targetLayer = stateManager.getState().children[0];

      const rect: Rectangle = {
        id: 'rect-hit',
        type: 'rectangle',
        name: 'Rect Hit',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#38bdf8',
      };
      stateManager.addShape(targetLayer.id, rect);

      // Con zoom = 2, la tolerancia de 4px en pantalla equivale a 2 unidades del documento
      const viewportManager = new ViewportManager({ zoom: 2, panX: 0, panY: 0 });
      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      // Punto justo 1.5 unidades fuera del borde (dentro de la tolerancia de 2 unidades)
      const hit = controller.hitTest(201.5, 150);
      assert.ok(hit, 'Debe detectar clic dentro de la tolerancia de pantalla');

      // Punto a 3 unidades fuera (fuera de la tolerancia de 2 unidades)
      const miss = controller.hitTest(203, 150);
      assert.equal(miss, null, 'Debe fallar fuera de la tolerancia de pantalla');
    });

    it('hit-test sobre tiradores de selección escala con el zoom', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const targetLayer = stateManager.getState().children[0];

      const rect: Rectangle = {
        id: 'rect-handles',
        type: 'rectangle',
        name: 'Rect Handles',
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        fill: '#38bdf8',
        selected: true,
      };
      stateManager.addShape(targetLayer.id, rect);

      // Con zoom 4, el tirador de rotación está a 30 / 4 = 7.5 unidades arriba del borde superior
      const zoom = 4;
      const viewportManager = new ViewportManager({ zoom, panX: 0, panY: 0 });
      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      // rotY = 200 - (30 / 4) = 192.5. midX = 250
      // Simular mousedown en la coordenada del tirador de rotación
      // Canvas left = 100, top = 50
      // screenX = worldX * 4 + 0 = 250 * 4 = 1000 -> clientX = 1000 + 100 = 1100
      // screenY = worldY * 4 + 0 = 192.5 * 4 = 770 -> clientY = 770 + 50 = 820
      controller.handleMouseDown({ clientX: 1100, clientY: 820, button: 0 } as MouseEvent);

      assert.equal(controller.isRotating, true, 'Debe detectar colisión con manejador de rotación a escala zoom');
    });
  });

  describe('B) InputController: Transformaciones y Creación con Zoom', () => {
    it('mover una figura por arrastre traslada exactamente las unidades del documento', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const targetLayer = stateManager.getState().children[0];

      const rect: Rectangle = {
        id: 'rect-drag',
        type: 'rectangle',
        name: 'Rect Drag',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        fill: '#38bdf8',
        selected: true,
      };
      stateManager.addShape(targetLayer.id, rect);

      const zoom = 2;
      const viewportManager = new ViewportManager({ zoom, panX: 50, panY: 50 });
      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      // Punto inicial en pantalla:
      // world: (120, 120)
      // screen = world * 2 + 50 = 290
      // client = screen + rect = 290 + 100 = 390
      controller.handleMouseDown({ clientX: 390, clientY: 390, button: 0 } as MouseEvent);
      assert.equal(controller.isDragging, true);

      // Arrastrar 40 píxeles de pantalla a la derecha (= 20 unidades del documento)
      // nuevo clientX = 390 + 40 = 430
      controller.handleMouseMove({ clientX: 430, clientY: 390 } as MouseEvent);
      controller.handleMouseUp({ clientX: 430, clientY: 390 } as MouseEvent);

      const updated = stateManager.findNode('rect-drag') as Rectangle;
      assert.equal(updated.x, 120, 'Debe haberse movido 20 unidades en x (40px / zoom 2)');
      assert.equal(updated.y, 100);
    });

    it('crear un rectángulo arrastrando funciona a zoom 0.5x y respeta el umbral mínimo', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const zoom = 0.5;
      const viewportManager = new ViewportManager({ zoom, panX: 0, panY: 0 });
      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      controller.setTool('rectangle');

      // Arrastre muy pequeño: 2px en pantalla -> 4 unidades mundo
      // pero el umbral en pantalla es 3px (distancia < 3 / 0.5 = 6 unidades)
      controller.handleMouseDown({ clientX: 100, clientY: 50, button: 0 } as MouseEvent);
      controller.handleMouseUp({ clientX: 102, clientY: 50, button: 0 } as MouseEvent);

      // No debe haberse creado la figura
      assert.equal(stateManager.getState().children[0].children.length, 0);

      // Ahora arrastre mayor: 20px en pantalla -> 40 unidades en el mundo
      controller.setTool('rectangle');
      controller.handleMouseDown({ clientX: 100, clientY: 50, button: 0 } as MouseEvent);
      controller.handleMouseUp({ clientX: 120, clientY: 70, button: 0 } as MouseEvent);

      const shapes = stateManager.getState().children[0].children;
      assert.equal(shapes.length, 1);
      const newRect = shapes[0] as Rectangle;
      assert.equal(newRect.type, 'rectangle');
      assert.equal(newRect.width, 40); // 20px / 0.5
      assert.equal(newRect.height, 40);
    });

    it('las flechas del teclado mueven en unidades del documento (1 y 10) a cualquier zoom', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const targetLayer = stateManager.getState().children[0];

      const rect: Rectangle = {
        id: 'rect-arrow',
        type: 'rectangle',
        name: 'Rect Arrow',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        fill: '#38bdf8',
        selected: true,
      };
      stateManager.addShape(targetLayer.id, rect);

      const viewportManager = new ViewportManager({ zoom: 5, panX: 200, panY: 200 });
      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      // Flecha derecha: 1 unidad
      controller.handleKeyDown({ key: 'ArrowRight' } as KeyboardEvent);
      let updated = stateManager.findNode('rect-arrow') as Rectangle;
      assert.equal(updated.x, 101, 'Debe avanzar 1 unidad de documento');

      // Shift + Flecha abajo: 10 unidades
      controller.handleKeyDown({ key: 'ArrowDown', shiftKey: true } as KeyboardEvent);
      updated = stateManager.findNode('rect-arrow') as Rectangle;
      assert.equal(updated.y, 110, 'Debe avanzar 10 unidades de documento');
    });
  });

  describe('B) Gestos de Navegación (Zoom y Pan)', () => {
    it('Ctrl + Rueda hace zoom hacia la posición del cursor con factor exponencial', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      // Simular zoom in con Ctrl + rueda centrada en clientX: 200, clientY: 150
      // Screen = (100, 100)
      let prevented = false;
      const wheelEvent = {
        clientX: 200,
        clientY: 150,
        ctrlKey: true,
        deltaY: -100,
        deltaX: 0,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as WheelEvent;

      controller.handleWheel(wheelEvent);

      assert.ok(prevented, 'Debe invocar preventDefault');
      assert.ok(viewportManager.zoom > 1, 'El zoom debe haber aumentado');

      // Verificar que el punto bajo el cursor se mantuvo constante
      const screenPos = { x: 100, y: 100 };
      const worldPosAfter = viewportManager.screenToWorld(screenPos);
      assert.ok(Math.abs(worldPosAfter.x - 100) < 0.001);
      assert.ok(Math.abs(worldPosAfter.y - 100) < 0.001);
    });

    it('Rueda estándar desplaza la vista (panBy) sin modificar zoom', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager({ zoom: 1.5, panX: 50, panY: 50 });

      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      let prevented = false;
      const wheelEvent = {
        clientX: 200,
        clientY: 150,
        ctrlKey: false,
        metaKey: false,
        deltaX: 30,
        deltaY: 40,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as WheelEvent;

      controller.handleWheel(wheelEvent);

      assert.ok(prevented);
      assert.equal(viewportManager.zoom, 1.5, 'El zoom no debe cambiar');
      assert.equal(viewportManager.panX, 20); // 50 - 30
      assert.equal(viewportManager.panY, 10); // 50 - 40
    });

    it('Espacio + Arrastrar desplaza la vista y restaura cursor y herramienta al soltar', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      controller.setTool('pen');
      assert.equal(canvas.style.cursor, 'crosshair');

      // 1. Presionar barra espaciadora
      let preventedKey = false;
      controller.handleKeyDown({
        key: ' ',
        code: 'Space',
        preventDefault: () => {
          preventedKey = true;
        },
      } as unknown as KeyboardEvent);

      assert.ok(preventedKey);
      assert.equal(controller.isSpacePressed, true);
      assert.equal(canvas.style.cursor, 'grab');

      // 2. Mousedown con botón principal (0)
      controller.handleMouseDown({ clientX: 200, clientY: 200, button: 0 } as MouseEvent);
      assert.equal(controller.isPanning, true);
      assert.equal(canvas.style.cursor, 'grabbing');

      // 3. Mousemove arrastrando 50px en x y 30px en y
      controller.handleMouseMove({ clientX: 250, clientY: 230 } as MouseEvent);
      assert.equal(viewportManager.panX, 50);
      assert.equal(viewportManager.panY, 30);

      // 4. Mouseup
      controller.handleMouseUp({ clientX: 250, clientY: 230 } as MouseEvent);
      assert.equal(controller.isPanning, false);
      assert.equal(canvas.style.cursor, 'grab');

      // 5. Soltar barra espaciadora
      controller.handleKeyUp({ key: ' ', code: 'Space' } as KeyboardEvent);
      assert.equal(controller.isSpacePressed, false);
      assert.equal(canvas.style.cursor, 'crosshair', 'Debe restaurar el cursor de la pluma');
      assert.equal(controller.currentTool, 'pen', 'La herramienta debe seguir siendo pluma');
    });

    it('botón central (button = 1) desplaza la vista con cualquier herramienta activa', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const controller = new InputController(canvas, stateManager, undefined, {
        viewportManager,
      });

      controller.setTool('rectangle');

      controller.handleMouseDown({ clientX: 300, clientY: 300, button: 1 } as MouseEvent);
      assert.equal(controller.isPanning, true);
      assert.equal(canvas.style.cursor, 'grabbing');

      controller.handleMouseMove({ clientX: 340, clientY: 280 } as MouseEvent);
      assert.equal(viewportManager.panX, 40);
      assert.equal(viewportManager.panY, -20);

      controller.handleMouseUp({ clientX: 340, clientY: 280 } as MouseEvent);
      assert.equal(controller.isPanning, false);
      assert.equal(canvas.style.cursor, 'crosshair');
    });

    it('la barra espaciadora se ignora si el foco está en un input interactivo', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const controller = new InputController(canvas, stateManager);

      const fakeInput = { tagName: 'INPUT' };
      let prevented = false;

      controller.handleKeyDown({
        key: ' ',
        code: 'Space',
        target: fakeInput,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as KeyboardEvent);

      assert.equal(prevented, false, 'No debe llamar a preventDefault');
      assert.equal(controller.isSpacePressed, false, 'No debe activar el modo espacio');
    });

    it('la navegación no añade entradas al historial de deshacer y Ctrl+Z no afecta la vista', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const controller = new InputController(canvas, stateManager, commandManager, {
        viewportManager,
      });

      assert.equal(commandManager.canUndo(), false);

      // Paneo y Zoom
      viewportManager.zoomAt({ x: 200, y: 200 }, 1.5);
      viewportManager.panBy(80, 40);

      assert.equal(commandManager.canUndo(), false, 'La navegación no debe registrar comandos');

      const expectedZoom = viewportManager.zoom;
      const expectedPanX = viewportManager.panX;
      const expectedPanY = viewportManager.panY;

      // Ejecutar Ctrl+Z
      controller.handleKeyDown({ key: 'z', ctrlKey: true } as KeyboardEvent);

      // El viewport debe permanecer exactamente igual
      assert.equal(viewportManager.zoom, expectedZoom);
      assert.equal(viewportManager.panX, expectedPanX);
      assert.equal(viewportManager.panY, expectedPanY);
    });
  });
});
