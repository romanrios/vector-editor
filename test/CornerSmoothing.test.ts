import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import {
  computeCornerArc,
  smoothPathPoints,
  getPolygonPathPoints,
  getStarPathPoints,
  getShapeCornerRadiusHandles,
  hitTestCornerRadiusHandle,
  calculateRadiusFromHandleDrag,
} from '../src/utils/cornerSmoothing.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import type {
  Path,
  PathPoint,
  Polygon,
  Rectangle,
  Star,
  Document,
  Layer,
} from '../src/types/scene-graph.ts';

describe('Redondeo de Esquinas en Vértices Arbitrarios (Corner Smoothing / Corner Radius)', () => {
  describe('1. computeCornerArc - Cálculo Matemático y Arcos Tangentes', () => {
    it('calcula arco tangente exacto en un vértice recto de 90°', () => {
      // Vértice en (100, 100) formado por (0, 100) -> (100, 100) -> (100, 200)
      const pPrev = { x: 0, y: 100 };
      const pCurr = { x: 100, y: 100 };
      const pNext = { x: 100, y: 200 };
      const desiredRadius = 20;

      const arc = computeCornerArc(pPrev, pCurr, pNext, desiredRadius);
      assert.ok(arc, 'Debe generar CornerArcInfo');
      assert.equal(arc.effectiveRadius, 20);

      // En ángulo de 90°, halfAngle = 45°, tan(45°) = 1 => tangentDistance = radius = 20
      assert.ok(Math.abs(arc.tangentDistance - 20) < 1e-6);

      // Puntos tangenciales: T1 = (100 - 20, 100) = (80, 100); T2 = (100, 100 + 20) = (100, 120)
      assert.ok(Math.abs(arc.tangentPoint1.x - 80) < 1e-6);
      assert.ok(Math.abs(arc.tangentPoint1.y - 100) < 1e-6);
      assert.ok(Math.abs(arc.tangentPoint2.x - 100) < 1e-6);
      assert.ok(Math.abs(arc.tangentPoint2.y - 120) < 1e-6);

      // Factor kappa Bézier para 90°: (4/3) * tan(22.5°) * R ≈ 0.55228475 * 20 ≈ 11.04569
      const expectedKappa = (4 / 3) * Math.tan(Math.PI / 8) * 20;
      assert.ok(Math.abs(arc.controlPoint1.x - (80 + expectedKappa)) < 1e-4);
      assert.ok(Math.abs(arc.controlPoint2.y - (120 - expectedKappa)) < 1e-4);

      // Bisectriz interior apunta hacia (-x, +y): (-1/√2, 1/√2)
      assert.ok(Math.abs(arc.bisector.x - (-Math.SQRT1_2)) < 1e-4);
      assert.ok(Math.abs(arc.bisector.y - Math.SQRT1_2) < 1e-4);
    });

    it('limita el radio al máximo permitido por la longitud de los segmentos incidentes', () => {
      // Aristas cortas: L1 = 10, L2 = 50. d_max = min(10, 50) / 2 = 5.
      const pPrev = { x: 90, y: 100 };
      const pCurr = { x: 100, y: 100 };
      const pNext = { x: 100, y: 150 };

      const arc = computeCornerArc(pPrev, pCurr, pNext, 40);
      assert.ok(arc);
      assert.ok(arc.maxRadius <= 5.0001);
      assert.ok(arc.effectiveRadius <= 5.0001);
      assert.ok(arc.tangentDistance <= 5.0001);
    });

    it('devuelve null para vértices colineales (180° plano o 0° retroceso) y aristas nulas', () => {
      // 180° (línea recta continua sin esquina)
      const straight = computeCornerArc({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, 10);
      assert.equal(straight, null);

      // 0° (retroceso sobre sí mismo)
      const reversal = computeCornerArc({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0 }, 10);
      assert.equal(reversal, null);

      // Vértice coincidente / arista longitud cero
      const degenerate = computeCornerArc({ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 }, 10);
      assert.equal(degenerate, null);
    });
  });

  describe('2. smoothPathPoints - Generación de Curvas Bézier en Trazados', () => {
    it('redondea las esquinas de un triángulo cerrado produciendo dos anclas por esquina', () => {
      const triangle: PathPoint[] = [
        { x: 100, y: 0, moveTo: true, pointType: 'corner' },
        { x: 200, y: 150, pointType: 'corner' },
        { x: 0, y: 150, pointType: 'corner', closeSubpath: true },
      ];

      const smoothed = smoothPathPoints(triangle, true, 15);
      // Cada esquina se desdobla en 2 anclas con tiradores de control tangenciales
      assert.equal(smoothed.length, 6);

      // Conserva flags moveTo y closeSubpath en los extremos
      assert.equal(smoothed[0].moveTo, true);
      assert.equal(smoothed[smoothed.length - 1].closeSubpath, true);

      // Los puntos generados poseen tiradores Bézier
      assert.ok(smoothed[0].handleOut !== undefined);
      assert.ok(smoothed[1].handleIn !== undefined);
    });

    it('respeta esquinas con curvatura Bézier previa sin alterarlas', () => {
      const pathWithCurve: PathPoint[] = [
        { x: 0, y: 0, moveTo: true, pointType: 'corner' },
        { x: 100, y: 0, pointType: 'smooth', handleIn: { x: 80, y: 0 }, handleOut: { x: 120, y: 0 } },
        { x: 200, y: 100, pointType: 'corner', closeSubpath: true },
      ];

      const smoothed = smoothPathPoints(pathWithCurve, true, 20);
      // El vértice con curvas Bézier existentes no se subdivide
      const middlePt = smoothed.find((p) => p.x === 100 && p.y === 0);
      assert.ok(middlePt);
      assert.deepEqual(middlePt.handleIn, { x: 80, y: 0 });
    });

    it('en trazados abiertos no redondea los extremos libres', () => {
      const openPolyline: PathPoint[] = [
        { x: 0, y: 0, moveTo: true },
        { x: 50, y: 50, cornerRadius: 10 },
        { x: 100, y: 0 },
      ];

      const smoothed = smoothPathPoints(openPolyline, false, 0);
      // Vértice inicial y final intactos, vértice medio (1) desdoblado en 2
      assert.equal(smoothed.length, 4);
      assert.equal(smoothed[0].x, 0);
      assert.equal(smoothed[0].y, 0);
      assert.equal(smoothed[3].x, 100);
      assert.equal(smoothed[3].y, 0);
    });
  });

  describe('3. getPolygonPathPoints y getStarPathPoints', () => {
    it('genera puntos suavizados para un polígono regular (ej. Pentágono)', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        type: 'polygon',
        name: 'Pentágono',
        x: 200,
        y: 200,
        radius: 80,
        sides: 5,
        cornerRadius: 15,
      };

      const pts = getPolygonPathPoints(polygon);
      // Pentágono tiene 5 esquinas => al redondear tiene 10 puntos Bézier
      assert.equal(pts.length, 10);
      for (const p of pts) {
        assert.ok(p.handleIn !== undefined || p.handleOut !== undefined);
      }
    });

    it('si cornerRadius es 0 en polígono, mantiene los 5 vértices rectos originales', () => {
      const polygon: Polygon = {
        id: 'poly-2',
        type: 'polygon',
        name: 'Hexágono',
        x: 100,
        y: 100,
        radius: 50,
        sides: 6,
        cornerRadius: 0,
      };

      const pts = getPolygonPathPoints(polygon);
      assert.equal(pts.length, 6);
      assert.equal(pts[0].handleIn, undefined);
      assert.equal(pts[0].handleOut, undefined);
    });

    it('genera curvas en puntas de estrella con cornerRadius e innerCornerRadius', () => {
      const star: Star = {
        id: 'star-1',
        type: 'star',
        name: 'Estrella',
        x: 150,
        y: 150,
        points: 5,
        outerRadius: 100,
        innerRadius: 40,
        cornerRadius: 10,
        innerCornerRadius: 5,
      };

      const pts = getStarPathPoints(star);
      // Estrella de 5 puntas = 10 vértices (5 exteriores + 5 interiores) => 20 puntos suavizados
      assert.equal(pts.length, 20);
    });
  });

  describe('4. Tiradores Interactivos de Radio (Corner Radius Handles)', () => {
    it('obtiene 4 tiradores de esquina para un Rectangle', () => {
      const rect: Rectangle = {
        id: 'rect-1',
        type: 'rectangle',
        name: 'Rectángulo',
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        cornerRadius: 12,
      };

      const handles = getShapeCornerRadiusHandles(rect, 1);
      assert.equal(handles.length, 4);
      assert.equal(handles[0].shapeId, 'rect-1');
      assert.equal(handles[0].currentRadius, 12);
      assert.equal(handles[0].maxRadius, 30); // min(100, 60) / 2
    });

    it('obtiene tiradores de esquina para cada vértice de un Polygon', () => {
      const poly: Polygon = {
        id: 'poly-handles',
        type: 'polygon',
        name: 'Triángulo',
        x: 100,
        y: 100,
        radius: 60,
        sides: 3,
        cornerRadius: 5,
      };

      const handles = getShapeCornerRadiusHandles(poly, 1);
      assert.equal(handles.length, 3);
      for (const h of handles) {
        assert.equal(h.shapeId, 'poly-handles');
        assert.equal(h.currentRadius, 5);
      }
    });

    it('hitTestCornerRadiusHandle detecta correctamente el tirador bajo el cursor', () => {
      const rect: Rectangle = {
        id: 'rect-hittest',
        type: 'rectangle',
        name: 'Rectángulo',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        cornerRadius: 10,
      };

      const handles = getShapeCornerRadiusHandles(rect, 1);
      const firstHandle = handles[0];

      // Clic directo sobre el tirador
      const hit = hitTestCornerRadiusHandle(handles, firstHandle.x, firstHandle.y, 8);
      assert.ok(hit);
      assert.equal(hit.id, firstHandle.id);

      // Clic lejos del tirador
      const miss = hitTestCornerRadiusHandle(handles, 500, 500, 8);
      assert.equal(miss, null);
    });

    it('calculateRadiusFromHandleDrag proyecta el arrastre sobre la bisectriz y calcula el radio clamp', () => {
      const rect: Rectangle = {
        id: 'rect-drag',
        type: 'rectangle',
        name: 'Rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      };
      const handles = getShapeCornerRadiusHandles(rect, 1);
      const hTL = handles[0]; // Top-left en (0, 0), bisectriz hacia (1, 1)

      // Arrastrar hacia adentro a (20, 20)
      const r = calculateRadiusFromHandleDrag(hTL, 20, 20);
      assert.ok(r > 0);
      assert.ok(r <= hTL.maxRadius);

      // Arrastrar hacia afuera (valores negativos) clamp a 0
      const rNegative = calculateRadiusFromHandleDrag(hTL, -20, -20);
      assert.equal(rNegative, 0);

      // Arrastrar más allá del límite se clampa a maxRadius (50)
      const rExcess = calculateRadiusFromHandleDrag(hTL, 200, 200);
      assert.equal(rExcess, hTL.maxRadius);
    });
  });

  describe('5. StateManager y Comandos (Undo / Redo)', () => {
    it('updateShapesDimensions modifica cornerRadius en Polygon y Star de forma inmutable', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const poly: Polygon = {
        id: 'poly-state-test',
        type: 'polygon',
        name: 'Poli',
        x: 50,
        y: 50,
        radius: 40,
        sides: 5,
        cornerRadius: 0,
      };
      stateManager.addShape(layerId, poly);

      // Actualizar cornerRadius a 15
      const changed = stateManager.updateShapesDimensions([
        { id: 'poly-state-test', dimensions: { cornerRadius: 15 } },
      ]);
      assert.equal(changed, true);

      const updated = stateManager.findNode('poly-state-test') as Polygon;
      assert.equal(updated.cornerRadius, 15);
    });

    it('setPathPointCornerRadius actualiza el radio de un vértice específico de un Path', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'path-cr-test',
        type: 'path',
        name: 'Trazo Vértice',
        x: 0,
        y: 0,
        closed: true,
        points: [
          { x: 0, y: 0, pointType: 'corner' },
          { x: 100, y: 0, pointType: 'corner' },
          { x: 100, y: 100, pointType: 'corner' },
        ],
      };
      stateManager.addShape(layerId, path);

      const ok = stateManager.setPathPointCornerRadius('path-cr-test', [1], 12);
      assert.equal(ok, true);

      const updatedPath = stateManager.findNode('path-cr-test') as Path;
      assert.equal(updatedPath.points[0].cornerRadius, undefined);
      assert.equal(updatedPath.points[1].cornerRadius, 12);
      assert.equal(updatedPath.points[2].cornerRadius, undefined);
    });

    it('ResizeCommand soporta Undo/Redo para cornerRadius de Polygon y Star', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const layerId = stateManager.getState().children[0].id;

      const poly: Polygon = {
        id: 'poly-undo-test',
        type: 'polygon',
        name: 'Poli Undo',
        x: 0,
        y: 0,
        radius: 50,
        sides: 4,
        cornerRadius: 0,
      };
      stateManager.addShape(layerId, poly);

      const cmd = new ResizeCommand(
        stateManager,
        'poly-undo-test',
        { cornerRadius: 0 },
        { cornerRadius: 18 }
      );
      commandManager.executeCommand(cmd);

      let node = stateManager.findNode('poly-undo-test') as Polygon;
      assert.equal(node.cornerRadius, 18);

      commandManager.undo();
      node = stateManager.findNode('poly-undo-test') as Polygon;
      assert.equal(node.cornerRadius ?? 0, 0);

      commandManager.redo();
      node = stateManager.findNode('poly-undo-test') as Polygon;
      assert.equal(node.cornerRadius, 18);
    });
  });

  describe('6. Exportación SVG con Esquinas Redondeadas', () => {
    it('exporta un Polygon con cornerRadius como trazado <path d="...C..." /> suavizado', () => {
      const poly: Polygon = {
        id: 'svg-poly-rounded',
        type: 'polygon',
        name: 'Hexágono Redondeado',
        x: 100,
        y: 100,
        radius: 40,
        sides: 6,
        fill: '#3b82f6',
        cornerRadius: 10,
      };

      const doc: Document = {
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 400,
        height: 400,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer',
            children: [poly],
          } as Layer,
        ],
      };

      const svg = exportDocumentToSvg(doc);
      // Al tener cornerRadius > 0, se exporta como un elemento <path con curvas cúbicas 'C'
      assert.ok(svg.includes('<path'));
      assert.ok(svg.includes('C '));
    });

    it('exporta un Polygon sin cornerRadius como <polygon points="..." /> nativo', () => {
      const poly: Polygon = {
        id: 'svg-poly-sharp',
        type: 'polygon',
        name: 'Triángulo Plano',
        x: 50,
        y: 50,
        radius: 30,
        sides: 3,
        fill: '#ef4444',
      };

      const doc: Document = {
        id: 'doc-2',
        type: 'document',
        name: 'Doc',
        width: 400,
        height: 400,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer',
            children: [poly],
          } as Layer,
        ],
      };

      const svg = exportDocumentToSvg(doc);
      assert.ok(svg.includes('<polygon'));
      assert.ok(svg.includes('points='));
    });
  });
});
