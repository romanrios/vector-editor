import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSelectionBounds, getShapesIntersectingRect } from '../src/utils/geometry.ts';
import type { Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

describe('Funciones Geométricas de Selección Múltiple', () => {
  describe('getSelectionBounds', () => {
    it('devuelve null si la lista de figuras está vacía', () => {
      assert.equal(getSelectionBounds([]), null);
    });

    it('calcula la caja envolvente de una figura simple sin rotación', () => {
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'R1',
        x: 100,
        y: 150,
        width: 80,
        height: 40,
      };

      const bounds = getSelectionBounds([rect]);
      assert.notEqual(bounds, null);
      assert.equal(bounds!.minX, 100);
      assert.equal(bounds!.minY, 150);
      assert.equal(bounds!.maxX, 180);
      assert.equal(bounds!.maxY, 190);
      assert.equal(bounds!.width, 80);
      assert.equal(bounds!.height, 40);
    });

    it('calcula la caja envolvente exacta de una figura rotada', () => {
      // Cuadrado de 100x100 en (100, 100) rotado 45°
      // Centro en (150, 150). Diagonal = 100 * sqrt(2) ≈ 141.42
      // Radio = 70.71. minX ≈ 150 - 70.71 = 79.29, maxX ≈ 220.71
      const rectRot: Rectangle = {
        id: 'r-rot',
        type: 'rectangle',
        name: 'Rotated',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 45,
      };

      const bounds = getSelectionBounds([rectRot]);
      assert.notEqual(bounds, null);
      assert.ok(Math.abs(bounds!.minX - (150 - 50 * Math.SQRT2)) < 1e-3);
      assert.ok(Math.abs(bounds!.maxX - (150 + 50 * Math.SQRT2)) < 1e-3);
      assert.ok(Math.abs(bounds!.minY - (150 - 50 * Math.SQRT2)) < 1e-3);
      assert.ok(Math.abs(bounds!.maxY - (150 + 50 * Math.SQRT2)) < 1e-3);
    });

    it('une correctamente las AABBs de múltiples figuras incluyendo rotadas, elipses y trazados', () => {
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'R1',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      };

      const ellipse: Ellipse = {
        id: 'e1',
        type: 'ellipse',
        name: 'E1',
        x: 200,
        y: 200,
        radiusX: 30,
        radiusY: 20,
      };

      const path: Path = {
        id: 'p1',
        type: 'path',
        name: 'P1',
        x: 100,
        y: 300,
        points: [
          { x: 100, y: 300, handleOut: { x: 120, y: 350 } },
          { x: 150, y: 320 },
        ],
      };

      const bounds = getSelectionBounds([rect, ellipse, path]);
      assert.notEqual(bounds, null);
      // rect: [0, 50] x [0, 50]
      // ellipse: [170, 230] x [180, 220]
      // path: minX=100, maxX=150, minY=300, maxY=350 (por el handleOut)
      assert.equal(bounds!.minX, 0);
      assert.equal(bounds!.minY, 0);
      assert.equal(bounds!.maxX, 230);
      assert.equal(bounds!.maxY, 350);
      assert.equal(bounds!.width, 230);
      assert.equal(bounds!.height, 350);
    });
  });

  describe('getShapesIntersectingRect', () => {
    const shapes: Rectangle[] = [
      { id: 's1', type: 'rectangle', name: 'S1', x: 10, y: 10, width: 40, height: 40 },
      { id: 's2', type: 'rectangle', name: 'S2', x: 100, y: 10, width: 40, height: 40 },
      { id: 's3', type: 'rectangle', name: 'S3', x: 10, y: 100, width: 40, height: 40 },
      { id: 's4', type: 'rectangle', name: 'S4', x: 100, y: 100, width: 40, height: 40 },
    ];

    it('filtra figuras contenidas o intersectadas por el rectángulo normal', () => {
      // Rectángulo en (0, 0, 60, 60): debe atrapar s1
      const hit = getShapesIntersectingRect(shapes, { x: 0, y: 0, width: 60, height: 60 });
      assert.deepEqual(hit.map((s) => s.id), ['s1']);
    });

    it('soporta arrastre en dirección inversa (ancho y alto negativos)', () => {
      // Arrastre desde (150, 150) hasta (90, 90) -> width = -60, height = -60: debe atrapar s4
      const hit = getShapesIntersectingRect(shapes, { x: 150, y: 150, width: -60, height: -60 });
      assert.deepEqual(hit.map((s) => s.id), ['s4']);

      // Arrastre con solo width negativo (de derecha a izquierda)
      const hit2 = getShapesIntersectingRect(shapes, { x: 150, y: 0, width: -60, height: 60 });
      assert.deepEqual(hit2.map((s) => s.id), ['s2']);
    });

    it('soporta entrada tipo AABB directamente', () => {
      const hit = getShapesIntersectingRect(shapes, {
        minX: 0,
        minY: 0,
        maxX: 150,
        maxY: 60,
        width: 150,
        height: 60,
      });
      // Debe atrapar s1 y s2 (ambas en y=10)
      assert.deepEqual(hit.map((s) => s.id), ['s1', 's2']);
    });

    it('devuelve array vacío si no intersecta ninguna figura o la lista está vacía', () => {
      const hit = getShapesIntersectingRect(shapes, { x: 500, y: 500, width: 50, height: 50 });
      assert.deepEqual(hit, []);

      const hitEmpty = getShapesIntersectingRect([], { x: 0, y: 0, width: 500, height: 500 });
      assert.deepEqual(hitEmpty, []);
    });

    it('considera la envolvente rotada de una figura al evaluar la intersección', () => {
      // Cuadrado en (100, 100) rotado 45°: su AABB se expande hacia x ≈ 79 y x ≈ 221
      const rotatedSquare: Rectangle = {
        id: 'rot-sq',
        type: 'rectangle',
        name: 'Rot',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        rotation: 45,
      };

      // Marquesina en x = 85..95 (donde el cuadrado sin rotar en 100..200 NO estaría, pero la esquina rotada SÍ está)
      const hitRot = getShapesIntersectingRect([rotatedSquare], {
        x: 80,
        y: 140,
        width: 15,
        height: 20,
      });
      assert.equal(hitRot.length, 1);
      assert.equal(hitRot[0].id, 'rot-sq');
    });
  });
});
