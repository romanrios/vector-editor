import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController, KEYBOARD_SHORTCUTS } from '../src/input/InputController.ts';
import { rgbToHex, sampleCanvasPixel } from '../src/utils/color.ts';
import type { Rectangle, Ellipse, Gradient } from '../src/types/scene-graph.ts';

// Helper de mock de Canvas
function createMockCanvas(): HTMLCanvasElement & {
  mockCtx: Record<string, any>;
  calls: string[];
} {
  const calls: string[] = [];

  const mockCtx: Record<string, any> = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    rect: () => calls.push('rect'),
    strokeRect: () => calls.push('strokeRect'),
    fillRect: () => calls.push('fillRect'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    setLineDash: () => calls.push('setLineDash'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    setTransform: () => calls.push('setTransform'),
    bezierCurveTo: () => calls.push('bezierCurveTo'),
    arc: () => calls.push('arc'),
    ellipse: () => calls.push('ellipse'),
    clearRect: () => calls.push('clearRect'),
    measureText: () => ({ width: 50 }),
    getImageData: (_x: number, _y: number, _w: number, _h: number) => {
      calls.push('getImageData');
      // Por defecto devuelve un píxel azul pizarra si se consulta fuera
      return {
        data: new Uint8ClampedArray([56, 189, 248, 255]),
      };
    },
    canvas: { width: 1000, height: 800 },
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    strokeStyle: '#000000',
    fillStyle: '#000000',
    globalAlpha: 1,
  };

  return {
    style: { cursor: 'default' },
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
    getContext: () => mockCtx,
    mockCtx,
    calls,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as HTMLCanvasElement & {
    mockCtx: Record<string, any>;
    calls: string[];
  };
}

describe('Eyedropper Tool (Herramienta Cuentagotas)', () => {
  let stateManager: StateManager;
  let commandManager: CommandManager;
  let canvas: ReturnType<typeof createMockCanvas>;
  let inputController: InputController;

  beforeEach(() => {
    stateManager = new StateManager();
    commandManager = new CommandManager();
    canvas = createMockCanvas();
    inputController = new InputController(canvas, stateManager, commandManager);
  });

  describe('Utilidades de Color (rgbToHex y sampleCanvasPixel)', () => {
    it('rgbToHex convierte componentes RGB numéricos a formato hexadecimal exacto', () => {
      assert.strictEqual(rgbToHex(255, 0, 0), '#ff0000');
      assert.strictEqual(rgbToHex(0, 255, 0), '#00ff00');
      assert.strictEqual(rgbToHex(0, 0, 255), '#0000ff');
      assert.strictEqual(rgbToHex(255, 255, 255), '#ffffff');
      assert.strictEqual(rgbToHex(0, 0, 0), '#000000');
      assert.strictEqual(rgbToHex(56, 189, 248), '#38bdf8');
    });

    it('sampleCanvasPixel lee píxeles mediante getImageData y maneja píxeles transparentes', () => {
      const mockContext = {
        getImageData: (x: number, y: number) => {
          if (x === 0 && y === 0) {
            return { data: new Uint8ClampedArray([255, 128, 0, 255]) };
          }
          return { data: new Uint8ClampedArray([0, 0, 0, 0]) };
        },
      } as unknown as CanvasRenderingContext2D;

      const opaqueColor = sampleCanvasPixel(mockContext, 0, 0);
      assert.strictEqual(opaqueColor, '#ff8000');

      const transparentColor = sampleCanvasPixel(mockContext, 10, 10);
      assert.strictEqual(transparentColor, 'none');
    });
  });

  describe('Activación y Atajos de Teclado', () => {
    it('setTool("eyedropper") activa la herramienta y emite toolChange', () => {
      let emitted = '';
      inputController.on('toolChange', (tool) => {
        emitted = tool;
      });

      inputController.setTool('eyedropper');
      assert.strictEqual(inputController.currentTool, 'eyedropper');
      assert.strictEqual(emitted, 'eyedropper');
      assert.strictEqual(canvas.style.cursor, 'crosshair');
    });

    it('el atajo I activa la herramienta Cuentagotas', () => {
      inputController.setTool('select');
      assert.strictEqual(inputController.currentTool, 'select');

      inputController.handleKeyDown({ key: 'i', preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(inputController.currentTool, 'eyedropper');

      inputController.setTool('select');
      inputController.handleKeyDown({ key: 'I', preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(inputController.currentTool, 'eyedropper');
    });

    it('KEYBOARD_SHORTCUTS contiene la entrada para Cuentagotas', () => {
      const shortcut = KEYBOARD_SHORTCUTS.find((s) => s.key === 'I');
      assert.ok(shortcut);
      assert.strictEqual(shortcut.category, 'Herramientas');
    });
  });

  describe('Muestreo e Inspección del Scene Graph', () => {
    it('muestrea el color de relleno (fill) de una figura vectorial y lo aplica a la selección activa con Undo/Redo', () => {
      const layerId = stateManager.getActiveLayer()!.id;

      // Figura origen de muestra: Rectángulo Rojo
      const sourceRect: Rectangle = {
        id: 'rect-source',
        type: 'rectangle',
        name: 'Origen',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#ef4444',
        stroke: '#000000',
        strokeWidth: 2,
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };

      // Figura destino: Elipse Azul seleccionada
      const targetEllipse: Ellipse = {
        id: 'ellipse-target',
        type: 'ellipse',
        name: 'Destino',
        x: 300,
        y: 300,
        radiusX: 50,
        radiusY: 50,
        fill: '#3b82f6',
        stroke: '#000000',
        strokeWidth: 2,
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };

      stateManager.addShape(layerId, sourceRect);
      stateManager.addShape(layerId, targetEllipse);
      stateManager.setSelection(['ellipse-target']);

      // Activar cuentagotas y hacer clic sobre el rectángulo origen (150, 150)
      inputController.setTool('eyedropper');
      inputController.handleMouseDown({
        clientX: 150,
        clientY: 150,
        button: 0,
        shiftKey: false,
      } as MouseEvent);

      // La elipse destino debe haber adquirido el color rojo del origen
      const updatedTarget = stateManager.findNode('ellipse-target') as Ellipse;
      assert.strictEqual(updatedTarget.fill, '#ef4444');

      // Undo restaura el color azul anterior
      commandManager.undo();
      const undoneTarget = stateManager.findNode('ellipse-target') as Ellipse;
      assert.strictEqual(undoneTarget.fill, '#3b82f6');

      // Redo vuelve a aplicar el color rojo
      commandManager.redo();
      const redoneTarget = stateManager.findNode('ellipse-target') as Ellipse;
      assert.strictEqual(redoneTarget.fill, '#ef4444');
    });

    it('Shift + Clic muestrea y aplica al contorno (stroke) en lugar del relleno', () => {
      const layerId = stateManager.getActiveLayer()!.id;

      const sourceRect: Rectangle = {
        id: 'rect-source-stroke',
        type: 'rectangle',
        name: 'Origen',
        x: 50,
        y: 50,
        width: 80,
        height: 80,
        fill: '#ffffff',
        stroke: '#10b981', // Verde
        strokeWidth: 4,
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };

      const targetRect: Rectangle = {
        id: 'rect-target-stroke',
        type: 'rectangle',
        name: 'Destino',
        x: 200,
        y: 50,
        width: 80,
        height: 80,
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 2,
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };

      stateManager.addShape(layerId, sourceRect);
      stateManager.addShape(layerId, targetRect);
      stateManager.setSelection(['rect-target-stroke']);

      inputController.setTool('eyedropper');
      inputController.handleMouseDown({
        clientX: 70,
        clientY: 70,
        button: 0,
        shiftKey: true,
      } as MouseEvent);

      const updated = stateManager.findNode('rect-target-stroke') as Rectangle;
      assert.strictEqual(updated.stroke, '#10b981');
      assert.strictEqual(updated.fill, '#000000'); // El relleno no se altera con Shift
    });

    it('muestrea degradados (Gradient) conservando la estructura de paradas (stops) y tipo', () => {
      const layerId = stateManager.getActiveLayer()!.id;

      const sampleGradient: Gradient = {
        type: 'linear',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
        stops: [
          { id: 's1', offset: 0, color: '#f59e0b' },
          { id: 's2', offset: 1, color: '#ec4899' },
        ],
      };

      const gradShape: Rectangle = {
        id: 'shape-grad',
        type: 'rectangle',
        name: 'Gradiente',
        x: 400,
        y: 100,
        width: 100,
        height: 100,
        fill: sampleGradient,
        stroke: 'none',
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };

      const plainTarget: Rectangle = {
        id: 'shape-plain',
        type: 'rectangle',
        name: 'Sin degradado',
        x: 400,
        y: 300,
        width: 100,
        height: 100,
        fill: '#ffffff',
        stroke: 'none',
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };

      stateManager.addShape(layerId, gradShape);
      stateManager.addShape(layerId, plainTarget);
      stateManager.setSelection(['shape-plain']);

      inputController.setTool('eyedropper');
      inputController.handleMouseDown({
        clientX: 450,
        clientY: 150,
        button: 0,
        shiftKey: false,
      } as MouseEvent);

      const target = stateManager.findNode('shape-plain') as Rectangle;
      assert.deepStrictEqual(target.fill, sampleGradient);
    });

    it('cuando no hay figuras seleccionadas, actualiza el estilo de dibujo activo (drawingStyle)', () => {
      const layerId = stateManager.getActiveLayer()!.id;
      stateManager.setSelection([]);

      const sourceRect: Rectangle = {
        id: 'source-color',
        type: 'rectangle',
        name: 'Color Origen',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        fill: '#8b5cf6',
        stroke: '#4c1d95',
        strokeWidth: 3,
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };
      stateManager.addShape(layerId, sourceRect);

      inputController.setTool('eyedropper');
      inputController.handleMouseDown({
        clientX: 25,
        clientY: 25,
        button: 0,
        shiftKey: false,
      } as MouseEvent);

      const currentStyle = stateManager.getDrawingStyle();
      assert.strictEqual(currentStyle.fill, '#8b5cf6');
    });

    it('muestrea el píxel del canvas cuando se hace clic en un área vacía', () => {
      stateManager.setSelection([]);

      inputController.setTool('eyedropper');
      // Coordenadas vacías sin figuras vectoriales
      inputController.handleMouseDown({
        clientX: 800,
        clientY: 600,
        button: 0,
        shiftKey: false,
      } as MouseEvent);

      // El mock de getImageData devuelve rgb(56, 189, 248) -> #38bdf8
      const currentStyle = stateManager.getDrawingStyle();
      assert.strictEqual(currentStyle.fill, '#38bdf8');
    });

    it('onMouseMove actualiza la vista previa del cuentagotas (eyedropperPreview)', () => {
      inputController.setTool('eyedropper');

      inputController.handleMouseMove({
        clientX: 120,
        clientY: 180,
      } as MouseEvent);

      const preview = inputController.eyedropperPreview;
      assert.ok(preview);
      assert.strictEqual(preview.screenX, 120);
      assert.strictEqual(preview.screenY, 180);
      assert.strictEqual(preview.color, '#38bdf8');
    });
  });

  describe('Integración UI (ToolbarController y StatusBarController)', () => {
    class MockElement {
      public id: string;
      public tagName: string;
      public disabled: boolean = false;
      public textContent: string = '';
      public value: string = '';
      public style: Record<string, string> = {};
      private attributes: Map<string, string> = new Map();
      private classes: Set<string> = new Set();
      private listeners: Map<string, Set<(e: any) => void>> = new Map();

      constructor(id: string = '', tagName: string = 'button') {
        this.id = id;
        this.tagName = tagName;
      }

      public get classList() {
        return {
          add: (cls: string) => this.classes.add(cls),
          remove: (cls: string) => this.classes.delete(cls),
          contains: (cls: string) => this.classes.has(cls),
          toggle: (cls: string, force?: boolean) => {
            if (force !== undefined) {
              if (force) this.classes.add(cls);
              else this.classes.delete(cls);
              return force;
            }
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

      public addEventListener(event: string, handler: (e: any) => void): void {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
      }

      public removeEventListener(event: string, handler: (e: any) => void): void {
        this.listeners.get(event)?.delete(handler);
      }

      public click(): void {
        const handlers = this.listeners.get('click');
        if (handlers) {
          for (const h of handlers) {
            h({ target: this, type: 'click' });
          }
        }
      }
    }

    it('setupUIBindings sincroniza el botón #tool-eyedropper y la etiqueta "Modo: Cuentagotas (Muestreo)"', async () => {
      const { setupUIBindings } = await import('../src/main.ts');

      const btnSelect = new MockElement('tool-select');
      const btnEyedropper = new MockElement('tool-eyedropper');
      const statusLabel = new MockElement('status-tool-label');

      const domMap: Record<string, MockElement> = {
        '#tool-select': btnSelect,
        '#tool-eyedropper': btnEyedropper,
        '#status-tool-label': statusLabel,
      };

      const originalDocument = (globalThis as any).document;
      (globalThis as any).document = {
        querySelector: (selector: string) => domMap[selector] ?? null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      try {
        const localCanvas = createMockCanvas();
        const localState = new StateManager();
        const localCmd = new CommandManager();
        const localController = new InputController(localCanvas, localState, localCmd);

        const bindings = setupUIBindings(localController, localCmd, localState);

        // Estado inicial 'select'
        assert.strictEqual(btnSelect.classList.contains('active'), true);
        assert.strictEqual(btnEyedropper.classList.contains('active'), false);
        assert.strictEqual(btnEyedropper.getAttribute('aria-pressed'), 'false');

        // Activar cuentagotas
        localController.setTool('eyedropper');
        assert.strictEqual(btnSelect.classList.contains('active'), false);
        assert.strictEqual(btnEyedropper.classList.contains('active'), true);
        assert.strictEqual(btnEyedropper.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(statusLabel.textContent, 'Modo: Cuentagotas (Muestreo)');

        // Volver a select y usar clic en botón de toolbar #tool-eyedropper
        localController.setTool('select');
        assert.strictEqual(btnEyedropper.classList.contains('active'), false);

        btnEyedropper.click();
        assert.strictEqual(localController.currentTool, 'eyedropper');
        assert.strictEqual(btnEyedropper.classList.contains('active'), true);

        bindings.cleanup();
      } finally {
        (globalThis as any).document = originalDocument;
      }
    });
  });
});
