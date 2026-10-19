import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { StyleCommand } from '../src/commands/StyleCommand.ts';
import { StyleShapesCommand } from '../src/commands/StyleShapesCommand.ts';
import { Serializer } from '../src/state/Serializer.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import {
  isGradient,
  isLinearGradient,
  isRadialGradient,
  type LinearGradient,
  type RadialGradient,
  type Rectangle,
  type Ellipse,
  type Path,
} from '../src/types/scene-graph.ts';
import {
  createDefaultLinearGradient,
  createDefaultRadialGradient,
  gradientToWorldPoint,
  worldToGradientCoord,
  projectPointOnSegment,
  colorWithOpacity,
  interpolateGradientColor,
  createCanvasGradient,
  hitTestGradientHandles,
  getShapeBaseAABB,
} from '../src/utils/gradient.ts';

describe('Sistema Completo de Degradados (Lineales y Radiales)', () => {
  describe('1. Tipos de Datos y Type Guards', () => {
    it('isGradient reconoce correctamente LinearGradient y RadialGradient y rechaza strings o null', () => {
      const linear = createDefaultLinearGradient('#ff0000', '#0000ff');
      const radial = createDefaultRadialGradient('#00ff00', '#ffff00');

      assert.equal(isGradient(linear), true);
      assert.equal(isGradient(radial), true);
      assert.equal(isGradient('#ff0000'), false);
      assert.equal(isGradient('none'), false);
      assert.equal(isGradient(null), false);
      assert.equal(isGradient(undefined), false);
      assert.equal(isGradient({ foo: 'bar' }), false);
    });

    it('isLinearGradient e isRadialGradient discriminan por tipo', () => {
      const linear = createDefaultLinearGradient('#ff0000', '#0000ff');
      const radial = createDefaultRadialGradient('#00ff00', '#ffff00');

      assert.equal(isLinearGradient(linear), true);
      assert.equal(isLinearGradient(radial), false);

      assert.equal(isRadialGradient(radial), true);
      assert.equal(isRadialGradient(linear), false);
    });

    it('createDefaultLinearGradient genera coordenadas relativas 0-1 y paradas ordenadas', () => {
      const linear = createDefaultLinearGradient('#123456', '#abcdef');
      assert.equal(linear.type, 'linear');
      assert.equal(linear.x1, 0);
      assert.equal(linear.y1, 0.5);
      assert.equal(linear.x2, 1);
      assert.equal(linear.y2, 0.5);
      assert.equal(linear.stops.length, 2);
      assert.equal(linear.stops[0].offset, 0);
      assert.equal(linear.stops[0].color, '#123456');
      assert.equal(linear.stops[1].offset, 1);
      assert.equal(linear.stops[1].color, '#abcdef');
    });

    it('createDefaultRadialGradient genera centro, radio y paradas ordenadas', () => {
      const radial = createDefaultRadialGradient('#111111', '#eeeeee');
      assert.equal(radial.type, 'radial');
      assert.equal(radial.cx, 0.5);
      assert.equal(radial.cy, 0.5);
      assert.equal(radial.r, 0.5);
      assert.equal(radial.stops.length, 2);
      assert.equal(radial.stops[0].offset, 0);
      assert.equal(radial.stops[1].offset, 1);
    });
  });

  describe('2. Integración con StateManager e Inmutabilidad', () => {
    it('crea y actualiza Rectangle con degradado en fill conservando inmutabilidad', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      const initialRect: Rectangle = {
        id: 'rect-1',
        type: 'rectangle',
        name: 'Rect 1',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        fill: createDefaultLinearGradient('#ff0000', '#0000ff'),
      };
      sm.addShape(layerId, initialRect);

      const rect = sm.findNode('rect-1') as Rectangle;
      assert.equal(isGradient(rect.fill), true);
      if (isGradient(rect.fill)) {
        assert.equal(rect.fill.type, 'linear');
        assert.equal(rect.fill.stops.length, 2);
      }

      // El objeto del Scene Graph debe estar congelado
      assert.equal(Object.isFrozen(rect), true);

      // Actualizar a degradado radial
      const radial = createDefaultRadialGradient('#ffffff', '#000000');
      sm.updateShape(rect.id, { fill: radial });

      const updated = sm.findNode(rect.id) as Rectangle;
      assert.equal(isGradient(updated.fill), true);
      if (isGradient(updated.fill)) {
        assert.equal(updated.fill.type, 'radial');
      }
    });

    it('soporta degradado también en stroke para Ellipse y Path', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      const linear = createDefaultLinearGradient('#ff0000', '#ffff00');

      const initialEllipse: Ellipse = {
        id: 'ell-1',
        type: 'ellipse',
        name: 'Ellipse 1',
        x: 50,
        y: 50,
        radiusX: 30,
        radiusY: 20,
        fill: '#000000',
        stroke: linear,
        strokeWidth: 4,
      };
      sm.addShape(layerId, initialEllipse);

      const initialPath: Path = {
        id: 'path-1',
        type: 'path',
        name: 'Path 1',
        x: 0,
        y: 0,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 100 },
        ],
        fill: 'none',
        stroke: linear,
      };
      sm.addShape(layerId, initialPath);

      const ellipse = sm.findNode('ell-1') as Ellipse;
      assert.equal(isGradient(ellipse.stroke), true);

      const path = sm.findNode('path-1') as Path;
      assert.equal(isGradient(path.stroke), true);
    });
  });

  describe('3. Cálculos Geométricos del Degradado', () => {
    it('getShapeBaseAABB calcula correctamente la caja base local para Rectangle, Ellipse y Path', () => {
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 100,
        y: 200,
        width: 50,
        height: 60,
        fill: '#000',
      };
      const boxRect = getShapeBaseAABB(rect);
      assert.deepEqual(boxRect, { minX: 100, minY: 200, maxX: 150, maxY: 260, width: 50, height: 60 });

      const ell: Ellipse = {
        id: 'e1',
        type: 'ellipse',
        name: 'Ell',
        x: 100,
        y: 200,
        radiusX: 20,
        radiusY: 30,
        fill: '#000',
      };
      const boxEll = getShapeBaseAABB(ell);
      assert.deepEqual(boxEll, { minX: 80, minY: 170, maxX: 120, maxY: 230, width: 40, height: 60 });
    });

    it('gradientToWorldPoint y worldToGradientCoord son operaciones inversas', () => {
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 50,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0,
        fill: '#000',
      };

      // Centro normalizado (0.5, 0.5) => (150, 150) en world
      const worldCenter = gradientToWorldPoint(rect, 0.5, 0.5);
      assert.equal(worldCenter.x, 150);
      assert.equal(worldCenter.y, 150);

      const norm = worldToGradientCoord(rect, 150, 150);
      assert.equal(norm.x, 0.5);
      assert.equal(norm.y, 0.5);

      // Con rotación de 90 grados
      const rotRect: Rectangle = { ...rect, rotation: 90 };
      const ptWorld = gradientToWorldPoint(rotRect, 1, 0.5);
      const backNorm = worldToGradientCoord(rotRect, ptWorld.x, ptWorld.y);
      assert.ok(Math.abs(backNorm.x - 1) < 1e-4);
      assert.ok(Math.abs(backNorm.y - 0.5) < 1e-4);
    });

    it('projectPointOnSegment proyecta ortogonalmente un punto y devuelve t acotado en [0, 1]', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };

      // Punto en el medio pero desplazado en Y
      assert.equal(projectPointOnSegment({ x: 50, y: 30 }, p1, p2), 0.5);

      // Fuera del extremo izquierdo
      assert.equal(projectPointOnSegment({ x: -20, y: 10 }, p1, p2), 0);

      // Fuera del extremo derecho
      assert.equal(projectPointOnSegment({ x: 140, y: 10 }, p1, p2), 1);
    });

    it('colorWithOpacity convierte hex a rgba con el factor de opacidad adecuado', () => {
      assert.equal(colorWithOpacity('#ff0000', 1), '#ff0000');
      assert.equal(colorWithOpacity('#000000', 0.5), 'rgba(0, 0, 0, 0.5)');
      assert.equal(colorWithOpacity('#ffffff', 0), 'rgba(255, 255, 255, 0)');
    });

    it('interpolateGradientColor calcula el color interpolado en cualquier offset', () => {
      const grad: LinearGradient = {
        type: 'linear',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
        stops: [
          { id: 's1', offset: 0, color: '#000000' },
          { id: 's2', offset: 1, color: '#ffffff' },
        ],
      };

      assert.equal(interpolateGradientColor(grad, 0), '#000000');
      assert.equal(interpolateGradientColor(grad, 1), '#ffffff');
      // Punto medio entre 0 y 255 es 128 (0x80)
      assert.equal(interpolateGradientColor(grad, 0.5), '#808080');
    });

    it('hitTestGradientHandles detecta start, end y paradas intermedias', () => {
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#000',
      };
      const grad: LinearGradient = {
        type: 'linear',
        x1: 0,
        y1: 0.5,
        x2: 1,
        y2: 0.5,
        stops: [
          { id: 'stop-1', offset: 0, color: '#ff0000' },
          { id: 'stop-mid', offset: 0.5, color: '#00ff00' },
          { id: 'stop-2', offset: 1, color: '#0000ff' },
        ],
      };

      // Inicio está en (0, 50)
      const hitStart = hitTestGradientHandles(rect, grad, 2, 50, 8);
      assert.ok(hitStart);
      assert.equal(hitStart?.type, 'gradient-start');

      // Fin está en (100, 50)
      const hitEnd = hitTestGradientHandles(rect, grad, 98, 51, 8);
      assert.ok(hitEnd);
      assert.equal(hitEnd?.type, 'gradient-end');

      // Parada intermedia está en (50, 50)
      const hitStop = hitTestGradientHandles(rect, grad, 50, 50, 8);
      assert.ok(hitStop);
      assert.equal(hitStop?.type, 'gradient-stop');
      assert.equal(hitStop?.stopId, 'stop-mid');

      // Lejos no detecta nada
      const hitMiss = hitTestGradientHandles(rect, grad, 50, 10, 8);
      assert.equal(hitMiss, null);
    });
  });

  describe('4. Creación de CanvasGradient en Canvas 2D', () => {
    it('createCanvasGradient invoca createLinearGradient y addColorStop en el contexto nativo', () => {
      const addedStops: { offset: number; color: string }[] = [];
      const mockGradient = {
        addColorStop: (offset: number, color: string) => {
          addedStops.push({ offset, color });
        },
      };

      let linearCoords: number[] = [];
      const mockCtx = {
        createLinearGradient: (x1: number, y1: number, x2: number, y2: number) => {
          linearCoords = [x1, y1, x2, y2];
          return mockGradient;
        },
      } as unknown as CanvasRenderingContext2D;

      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 100,
        y: 200,
        width: 200,
        height: 100,
        fill: '#000',
      };
      const box = getShapeBaseAABB(rect);
      const linear = createDefaultLinearGradient('#ff0000', '#0000ff');
      const result = createCanvasGradient(mockCtx, linear, box, 1);

      assert.equal(result, mockGradient as unknown as CanvasGradient);
      assert.equal(addedStops.length, 2);
      assert.equal(addedStops[0].offset, 0);
      assert.equal(addedStops[1].offset, 1);
      assert.deepEqual(linearCoords, [100, 250, 300, 250]);
    });

    it('createCanvasGradient invoca createRadialGradient para degradados radiales', () => {
      let radialCoords: number[] = [];
      const mockGradient = { addColorStop: () => {} };
      const mockCtx = {
        createRadialGradient: (fx: number, fy: number, r0: number, cx: number, cy: number, r1: number) => {
          radialCoords = [fx, fy, r0, cx, cy, r1];
          return mockGradient;
        },
      } as unknown as CanvasRenderingContext2D;

      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'Rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#000',
      };
      const box = getShapeBaseAABB(rect);
      const radial = createDefaultRadialGradient('#ffffff', '#000000');
      createCanvasGradient(mockCtx, radial, box, 1);

      assert.equal(radialCoords.length, 6);
      assert.equal(radialCoords[2], 0); // r0
      assert.ok(radialCoords[5] > 0); // r1
    });
  });

  describe('5. Comandos Undo y Redo', () => {
    it('StyleCommand cambia degradado y undo restaura el valor inicial intacto', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;

      const rect: Rectangle = {
        id: 'rect-1',
        type: 'rectangle',
        name: 'Rect 1',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        fill: '#ff0000',
      };
      sm.addShape(layerId, rect);

      const linear = createDefaultLinearGradient('#00ff00', '#0000ff');
      const cmd = new StyleCommand(sm, rect.id, { fill: rect.fill }, { fill: linear });

      cm.executeCommand(cmd);
      let shape = sm.findNode(rect.id) as Rectangle;
      assert.equal(isGradient(shape.fill), true);
      assert.equal((shape.fill as LinearGradient).type, 'linear');

      // Deshacer
      cm.undo();
      shape = sm.findNode(rect.id) as Rectangle;
      assert.equal(shape.fill, '#ff0000');

      // Rehacer
      cm.redo();
      shape = sm.findNode(rect.id) as Rectangle;
      assert.equal(isGradient(shape.fill), true);
      assert.equal((shape.fill as LinearGradient).type, 'linear');
    });

    it('StyleShapesCommand aplica degradados a múltiples figuras con un único comando en el historial', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 0, width: 40, height: 40, fill: '#111111' };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 50, y: 0, width: 40, height: 40, fill: '#222222' };
      sm.addShape(layerId, r1);
      sm.addShape(layerId, r2);

      const grad = createDefaultLinearGradient('#abcdef', '#fedcba');
      const cmd = new StyleShapesCommand(sm, [
        { id: r1.id, before: { fill: r1.fill }, after: { fill: grad } },
        { id: r2.id, before: { fill: r2.fill }, after: { fill: grad } },
      ]);

      cm.executeCommand(cmd);
      assert.equal(cm.undoCount, 1);

      assert.equal(isGradient((sm.findNode(r1.id) as Rectangle).fill), true);
      assert.equal(isGradient((sm.findNode(r2.id) as Rectangle).fill), true);

      cm.undo();
      assert.equal((sm.findNode(r1.id) as Rectangle).fill, '#111111');
      assert.equal((sm.findNode(r2.id) as Rectangle).fill, '#222222');

      cm.redo();
      assert.equal(isGradient((sm.findNode(r1.id) as Rectangle).fill), true);
      assert.equal(isGradient((sm.findNode(r2.id) as Rectangle).fill), true);
    });
  });

  describe('6. Serialización y Deserialización JSON', () => {
    it('serializa y parsea documento con degradados lineales y radiales preservando todos sus atributos', async () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      const linear = createDefaultLinearGradient('#ff0055', '#00ffaa');
      const radial: RadialGradient = {
        type: 'radial',
        cx: 0.3,
        cy: 0.4,
        r: 0.6,
        fx: 0.35,
        fy: 0.45,
        stops: [
          { id: 's1', offset: 0, color: '#111111', opacity: 0.8 },
          { id: 's2', offset: 0.5, color: '#888888', opacity: 1 },
          { id: 's3', offset: 1, color: '#ffffff', opacity: 0.2 },
        ],
      };

      sm.addShape(layerId, { id: 'rect-1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 100, height: 80, fill: linear });
      sm.addShape(layerId, { id: 'ell-1', type: 'ellipse', name: 'E1', x: 200, y: 200, radiusX: 50, radiusY: 50, fill: radial });

      const json = Serializer.serializeDocument(sm.getState());
      const parsed = await Serializer.parseDocument(json);

      assert.equal(parsed.children.length, 1);
      const layer = parsed.children[0];
      assert.equal(layer.children.length, 2);

      const parsedRect = layer.children[0] as Rectangle;
      assert.equal(isGradient(parsedRect.fill), true);
      const parsedLinear = parsedRect.fill as LinearGradient;
      assert.equal(parsedLinear.type, 'linear');
      assert.equal(parsedLinear.x1, 0);
      assert.equal(parsedLinear.x2, 1);
      assert.equal(parsedLinear.stops.length, 2);

      const parsedEll = layer.children[1] as Ellipse;
      assert.equal(isGradient(parsedEll.fill), true);
      const parsedRadial = parsedEll.fill as RadialGradient;
      assert.equal(parsedRadial.type, 'radial');
      assert.equal(parsedRadial.cx, 0.3);
      assert.equal(parsedRadial.cy, 0.4);
      assert.equal(parsedRadial.r, 0.6);
      assert.equal(parsedRadial.fx, 0.35);
      assert.equal(parsedRadial.fy, 0.45);
      assert.equal(parsedRadial.stops.length, 3);
      assert.equal(parsedRadial.stops[0].opacity, 0.8);
      assert.equal(parsedRadial.stops[2].opacity, 0.2);
    });

    it('valida degradados mal formados arrojando excepciones descriptivas', async () => {
      const invalidJsonMissingStops = JSON.stringify({
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'layer-1',
            type: 'layer',
            name: 'Layer',
            children: [
              {
                id: 'rect-1',
                type: 'rectangle',
                name: 'Rect',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                fill: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [] },
              },
            ],
          },
        ],
      });

      await assert.rejects(
        async () => await Serializer.parseDocument(invalidJsonMissingStops),
        /paradas de degradado|stops/i
      );

      const invalidJsonBadOffset = JSON.stringify({
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'layer-1',
            type: 'layer',
            name: 'Layer',
            children: [
              {
                id: 'rect-1',
                type: 'rectangle',
                name: 'Rect',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                fill: {
                  type: 'linear',
                  x1: 0,
                  y1: 0,
                  x2: 1,
                  y2: 1,
                  stops: [
                    { id: '1', offset: -0.5, color: '#000' },
                    { id: '2', offset: 1, color: '#fff' },
                  ],
                },
              },
            ],
          },
        ],
      });

      await assert.rejects(
        async () => await Serializer.parseDocument(invalidJsonBadOffset),
        /offset/i
      );
    });
  });

  describe('7. Exportación SVG con <defs> y <stop>', () => {
    it('exportDocumentToSvg genera <defs> con linearGradient y radialGradient referenciados por url(#...)', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;
      const linear = createDefaultLinearGradient('#ff0000', '#0000ff');
      const radial: RadialGradient = {
        type: 'radial',
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        stops: [
          { id: 's1', offset: 0, color: '#ffff00', opacity: 1 },
          { id: 's2', offset: 1, color: '#ff00ff', opacity: 0.5 },
        ],
      };

      sm.addShape(layerId, { id: 'my-rect', type: 'rectangle', name: 'R', x: 10, y: 20, width: 100, height: 60, fill: linear });
      sm.addShape(layerId, { id: 'my-ell', type: 'ellipse', name: 'E', x: 200, y: 150, radiusX: 40, radiusY: 30, fill: radial });

      const svg = exportDocumentToSvg(sm.getState());

      // Debe incluir <defs>
      assert.ok(svg.includes('<defs>'), 'Debe contener la sección <defs>');
      assert.ok(svg.includes('</defs>'), 'Debe cerrar la sección </defs>');

      // Debe incluir <linearGradient> con id adecuado
      assert.ok(svg.includes('<linearGradient id="gradient-my-rect-fill"'));
      assert.ok(svg.includes('gradientUnits="userSpaceOnUse"'));
      assert.ok(svg.includes('<stop offset="0%" stop-color="#ff0000" stop-opacity="1" />'));
      assert.ok(svg.includes('<stop offset="100%" stop-color="#0000ff" stop-opacity="1" />'));

      // Debe incluir <radialGradient> con id adecuado y opacidad
      assert.ok(svg.includes('<radialGradient id="gradient-my-ell-fill"'));
      assert.ok(svg.includes('<stop offset="0%" stop-color="#ffff00" stop-opacity="1" />'));
      assert.ok(svg.includes('<stop offset="100%" stop-color="#ff00ff" stop-opacity="0.5" />'));

      // Las figuras deben referenciar el gradiente con url(#...)
      assert.ok(svg.includes('fill="url(#gradient-my-rect-fill)"'));
      assert.ok(svg.includes('fill="url(#gradient-my-ell-fill)"'));
    });
  });
});
