import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

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
});
