import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { getSelectionBounds, getSelectionHandles } from '../src/utils/geometry.ts';
import { TransformShapesCommand } from '../src/commands/TransformShapesCommand.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import { RotateCommand } from '../src/commands/RotateCommand.ts';
import type { Rectangle, Group } from '../src/types/scene-graph.ts';

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

describe('Conexión interactiva de escalado y rotación de conjuntos', () => {
  const zoomCases = [
    { label: 'zoom = 1', zoom: 1, panX: 0, panY: 0 },
    { label: 'zoom = 1.5 con pan', zoom: 1.5, panX: 30, panY: -20 },
  ];

  for (const { label, zoom, panX, panY } of zoomCases) {
    describe(`Pruebas con ${label}`, () => {
      it('Rotar un grupo 90°: centros y ángulos correctos; un solo Ctrl+Z lo revierte', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rectA: Rectangle = {
          id: 'ra',
          type: 'rectangle',
          name: 'RA',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
        };
        const rectB: Rectangle = {
          id: 'rb',
          type: 'rectangle',
          name: 'RB',
          x: 300,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
        };
        const group: Group = {
          id: 'g1',
          type: 'group',
          name: 'G1',
          children: [rectA, rectB],
        };
        stateManager.addNode(layerId, group);
        stateManager.setSelection(['g1']);

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        const bounds = getSelectionBounds(stateManager.getSelectedNodes())!;
        assert.ok(bounds);
        // Centro (pivote) del grupo: cx = 250, cy = 150
        const pivotX = (bounds.minX + bounds.maxX) / 2;
        const pivotY = (bounds.minY + bounds.maxY) / 2;
        assert.equal(pivotX, 250);
        assert.equal(pivotY, 150);

        // Rotation handle está en (pivotX, bounds.minY - 30/zoom)
        const handleWorldY = bounds.minY - 30 / zoom;
        const startScreenX = pivotX * zoom + panX;
        const startScreenY = handleWorldY * zoom + panY;

        // 1. Mousedown en rotation handle
        canvas.dispatchSimulatedEvent('mousedown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, true);

        // 2. Mousemove para rotar 90° horario (el vector pasa de pointing arriba a pointing derecha)
        // Vector desde pivote: dx > 0, dy = 0 -> ángulo = 0° (antes era -90°, delta = +90°)
        const targetWorldX = pivotX + (pivotY - handleWorldY);
        const targetWorldY = pivotY;
        const targetScreenX = targetWorldX * zoom + panX;
        const targetScreenY = targetWorldY * zoom + panY;

        canvas.dispatchSimulatedEvent('mousemove', { clientX: targetScreenX, clientY: targetScreenY });

        // Comprobar centros y ángulos en vivo
        let currentRA = stateManager.findNode('ra') as Rectangle;
        let currentRB = stateManager.findNode('rb') as Rectangle;
        // rectA centro original (150, 150) relativo a pivote (-100, 0), rotado 90° -> (0, -100) -> nuevo centro (250, 50)
        assert.ok(Math.abs((currentRA.x + currentRA.width / 2) - 250) < 1e-4);
        assert.ok(Math.abs((currentRA.y + currentRA.height / 2) - 50) < 1e-4);
        assert.ok(Math.abs((currentRA.rotation ?? 0) - 90) < 1e-4);

        // rectB centro original (350, 150) relativo a pivote (100, 0), rotado 90° -> (0, 100) -> nuevo centro (250, 250)
        assert.ok(Math.abs((currentRB.x + currentRB.width / 2) - 250) < 1e-4);
        assert.ok(Math.abs((currentRB.y + currentRB.height / 2) - 250) < 1e-4);
        assert.ok(Math.abs((currentRB.rotation ?? 0) - 90) < 1e-4);

        // 3. Mouseup registra UN SOLO comando
        canvas.dispatchSimulatedEvent('mouseup', { clientX: targetScreenX, clientY: targetScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, false);
        assert.equal(commandManager.canUndo(), true);

        const undoStack = (commandManager as any).undoStack;
        assert.equal(undoStack[undoStack.length - 1] instanceof TransformShapesCommand, true);

        // 4. Un solo Ctrl+Z lo revierte todo
        const undone = commandManager.undo();
        assert.equal(undone, true);

        currentRA = stateManager.findNode('ra') as Rectangle;
        currentRB = stateManager.findNode('rb') as Rectangle;
        assert.equal(currentRA.x, 100);
        assert.equal(currentRA.y, 100);
        assert.equal(currentRA.rotation, 0);

        assert.equal(currentRB.x, 300);
        assert.equal(currentRB.y, 100);
        assert.equal(currentRB.rotation, 0);

        controller.destroy();
      });

      it('Escalar una selección múltiple desde una esquina, con y sin Shift: el ancla opuesta no se mueve', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rectA: Rectangle = {
          id: 'ra',
          type: 'rectangle',
          name: 'RA',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
        };
        const rectB: Rectangle = {
          id: 'rb',
          type: 'rectangle',
          name: 'RB',
          x: 200,
          y: 100,
          width: 100,
          height: 100,
        };
        stateManager.addShape(layerId, rectA);
        stateManager.addShape(layerId, rectB);
        stateManager.setSelection(['ra', 'rb']);

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        // Bounds iniciales: minX: 100, minY: 100, maxX: 300, maxY: 200 (width: 200, height: 100)
        // Tirador inferior-derecho ('se' / 'br') en mundo: (300, 200). El ancla opuesta es 'tl' / (100, 100).
        const initialBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
        assert.equal(initialBounds.minX, 100);
        assert.equal(initialBounds.minY, 100);
        assert.equal(initialBounds.maxX, 300);
        assert.equal(initialBounds.maxY, 200);

        // --- Caso SIN Shift ---
        const brWorldX = 300;
        const brWorldY = 200;
        const brScreenX = brWorldX * zoom + panX;
        const brScreenY = brWorldY * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', { clientX: brScreenX, clientY: brScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, true);

        // Mover ratón 50px a la derecha y 50px hacia abajo en mundo
        const target1WorldX = 350;
        const target1WorldY = 250;
        const target1ScreenX = target1WorldX * zoom + panX;
        const target1ScreenY = target1WorldY * zoom + panY;

        canvas.dispatchSimulatedEvent('mousemove', { clientX: target1ScreenX, clientY: target1ScreenY, shiftKey: false });

        let currentBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
        // El ancla opuesta (100, 100) NO debe haberse movido
        assert.ok(Math.abs(currentBounds.minX - 100) < 1e-4, 'Ancla opuesta minX no se mueve');
        assert.ok(Math.abs(currentBounds.minY - 100) < 1e-4, 'Ancla opuesta minY no se mueve');
        assert.ok(Math.abs(currentBounds.maxX - 350) < 1e-4);
        assert.ok(Math.abs(currentBounds.maxY - 250) < 1e-4);

        canvas.dispatchSimulatedEvent('mouseup', { clientX: target1ScreenX, clientY: target1ScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, false);

        // Revertir escala para probar con Shift
        commandManager.undo();
        currentBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
        assert.equal(currentBounds.minX, 100);
        assert.equal(currentBounds.minY, 100);
        assert.equal(currentBounds.maxX, 300);
        assert.equal(currentBounds.maxY, 200);

        // --- Caso CON Shift (proporcional) ---
        canvas.dispatchSimulatedEvent('mousedown', { clientX: brScreenX, clientY: brScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, true);

        // Mover ratón con dx = 100, dy = 30; con Shift el aspecto original (200/100 = 2) debe mantenerse
        const target2WorldX = 400;
        const target2WorldY = 230;
        const target2ScreenX = target2WorldX * zoom + panX;
        const target2ScreenY = target2WorldY * zoom + panY;

        canvas.dispatchSimulatedEvent('mousemove', { clientX: target2ScreenX, clientY: target2ScreenY, shiftKey: true });

        currentBounds = getSelectionBounds(stateManager.getSelectedNodes())!;
        // El ancla opuesta (100, 100) NO debe haberse movido
        assert.ok(Math.abs(currentBounds.minX - 100) < 1e-4, 'Con Shift, ancla minX no se mueve');
        assert.ok(Math.abs(currentBounds.minY - 100) < 1e-4, 'Con Shift, ancla minY no se mueve');
        // El aspecto (ancho / alto) debe ser exactamente el inicial (2:1)
        const currentWidth = currentBounds.maxX - currentBounds.minX;
        const currentHeight = currentBounds.maxY - currentBounds.minY;
        assert.ok(Math.abs(currentWidth / currentHeight - 2) < 1e-4, 'Proporción 2:1 preservada con Shift');

        canvas.dispatchSimulatedEvent('mouseup', { clientX: target2ScreenX, clientY: target2ScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, false);

        controller.destroy();
      });

      it('Escape cancela y restaura; sin cambio no se registra historial', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rectA: Rectangle = {
          id: 'ra',
          type: 'rectangle',
          name: 'RA',
          x: 100,
          y: 100,
          width: 80,
          height: 80,
        };
        const rectB: Rectangle = {
          id: 'rb',
          type: 'rectangle',
          name: 'RB',
          x: 200,
          y: 100,
          width: 80,
          height: 80,
        };
        stateManager.addShape(layerId, rectA);
        stateManager.addShape(layerId, rectB);
        stateManager.setSelection(['ra', 'rb']);

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        const bounds = getSelectionBounds(stateManager.getSelectedNodes())!;
        const brWorldX = bounds.maxX;
        const brWorldY = bounds.maxY;
        const brScreenX = brWorldX * zoom + panX;
        const brScreenY = brWorldY * zoom + panY;

        // 1. Iniciar transformación y mover
        canvas.dispatchSimulatedEvent('mousedown', { clientX: brScreenX, clientY: brScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, true);

        canvas.dispatchSimulatedEvent('mousemove', { clientX: brScreenX + 50, clientY: brScreenY + 50 });
        let movedRA = stateManager.findNode('ra') as Rectangle;
        assert.notEqual(movedRA.width, 80, 'Durante el movimiento la figura cambia temporalmente');

        // Pulsar Escape
        canvas.dispatchSimulatedEvent('keydown', { key: 'Escape' });
        assert.equal(controller.isMultiTransforming, false, 'Escape cancela la transformación activa');

        // Verificar que las figuras vuelven a sus dimensiones exactas iniciales
        let restoredRA = stateManager.findNode('ra') as Rectangle;
        let restoredRB = stateManager.findNode('rb') as Rectangle;
        assert.equal(restoredRA.x, 100);
        assert.equal(restoredRA.y, 100);
        assert.equal(restoredRA.width, 80);
        assert.equal(restoredRA.height, 80);
        assert.equal(restoredRB.x, 200);
        assert.equal(restoredRB.width, 80);

        // Mouseup posterior no debe registrar nada
        canvas.dispatchSimulatedEvent('mouseup', { clientX: brScreenX + 50, clientY: brScreenY + 50, button: 0 });
        assert.equal(commandManager.canUndo(), false, 'Escape no deja comandos en el historial');

        // 2. Clic en tirador sin cambio (mousedown y mouseup inmediatos) -> no registra historial
        const undoCountBefore = (commandManager as any).undoStack.length;
        canvas.dispatchSimulatedEvent('mousedown', { clientX: brScreenX, clientY: brScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, true);
        canvas.dispatchSimulatedEvent('mouseup', { clientX: brScreenX, clientY: brScreenY, button: 0 });
        assert.equal(controller.isMultiTransforming, false);
        const undoCountAfter = (commandManager as any).undoStack.length;
        assert.equal(undoCountAfter, undoCountBefore, 'Sin cambios no se registra comando en historial');

        controller.destroy();
      });

      it('Una figura suelta se comporta como antes (los tests existentes pasan sin modificarlos)', () => {
        const stateManager = new StateManager();
        const commandManager = new CommandManager();
        const viewportManager = new ViewportManager({ zoom, panX, panY });
        const layerId = stateManager.getState().children[0].id;

        const rect: Rectangle = {
          id: 'single-rect',
          type: 'rectangle',
          name: 'Single',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
        };
        stateManager.addShape(layerId, rect);
        stateManager.selectNode('single-rect');

        const canvas = createMockCanvas();
        const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

        // Redimensionado de figura individual usa tiradores de figura suelta y activa _isResizing
        const handles = getSelectionHandles(rect, 8 / zoom, 30 / zoom);
        const brHandle = handles.find((h) => h.type === 'bottom-right')!;
        assert.ok(brHandle);

        const brCenterX = (brHandle.minX + brHandle.maxX) / 2;
        const brCenterY = (brHandle.minY + brHandle.maxY) / 2;
        const brScreenX = brCenterX * zoom + panX;
        const brScreenY = brCenterY * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', { clientX: brScreenX, clientY: brScreenY, button: 0 });
        assert.equal(controller.isResizing, true, 'isResizing debe ser true para figura suelta');
        assert.equal(controller.isMultiTransforming, false, 'No debe activar multiTransforming');

        // Mover ratón 20px en pantalla
        canvas.dispatchSimulatedEvent('mousemove', { clientX: brScreenX + 20, clientY: brScreenY + 20 });
        canvas.dispatchSimulatedEvent('mouseup', { clientX: brScreenX + 20, clientY: brScreenY + 20, button: 0 });
        assert.equal(controller.isResizing, false);
        assert.equal(commandManager.canUndo(), true);

        const undoStack = (commandManager as any).undoStack;
        assert.equal(undoStack[undoStack.length - 1] instanceof ResizeCommand, true, 'Debe registrar ResizeCommand');

        // Rotación de figura suelta usa rotation-handle y activa _isRotating (recalculado tras el resize)
        const updatedRect = stateManager.findNode('single-rect') as Rectangle;
        const updatedHandles = getSelectionHandles(updatedRect, 8 / zoom, 30 / zoom);
        const rotHandle = updatedHandles.find((h) => h.type === 'rotation-handle')!;
        assert.ok(rotHandle);

        const rotCenterX = (rotHandle.minX + rotHandle.maxX) / 2;
        const rotCenterY = (rotHandle.minY + rotHandle.maxY) / 2;
        const rotScreenX = rotCenterX * zoom + panX;
        const rotScreenY = rotCenterY * zoom + panY;

        canvas.dispatchSimulatedEvent('mousedown', { clientX: rotScreenX, clientY: rotScreenY, button: 0 });
        assert.equal(controller.isRotating, true, 'isRotating debe ser true para figura suelta');
        assert.equal(controller.isMultiTransforming, false);

        canvas.dispatchSimulatedEvent('mousemove', { clientX: rotScreenX + 30, clientY: rotScreenY });
        canvas.dispatchSimulatedEvent('mouseup', { clientX: rotScreenX + 30, clientY: rotScreenY, button: 0 });
        assert.equal(controller.isRotating, false);

        assert.equal(undoStack[undoStack.length - 1] instanceof RotateCommand, true, 'Debe registrar RotateCommand');

        controller.destroy();
      });
    });
  }
});
