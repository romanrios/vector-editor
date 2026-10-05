import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TransformShapesCommand } from '../src/commands/TransformShapesCommand.ts';
import type { ShapeDimensions } from '../src/commands/ResizeCommand.ts';
import type { AABB, Ellipse, Group, Layer, Path, Rectangle, Shape } from '../src/types/scene-graph.ts';
import { isGroup } from '../src/types/scene-graph.ts';
import {
  computeBoxScale,
  computeRotationDelta,
  getLeafShapes,
  getPathBaseAABB,
  getSelectionBounds,
  getSelectionBoxHandles,
} from '../src/utils/geometry.ts';
import {
  rotateShapesAboutPivot,
  scaleShapesAboutAnchor,
} from '../src/utils/transform.ts';

describe('Transformaciones de Conjuntos (Escalado y Rotación)', () => {
  it('Rotar rectángulo, elipse y trazado 90° alrededor de un pivote; cuatro giros de 90° vuelven a la posición original (tolerancia 1e-9)', () => {
    const pivot = { x: 150, y: 150 };
    const stepDelta = computeRotationDelta(pivot, { x: 150, y: 100 }, { x: 200, y: 150 }, true);
    assert.equal(stepDelta, 90);

    const initialRect: Rectangle = {
      id: 'rect-1',
      type: 'rectangle',
      name: 'Rect',
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      rotation: 0,
    };

    const initialEllipse: Ellipse = {
      id: 'ellipse-1',
      type: 'ellipse',
      name: 'Ellipse',
      x: 200,
      y: 120,
      radiusX: 30,
      radiusY: 20,
      rotation: 0,
    };

    const initialPath: Path = {
      id: 'path-1',
      type: 'path',
      name: 'Path',
      x: 60,
      y: 70,
      points: [
        { x: 60, y: 70, handleOut: { x: 80, y: 60 } },
        { x: 120, y: 90, handleIn: { x: 100, y: 110 } },
      ],
      rotation: 0,
    };

    let currentShapes: Shape[] = [initialRect, initialEllipse, initialPath];

    for (let step = 0; step < 4; step++) {
      const changes = rotateShapesAboutPivot(currentShapes, pivot, 90);
      assert.equal(changes.length, 3);
      currentShapes = currentShapes.map((shape) => {
        const change = changes.find((c) => c.id === shape.id);
        if (!change) return shape;
        return {
          ...shape,
          ...change.dimensions,
        } as Shape;
      });
    }

    const finalRect = currentShapes[0] as Rectangle;
    const finalEllipse = currentShapes[1] as Ellipse;
    const finalPath = currentShapes[2] as Path;

    // Tolerancia 1e-9
    assert(Math.abs(finalRect.x - initialRect.x) < 1e-9, `rect x drift: ${finalRect.x} vs ${initialRect.x}`);
    assert(Math.abs(finalRect.y - initialRect.y) < 1e-9, `rect y drift: ${finalRect.y} vs ${initialRect.y}`);
    assert(Math.abs(finalRect.width - initialRect.width) < 1e-9);
    assert(Math.abs(finalRect.height - initialRect.height) < 1e-9);
    assert(Math.abs((finalRect.rotation ?? 0) - (initialRect.rotation ?? 0)) < 1e-9);

    assert(Math.abs(finalEllipse.x - initialEllipse.x) < 1e-9, `ellipse x drift: ${finalEllipse.x} vs ${initialEllipse.x}`);
    assert(Math.abs(finalEllipse.y - initialEllipse.y) < 1e-9, `ellipse y drift: ${finalEllipse.y} vs ${initialEllipse.y}`);
    assert(Math.abs(finalEllipse.radiusX - initialEllipse.radiusX) < 1e-9);
    assert(Math.abs(finalEllipse.radiusY - initialEllipse.radiusY) < 1e-9);
    assert(Math.abs((finalEllipse.rotation ?? 0) - (initialEllipse.rotation ?? 0)) < 1e-9);

    assert(Math.abs(finalPath.x - initialPath.x) < 1e-9, `path x drift: ${finalPath.x} vs ${initialPath.x}`);
    assert(Math.abs(finalPath.y - initialPath.y) < 1e-9, `path y drift: ${finalPath.y} vs ${initialPath.y}`);
    assert(Math.abs((finalPath.rotation ?? 0) - (initialPath.rotation ?? 0)) < 1e-9);
    for (let p = 0; p < initialPath.points.length; p++) {
      const initPt = initialPath.points[p];
      const curPt = finalPath.points[p];
      assert(Math.abs(curPt.x - initPt.x) < 1e-9);
      assert(Math.abs(curPt.y - initPt.y) < 1e-9);
      if (initPt.handleIn && curPt.handleIn) {
        assert(Math.abs(curPt.handleIn.x - initPt.handleIn.x) < 1e-9);
        assert(Math.abs(curPt.handleIn.y - initPt.handleIn.y) < 1e-9);
      }
      if (initPt.handleOut && curPt.handleOut) {
        assert(Math.abs(curPt.handleOut.x - initPt.handleOut.x) < 1e-9);
        assert(Math.abs(curPt.handleOut.y - initPt.handleOut.y) < 1e-9);
      }
    }
  });

  it('Rotar un grupo anidado', () => {
    const sm = new StateManager();
    const layerId = sm.getState().children[0].id;

    // Crear grupo anidado: layer -> groupOuter -> groupInner -> [r1, r2]
    const r1: Rectangle = {
      id: 'r1',
      type: 'rectangle',
      name: 'R1',
      x: 10,
      y: 10,
      width: 40,
      height: 20,
    };
    const r2: Rectangle = {
      id: 'r2',
      type: 'rectangle',
      name: 'R2',
      x: 70,
      y: 10,
      width: 40,
      height: 20,
    };
    const groupInner: Group = {
      id: 'group-inner',
      type: 'group',
      name: 'Inner Group',
      children: [r1, r2],
    };
    const groupOuter: Group = {
      id: 'group-outer',
      type: 'group',
      name: 'Outer Group',
      children: [groupInner],
    };

    sm.addNode(layerId, groupOuter);

    const leafShapes = getLeafShapes([groupOuter]);
    assert.equal(leafShapes.length, 2);

    const bounds = getSelectionBounds([groupOuter])!;
    assert(bounds !== null);
    const pivot = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };

    const changes = rotateShapesAboutPivot(leafShapes, pivot, 90);
    assert.equal(changes.length, 2);

    const updated = sm.updateShapesDimensions(changes);
    assert.equal(updated, true);

    const updatedR1 = sm.findNode('r1') as Rectangle;
    const updatedR2 = sm.findNode('r2') as Rectangle;
    assert.equal(updatedR1.rotation, 90);
    assert.equal(updatedR2.rotation, 90);

    const outerNode = sm.findNode('group-outer') as Group;
    const innerNode = sm.findNode('group-inner') as Group;
    assert(isGroup(outerNode));
    assert(isGroup(innerNode));
    assert.equal(innerNode.children.length, 2);
  });

  it('Escala proporcional con una figura rotada 30°: exacta', () => {
    const rect: Rectangle = {
      id: 'rect-30',
      type: 'rectangle',
      name: 'Rotated Rect',
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      rotation: 30,
    };

    const anchor = { x: 100, y: 100 };
    // Escala proporcional sx = 2, sy = 2
    const changes = scaleShapesAboutAnchor([rect], anchor, 2, 2);
    assert.equal(changes.length, 1);

    const dims = changes[0].dimensions;
    // lx = hypot(2*cos(30°), 2*sin(30°)) = 2 exacta
    // ly = hypot(2*sin(30°), 2*cos(30°)) = 2 exacta
    assert.equal(dims.width, 160);
    assert.equal(dims.height, 80);
    assert.equal(dims.rotation, 30);

    // Centro original: c = (100 + 40, 100 + 20) = (140, 120)
    // Nuevo centro: anchor + 2*(c - anchor) = (100 + 80, 100 + 40) = (180, 140)
    // newX = 180 - 160/2 = 100
    // newY = 140 - 80/2 = 100
    assert.equal(dims.x, 100);
    assert.equal(dims.y, 100);
  });

  it('Escala no uniforme con 0° y 90°: exacta; el trazado conserva sus manejadores', () => {
    const anchor = { x: 0, y: 0 };
    const sx = 2;
    const sy = 3;

    // 1. Trazado a 0° con escala no uniforme
    const path0: Path = {
      id: 'path-0',
      type: 'path',
      name: 'Path 0',
      x: 10,
      y: 10,
      points: [
        { x: 10, y: 10, handleOut: { x: 15, y: 20 } },
        { x: 30, y: 40, handleIn: { x: 25, y: 35 } },
      ],
      rotation: 0,
    };

    const changes0 = scaleShapesAboutAnchor([path0], anchor, sx, sy);
    assert.equal(changes0.length, 1);
    const dims0 = changes0[0].dimensions;
    assert.equal(dims0.rotation, 0);

    // Con theta = 0: lx = sx = 2, ly = sy = 3
    const pts0 = dims0.points!;
    assert.equal(pts0.length, 2);
    // Comprobar conservación y escala exacta de manejadores
    assert(pts0[0].handleOut !== undefined);
    assert(pts0[1].handleIn !== undefined);

    const baseAABB0 = getPathBaseAABB(path0);
    const c0 = {
      x: (baseAABB0.minX + baseAABB0.maxX) / 2,
      y: (baseAABB0.minY + baseAABB0.maxY) / 2,
    };
    const newC0 = { x: anchor.x + (c0.x - anchor.x) * sx, y: anchor.y + (c0.y - anchor.y) * sy };

    const expectedHOutX = newC0.x + (15 - c0.x) * 2;
    const expectedHOutY = newC0.y + (20 - c0.y) * 3;
    assert(Math.abs(pts0[0].handleOut!.x - expectedHOutX) < 1e-9);
    assert(Math.abs(pts0[0].handleOut!.y - expectedHOutY) < 1e-9);

    // 2. Rectángulo a 90° con escala no uniforme
    const rect90: Rectangle = {
      id: 'rect-90',
      type: 'rectangle',
      name: 'Rect 90',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      rotation: 90,
    };

    // Con theta = 90°: lx = hypot(0, sy*1) = 3, ly = hypot(sx*1, 0) = 2
    const changes90 = scaleShapesAboutAnchor([rect90], anchor, sx, sy);
    assert.equal(changes90.length, 1);
    const dims90 = changes90[0].dimensions;
    assert.equal(dims90.width, 100 * 3);
    assert.equal(dims90.height, 50 * 2);
    assert.equal(dims90.rotation, 90);

    // 3. Trazado a 90° conserva sus manejadores
    const path90: Path = {
      id: 'path-90',
      type: 'path',
      name: 'Path 90',
      x: 10,
      y: 10,
      points: [
        { x: 10, y: 10, handleOut: { x: 15, y: 20 } },
        { x: 30, y: 40, handleIn: { x: 25, y: 35 } },
      ],
      rotation: 90,
    };
    const changesPath90 = scaleShapesAboutAnchor([path90], anchor, sx, sy);
    const pts90 = changesPath90[0].dimensions.points!;
    assert(pts90[0].handleOut !== undefined);
    assert(pts90[1].handleIn !== undefined);
  });

  it('computeBoxScale desde las 4 esquinas, con Shift y con el mínimo de 5 px', () => {
    const bounds: AABB = {
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 120,
      width: 100,
      height: 100,
    };

    const handles = getSelectionBoxHandles(bounds);
    assert.equal(handles.length, 5);
    assert.equal(handles[0].type, 'top-left');
    assert.equal(handles[1].type, 'top-right');
    assert.equal(handles[2].type, 'bottom-right');
    assert.equal(handles[3].type, 'bottom-left');
    assert.equal(handles[4].type, 'rotation-handle');

    // 1. Esquina top-left: ancla en bottom-right (maxX, maxY)
    const tl = computeBoxScale(bounds, 'top-left', -20, -30, false);
    assert.deepEqual(tl.anchor, { x: 110, y: 120 });
    assert.equal(tl.sx, (100 - (-20)) / 100); // 1.2
    assert.equal(tl.sy, (100 - (-30)) / 100); // 1.3

    // 2. Esquina top-right: ancla en bottom-left (minX, maxY)
    const tr = computeBoxScale(bounds, 'top-right', 20, -30, false);
    assert.deepEqual(tr.anchor, { x: 10, y: 120 });
    assert.equal(tr.sx, (100 + 20) / 100); // 1.2
    assert.equal(tr.sy, (100 - (-30)) / 100); // 1.3

    // 3. Esquina bottom-right: ancla en top-left (minX, minY)
    const br = computeBoxScale(bounds, 'bottom-right', 20, 30, false);
    assert.deepEqual(br.anchor, { x: 10, y: 20 });
    assert.equal(br.sx, (100 + 20) / 100); // 1.2
    assert.equal(br.sy, (100 + 30) / 100); // 1.3

    // 4. Esquina bottom-left: ancla en top-right (maxX, minY)
    const bl = computeBoxScale(bounds, 'bottom-left', -20, 30, false);
    assert.deepEqual(bl.anchor, { x: 110, y: 20 });
    assert.equal(bl.sx, (100 - (-20)) / 100); // 1.2
    assert.equal(bl.sy, (100 + 30) / 100); // 1.3

    // 5. Con Shift (preserveAspect: true): sx === sy
    const shiftScale = computeBoxScale(bounds, 'bottom-right', 50, 10, true);
    assert.equal(shiftScale.sx, shiftScale.sy);
    assert.equal(shiftScale.sx, 1.5); // Domina rawSx = 150/100 = 1.5

    // 6. Mínimo de 5 px para el conjunto (sin colapsar por debajo de 5 px)
    const minNoShift = computeBoxScale(bounds, 'bottom-right', -200, -200, false);
    assert.equal(bounds.width * minNoShift.sx, 5);
    assert.equal(bounds.height * minNoShift.sy, 5);

    const minWithShift = computeBoxScale(bounds, 'bottom-right', -200, -200, true);
    assert.equal(bounds.width * minWithShift.sx, 5);
    assert.equal(bounds.height * minWithShift.sy, 5);
  });

  it('updateShapesDimensions: una sola notificación y estructura compartida', () => {
    const sm = new StateManager();
    const l1Id = sm.getState().children[0].id;
    const l2: Layer = {
      id: 'layer-2',
      type: 'layer',
      name: 'Layer 2',
      children: [],
    };
    sm.addLayer(l2);

    const r1: Rectangle = {
      id: 'r1',
      type: 'rectangle',
      name: 'R1',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    };
    const r2: Rectangle = {
      id: 'r2',
      type: 'rectangle',
      name: 'R2',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    };
    const e2: Ellipse = {
      id: 'e2',
      type: 'ellipse',
      name: 'E2',
      x: 200,
      y: 200,
      radiusX: 25,
      radiusY: 25,
    };

    sm.addShape(l1Id, r1);
    sm.addShape(l1Id, r2);
    sm.addShape('layer-2', e2);

    const stateBefore = sm.getState();
    const layer2Before = stateBefore.children[1];

    let notifications = 0;
    sm.subscribe(() => {
      notifications++;
    });

    const changed = sm.updateShapesDimensions([
      { id: 'r1', dimensions: { width: 80 } },
      { id: 'r2', dimensions: { height: 90 } },
    ]);

    assert.equal(changed, true);
    // Una sola notificación
    assert.equal(notifications, 1);

    const stateAfter = sm.getState();
    // Capa 1 modificada
    assert.notEqual(stateAfter.children[0], stateBefore.children[0]);
    // Estructura compartida: Capa 2 intacta por referencia
    assert.equal(stateAfter.children[1], layer2Before);

    // Sin cambios no notifica y devuelve false
    const unchanged = sm.updateShapesDimensions([
      { id: 'r1', dimensions: { width: 80 } },
      { id: 'r2', dimensions: { height: 90 } },
    ]);
    assert.equal(unchanged, false);
    assert.equal(notifications, 1);
  });

  it('TransformShapesCommand: ejecutar, deshacer, rehacer, y sin cambios no registra', () => {
    const sm = new StateManager();
    const cm = new CommandManager();
    const layerId = sm.getState().children[0].id;

    const rect: Rectangle = {
      id: 'rect-cmd',
      type: 'rectangle',
      name: 'Rect Cmd',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      rotation: 0,
    };
    sm.addShape(layerId, rect);

    const beforeDims: ShapeDimensions = {
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      rotation: 0,
    };
    const afterDims: ShapeDimensions = {
      x: 20,
      y: 30,
      width: 100,
      height: 80,
      rotation: 45,
    };

    const cmd = new TransformShapesCommand(sm, [
      { id: 'rect-cmd', before: beforeDims, after: afterDims },
    ]);
    assert.equal(cmd.isAlreadyAtTarget, false);

    // 1. Ejecutar
    cm.executeCommand(cmd);
    let current = sm.findNode('rect-cmd') as Rectangle;
    assert.equal(current.x, 20);
    assert.equal(current.y, 30);
    assert.equal(current.width, 100);
    assert.equal(current.height, 80);
    assert.equal(current.rotation, 45);
    assert.equal(cm.canUndo(), true);

    // 2. Deshacer
    cm.undo();
    current = sm.findNode('rect-cmd') as Rectangle;
    assert.equal(current.x, 10);
    assert.equal(current.y, 10);
    assert.equal(current.width, 50);
    assert.equal(current.height, 50);
    assert.equal(current.rotation, 0);

    // 3. Rehacer
    cm.redo();
    current = sm.findNode('rect-cmd') as Rectangle;
    assert.equal(current.x, 20);
    assert.equal(current.y, 30);
    assert.equal(current.width, 100);
    assert.equal(current.height, 80);
    assert.equal(current.rotation, 45);

    // 4. Sin cambios: no registra en el historial
    const noopCmd = new TransformShapesCommand(sm, [
      { id: 'rect-cmd', before: afterDims, after: afterDims },
    ]);
    assert.equal(noopCmd.isAlreadyAtTarget, true);

    cm.executeCommand(noopCmd);
    // Al deshacer, revierte cmd (antes de afterDims)
    cm.undo();
    current = sm.findNode('rect-cmd') as Rectangle;
    assert.equal(current.x, 10);
    assert.equal(current.width, 50);
    assert.equal(cm.canUndo(), false);
  });
});
