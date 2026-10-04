import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { BatchCommand } from '../src/commands/BatchCommand.ts';
import type { Command } from '../src/commands/Command.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

describe('BatchCommand (Comando Compuesto)', () => {
  it('ejecuta los comandos en orden secuencial y los revierte en orden inverso', () => {
    const executionOrder: string[] = [];
    const undoOrder: string[] = [];

    const mockCmd = (id: string, isAlreadyAtTarget = false): Command => ({
      name: `MockCommand-${id}`,
      isAlreadyAtTarget,
      execute: () => {
        executionOrder.push(`exec-${id}`);
      },
      undo: () => {
        undoOrder.push(`undo-${id}`);
      },
    });

    const c1 = mockCmd('1');
    const c2 = mockCmd('2');
    const c3 = mockCmd('3');

    const batch = new BatchCommand([c1, c2, c3], 'MiLote');
    assert.equal(batch.name, 'MiLote');
    assert.equal(batch.commands.length, 3);
    assert.equal(batch.isAlreadyAtTarget, false);

    batch.execute();
    assert.deepEqual(executionOrder, ['exec-1', 'exec-2', 'exec-3']);

    batch.undo();
    assert.deepEqual(undoOrder, ['undo-3', 'undo-2', 'undo-1']);
  });

  it('ignora comandos hijos con isAlreadyAtTarget', () => {
    const executed: string[] = [];

    const c1: Command = {
      name: 'c1',
      isAlreadyAtTarget: false,
      execute: () => executed.push('c1'),
      undo: () => {},
    };
    const c2: Command = {
      name: 'c2',
      isAlreadyAtTarget: true, // Debe ser ignorado
      execute: () => executed.push('c2'),
      undo: () => {},
    };
    const c3: Command = {
      name: 'c3',
      isAlreadyAtTarget: false,
      execute: () => executed.push('c3'),
      undo: () => {},
    };

    const batch = new BatchCommand([c1, c2, c3]);
    assert.equal(batch.commands.length, 2);
    assert.equal(batch.isAlreadyAtTarget, false);

    batch.execute();
    assert.deepEqual(executed, ['c1', 'c3']);
  });

  it('lote vacío o con todos los hijos en destino: isAlreadyAtTarget es true y no se registra en historial', () => {
    const commandManager = new CommandManager();

    const emptyBatch = new BatchCommand([]);
    assert.equal(emptyBatch.isAlreadyAtTarget, true);
    commandManager.executeCommand(emptyBatch);
    assert.equal(commandManager.undoCount, 0, 'Lote vacío no debe añadirse al historial');

    const alreadyAtTargetCmd: Command = {
      name: 'idle',
      isAlreadyAtTarget: true,
      execute: () => {},
      undo: () => {},
    };
    const allIdleBatch = new BatchCommand([alreadyAtTargetCmd, alreadyAtTargetCmd]);
    assert.equal(allIdleBatch.isAlreadyAtTarget, true);
    commandManager.executeCommand(allIdleBatch);
    assert.equal(commandManager.undoCount, 0, 'Lote sin cambios no debe añadirse al historial');
  });

  it('soporta ciclo de deshacer y rehacer con StateManager y múltiples TranslateCommand', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 50, y: 50, width: 20, height: 20 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);

    const cmd1 = new TranslateCommand(stateManager, 'r1', 10, 10, 30, 40);
    const cmd2 = new TranslateCommand(stateManager, 'r2', 50, 50, 70, 80);
    const batch = new BatchCommand([cmd1, cmd2], 'Mover Figuras');

    // Ejecutar mediante CommandManager
    commandManager.executeCommand(batch);
    assert.equal(commandManager.undoCount, 1);

    const s1After = stateManager.findNode('r1') as Rectangle;
    const s2After = stateManager.findNode('r2') as Rectangle;
    assert.equal(s1After.x, 30);
    assert.equal(s1After.y, 40);
    assert.equal(s2After.x, 70);
    assert.equal(s2After.y, 80);

    // Deshacer lote
    commandManager.undo();
    assert.equal(commandManager.undoCount, 0);
    assert.equal(commandManager.canRedo(), true);
    const s1Undo = stateManager.findNode('r1') as Rectangle;
    const s2Undo = stateManager.findNode('r2') as Rectangle;
    assert.equal(s1Undo.x, 10);
    assert.equal(s1Undo.y, 10);
    assert.equal(s2Undo.x, 50);
    assert.equal(s2Undo.y, 50);

    // Rehacer lote
    commandManager.redo();
    assert.equal(commandManager.undoCount, 1);
    const s1Redo = stateManager.findNode('r1') as Rectangle;
    const s2Redo = stateManager.findNode('r2') as Rectangle;
    assert.equal(s1Redo.x, 30);
    assert.equal(s1Redo.y, 40);
    assert.equal(s2Redo.x, 70);
    assert.equal(s2Redo.y, 80);
  });

  it('mergeWith: fusiona dos lotes consecutivos con los mismos hijos y IDs en el mismo orden', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'm1', type: 'rectangle', name: 'M1', x: 0, y: 0, width: 10, height: 10 };
    const r2: Rectangle = { id: 'm2', type: 'rectangle', name: 'M2', x: 10, y: 10, width: 10, height: 10 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);

    const t0 = 1000;
    // Paso 1: flecha a la derecha (+5, 0)
    const b1 = new BatchCommand([
      new TranslateCommand(stateManager, 'm1', 0, 0, 5, 0, { timestamp: t0, mergeTimeout: 400 }),
      new TranslateCommand(stateManager, 'm2', 10, 10, 15, 10, { timestamp: t0, mergeTimeout: 400 }),
    ]);

    commandManager.executeCommand(b1);
    assert.equal(commandManager.undoCount, 1);

    // Paso 2: flecha a la derecha dentro de los 400ms (+5, 0)
    const t1 = 1200;
    const b2 = new BatchCommand([
      new TranslateCommand(stateManager, 'm1', 5, 0, 10, 0, { timestamp: t1, mergeTimeout: 400 }),
      new TranslateCommand(stateManager, 'm2', 15, 10, 20, 10, { timestamp: t1, mergeTimeout: 400 }),
    ]);

    commandManager.executeCommand(b2);
    // Debe haberse fusionado en la misma entrada
    assert.equal(commandManager.undoCount, 1, 'Los dos lotes deben fusionarse en una sola entrada de historial');

    const s1 = stateManager.findNode('m1') as Rectangle;
    const s2 = stateManager.findNode('m2') as Rectangle;
    assert.equal(s1.x, 10);
    assert.equal(s2.x, 20);

    // Un solo Undo debe restaurar ambas figuras al estado inicial (0 y 10)
    commandManager.undo();
    assert.equal(commandManager.undoCount, 0);
    const s1Revert = stateManager.findNode('m1') as Rectangle;
    const s2Revert = stateManager.findNode('m2') as Rectangle;
    assert.equal(s1Revert.x, 0);
    assert.equal(s2Revert.x, 10);
  });

  it('mergeWith: rechaza la fusión si los IDs difieren, el número de hijos difiere o expira el tiempo', () => {
    const stateManager = new StateManager();
    const t0 = 1000;

    const b1 = new BatchCommand([
      new TranslateCommand(stateManager, 'a', 0, 0, 5, 0, { timestamp: t0, mergeTimeout: 400 }),
      new TranslateCommand(stateManager, 'b', 0, 0, 5, 0, { timestamp: t0, mergeTimeout: 400 }),
    ]);

    // Diferente número de comandos
    const bDiffCount = new BatchCommand([
      new TranslateCommand(stateManager, 'a', 5, 0, 10, 0, { timestamp: t0 + 100, mergeTimeout: 400 }),
    ]);
    assert.equal(b1.mergeWith(bDiffCount), false);

    // Diferente ID de figura
    const bDiffId = new BatchCommand([
      new TranslateCommand(stateManager, 'a', 5, 0, 10, 0, { timestamp: t0 + 100, mergeTimeout: 400 }),
      new TranslateCommand(stateManager, 'c', 0, 0, 5, 0, { timestamp: t0 + 100, mergeTimeout: 400 }),
    ]);
    assert.equal(b1.mergeWith(bDiffId), false);

    // Tiempo expirado (> 400 ms)
    const bExpired = new BatchCommand([
      new TranslateCommand(stateManager, 'a', 5, 0, 10, 0, { timestamp: t0 + 500, mergeTimeout: 400 }),
      new TranslateCommand(stateManager, 'b', 5, 0, 10, 0, { timestamp: t0 + 500, mergeTimeout: 400 }),
    ]);
    assert.equal(b1.mergeWith(bExpired), false);

    // Discontinuidad de coordenadas (fromX no coincide con toX)
    const bDiscontinuous = new BatchCommand([
      new TranslateCommand(stateManager, 'a', 99, 0, 105, 0, { timestamp: t0 + 100, mergeTimeout: 400 }),
      new TranslateCommand(stateManager, 'b', 5, 0, 10, 0, { timestamp: t0 + 100, mergeTimeout: 400 }),
    ]);
    assert.equal(b1.mergeWith(bDiscontinuous), false);
  });
});
