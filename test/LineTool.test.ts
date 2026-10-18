import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController, KEYBOARD_SHORTCUTS } from '../src/input/InputController.ts';
import { setupUIBindings, dashArrayToSelectValue, selectValueToDashArray } from '../src/main.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { isPath, type Path } from '../src/types/scene-graph.ts';
import { StyleShapesCommand } from '../src/commands/StyleShapesCommand.ts';

// Helper para mock de Canvas con eventos y contexto 2D
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
    setLineDash: (dash: number[]) => {
      calls.push('setLineDash');
      mockCtx._lastDash = dash;
    },
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
    lineCap: 'butt',
    lineJoin: 'miter',
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
  } as unknown as HTMLCanvasElement & {
    mockCtx: Record<string, any>;
    calls: string[];
  };
}

// Mock de elemento DOM para testing de setupUIBindings
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

  public addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public click(): void {
    const list = this.listeners.get('click');
    if (list) {
      for (const fn of list) {
        fn({ target: this });
      }
    }
  }

  public dispatchEvent(event: { type: string }): void {
    const list = this.listeners.get(event.type);
    if (list) {
      for (const fn of list) {
        fn({ target: this, ...event });
      }
    }
  }
}

describe('Herramienta Línea (Line Tool)', () => {
  it('1. activación de herramienta line actualiza ToolMode, emite evento y establece cursor crosshair', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    let emittedTool: string | null = null;
    controller.on('toolChange', (tool) => {
      emittedTool = tool;
    });

    controller.setTool('line');

    assert.equal(controller.currentTool, 'line');
    assert.equal(emittedTool, 'line', 'Debe emitir toolChange con "line"');
    assert.equal(canvas.style.cursor, 'crosshair', 'El cursor del canvas debe ser "crosshair"');
  });

  it('2. atajo de teclado L (minúscula y mayúscula) conmuta a herramienta line', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    assert.equal(controller.currentTool, 'select');

    controller.handleKeyDown({ key: 'l', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.currentTool, 'line', 'Tecla l minúscula debe activar herramienta line');

    controller.setTool('select');
    controller.handleKeyDown({ key: 'L', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.currentTool, 'line', 'Tecla L mayúscula debe activar herramienta line');

    const lineShortcut = KEYBOARD_SHORTCUTS.find((s) => s.key === 'L');
    assert.ok(lineShortcut !== undefined, 'KEYBOARD_SHORTCUTS debe incluir la tecla L');
    assert.equal(lineShortcut?.description, 'Herramienta Línea');
  });

  it('3. arrastrar sobre el canvas muestra preview y crea un nodo Path abierto con dos puntos', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('line');

    // MouseDown en (100, 150)
    controller.handleMouseDown({ clientX: 100, clientY: 150, button: 0 } as MouseEvent);
    assert.equal(controller.isCreatingLine, true, 'Debe iniciar la creación de línea');

    // MouseMove a (300, 400)
    controller.handleMouseMove({ clientX: 300, clientY: 400, button: 0 } as MouseEvent);
    const preview = controller.shapePreview;
    assert.ok(preview !== null, 'Debe haber un preview activo');
    assert.equal(preview.type, 'line');
    assert.equal(preview.x, 100);
    assert.equal(preview.y, 150);
    assert.equal(preview.x2, 300);
    assert.equal(preview.y2, 400);
    assert.equal(preview.fill, 'none');

    // MouseUp en (300, 400)
    controller.handleMouseUp({ clientX: 300, clientY: 400, button: 0 } as MouseEvent);

    const layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1, 'Debe haber creado exactamente una figura');

    const createdNode = layer.children[0];
    assert.equal(isPath(createdNode), true, 'La figura creada debe ser un Path');

    const path = createdNode as Path;
    assert.equal(path.closed, false, 'La línea debe tener closed: false');
    assert.equal(path.fill, 'none', 'La línea debe tener fill: "none"');
    assert.equal(path.points.length, 2, 'La línea debe tener exactamente 2 puntos');
    assert.equal(path.points[0].x, 100);
    assert.equal(path.points[0].y, 150);
    assert.equal(path.points[1].x, 300);
    assert.equal(path.points[1].y, 400);

    // Debe quedar seleccionada y conmutar a 'select'
    assert.equal(stateManager.isSelected(path.id), true, 'La nueva línea debe quedar seleccionada');
    assert.equal(controller.currentTool, 'select', 'Debe regresar a la herramienta select');
  });

  it('4. un arrastre inferior al umbral mínimo cancela la creación sin alterar el documento', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('line');

    // Clic casi sin movimiento (< 3px)
    controller.handleMouseDown({ clientX: 100, clientY: 100, button: 0 } as MouseEvent);
    controller.handleMouseUp({ clientX: 101, clientY: 101, button: 0 } as MouseEvent);

    const layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 0, 'No debe crearse ninguna figura');
  });

  it('5. restricción a múltiplos de 45° con Shift presionado', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('line');

    // Arrastre hacia ~15° (100, 20) con Shift -> debe ajustar a 0° horizontal
    controller.handleMouseDown({ clientX: 0, clientY: 0, button: 0, shiftKey: true } as MouseEvent);
    controller.handleMouseUp({ clientX: 100, clientY: 20, button: 0, shiftKey: true } as MouseEvent);

    let layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1);
    let line1 = layer.children[0] as Path;
    assert.equal(line1.points[0].x, 0);
    assert.equal(line1.points[0].y, 0);
    // Y final debe estar snap-eado a 0
    assert.equal(Math.round(line1.points[1].y), 0, 'Ángulo ajustado debe ser horizontal (y = 0)');
    assert.ok(line1.points[1].x > 90, 'X final debe mantener la distancia proyectada');

    // Limpiar documento para la siguiente prueba
    stateManager.removeNode(line1.id);
    controller.setTool('line');

    // Arrastre hacia ~40° (100, 85) con Shift -> debe ajustar a 45°
    controller.handleMouseDown({ clientX: 0, clientY: 0, button: 0, shiftKey: true } as MouseEvent);
    controller.handleMouseUp({ clientX: 100, clientY: 85, button: 0, shiftKey: true } as MouseEvent);

    layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1);
    let line2 = layer.children[0] as Path;
    const dx = line2.points[1].x - line2.points[0].x;
    const dy = line2.points[1].y - line2.points[0].y;
    assert.equal(Math.round(dx), Math.round(dy), 'A 45°, dx debe ser igual a dy');
  });

  it('6. creación de línea es completamente reversible con Undo y Redo', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('line');

    controller.handleMouseDown({ clientX: 50, clientY: 50, button: 0 } as MouseEvent);
    controller.handleMouseUp({ clientX: 200, clientY: 200, button: 0 } as MouseEvent);

    let layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1, 'Figura debe existir tras creación');
    const createdId = layer.children[0].id;

    // Deshacer
    assert.equal(commandManager.canUndo(), true);
    commandManager.undo();

    layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 0, 'La figura debe eliminarse al deshacer');

    // Rehacer
    assert.equal(commandManager.canRedo(), true);
    commandManager.redo();

    layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1, 'La figura debe restaurarse al rehacer');
    assert.equal(layer.children[0].id, createdId);
  });

  it('7. propiedades avanzadas de contorno (strokeDashArray, strokeLineCap, strokeLineJoin) se respetan y renderizan', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();

    // Establecer estilo con trazo discontinuo y terminaciones
    stateManager.setDrawingStyle({
      strokeDashArray: [6, 6],
      strokeLineCap: 'round',
      strokeLineJoin: 'bevel',
    });

    const style = stateManager.getDrawingStyle();
    assert.deepEqual(style.strokeDashArray, [6, 6]);
    assert.equal(style.strokeLineCap, 'round');
    assert.equal(style.strokeLineJoin, 'bevel');

    // Crear línea
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('line');

    controller.handleMouseDown({ clientX: 10, clientY: 10, button: 0 } as MouseEvent);
    controller.handleMouseUp({ clientX: 100, clientY: 100, button: 0 } as MouseEvent);

    const layerId = stateManager.getState().children[0].id;
    const layer = stateManager.findNode(layerId) as any;
    const line = layer.children[0] as Path;

    assert.deepEqual(line.strokeDashArray, [6, 6]);
    assert.equal(line.strokeLineCap, 'round');
    assert.equal(line.strokeLineJoin, 'bevel');

    // Modificar propiedades con StyleShapesCommand y verificar Undo/Redo
    const cmd = new StyleShapesCommand(stateManager, [
      {
        id: line.id,
        before: { strokeDashArray: [6, 6], strokeLineCap: 'round' },
        after: { strokeDashArray: [2, 4], strokeLineCap: 'square' },
      },
    ]);
    commandManager.executeCommand(cmd);

    const updatedLine = stateManager.findNode(line.id) as Path;
    assert.deepEqual(updatedLine.strokeDashArray, [2, 4]);
    assert.equal(updatedLine.strokeLineCap, 'square');

    commandManager.undo();
    const undoneLine = stateManager.findNode(line.id) as Path;
    assert.deepEqual(undoneLine.strokeDashArray, [6, 6]);
    assert.equal(undoneLine.strokeLineCap, 'round');

    // Verificar exportSvg
    const svg = exportDocumentToSvg(stateManager.getState());
    assert.ok(svg.includes('stroke-dasharray="6 6"'), 'El SVG exportado debe incluir stroke-dasharray');
    assert.ok(svg.includes('stroke-linecap="round"'), 'El SVG exportado debe incluir stroke-linecap');
    assert.ok(svg.includes('stroke-linejoin="bevel"'), 'El SVG exportado debe incluir stroke-linejoin');

    // Verificar RenderEngine aplica setLineDash
    const engine = new RenderEngine(canvas, stateManager, { highDpi: false });
    engine.render();
    assert.equal(canvas.calls.includes('setLineDash'), true, 'RenderEngine debe llamar a setLineDash para trazo discontinuo');
  });

  it('8. setupUIBindings sincroniza botón #tool-line y controles de contorno en panel de propiedades', () => {
    const btnSelect = new MockElement('tool-select');
    const btnLine = new MockElement('tool-line');
    const statusLabel = new MockElement('status-tool-label', 'span');
    const selectStrokeDash = new MockElement('select-stroke-dash', 'select');
    const selectStrokeCap = new MockElement('select-stroke-cap', 'select');
    const selectStrokeJoin = new MockElement('select-stroke-join', 'select');

    const domMap: Record<string, MockElement> = {
      '#tool-select': btnSelect,
      '#tool-line': btnLine,
      '#status-tool-label': statusLabel,
      '#select-stroke-dash': selectStrokeDash,
      '#select-stroke-cap': selectStrokeCap,
      '#select-stroke-join': selectStrokeJoin,
    };

    const originalQuerySelector = (globalThis as any).document?.querySelector;
    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    try {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const bindings = setupUIBindings(controller, commandManager, stateManager);

      // 1. Estado inicial
      assert.equal(btnLine.classList.contains('active'), false);
      assert.equal(btnLine.getAttribute('aria-pressed'), 'false');

      // 2. Activar herramienta 'line'
      controller.setTool('line');
      assert.equal(btnLine.classList.contains('active'), true, 'Botón #tool-line debe tener clase active');
      assert.equal(btnLine.getAttribute('aria-pressed'), 'true');
      assert.equal(statusLabel.textContent, 'Modo: Línea');

      // 3. Clic en botón #tool-line
      controller.setTool('select');
      assert.equal(btnLine.classList.contains('active'), false);
      btnLine.click();
      assert.equal(controller.currentTool, 'line', 'Clic en botón debe cambiar tool a "line"');

      // 4. Helper mappings para trazo
      assert.equal(dashArrayToSelectValue(undefined), 'solid');
      assert.equal(dashArrayToSelectValue([6, 6]), 'dashed');
      assert.equal(dashArrayToSelectValue([2, 4]), 'dotted');
      assert.equal(dashArrayToSelectValue([8, 4, 2, 4]), 'dash-dot');
      assert.deepEqual(selectValueToDashArray('solid'), undefined);
      assert.deepEqual(selectValueToDashArray('dashed'), [6, 6]);
      assert.deepEqual(selectValueToDashArray('dotted'), [2, 4]);
      assert.deepEqual(selectValueToDashArray('dash-dot'), [8, 4, 2, 4]);

      // 5. Cambio de trazo vía select con figura seleccionada
      const layerId = stateManager.getState().children[0].id;
      const testPath: Path = {
        id: 'test-path-1',
        type: 'path',
        name: 'Trazado Test',
        x: 0,
        y: 0,
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
        closed: false,
        fill: 'none',
        stroke: '#000000',
        strokeWidth: 2,
        strokeDashArray: undefined,
        strokeLineCap: 'butt',
        strokeLineJoin: 'miter',
        opacity: 1,
        visible: true,
        locked: false,
        rotation: 0,
      };
      stateManager.addNode(layerId, testPath);
      stateManager.setSelection([testPath.id]);

      // Modificar dash a 'dashed'
      selectStrokeDash.value = 'dashed';
      selectStrokeDash.dispatchEvent({ type: 'change' });

      let currentPath = stateManager.findNode('test-path-1') as Path;
      assert.deepEqual(currentPath.strokeDashArray, [6, 6]);

      // Undo restaura a undefined
      commandManager.undo();
      currentPath = stateManager.findNode('test-path-1') as Path;
      assert.equal(currentPath.strokeDashArray, undefined);

      bindings.cleanup();
    } finally {
      if (originalQuerySelector) {
        (globalThis as any).document.querySelector = originalQuerySelector;
      } else {
        delete (globalThis as any).document;
      }
    }
  });
});
