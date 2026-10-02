import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Ellipse, Rectangle } from '../src/types/scene-graph.ts';

// Mock de Canvas para simular eventos en Node.js
function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

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
    getContext: () => null,
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
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('Patrón Command & Historial Deshacer/Rehacer', () => {
  it('gestiona la pila de undo y redo mediante CommandManager', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-move',
      type: 'rectangle',
      name: 'Rect',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    };

    manager.addShape(manager.getState().children[0].id, rect);

    // Crear y ejecutar comando de traslación de (100, 100) a (150, 120)
    const command1 = new TranslateCommand(manager, 'rect-move', 100, 100, 150, 120);
    commandManager.executeCommand(command1);

    const shapeAfterExec = manager.findNode('rect-move') as Rectangle;
    assert.equal(shapeAfterExec.x, 150);
    assert.equal(shapeAfterExec.y, 120);
    assert.equal(commandManager.canUndo(), true);
    assert.equal(commandManager.canRedo(), false);

    // Deshacer (Undo)
    assert.equal(commandManager.undo(), true);
    const shapeAfterUndo = manager.findNode('rect-move') as Rectangle;
    assert.equal(shapeAfterUndo.x, 100);
    assert.equal(shapeAfterUndo.y, 100);
    assert.equal(commandManager.canUndo(), false);
    assert.equal(commandManager.canRedo(), true);

    // Rehacer (Redo)
    assert.equal(commandManager.redo(), true);
    const shapeAfterRedo = manager.findNode('rect-move') as Rectangle;
    assert.equal(shapeAfterRedo.x, 150);
    assert.equal(shapeAfterRedo.y, 120);
    assert.equal(commandManager.canUndo(), true);
    assert.equal(commandManager.canRedo(), false);
  });

  it('invalida la pila de redo cuando se ejecuta una nueva acción directa', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-branch',
      type: 'rectangle',
      name: 'Rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    commandManager.executeCommand(new TranslateCommand(manager, 'rect-branch', 0, 0, 10, 10));
    commandManager.undo();
    assert.equal(commandManager.canRedo(), true);

    // Nueva acción directa
    commandManager.executeCommand(new TranslateCommand(manager, 'rect-branch', 0, 0, 99, 99));
    assert.equal(commandManager.canRedo(), false, 'Redo stack debe invalidarse');
  });

  it('arrastre en InputController aplica delta en tiempo real y registra en mouseup', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'drag-shape',
      type: 'rectangle',
      name: 'Draggable',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const controller = new InputController(canvas, manager, commandManager);

    // 1. Mousedown sobre la figura en (210, 210)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 210, clientY: 210 });
    assert.equal(controller.isDragging, true);

    // 2. Mousemove delta (+30 en X, +50 en Y) -> cursor en (240, 260)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 240, clientY: 260 });
    let shape = manager.findNode('drag-shape') as Rectangle;
    assert.equal(shape.x, 230, 'Posición X debe actualizarse en tiempo real (200 + 30)');
    assert.equal(shape.y, 250, 'Posición Y debe actualizarse en tiempo real (200 + 50)');

    // El historial aún no debe tener el comando hasta que se suelte el mouse
    assert.equal(commandManager.undoCount, 0);

    // 3. Mouseup en (240, 260) -> finaliza y registra el comando
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 240, clientY: 260 });
    assert.equal(controller.isDragging, false);
    assert.equal(commandManager.undoCount, 1);

    // 4. Probar Deshacer tras el arrastre
    commandManager.undo();
    shape = manager.findNode('drag-shape') as Rectangle;
    assert.equal(shape.x, 200, 'Undo debe restaurar la posición X original');
    assert.equal(shape.y, 200, 'Undo debe restaurar la posición Y original');

    // 5. Probar Rehacer
    commandManager.redo();
    shape = manager.findNode('drag-shape') as Rectangle;
    assert.equal(shape.x, 230, 'Redo debe restaurar la posición desplazada');
    assert.equal(shape.y, 250);

    controller.destroy();
  });

  it('no registra ningún comando en el historial si se hace clic sin arrastre (delta 0)', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'click-only',
      type: 'rectangle',
      name: 'Click Only',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const controller = new InputController(canvas, manager, commandManager);

    // Mousedown y Mouseup en las mismas coordenadas
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 60, clientY: 60 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 60, clientY: 60 });

    assert.equal(commandManager.undoCount, 0, 'No debe registrarse comando si no hubo movimiento');
    controller.destroy();
  });

  it('ResizeCommand: modifica dimensiones/radios y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'resize-rect',
      type: 'rectangle',
      name: 'Resize Rect',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const initialDims = { x: 100, y: 100, width: 80, height: 60 };
    const finalDims = { x: 90, y: 90, width: 120, height: 100 };

    const command = new ResizeCommand(manager, 'resize-rect', initialDims, finalDims);
    commandManager.executeCommand(command);

    let shape = manager.findNode('resize-rect') as Rectangle;
    assert.equal(shape.x, 90);
    assert.equal(shape.y, 90);
    assert.equal(shape.width, 120);
    assert.equal(shape.height, 100);

    // Deshacer
    assert.equal(commandManager.undo(), true);
    shape = manager.findNode('resize-rect') as Rectangle;
    assert.equal(shape.x, 100);
    assert.equal(shape.y, 100);
    assert.equal(shape.width, 80);
    assert.equal(shape.height, 60);

    // Rehacer
    assert.equal(commandManager.redo(), true);
    shape = manager.findNode('resize-rect') as Rectangle;
    assert.equal(shape.x, 90);
    assert.equal(shape.y, 90);
    assert.equal(shape.width, 120);
    assert.equal(shape.height, 100);
  });

  it('arrastre de manejador de esquina redimensiona figura en tiempo real y registra ResizeCommand en mouseup', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'interactive-resize',
      type: 'rectangle',
      name: 'Interactive Resize',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);
    manager.selectNode('interactive-resize');

    const controller = new InputController(canvas, manager, commandManager);

    // 1. Esquina bottom-right está en (200, 200). Manejador centrado en (200, 200), abarca 196 a 204
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'bottom-right');

    // 2. Mover ratón en +40 en X y +30 en Y -> cursor en (240, 230)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 240, clientY: 230 });
    let shape = manager.findNode('interactive-resize') as Rectangle;
    assert.equal(shape.x, 100, 'X debe permanecer fijo al arrastrar bottom-right');
    assert.equal(shape.y, 100, 'Y debe permanecer fijo al arrastrar bottom-right');
    assert.equal(shape.width, 140, 'Width debe actualizarse en tiempo real (100 + 40)');
    assert.equal(shape.height, 130, 'Height debe actualizarse en tiempo real (100 + 30)');

    // El comando no debe registrarse aún
    assert.equal(commandManager.undoCount, 0);

    // 3. Mouseup en (240, 230)
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 240, clientY: 230 });
    assert.equal(controller.isResizing, false);
    assert.equal(commandManager.undoCount, 1, 'Debe haberse registrado el ResizeCommand');

    // 4. Undo
    commandManager.undo();
    shape = manager.findNode('interactive-resize') as Rectangle;
    assert.equal(shape.width, 100, 'Undo debe restaurar width original');
    assert.equal(shape.height, 100, 'Undo debe restaurar height original');

    // 5. Redo
    commandManager.redo();
    shape = manager.findNode('interactive-resize') as Rectangle;
    assert.equal(shape.width, 140);
    assert.equal(shape.height, 130);

    controller.destroy();
  });

  it('redimensionado con manejador top-left desplaza x, y y actualiza dimensiones correctamente', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'topleft-resize',
      type: 'rectangle',
      name: 'TopLeft Rect',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);
    manager.selectNode('topleft-resize');

    const controller = new InputController(canvas, manager, commandManager);

    // Top-left está en (100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'top-left');

    // Mover hacia la izquierda (-20 en X) y hacia arriba (-30 en Y) -> cursor en (80, 70)
    // El ancho debe aumentar a 120 (100 - (-20)), la posición X debe desplazarse a 80
    // La altura debe aumentar a 130 (100 - (-30)), la posición Y debe desplazarse a 70
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 80, clientY: 70 });
    let shape = manager.findNode('topleft-resize') as Rectangle;
    assert.equal(shape.x, 80, 'X debe ser 80');
    assert.equal(shape.y, 70, 'Y debe ser 70');
    assert.equal(shape.width, 120, 'Width debe ser 120');
    assert.equal(shape.height, 130, 'Height debe ser 130');

    canvas.dispatchSimulatedEvent('mouseup', { clientX: 80, clientY: 70 });
    assert.equal(commandManager.undoCount, 1);

    commandManager.undo();
    shape = manager.findNode('topleft-resize') as Rectangle;
    assert.equal(shape.x, 100);
    assert.equal(shape.y, 100);
    assert.equal(shape.width, 100);
    assert.equal(shape.height, 100);

    controller.destroy();
  });

  it('redimensionado de una elipse actualiza radiusX, radiusY y centro con soporte de undo/redo', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const ellipse: Ellipse = {
      id: 'ellipse-resize',
      type: 'ellipse',
      name: 'Ellipse',
      x: 200,
      y: 200,
      radiusX: 50,
      radiusY: 50,
    };
    manager.addShape(manager.getState().children[0].id, ellipse);
    manager.selectNode('ellipse-resize');

    // AABB: minX = 150, maxX = 250, minY = 150, maxY = 250
    // Bottom-right handle en (250, 250)
    const controller = new InputController(canvas, manager, commandManager);

    canvas.dispatchSimulatedEvent('mousedown', { clientX: 250, clientY: 250 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'bottom-right');

    // Arrastrar +20 en X y +20 en Y (ancho pasa de 100 a 120, alto de 100 a 120)
    // Nuevo radioX: 60, nuevo radioY: 60
    // Nuevo centro: minX(150) + 60 = 210, minY(150) + 60 = 210
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 270, clientY: 270 });
    let shape = manager.findNode('ellipse-resize') as Ellipse;
    assert.equal(shape.radiusX, 60, 'radiusX debe ser 60');
    assert.equal(shape.radiusY, 60, 'radiusY debe ser 60');
    assert.equal(shape.x, 210, 'Centro X debe ser 210');
    assert.equal(shape.y, 210, 'Centro Y debe ser 210');

    canvas.dispatchSimulatedEvent('mouseup', { clientX: 270, clientY: 270 });
    assert.equal(commandManager.undoCount, 1);

    commandManager.undo();
    shape = manager.findNode('ellipse-resize') as Ellipse;
    assert.equal(shape.radiusX, 50, 'Undo debe restaurar radiusX');
    assert.equal(shape.radiusY, 50, 'Undo debe restaurar radiusY');
    assert.equal(shape.x, 200, 'Undo debe restaurar centro X');
    assert.equal(shape.y, 200, 'Undo debe restaurar centro Y');

    controller.destroy();
  });

  it('no registra ResizeCommand si se hace clic en un manejador sin arrastre', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'no-move-handle',
      type: 'rectangle',
      name: 'No Move Handle',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);
    manager.selectNode('no-move-handle');

    const controller = new InputController(canvas, manager, commandManager);

    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 200 });

    assert.equal(commandManager.undoCount, 0, 'No debe registrar ResizeCommand si el delta fue 0');
    controller.destroy();
  });
});

