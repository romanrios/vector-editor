import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController, KEYBOARD_SHORTCUTS } from '../src/input/InputController.ts';
import {
  perpendicularDistance,
  simplifyPointsRDP,
  fitCurveCatmullRom,
  getPointsAABB,
} from '../src/utils/geometry.ts';
import { isPath, type Path, type Vector2D } from '../src/types/scene-graph.ts';

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
    moveTo: (_x: number, _y: number) => calls.push('moveTo'),
    lineTo: (_x: number, _y: number) => calls.push('lineTo'),
    rect: (_x: number, _y: number, _w: number, _h: number) => calls.push('rect'),
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

describe('Pencil Tool (Herramienta Lápiz / Trazo libre)', () => {
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

  describe('Algoritmos Geométricos (geometry.ts)', () => {
    it('perpendicularDistance calcula la distancia exacta a un segmento o punto degenerado', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 100, y: 0 };

      // Punto en la línea
      const d1 = perpendicularDistance({ x: 50, y: 0 }, start, end);
      assert.strictEqual(d1, 0);

      // Punto a 20 unidades en Y
      const d2 = perpendicularDistance({ x: 50, y: 20 }, start, end);
      assert.strictEqual(Math.round(d2), 20);

      // Punto más allá de los extremos (debe medir distancia al extremo más cercano)
      const d3 = perpendicularDistance({ x: 110, y: 0 }, start, end);
      assert.strictEqual(Math.round(d3), 10);

      // Segmento degenerado (start == end)
      const d4 = perpendicularDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
      assert.strictEqual(Math.round(d4), 5);
    });

    it('simplifyPointsRDP simplifica puntos colineales y preserva crestas significativas', () => {
      // Puntos colineales
      const collinear: Vector2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 40, y: 0 },
      ];
      const simplifiedCollinear = simplifyPointsRDP(collinear, 1.0);
      assert.strictEqual(simplifiedCollinear.length, 2);
      assert.deepStrictEqual(simplifiedCollinear[0], { x: 0, y: 0 });
      assert.deepStrictEqual(simplifiedCollinear[1], { x: 40, y: 0 });

      // Punto pico prominente que supera epsilon
      const withPeak: Vector2D[] = [
        { x: 0, y: 0 },
        { x: 10, y: 1 },
        { x: 20, y: 50 }, // Pico prominente
        { x: 30, y: 1 },
        { x: 40, y: 0 },
      ];
      const simplifiedPeak = simplifyPointsRDP(withPeak, 2.0);
      assert.ok(simplifiedPeak.length >= 3);
      assert.ok(simplifiedPeak.some((p) => p.x === 20 && p.y === 50));

      // Array con 2 o menos puntos no se altera
      const twoPts: Vector2D[] = [{ x: 5, y: 5 }, { x: 10, y: 10 }];
      assert.strictEqual(simplifyPointsRDP(twoPts, 5).length, 2);
    });

    it('fitCurveCatmullRom genera tangentes suaves C1 e interpola todos los puntos', () => {
      const points: Vector2D[] = [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
        { x: 150, y: 50 },
      ];

      const pathPoints = fitCurveCatmullRom(points, 0.5);
      assert.strictEqual(pathPoints.length, 4);

      // Primer punto: tipo corner con handleOut
      assert.strictEqual(pathPoints[0].x, 0);
      assert.strictEqual(pathPoints[0].y, 0);
      assert.ok(pathPoints[0].handleOut !== undefined);
      assert.strictEqual(pathPoints[0].handleIn, undefined);

      // Puntos intermedios: tipo smooth con handleIn y handleOut
      const p1 = pathPoints[1];
      assert.strictEqual(p1.pointType, 'smooth');
      assert.ok(p1.handleIn && p1.handleOut);

      // Verificamos simetría/colinealidad de los manejadores de Catmull-Rom en el punto 1
      const deltaInX = p1.x - p1.handleIn.x;
      const deltaInY = p1.y - p1.handleIn.y;
      const deltaOutX = p1.handleOut.x - p1.x;
      const deltaOutY = p1.handleOut.y - p1.y;
      assert.ok(Math.abs(deltaInX - deltaOutX) < 1e-9);
      assert.ok(Math.abs(deltaInY - deltaOutY) < 1e-9);

      // Último punto: tipo corner con handleIn
      const last = pathPoints[pathPoints.length - 1];
      assert.strictEqual(last.x, 150);
      assert.strictEqual(last.y, 50);
      assert.ok(last.handleIn !== undefined);
      assert.strictEqual(last.handleOut, undefined);
    });

    it('getPointsAABB calcula correctamente el bounding box', () => {
      const pts: Vector2D[] = [
        { x: 10, y: 20 },
        { x: 50, y: 80 },
        { x: -10, y: 30 },
      ];
      const aabb = getPointsAABB(pts);
      assert.strictEqual(aabb.minX, -10);
      assert.strictEqual(aabb.minY, 20);
      assert.strictEqual(aabb.maxX, 50);
      assert.strictEqual(aabb.maxY, 80);
      assert.strictEqual(aabb.width, 60);
      assert.strictEqual(aabb.height, 60);

      const emptyAABB = getPointsAABB([]);
      assert.strictEqual(emptyAABB.width, 0);
    });
  });

  describe('Activación y Atajos de Teclado', () => {
    it('se puede activar la herramienta con setTool("pencil")', () => {
      let emittedTool = '';
      inputController.on('toolChange', (tool) => {
        emittedTool = tool;
      });

      inputController.setTool('pencil');
      assert.strictEqual(inputController.currentTool, 'pencil');
      assert.strictEqual(emittedTool, 'pencil');
      assert.strictEqual(canvas.style.cursor, 'crosshair');
    });

    it('los atajos B y N activan la herramienta lápiz', () => {
      // Presionar 'B'
      inputController.handleKeyDown({ key: 'b', preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(inputController.currentTool, 'pencil');

      // Volver a selección
      inputController.setTool('select');
      assert.strictEqual(inputController.currentTool, 'select');

      // Presionar 'N'
      inputController.handleKeyDown({ key: 'N', preventDefault: () => {} } as unknown as KeyboardEvent);
      assert.strictEqual(inputController.currentTool, 'pencil');
    });

    it('KEYBOARD_SHORTCUTS incluye la entrada de lápiz B / N', () => {
      const pencilShortcut = KEYBOARD_SHORTCUTS.find((s) => s.key === 'B / N');
      assert.ok(pencilShortcut, 'Debe existir el atajo B / N');
      assert.strictEqual(pencilShortcut.category, 'Herramientas');
    });
  });

  describe('Dibujo interactivo y Creación de Trazado', () => {
    it('genera preview durante el arrastre y añade la figura Path al soltar el ratón', () => {
      inputController.setTool('pencil');

      // MouseDown
      inputController.handleMouseDown({
        clientX: 100,
        clientY: 100,
        button: 0,
      } as MouseEvent);

      assert.strictEqual(inputController.isDrawingPencil, true);
      const preview1 = inputController.shapePreview;
      assert.ok(preview1);
      assert.strictEqual(preview1.type, 'pencil');
      assert.strictEqual(preview1.points?.length, 1);

      // MouseMove 1
      inputController.handleMouseMove({
        clientX: 120,
        clientY: 120,
      } as MouseEvent);

      const preview2 = inputController.shapePreview;
      assert.ok(preview2);
      assert.strictEqual(preview2.points?.length, 2);

      // MouseMove 2
      inputController.handleMouseMove({
        clientX: 150,
        clientY: 130,
      } as MouseEvent);

      // MouseUp
      inputController.handleMouseUp({
        clientX: 150,
        clientY: 130,
        button: 0,
      } as MouseEvent);

      assert.strictEqual(inputController.isDrawingPencil, false);
      assert.strictEqual(inputController.shapePreview, null);

      // La herramienta debe permanecer en 'pencil' para permitir bocetar múltiples trazos
      assert.strictEqual(inputController.currentTool, 'pencil');

      // Verificar que se creó la figura en el Scene Graph
      const activeLayer = stateManager.getActiveLayer();
      assert.ok(activeLayer);
      const createdShape = activeLayer.children[activeLayer.children.length - 1];
      assert.ok(isPath(createdShape));

      const path = createdShape as Path;
      assert.strictEqual(path.closed, false);
      assert.strictEqual(path.fill, 'none');
      assert.strictEqual(path.strokeLineCap, 'round');
      assert.strictEqual(path.strokeLineJoin, 'round');
      assert.ok(path.points.length >= 2);

      // Se selecciona automáticamente el nuevo trazo
      assert.deepStrictEqual(stateManager.getSelection(), [path.id]);
    });

    it('filtra micro-movimientos redundantes menores a 2px en espacio de pantalla', () => {
      inputController.setTool('pencil');

      inputController.handleMouseDown({
        clientX: 100,
        clientY: 100,
        button: 0,
      } as MouseEvent);

      // Movimiento diminuto menor a 2px
      inputController.handleMouseMove({
        clientX: 100.5,
        clientY: 100.5,
      } as MouseEvent);

      assert.strictEqual(inputController.shapePreview?.points?.length, 1);

      // Movimiento significativo mayor a 2px
      inputController.handleMouseMove({
        clientX: 105,
        clientY: 105,
      } as MouseEvent);

      assert.strictEqual(inputController.shapePreview?.points?.length, 2);

      inputController.handleMouseUp({
        clientX: 105,
        clientY: 105,
        button: 0,
      } as MouseEvent);
    });

    it('un clic rápido sin arrastre genera un trazo de punto visible', () => {
      inputController.setTool('pencil');

      inputController.handleMouseDown({
        clientX: 200,
        clientY: 200,
        button: 0,
      } as MouseEvent);

      inputController.handleMouseUp({
        clientX: 200,
        clientY: 200,
        button: 0,
      } as MouseEvent);

      const activeLayer = stateManager.getActiveLayer();
      assert.ok(activeLayer);
      const created = activeLayer.children[activeLayer.children.length - 1] as Path;
      assert.ok(isPath(created));
      assert.ok(created.points.length >= 2);
    });

    it('la tecla Escape cancela el trazo en progreso sin añadir ninguna figura', () => {
      inputController.setTool('pencil');
      const initialCount = stateManager.getActiveLayer()?.children.length ?? 0;

      inputController.handleMouseDown({
        clientX: 50,
        clientY: 50,
        button: 0,
      } as MouseEvent);

      inputController.handleMouseMove({
        clientX: 80,
        clientY: 80,
      } as MouseEvent);

      assert.strictEqual(inputController.isDrawingPencil, true);

      // Presionar Escape
      inputController.handleKeyDown({ key: 'Escape', preventDefault: () => {} } as unknown as KeyboardEvent);

      assert.strictEqual(inputController.isDrawingPencil, false);
      assert.strictEqual(inputController.shapePreview, null);

      const currentCount = stateManager.getActiveLayer()?.children.length ?? 0;
      assert.strictEqual(currentCount, initialCount);
    });

    it('el comando AddShapeCommand permite Undo y Redo del trazo creado', () => {
      inputController.setTool('pencil');
      const initialCount = stateManager.getActiveLayer()?.children.length ?? 0;

      inputController.handleMouseDown({ clientX: 10, clientY: 10, button: 0 } as MouseEvent);
      inputController.handleMouseMove({ clientX: 30, clientY: 30 } as MouseEvent);
      inputController.handleMouseUp({ clientX: 50, clientY: 50, button: 0 } as MouseEvent);

      const afterCount = stateManager.getActiveLayer()?.children.length ?? 0;
      assert.strictEqual(afterCount, initialCount + 1);

      // Deshacer (Undo)
      commandManager.undo();
      const undoCount = stateManager.getActiveLayer()?.children.length ?? 0;
      assert.strictEqual(undoCount, initialCount);

      // Rehacer (Redo)
      commandManager.redo();
      const redoCount = stateManager.getActiveLayer()?.children.length ?? 0;
      assert.strictEqual(redoCount, initialCount + 1);
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

    it('setupUIBindings sincroniza el botón #tool-pencil y la etiqueta "Modo: Lápiz (Mano alzada)"', async () => {
      const { setupUIBindings } = await import('../src/main.ts');

      const btnSelect = new MockElement('tool-select');
      const btnPencil = new MockElement('tool-pencil');
      const statusLabel = new MockElement('status-tool-label');

      const domMap: Record<string, MockElement> = {
        '#tool-select': btnSelect,
        '#tool-pencil': btnPencil,
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
        assert.strictEqual(btnPencil.classList.contains('active'), false);
        assert.strictEqual(btnPencil.getAttribute('aria-pressed'), 'false');

        // Activar lápiz programáticamente
        localController.setTool('pencil');
        assert.strictEqual(btnSelect.classList.contains('active'), false);
        assert.strictEqual(btnPencil.classList.contains('active'), true);
        assert.strictEqual(btnPencil.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(statusLabel.textContent, 'Modo: Lápiz (Mano alzada)');

        // Cambiar de vuelta a select y usar clic en botón de UI #tool-pencil
        localController.setTool('select');
        assert.strictEqual(btnPencil.classList.contains('active'), false);

        btnPencil.click();
        assert.strictEqual(localController.currentTool, 'pencil');
        assert.strictEqual(btnPencil.classList.contains('active'), true);

        bindings.cleanup();
      } finally {
        (globalThis as any).document = originalDocument;
      }
    });
  });
});
