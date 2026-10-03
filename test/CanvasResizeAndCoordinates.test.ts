import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';

// Mock de Canvas para pruebas de redimensionado y coordenadas
function createMockCanvasWithRect(rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement {
  let width = 0;
  let height = 0;
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    get width() {
      return width;
    },
    set width(val: number) {
      width = val;
    },
    get height() {
      return height;
    },
    set height(val: number) {
      height = val;
    },
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => {},
    }),
    getContext: () => ({
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      isPointInPath: () => false,
      setLineDash: () => {},
    }),
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    parentElement: {
      tagName: 'MAIN',
      className: 'canvas-viewport',
    },
  } as unknown as HTMLCanvasElement;
}

describe('Redimensionado del Lienzo y Coordenadas Locales (Canvas Layout & DPR)', () => {
  it('resizeToDisplaySize calcula dimensiones físicas multiplicando por devicePixelRatio y marca isDirty', () => {
    (globalThis as any).window = {
      devicePixelRatio: 2, // Pantalla Retina / High DPI
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const rect = { left: 44, top: 36, width: 800, height: 600 };
    const canvas = createMockCanvasWithRect(rect);
    const stateManager = new StateManager();
    stateManager.clearDirty();

    const engine = new RenderEngine(canvas, stateManager, { highDpi: true });

    // Ancho físico: 800 * 2 = 1600; Alto físico: 600 * 2 = 1200
    assert.equal(canvas.width, 1600);
    assert.equal(canvas.height, 1200);
    assert.equal(stateManager.isDirty, true, 'Debe marcar estado como sucio al dimensionar el buffer');

    // Segunda llamada sin cambio de tamaño -> retorna false y no ensucia el estado
    stateManager.clearDirty();
    const changed = engine.resizeToDisplaySize();
    assert.equal(changed, false);
    assert.equal(stateManager.isDirty, false);

    engine.destroy();
    delete (globalThis as any).window;
  });

  it('InputController.getLocalCoordinates descuenta correctamente el offset del layout (toolbar 44px, topbar 36px)', () => {
    // Canvas desplazado a (left: 44, top: 36) según el CSS Grid de la interfaz
    const rect = { left: 44, top: 36, width: 900, height: 700 };
    const canvas = createMockCanvasWithRect(rect);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    // Clic en la esquina superior izquierda del lienzo (en pantalla 44, 36)
    const originCoords = controller.getLocalCoordinates({ clientX: 44, clientY: 36 } as MouseEvent);
    assert.equal(originCoords.x, 0);
    assert.equal(originCoords.y, 0);

    // Clic en el punto lógico (150, 200) -> en pantalla clientX = 44 + 150 = 194, clientY = 36 + 200 = 236
    const pointCoords = controller.getLocalCoordinates({ clientX: 194, clientY: 236 } as MouseEvent);
    assert.equal(pointCoords.x, 150);
    assert.equal(pointCoords.y, 200);

    controller.destroy();
  });

  it('las coordenadas se mantienen exactas tras cambiar el tamaño o posición del viewport', () => {
    const rect = { left: 44, top: 36, width: 800, height: 600 };
    const canvas = createMockCanvasWithRect(rect);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    // Simular que el panel lateral cambia el ancho y el canvas ahora tiene 1000px de ancho
    rect.width = 1000;
    rect.height = 750;

    const coords = controller.getLocalCoordinates({ clientX: 544, clientY: 436 } as MouseEvent);
    assert.equal(coords.x, 500); // 544 - 44 = 500
    assert.equal(coords.y, 400); // 436 - 36 = 400

    controller.destroy();
  });

  it('setupUIBindings conecta ResizeObserver al contenedor del canvas y cleanup() lo desconecta', () => {
    let observedTarget: unknown = null;
    let disconnected = false;

    class MockResizeObserver {
      public cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      public observe(target: unknown) {
        observedTarget = target;
      }
      public disconnect() {
        disconnected = true;
      }
      public unobserve() {}
    }

    (globalThis as any).ResizeObserver = MockResizeObserver;

    const canvas = createMockCanvasWithRect({ left: 44, top: 36, width: 800, height: 600 });
    const container = { id: 'canvas-container', className: 'canvas-viewport' };

    (globalThis as any).document = {
      querySelector: (selector: string) => {
        if (selector === '#viewport-canvas') return canvas;
        if (selector === '#canvas-container, .canvas-viewport') return container;
        return null;
      },
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(controller, commandManager, stateManager);

    // Debe observar el contenedor del lienzo
    assert.equal(observedTarget, container);
    assert.equal(disconnected, false);

    // cleanup debe invocar disconnect
    cleanup();
    assert.equal(disconnected, true);

    controller.destroy();
    delete (globalThis as any).document;
    delete (globalThis as any).ResizeObserver;
  });
});
