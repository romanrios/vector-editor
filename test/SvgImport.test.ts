import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSvgPathD, parseSvgString } from '../src/utils/svgImport.ts';
import type { Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

describe('svgImport - Importación y Conversión de SVG a Figuras Nativas', () => {
  describe('parseSvgPathD - Parser geométrico de trazados Bézier', () => {
    it('1. Parsea líneas rectas simples (M, L, Z)', () => {
      const d = 'M 10 20 L 50 60 L 80 90 Z';
      const result = parseSvgPathD(d);

      assert.equal(result.closed, true);
      assert.equal(result.points.length, 3);
      assert.deepEqual(result.points[0], { x: 10, y: 20, pointType: 'corner' });
      assert.deepEqual(result.points[1], { x: 50, y: 60, pointType: 'corner' });
      assert.deepEqual(result.points[2], { x: 80, y: 90, pointType: 'corner' });
    });

    it('2. Parsea comandos horizontales (H) y verticales (V) con coordenadas relativas', () => {
      const d = 'm 10 10 h 20 v 30 z';
      const result = parseSvgPathD(d);

      assert.equal(result.closed, true);
      assert.equal(result.points.length, 3);
      assert.equal(result.points[0].x, 10);
      assert.equal(result.points[0].y, 10);
      assert.equal(result.points[1].x, 30); // 10 + 20
      assert.equal(result.points[1].y, 10);
      assert.equal(result.points[2].x, 30);
      assert.equal(result.points[2].y, 40); // 10 + 30
    });

    it('3. Parsea curvas cúbicas Bézier (C) asociando handleOut y handleIn', () => {
      const d = 'M 0 0 C 10 20 30 40 50 50';
      const result = parseSvgPathD(d);

      assert.equal(result.closed, false);
      assert.equal(result.points.length, 2);

      const p0 = result.points[0];
      assert.equal(p0.x, 0);
      assert.equal(p0.y, 0);
      assert.deepEqual(p0.handleOut, { x: 10, y: 20 });
      assert.equal(p0.pointType, 'smooth');

      const p1 = result.points[1];
      assert.equal(p1.x, 50);
      assert.equal(p1.y, 50);
      assert.deepEqual(p1.handleIn, { x: 30, y: 40 });
      assert.equal(p1.pointType, 'smooth');
    });

    it('4. Parsea curvas cuadráticas Bézier (Q) elevando el grado a cúbico', () => {
      const d = 'M 0 0 Q 30 60 60 0';
      const result = parseSvgPathD(d);

      assert.equal(result.points.length, 2);
      const p0 = result.points[0];
      const p1 = result.points[1];

      assert.ok(p0.handleOut);
      assert.ok(p1.handleIn);
      // Elevación de grado: CP1 = P0 + 2/3 * (QP - P0) = 0 + 2/3 * 30 = 20
      assert.equal(Math.round(p0.handleOut!.x), 20);
      assert.equal(Math.round(p0.handleOut!.y), 40);
    });

    it('5. Parsea curvas cúbicas suaves (S) reflejando el punto de control anterior', () => {
      const d = 'M 0 0 C 10 20 30 40 50 50 S 90 60 100 100';
      const result = parseSvgPathD(d);

      assert.equal(result.points.length, 3);
      const p1 = result.points[1];
      const p2 = result.points[2];

      // p1 handleIn era (30, 40). Reflejado sobre (50, 50): 50 + (50 - 30) = 70, 50 + (50 - 40) = 60
      assert.deepEqual(p1.handleOut, { x: 70, y: 60 });
      assert.deepEqual(p2.handleIn, { x: 90, y: 60 });
      assert.equal(p2.x, 100);
      assert.equal(p2.y, 100);
    });
  });

  describe('parseSvgString - Parser de documento SVG a nodos Vectedit', () => {
    it('1. Maneja entradas nulas o vacías adecuadamente', () => {
      const res = parseSvgString('');
      assert.equal(res.success, false);
      assert.equal(res.shapes.length, 0);
      assert.ok(res.error);
    });

    it('2. Importa elementos <rect> con coordenadas, dimensiones y colores', () => {
      const svg = `
        <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
          <rect x="25" y="35" width="150" height="80" fill="#3b82f6" stroke="#1d4ed8" stroke-width="2" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      assert.equal(res.shapes.length, 1);
      assert.equal(res.width, 400);
      assert.equal(res.height, 300);

      const rect = res.shapes[0] as Rectangle;
      assert.equal(rect.type, 'rectangle');
      assert.equal(rect.x, 25);
      assert.equal(rect.y, 35);
      assert.equal(rect.width, 150);
      assert.equal(rect.height, 80);
      assert.equal(rect.fill, '#3b82f6');
    });

    it('3. Importa elementos <circle> convirtiéndolos a nodos ellipse con radiusX y radiusY', () => {
      const svg = `
        <svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="150" r="40" fill="#ef4444" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      assert.equal(res.shapes.length, 1);

      const circle = res.shapes[0] as Ellipse;
      assert.equal(circle.type, 'ellipse');
      assert.equal(circle.x, 100);
      assert.equal(circle.y, 150);
      assert.equal(circle.radiusX, 40);
      assert.equal(circle.radiusY, 40);
      assert.equal(circle.fill, '#ef4444');
    });

    it('4. Importa trazados vectoriales complejos con <path>', () => {
      const svg = `
        <svg width="600" height="400">
          <path d="M 10 10 L 90 10 L 90 90 Z" fill="#10b981" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      assert.equal(res.shapes.length, 1);

      const path = res.shapes[0] as Path;
      assert.equal(path.type, 'path');
      assert.equal(path.points.length, 3);
      assert.equal(path.closed, true);
      assert.equal(path.fill, '#10b981');
    });
  });
});
