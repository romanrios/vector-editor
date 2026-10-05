import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import {
  translatePathAnchors,
  getVisiblePathHandles,
  mirrorHandleCollinear,
  isSmoothPoint,
} from '../src/utils/geometry.ts';
import type { Path, PathPoint } from '../src/types/scene-graph.ts';

// Mock simple de Canvas para Node.js (de test/PathAndPenTool.test.ts)
function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void; calls: string[] } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const calls: string[] = [];

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setTransform: () => calls.push('setTransform'),
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    bezierCurveTo: () => calls.push('bezierCurveTo'),
    closePath: () => calls.push('closePath'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    rect: () => calls.push('rect'),
    roundRect: () => calls.push('roundRect'),
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    arc: () => calls.push('arc'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    setLineDash: () => calls.push('setLineDash'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };

  return {
    style: { cursor: 'default' },
    width: 1000,
    height: 800,
    calls,
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
    getContext: (id: string) => (id === '2d' ? (mockCtx as CanvasRenderingContext2D) : null),
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
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void; calls: string[] };
}

describe('DirectSelect & translatePathAnchors', () => {
  describe('a) Unit tests de translatePathAnchors', () => {
    it('desplaza ancla con ambos handles', () => {
      const points: PathPoint[] = [
        { x: 10, y: 20, handleIn: { x: 5, y: 15 }, handleOut: { x: 15, y: 25 } },
      ];
      const result = translatePathAnchors(points, new Set([0]), 20, 10);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], {
        x: 30,
        y: 30,
        handleIn: { x: 25, y: 25 },
        handleOut: { x: 35, y: 35 },
      });
      // Comprueba inmutabilidad de la entrada
      assert.equal(points[0].x, 10);
      assert.equal(points[0].y, 20);
      assert.deepEqual(points[0].handleIn, { x: 5, y: 15 });
      assert.deepEqual(points[0].handleOut, { x: 15, y: 25 });
    });

    it('desplaza ancla sin handles', () => {
      const points: PathPoint[] = [{ x: 50, y: 60 }];
      const result = translatePathAnchors(points, new Set([0]), -10, 15);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], { x: 40, y: 75 });
      assert.equal(result[0].handleIn, undefined);
      assert.equal(result[0].handleOut, undefined);
      // Entrada sin cambios
      assert.equal(points[0].x, 50);
      assert.equal(points[0].y, 60);
    });

    it('índice no incluido queda intacto con la misma referencia', () => {
      const pt0: PathPoint = { x: 10, y: 20, handleIn: { x: 5, y: 15 }, handleOut: { x: 15, y: 25 } };
      const pt1: PathPoint = { x: 100, y: 200, handleIn: { x: 80, y: 190 }, handleOut: { x: 120, y: 210 } };
      const points: PathPoint[] = [pt0, pt1];

      const result = translatePathAnchors(points, new Set([0]), 15, -5);

      assert.equal(result.length, 2);
      assert.notEqual(result[0], pt0);
      assert.equal(result[0].x, 25);
      assert.equal(result[0].y, 15);
      // pt1 no fue seleccionado, debe conservar exactamente la misma referencia
      assert.equal(result[1], pt1);
    });
  });

  describe('b) Integración: arrastre de ancla con direct-select y undo', () => {
    it('desplaza ancla, handleIn y handleOut por (+20, +10) y un solo undo restaura todo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-direct-select-test',
        type: 'path',
        name: 'Direct Select Test Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleIn: { x: 80, y: 90 }, handleOut: { x: 120, y: 110 } },
          { x: 200, y: 200, handleIn: { x: 180, y: 200 }, handleOut: { x: 220, y: 200 } },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');

      stateManager.selectNode('path-direct-select-test');

      // 1. Mousedown sobre el ancla 0 en (100, 100)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
      assert.equal(controller.draggedPointIndex, 0);
      assert.equal(controller.dragTarget?.type, 'anchor');

      // 2. Mousemove +20, +10 -> (120, 110)
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 110 });

      // 3. Mouseup en (120, 110)
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 120, clientY: 110 });

      // Verifica que x, y, handleIn y handleOut se desplazaron +20, +10
      const updatedPath = stateManager.findNode('path-direct-select-test') as Path;
      assert.equal(updatedPath.points[0].x, 120);
      assert.equal(updatedPath.points[0].y, 110);
      assert.deepEqual(updatedPath.points[0].handleIn, { x: 100, y: 100 });
      assert.deepEqual(updatedPath.points[0].handleOut, { x: 140, y: 120 });

      // El punto 1 no debe haberse modificado
      assert.deepEqual(updatedPath.points[1], path.points[1]);

      // Verifica que UN solo undo restaura todo
      assert.equal(commandManager.canUndo(), true);
      commandManager.undo();

      const restoredPath = stateManager.findNode('path-direct-select-test') as Path;
      assert.equal(restoredPath.points[0].x, 100);
      assert.equal(restoredPath.points[0].y, 100);
      assert.deepEqual(restoredPath.points[0].handleIn, { x: 80, y: 90 });
      assert.deepEqual(restoredPath.points[0].handleOut, { x: 120, y: 110 });

      controller.destroy();
    });
  });

  describe('c) getVisiblePathHandles', () => {
    it('trazado abierto: expone handles del ancla y adyacentes omitiendo fuera de rango', () => {
      const path: Path = {
        id: 'open-path',
        type: 'path',
        name: 'Open Path',
        x: 0,
        y: 0,
        closed: false,
        points: [
          { x: 0, y: 0, handleIn: { x: -10, y: 0 }, handleOut: { x: 10, y: 0 } },
          { x: 50, y: 50, handleIn: { x: 40, y: 50 }, handleOut: { x: 60, y: 50 } },
          { x: 100, y: 100, handleIn: { x: 90, y: 100 }, handleOut: { x: 110, y: 100 } },
        ],
      };

      // Selección en ancla central (índice 1): debe tener handleIn(1), handleOut(1), handleOut(0) y handleIn(2)
      const handles1 = getVisiblePathHandles(path, new Set([1]));
      assert.equal(handles1.length, 4);
      assert.ok(handles1.some((h) => h.index === 1 && h.type === 'handleIn' && h.x === 40 && h.y === 50));
      assert.ok(handles1.some((h) => h.index === 1 && h.type === 'handleOut' && h.x === 60 && h.y === 50));
      assert.ok(handles1.some((h) => h.index === 0 && h.type === 'handleOut' && h.x === 10 && h.y === 0));
      assert.ok(handles1.some((h) => h.index === 2 && h.type === 'handleIn' && h.x === 90 && h.y === 100));

      // Selección en ancla 0 (inicial): handleOut(-1) no existe al ser abierto (omite fuera de rango)
      const handles0 = getVisiblePathHandles(path, new Set([0]));
      assert.equal(handles0.length, 3);
      assert.ok(handles0.some((h) => h.index === 0 && h.type === 'handleIn'));
      assert.ok(handles0.some((h) => h.index === 0 && h.type === 'handleOut'));
      assert.ok(handles0.some((h) => h.index === 1 && h.type === 'handleIn'));
    });

    it('trazado cerrado con wrap: conecta extremos inicial y final', () => {
      const closedPath: Path = {
        id: 'closed-path',
        type: 'path',
        name: 'Closed Path',
        x: 0,
        y: 0,
        closed: true,
        points: [
          { x: 0, y: 0, handleIn: { x: -10, y: 0 }, handleOut: { x: 10, y: 0 } },
          { x: 50, y: 50, handleIn: { x: 40, y: 50 }, handleOut: { x: 60, y: 50 } },
          { x: 100, y: 100, handleIn: { x: 90, y: 100 }, handleOut: { x: 110, y: 100 } },
        ],
      };

      // Selección en ancla 0: al estar cerrado, i-1 hace wrap hacia el ancla 2 (handleOut(2))
      const handles0 = getVisiblePathHandles(closedPath, new Set([0]));
      assert.equal(handles0.length, 4);
      assert.ok(handles0.some((h) => h.index === 0 && h.type === 'handleIn'));
      assert.ok(handles0.some((h) => h.index === 0 && h.type === 'handleOut'));
      assert.ok(handles0.some((h) => h.index === 2 && h.type === 'handleOut' && h.x === 110 && h.y === 100));
      assert.ok(handles0.some((h) => h.index === 1 && h.type === 'handleIn' && h.x === 40 && h.y === 50));
    });

    it('manejador colapsado coincidente con su ancla o undefined es ignorado', () => {
      const pathWithCollapsed: Path = {
        id: 'collapsed-path',
        type: 'path',
        name: 'Collapsed Path',
        x: 0,
        y: 0,
        points: [
          // handleIn coincide exactamente con su ancla (50, 50) -> colapsado
          // handleOut definido en (70, 50) -> visible
          { x: 50, y: 50, handleIn: { x: 50, y: 50 }, handleOut: { x: 70, y: 50 } },
          // sin handleIn ni handleOut (undefined)
          { x: 150, y: 150 },
        ],
      };

      const handles = getVisiblePathHandles(pathWithCollapsed, new Set([0, 1]));
      assert.equal(handles.length, 1);
      assert.equal(handles[0].index, 0);
      assert.equal(handles[0].type, 'handleOut');
      assert.equal(handles[0].x, 70);
      assert.equal(handles[0].y, 50);
    });
  });

  describe('d) Selección de anclas interactiva en InputController', () => {
    it('clic selecciona ancla, Shift suma y clic en vacío limpia la selección', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-anchor-selection',
        type: 'path',
        name: 'Selection Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
          { x: 300, y: 300 },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');
      stateManager.selectNode('path-anchor-selection');

      // 1. Clic sin Shift en ancla 0 (100, 100) -> selección = {0}
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });
      assert.ok(controller.pathEditState);
      assert.equal(controller.pathEditState.pathId, 'path-anchor-selection');
      assert.equal(controller.pathEditState.selectedAnchors.size, 1);
      assert.ok(controller.pathEditState.selectedAnchors.has(0));

      // 2. Shift + clic en ancla 1 (200, 200) -> suma ancla 1 ({0, 1})
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200, shiftKey: true });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 200 });
      assert.equal(controller.pathEditState.selectedAnchors.size, 2);
      assert.ok(controller.pathEditState.selectedAnchors.has(0));
      assert.ok(controller.pathEditState.selectedAnchors.has(1));

      // 3. Clic en vacío (500, 500) -> limpia el conjunto
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 500, clientY: 500, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 500, clientY: 500 });
      assert.equal(controller.pathEditState, null);

      controller.destroy();
    });

    it('arrastre mueve 2 anclas seleccionadas a la vez con sus manejadores', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-multi-drag',
        type: 'path',
        name: 'Multi Drag Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleIn: { x: 80, y: 90 }, handleOut: { x: 120, y: 110 } },
          { x: 200, y: 200, handleIn: { x: 180, y: 200 }, handleOut: { x: 220, y: 200 } },
          { x: 300, y: 300, handleIn: { x: 280, y: 300 }, handleOut: { x: 320, y: 300 } },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');
      stateManager.selectNode('path-multi-drag');

      // Selecciona ancla 0
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });

      // Shift-clic selecciona ancla 1
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200, shiftKey: true });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 200 });

      assert.equal(controller.pathEditState?.selectedAnchors.size, 2);

      // Arrastra ancla 0 con desplazamiento (+20, +10)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 110 });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 120, clientY: 110 });

      const updated = stateManager.findNode('path-multi-drag') as Path;
      // Ancla 0 desplazada
      assert.equal(updated.points[0].x, 120);
      assert.equal(updated.points[0].y, 110);
      assert.deepEqual(updated.points[0].handleIn, { x: 100, y: 100 });
      assert.deepEqual(updated.points[0].handleOut, { x: 140, y: 120 });

      // Ancla 1 TAMBIÉN desplazada
      assert.equal(updated.points[1].x, 220);
      assert.equal(updated.points[1].y, 210);
      assert.deepEqual(updated.points[1].handleIn, { x: 200, y: 210 });
      assert.deepEqual(updated.points[1].handleOut, { x: 240, y: 210 });

      // Ancla 2 intacta
      assert.equal(updated.points[2].x, 300);
      assert.equal(updated.points[2].y, 300);
      assert.deepEqual(updated.points[2].handleIn, { x: 280, y: 300 });
      assert.deepEqual(updated.points[2].handleOut, { x: 320, y: 300 });

      // Undo restaura ambas
      commandManager.undo();
      const restored = stateManager.findNode('path-multi-drag') as Path;
      assert.equal(restored.points[0].x, 100);
      assert.equal(restored.points[1].x, 200);

      controller.destroy();
    });

    it('un manejador invisible no es golpeable', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-invisible-handle',
        type: 'path',
        name: 'Invisible Handle Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleOut: { x: 130, y: 100 } },
          { x: 200, y: 200, handleIn: { x: 170, y: 200 } },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');
      stateManager.selectNode('path-invisible-handle');

      // Sin anclas seleccionadas, el manejador en (130, 100) NO es visible y por tanto NO es golpeable
      const hitBefore = controller.findPathPointHit(path, 130, 100);
      assert.equal(hitBefore, null);

      // Al seleccionar el ancla 0, el manejador pasa a ser visible y golpeable
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });

      const hitAfter = controller.findPathPointHit(path, 130, 100);
      assert.deepEqual(hitAfter, { index: 0, type: 'handleOut' });

      controller.destroy();
    });
  });

  describe('e) RenderEngine con edición de nodos', () => {
    it('en herramienta select: dibuja solo bbox y tiradores, sin anclas', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;
      const path: Path = {
        id: 'p-render-select',
        type: 'path',
        name: 'Path Select',
        x: 0,
        y: 0,
        points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);
      stateManager.selectNode('p-render-select');

      const canvas = createMockCanvas();
      const engine = new RenderEngine(canvas, stateManager, {
        highDpi: false,
        pathEditProvider: () => null, // Modo select (sin edición de anclas)
      });
      engine.render();

      // En modo select para una sola figura: dibuja la bounding box y los 4 manejadores de esquina (al menos 5 strokeRect)
      const strokeRects = canvas.calls.filter((c) => c === 'strokeRect');
      assert.ok(strokeRects.length >= 5, 'Debe dibujar la bounding box y sus manejadores');
    });

    it('en herramienta direct-select: omite bbox y dibuja overlay con anclas y manejadores', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;
      const path: Path = {
        id: 'p-render-direct',
        type: 'path',
        name: 'Path Direct',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleOut: { x: 120, y: 100 } },
          { x: 200, y: 200, handleIn: { x: 180, y: 200 } },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);
      stateManager.selectNode('p-render-direct');

      const fillStyles: string[] = [];
      const canvas = createMockCanvas();
      const ctx = canvas.getContext('2d') as any;
      const origFillRect = ctx.fillRect;
      ctx.fillRect = () => {
        fillStyles.push(ctx.fillStyle);
        origFillRect();
      };

      const engine = new RenderEngine(canvas, stateManager, {
        highDpi: false,
        pathEditProvider: () => ({
          pathId: 'p-render-direct',
          selectedAnchors: new Set([0]),
        }),
      });
      engine.render();

      // Debe haber dibujado ambas anclas: una seleccionada (#0284c7) y una no seleccionada (#ffffff)
      assert.ok(fillStyles.includes('#0284c7'), 'El ancla 0 seleccionada debe rellenarse de azul #0284c7');
      assert.ok(fillStyles.includes('#ffffff'), 'El ancla 1 no seleccionada debe rellenarse de blanco #ffffff');

      // Se dibujan las líneas y círculos de manejadores visibles
      assert.ok(canvas.calls.includes('arc'), 'Debe dibujar círculo del manejador visible');
      assert.ok(canvas.calls.includes('lineTo'), 'Debe dibujar la línea conector del manejador visible');
    });
  });

  describe('f) Arrastre colineal de manejadores en nodos suaves', () => {
    it('mirrorHandleCollinear conserva la longitud original y refleja colinealmente', () => {
      const anchor = { x: 100, y: 100 };
      const dragged = { x: 100, y: 60 }; // vector (0, -40), len 40
      const oppositeInitial = { x: 150, y: 100 }; // opuesto inicial len 50 horizontal
      const mirrored = mirrorHandleCollinear(anchor, dragged, oppositeInitial);
      // El opuesto debe apuntar en (0, +1) con longitud 50 -> (100, 150)
      assert.ok(Math.abs(mirrored.x - 100) < 1e-6);
      assert.ok(Math.abs(mirrored.y - 150) < 1e-6);
    });

    it('isSmoothPoint identifica puntos suaves y descarta no colineales o incompletos', () => {
      // Suave: colineal y lados opuestos
      assert.equal(
        isSmoothPoint({
          x: 100,
          y: 100,
          handleIn: { x: 70, y: 100 },
          handleOut: { x: 150, y: 100 },
        }),
        true
      );
      // No suave: ángulo recto (90 grados)
      assert.equal(
        isSmoothPoint({
          x: 100,
          y: 100,
          handleIn: { x: 100, y: 70 },
          handleOut: { x: 150, y: 100 },
        }),
        false
      );
      // No suave: mismo lado
      assert.equal(
        isSmoothPoint({
          x: 100,
          y: 100,
          handleIn: { x: 120, y: 100 },
          handleOut: { x: 150, y: 100 },
        }),
        false
      );
      // No suave: falta un manejador
      assert.equal(
        isSmoothPoint({
          x: 100,
          y: 100,
          handleIn: { x: 70, y: 100 },
        }),
        false
      );
      // No suave: colapsado al ancla
      assert.equal(
        isSmoothPoint({
          x: 100,
          y: 100,
          handleIn: { x: 100, y: 100 },
          handleOut: { x: 150, y: 100 },
        }),
        false
      );
    });

    it('nodo suave arrastra el manejador opuesto conservando su longitud', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'smooth-path',
        type: 'path',
        name: 'Smooth Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleIn: { x: 70, y: 100 }, handleOut: { x: 150, y: 100 } },
          { x: 300, y: 300 },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');
      stateManager.selectNode('smooth-path');

      // Seleccionar ancla 0 para hacer visibles sus manejadores
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });

      // Arrastrar handleIn desde (70, 100) hacia (100, 70) (deltaX = +30, deltaY = -30)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 70, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 100, clientY: 70, altKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 70 });

      const updated = stateManager.findNode('smooth-path') as Path;
      assert.ok(updated.points[0].handleIn);
      assert.ok(updated.points[0].handleOut);

      // handleIn se movió a (100, 70)
      assert.ok(Math.abs(updated.points[0].handleIn.x - 100) < 1e-4);
      assert.ok(Math.abs(updated.points[0].handleIn.y - 70) < 1e-4);

      // handleOut se actualizó colinealmente conservando longitud 50 -> (100, 150)
      assert.ok(Math.abs(updated.points[0].handleOut.x - 100) < 1e-4);
      assert.ok(Math.abs(updated.points[0].handleOut.y - 150) < 1e-4);

      controller.destroy();
    });

    it('con Alt presionado rompe la simetría y no mueve el manejador opuesto', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'alt-path',
        type: 'path',
        name: 'Alt Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleIn: { x: 70, y: 100 }, handleOut: { x: 150, y: 100 } },
          { x: 300, y: 300 },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');
      stateManager.selectNode('alt-path');

      // Seleccionar ancla 0
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });

      // Arrastrar handleIn con Alt presionado
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 70, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 100, clientY: 70, altKey: true });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 70 });

      const updated = stateManager.findNode('alt-path') as Path;
      assert.ok(updated.points[0].handleIn);
      assert.ok(updated.points[0].handleOut);

      // handleIn se movió a (100, 70)
      assert.ok(Math.abs(updated.points[0].handleIn.x - 100) < 1e-4);
      assert.ok(Math.abs(updated.points[0].handleIn.y - 70) < 1e-4);

      // handleOut NO se movió (sigue intacto en 150, 100)
      assert.equal(updated.points[0].handleOut.x, 150);
      assert.equal(updated.points[0].handleOut.y, 100);

      controller.destroy();
    });

    it('nodo no suave no mueve el manejador opuesto', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      // Nodo con manejadores perpendiculares (no suave)
      const path: Path = {
        id: 'corner-path',
        type: 'path',
        name: 'Corner Path',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100, handleIn: { x: 100, y: 70 }, handleOut: { x: 150, y: 100 } },
          { x: 300, y: 300 },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('direct-select');
      stateManager.selectNode('corner-path');

      // Seleccionar ancla 0
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });

      // Arrastrar handleIn sin Alt
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 70, shiftKey: false });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 90, clientY: 60, altKey: false });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 90, clientY: 60 });

      const updated = stateManager.findNode('corner-path') as Path;
      assert.ok(updated.points[0].handleIn);
      assert.ok(updated.points[0].handleOut);

      // handleIn se movió a (90, 60)
      assert.ok(Math.abs(updated.points[0].handleIn.x - 90) < 1e-4);
      assert.ok(Math.abs(updated.points[0].handleIn.y - 60) < 1e-4);

      // handleOut permanece intacto en (150, 100)
      assert.equal(updated.points[0].handleOut.x, 150);
      assert.equal(updated.points[0].handleOut.y, 100);

      controller.destroy();
    });
  });

  describe('g) pathEditState derivado de selección en direct-select y Pluma', () => {
    it('a) Seleccionar un path con select, setTool("direct-select") -> pathEditState no es null, con pathId correcto y selectedAnchors vacío', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-select-to-direct',
        type: 'path',
        name: 'Path Select To Direct',
        x: 0,
        y: 0,
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
        stroke: '#000',
      };
      stateManager.addShape(layerId, path);
      stateManager.selectNode('path-select-to-direct');

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      // Por defecto está en 'select'
      const initialEditState = controller.pathEditState;
      assert.equal(initialEditState, null);

      // Cambiar a direct-select
      controller.setTool('direct-select');
      const editState = controller.pathEditState;
      assert.ok(editState);
      assert.equal(editState.pathId, 'path-select-to-direct');
      assert.equal(editState.selectedAnchors.size, 0);

      controller.destroy();
    });

    it('b) setTool("pen"), mousedown + mousemove arrastrando -> pathEditState.pathId === activePenPathId y selectedAnchors contiene el último índice; tras un segundo punto, contiene el nuevo índice y getVisiblePathHandles incluye el handleOut del punto anterior', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('pen');

      // 1. Mousedown y arrastre en primer punto (100, 100) -> (130, 100)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 130, clientY: 100 });

      assert.ok(controller.activePenPathId);
      assert.equal(controller.pathEditState?.pathId, controller.activePenPathId);
      assert.equal(controller.pathEditState?.selectedAnchors.size, 1);
      assert.ok(controller.pathEditState?.selectedAnchors.has(0));

      canvas.dispatchSimulatedEvent('mouseup', { clientX: 130, clientY: 100 });

      // 2. Mousedown y arrastre en segundo punto (200, 200) -> (230, 200)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 230, clientY: 200 });

      assert.equal(controller.pathEditState?.pathId, controller.activePenPathId);
      assert.equal(controller.pathEditState?.selectedAnchors.size, 1);
      assert.ok(controller.pathEditState?.selectedAnchors.has(1));

      // Verificar que getVisiblePathHandles incluye el handleOut del punto 0 y los del punto 1
      const activePath = stateManager.findNode(controller.activePenPathId!) as Path;
      const handles = getVisiblePathHandles(activePath, controller.pathEditState!.selectedAnchors);
      assert.ok(handles.some((h) => h.index === 0 && h.type === 'handleOut'), 'Debe incluir handleOut del punto anterior');
      assert.ok(handles.some((h) => h.index === 1), 'Debe incluir manejadores del punto vigente');

      controller.destroy();
    });

    it('c) finishActivePath() -> pathEditState null', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      controller.setTool('pen');

      canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 100 });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 120, clientY: 100 });

      assert.ok(controller.pathEditState !== null);

      controller.finishActivePath();
      assert.equal(controller.pathEditState, null);

      controller.destroy();
    });
  });
});

