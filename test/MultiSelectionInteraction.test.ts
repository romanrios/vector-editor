import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { BatchCommand } from '../src/commands/BatchCommand.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import type { Rectangle, Path, Layer } from '../src/types/scene-graph.ts';

// Helper mock para Canvas y Context2D con eventos y viewport
function createMockCanvas(width: number = 800, height: number = 600) {
  const transformCalls: number[][] = [];
  const strokes: { lineWidth: number; strokeStyle?: string }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const strokeRects: { x: number; y: number; w: number; h: number }[] = [];
  const fillRects: { x: number; y: number; w: number; h: number }[] = [];
  const lineDashes: number[][] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

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
    getContext: () => mockCtx as CanvasRenderingContext2D,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
    mockCtx,
    records: {
      transformCalls,
      strokes,
      rects,
      strokeRects,
      fillRects,
      lineDashes,
    },
  };

  return canvas as unknown as HTMLCanvasElement & {
    dispatchSimulatedEvent: (type: string, e: unknown) => void;
    records: {
      transformCalls: number[][];
      strokes: { lineWidth: number; strokeStyle?: string }[];
      rects: { x: number; y: number; w: number; h: number }[];
      strokeRects: { x: number; y: number; w: number; h: number }[];
      fillRects: { x: number; y: number; w: number; h: number }[];
      lineDashes: number[][];
    };
  };
}

describe('Interacción de Selección Múltiple (InputController y RenderEngine)', () => {
  it('A.1: Shift+clic sobre una figura alterna su presencia (toggleInSelection) sin iniciar arrastre', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const rectA: Rectangle = {
      id: 'rect-a',
      type: 'rectangle',
      name: 'Rect A',
      x: 50,
      y: 50,
      width: 80,
      height: 60,
    };
    const rectB: Rectangle = {
      id: 'rect-b',
      type: 'rectangle',
      name: 'Rect B',
      x: 200,
      y: 50,
      width: 80,
      height: 60,
    };

    stateManager.addShape(layerId, rectA);
    stateManager.addShape(layerId, rectB);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    // 1. Clic simple sobre rectA -> se selecciona solo rectA
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 70, clientY: 70, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['rect-a']);
    assert.equal(controller.isDragging, true);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 70, clientY: 70, button: 0 });
    assert.equal(controller.isDragging, false);

    // 2. Shift+clic sobre rectB -> suma rectB sin arrastre
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 220, clientY: 70, shiftKey: true, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['rect-a', 'rect-b']);
    assert.equal(controller.isDragging, false, 'Shift+clic NO debe iniciar arrastre');

    // 3. Shift+clic sobre rectA -> quita rectA sin arrastre
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 70, clientY: 70, shiftKey: true, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['rect-b']);
    assert.equal(controller.isDragging, false, 'Shift+clic NO debe iniciar arrastre');

    // 4. Shift+clic sobre rectB -> quita rectB, selección queda vacía
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 220, clientY: 70, shiftKey: true, button: 0 });
    assert.deepEqual(stateManager.getSelection(), []);
    assert.equal(controller.isDragging, false);

    controller.destroy();
  });

  it('A.2: Clic sobre figura en multiselección mantiene el grupo; si se suelta sin arrastre (<3px) la reduce a una', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const rectA: Rectangle = {
      id: 'rect-a',
      type: 'rectangle',
      name: 'Rect A',
      x: 100,
      y: 100,
      width: 100,
      height: 80,
    };
    const rectB: Rectangle = {
      id: 'rect-b',
      type: 'rectangle',
      name: 'Rect B',
      x: 250,
      y: 100,
      width: 100,
      height: 80,
    };

    stateManager.addShape(layerId, rectA);
    stateManager.addShape(layerId, rectB);
    stateManager.setSelection(['rect-a', 'rect-b']);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    // 1. Clic sobre rectB (270, 120) sin Shift
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 270, clientY: 120, button: 0 });
    // Se mantiene la selección múltiple mientras se arrastra
    assert.deepEqual(stateManager.getSelection(), ['rect-a', 'rect-b']);
    assert.equal(controller.isDragging, true);

    // 2. Micro-desplazamiento de 1px (< umbral de 3px en pantalla)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 271, clientY: 120 });
    assert.deepEqual(stateManager.getSelection(), ['rect-a', 'rect-b']);

    // 3. Soltar el ratón sin haber superado los 3px
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 271, clientY: 120, button: 0 });
    // La selección pasa a ser SOLO rectB
    assert.deepEqual(stateManager.getSelection(), ['rect-b']);
    assert.equal(commandManager.canUndo(), false, 'No debe registrar comandos al no haber arrastre real');

    // Las posiciones no cambiaron
    const shapeA = stateManager.findNode('rect-a') as Rectangle;
    const shapeB = stateManager.findNode('rect-b') as Rectangle;
    assert.equal(shapeA.x, 100);
    assert.equal(shapeB.x, 250);

    controller.destroy();
  });

  it('A.3: Clic sin Shift sobre una figura no seleccionada realiza selección simple directa', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const rectA: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 50, width: 50, height: 50 };
    const rectB: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 150, y: 50, width: 50, height: 50 };
    stateManager.addShape(layerId, rectA);
    stateManager.addShape(layerId, rectB);
    stateManager.selectNode('r1');

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Clic sobre r2
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 170, clientY: 70, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['r2']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 170, clientY: 70, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['r2']);

    controller.destroy();
  });

  it('A.5: Arrastre de varias figuras usa updateShapesPosition y registra UN BatchCommand (un solo Ctrl+Z revierte todo)', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const rectA: Rectangle = { id: 'ra', type: 'rectangle', name: 'RA', x: 100, y: 100, width: 60, height: 40 };
    const rectB: Rectangle = { id: 'rb', type: 'rectangle', name: 'RB', x: 200, y: 200, width: 60, height: 40 };
    stateManager.addShape(layerId, rectA);
    stateManager.addShape(layerId, rectB);
    stateManager.setSelection(['ra', 'rb']);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    // Mousedown en (110, 110)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 110, clientY: 110, button: 0 });

    // Mousemove de 40px en X y 30px en Y
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 140 });

    // En vivo ambas figuras se movieron
    let shapeA = stateManager.findNode('ra') as Rectangle;
    let shapeB = stateManager.findNode('rb') as Rectangle;
    assert.equal(shapeA.x, 140);
    assert.equal(shapeA.y, 130);
    assert.equal(shapeB.x, 240);
    assert.equal(shapeB.y, 230);

    // Mouseup registra un único comando
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 140, button: 0 });
    assert.equal(commandManager.canUndo(), true);

    const history = (commandManager as any).undoStack;
    const lastCmd = history[history.length - 1];
    assert.equal(lastCmd instanceof BatchCommand, true, 'El comando registrado debe ser un BatchCommand');
    assert.equal(lastCmd.commands[0] instanceof TranslateCommand, true);

    // Deshacer devuelve AMBAS figuras a su posición original en UN solo paso
    const undone = commandManager.undo();
    assert.equal(undone, true);

    shapeA = stateManager.findNode('ra') as Rectangle;
    shapeB = stateManager.findNode('rb') as Rectangle;
    assert.equal(shapeA.x, 100);
    assert.equal(shapeA.y, 100);
    assert.equal(shapeB.x, 200);
    assert.equal(shapeB.y, 200);

    // Rehacer (Ctrl+Y) restaura ambas figuras en un paso
    commandManager.redo();
    shapeA = stateManager.findNode('ra') as Rectangle;
    shapeB = stateManager.findNode('rb') as Rectangle;
    assert.equal(shapeA.x, 140);
    assert.equal(shapeB.x, 240);

    controller.destroy();
  });

  it('A.4: Rectángulo de selección marquesina en las cuatro direcciones con getShapesIntersectingRect', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    // 4 figuras ubicadas en cuadrantes
    const shapeTL: Rectangle = { id: 's-tl', type: 'rectangle', name: 'TL', x: 50, y: 50, width: 40, height: 40 };
    const shapeTR: Rectangle = { id: 's-tr', type: 'rectangle', name: 'TR', x: 200, y: 50, width: 40, height: 40 };
    const shapeBL: Rectangle = { id: 's-bl', type: 'rectangle', name: 'BL', x: 50, y: 200, width: 40, height: 40 };
    const shapeBR: Rectangle = { id: 's-br', type: 'rectangle', name: 'BR', x: 200, y: 200, width: 40, height: 40 };

    stateManager.addShape(layerId, shapeTL);
    stateManager.addShape(layerId, shapeTR);
    stateManager.addShape(layerId, shapeBL);
    stateManager.addShape(layerId, shapeBR);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // 1. Arrastre Abajo-Derecha (Down-Right): de (20, 20) a (110, 110) -> cubre s-tl
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 20, clientY: 20, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 110, clientY: 110 });
    assert.equal(controller.isMarqueeSelecting, true);
    assert.equal(controller.shapePreview?.type, 'marquee');
    assert.deepEqual(stateManager.getSelection(), ['s-tl']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 110, clientY: 110, button: 0 });
    assert.equal(controller.shapePreview, null);
    assert.deepEqual(stateManager.getSelection(), ['s-tl']);

    // 2. Arrastre Arriba-Izquierda (Up-Left): de (260, 260) a (180, 180) -> cubre s-br
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 260, clientY: 260, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 180, clientY: 180 });
    assert.deepEqual(stateManager.getSelection(), ['s-br']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 180, clientY: 180, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['s-br']);

    // 3. Arrastre Arriba-Derecha (Up-Right): de (20, 260) a (110, 180) -> cubre s-bl
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 20, clientY: 260, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 110, clientY: 180 });
    assert.deepEqual(stateManager.getSelection(), ['s-bl']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 110, clientY: 180, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['s-bl']);

    // 4. Arrastre Abajo-Izquierda (Down-Left): de (260, 20) a (180, 110) -> cubre s-tr
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 260, clientY: 20, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 180, clientY: 110 });
    assert.deepEqual(stateManager.getSelection(), ['s-tr']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 180, clientY: 110, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['s-tr']);

    controller.destroy();
  });

  it('A.4: Rectángulo con Shift suma a la selección; sin Shift la reemplaza; clic vacío deselecciona', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 50, y: 50, width: 40, height: 40 };
    const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 150, y: 50, width: 40, height: 40 };
    stateManager.addShape(layerId, s1);
    stateManager.addShape(layerId, s2);

    stateManager.selectNode('s1');

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Arrastre sobre s2 CON Shift -> suma s2 a la selección previa ['s1']
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 130, clientY: 30, shiftKey: true, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 200, clientY: 100 });
    assert.deepEqual([...stateManager.getSelection()].sort(), ['s1', 's2']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 100, button: 0 });
    assert.deepEqual([...stateManager.getSelection()].sort(), ['s1', 's2']);

    // Arrastre sobre s1 SIN Shift -> reemplaza selección dejando solo ['s1']
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 30, clientY: 30, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 100, clientY: 100 });
    assert.deepEqual(stateManager.getSelection(), ['s1']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['s1']);

    // Clic en el vacío sin arrastre deselecciona
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 300, clientY: 300, button: 0 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 300, clientY: 300, button: 0 });
    assert.deepEqual(stateManager.getSelection(), []);

    controller.destroy();
  });

  it('A.4: Rectángulo de selección excluye figuras ocultas o bloqueadas (en capas y figuras)', () => {
    const stateManager = new StateManager();
    const baseLayerId = stateManager.getState().children[0].id;

    // Capa oculta y capa bloqueada
    const hiddenLayer: Layer = { id: 'lay-hidden', type: 'layer', name: 'Hidden Layer', visible: false, locked: false, children: [] };
    const lockedLayer: Layer = { id: 'lay-locked', type: 'layer', name: 'Locked Layer', visible: true, locked: true, children: [] };
    stateManager.addLayer(hiddenLayer);
    stateManager.addLayer(lockedLayer);

    const sVisible: Rectangle = { id: 's-vis', type: 'rectangle', name: 'Visible', x: 50, y: 50, width: 40, height: 40 };
    const sHidden: Rectangle = { id: 's-hid', type: 'rectangle', name: 'Hidden', x: 100, y: 50, width: 40, height: 40, visible: false };
    const sLocked: Rectangle = { id: 's-lck', type: 'rectangle', name: 'Locked', x: 150, y: 50, width: 40, height: 40, locked: true };
    const sInHiddenLayer: Rectangle = { id: 's-in-hl', type: 'rectangle', name: 'In Hidden Layer', x: 200, y: 50, width: 40, height: 40 };
    const sInLockedLayer: Rectangle = { id: 's-in-ll', type: 'rectangle', name: 'In Locked Layer', x: 250, y: 50, width: 40, height: 40 };

    stateManager.addShape(baseLayerId, sVisible);
    stateManager.addShape(baseLayerId, sHidden);
    stateManager.addShape(baseLayerId, sLocked);
    stateManager.addShape('lay-hidden', sInHiddenLayer);
    stateManager.addShape('lay-locked', sInLockedLayer);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Arrastre marquesina cubriendo todas las figuras (de 0,0 a 350,150)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 10, clientY: 10, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 320, clientY: 120 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 320, clientY: 120, button: 0 });

    // Solo debe seleccionarse la figura visible y desbloqueada
    assert.deepEqual(stateManager.getSelection(), ['s-vis']);

    controller.destroy();
  });

  it('A.4: Escape durante el arrastre de marquesina lo cancela y restaura la selección previa', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const sA: Rectangle = { id: 'sa', type: 'rectangle', name: 'SA', x: 50, y: 50, width: 40, height: 40 };
    const sB: Rectangle = { id: 'sb', type: 'rectangle', name: 'SB', x: 150, y: 50, width: 40, height: 40 };
    stateManager.addShape(layerId, sA);
    stateManager.addShape(layerId, sB);
    stateManager.selectNode('sa');

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Iniciar marquesina sobre sB
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 120, clientY: 30, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 200, clientY: 100 });
    assert.deepEqual(stateManager.getSelection(), ['sb']);
    assert.equal(controller.isMarqueeSelecting, true);

    // Presionar Escape durante el arrastre
    controller.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

    assert.equal(controller.isMarqueeSelecting, false);
    assert.equal(controller.shapePreview, null);
    // Restaura la selección previa
    assert.deepEqual(stateManager.getSelection(), ['sa']);

    controller.destroy();
  });

  it('A.6: Ctrl/Cmd+A ejecuta selectAll; Escape con selección y sin operación deselecciona', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 20, width: 40, height: 40 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 80, y: 20, width: 40, height: 40 };
    const rLocked: Rectangle = { id: 'rl', type: 'rectangle', name: 'RL', x: 140, y: 20, width: 40, height: 40, locked: true };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);
    stateManager.addShape(layerId, rLocked);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    let prevented = false;
    controller.handleKeyDown({
      key: 'a',
      ctrlKey: true,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent);

    assert.equal(prevented, true);
    assert.deepEqual([...stateManager.getSelection()].sort(), ['r1', 'r2']);

    // Escape sin operación activa -> deselecciona
    controller.handleKeyDown({ key: 'Escape' } as KeyboardEvent);
    assert.deepEqual(stateManager.getSelection(), []);

    controller.destroy();
  });

  it('A.7: Con varias figuras seleccionadas NO se muestran ni detectan tiradores de redimensionar o rotación', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 100, y: 100, width: 100, height: 100 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 300, y: 100, width: 100, height: 100 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // 1. Con exactamente 1 figura seleccionada: rotation handle está en (150, 70)
    stateManager.selectNode('r1');
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 70, button: 0 });
    assert.equal(controller.isRotating, true, 'Con 1 figura, rotation-handle debe detectarse');
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 70, button: 0 });

    // 2. Con múltiples figuras seleccionadas:
    stateManager.setSelection(['r1', 'r2']);

    // Intentar hacer clic en el rotation handle anterior (150, 70)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 70, button: 0 });
    assert.equal(controller.isRotating, false, 'Con varias figuras, NO se detecta rotation handle');
    assert.equal(controller.isResizing, false, 'Con varias figuras, NO se detecta resize handle');

    // Intentar hacer clic en la esquina de r1 (100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, button: 0 });
    assert.equal(controller.isResizing, false, 'Con varias figuras, NO se detecta resize handle en esquinas');

    controller.destroy();
  });

  it('A.8: Selección directa solo actúa con exactamente un trazado y transición de herramientas', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const rect: Rectangle = { id: 'rect-tool', type: 'rectangle', name: 'Rect', x: 50, y: 50, width: 50, height: 50 };
    const path: Path = {
      id: 'path-tool',
      type: 'path',
      name: 'Path',
      x: 150,
      y: 150,
      points: [
        { x: 150, y: 150 },
        { x: 200, y: 200 },
      ],
      closed: false,
    };
    stateManager.addShape(layerId, rect);
    stateManager.addShape(layerId, path);

    stateManager.setSelection(['rect-tool', 'path-tool']);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Cambiar a direct-select -> debe reducir la selección múltiple al Path
    controller.setTool('direct-select');
    assert.deepEqual(stateManager.getSelection(), ['path-tool']);

    // Si hay 2 rectángulos y ningún Path, reduce al primer nodo
    stateManager.addShape(layerId, { id: 'rect-2', type: 'rectangle', name: 'R2', x: 20, y: 20, width: 20, height: 20 });
    stateManager.setSelection(['rect-tool', 'rect-2']);
    controller.setTool('select');
    assert.deepEqual(stateManager.getSelection(), ['rect-tool', 'rect-2']);

    controller.setTool('direct-select');
    assert.deepEqual(stateManager.getSelection(), ['rect-tool']);

    controller.destroy();
  });

  it('A.9: El cursor sobre una figura seleccionada en multiselección es move', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 100, y: 100, width: 80, height: 80 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 250, y: 100, width: 80, height: 80 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);
    stateManager.setSelection(['r1', 'r2']);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    // Hover sobre r1
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 120 });
    assert.equal(canvas.style.cursor, 'move');

    // Hover sobre r2
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 270, clientY: 120 });
    assert.equal(canvas.style.cursor, 'move');

    // Hover sobre el vacío
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 400, clientY: 400 });
    assert.equal(canvas.style.cursor, 'default');

    controller.destroy();
  });

  it('B.1, B.2, B.3: RenderEngine dibuja contorno individual y caja combinada sin tiradores para multiselección y marquesina punteada', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 100, y: 100, width: 80, height: 60 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 220, y: 100, width: 80, height: 60 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);

    const canvas = createMockCanvas();
    let preview: any = null;
    const engine = new RenderEngine(canvas, stateManager, {
      previewProvider: () => preview,
    });

    // 1. Con una figura: dibuja manejadores
    stateManager.selectNode('r1');
    stateManager.markDirty();
    (engine as any).render();

    // 2. Con múltiples figuras: dibuja contorno individual y caja combinada (getSelectionBounds: 100..300 x 100..160)
    stateManager.setSelection(['r1', 'r2']);
    stateManager.markDirty();
    (engine as any).render();

    // Comprobar trazo de recuadro combinado
    const hasCombinedBounds = canvas.records.strokeRects.some(
      (r) => r.x === 100 && r.y === 100 && r.w === 200 && r.h === 60
    );
    assert.equal(hasCombinedBounds, true, 'Debe dibujar strokeRect de la envolvente combinada');

    // 3. Rectángulo marquesina preview
    preview = { type: 'marquee', x: 50, y: 50, width: 150, height: 100 };
    stateManager.markDirty();
    (engine as any).render();

    // Debe haber configurado setLineDash y dibujado rect
    assert.equal(canvas.records.lineDashes.length > 0, true, 'Debe usar línea punteada');
    const hasMarqueeRect = canvas.records.rects.some(
      (r) => r.x === 50 && r.y === 50 && r.w === 150 && r.h === 100
    );
    assert.equal(hasMarqueeRect, true, 'Debe dibujar rect de marquesina');

    engine.stop();
  });

  it('Todo funciona con Zoom != 1 (ej. Zoom = 2.0 y Zoom = 0.5)', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager({ zoom: 2.0, panX: 0, panY: 0 });
    const layerId = stateManager.getState().children[0].id;

    // Con zoom = 2.0: coordenadas de pantalla (200, 200) equivalen a coordenadas del mundo (100, 100)
    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 100, y: 100, width: 60, height: 40 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 200, y: 200, width: 60, height: 40 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);
    stateManager.setSelection(['r1', 'r2']);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager, {
      viewportManager,
    });

    // 1. Arrastre en pantalla de 40px en X -> en el mundo debe ser 20px
    // r1 está en mundo (100, 100) -> en pantalla con zoom 2.0 está en (200, 200)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200, button: 0 });
    // Mover 40px en pantalla -> (240, 200)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 240, clientY: 200 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 240, clientY: 200, button: 0 });

    let s1 = stateManager.findNode('r1') as Rectangle;
    let s2 = stateManager.findNode('r2') as Rectangle;
    assert.equal(s1.x, 120, 'Delta de 40px pantalla / zoom 2.0 = 20px en mundo');
    assert.equal(s2.x, 220, 'Delta de 40px pantalla / zoom 2.0 = 20px en mundo');

    // Deshacer con zoom 2.0
    commandManager.undo();
    s1 = stateManager.findNode('r1') as Rectangle;
    s2 = stateManager.findNode('r2') as Rectangle;
    assert.equal(s1.x, 100);
    assert.equal(s2.x, 200);

    // 2. Marquesina con zoom = 0.5: pantalla (50, 50) a (150, 150) equivale a mundo (100, 100) a (300, 300)
    viewportManager.setViewport({ zoom: 0.5, panX: 0, panY: 0 });
    stateManager.selectNode(null);

    // Pantalla (40, 40) a (160, 160) -> mundo (80, 80) a (320, 320) -> cubre r1 (100, 100) y r2 (200, 200)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 40, clientY: 40, button: 0 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 160, clientY: 160 });
    assert.deepEqual([...stateManager.getSelection()].sort(), ['r1', 'r2']);
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 160, clientY: 160, button: 0 });
    assert.deepEqual([...stateManager.getSelection()].sort(), ['r1', 'r2']);

    // 3. Shift+clic con zoom = 0.5
    // r1 está en (100, 100), en pantalla está en (50, 50)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 55, clientY: 55, shiftKey: true, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['r2']);

    // 4. Umbral de 3px en pantalla para clic sin arrastre en multiselección con zoom = 0.5
    stateManager.setSelection(['r1', 'r2']);
    // Clic en r2 (mundo 200, 200 -> pantalla 100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, button: 0 });
    // Mover 1px en pantalla (a 101, 100) -> está por debajo del umbral de 3px de pantalla
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 101, clientY: 100 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 101, clientY: 100, button: 0 });
    assert.deepEqual(stateManager.getSelection(), ['r2'], 'Reduce a r2 porque el movimiento en pantalla fue <= 3px');

    controller.destroy();
  });
});
