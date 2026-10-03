import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { StateManager } from '../src/state/StateManager.ts';
import type { Command } from '../src/commands/Command.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

describe('CommandManager & Fusión de Comandos (mergeWith)', () => {
  it('ejecuta comandos normales y gestiona undoStack y redoStack', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-1',
      type: 'rectangle',
      name: 'R1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const cmd1 = new TranslateCommand(manager, 'rect-1', 0, 0, 10, 10, { mergeTimeout: 0 });
    commandManager.executeCommand(cmd1);

    assert.equal(commandManager.undoCount, 1);
    assert.equal(commandManager.redoCount, 0);

    const shape = manager.findNode('rect-1') as Rectangle;
    assert.equal(shape.x, 10);
    assert.equal(shape.y, 10);

    // Deshacer
    assert.equal(commandManager.undo(), true);
    assert.equal((manager.findNode('rect-1') as Rectangle).x, 0);
    assert.equal(commandManager.undoCount, 0);
    assert.equal(commandManager.redoCount, 1);

    // Rehacer
    assert.equal(commandManager.redo(), true);
    assert.equal((manager.findNode('rect-1') as Rectangle).x, 10);
    assert.equal(commandManager.undoCount, 1);
    assert.equal(commandManager.redoCount, 0);
  });

  it('fusiona dos TranslateCommand consecutivos dentro del intervalo de tiempo (400ms)', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-merge',
      type: 'rectangle',
      name: 'R',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    // Comando 1 en t = 1000: mueve de (100, 100) a (105, 100)
    const cmd1 = new TranslateCommand(manager, 'rect-merge', 100, 100, 105, 100, {
      timestamp: 1000,
      mergeTimeout: 400,
    });
    commandManager.executeCommand(cmd1);
    assert.equal(commandManager.undoCount, 1);

    // Comando 2 en t = 1200 (delta 200ms <= 400ms): mueve de (105, 100) a (110, 100)
    const cmd2 = new TranslateCommand(manager, 'rect-merge', 105, 100, 110, 100, {
      timestamp: 1200,
      mergeTimeout: 400,
    });
    commandManager.executeCommand(cmd2);

    // Debe permanecer agrupado en 1 sola entrada
    assert.equal(commandManager.undoCount, 1, 'Los comandos consecutivos deben fusionarse');

    const shapeAfterExec = manager.findNode('rect-merge') as Rectangle;
    assert.equal(shapeAfterExec.x, 110);
    assert.equal(shapeAfterExec.y, 100);

    // Un único Ctrl+Z debe restaurar la posición inicial (100, 100)
    assert.equal(commandManager.undo(), true);
    const shapeAfterUndo = manager.findNode('rect-merge') as Rectangle;
    assert.equal(shapeAfterUndo.x, 100, 'Undo debe volver a la posición antes de todas las fusiones');
    assert.equal(commandManager.undoCount, 0);

    // Un único Rehacer debe aplicar la posición final fusionada (110, 100)
    assert.equal(commandManager.redo(), true);
    const shapeAfterRedo = manager.findNode('rect-merge') as Rectangle;
    assert.equal(shapeAfterRedo.x, 110, 'Redo debe aplicar el destino final consolidado');
    assert.equal(commandManager.undoCount, 1);
  });

  it('no fusiona comandos si la diferencia de tiempo supera mergeTimeout (> 400ms)', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-timeout',
      type: 'rectangle',
      name: 'R',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    // Comando 1 en t = 1000
    const cmd1 = new TranslateCommand(manager, 'rect-timeout', 0, 0, 5, 0, {
      timestamp: 1000,
      mergeTimeout: 400,
    });
    commandManager.executeCommand(cmd1);
    assert.equal(commandManager.undoCount, 1);

    // Comando 2 en t = 1500 (delta 500ms > 400ms)
    const cmd2 = new TranslateCommand(manager, 'rect-timeout', 5, 0, 10, 0, {
      timestamp: 1500,
      mergeTimeout: 400,
    });
    commandManager.executeCommand(cmd2);

    // Deben quedar 2 entradas distintas en el historial
    assert.equal(commandManager.undoCount, 2, 'No deben fusionarse si pasó más de mergeTimeout');

    // Deshacer primero el comando 2
    commandManager.undo();
    assert.equal((manager.findNode('rect-timeout') as Rectangle).x, 5);

    // Deshacer después el comando 1
    commandManager.undo();
    assert.equal((manager.findNode('rect-timeout') as Rectangle).x, 0);
  });

  it('no fusiona comandos si pertenecen a figuras distintas', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = manager.getState().children[0].id;

    manager.addShape(layerId, { id: 's1', type: 'rectangle', name: 'S1', x: 0, y: 0, width: 50, height: 50 });
    manager.addShape(layerId, { id: 's2', type: 'rectangle', name: 'S2', x: 0, y: 0, width: 50, height: 50 });

    const cmd1 = new TranslateCommand(manager, 's1', 0, 0, 5, 0, { timestamp: 1000, mergeTimeout: 400 });
    const cmd2 = new TranslateCommand(manager, 's2', 0, 0, 5, 0, { timestamp: 1100, mergeTimeout: 400 });

    commandManager.executeCommand(cmd1);
    commandManager.executeCommand(cmd2);

    assert.equal(commandManager.undoCount, 2);
  });

  it('no fusiona comandos si no hay continuidad espacial (fromX/fromY != toX/toY)', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = manager.getState().children[0].id;

    manager.addShape(layerId, { id: 's1', type: 'rectangle', name: 'S1', x: 0, y: 0, width: 50, height: 50 });

    // cmd1 va de 0 a 5
    const cmd1 = new TranslateCommand(manager, 's1', 0, 0, 5, 0, { timestamp: 1000, mergeTimeout: 400 });
    // cmd2 dice ir de 20 a 30 (discontinuo respecto a 5)
    const cmd2 = new TranslateCommand(manager, 's1', 20, 0, 30, 0, { timestamp: 1100, mergeTimeout: 400 });

    commandManager.executeCommand(cmd1);
    commandManager.executeCommand(cmd2);

    assert.equal(commandManager.undoCount, 2);
  });

  it('soporta comando genérico personalizado que implementa mergeWith', () => {
    const commandManager = new CommandManager();
    let count = 0;

    class IncrementCommand implements Command {
      public readonly name = 'IncrementCommand';
      public amount: number;

      constructor(amount: number) {
        this.amount = amount;
      }

      public execute(): void {
        count += this.amount;
      }

      public undo(): void {
        count -= this.amount;
      }

      public mergeWith(next: Command): boolean {
        if (next instanceof IncrementCommand) {
          this.amount += next.amount;
          return true;
        }
        return false;
      }
    }

    commandManager.executeCommand(new IncrementCommand(1));
    assert.equal(count, 1);
    assert.equal(commandManager.undoCount, 1);

    commandManager.executeCommand(new IncrementCommand(2));
    assert.equal(count, 3);
    assert.equal(commandManager.undoCount, 1, 'Debe fusionar los dos IncrementCommand');

    commandManager.undo();
    assert.equal(count, 0, 'Undo debe revertir el total acumulado (1 + 2 = 3)');

    commandManager.redo();
    assert.equal(count, 3, 'Redo debe aplicar el total acumulado');
  });

  it('al fusionar un comando se invalida la pila de rehacer y se notifica a los suscriptores', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = manager.getState().children[0].id;
    manager.addShape(layerId, { id: 's1', type: 'rectangle', name: 'S1', x: 0, y: 0, width: 50, height: 50 });

    let notifications = 0;
    commandManager.subscribe(() => {
      notifications++;
    });

    const cmd1 = new TranslateCommand(manager, 's1', 0, 0, 5, 0, { timestamp: 1000, mergeTimeout: 400 });
    commandManager.executeCommand(cmd1);
    assert.equal(notifications, 1);

    // cmd2 fusionable
    const cmd2 = new TranslateCommand(manager, 's1', 5, 0, 10, 0, { timestamp: 1100, mergeTimeout: 400 });
    commandManager.executeCommand(cmd2);
    assert.equal(notifications, 2);
    assert.equal(commandManager.undoCount, 1);
    assert.equal(commandManager.canRedo(), false);
  });
});
