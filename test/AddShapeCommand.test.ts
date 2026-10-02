import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { AddShapeCommand } from '../src/commands/AddShapeCommand.ts';
import { normalizeShapeBounds } from '../src/utils/geometry.ts';
import type { Ellipse, Layer, Rectangle } from '../src/types/scene-graph.ts';

describe('AddShapeCommand', () => {
  it('execute añade la figura a la capa indicada y se refleja en el Scene Graph', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'rect-add-test',
      type: 'rectangle',
      name: 'Rectángulo Nuevo',
      x: 50,
      y: 60,
      width: 120,
      height: 80,
    };

    assert.equal(manager.findNode('rect-add-test'), null);

    const cmd = new AddShapeCommand(manager, layerId, rect);
    cmd.execute();

    const found = manager.findNode('rect-add-test') as Rectangle | null;
    assert.notEqual(found, null);
    assert.equal(found?.id, 'rect-add-test');
    assert.equal(found?.width, 120);
    assert.equal(found?.height, 80);

    const layer = manager.findNode(layerId) as Layer;
    assert.equal(layer.children.length, 1);
    assert.equal(layer.children[0].id, 'rect-add-test');
  });

  it('undo elimina la figura del Scene Graph', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'rect-undo-test',
      type: 'rectangle',
      name: 'Rectángulo Undo',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
    };

    const cmd = new AddShapeCommand(manager, layerId, rect);
    cmd.execute();
    assert.notEqual(manager.findNode('rect-undo-test'), null);

    cmd.undo();
    assert.equal(manager.findNode('rect-undo-test'), null);

    const layer = manager.findNode(layerId) as Layer;
    assert.equal(layer.children.length, 0);
  });

  it('undo deselecciona la figura si estaba seleccionada', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'rect-selection-test',
      type: 'rectangle',
      name: 'Rectángulo Selección',
      x: 15,
      y: 25,
      width: 70,
      height: 40,
    };

    const cmd = new AddShapeCommand(manager, layerId, rect);
    cmd.execute();

    // Seleccionar la figura añadida
    manager.selectNode('rect-selection-test');
    assert.equal(manager.getSelectedNode()?.id, 'rect-selection-test');

    // Deshacer debe deseleccionar y remover
    cmd.undo();
    assert.equal(manager.findNode('rect-selection-test'), null);
    assert.equal(manager.getSelectedNode(), null);
  });

  it('undo no deselecciona otra figura distinta si la figura añadida no estaba seleccionada', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect1: Rectangle = {
      id: 'rect-other-1',
      type: 'rectangle',
      name: 'Rect 1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const rect2: Rectangle = {
      id: 'rect-other-2',
      type: 'rectangle',
      name: 'Rect 2',
      x: 20,
      y: 20,
      width: 10,
      height: 10,
    };

    manager.addShape(layerId, rect1);
    manager.selectNode(rect1.id);
    assert.equal(manager.getSelectedNode()?.id, rect1.id);

    const cmd2 = new AddShapeCommand(manager, layerId, rect2);
    cmd2.execute();

    // rect1 sigue seleccionado
    assert.equal(manager.getSelectedNode()?.id, rect1.id);

    // Deshacer cmd2 no debe deseleccionar rect1
    cmd2.undo();
    assert.equal(manager.findNode(rect2.id), null);
    assert.equal(manager.getSelectedNode()?.id, rect1.id);
  });

  it('no duplica figuras al ejecutarse múltiples veces consecutivas (idempotencia)', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const ellipse: Ellipse = {
      id: 'ellipse-dedup',
      type: 'ellipse',
      name: 'Elipse Dedup',
      x: 100,
      y: 100,
      radiusX: 40,
      radiusY: 30,
    };

    const cmd = new AddShapeCommand(manager, layerId, ellipse);
    cmd.execute();
    cmd.execute(); // Segunda llamada
    cmd.execute(); // Tercera llamada

    const layer = manager.findNode(layerId) as Layer;
    assert.equal(layer.children.length, 1);
    assert.equal(layer.children[0].id, 'ellipse-dedup');
  });

  it('funciona con CommandManager para el ciclo completo execute -> undo -> redo', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'rect-history',
      type: 'rectangle',
      name: 'Rect Historial',
      x: 200,
      y: 150,
      width: 80,
      height: 60,
    };

    const cmd = new AddShapeCommand(manager, layerId, rect);
    commandManager.executeCommand(cmd);

    assert.equal(manager.findNode('rect-history') !== null, true);
    assert.equal(commandManager.canUndo(), true);
    assert.equal(commandManager.canRedo(), false);

    // Undo
    assert.equal(commandManager.undo(), true);
    assert.equal(manager.findNode('rect-history'), null);
    assert.equal(commandManager.canRedo(), true);

    // Redo
    assert.equal(commandManager.redo(), true);
    assert.equal(manager.findNode('rect-history') !== null, true);
    const layer = manager.findNode(layerId) as Layer;
    assert.equal(layer.children.length, 1);

    // Undo y Redo repetido no generan duplicados
    commandManager.undo();
    assert.equal(manager.findNode('rect-history'), null);
    commandManager.redo();
    assert.equal(layer.children.length, 1);
  });

  it('soporta ambos órdenes de argumentos en el constructor', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rectA: Rectangle = {
      id: 'rect-order-a',
      type: 'rectangle',
      name: 'Rect A',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    };
    const rectB: Rectangle = {
      id: 'rect-order-b',
      type: 'rectangle',
      name: 'Rect B',
      x: 30,
      y: 30,
      width: 20,
      height: 20,
    };

    // Orden (manager, layerId, shape)
    const cmdA = new AddShapeCommand(manager, layerId, rectA);
    assert.equal(cmdA.layerId, layerId);
    assert.equal(cmdA.shape.id, 'rect-order-a');
    cmdA.execute();
    assert.notEqual(manager.findNode('rect-order-a'), null);

    // Orden (manager, shape, layerId)
    const cmdB = new AddShapeCommand(manager, rectB, layerId);
    assert.equal(cmdB.layerId, layerId);
    assert.equal(cmdB.shape.id, 'rect-order-b');
    cmdB.execute();
    assert.notEqual(manager.findNode('rect-order-b'), null);
  });
});

describe('Función auxiliar normalizeShapeBounds', () => {
  it('arrastre en las 4 direcciones para Rectangle (sin proporción 1:1)', () => {
    const start = { x: 100, y: 100 };

    // Cuadrante 1: Abajo-Derecha
    const q1 = normalizeShapeBounds(start, { x: 220, y: 180 }, 'rectangle');
    assert.equal(q1.type, 'rectangle');
    assert.equal(q1.x, 100);
    assert.equal(q1.y, 100);
    assert.equal(q1.width, 120);
    assert.equal(q1.height, 80);

    // Cuadrante 2: Abajo-Izquierda
    const q2 = normalizeShapeBounds(start, { x: 40, y: 190 }, 'rectangle');
    assert.equal(q2.x, 40);
    assert.equal(q2.y, 100);
    assert.equal(q2.width, 60);
    assert.equal(q2.height, 90);

    // Cuadrante 3: Arriba-Izquierda
    const q3 = normalizeShapeBounds(start, { x: 30, y: 40 }, 'rectangle');
    assert.equal(q3.x, 30);
    assert.equal(q3.y, 40);
    assert.equal(q3.width, 70);
    assert.equal(q3.height, 60);

    // Cuadrante 4: Arriba-Derecha
    const q4 = normalizeShapeBounds(start, { x: 170, y: 20 }, 'rectangle');
    assert.equal(q4.x, 100);
    assert.equal(q4.y, 20);
    assert.equal(q4.width, 70);
    assert.equal(q4.height, 80);
  });

  it('arrastre en las 4 direcciones para Ellipse respetando convención de centro x/y', () => {
    const start = { x: 100, y: 100 };

    // Cuadrante 1: Abajo-Derecha
    const q1 = normalizeShapeBounds(start, { x: 200, y: 160 }, 'ellipse');
    assert.equal(q1.type, 'ellipse');
    assert.equal(q1.x, 150); // centro x: (100 + 200) / 2
    assert.equal(q1.y, 130); // centro y: (100 + 160) / 2
    assert.equal(q1.radiusX, 50);
    assert.equal(q1.radiusY, 30);
    assert.equal(q1.width, 100);
    assert.equal(q1.height, 60);

    // Cuadrante 2: Abajo-Izquierda
    const q2 = normalizeShapeBounds(start, { x: 40, y: 160 }, 'ellipse');
    assert.equal(q2.x, 70); // centro x: (40 + 100) / 2
    assert.equal(q2.y, 130);
    assert.equal(q2.radiusX, 30);
    assert.equal(q2.radiusY, 30);
    assert.equal(q2.width, 60);
    assert.equal(q2.height, 60);

    // Cuadrante 3: Arriba-Izquierda
    const q3 = normalizeShapeBounds(start, { x: 30, y: 40 }, 'ellipse');
    assert.equal(q3.x, 65); // centro x: (30 + 100) / 2
    assert.equal(q3.y, 70); // centro y: (40 + 100) / 2
    assert.equal(q3.radiusX, 35);
    assert.equal(q3.radiusY, 30);
    assert.equal(q3.width, 70);
    assert.equal(q3.height, 60);

    // Cuadrante 4: Arriba-Derecha
    const q4 = normalizeShapeBounds(start, { x: 170, y: 50 }, 'ellipse');
    assert.equal(q4.x, 135); // centro x: (100 + 170) / 2
    assert.equal(q4.y, 75); // centro y: (50 + 100) / 2
    assert.equal(q4.radiusX, 35);
    assert.equal(q4.radiusY, 25);
    assert.equal(q4.width, 70);
    assert.equal(q4.height, 50);
  });

  it('forzar proporción 1:1 en las 4 direcciones para Rectangle y Ellipse', () => {
    const start = { x: 100, y: 100 };

    // Cuadrante 1: Abajo-Derecha, dx > dy (dx=80, dy=30 -> lado=80)
    const q1Rect = normalizeShapeBounds(start, { x: 180, y: 130 }, 'rectangle', true);
    assert.equal(q1Rect.x, 100);
    assert.equal(q1Rect.y, 100);
    assert.equal(q1Rect.width, 80);
    assert.equal(q1Rect.height, 80);

    const q1Ellipse = normalizeShapeBounds(start, { x: 180, y: 130 }, 'ellipse', true);
    assert.equal(q1Ellipse.x, 140);
    assert.equal(q1Ellipse.y, 140);
    assert.equal(q1Ellipse.radiusX, 40);
    assert.equal(q1Ellipse.radiusY, 40);

    // Cuadrante 1: Abajo-Derecha, dy > dx (dx=30, dy=90 -> lado=90)
    const q1RectDy = normalizeShapeBounds(start, { x: 130, y: 190 }, 'rectangle', true);
    assert.equal(q1RectDy.width, 90);
    assert.equal(q1RectDy.height, 90);

    // Cuadrante 2: Abajo-Izquierda (dx=-70, dy=40 -> lado=70)
    const q2Rect = normalizeShapeBounds(start, { x: 30, y: 140 }, 'rectangle', true);
    assert.equal(q2Rect.x, 30);
    assert.equal(q2Rect.y, 100);
    assert.equal(q2Rect.width, 70);
    assert.equal(q2Rect.height, 70);

    const q2Ellipse = normalizeShapeBounds(start, { x: 30, y: 140 }, 'ellipse', true);
    assert.equal(q2Ellipse.x, 65);
    assert.equal(q2Ellipse.y, 135);
    assert.equal(q2Ellipse.radiusX, 35);
    assert.equal(q2Ellipse.radiusY, 35);

    // Cuadrante 3: Arriba-Izquierda (dx=-50, dy=-60 -> lado=60)
    const q3Rect = normalizeShapeBounds(start, { x: 50, y: 40 }, 'rectangle', true);
    assert.equal(q3Rect.x, 40);
    assert.equal(q3Rect.y, 40);
    assert.equal(q3Rect.width, 60);
    assert.equal(q3Rect.height, 60);

    const q3Ellipse = normalizeShapeBounds(start, { x: 50, y: 40 }, 'ellipse', true);
    assert.equal(q3Ellipse.x, 70);
    assert.equal(q3Ellipse.y, 70);
    assert.equal(q3Ellipse.radiusX, 30);
    assert.equal(q3Ellipse.radiusY, 30);

    // Cuadrante 4: Arriba-Derecha (dx=75, dy=-40 -> lado=75)
    const q4Rect = normalizeShapeBounds(start, { x: 175, y: 60 }, 'rectangle', true);
    assert.equal(q4Rect.x, 100);
    assert.equal(q4Rect.y, 25);
    assert.equal(q4Rect.width, 75);
    assert.equal(q4Rect.height, 75);

    const q4Ellipse = normalizeShapeBounds(start, { x: 175, y: 60 }, 'ellipse', true);
    assert.equal(q4Ellipse.x, 137.5);
    assert.equal(q4Ellipse.y, 62.5);
    assert.equal(q4Ellipse.radiusX, 37.5);
    assert.equal(q4Ellipse.radiusY, 37.5);

    // Acepta modificador en formato objeto { lockAspectRatio: true }
    const objRect = normalizeShapeBounds(start, { x: 180, y: 130 }, 'rectangle', { lockAspectRatio: true });
    assert.equal(objRect.width, 80);
    assert.equal(objRect.height, 80);
  });

  it('tamaño cero cuando el punto inicial y final coinciden', () => {
    const pt = { x: 250, y: 350 };

    // Rectangle sin lock
    const rectZero = normalizeShapeBounds(pt, pt, 'rectangle', false);
    assert.equal(rectZero.x, 250);
    assert.equal(rectZero.y, 350);
    assert.equal(rectZero.width, 0);
    assert.equal(rectZero.height, 0);

    // Rectangle con lock
    const rectZeroLocked = normalizeShapeBounds(pt, pt, 'rectangle', true);
    assert.equal(rectZeroLocked.x, 250);
    assert.equal(rectZeroLocked.y, 350);
    assert.equal(rectZeroLocked.width, 0);
    assert.equal(rectZeroLocked.height, 0);

    // Ellipse sin lock
    const ellipseZero = normalizeShapeBounds(pt, pt, 'ellipse', false);
    assert.equal(ellipseZero.x, 250);
    assert.equal(ellipseZero.y, 350);
    assert.equal(ellipseZero.radiusX, 0);
    assert.equal(ellipseZero.radiusY, 0);
    assert.equal(ellipseZero.width, 0);
    assert.equal(ellipseZero.height, 0);

    // Ellipse con lock
    const ellipseZeroLocked = normalizeShapeBounds(pt, pt, 'ellipse', true);
    assert.equal(ellipseZeroLocked.x, 250);
    assert.equal(ellipseZeroLocked.y, 350);
    assert.equal(ellipseZeroLocked.radiusX, 0);
    assert.equal(ellipseZeroLocked.radiusY, 0);
    assert.equal(ellipseZeroLocked.width, 0);
    assert.equal(ellipseZeroLocked.height, 0);
  });
});
