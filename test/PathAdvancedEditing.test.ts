import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import {
  splitCubicBezier,
  evaluateCubicBezier,
  findNearestPointOnSegment,
  findNearestPointOnCubicBezier,
  findNearestPointOnPath,
  splitPathSegment,
  deletePathPointsFromPath,
  getPointType,
  applyPointType,
  syncOppositeHandle,
} from '../src/utils/geometry.ts';
import { InsertPathPointCommand } from '../src/commands/InsertPathPointCommand.ts';
import { DeletePathPointCommand } from '../src/commands/DeletePathPointCommand.ts';
import { UpdatePathPointTypeCommand } from '../src/commands/UpdatePathPointTypeCommand.ts';
import type { Path, PathPoint } from '../src/types/scene-graph.ts';

function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    rect: () => {},
    roundRect: () => {},
    strokeRect: () => {},
    ellipse: () => {},
    arc: () => {},
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };

  return {
    style: { cursor: 'default' },
    width: 1000,
    height: 800,
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
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('Edición avanzada de trazados Bézier (PathAdvancedEditing)', () => {
  describe('1. Algoritmo de De Casteljau y funciones geométricas puras', () => {
    it('evaluateCubicBezier evalúa fielmente puntos en t=0, t=0.5 y t=1', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 0, y: 100 };
      const p2 = { x: 100, y: 100 };
      const p3 = { x: 100, y: 0 };

      const pt0 = evaluateCubicBezier(p0, p1, p2, p3, 0);
      assert.deepEqual(pt0, { x: 0, y: 0 });

      const pt1 = evaluateCubicBezier(p0, p1, p2, p3, 1);
      assert.deepEqual(pt1, { x: 100, y: 0 });

      const ptMid = evaluateCubicBezier(p0, p1, p2, p3, 0.5);
      // En t=0.5: x = 0*0.125 + 0*0.375 + 100*0.375 + 100*0.125 = 50
      // y = 0*0.125 + 100*0.375 + 100*0.375 + 0*0.125 = 75
      assert.equal(ptMid.x, 50);
      assert.equal(ptMid.y, 75);
    });

    it('splitCubicBezier divide la curva Bézier cúbica preservando la forma exacta', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 20, y: 80 };
      const p2 = { x: 80, y: 80 };
      const p3 = { x: 100, y: 0 };

      const t = 0.5;
      const { left, right } = splitCubicBezier(p0, p1, p2, p3, t);

      // El punto de corte es el final de left y el inicio de right
      const midExpected = evaluateCubicBezier(p0, p1, p2, p3, t);
      assert.ok(Math.abs(left[3].x - midExpected.x) < 1e-9);
      assert.ok(Math.abs(left[3].y - midExpected.y) < 1e-9);
      assert.ok(Math.abs(right[0].x - midExpected.x) < 1e-9);
      assert.ok(Math.abs(right[0].y - midExpected.y) < 1e-9);

      // Verificamos que evaluar la mitad izquierda en tau=0.5 corresponde a evaluar la original en t=0.25
      const ptLeftMid = evaluateCubicBezier(left[0], left[1], left[2], left[3], 0.5);
      const ptOrigQuarter = evaluateCubicBezier(p0, p1, p2, p3, 0.25);
      assert.ok(Math.abs(ptLeftMid.x - ptOrigQuarter.x) < 1e-9);
      assert.ok(Math.abs(ptLeftMid.y - ptOrigQuarter.y) < 1e-9);

      // Verificamos que evaluar la mitad derecha en tau=0.5 corresponde a evaluar la original en t=0.75
      const ptRightMid = evaluateCubicBezier(right[0], right[1], right[2], right[3], 0.5);
      const ptOrigThreeQuarters = evaluateCubicBezier(p0, p1, p2, p3, 0.75);
      assert.ok(Math.abs(ptRightMid.x - ptOrigThreeQuarters.x) < 1e-9);
      assert.ok(Math.abs(ptRightMid.y - ptOrigThreeQuarters.y) < 1e-9);
    });

    it('findNearestPointOnSegment proyecta ortogonalmente y clampa a los extremos', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 100, y: 0 };

      // Punto sobre el segmento
      const projMid = findNearestPointOnSegment(p0, p1, 50, 10);
      assert.equal(projMid.t, 0.5);
      assert.deepEqual(projMid.point, { x: 50, y: 0 });
      assert.equal(projMid.distance, 10);

      // Punto antes de p0
      const projBefore = findNearestPointOnSegment(p0, p1, -20, 0);
      assert.equal(projBefore.t, 0);
      assert.deepEqual(projBefore.point, { x: 0, y: 0 });
      assert.equal(projBefore.distance, 20);

      // Punto después de p1
      const projAfter = findNearestPointOnSegment(p0, p1, 130, 0);
      assert.equal(projAfter.t, 1);
      assert.deepEqual(projAfter.point, { x: 100, y: 0 });
      assert.equal(projAfter.distance, 30);
    });

    it('findNearestPointOnCubicBezier aproxima con precisión el parámetro t más cercano', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 0, y: 100 };
      const p2 = { x: 100, y: 100 };
      const p3 = { x: 100, y: 0 };

      // Punto conocido en t=0.5 es (50, 75)
      const proj = findNearestPointOnCubicBezier(p0, p1, p2, p3, 50, 78);
      assert.ok(Math.abs(proj.t - 0.5) < 0.01);
      assert.ok(Math.abs(proj.distance - 3) < 0.05);
    });

    it('findNearestPointOnPath soporta rotación del trazado convirtiendo entre espacio mundo y local', () => {
      // Trazado horizontal de (0,0) a (100,0) rotado 90 grados alrededor de su centro (50,0)
      const path: Path = {
        id: 'test-path',
        type: 'path',
        name: 'Rotated Path',
        x: 0,
        y: 0,
        rotation: 90,
        closed: false,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      };

      // Centro del trazado: (50, 0). Rotado 90° horario:
      // (0,0) -> (50 + 0, 0 - 50) = (50, -50)
      // (100,0) -> (50 + 0, 0 + 50) = (50, 50)
      // Punto en el mundo cerca del centro: (52, 0)
      const result = findNearestPointOnPath(path, 52, 0);
      assert.ok(result !== null);
      assert.equal(result?.segmentIndex, 0);
      assert.ok(Math.abs(result.t - 0.5) < 0.05);
      assert.ok(Math.abs(result.distance - 2) < 0.05);
    });
  });

  describe('2. Inserción de vértices con splitPathSegment y StateManager.insertPathPoint', () => {
    it('inserta vértice en segmento recto intercalando coordenadas y actualizando puntos', () => {
      const path: Path = {
        id: 'p1',
        type: 'path',
        name: 'Path 1',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      const newPoints = splitPathSegment(path, 0, 0.4);
      assert.equal(newPoints.length, 3);
      assert.deepEqual(newPoints[0], { x: 0, y: 0 });
      assert.equal(newPoints[1].x, 40);
      assert.equal(newPoints[1].y, 40);
      assert.deepEqual(newPoints[2], { x: 100, y: 100 });
    });

    it('inserta vértice en curva cúbica calculando los handles de De Casteljau', () => {
      const path: Path = {
        id: 'p2',
        type: 'path',
        name: 'Curved Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0, handleOut: { x: 0, y: 100 } },
          { x: 100, y: 0, handleIn: { x: 100, y: 100 } },
        ],
      };

      const newPoints = splitPathSegment(path, 0, 0.5);
      assert.equal(newPoints.length, 3);
      // El punto insertado está en el índice 1
      const inserted = newPoints[1];
      assert.equal(inserted.x, 50);
      assert.equal(inserted.y, 75);
      assert.ok(inserted.handleIn !== undefined);
      assert.ok(inserted.handleOut !== undefined);
      // El handleOut del primer punto debe haberse actualizado
      assert.equal(newPoints[0].handleOut?.x, 0);
      assert.equal(newPoints[0].handleOut?.y, 50);
      // El handleIn del último punto debe haberse actualizado
      assert.equal(newPoints[2].handleIn?.x, 100);
      assert.equal(newPoints[2].handleIn?.y, 50);
    });

    it('inserta vértice en el segmento de cierre de un trazado cerrado', () => {
      const path: Path = {
        id: 'p-closed',
        type: 'path',
        name: 'Closed Triangle',
        x: 0,
        y: 0,
        closed: true,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 50, y: 100 },
        ],
      };

      // Segmento 2 une punto 2 (50, 100) con punto 0 (0, 0)
      const newPoints = splitPathSegment(path, 2, 0.5);
      assert.equal(newPoints.length, 4);
      // El nuevo punto se inserta al final
      const inserted = newPoints[3];
      assert.equal(inserted.x, 25);
      assert.equal(inserted.y, 50);
    });

    it('StateManager.insertPathPoint muta inmutablemente y soporta Undo/Redo vía InsertPathPointCommand', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const path: Path = {
        id: 'test-insert-state',
        type: 'path',
        name: 'Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);

      const initialPoints = path.points;
      const finalPoints = splitPathSegment(path, 0, 0.3);

      const cmd = new InsertPathPointCommand(
        stateManager,
        path.id,
        initialPoints,
        finalPoints,
        1,
        0,
        0.3
      );
      commandManager.executeCommand(cmd);

      let currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points.length, 3);
      assert.equal(currentPath.points[1].x, 30);

      // Undo
      commandManager.undo();
      currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points.length, 2);
      assert.equal(currentPath.points[1].x, 100);

      // Redo
      commandManager.redo();
      currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points.length, 3);
      assert.equal(currentPath.points[1].x, 30);
    });
  });

  describe('3. Eliminación de nodos sin romper el trazado (deletePathPointsFromPath y DeletePathPointCommand)', () => {
    it('elimina un punto intermedio reconectando los puntos adyacentes', () => {
      const path: Path = {
        id: 'del-1',
        type: 'path',
        name: 'Path 3 points',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0, handleOut: { x: 20, y: 0 } },
          { x: 50, y: 50, handleIn: { x: 30, y: 50 }, handleOut: { x: 70, y: 50 } },
          { x: 100, y: 0, handleIn: { x: 80, y: 0 } },
        ],
      };

      const result = deletePathPointsFromPath(path, [1]);
      assert.ok(result !== null);
      assert.equal(result?.length, 2);
      assert.deepEqual(result?.[0], { x: 0, y: 0, handleOut: { x: 20, y: 0 } });
      assert.deepEqual(result?.[1], { x: 100, y: 0, handleIn: { x: 80, y: 0 } });
    });

    it('elimina un punto en un trazado cerrado preservando el cierre', () => {
      const path: Path = {
        id: 'del-closed',
        type: 'path',
        name: 'Closed square',
        x: 0,
        y: 0,
        closed: true,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      };

      const result = deletePathPointsFromPath(path, [2]);
      assert.ok(result !== null);
      assert.equal(result?.length, 3);
      assert.deepEqual(result?.map((p) => ({ x: p.x, y: p.y })), [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]);
    });

    it('no permite eliminar puntos si el resultado tuviera menos de 2 puntos', () => {
      const path: Path = {
        id: 'del-min',
        type: 'path',
        name: 'Path 2 points',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      const result = deletePathPointsFromPath(path, [0]);
      assert.equal(result, null);
    });

    it('DeletePathPointCommand soporta Undo/Redo preservando handles originales', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const path: Path = {
        id: 'test-del-cmd',
        type: 'path',
        name: 'Path for Delete',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 25, handleIn: { x: 40, y: 20 }, handleOut: { x: 60, y: 30 } },
          { x: 100, y: 0 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);

      const initialPoints = path.points;
      const finalPoints = deletePathPointsFromPath(path, [1])!;

      const cmd = new DeletePathPointCommand(
        stateManager,
        path.id,
        initialPoints,
        finalPoints,
        [1]
      );
      commandManager.executeCommand(cmd);

      let currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points.length, 2);

      // Deshacer restaura el punto intermedio con sus handles
      commandManager.undo();
      currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points.length, 3);
      assert.deepEqual(currentPath.points[1], {
        x: 50,
        y: 25,
        handleIn: { x: 40, y: 20 },
        handleOut: { x: 60, y: 30 },
      });

      // Rehacer vuelve a eliminarlo
      commandManager.redo();
      currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points.length, 2);
    });
  });

  describe('4. Tipos de vértice (Corner, Smooth, Symmetric)', () => {
    it('getPointType clasifica corner, smooth y symmetric correctamente', () => {
      // 1. Sin handles o no colineales -> corner
      const cornerPt1: PathPoint = { x: 50, y: 50 };
      assert.equal(getPointType(cornerPt1), 'corner');

      const cornerPt2: PathPoint = {
        x: 50,
        y: 50,
        handleIn: { x: 30, y: 50 },
        handleOut: { x: 50, y: 70 }, // Ángulo de 90°
      };
      assert.equal(getPointType(cornerPt2), 'corner');

      // 2. Colineales con longitudes distintas -> smooth
      const smoothPt: PathPoint = {
        x: 50,
        y: 50,
        handleIn: { x: 30, y: 50 },  // len = 20
        handleOut: { x: 90, y: 50 }, // len = 40 (180° opuesto)
      };
      assert.equal(getPointType(smoothPt), 'smooth');

      // 3. Colineales con idéntica longitud -> symmetric
      const symmetricPt: PathPoint = {
        x: 50,
        y: 50,
        handleIn: { x: 30, y: 50 },  // len = 20
        handleOut: { x: 70, y: 50 }, // len = 20
      };
      assert.equal(getPointType(symmetricPt), 'symmetric');
    });

    it('applyPointType transforma los handles adecuadamente según el tipo', () => {
      const pt: PathPoint = {
        x: 50,
        y: 50,
        handleIn: { x: 30, y: 50 },  // len = 20
        handleOut: { x: 50, y: 90 }, // len = 40, no colineal
      };

      // A 'corner': conserva handles pero asigna pointType
      const corner = applyPointType(pt, 'corner');
      assert.equal(corner.pointType, 'corner');
      assert.deepEqual(corner.handleIn, { x: 30, y: 50 });
      assert.deepEqual(corner.handleOut, { x: 50, y: 90 });

      // A 'smooth': alinea handleIn opuesto a handleOut manteniendo sus longitudes respectivas
      const smooth = applyPointType(pt, 'smooth');
      assert.equal(smooth.pointType, 'smooth');
      assert.deepEqual(smooth.handleIn, { x: 50, y: 30 });
      assert.deepEqual(smooth.handleOut, { x: 50, y: 90 });

      // A 'symmetric': alinea a 180° y promedia o iguala longitudes (targetLen = 30)
      const symm = applyPointType(pt, 'symmetric');
      assert.equal(symm.pointType, 'symmetric');
      assert.equal(symm.handleIn?.x, 50);
      assert.equal(symm.handleIn?.y, 20);
      assert.equal(symm.handleOut?.x, 50);
      assert.equal(symm.handleOut?.y, 80);
    });

    it('syncOppositeHandle sincroniza según el pointType al arrastrar un handle', () => {
      const anchor = { x: 50, y: 50 };
      const dragged = { x: 10, y: 50 }; // len = 40
      const oppositeInitial = { x: 70, y: 50 }; // len = 20

      // Modo 'corner': no altera el opuesto
      const oppCorner = syncOppositeHandle(anchor, dragged, oppositeInitial, 'corner');
      assert.deepEqual(oppCorner, oppositeInitial);

      // Modo 'smooth': gira 180° opuesto pero mantiene longitud original (20)
      const oppSmooth = syncOppositeHandle(anchor, dragged, oppositeInitial, 'smooth');
      assert.equal(oppSmooth.x, 70); // 50 + 20
      assert.equal(oppSmooth.y, 50);

      // Modo 'symmetric': gira 180° opuesto e iguala longitud a la del arrastrado (40)
      const oppSymm = syncOppositeHandle(anchor, dragged, oppositeInitial, 'symmetric');
      assert.equal(oppSymm.x, 90); // 50 + 40
      assert.equal(oppSymm.y, 50);
    });

    it('UpdatePathPointTypeCommand conmuta tipos con soporte de Undo/Redo', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();

      const path: Path = {
        id: 'test-type-cmd',
        type: 'path',
        name: 'Type Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50, handleIn: { x: 30, y: 50 }, handleOut: { x: 50, y: 90 } },
          { x: 100, y: 100 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);

      const initialPoints = path.points;
      const finalPoints = path.points.map((pt, i) =>
        i === 1 ? applyPointType(pt, 'smooth') : pt
      );

      const cmd = new UpdatePathPointTypeCommand(
        stateManager,
        path.id,
        initialPoints,
        finalPoints,
        [1],
        'smooth'
      );
      commandManager.executeCommand(cmd);

      let currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points[1].pointType, 'smooth');
      assert.deepEqual(currentPath.points[1].handleIn, { x: 50, y: 30 });
      assert.deepEqual(currentPath.points[1].handleOut, { x: 50, y: 90 });

      // Undo
      commandManager.undo();
      currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points[1].pointType, undefined);
      assert.deepEqual(currentPath.points[1].handleOut, { x: 50, y: 90 });

      // Redo
      commandManager.redo();
      currentPath = stateManager.findNode(path.id) as Path;
      assert.equal(currentPath.points[1].pointType, 'smooth');
      assert.deepEqual(currentPath.points[1].handleIn, { x: 50, y: 30 });
      assert.deepEqual(currentPath.points[1].handleOut, { x: 50, y: 90 });
    });
  });

  describe('5. Interacciones con InputController en DirectSelect y Pen', () => {
    it('muestra cursor copy cuando el ratón pasa cerca de un segmento del trazado seleccionado', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);

      const path: Path = {
        id: 'path-hover',
        type: 'path',
        name: 'Hover Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        points: [
          { x: 10, y: 100 },
          { x: 200, y: 100 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);
      stateManager.selectNode(path.id);

      controller.setTool('direct-select');

      // Movimiento sobre el segmento en (100, 102) -> distancia 2px <= 6px
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 100,
        clientY: 102,
        shiftKey: false,
        altKey: false,
      });

      assert.equal(canvas.style.cursor, 'copy');

      // Movimiento lejos del segmento en (100, 150) -> distancia 50px > 6px
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 100,
        clientY: 150,
        shiftKey: false,
        altKey: false,
      });

      assert.equal(canvas.style.cursor, 'default');
    });

    it('clic mientras hace hover inserta un nuevo vértice en el trazado seleccionado', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);

      const path: Path = {
        id: 'path-click-insert',
        type: 'path',
        name: 'Click Insert Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        points: [
          { x: 0, y: 100 },
          { x: 200, y: 100 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);
      stateManager.selectNode(path.id);

      controller.setTool('direct-select');

      // Pasa el ratón a la mitad del segmento (100, 100)
      canvas.dispatchSimulatedEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        shiftKey: false,
        altKey: false,
      });
      assert.equal(canvas.style.cursor, 'copy');

      // Clic
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        button: 0,
        shiftKey: false,
        altKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 100,
        clientY: 100,
        button: 0,
      });

      const updatedPath = stateManager.findNode(path.id) as Path;
      assert.equal(updatedPath.points.length, 3);
      assert.equal(updatedPath.points[1].x, 100);
      assert.equal(updatedPath.points[1].y, 100);

      // Deshacer revierte la inserción
      commandManager.undo();
      const revertedPath = stateManager.findNode(path.id) as Path;
      assert.equal(revertedPath.points.length, 2);
    });

    it('Alt+clic sobre un vértice existente en direct-select lo elimina sin romper el trazado', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);

      const path: Path = {
        id: 'path-alt-del',
        type: 'path',
        name: 'Alt Delete Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);
      stateManager.selectNode(path.id);

      controller.setTool('direct-select');

      // Alt+clic sobre el vértice central (50, 50)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
        altKey: true,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
      });

      const updatedPath = stateManager.findNode(path.id) as Path;
      assert.equal(updatedPath.points.length, 2);
      assert.equal(updatedPath.points[0].x, 0);
      assert.equal(updatedPath.points[1].x, 100);

      // Deshacer restaura el vértice eliminado
      commandManager.undo();
      const restoredPath = stateManager.findNode(path.id) as Path;
      assert.equal(restoredPath.points.length, 3);
    });

    it('doble clic sobre un vértice conmuta cíclicamente su tipo (corner -> smooth -> symmetric)', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);

      const path: Path = {
        id: 'path-dblclick-toggle',
        type: 'path',
        name: 'DblClick Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 100 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);
      stateManager.selectNode(path.id);

      controller.setTool('direct-select');

      // Primer clic sobre el vértice (50, 50)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
        altKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
      });

      // Segundo clic inmediato sobre el mismo vértice (doble clic)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
        altKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
      });

      let updatedPath = stateManager.findNode(path.id) as Path;
      // Estaba en corner -> conmuta a smooth
      assert.equal(updatedPath.points[1].pointType, 'smooth');

      // Siguiente doble clic rápido: conmuta a symmetric
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
        altKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
      });
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
        altKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
      });

      updatedPath = stateManager.findNode(path.id) as Path;
      assert.equal(updatedPath.points[1].pointType, 'symmetric');
    });

    it('tecla Supr / Delete con anclas seleccionadas elimina los anclas sin borrar la figura entera', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);

      const path: Path = {
        id: 'path-key-del',
        type: 'path',
        name: 'Key Del Path',
        x: 0,
        y: 0,
        closed: false,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
      };

      const layer = stateManager.getState().children[0];
      stateManager.addShape(layer.id, path);
      stateManager.selectNode(path.id);

      controller.setTool('direct-select');

      // Selecciona el ancla central (50, 50) con un clic
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        shiftKey: false,
        altKey: false,
      });
      canvas.dispatchSimulatedEvent('mouseup', {
        clientX: 50,
        clientY: 50,
        button: 0,
      });

      // Se presiona Supr
      controller.deleteSelected();

      const updatedPath = stateManager.findNode(path.id) as Path;
      assert.ok(updatedPath !== null);
      assert.equal(updatedPath.points.length, 2);
      assert.equal(updatedPath.points[0].x, 0);
      assert.equal(updatedPath.points[1].x, 100);
    });
  });
});
