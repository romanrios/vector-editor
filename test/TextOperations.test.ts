import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { SelectionOperations } from '../src/input/SelectionOperations.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { RotateCommand } from '../src/commands/RotateCommand.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import {
  getTextBaseAABB,
  getTextAABB,
  getShapeAABB,
  getNodeAABB,
  isPointInText,
  isPointInShape,
  getShapesIntersectingRect,
  getSelectionHandles,
  setSharedMeasureContext,
} from '../src/utils/geometry.ts';
import { scaleShapesAboutAnchor } from '../src/utils/transform.ts';
import type { Text, Rectangle } from '../src/types/scene-graph.ts';

function createMockCanvas(options?: { charWidth?: number }): {
  canvas: HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
  mockCtx: CanvasRenderingContext2D;
} {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const charWidth = options?.charWidth ?? 8;

  const mockCtx = {
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    measureText: (text: string) => ({
      width: text.length * charWidth,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 4,
    }),
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
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
    getContext: (id: string) => (id === '2d' ? mockCtx : null),
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, eventObj: unknown) => {
      const cbs = listeners[type] || [];
      for (const cb of cbs) {
        cb(eventObj);
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };

  return { canvas, mockCtx };
}

describe('Operaciones e Integración de Text', () => {
  // -------------------------------------------------------------
  // 1. AABB
  // -------------------------------------------------------------
  describe('AABB de nodos Text', () => {
    it('calcula getTextBaseAABB y getTextAABB sin rotación para alineación izquierda', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const text: Text = {
        id: 't-1',
        type: 'text',
        name: 'Texto 1',
        x: 100,
        y: 50,
        text: 'Hola',
        fontSize: 20,
        textAlign: 'left',
      };

      const base = getTextBaseAABB(text, mockCtx);
      assert.equal(base.minX, 100);
      assert.equal(base.minY, 50);
      assert.equal(base.width, 40); // 4 chars * 10
      assert.equal(base.height, 20);
      assert.equal(base.maxX, 140);
      assert.equal(base.maxY, 70);

      const aabb = getTextAABB(text, mockCtx);
      assert.deepEqual(aabb, base);
      assert.deepEqual(getShapeAABB(text), aabb);
      assert.deepEqual(getNodeAABB(text), aabb);

      setSharedMeasureContext(null);
    });

    it('calcula getTextBaseAABB respetando alineación center y right', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      const textCenter: Text = {
        id: 't-c',
        type: 'text',
        name: 'Center',
        x: 100,
        y: 50,
        text: 'Hola',
        fontSize: 20,
        textAlign: 'center',
      };
      const baseCenter = getTextBaseAABB(textCenter, mockCtx);
      assert.equal(baseCenter.minX, 80); // 100 - 40/2
      assert.equal(baseCenter.maxX, 120);

      const textRight: Text = {
        id: 't-r',
        type: 'text',
        name: 'Right',
        x: 100,
        y: 50,
        text: 'Hola',
        fontSize: 20,
        textAlign: 'right',
      };
      const baseRight = getTextBaseAABB(textRight, mockCtx);
      assert.equal(baseRight.minX, 60); // 100 - 40
      assert.equal(baseRight.maxX, 100);
    });

    it('calcula getTextAABB con rotación envolviendo todas las esquinas rotadas', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      const textRot: Text = {
        id: 't-rot',
        type: 'text',
        name: 'Rotated',
        x: 0,
        y: 0,
        text: 'AB', // width = 20, height = 10
        fontSize: 10,
        rotation: 90,
      };

      const aabb = getTextAABB(textRot, mockCtx);
      // Con rotación de 90° alrededor de (0,0):
      // (0, 0) -> (0, 0)
      // (20, 0) -> (0, 20)
      // (20, 10) -> (-10, 20)
      // (0, 10) -> (-10, 0)
      assert.ok(Math.abs(aabb.minX - (-10)) < 1e-4);
      assert.ok(Math.abs(aabb.maxX - 0) < 1e-4);
      assert.ok(Math.abs(aabb.minY - 0) < 1e-4);
      assert.ok(Math.abs(aabb.maxY - 20) < 1e-4);
      assert.ok(Math.abs(aabb.width - 10) < 1e-4);
      assert.ok(Math.abs(aabb.height - 20) < 1e-4);
    });
  });

  // -------------------------------------------------------------
  // 2. Hit Testing
  // -------------------------------------------------------------
  describe('Hit testing de nodos Text', () => {
    it('isPointInText e isPointInShape detectan clics dentro del área visible y fallan fuera', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      const text: Text = {
        id: 't-hit',
        type: 'text',
        name: 'Hit',
        x: 50,
        y: 50,
        text: 'Palabra', // 7 chars * 10 = 70px ancho, height = 20
        fontSize: 20,
      };

      // Interior
      assert.equal(isPointInText(60, 60, text, 0, mockCtx), true);
      assert.equal(isPointInShape(60, 60, text, 0, mockCtx), true);

      // Exterior
      assert.equal(isPointInText(40, 60, text, 0, mockCtx), false);
      assert.equal(isPointInText(130, 60, text, 0, mockCtx), false);
      assert.equal(isPointInText(60, 80, text, 0, mockCtx), false);

      // Con tolerancia de 5px
      assert.equal(isPointInText(48, 60, text, 0, mockCtx), false);
      assert.equal(isPointInText(48, 60, text, 5, mockCtx), true);
    });

    it('hitTest en InputController retorna el nodo Text correspondiente al hacer clic', () => {
      const { canvas, mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const inputController = new InputController(canvas, stateManager, commandManager);

      const text: Text = {
        id: 't-controller',
        type: 'text',
        name: 'Texto En Canvas',
        x: 100,
        y: 100,
        text: 'Seleccioname', // 12 chars * 10 = 120
        fontSize: 20,
      };
      stateManager.addShape('layer-default', text);

      const hit = inputController.hitTest(120, 110);
      assert.ok(hit !== null);
      assert.equal(hit?.id, 't-controller');

      const miss = inputController.hitTest(300, 300);
      assert.equal(miss, null);

      inputController.destroy();
      setSharedMeasureContext(null);
    });
  });

  // -------------------------------------------------------------
  // 3. Selección y Marquesina
  // -------------------------------------------------------------
  describe('Selección de nodos Text', () => {
    it('participa en selección por clic y actualiza StateManager', () => {
      const { canvas, mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const inputController = new InputController(canvas, stateManager, commandManager);
      inputController.setTool('select');

      const text: Text = {
        id: 't-sel',
        type: 'text',
        name: 'ClickMe',
        x: 200,
        y: 200,
        text: 'Click',
        fontSize: 20,
      };
      stateManager.addShape('layer-default', text);

      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 210,
        clientY: 210,
        button: 0,
        shiftKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 210,
        clientY: 210,
        button: 0,
        shiftKey: false,
      });

      assert.equal(stateManager.isSelected('t-sel'), true);

      // Clic en espacio vacío deselecciona
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
      });

      assert.equal(stateManager.isSelected('t-sel'), false);

      inputController.destroy();
      setSharedMeasureContext(null);
    });

    it('participa en selección por marquesina mediante getShapesIntersectingRect', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const text: Text = {
        id: 't-marq',
        type: 'text',
        name: 'Marquee Text',
        x: 100,
        y: 100,
        text: 'Text', // width = 40, height = 20 -> [100, 140] x [100, 120]
        fontSize: 20,
      };

      // Marquesina que intersecta
      const intersecting = getShapesIntersectingRect([text], {
        x: 90,
        y: 90,
        width: 30,
        height: 30,
      });
      assert.equal(intersecting.length, 1);
      assert.equal(intersecting[0].id, 't-marq');

      // Marquesina que no intersecta
      const notIntersecting = getShapesIntersectingRect([text], {
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      });
      assert.equal(notIntersecting.length, 0);

      setSharedMeasureContext(null);
    });
  });

  // -------------------------------------------------------------
  // 4. Movimiento y TranslateCommand
  // -------------------------------------------------------------
  describe('Movimiento de Text', () => {
    it('mueve el nodo Text con TranslateCommand y permite undo/redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const text: Text = {
        id: 't-mov',
        type: 'text',
        name: 'Move Text',
        x: 100,
        y: 100,
        text: 'Mover',
        fontSize: 16,
      };
      stateManager.addShape('layer-default', text);
      stateManager.selectNode('t-mov');

      const cmd = new TranslateCommand(stateManager, 't-mov', 100, 100, 150, 180);
      commandManager.executeCommand(cmd);

      const moved = stateManager.findNode('t-mov') as Text;
      assert.equal(moved.x, 150);
      assert.equal(moved.y, 180);

      // Undo
      commandManager.undo();
      const undone = stateManager.findNode('t-mov') as Text;
      assert.equal(undone.x, 100);
      assert.equal(undone.y, 100);

      // Redo
      commandManager.redo();
      const redone = stateManager.findNode('t-mov') as Text;
      assert.equal(redone.x, 150);
      assert.equal(redone.y, 180);
    });

    it('moveSelection en SelectionOperations traslada un nodo Text', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const ops = new SelectionOperations(stateManager, commandManager);

      const text: Text = {
        id: 't-ops-mov',
        type: 'text',
        name: 'Move Ops',
        x: 50,
        y: 60,
        text: 'Arrow Move',
        fontSize: 16,
      };
      stateManager.addShape('layer-default', text);
      stateManager.selectNode('t-ops-mov');

      ops.moveSelection(20, -10);

      const updated = stateManager.findNode('t-ops-mov') as Text;
      assert.equal(updated.x, 70);
      assert.equal(updated.y, 50);
    });
  });

  // -------------------------------------------------------------
  // 5. Transformación (Rotación y Redimensionado)
  // -------------------------------------------------------------
  describe('Transformación de Text', () => {
    it('rota un nodo Text con RotateCommand y permite undo/redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const text: Text = {
        id: 't-rot-cmd',
        type: 'text',
        name: 'Rotate Cmd',
        x: 100,
        y: 100,
        text: 'Girar',
        rotation: 0,
      };
      stateManager.addShape('layer-default', text);

      const cmd = new RotateCommand(stateManager, 't-rot-cmd', 0, 45);
      commandManager.executeCommand(cmd);

      const rotated = stateManager.findNode('t-rot-cmd') as Text;
      assert.equal(rotated.rotation, 45);

      commandManager.undo();
      const undone = stateManager.findNode('t-rot-cmd') as Text;
      assert.equal(undone.rotation, 0);

      commandManager.redo();
      const redone = stateManager.findNode('t-rot-cmd') as Text;
      assert.equal(redone.rotation, 45);
    });

    it('redimensiona un nodo Text con ResizeCommand actualizando fontSize y posición con undo/redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const text: Text = {
        id: 't-res-cmd',
        type: 'text',
        name: 'Resize Cmd',
        x: 100,
        y: 100,
        text: 'Escalar',
        fontSize: 16,
      };
      stateManager.addShape('layer-default', text);

      const initialDims = { x: 100, y: 100, fontSize: 16, width: 60, height: 16 };
      const finalDims = { x: 100, y: 100, fontSize: 32, width: 120, height: 32 };

      const cmd = new ResizeCommand(stateManager, 't-res-cmd', initialDims, finalDims);
      commandManager.executeCommand(cmd);

      const resized = stateManager.findNode('t-res-cmd') as Text;
      assert.equal(resized.fontSize, 32);

      commandManager.undo();
      const undone = stateManager.findNode('t-res-cmd') as Text;
      assert.equal(undone.fontSize, 16);

      commandManager.redo();
      const redone = stateManager.findNode('t-res-cmd') as Text;
      assert.equal(redone.fontSize, 32);
    });

    it('scaleShapesAboutAnchor escala el fontSize y la posición de un nodo Text', () => {
      const text: Text = {
        id: 't-scale',
        type: 'text',
        name: 'Anchor Scale',
        x: 100,
        y: 100,
        text: 'Escala Multi',
        fontSize: 20,
      };

      const changes = scaleShapesAboutAnchor([text], { x: 0, y: 0 }, 2, 2);
      assert.equal(changes.length, 1);
      assert.equal(changes[0].id, 't-scale');
      assert.equal(changes[0].dimensions.x, 200);
      assert.equal(changes[0].dimensions.y, 200);
      assert.equal(changes[0].dimensions.fontSize, 40);
    });

    it('getSelectionHandles genera los 5 tiradores de caja y rotación para un nodo Text', () => {
      const { mockCtx } = createMockCanvas({ charWidth: 10 });
      setSharedMeasureContext(mockCtx);

      const text: Text = {
        id: 't-handles',
        type: 'text',
        name: 'Handles',
        x: 100,
        y: 100,
        text: 'Handles', // 7 chars * 10 = 70, height = 20
        fontSize: 20,
      };

      const handles = getSelectionHandles(text, 8, 30);
      assert.equal(handles.length, 5);
      const types = handles.map((h) => h.type);
      assert.ok(types.includes('top-left'));
      assert.ok(types.includes('top-right'));
      assert.ok(types.includes('bottom-right'));
      assert.ok(types.includes('bottom-left'));
      assert.ok(types.includes('rotation-handle'));

      setSharedMeasureContext(null);
    });
  });

  // -------------------------------------------------------------
  // 6. Copy / Paste
  // -------------------------------------------------------------
  describe('Portapapeles (Copy / Paste) de Text', () => {
    it('copia y pega un nodo Text con nuevo ID, desplazamiento y selección', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const ops = new SelectionOperations(stateManager, commandManager);

      const text: Text = {
        id: 't-copy',
        type: 'text',
        name: 'Original Text',
        x: 100,
        y: 100,
        text: 'Copiame',
        fontSize: 18,
      };
      stateManager.addShape('layer-default', text);
      stateManager.selectNode('t-copy');

      const copied = ops.copy();
      assert.equal(copied, true);

      const pasted = ops.paste();
      assert.ok(pasted !== null);
      assert.equal(pasted.length, 1);

      const pastedNode = pasted[0] as Text;
      assert.ok(pastedNode.id !== 't-copy');
      assert.equal(pastedNode.type, 'text');
      assert.equal(pastedNode.text, 'Copiame');
      assert.equal(pastedNode.fontSize, 18);
      assert.equal(pastedNode.x, 110); // offset +10
      assert.equal(pastedNode.y, 110);

      // Deshacer el pegado
      commandManager.undo();
      assert.equal(stateManager.findNode(pastedNode.id), null);

      // Rehacer el pegado
      commandManager.redo();
      assert.ok(stateManager.findNode(pastedNode.id) !== undefined);
    });
  });

  // -------------------------------------------------------------
  // 7. Duplicate
  // -------------------------------------------------------------
  describe('Duplicar (duplicate) Text', () => {
    it('duplica un nodo Text directamente con offset y soporte de undo/redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const ops = new SelectionOperations(stateManager, commandManager);

      const text: Text = {
        id: 't-dup',
        type: 'text',
        name: 'To Duplicate',
        x: 50,
        y: 50,
        text: 'Duplicame',
        fontSize: 24,
      };
      stateManager.addShape('layer-default', text);
      stateManager.selectNode('t-dup');

      const dupResult = ops.duplicate();
      assert.ok(dupResult !== null);
      assert.equal(dupResult.length, 1);

      const cloned = dupResult[0] as Text;
      assert.notEqual(cloned.id, 't-dup');
      assert.equal(cloned.x, 60);
      assert.equal(cloned.y, 60);
      assert.equal(cloned.text, 'Duplicame');
      assert.equal(cloned.fontSize, 24);

      // Undo
      commandManager.undo();
      assert.equal(stateManager.findNode(cloned.id), null);

      // Redo
      commandManager.redo();
      assert.ok(stateManager.findNode(cloned.id) !== null);
    });
  });

  // -------------------------------------------------------------
  // 8. Delete
  // -------------------------------------------------------------
  describe('Eliminar (Delete) Text', () => {
    it('elimina un nodo Text con DeleteCommand y permite restaurarlo con undo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const ops = new SelectionOperations(stateManager, commandManager);

      const text: Text = {
        id: 't-del',
        type: 'text',
        name: 'To Delete',
        x: 100,
        y: 100,
        text: 'Borrame',
      };
      stateManager.addShape('layer-default', text);
      stateManager.selectNode('t-del');

      const deleted = ops.deleteSelected();
      assert.equal(deleted, true);
      assert.equal(stateManager.findNode('t-del'), null);

      // Undo restaura
      commandManager.undo();
      const restored = stateManager.findNode('t-del') as Text;
      assert.ok(restored !== null);
      assert.equal(restored.text, 'Borrame');

      // Redo elimina
      commandManager.redo();
      assert.equal(stateManager.findNode('t-del'), null);
    });
  });

  // -------------------------------------------------------------
  // 9. Group / Ungroup
  // -------------------------------------------------------------
  describe('Agrupación (Group / Ungroup) de Text', () => {
    it('agrupa un Text con un Rectangle y permite desagrupar con undo/redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const ops = new SelectionOperations(stateManager, commandManager);

      const text: Text = {
        id: 't-grp',
        type: 'text',
        name: 'Group Text',
        x: 10,
        y: 10,
        text: 'G',
        fontSize: 16,
      };
      const rect: Rectangle = {
        id: 'r-grp',
        type: 'rectangle',
        name: 'Group Rect',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
      };

      stateManager.addShape('layer-default', text);
      stateManager.addShape('layer-default', rect);
      stateManager.setSelection(['t-grp', 'r-grp']);

      // Agrupar
      const group = ops.groupSelection();
      assert.ok(group !== null);
      assert.equal(group.children.length, 2);
      assert.ok(stateManager.findNode(group.id) !== null);

      // Deshacer agrupación
      commandManager.undo();
      assert.equal(stateManager.findNode(group.id), null);
      assert.ok(stateManager.findNode('t-grp') !== null);
      assert.ok(stateManager.findNode('r-grp') !== null);

      // Rehacer agrupación
      commandManager.redo();
      assert.ok(stateManager.findNode(group.id) !== null);

      // Desagrupar
      stateManager.selectNode(group.id);
      const ungrouped = ops.ungroupSelection();
      assert.equal(ungrouped, true);
      assert.equal(stateManager.findNode(group.id), null);
      assert.ok(stateManager.findNode('t-grp') !== null);
      assert.ok(stateManager.findNode('r-grp') !== null);

      // Undo desagrupación
      commandManager.undo();
      assert.ok(stateManager.findNode(group.id) !== null);
    });
  });
});
