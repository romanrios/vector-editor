import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ReorderCommand } from '../src/commands/ReorderCommand.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

function createSampleShapes(count: number = 3): Rectangle[] {
  const shapes: Rectangle[] = [];
  for (let i = 0; i < count; i++) {
    shapes.push({
      id: `rect-${i + 1}`,
      type: 'rectangle',
      name: `Rect ${i + 1}`,
      x: i * 50,
      y: i * 50,
      width: 100,
      height: 100,
    });
  }
  return shapes;
}

function setupManagerWithShapes(count: number = 3): {
  manager: StateManager;
  commandManager: CommandManager;
  layerId: string;
} {
  const commandManager = new CommandManager();
  const manager = new StateManager(undefined, commandManager);
  const layerId = manager.getState().children[0].id;
  const shapes = createSampleShapes(count);
  for (const s of shapes) {
    manager.addShape(layerId, s);
  }
  return { manager, commandManager, layerId };
}

function getShapeIds(manager: StateManager, layerId: string): string[] {
  return manager.getState().children.find((l) => l.id === layerId)!.children.map((s) => s.id);
}

describe('ReorderCommand', () => {
  describe('ejecutar', () => {
    it('traer al frente (bringToFront) mueve la figura al final del array de su capa', () => {
      const { manager, layerId } = setupManagerWithShapes(3);
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);

      // Traer la primera figura (rect-1) al frente
      const cmd = new ReorderCommand(manager, 'rect-1', 'bringToFront');
      assert.equal(cmd.originalIndex, 0);
      assert.equal(cmd.isAlreadyAtTarget, false);

      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-2', 'rect-3', 'rect-1']);
    });

    it('enviar al fondo (sendToBack) mueve la figura al inicio del array de su capa', () => {
      const { manager, layerId } = setupManagerWithShapes(3);
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);

      // Enviar la última figura (rect-3) al fondo
      const cmd = new ReorderCommand(manager, 'rect-3', 'sendToBack');
      assert.equal(cmd.originalIndex, 2);
      assert.equal(cmd.isAlreadyAtTarget, false);

      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-3', 'rect-1', 'rect-2']);
    });

    it('soporta alias "front" y "back" para los modos de reordenamiento', () => {
      const { manager, layerId } = setupManagerWithShapes(3);

      const cmdFront = new ReorderCommand(manager, 'rect-1', 'front');
      assert.equal(cmdFront.operation, 'bringToFront');
      cmdFront.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-2', 'rect-3', 'rect-1']);

      const cmdBack = new ReorderCommand(manager, 'rect-1', 'back');
      assert.equal(cmdBack.operation, 'sendToBack');
      cmdBack.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);
    });
  });

  describe('deshacer (undo)', () => {
    it('restaura EXACTAMENTE la posición anterior tras traer al frente', () => {
      const { manager, layerId } = setupManagerWithShapes(3);
      // rect-1 está en índice 0
      const cmd = new ReorderCommand(manager, 'rect-1', 'bringToFront');
      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-2', 'rect-3', 'rect-1']);

      cmd.undo();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);
    });

    it('restaura EXACTAMENTE la posición anterior de una figura intermedia traída al frente', () => {
      const { manager, layerId } = setupManagerWithShapes(3);
      // rect-2 está en índice 1
      const cmd = new ReorderCommand(manager, 'rect-2', 'bringToFront');
      assert.equal(cmd.originalIndex, 1);
      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-3', 'rect-2']);

      cmd.undo();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);
      assert.equal(getShapeIds(manager, layerId)[1], 'rect-2');
    });

    it('restaura EXACTAMENTE la posición anterior de una figura intermedia enviada al fondo', () => {
      const { manager, layerId } = setupManagerWithShapes(3);
      // rect-2 está en índice 1
      const cmd = new ReorderCommand(manager, 'rect-2', 'sendToBack');
      assert.equal(cmd.originalIndex, 1);
      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-2', 'rect-1', 'rect-3']);

      cmd.undo();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);
      assert.equal(getShapeIds(manager, layerId)[1], 'rect-2');
    });

    it('restaura EXACTAMENTE la posición anterior tras enviar al fondo', () => {
      const { manager, layerId } = setupManagerWithShapes(3);
      // rect-3 está en índice 2
      const cmd = new ReorderCommand(manager, 'rect-3', 'sendToBack');
      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-3', 'rect-1', 'rect-2']);

      cmd.undo();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);
    });
  });

  describe('rehacer (redo)', () => {
    it('aplica rehacer correctamente mediante CommandManager', () => {
      const { manager, commandManager, layerId } = setupManagerWithShapes(3);
      const cmd = new ReorderCommand(manager, 'rect-1', 'bringToFront');

      commandManager.executeCommand(cmd);
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-2', 'rect-3', 'rect-1']);
      assert.equal(commandManager.canUndo(), true);
      assert.equal(commandManager.canRedo(), false);

      // Deshacer
      assert.equal(commandManager.undo(), true);
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);
      assert.equal(commandManager.canUndo(), false);
      assert.equal(commandManager.canRedo(), true);

      // Rehacer
      assert.equal(commandManager.redo(), true);
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-2', 'rect-3', 'rect-1']);
      assert.equal(commandManager.canUndo(), true);
      assert.equal(commandManager.canRedo(), false);
    });
  });

  describe('figura ya en el extremo', () => {
    it('si la figura ya está al frente, no altera el orden ni registra en el historial', () => {
      const { manager, commandManager, layerId } = setupManagerWithShapes(3);
      // rect-3 ya es la última figura (frente)
      const cmd = new ReorderCommand(manager, 'rect-3', 'bringToFront');

      assert.equal(cmd.isAlreadyAtTarget, true);
      assert.equal(cmd.isNoop, true);

      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);

      commandManager.executeCommand(cmd);
      assert.equal(commandManager.undoCount, 0, 'No debe registrarse en el historial de CommandManager');
      assert.equal(commandManager.canUndo(), false);
    });

    it('si la figura ya está al fondo, no altera el orden ni registra en el historial', () => {
      const { manager, commandManager, layerId } = setupManagerWithShapes(3);
      // rect-1 ya es la primera figura (fondo)
      const cmd = new ReorderCommand(manager, 'rect-1', 'sendToBack');

      assert.equal(cmd.isAlreadyAtTarget, true);
      assert.equal(cmd.isNoop, true);

      cmd.execute();
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1', 'rect-2', 'rect-3']);

      commandManager.executeCommand(cmd);
      assert.equal(commandManager.undoCount, 0, 'No debe registrarse en el historial de CommandManager');
      assert.equal(commandManager.canUndo(), false);
    });

    it('en una capa con una sola figura, bringToFront y sendToBack son no-op y no registran en historial', () => {
      const { manager, commandManager, layerId } = setupManagerWithShapes(1);
      assert.deepEqual(getShapeIds(manager, layerId), ['rect-1']);

      const cmdFront = new ReorderCommand(manager, 'rect-1', 'bringToFront');
      assert.equal(cmdFront.isAlreadyAtTarget, true);
      commandManager.executeCommand(cmdFront);
      assert.equal(commandManager.undoCount, 0);

      const cmdBack = new ReorderCommand(manager, 'rect-1', 'sendToBack');
      assert.equal(cmdBack.isAlreadyAtTarget, true);
      commandManager.executeCommand(cmdBack);
      assert.equal(commandManager.undoCount, 0);
    });
  });

  describe('varias figuras', () => {
    it('gestiona correctamente figuras intermedias en una capa con 5 elementos', () => {
      const { manager, commandManager, layerId } = setupManagerWithShapes(5);
      const initial = ['rect-1', 'rect-2', 'rect-3', 'rect-4', 'rect-5'];
      assert.deepEqual(getShapeIds(manager, layerId), initial);

      // Traer elemento central (rect-3, índice 2) al frente
      const cmd1 = new ReorderCommand(manager, 'rect-3', 'bringToFront');
      assert.equal(cmd1.originalIndex, 2);
      commandManager.executeCommand(cmd1);
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-1',
        'rect-2',
        'rect-4',
        'rect-5',
        'rect-3',
      ]);

      // Deshacer restaura su posición intermedia exacta en el índice 2
      commandManager.undo();
      assert.deepEqual(getShapeIds(manager, layerId), initial);
      assert.equal(getShapeIds(manager, layerId)[2], 'rect-3');

      // Enviar elemento central (rect-3, índice 2) al fondo
      const cmd2 = new ReorderCommand(manager, 'rect-3', 'sendToBack');
      assert.equal(cmd2.originalIndex, 2);
      commandManager.executeCommand(cmd2);
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-3',
        'rect-1',
        'rect-2',
        'rect-4',
        'rect-5',
      ]);

      // Deshacer restaura su posición intermedia exacta en el índice 2
      commandManager.undo();
      assert.deepEqual(getShapeIds(manager, layerId), initial);
      assert.equal(getShapeIds(manager, layerId)[2], 'rect-3');
    });

    it('soporta múltiples reordenamientos secuenciales y deshecho en cascada inversa', () => {
      const { manager, commandManager, layerId } = setupManagerWithShapes(5);
      const initial = ['rect-1', 'rect-2', 'rect-3', 'rect-4', 'rect-5'];

      // 1. Mover rect-2 al frente
      const cmd1 = new ReorderCommand(manager, 'rect-2', 'bringToFront');
      commandManager.executeCommand(cmd1);
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-1',
        'rect-3',
        'rect-4',
        'rect-5',
        'rect-2',
      ]);

      // 2. Mover rect-4 al fondo
      const cmd2 = new ReorderCommand(manager, 'rect-4', 'sendToBack');
      commandManager.executeCommand(cmd2);
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-4',
        'rect-1',
        'rect-3',
        'rect-5',
        'rect-2',
      ]);

      // 3. Mover rect-1 al frente
      const cmd3 = new ReorderCommand(manager, 'rect-1', 'bringToFront');
      commandManager.executeCommand(cmd3);
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-4',
        'rect-3',
        'rect-5',
        'rect-2',
        'rect-1',
      ]);

      assert.equal(commandManager.undoCount, 3);

      // Deshacer paso 3
      commandManager.undo();
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-4',
        'rect-1',
        'rect-3',
        'rect-5',
        'rect-2',
      ]);

      // Deshacer paso 2
      commandManager.undo();
      assert.deepEqual(getShapeIds(manager, layerId), [
        'rect-1',
        'rect-3',
        'rect-4',
        'rect-5',
        'rect-2',
      ]);

      // Deshacer paso 1
      commandManager.undo();
      assert.deepEqual(getShapeIds(manager, layerId), initial);
    });
  });
});
