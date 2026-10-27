import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import {
  getTextBaseAABB,
  getSelectionBounds,
  setSharedMeasureContext,
} from '../src/utils/geometry.ts';
import type { Text } from '../src/types/scene-graph.ts';

function createMockCanvas(options?: { charWidth?: number }): {
  canvas: HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
  mockCtx: CanvasRenderingContext2D;
} {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const charWidth = options?.charWidth ?? 10;

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
    moveTo: () => {},
    lineTo: () => {},
    strokeRect: () => {},
    fillRect: () => {},
    measureText: (text: string) => {
      const match = String(mockCtx.font).match(/(\d+(?:\.\d+)?)px/);
      const fs = match ? parseFloat(match[1]) : 16;
      const scale = fs / 16;
      return { width: text.length * charWidth * scale };
    },
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 800,
    height: 600,
    style: { cursor: 'default' },
    getContext: () => mockCtx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, e: unknown) => {
      if (listeners[type]) {
        for (const l of listeners[type]) {
          l(e);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };

  return { canvas, mockCtx };
}

describe('Escalado de Texto con Anclaje en Esquina Opuesta, Centro (Alt) y Progresión Diagonal', () => {
  it('1. Al escalar desde bottom-left, el texto se ancla en la esquina superior derecha (top-right)', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    // Texto de ancho 80, alto 20 en (100, 100), fontSize 20
    const initialDims = {
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      fontSize: 20,
      rotation: 0,
    };

    // Arrastrar bottom-left hacia la izquierda (-80) y abajo (+20): duplica la escala
    const resized = controller.calculateResizedDimensions(
      initialDims,
      'bottom-left',
      -80,
      20,
      false, // preserveRatio
      false  // fromCenter
    );

    // La esquina superior derecha original es (100 + 80, 100) = (180, 100)
    const expectedTopRightX = 180;
    const expectedTopRightY = 100;

    const actualTopRightX = (resized.x ?? 0) + (resized.width ?? 0);
    const actualTopRightY = resized.y ?? 0;

    assert.equal(actualTopRightX, expectedTopRightX, 'La coordenada X de la esquina top-right debe permanecer fija');
    assert.equal(actualTopRightY, expectedTopRightY, 'La coordenada Y de la esquina top-right debe permanecer fija');
    assert.ok((resized.fontSize ?? 0) > 20, 'El fontSize debe aumentar proporcionalmente');

    controller.destroy();
  });

  it('2. Al escalar desde top-left, el texto se ancla en la esquina inferior derecha (bottom-right)', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const initialDims = {
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      fontSize: 20,
      rotation: 0,
    };

    // Arrastrar top-left hacia la izquierda (-80) y arriba (-20)
    const resized = controller.calculateResizedDimensions(
      initialDims,
      'top-left',
      -80,
      -20,
      false,
      false
    );

    // La esquina inferior derecha original es (100 + 80, 100 + 20) = (180, 120)
    const expectedBottomRightX = 180;
    const expectedBottomRightY = 120;

    const actualBottomRightX = (resized.x ?? 0) + (resized.width ?? 0);
    const actualBottomRightY = (resized.y ?? 0) + (resized.height ?? 0);

    assert.equal(actualBottomRightX, expectedBottomRightX, 'La coordenada X de bottom-right debe permanecer fija');
    assert.equal(actualBottomRightY, expectedBottomRightY, 'La coordenada Y de bottom-right debe permanecer fija');
    assert.ok((resized.fontSize ?? 0) > 20);

    controller.destroy();
  });

  it('3. Al escalar desde top-right, el texto se ancla en la esquina inferior izquierda (bottom-left)', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const initialDims = {
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      fontSize: 20,
      rotation: 0,
    };

    // Arrastrar top-right hacia la derecha (+80) y arriba (-20)
    const resized = controller.calculateResizedDimensions(
      initialDims,
      'top-right',
      80,
      -20,
      false,
      false
    );

    // La esquina inferior izquierda original es (100, 100 + 20) = (100, 120)
    const expectedBottomLeftX = 100;
    const expectedBottomLeftY = 120;

    const actualBottomLeftX = resized.x ?? 0;
    const actualBottomLeftY = (resized.y ?? 0) + (resized.height ?? 0);

    assert.equal(actualBottomLeftX, expectedBottomLeftX, 'La coordenada X de bottom-left debe permanecer fija');
    assert.equal(actualBottomLeftY, expectedBottomLeftY, 'La coordenada Y de bottom-left debe permanecer fija');

    controller.destroy();
  });

  it('4. Al escalar desde bottom-right, el texto se ancla en la esquina superior izquierda (top-left)', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const initialDims = {
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      fontSize: 20,
      rotation: 0,
    };

    // Arrastrar bottom-right hacia la derecha (+80) y abajo (+20)
    const resized = controller.calculateResizedDimensions(
      initialDims,
      'bottom-right',
      80,
      20,
      false,
      false
    );

    assert.equal(resized.x, 100, 'La posición x debe permanecer invariante en top-left');
    assert.equal(resized.y, 100, 'La posición y debe permanecer invariante en top-left');

    controller.destroy();
  });

  it('5. La dirección que hace progresar el escalado es diagonal y sensible tanto a X como a Y', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const initialDims = {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      fontSize: 20,
      rotation: 0,
    };

    // Movimiento solo en X
    const resOnlyX = controller.calculateResizedDimensions(
      initialDims,
      'bottom-right',
      50,
      0,
      false,
      false
    );

    // Movimiento solo en Y
    const resOnlyY = controller.calculateResizedDimensions(
      initialDims,
      'bottom-right',
      0,
      50,
      false,
      false
    );

    // Movimiento diagonal en X e Y
    const resDiag = controller.calculateResizedDimensions(
      initialDims,
      'bottom-right',
      50,
      50,
      false,
      false
    );

    // Con una caja cuadrada de 100x100, el avance de +50 en X debe ser igual al avance de +50 en Y
    assert.equal(resOnlyX.fontSize, resOnlyY.fontSize, 'El escalado en X e Y debe ser simétrico');
    assert.ok(resOnlyX.fontSize! > 20, 'Un arrastre horizontal debe progresar el escalado diagonal');
    assert.ok(resOnlyY.fontSize! > 20, 'Un arrastre vertical debe progresar el escalado diagonal');
    assert.ok(resDiag.fontSize! > resOnlyX.fontSize!, 'Un arrastre diagonal combinado debe avanzar más que en un solo eje');

    controller.destroy();
  });

  it('6. Al mantener Alt (fromCenter = true), el centro del cuadro de texto se mantiene exactamente fijo', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const initialDims = {
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      fontSize: 20,
      rotation: 0,
    };

    const initialCenterX = 100 + 80 / 2; // 140
    const initialCenterY = 100 + 20 / 2; // 110

    const corners: ('top-left' | 'top-right' | 'bottom-left' | 'bottom-right')[] = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ];

    for (const corner of corners) {
      const dx = corner.includes('right') ? 40 : -40;
      const dy = corner.includes('bottom') ? 10 : -10;

      const resized = controller.calculateResizedDimensions(
        initialDims,
        corner,
        dx,
        dy,
        false,
        true // fromCenter = true (tecla Alt)
      );

      const actualCenterX = (resized.x ?? 0) + (resized.width ?? 0) / 2;
      const actualCenterY = (resized.y ?? 0) + (resized.height ?? 0) / 2;

      assert.equal(
        actualCenterX,
        initialCenterX,
        `El centro X debe permanecer invariante al escalar desde ${corner} con Alt`
      );
      assert.equal(
        actualCenterY,
        initialCenterY,
        `El centro Y debe permanecer invariante al escalar desde ${corner} con Alt`
      );
    }

    controller.destroy();
  });

  it('7. Al escalar texto rotado 90°, el ancla opuesta en coordenadas de mundo se mantiene fija', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const initialDims = {
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      fontSize: 20,
      rotation: 90,
    };

    // A 90°, el eje X local apunta hacia abajo y el eje Y local apunta hacia la izquierda
    // Al escalar desde bottom-left sin Alt, el ancla es top-right unrotated (180, 100)
    // En mundo, (180, 100) rotado 90° respecto a (100, 100) es:
    // wx = 100 - (100 - 100) = 100, wy = 100 + (180 - 100) = 180
    const resized = controller.calculateResizedDimensions(
      initialDims,
      'bottom-left',
      0, // desplazamiento en mundo
      80,
      false,
      false
    );

    // Calculamos la posición de la esquina top-right en coordenadas de mundo del nuevo texto
    const rad = (90 * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const newX = resized.x ?? 0;
    const newY = resized.y ?? 0;
    const newW = resized.width ?? 0;

    const actualTopRightWorldX = newX + newW * cos;
    const actualTopRightWorldY = newY + newW * sin;

    assert.ok(Math.abs(actualTopRightWorldX - 100) < 1e-6, 'El ancla en X en mundo debe ser 100');
    assert.ok(Math.abs(actualTopRightWorldY - 180) < 1e-6, 'El ancla en Y en mundo debe ser 180');

    controller.destroy();
  });

  it('8. Arrastre interactivo de esquina izquierda registra ResizeCommand y permite Undo/Redo exacto', () => {
    const { canvas, mockCtx } = createMockCanvas();
    setSharedMeasureContext(mockCtx);
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const textNode: Text = {
      id: 'text-drag-test',
      type: 'text',
      name: 'Interactive Drag',
      x: 100,
      y: 100,
      text: 'Texto Test',
      fontSize: 20,
      rotation: 0,
    };

    stateManager.addShape('layer-default', textNode);
    stateManager.setSelection(['text-drag-test']);

    const initialAABB = getTextBaseAABB(textNode, mockCtx);
    const initialTopRightX = initialAABB.maxX;

    // 1. Simular mousedown sobre el manejador bottom-left (100, 120)
    canvas.dispatchSimulatedEvent('mousedown', {
      clientX: 100,
      clientY: 120,
      button: 0,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    assert.equal(controller.isResizing, true, 'Debe encontrarse en modo redimensionado');

    // 2. Simular mousemove arrastrando bottom-left hacia la izquierda (-40) y abajo (+10)
    canvas.dispatchSimulatedEvent('mousemove', {
      clientX: 60,
      clientY: 130,
      button: 0,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    const draggingNode = stateManager.findNode('text-drag-test') as Text;
    assert.ok(draggingNode.fontSize! > 20, 'El fontSize debe haber aumentado durante el arrastre');
    const aabbDragging = getTextBaseAABB(draggingNode, mockCtx);
    assert.ok(Math.abs(aabbDragging.maxX - initialTopRightX) < 1, 'La esquina superior derecha debe permanecer fija en el ancla original');

    // 3. Simular mouseup
    canvas.dispatchSimulatedEvent('mouseup', {
      clientX: 60,
      clientY: 130,
      button: 0,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    assert.equal(controller.isResizing, false, 'Debe haber finalizado el redimensionado');
    assert.equal(commandManager.undoCount, 1, 'Debe haberse registrado un ResizeCommand');

    // 4. Undo
    commandManager.undo();
    const undoneNode = stateManager.findNode('text-drag-test') as Text;
    assert.equal(undoneNode.fontSize, 20, 'Undo debe restaurar el fontSize inicial');
    assert.equal(undoneNode.x, 100, 'Undo debe restaurar x');
    assert.equal(undoneNode.y, 100, 'Undo debe restaurar y');

    // 5. Redo
    commandManager.redo();
    const redoneNode = stateManager.findNode('text-drag-test') as Text;
    assert.ok(redoneNode.fontSize! > 20, 'Redo debe restaurar el tamaño escalado');

    controller.destroy();
  });

  describe('Escalado de Múltiples Textos Seleccionados en Simultáneo', () => {
    function setupTwoTexts(): {
      canvas: HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
      mockCtx: CanvasRenderingContext2D;
      stateManager: StateManager;
      commandManager: CommandManager;
      controller: InputController;
      text1: Text;
      text2: Text;
      initialBounds: { minX: number; minY: number; maxX: number; maxY: number };
    } {
      const { canvas, mockCtx } = createMockCanvas();
      setSharedMeasureContext(mockCtx);
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      // text1: x=100, y=100, fontSize=20, 'TEXTO1' (6 letras -> 75px ancho, 20px alto) -> [100, 100, 175, 120]
      const text1: Text = {
        id: 'multi-text-1',
        type: 'text',
        name: 'Texto 1',
        x: 100,
        y: 100,
        text: 'TEXTO1',
        fontSize: 20,
      };
      // text2: x=200, y=200, fontSize=20, 'TEXTO2' (6 letras -> 75px ancho, 20px alto) -> [200, 200, 275, 220]
      const text2: Text = {
        id: 'multi-text-2',
        type: 'text',
        name: 'Texto 2',
        x: 200,
        y: 200,
        text: 'TEXTO2',
        fontSize: 20,
      };

      stateManager.addShape(layerId, text1);
      stateManager.addShape(layerId, text2);
      stateManager.setSelection(['multi-text-1', 'multi-text-2']);

      const b = getSelectionBounds(stateManager.getSelectedNodes())!;
      const initialBounds = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };

      return {
        canvas,
        mockCtx,
        stateManager,
        commandManager,
        controller,
        text1,
        text2,
        initialBounds,
      };
    }

    it('9. Al escalar varios textos desde bottom-left, el anclaje permanece estrictamente fijo en top-right', () => {
      const { canvas, stateManager, commandManager, controller, initialBounds } = setupTwoTexts();

      // Arrastrar handle bottom-left (100, 220) hacia la izquierda (-50) y abajo (+30) sin Shift
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: initialBounds.minX,
        clientY: initialBounds.maxY,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      assert.equal(controller.isMultiTransforming, true);

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: initialBounds.minX - 50,
        clientY: initialBounds.maxY + 30,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      const newBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
      // El ancla opuesta a bottom-left es top-right (maxX, minY)
      assert.ok(
        Math.abs(newBounds.maxX - initialBounds.maxX) < 0.1,
        `La esquina derecha debe permanecer fija en ${initialBounds.maxX}, actual: ${newBounds.maxX}`
      );
      assert.ok(
        Math.abs(newBounds.minY - initialBounds.minY) < 0.1,
        `La esquina superior debe permanecer fija en ${initialBounds.minY}, actual: ${newBounds.minY}`
      );

      // Los textos deben haber crecido proporcionalmente
      const t1 = stateManager.findNode('multi-text-1') as Text;
      const t2 = stateManager.findNode('multi-text-2') as Text;
      assert.ok(t1.fontSize! > 20);
      assert.ok(t2.fontSize! > 20);
      assert.equal(t1.fontSize, t2.fontSize);

      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: initialBounds.minX - 50,
        clientY: initialBounds.maxY + 30,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      assert.equal(controller.isMultiTransforming, false);
      assert.equal(commandManager.undoCount, 1);

      // Undo restaura dimensiones originales exactas
      commandManager.undo();
      const bUndo = getSelectionBounds(stateManager.getSelectedNodes())!;
      assert.ok(Math.abs(bUndo.minX - initialBounds.minX) < 0.1);
      assert.ok(Math.abs(bUndo.maxX - initialBounds.maxX) < 0.1);

      controller.destroy();
    });

    it('10. Al escalar varios textos desde top-left, el anclaje permanece estrictamente fijo en bottom-right', () => {
      const { canvas, stateManager, controller, initialBounds } = setupTwoTexts();

      // Arrastrar handle top-left (100, 100) hacia arriba y la izquierda (-40, -40)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: initialBounds.minX,
        clientY: initialBounds.minY,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: initialBounds.minX - 40,
        clientY: initialBounds.minY - 40,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      const newBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
      // El ancla opuesta a top-left es bottom-right (maxX, maxY)
      assert.ok(
        Math.abs(newBounds.maxX - initialBounds.maxX) < 0.1,
        `La esquina derecha debe permanecer fija en ${initialBounds.maxX}, actual: ${newBounds.maxX}`
      );
      assert.ok(
        Math.abs(newBounds.maxY - initialBounds.maxY) < 0.1,
        `La esquina inferior debe permanecer fija en ${initialBounds.maxY}, actual: ${newBounds.maxY}`
      );

      controller.destroy();
    });

    it('11. Al escalar varios textos desde top-right, el anclaje permanece estrictamente fijo en bottom-left', () => {
      const { canvas, stateManager, controller, initialBounds } = setupTwoTexts();

      // Arrastrar handle top-right (275, 100) hacia arriba y la derecha (+40, -40)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: initialBounds.maxX,
        clientY: initialBounds.minY,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: initialBounds.maxX + 40,
        clientY: initialBounds.minY - 40,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      const newBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
      // El ancla opuesta a top-right es bottom-left (minX, maxY)
      assert.ok(
        Math.abs(newBounds.minX - initialBounds.minX) < 0.1,
        `La esquina izquierda debe permanecer fija en ${initialBounds.minX}, actual: ${newBounds.minX}`
      );
      assert.ok(
        Math.abs(newBounds.maxY - initialBounds.maxY) < 0.1,
        `La esquina inferior debe permanecer fija en ${initialBounds.maxY}, actual: ${newBounds.maxY}`
      );

      controller.destroy();
    });

    it('12. Al escalar varios textos desde bottom-right, el anclaje permanece estrictamente fijo en top-left', () => {
      const { canvas, stateManager, controller, initialBounds } = setupTwoTexts();

      // Arrastrar handle bottom-right (275, 220) hacia abajo y la derecha (+40, +40)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: initialBounds.maxX,
        clientY: initialBounds.maxY,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: initialBounds.maxX + 40,
        clientY: initialBounds.maxY + 40,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      const newBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
      // El ancla opuesta a bottom-right es top-left (minX, minY)
      assert.ok(
        Math.abs(newBounds.minX - initialBounds.minX) < 0.1,
        `La esquina izquierda debe permanecer fija en ${initialBounds.minX}, actual: ${newBounds.minX}`
      );
      assert.ok(
        Math.abs(newBounds.minY - initialBounds.minY) < 0.1,
        `La esquina superior debe permanecer fija en ${initialBounds.minY}, actual: ${newBounds.minY}`
      );

      controller.destroy();
    });

    it('13. Al mantener Alt (fromCenter = true), el centro de la selección multilínea permanece exactamente fijo', () => {
      const { canvas, stateManager, controller, initialBounds } = setupTwoTexts();
      const initialCenterX = (initialBounds.minX + initialBounds.maxX) / 2;
      const initialCenterY = (initialBounds.minY + initialBounds.maxY) / 2;

      // Arrastrar con altKey = true
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: initialBounds.maxX,
        clientY: initialBounds.maxY,
        button: 0,
        shiftKey: false,
        altKey: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: initialBounds.maxX + 30,
        clientY: initialBounds.maxY + 30,
        button: 0,
        shiftKey: false,
        altKey: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      });

      const newBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
      const newCenterX = (newBounds.minX + newBounds.maxX) / 2;
      const newCenterY = (newBounds.minY + newBounds.maxY) / 2;

      assert.ok(
        Math.abs(newCenterX - initialCenterX) < 0.1,
        `El centro X debe permanecer en ${initialCenterX}, actual: ${newCenterX}`
      );
      assert.ok(
        Math.abs(newCenterY - initialCenterY) < 0.1,
        `El centro Y debe permanecer en ${initialCenterY}, actual: ${newCenterY}`
      );

      controller.destroy();
    });

    it('14. escalado suave de texto: incrementos pequeños generan valores fraccionarios de fontSize sin saltos enteros', () => {
      const { canvas, mockCtx } = createMockCanvas();
      setSharedMeasureContext(mockCtx);
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const initialDims = {
        x: 100,
        y: 100,
        width: 100,
        height: 20,
        fontSize: 16,
        lineHeight: 20,
        boxWidth: 100,
        rotation: 0,
      };

      // Un desplazamiento leve de +1px en X e Y
      const resSmall = controller.calculateResizedDimensions(
        initialDims,
        'bottom-right',
        1,
        1,
        false,
        false
      );

      // No debe ser entero (16), debe ser fraccionario suavemente mayor a 16
      assert.ok(resSmall.fontSize! > 16, 'fontSize debe avanzar incluso con desplazamientos mínimos (+1px)');
      assert.ok(resSmall.fontSize! < 17, 'fontSize no debe saltar de golpe a 17');
      assert.equal(Number.isInteger(resSmall.fontSize), false, 'fontSize debe permitir valores decimales para un escalado suave');

      // Un desplazamiento de +2px debe ser suavemente mayor al de +1px
      const resSmall2 = controller.calculateResizedDimensions(
        initialDims,
        'bottom-right',
        2,
        2,
        false,
        false
      );
      assert.ok(resSmall2.fontSize! > resSmall.fontSize!, 'Cada incremento de arrastre debe ser progresivo y suave');
      assert.ok(resSmall2.boxWidth! > resSmall.boxWidth!, 'boxWidth debe escalar suavemente con decimales');
      assert.ok(resSmall2.lineHeight! > resSmall.lineHeight!, 'lineHeight debe escalar suavemente con decimales');

      controller.destroy();
    });
  });
});
