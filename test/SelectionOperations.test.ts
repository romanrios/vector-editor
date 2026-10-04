import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { SelectionOperations } from '../src/input/SelectionOperations.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

describe('SelectionOperations (sin canvas)', () => {
  it('ejecuta borrar, duplicar y deshacer directamente sin canvas', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const selectionOps = new SelectionOperations(stateManager, commandManager);

    const defaultLayerId = stateManager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'rect-test-1',
      name: 'Rect Test 1',
      type: 'rectangle',
      x: 50,
      y: 50,
      width: 100,
      height: 80,
    };
    stateManager.addShape(defaultLayerId, rect);
    stateManager.setSelection(['rect-test-1']);

    // 1. Duplicar
    const duplicated = selectionOps.duplicate();
    assert.ok(duplicated, 'duplicate() debe retornar la figura duplicada');
    assert.equal(stateManager.getState().children[0].children.length, 2, 'Debe haber 2 figuras tras duplicar');

    const duplicateId = duplicated.id;
    assert.notEqual(duplicateId, 'rect-test-1', 'La copia debe tener un ID diferente');
    assert.deepEqual(stateManager.getSelection(), [duplicateId], 'La figura duplicada debe quedar seleccionada');

    // 2. Deshacer la duplicación
    assert.equal(commandManager.canUndo(), true);
    commandManager.undo();
    assert.equal(
      stateManager.getState().children[0].children.length,
      1,
      'Tras deshacer duplicar, debe quedar solo la figura original'
    );
    assert.equal(stateManager.findNode(duplicateId!), null, 'El duplicado no debe existir en el estado');

    // 3. Borrar figura seleccionada
    stateManager.setSelection(['rect-test-1']);
    const deleted = selectionOps.deleteSelected();
    assert.equal(deleted, true, 'deleteSelected() debe retornar true');
    assert.equal(
      stateManager.getState().children[0].children.length,
      0,
      'Tras borrar, la capa debe quedar vacía'
    );
    assert.deepEqual(stateManager.getSelection(), [], 'La selección debe quedar vacía tras borrar');

    // 4. Deshacer el borrado
    commandManager.undo();
    assert.equal(
      stateManager.getState().children[0].children.length,
      1,
      'Tras deshacer borrado, la figura original se restaura'
    );
    const restored = stateManager.findNode('rect-test-1') as Rectangle;
    assert.ok(restored, 'La figura rect-test-1 debe existir nuevamente');
    assert.equal(restored.x, 50);
    assert.equal(restored.y, 50);
  });
});
