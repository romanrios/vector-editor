import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { BatchCommand } from '../src/commands/BatchCommand.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import type { Rectangle, Ellipse, Group, Layer } from '../src/types/scene-graph.ts';

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

describe('Arrastre con Alt (copiar mientras se mueve)', () => {
  const zoomCases = [
    { label: 'zoom = 1', zoom: 1, panX: 0, panY: 0 },
    { label: 'zoom = 1.5 con pan', zoom: 1.5, panX: 40, panY: -30 },
  ];

  for (const { label, zoom, panX, panY } of zoomCases) {
    describe(`Pruebas con ${label}`, () => {
      it('Alt+arrastrar una figura: la original no se mueve, la copia está en la posición final y queda seleccionada, y hay UNA entrada de historial; Ctrl+Z la elimina y Ctrl+Y la restaura', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rect: Rectangle = {
          id: 'rect-orig',
          type: 'rectangle',
          name: 'Rect Original',
          x: 100,
          y: 100,
          width: 80,
          height: 60,
        };
        stateManager.addShape(layerId, rect);
        stateManager.selectNode('rect-orig');

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        // Clic dentro de la figura: mundo (120, 120)
        const startScreenX = 120 * zoom + panX;
        const startScreenY = 120 * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', {
          clientX: startScreenX,
          clientY: startScreenY,
          button: 0,
          altKey: true,
        });

        // Arrastre en pantalla equivalente a +50px en X y +30px en Y en el mundo
        const targetScreenX = (120 + 50) * zoom + panX;
        const targetScreenY = (120 + 30) * zoom + panY;

        canvas.dispatchSimulatedEvent('mousemove', {
          clientX: targetScreenX,
          clientY: targetScreenY,
          altKey: true,
        });

        assert.equal(controller.isCopyDragging, true, 'isCopyDragging debe estar activo');
        assert.equal(canvas.style.cursor, 'copy', 'Cursor debe ser copy');

        canvas.dispatchSimulatedEvent('mouseup', {
          clientX: targetScreenX,
          clientY: targetScreenY,
          button: 0,
          altKey: true,
        });

        // 1. La original NO se mueve
        const origShape = stateManager.findNode('rect-orig') as Rectangle;
        assert.ok(origShape);
        assert.equal(origShape.x, 100);
        assert.equal(origShape.y, 100);

        // 2. La copia está en la posición final y queda seleccionada
        const selection = stateManager.getSelection();
        assert.equal(selection.length, 1);
        const clonedId = selection[0];
        assert.notEqual(clonedId, 'rect-orig');

        const clonedShape = stateManager.findNode(clonedId) as Rectangle;
        assert.ok(clonedShape);
        assert.equal(clonedShape.x, 150);
        assert.equal(clonedShape.y, 130);

        // 3. UNA sola entrada de historial (BatchCommand)
        assert.equal(commandManager.canUndo(), true);
        const undoStack = (commandManager as any).undoStack;
        assert.equal(undoStack.length, 1);
        assert.equal(undoStack[0] instanceof BatchCommand, true);

        // 4. Ctrl+Z la elimina dejando la original intacta
        commandManager.undo();
        assert.equal(stateManager.findNode(clonedId), null, 'Ctrl+Z debe eliminar la copia');
        const origAfterUndo = stateManager.findNode('rect-orig') as Rectangle;
        assert.ok(origAfterUndo);
        assert.equal(origAfterUndo.x, 100);

        // 5. Ctrl+Y la restaura
        commandManager.redo();
        const restoredClone = stateManager.findNode(clonedId) as Rectangle;
        assert.ok(restoredClone, 'Ctrl+Y debe restaurar la copia');
        assert.equal(restoredClone.x, 150);
        assert.equal(restoredClone.y, 130);

        controller.destroy();
      });

      it('Alt+arrastrar un grupo y una selección múltiple: las copias conservan posiciones y orden de apilado relativos, con ids únicos', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        // A. Alt+arrastrar un grupo
        const child1: Rectangle = {
          id: 'g-child-1',
          type: 'rectangle',
          name: 'Child 1',
          x: 50,
          y: 50,
          width: 40,
          height: 40,
        };
        const child2: Ellipse = {
          id: 'g-child-2',
          type: 'ellipse',
          name: 'Child 2',
          x: 120,
          y: 70,
          radiusX: 20,
          radiusY: 20,
        };
        const group: Group = {
          id: 'group-orig',
          type: 'group',
          name: 'Group Orig',
          children: [child1, child2],
        };

        stateManager.addNode(layerId, group);
        stateManager.selectNode('group-orig');

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        const startScreenX = 60 * zoom + panX;
        const startScreenY = 60 * zoom + panY;
        const targetScreenX = (60 + 40) * zoom + panX;
        const targetScreenY = (60 + 30) * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', {
          clientX: startScreenX,
          clientY: startScreenY,
          button: 0,
          altKey: true,
        });
        canvas.dispatchSimulatedEvent('mousemove', {
          clientX: targetScreenX,
          clientY: targetScreenY,
          altKey: true,
        });
        canvas.dispatchSimulatedEvent('mouseup', {
          clientX: targetScreenX,
          clientY: targetScreenY,
          button: 0,
          altKey: true,
        });

        // Original intacto
        const origG = stateManager.findNode('group-orig') as Group;
        assert.ok(origG);
        assert.equal((origG.children[0] as Rectangle).x, 50);

        // Copia del grupo seleccionada
        const selGroup = stateManager.getSelectedNodes();
        assert.equal(selGroup.length, 1);
        const clonedGroup = selGroup[0] as Group;
        assert.notEqual(clonedGroup.id, 'group-orig');
        assert.equal(clonedGroup.children.length, 2);

        // IDs únicos en hijos
        assert.notEqual(clonedGroup.children[0].id, 'g-child-1');
        assert.notEqual(clonedGroup.children[1].id, 'g-child-2');
        assert.notEqual(clonedGroup.children[0].id, clonedGroup.children[1].id);

        // Posiciones relativas de las copias
        const clonedChild1 = clonedGroup.children[0] as Rectangle;
        const clonedChild2 = clonedGroup.children[1] as Ellipse;
        assert.equal(clonedChild1.x, 90);
        assert.equal(clonedChild1.y, 80);
        assert.equal(clonedChild2.x, 160);
        assert.equal(clonedChild2.y, 100);

        // B. Alt+arrastrar selección múltiple
        const rA: Rectangle = { id: 'multi-a', type: 'rectangle', name: 'A', x: 200, y: 200, width: 30, height: 30 };
        const rB: Rectangle = { id: 'multi-b', type: 'rectangle', name: 'B', x: 250, y: 200, width: 30, height: 30 };
        stateManager.addShape(layerId, rA);
        stateManager.addShape(layerId, rB);
        stateManager.setSelection(['multi-a', 'multi-b']);

        const mStartX = 210 * zoom + panX;
        const mStartY = 210 * zoom + panY;
        const mTargetX = (210 + 20) * zoom + panX;
        const mTargetY = (210 + 40) * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', { clientX: mStartX, clientY: mStartY, button: 0, altKey: true });
        canvas.dispatchSimulatedEvent('mousemove', { clientX: mTargetX, clientY: mTargetY, altKey: true });
        canvas.dispatchSimulatedEvent('mouseup', { clientX: mTargetX, clientY: mTargetY, button: 0, altKey: true });

        // Originales intactas
        assert.equal((stateManager.findNode('multi-a') as Rectangle).x, 200);
        assert.equal((stateManager.findNode('multi-b') as Rectangle).x, 250);

        // Copias seleccionadas
        const multiSel = stateManager.getSelectedNodes();
        assert.equal(multiSel.length, 2);
        const [copyA, copyB] = multiSel as Rectangle[];
        assert.notEqual(copyA.id, 'multi-a');
        assert.notEqual(copyB.id, 'multi-b');
        assert.notEqual(copyA.id, copyB.id);
        assert.equal(copyA.x, 220);
        assert.equal(copyA.y, 240);
        assert.equal(copyB.x, 270);
        assert.equal(copyB.y, 240);

        // Orden de apilado relativo conservado en la capa
        const layer = stateManager.findNode(layerId) as Layer;
        const idxA = layer.children.findIndex((c) => c.id === 'multi-a');
        const idxB = layer.children.findIndex((c) => c.id === 'multi-b');
        const idxCopyA = layer.children.findIndex((c) => c.id === copyA.id);
        const idxCopyB = layer.children.findIndex((c) => c.id === copyB.id);
        assert.ok(idxA < idxB, 'A antes que B');
        assert.ok(idxCopyA < idxCopyB, 'Copia A antes que Copia B');
        assert.ok(idxB < idxCopyA, 'Copias insertadas encima de los originales');

        controller.destroy();
      });

      it('Alt pulsado a mitad del arrastre: las originales vuelven a su sitio y aparece la copia. Alt soltado a mitad: la copia desaparece y la original se mueve', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rect: Rectangle = {
          id: 'rect-toggle',
          type: 'rectangle',
          name: 'Toggle Alt',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
        };
        stateManager.addShape(layerId, rect);
        stateManager.selectNode('rect-toggle');

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        const startX = 120 * zoom + panX;
        const startY = 120 * zoom + panY;

        // 1. Mousedown SIN Alt
        canvas.dispatchSimulatedEvent('mousedown', { clientX: startX, clientY: startY, button: 0, altKey: false });

        // 2. Mover 30px SIN Alt -> la original se mueve
        const mid1X = (120 + 30) * zoom + panX;
        const mid1Y = (120 + 30) * zoom + panY;
        canvas.dispatchSimulatedEvent('mousemove', { clientX: mid1X, clientY: mid1Y, altKey: false });

        let currentOrig = stateManager.findNode('rect-toggle') as Rectangle;
        assert.equal(currentOrig.x, 130);
        assert.equal(controller.isCopyDragging, false);

        // 3. Alt aparece a mitad del arrastre (mover a delta 50px con altKey: true)
        const mid2X = (120 + 50) * zoom + panX;
        const mid2Y = (120 + 50) * zoom + panY;
        canvas.dispatchSimulatedEvent('mousemove', { clientX: mid2X, clientY: mid2Y, altKey: true });

        // Las originales vuelven a su instantánea inicial (100, 100)
        currentOrig = stateManager.findNode('rect-toggle') as Rectangle;
        assert.equal(currentOrig.x, 100, 'Original vuelve a su posición inicial al pulsar Alt');
        assert.equal(currentOrig.y, 100);

        // Aparece la copia y está seleccionada en posición final (150, 150)
        assert.equal(controller.isCopyDragging, true);
        const selAfterAlt = stateManager.getSelection();
        assert.notEqual(selAfterAlt[0], 'rect-toggle');
        const cloneShape = stateManager.findNode(selAfterAlt[0]) as Rectangle;
        assert.ok(cloneShape);
        assert.equal(cloneShape.x, 150);
        assert.equal(cloneShape.y, 150);

        // 4. Alt se suelta a mitad del arrastre (mover a delta 70px con altKey: false)
        const mid3X = (120 + 70) * zoom + panX;
        const mid3Y = (120 + 70) * zoom + panY;
        canvas.dispatchSimulatedEvent('mousemove', { clientX: mid3X, clientY: mid3Y, altKey: false });

        // La copia desaparece
        assert.equal(stateManager.findNode(cloneShape.id), null, 'La copia debe ser eliminada al soltar Alt');
        assert.equal(controller.isCopyDragging, false);

        // La original vuelve a seleccionarse y se mueve con el delta actual (100 + 70 = 170)
        assert.deepEqual(stateManager.getSelection(), ['rect-toggle']);
        currentOrig = stateManager.findNode('rect-toggle') as Rectangle;
        assert.equal(currentOrig.x, 170);
        assert.equal(currentOrig.y, 170);

        // 5. Mouseup sin Alt finaliza arrastre normal
        canvas.dispatchSimulatedEvent('mouseup', { clientX: mid3X, clientY: mid3Y, button: 0, altKey: false });
        assert.equal(commandManager.canUndo(), true);
        const lastCmd = (commandManager as any).undoStack[0];
        assert.equal(lastCmd instanceof TranslateCommand, true);

        controller.destroy();
      });

      it('Alt+clic sin arrastre: no se crea nada. Escape cancela sin dejar rastro', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rect: Rectangle = {
          id: 'rect-esc',
          type: 'rectangle',
          name: 'Esc Rect',
          x: 100,
          y: 100,
          width: 60,
          height: 60,
        };
        stateManager.addShape(layerId, rect);
        stateManager.selectNode('rect-esc');

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        const clickX = 120 * zoom + panX;
        const clickY = 120 * zoom + panY;

        // A. Alt+clic sin superar umbral (3px) -> no crea nada
        canvas.dispatchSimulatedEvent('mousedown', { clientX: clickX, clientY: clickY, button: 0, altKey: true });
        canvas.dispatchSimulatedEvent('mouseup', { clientX: clickX, clientY: clickY, button: 0, altKey: true });

        const layer = stateManager.findNode(layerId) as Layer;
        assert.equal(layer.children.length, 1, 'No se debe haber creado ninguna figura');
        assert.equal(commandManager.canUndo(), false, 'Sin arrastre no se registra nada en el historial');

        // B. Escape durante arrastre con Alt cancela sin dejar rastro
        canvas.dispatchSimulatedEvent('mousedown', { clientX: clickX, clientY: clickY, button: 0, altKey: true });
        const moveX = (120 + 40) * zoom + panX;
        const moveY = (120 + 40) * zoom + panY;
        canvas.dispatchSimulatedEvent('mousemove', { clientX: moveX, clientY: moveY, altKey: true });

        assert.equal(controller.isCopyDragging, true);
        let currentLayer = stateManager.findNode(layerId) as Layer;
        assert.equal(currentLayer.children.length, 2, 'Durante el arrastre existe el clon temporal');

        // Pulsar Escape
        canvas.dispatchSimulatedEvent('keydown', { key: 'Escape' });
        assert.equal(controller.isCopyDragging, false);
        assert.equal(controller.isDragging, false);

        // El clon fue eliminado y la selección original restaurada
        currentLayer = stateManager.findNode(layerId) as Layer;
        assert.equal(currentLayer.children.length, 1);
        assert.deepEqual(stateManager.getSelection(), ['rect-esc']);
        const orig = stateManager.findNode('rect-esc') as Rectangle;
        assert.equal(orig.x, 100);
        assert.equal(orig.y, 100);

        // Mouseup posterior no debe registrar nada
        canvas.dispatchSimulatedEvent('mouseup', { clientX: moveX, clientY: moveY, button: 0, altKey: true });
        assert.equal(commandManager.canUndo(), false, 'Escape cancela sin dejar rastro en el historial');

        controller.destroy();
      });

      it('Sin Alt, el arrastre se comporta como antes: los tests existentes pasan sin modificarlos', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rect: Rectangle = {
          id: 'rect-normal',
          type: 'rectangle',
          name: 'Normal',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
        };
        stateManager.addShape(layerId, rect);
        stateManager.selectNode('rect-normal');

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        const startX = 120 * zoom + panX;
        const startY = 120 * zoom + panY;
        const targetX = (120 + 35) * zoom + panX;
        const targetY = (120 + 25) * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', { clientX: startX, clientY: startY, button: 0, altKey: false });
        canvas.dispatchSimulatedEvent('mousemove', { clientX: targetX, clientY: targetY, altKey: false });
        canvas.dispatchSimulatedEvent('mouseup', { clientX: targetX, clientY: targetY, button: 0, altKey: false });

        assert.equal(controller.isCopyDragging, false);
        const moved = stateManager.findNode('rect-normal') as Rectangle;
        assert.equal(moved.x, 135);
        assert.equal(moved.y, 125);

        assert.equal(commandManager.canUndo(), true);
        commandManager.undo();

        const reverted = stateManager.findNode('rect-normal') as Rectangle;
        assert.equal(reverted.x, 100);
        assert.equal(reverted.y, 100);

        controller.destroy();
      });
    });
  }
});
