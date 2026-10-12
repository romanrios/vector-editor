import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import {
  getTextBaseAABB,
  measureTextWidth,
  getWrappedTextLines,
  getSelectionHandles,
  setSharedMeasureContext,
} from '../src/utils/geometry.ts';
import type { Text, Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

function createMockCanvas(options?: { charWidth?: number }): {
  canvas: HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
  mockCtx: CanvasRenderingContext2D;
  fillCalls: { text: string; x: number; y: number }[];
  rectCalls: { x: number; y: number; w: number; h: number }[];
  lineCalls: Array<{ x: number; y: number }>;
} {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const charWidth = options?.charWidth ?? 10;
  const fillCalls: { text: string; x: number; y: number }[] = [];
  const rectCalls: { x: number; y: number; w: number; h: number }[] = [];
  const lineCalls: Array<{ x: number; y: number }> = [];

  const mockCtx = {
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    beginPath: () => {},
    stroke: () => {},
    fill: () => {},
    moveTo: (x: number, y: number) => {
      lineCalls.push({ x, y });
    },
    lineTo: (x: number, y: number) => {
      lineCalls.push({ x, y });
    },
    setLineDash: () => {},
    arc: () => {},
    setTransform: () => {},
    clearRect: () => {},
    clip: () => {},
    rect: () => {},
    measureText: (text: string) => ({
      width: text.length * charWidth,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 4,
    }),
    fillText: (text: string, x: number, y: number) => {
      fillCalls.push({ text, x, y });
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      rectCalls.push({ x, y, w, h });
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      rectCalls.push({ x, y, w, h });
    },
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    style: { cursor: 'default' },
    width: 1000,
    height: 800,
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
    getContext: (id: string) => (id === '2d' ? mockCtx : null),
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
    dispatchSimulatedEvent: (type: string, e: unknown) => {
      if (listeners[type]) {
        listeners[type].forEach((l) => l(e));
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };

  return { canvas, mockCtx, fillCalls, rectCalls, lineCalls };
}

describe('Ajuste de caja de párrafo (word-wrapping) y manejador right-center', () => {
  describe('1. Tipos y Geometría (measureTextWidth, getTextBaseAABB, getWrappedTextLines)', () => {
    it('measureTextWidth retorna boxWidth si está definido', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      const text: Text = {
        id: 't1',
        type: 'text',
        name: 'Wrapped Text',
        x: 0,
        y: 0,
        text: 'Hola mundo desde el editor vectorial',
        boxWidth: 150,
      };

      assert.equal(measureTextWidth(text, mockCtx), 150);
    });

    it('getWrappedTextLines divide el texto en líneas respetando boxWidth', () => {
      // charWidth = 10. "Hola" = 40, " mundo" => "Hola mundo" = 100
      // " desde" => 160 > 120 -> salto de línea
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      const text: Text = {
        id: 't2',
        type: 'text',
        name: 'Wrapped',
        x: 0,
        y: 0,
        text: 'Hola mundo desde el editor',
        boxWidth: 120, // 12 caracteres caben por línea
      };

      const lines = getWrappedTextLines(text, mockCtx);
      assert.deepEqual(lines, ['Hola mundo', 'desde el', 'editor']);
    });

    it('getTextBaseAABB calcula width = boxWidth y height simulando word-wrapping', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      const text: Text = {
        id: 't3',
        type: 'text',
        name: 'Wrapped AABB',
        x: 50,
        y: 100,
        text: 'Uno dos tres cuatro cinco seis',
        fontSize: 20,
        lineHeight: 24,
        boxWidth: 100, // 10 chars máx -> 'Uno dos' (70), 'tres cuatro' (110 > 100 -> 'tres' (40), 'cuatro' (60)), etc.
      };

      const aabb = getTextBaseAABB(text, mockCtx);
      assert.equal(aabb.width, 100);
      assert.equal(aabb.minX, 50);
      assert.equal(aabb.maxX, 150);
      assert.equal(aabb.minY, 100);

      const lines = getWrappedTextLines(text, mockCtx);
      assert.equal(aabb.height, lines.length * 24);
      assert.equal(aabb.maxY, 100 + lines.length * 24);
    });
  });

  describe('2. Inyección de manejador right-center en getSelectionHandles', () => {
    it('inyecta right-center exclusivamente si el nodo es un Text (sin rotación)', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const text: Text = {
        id: 't4',
        type: 'text',
        name: 'Handles',
        x: 10,
        y: 20,
        text: 'Texto con tirador',
        fontSize: 16,
        boxWidth: 200,
      };

      const handles = getSelectionHandles(text, 8, 30);
      assert.equal(handles.length, 6);

      const rc = handles.find((h) => h.type === 'right-center');
      assert.ok(rc, 'Debe existir un tirador right-center');
      // baseAABB.maxX = 10 + 200 = 210
      // aabb.minY = 20
      const aabb = getTextBaseAABB(text, mockCtx);
      const expectedY = (aabb.minY + aabb.maxY) / 2;
      assert.equal(rc.minX, 210 - 4);
      assert.equal(rc.maxX, 210 + 4);
      assert.equal(rc.minY, expectedY - 4);
      assert.equal(rc.maxY, expectedY + 4);

      setSharedMeasureContext(null);
    });

    it('inyecta right-center para Text con rotación', () => {
      const text: Text = {
        id: 't-rot',
        type: 'text',
        name: 'Rotated Text',
        x: 100,
        y: 100,
        text: 'Rotated',
        fontSize: 16,
        rotation: 90,
        boxWidth: 100,
      };

      const handles = getSelectionHandles(text, 8, 30);
      assert.equal(handles.length, 6);
      const rc = handles.find((h) => h.type === 'right-center');
      assert.ok(rc);
    });

    it('no inyecta right-center en Rectangle, Ellipse o Path', () => {
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      };
      const rectHandles = getSelectionHandles(rect);
      assert.equal(rectHandles.length, 5);
      assert.equal(rectHandles.some((h) => h.type === 'right-center'), false);

      const ellipse: Ellipse = {
        id: 'e1',
        type: 'ellipse',
        name: 'Ell',
        x: 50,
        y: 50,
        radiusX: 50,
        radiusY: 25,
      };
      const ellHandles = getSelectionHandles(ellipse);
      assert.equal(ellHandles.length, 5);
      assert.equal(ellHandles.some((h) => h.type === 'right-center'), false);

      const path: Path = {
        id: 'p1',
        type: 'path',
        name: 'Path',
        x: 0,
        y: 0,
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
      };
      const pathHandles = getSelectionHandles(path);
      assert.equal(pathHandles.length, 5);
      assert.equal(pathHandles.some((h) => h.type === 'right-center'), false);
    });
  });

  describe('3. Renderizado en RenderEngine', () => {
    it('renderText dibuja sub-líneas automáticas separadas por lineHeight cuando boxWidth existe', () => {
      const { canvas, fillCalls } = createMockCanvas({ charWidth: 10 });
      const stateManager = new StateManager();
      const engine = new RenderEngine(canvas, stateManager);

      const text: Text = {
        id: 't-render',
        type: 'text',
        name: 'Rendered Wrap',
        x: 10,
        y: 20,
        text: 'Palabra1 Palabra2 Palabra3',
        fontSize: 16,
        lineHeight: 25,
        boxWidth: 100, // Cada palabra mide ~80px, no caben 2 juntas
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, text);

      // renderText es privado pero se ejecuta en el render del dirty-loop
      engine.render();

      assert.ok(fillCalls.length >= 3, 'Debe haber dibujado al menos 3 líneas');
      assert.equal(fillCalls[0].y, 20);
      assert.equal(fillCalls[1].y, 20 + 25);
      assert.equal(fillCalls[2].y, 20 + 50);
    });

    it('renderiza la selección y el cursor en la línea automática correspondiente', () => {
      const { canvas, rectCalls, lineCalls } = createMockCanvas({ charWidth: 10 });
      const stateManager = new StateManager();
      const text: Text = {
        id: 't-edit-wrap',
        type: 'text',
        name: 'Wrapped edit',
        x: 10,
        y: 20,
        text: 'Palabra1 Palabra2 Palabra3',
        fontSize: 16,
        lineHeight: 25,
        boxWidth: 100,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, text);
      stateManager.selectNode(text.id);

      const engine = new RenderEngine(canvas, stateManager, {
        textEditProvider: () => ({
          textId: text.id,
          text: text.text,
          cursorIndex: 14,
          selectionStart: 11,
          selectionEnd: 14,
        }),
      });

      engine.render();

      assert.ok(
        rectCalls.some((rect) => rect.x === 30 && rect.y === 45 && rect.w === 30 && rect.h === 25),
        'La selección de la segunda palabra debe resaltarse en la segunda línea'
      );
      assert.deepEqual(lineCalls.slice(-2), [{ x: 60, y: 45 }, { x: 60, y: 70 }]);
    });

    it('renderSingleShapeSelection renderiza el manejador right-center en (baseX + baseWidth, baseY + baseHeight / 2)', () => {
      const { canvas, mockCtx, rectCalls } = createMockCanvas({ charWidth: 10 });
      const stateManager = new StateManager();
      const engine = new RenderEngine(canvas, stateManager);

      const text: Text = {
        id: 't-sel-rc',
        type: 'text',
        name: 'Selected Wrap',
        x: 10,
        y: 20,
        text: 'Línea única',
        fontSize: 16,
        lineHeight: 20,
        boxWidth: 100,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, text);
      stateManager.selectNode('t-sel-rc');

      engine.render();

      const aabb = getTextBaseAABB(text, mockCtx);
      const expectedRcX = aabb.maxX;
      const expectedRcY = aabb.minY + aabb.height / 2;

      const matchingHandle = rectCalls.find(
        (r) => Math.abs(r.x - (expectedRcX - 4)) < 1e-4 && Math.abs(r.y - (expectedRcY - 4)) < 1e-4 && r.w === 8 && r.h === 8
      );
      assert.ok(matchingHandle, 'Debe haber dibujado el manejador right-center en la posición esperada');
    });
  });

  describe('4. InputController y ResizeCommand con manejador right-center', () => {
    it('calculateResizedDimensions sobre right-center suma localDx a boxWidth y no altera fontSize', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initialDims = {
        x: 50,
        y: 50,
        width: 100,
        height: 30,
        fontSize: 18,
        lineHeight: 22,
        boxWidth: 120,
        rotation: 0,
      };

      const newDims = controller.calculateResizedDimensions(
        initialDims,
        'right-center',
        40, // dx = 40
        10  // dy = 10 (ignorado para right-center)
      );

      assert.equal(newDims.boxWidth, 160);
      assert.equal(newDims.fontSize, undefined, 'No debe escalar ni sobreescribir fontSize');
      assert.equal(newDims.lineHeight, undefined, 'No debe escalar ni sobreescribir lineHeight');
      assert.equal(newDims.x, 50);
      assert.equal(newDims.y, 50);
    });

    it('calculateResizedDimensions proyecta delta con rotación para right-center', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initialDims = {
        x: 100,
        y: 100,
        rotation: 90,
        boxWidth: 100,
      };

      // Si está rotado 90°, mover cursor hacia abajo (dy = 50) es localDx = +50
      // cos(90) = 0, sin(90) = 1 -> localDx = dx*0 + dy*1 = dy
      const newDims = controller.calculateResizedDimensions(
        initialDims,
        'right-center',
        0,
        50
      );

      assert.equal(Math.round(newDims.boxWidth!), 150);
    });

    it('getResizeCursor devuelve ew-resize o cursor rotado para right-center', () => {
      const { canvas } = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      assert.equal(controller.getResizeCursor('right-center', 0), 'ew-resize');
      assert.equal(controller.getResizeCursor('right-center', 90), 'ns-resize');
    });

    it('arrastre interactivo de right-center actualiza boxWidth y registra ResizeCommand con undo/redo', () => {
      const { canvas, mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const text: Text = {
        id: 't-drag',
        type: 'text',
        name: 'Interactive Text',
        x: 100,
        y: 100,
        text: 'Probando resize right center',
        fontSize: 16,
        boxWidth: 150,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, text);
      stateManager.selectNode('t-drag');

      const handles = getSelectionHandles(text);
      const rc = handles.find((h) => h.type === 'right-center')!;
      const handleCenterX = (rc.minX + rc.maxX) / 2;
      const handleCenterY = (rc.minY + rc.maxY) / 2;

      // 1. Mouse down en el manejador right-center
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: handleCenterX,
        clientY: handleCenterY,
        button: 0,
        shiftKey: false,
      });

      assert.equal(controller.isResizing, true);

      // 2. Mouse move arrastrando 50px a la derecha
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: handleCenterX + 50,
        clientY: handleCenterY,
        shiftKey: false,
      });

      let updated = stateManager.findNode('t-drag') as Text;
      assert.equal(updated.boxWidth, 200);
      assert.equal(updated.fontSize, 16, 'fontSize debe mantenerse intacto');

      // 3. Mouse up finalizando el resize
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: handleCenterX + 50,
        clientY: handleCenterY,
      });

      assert.equal(controller.isResizing, false);
      assert.equal(commandManager.canUndo(), true);

      // 4. Undo
      commandManager.undo();
      updated = stateManager.findNode('t-drag') as Text;
      assert.equal(updated.boxWidth, 150);

      // 5. Redo
      commandManager.redo();
      updated = stateManager.findNode('t-drag') as Text;
      assert.equal(updated.boxWidth, 200);

      setSharedMeasureContext(null);
    });

    it('si el nodo Text originalmente no tenía boxWidth, undo restaura a undefined', () => {
      const { canvas, mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const text: Text = {
        id: 't-point',
        type: 'text',
        name: 'Point Text',
        x: 100,
        y: 100,
        text: 'Texto de punto inicial',
        fontSize: 16,
      };
      const layerId = stateManager.getState().children[0].id;
      stateManager.addShape(layerId, text);
      stateManager.selectNode('t-point');

      const handles = getSelectionHandles(text);
      const rc = handles.find((h) => h.type === 'right-center')!;
      const handleCenterX = (rc.minX + rc.maxX) / 2;
      const handleCenterY = (rc.minY + rc.maxY) / 2;

      // Mouse down en right-center
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: handleCenterX,
        clientY: handleCenterY,
        button: 0,
        shiftKey: false,
      });

      // Mouse move
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: handleCenterX + 60,
        clientY: handleCenterY,
        shiftKey: false,
      });

      // Mouse up
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: handleCenterX + 60,
        clientY: handleCenterY,
      });

      assert.equal(controller.isResizing, false);

      let updated = stateManager.findNode('t-point') as Text;
      assert.ok(typeof updated.boxWidth === 'number');

      // Undo debe eliminar boxWidth restaurando texto de punto
      commandManager.undo();
      updated = stateManager.findNode('t-point') as Text;
      assert.equal(updated.boxWidth, undefined);

      setSharedMeasureContext(null);
    });
  });
});
