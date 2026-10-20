import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSvgPathD, parseSvgString } from '../src/utils/svgImport.ts';
import type { Rectangle, Ellipse, Path, LinearGradient, RadialGradient } from '../src/types/scene-graph.ts';
import { StateManager } from '../src/state/StateManager.ts';

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

    it('5. Parsea comandos de arcos elípticos (A/a) convirtiéndolos a curvas Bézier', () => {
      // Arco desde (0, 0) hasta (100, 100) con radio 50, 50
      const d = 'M 0 0 A 50 50 0 0 1 100 100';
      const result = parseSvgPathD(d);

      assert.ok(result.points.length >= 2);
      const lastPoint = result.points[result.points.length - 1];
      assert.equal(Math.round(lastPoint.x), 100);
      assert.equal(Math.round(lastPoint.y), 100);
      assert.ok(lastPoint.handleIn);
    });

    it('6. Parsea comandos cuadráticos suaves (T/t) reflejando el punto de control anterior', () => {
      const d = 'M 0 0 Q 50 100 100 0 T 200 0';
      const result = parseSvgPathD(d);

      assert.equal(result.points.length, 3);
      assert.equal(result.points[2].x, 200);
      assert.equal(result.points[2].y, 0);
      assert.ok(result.points[2].handleIn);
    });

    it('7. Parsea múltiples subpaths (M ... Z M ... Z) preservando subpaths y moveTo', () => {
      const d = 'M 0 0 L 10 0 L 10 10 Z M 50 50 L 60 50 L 60 60 Z';
      const result = parseSvgPathD(d);

      assert.equal(result.subpaths.length, 2);
      assert.equal(result.subpaths[0].closed, true);
      assert.equal(result.subpaths[1].closed, true);
      assert.equal(result.subpaths[0].points.length, 3);
      assert.equal(result.subpaths[1].points.length, 3);
      assert.equal(result.points[3].moveTo, true);
    });

    it('8. Hereda fill="none" y stroke="currentColor" desde la raíz <svg> para no volver negros los iconos', () => {
      const svg = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M 4 4 L 20 20" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      assert.equal(res.shapes.length, 1);

      const path = res.shapes[0] as Path;
      assert.equal(path.fill, 'none');
      assert.equal(path.stroke, '#000000');
      assert.equal(path.strokeWidth, 2);
    });

    it('9. Prioriza estilos inline de atributo style sobre atributos de presentación', () => {
      const svg = `
        <svg width="200" height="200">
          <rect x="10" y="10" width="50" height="50" fill="#000000" stroke="#000000" style="fill: #ec4899; stroke: #3b82f6; stroke-width: 4px;" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      const rect = res.shapes[0] as Rectangle;
      assert.equal(rect.fill, '#ec4899');
      assert.equal(rect.stroke, '#3b82f6');
      assert.equal(rect.strokeWidth, 4);
    });

    it('10. Parsea hojas de estilo en etiquetas <style> aplicando selectores de clase', () => {
      const svg = `
        <svg width="200" height="200">
          <style>
            .highlight { fill: #f59e0b; stroke: #10b981; stroke-width: 3; }
          </style>
          <rect class="highlight" x="5" y="5" width="40" height="40" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      const rect = res.shapes[0] as Rectangle;
      assert.equal(rect.fill, '#f59e0b');
      assert.equal(rect.stroke, '#10b981');
      assert.equal(rect.strokeWidth, 3);
    });

    it('11. Asigna fill="none" a trazados abiertos que tienen stroke definido', () => {
      const svg = `
        <svg width="200" height="200">
          <path d="M 10 10 L 100 100" stroke="#ef4444" stroke-width="2" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      const path = res.shapes[0] as Path;
      assert.equal(path.closed, false);
      assert.equal(path.fill, 'none');
      assert.equal(path.stroke, '#ef4444');
    });

    it('12. Parsea degradados <linearGradient> y resuelve referencias url(#id)', () => {
      const svg = `
        <svg width="300" height="300">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ff0000" stop-opacity="1" />
              <stop offset="100%" stop-color="#0000ff" stop-opacity="0.5" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill="url(#grad1)" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      const rect = res.shapes[0] as Rectangle;
      assert.ok(typeof rect.fill === 'object');
      assert.equal((rect.fill as any).type, 'linear');
      assert.equal((rect.fill as any).stops.length, 2);
      assert.equal((rect.fill as any).stops[0].color, '#ff0000');
      assert.equal((rect.fill as any).stops[1].color, '#0000ff');
      assert.equal((rect.fill as any).stops[1].opacity, 0.5);
    });

    it('13. Parsea transformaciones compuestas (translate, scale, rotate)', () => {
      const svg = `
        <svg width="400" height="400">
          <rect x="10" y="10" width="50" height="30" transform="translate(100, 50) scale(2, 2)" fill="#3b82f6" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      const rect = res.shapes[0] as Rectangle;
      assert.equal(rect.x, 120); // 10 * 2 + 100
      assert.equal(rect.y, 70);  // 10 * 2 + 50
      assert.equal(rect.width, 100); // 50 * 2
      assert.equal(rect.height, 60);  // 30 * 2
    });

    it('14. Aplica el escalado de viewBox mapeando las dimensiones al lienzo', () => {
      const svg = `
        <svg width="400" height="400" viewBox="0 0 100 100">
          <rect x="10" y="10" width="80" height="80" fill="#6366f1" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      assert.equal(res.width, 400);
      assert.equal(res.height, 400);

      const rect = res.shapes[0] as Rectangle;
      // Con scale = 4:
      assert.equal(rect.x, 40); // 10 * 4
      assert.equal(rect.y, 40);
      assert.equal(rect.width, 320); // 80 * 4
      assert.equal(rect.height, 320);
    });

    it('15. Resuelve elementos <use> referenciando definiciones por ID', () => {
      const svg = `
        <svg width="200" height="200">
          <defs>
            <circle id="marker" cx="0" cy="0" r="10" fill="#14b8a6" />
          </defs>
          <use href="#marker" x="50" y="60" />
        </svg>
      `;
      const res = parseSvgString(svg);

      assert.equal(res.success, true);
      assert.equal(res.shapes.length, 1);
      const circle = res.shapes[0] as Ellipse;
      assert.equal(circle.type, 'ellipse');
      assert.equal(circle.x, 50);
      assert.equal(circle.y, 60);
      assert.equal(circle.radiusX, 10);
      assert.equal(circle.fill, '#14b8a6');
    });

    it('16. Normaliza degradados lineales con gradientUnits="userSpaceOnUse" a [0, 1] respecto a baseAABB', () => {
      const svg = `
        <svg width="400" height="400">
          <defs>
            <linearGradient id="userGrad" gradientUnits="userSpaceOnUse" x1="100" y1="50" x2="300" y2="50">
              <stop offset="0%" stop-color="#ff0000" />
              <stop offset="100%" stop-color="#0000ff" />
            </linearGradient>
          </defs>
          <rect x="100" y="50" width="200" height="100" fill="url(#userGrad)" />
        </svg>
      `;
      const res = parseSvgString(svg);
      assert.equal(res.success, true);
      const rect = res.shapes[0] as Rectangle;
      assert.ok(typeof rect.fill === 'object');
      const grad = rect.fill as LinearGradient;
      assert.equal(grad.type, 'linear');
      // x1 correspondía a 100 en un rect con minX=100, width=200 -> normX1 = 0
      // x2 correspondía a 300 en un rect con minX=100, width=200 -> normX2 = 1
      assert.ok(Math.abs(grad.x1 - 0) < 1e-4);
      assert.ok(Math.abs(grad.x2 - 1) < 1e-4);
      assert.equal(grad.stops.length, 2);
      assert.equal(grad.stops[0].color, '#ff0000');
      assert.equal(grad.stops[1].color, '#0000ff');
    });

    it('17. Resuelve herencia de paradas y propiedades de degradados via xlink:href y href', () => {
      const svg = `
        <svg width="200" height="200">
          <defs>
            <linearGradient id="masterGrad">
              <stop offset="0" stop-color="#10b981" />
              <stop offset="1" stop-color="#6366f1" />
            </linearGradient>
            <linearGradient id="derivedGrad" x1="0" y1="0" x2="1" y2="1" xlink:href="#masterGrad" />
          </defs>
          <rect x="10" y="10" width="100" height="100" fill="url('#derivedGrad')" />
        </svg>
      `;
      const res = parseSvgString(svg);
      assert.equal(res.success, true);
      const rect = res.shapes[0] as Rectangle;
      assert.ok(typeof rect.fill === 'object');
      const grad = rect.fill as LinearGradient;
      assert.equal(grad.type, 'linear');
      assert.equal(grad.stops.length, 2);
      assert.equal(grad.stops[0].color, '#10b981');
      assert.equal(grad.stops[1].color, '#6366f1');
    });

    it('18. Resuelve reglas CSS de <style> aplicadas a elementos <stop class="...">', () => {
      const svg = `
        <svg width="200" height="200">
          <style>
            .stop-start { stop-color: #f59e0b; stop-opacity: 0.8; }
            .stop-end { stop-color: #ec4899; stop-opacity: 1; }
          </style>
          <defs>
            <linearGradient id="styledGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" class="stop-start" />
              <stop offset="100%" class="stop-end" />
            </linearGradient>
          </defs>
          <path d="M 0 0 L 100 0 L 100 100 Z" fill="url(#styledGrad)" />
        </svg>
      `;
      const res = parseSvgString(svg);
      assert.equal(res.success, true);
      const path = res.shapes[0] as Path;
      assert.ok(typeof path.fill === 'object');
      const grad = path.fill as LinearGradient;
      assert.equal(grad.stops[0].color, '#f59e0b');
      assert.equal(grad.stops[0].opacity, 0.8);
      assert.equal(grad.stops[1].color, '#ec4899');
      assert.equal(grad.stops[1].opacity, 1);
    });

    it('19. Resuelve nombres de colores CSS estándar (white, black, red, etc.) en paradas de degradado', () => {
      const svg = `
        <svg width="200" height="200">
          <defs>
            <radialGradient id="namedRadial" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="white" />
              <stop offset="100%" stop-color="red" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="50" fill="url(#namedRadial)" />
        </svg>
      `;
      const res = parseSvgString(svg);
      assert.equal(res.success, true);
      const circle = res.shapes[0] as Ellipse;
      assert.ok(typeof circle.fill === 'object');
      const grad = circle.fill as RadialGradient;
      assert.equal(grad.type, 'radial');
      assert.equal(grad.stops[0].color, '#ffffff'); // white no colapsa a #000000
      assert.equal(grad.stops[1].color, '#ff0000'); // red normalizado
    });

    it('20. Mover figuras con múltiples subpaths preserva moveTo, closeSubpath y pointType en StateManager', () => {
      const svg = `
        <svg width="200" height="200">
          <path d="M 10 10 L 30 10 L 30 30 Z M 50 50 L 70 50 L 70 70 Z" fill="#ff0000" />
        </svg>
      `;
      const res = parseSvgString(svg);
      assert.equal(res.success, true);
      const importedPath = res.shapes[0] as Path;

      // El segundo subpath debe tener moveTo: true
      assert.equal(importedPath.points[3].moveTo, true);

      // Crear StateManager y agregar la figura
      const sm = new StateManager();
      const layer = sm.getActiveLayer()!;
      sm.addShape(layer.id, importedPath);

      // Mover la figura 40px en X y 20px en Y
      sm.updateShapesPosition([{ id: importedPath.id, x: importedPath.x + 40, y: importedPath.y + 20 }]);

      const movedPath = sm.findNode(importedPath.id) as Path;
      assert.ok(movedPath);
      assert.equal(movedPath.points[0].x, importedPath.points[0].x + 40);
      assert.equal(movedPath.points[0].y, importedPath.points[0].y + 20);

      // CRÍTICO: El subpath 2 debe conservar moveTo: true y sus coordenadas trasladadas
      assert.equal(movedPath.points[3].moveTo, true);
      assert.equal(movedPath.points[3].x, importedPath.points[3].x + 40);
      assert.equal(movedPath.points[3].y, importedPath.points[3].y + 20);
      assert.equal(movedPath.points[2].closeSubpath, true);
    });
  });
});
