import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { MakeClipMaskCommand } from '../src/commands/MakeClipMaskCommand.ts';
import { ReleaseClipMaskCommand } from '../src/commands/ReleaseClipMaskCommand.ts';
import {
  isClipMaskGroup,
  isGroup,
  type Group,
  type Rectangle,
  type Ellipse,
  type Path,
  type Polygon,
  type Star,
} from '../src/types/scene-graph.ts';
import {
  getGroupAABB,
  getSelectionBounds,
  traceShapeClip,
} from '../src/utils/geometry.ts';
import { cloneNode } from '../src/utils/cloneShape.ts';
import { serializeDocument, parseDocument } from '../src/state/Serializer.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { parseSvgString } from '../src/utils/svgImport.ts';
import { calculateExportBounds, renderDocumentToCanvas } from '../src/utils/exportRaster.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';

// Mock simple de Canvas y Context 2D
function createMockCanvas(): HTMLCanvasElement & {
  mockCtx: Record<string, any>;
  calls: string[];
} {
  const calls: string[] = [];
  const mockCtx: Record<string, any> = {
    canvas: null as any,
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    setLineDash: () => {},
    save: () => {
      calls.push('save');
    },
    restore: () => {
      calls.push('restore');
    },
    beginPath: () => {
      calls.push('beginPath');
    },
    closePath: () => {
      calls.push('closePath');
    },
    moveTo: (x: number, y: number) => {
      calls.push(`moveTo(${Math.round(x)},${Math.round(y)})`);
    },
    lineTo: (x: number, y: number) => {
      calls.push(`lineTo(${Math.round(x)},${Math.round(y)})`);
    },
    bezierCurveTo: () => {
      calls.push('bezierCurveTo');
    },
    rect: (x: number, y: number, w: number, h: number) => {
      calls.push(`rect(${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)})`);
    },
    roundRect: (x: number, y: number, w: number, h: number) => {
      calls.push(`roundRect(${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)})`);
    },
    ellipse: () => {
      calls.push('ellipse');
    },
    arc: () => {
      calls.push('arc');
    },
    clip: (rule?: string) => {
      calls.push(`clip(${rule ?? 'nonzero'})`);
    },
    fill: () => {
      calls.push('fill');
    },
    stroke: () => {
      calls.push('stroke');
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      calls.push(`fillRect(${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)})`);
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      calls.push(`strokeRect(${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)})`);
    },
    translate: (x: number, y: number) => {
      calls.push(`translate(${Math.round(x)},${Math.round(y)})`);
    },
    rotate: (rad: number) => {
      calls.push(`rotate(${rad})`);
    },
    scale: (sx: number, sy: number) => {
      calls.push(`scale(${sx},${sy})`);
    },
    setTransform: () => {},
    clearRect: () => {},
    drawImage: () => {
      calls.push('drawImage');
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText: () => {},
    strokeText: () => {},
  };

  const canvas = {
    width: 800,
    height: 600,
    style: {},
    getContext: () => mockCtx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    mockCtx,
    calls,
  } as unknown as HTMLCanvasElement & {
    mockCtx: Record<string, any>;
    calls: string[];
  };
  mockCtx.canvas = canvas;
  return canvas;
}

describe('2.1. Máscaras de Recorte (Clipping Masks / clipPath)', () => {
  describe('1. Modelo de Scene Graph y Geometría', () => {
    it('isClipMaskGroup identifica grupos configurados como máscaras de recorte', () => {
      const regularGroup: Group = {
        id: 'g1',
        type: 'group',
        name: 'Grupo Normal',
        children: [],
      };
      const clipGroup: Group = {
        id: 'g2',
        type: 'group',
        name: 'Máscara',
        isClipMask: true,
        clipChildId: 'shape-mask',
        children: [],
      };

      assert.strictEqual(isClipMaskGroup(regularGroup), false);
      assert.strictEqual(isClipMaskGroup(clipGroup), true);
    });

    it('getGroupAABB delimita la caja envolvente a la figura máscara cuando isClipMask es true', () => {
      // Contenido grande de 500x500 enmascarado por un círculo pequeño de radio 50 centrado en (100, 100)
      const bigRect: Rectangle = {
        id: 'rect-content',
        type: 'rectangle',
        name: 'Fondo Grande',
        x: 0,
        y: 0,
        width: 500,
        height: 500,
      };
      const circleMask: Ellipse = {
        id: 'mask-circle',
        type: 'ellipse',
        name: 'Círculo Máscara',
        x: 100,
        y: 100,
        radiusX: 50,
        radiusY: 50,
      };

      const clipGroup: Group = {
        id: 'clip-g',
        type: 'group',
        name: 'Grupo Recorte',
        isClipMask: true,
        clipChildId: 'mask-circle',
        children: [bigRect, circleMask],
      };

      const aabb = getGroupAABB(clipGroup);
      assert.strictEqual(aabb.minX, 50); // 100 - 50
      assert.strictEqual(aabb.maxX, 150); // 100 + 50
      assert.strictEqual(aabb.minY, 50);
      assert.strictEqual(aabb.maxY, 150);
      assert.strictEqual(aabb.width, 100);
      assert.strictEqual(aabb.height, 100);

      const selBounds = getSelectionBounds([clipGroup]);
      assert.deepStrictEqual(selBounds, aabb);
    });

    it('traceShapeClip traza el contorno y aplica ctx.clip para Rectangle, Ellipse, Polygon, Star y Path', () => {
      const canvas = createMockCanvas();
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

      // 1. Rectangle
      const rect: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'R',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      };
      canvas.calls.length = 0;
      traceShapeClip(ctx, rect);
      assert.ok(canvas.calls.includes('beginPath'));
      assert.ok(canvas.calls.includes('rect(10,20,100,50)'));
      assert.ok(canvas.calls.some((c) => c.startsWith('clip')));

      // 2. Ellipse
      const ellipse: Ellipse = {
        id: 'e1',
        type: 'ellipse',
        name: 'E',
        x: 100,
        y: 100,
        radiusX: 40,
        radiusY: 30,
      };
      canvas.calls.length = 0;
      traceShapeClip(ctx, ellipse);
      assert.ok(canvas.calls.includes('beginPath'));
      assert.ok(canvas.calls.includes('ellipse'));
      assert.ok(canvas.calls.some((c) => c.startsWith('clip')));

      // 3. Polygon
      const poly: Polygon = {
        id: 'p1',
        type: 'polygon',
        name: 'P',
        x: 150,
        y: 150,
        radius: 40,
        sides: 5,
      };
      canvas.calls.length = 0;
      traceShapeClip(ctx, poly);
      assert.ok(canvas.calls.includes('beginPath'));
      assert.ok(canvas.calls.includes('closePath'));
      assert.ok(canvas.calls.some((c) => c.startsWith('clip')));

      // 4. Star
      const star: Star = {
        id: 's1',
        type: 'star',
        name: 'S',
        x: 200,
        y: 200,
        outerRadius: 50,
        innerRadius: 25,
        points: 5,
      };
      canvas.calls.length = 0;
      traceShapeClip(ctx, star);
      assert.ok(canvas.calls.includes('beginPath'));
      assert.ok(canvas.calls.includes('closePath'));
      assert.ok(canvas.calls.some((c) => c.startsWith('clip')));

      // 5. Path
      const path: Path = {
        id: 'path1',
        type: 'path',
        name: 'Path',
        x: 0,
        y: 0,
        points: [
          { x: 0, y: 0, moveTo: true },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50, closeSubpath: true },
        ],
        closed: true,
      };
      canvas.calls.length = 0;
      traceShapeClip(ctx, path);
      assert.ok(canvas.calls.includes('beginPath'));
      assert.ok(canvas.calls.some((c) => c.startsWith('clip')));
    });

    it('cloneNode preserva isClipMask y reasigna el ID de clipChildId al hijo clonado', () => {
      const child1: Rectangle = {
        id: 'c1',
        type: 'rectangle',
        name: 'Relleno',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      };
      const maskShape: Ellipse = {
        id: 'c2',
        type: 'ellipse',
        name: 'Máscara',
        x: 50,
        y: 50,
        radiusX: 50,
        radiusY: 50,
      };

      const clipGroup: Group = {
        id: 'orig-group',
        type: 'group',
        name: 'Grupo Máscara',
        isClipMask: true,
        clipChildId: 'c2',
        children: [child1, maskShape],
      };

      const cloned = cloneNode(clipGroup, { dx: 10, dy: 10 });
      assert.strictEqual(cloned.isClipMask, true);
      assert.notStrictEqual(cloned.id, clipGroup.id);
      assert.strictEqual(cloned.children.length, 2);
      // El nuevo clipChildId debe coincidir con el ID del segundo hijo clonado
      assert.strictEqual(cloned.clipChildId, cloned.children[1].id);
      assert.notStrictEqual(cloned.clipChildId, 'c2');
    });
  });

  describe('2. Comandos Reversibles (MakeClipMaskCommand y ReleaseClipMaskCommand)', () => {
    it('MakeClipMaskCommand agrupa las figuras seleccionadas designando la superior como máscara', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;

      const r1: Rectangle = {
        id: 'rect-base',
        type: 'rectangle',
        name: 'Rectángulo Base',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
      };
      const starMask: Star = {
        id: 'star-top',
        type: 'star',
        name: 'Estrella Máscara',
        x: 60,
        y: 60,
        outerRadius: 40,
        innerRadius: 20,
        points: 5,
      };

      sm.addShape(layerId, r1);
      sm.addShape(layerId, starMask);
      sm.setSelection(['rect-base', 'star-top']);

      const cmd = new MakeClipMaskCommand(sm);
      cm.executeCommand(cmd);

      const sel = sm.getSelection();
      assert.strictEqual(sel.length, 1);
      const groupNode = sm.findNode(sel[0]) as Group;
      assert.ok(groupNode && isGroup(groupNode));
      assert.strictEqual(groupNode.isClipMask, true);
      assert.strictEqual(groupNode.clipChildId, 'star-top');
      assert.strictEqual(groupNode.children.length, 2);

      // Deshacer restaura los dos nodos individuales y la selección previa
      cm.undo();
      assert.strictEqual(sm.findNode('rect-base') !== null, true);
      assert.strictEqual(sm.findNode('star-top') !== null, true);
      assert.strictEqual(sm.findNode(groupNode.id), null);
      assert.deepStrictEqual(sm.getSelection(), ['rect-base', 'star-top']);

      // Rehacer reconstituye la máscara
      cm.redo();
      assert.strictEqual(sm.findParent('rect-base')?.id, groupNode.id);
      assert.strictEqual(sm.findNode(groupNode.id) !== null, true);
    });

    it('MakeClipMaskCommand convierte un grupo preexistente de 2+ elementos en máscara de recorte', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;

      const r1: Rectangle = {
        id: 'r-1',
        type: 'rectangle',
        name: 'R1',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      };
      const r2: Rectangle = {
        id: 'r-2',
        type: 'rectangle',
        name: 'R2',
        x: 20,
        y: 20,
        width: 80,
        height: 80,
      };
      const existingGroup: Group = {
        id: 'grp-pre',
        type: 'group',
        name: 'Mi Grupo',
        children: [r1, r2],
      };
      sm.addNode(layerId, existingGroup);
      sm.setSelection(['grp-pre']);

      const cmd = new MakeClipMaskCommand(sm);
      cm.executeCommand(cmd);

      let group = sm.findNode('grp-pre') as Group;
      assert.strictEqual(group.isClipMask, true);
      assert.strictEqual(group.clipChildId, 'r-2');

      cm.undo();
      group = sm.findNode('grp-pre') as Group;
      assert.strictEqual(group.isClipMask, undefined);

      cm.redo();
      group = sm.findNode('grp-pre') as Group;
      assert.strictEqual(group.isClipMask, true);
    });

    it('ReleaseClipMaskCommand disuelve la máscara de recorte devolviendo los elementos al contenedor padre', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const layerId = sm.getState().children[0].id;

      const p1: Polygon = {
        id: 'poly-content',
        type: 'polygon',
        name: 'Polígono Contenido',
        x: 50,
        y: 50,
        radius: 30,
        sides: 6,
      };
      const maskCircle: Ellipse = {
        id: 'ellipse-mask',
        type: 'ellipse',
        name: 'Elipse Máscara',
        x: 50,
        y: 50,
        radiusX: 25,
        radiusY: 25,
      };

      const clipGroup: Group = {
        id: 'clip-to-release',
        type: 'group',
        name: 'Máscara',
        isClipMask: true,
        clipChildId: 'ellipse-mask',
        children: [p1, maskCircle],
      };

      sm.addNode(layerId, clipGroup);
      sm.setSelection(['clip-to-release']);

      const cmd = new ReleaseClipMaskCommand(sm);
      cm.executeCommand(cmd);

      // El grupo fue retirado y los dos elementos están ahora en la capa
      assert.strictEqual(sm.findNode('clip-to-release'), null);
      assert.strictEqual(sm.findNode('poly-content') !== null, true);
      assert.strictEqual(sm.findNode('ellipse-mask') !== null, true);
      assert.deepStrictEqual(sm.getSelection(), ['poly-content', 'ellipse-mask']);

      // Undo restituye el grupo con su configuración de máscara
      cm.undo();
      const restored = sm.findNode('clip-to-release') as Group;
      assert.ok(restored && isGroup(restored));
      assert.strictEqual(restored.isClipMask, true);
      assert.strictEqual(restored.clipChildId, 'ellipse-mask');

      // Redo vuelve a liberar
      cm.redo();
      assert.strictEqual(sm.findNode('clip-to-release'), null);
    });
  });

  describe('3. Hit-Testing y Operaciones Interactivas en InputController', () => {
    it('hitTest sólo detecta figuras dentro del contorno de la máscara', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const canvas = createMockCanvas();
      const ic = new InputController(canvas, sm, cm);
      const layerId = sm.getState().children[0].id;

      // Fondo de 200x200 enmascarado por un rectángulo pequeño de 50x50 en (0, 0)
      const bigRect: Rectangle = {
        id: 'rect-bg',
        type: 'rectangle',
        name: 'Fondo',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      };
      const maskRect: Rectangle = {
        id: 'rect-mask',
        type: 'rectangle',
        name: 'Máscara',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      };

      const clipGroup: Group = {
        id: 'group-clipped',
        type: 'group',
        name: 'Clipped',
        isClipMask: true,
        clipChildId: 'rect-mask',
        children: [bigRect, maskRect],
      };

      sm.addNode(layerId, clipGroup);

      // Punto dentro de la máscara (25, 25) -> detecta la figura
      const hitInside = ic.hitTest(25, 25);
      assert.ok(hitInside !== null);
      assert.strictEqual(ic.resolveNodeToSelect(hitInside).id, 'group-clipped');

      // Punto fuera de la máscara pero dentro del fondo grande (150, 150) -> NO detecta nada
      const hitOutside = ic.hitTest(150, 150);
      assert.strictEqual(hitOutside, null);

      ic.destroy();
    });

    it('makeClipMask y releaseClipMask en InputController ejecutan comandos con atajos de teclado', () => {
      const sm = new StateManager();
      const cm = new CommandManager();
      const canvas = createMockCanvas();
      const ic = new InputController(canvas, sm, cm);
      const layerId = sm.getState().children[0].id;

      sm.addShape(layerId, {
        id: 's1',
        type: 'rectangle',
        name: 'S1',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
      });
      sm.addShape(layerId, {
        id: 's2',
        type: 'rectangle',
        name: 'S2',
        x: 20,
        y: 20,
        width: 50,
        height: 50,
      });
      sm.setSelection(['s1', 's2']);

      // Atajo Ctrl+7 -> crear máscara
      ic.handleKeyDown({
        key: '7',
        code: 'Digit7',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      const sel = sm.getSelection();
      assert.strictEqual(sel.length, 1);
      const grp = sm.findNode(sel[0]) as Group;
      assert.ok(grp && isGroup(grp));
      assert.strictEqual(grp.isClipMask, true);

      // Atajo Ctrl+Alt+7 -> soltar máscara
      ic.handleKeyDown({
        key: '7',
        code: 'Digit7',
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.deepStrictEqual(sm.getSelection(), ['s1', 's2']);

      ic.destroy();
    });
  });

  describe('4. Renderizado Canvas 2D en RenderEngine', () => {
    it('RenderEngine ejecuta traceShapeClip sobre la máscara y aplica ctx.clip al renderizar el grupo', () => {
      const sm = new StateManager();
      const canvas = createMockCanvas();
      const engine = new RenderEngine(canvas, sm);
      const layerId = sm.getState().children[0].id;

      const contentShape: Rectangle = {
        id: 'content-1',
        type: 'rectangle',
        name: 'Contenido',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        fill: '#38bdf8',
      };
      const maskCircle: Ellipse = {
        id: 'mask-1',
        type: 'ellipse',
        name: 'Máscara',
        x: 100,
        y: 100,
        radiusX: 40,
        radiusY: 40,
      };

      const clipGroup: Group = {
        id: 'clip-render-group',
        type: 'group',
        name: 'Máscara de recorte',
        isClipMask: true,
        clipChildId: 'mask-1',
        children: [contentShape, maskCircle],
      };

      sm.addNode(layerId, clipGroup);
      canvas.calls.length = 0;

      engine.render();

      // Debe incluir beginPath, ellipse y clip
      assert.ok(canvas.calls.includes('beginPath'));
      assert.ok(canvas.calls.includes('ellipse'));
      assert.ok(canvas.calls.some((c) => c.startsWith('clip')));

      engine.destroy();
    });
  });

  describe('5. Exportación e Importación SVG y Ráster', () => {
    it('exportDocumentToSvg emite <clipPath id="..."> en <defs> y aplica clip-path="url(#...)" en <g>', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;

      const starMask: Star = {
        id: 'star-mask',
        type: 'star',
        name: 'Estrella',
        x: 100,
        y: 100,
        outerRadius: 60,
        innerRadius: 30,
        points: 5,
      };
      const rectFill: Rectangle = {
        id: 'rect-fill',
        type: 'rectangle',
        name: 'Relleno',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        fill: '#f59e0b',
      };

      const clipGroup: Group = {
        id: 'svg-clip-group',
        type: 'group',
        name: 'Grupo SVG Clip',
        isClipMask: true,
        clipChildId: 'star-mask',
        children: [rectFill, starMask],
      };

      sm.addNode(layerId, clipGroup);

      const svg = exportDocumentToSvg(sm.getState());

      assert.ok(svg.includes('<defs>'));
      assert.ok(svg.includes('<clipPath id="clip-svg-clip-group">'));
      assert.ok(svg.includes('<polygon')); // la estrella como polígono de corte
      assert.ok(svg.includes('clip-path="url(#clip-svg-clip-group)"'));
      assert.ok(svg.includes('<rect')); // el rectángulo contenido
    });

    it('svgImport reconoce clip-path="url(#...)" e instancia Group con isClipMask y clipChildId', () => {
      const svgCode = `
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
          <defs>
            <clipPath id="my-clip">
              <circle id="clip-circle" cx="150" cy="150" r="50" />
            </clipPath>
          </defs>
          <g id="masked-group" clip-path="url(#my-clip)">
            <rect id="rect-content" x="100" y="100" width="100" height="100" fill="#ff0000" />
          </g>
        </svg>
      `;

      const result = parseSvgString(svgCode);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.shapes.length, 1);

      const importedGroup = result.shapes[0] as Group;
      assert.ok(isGroup(importedGroup));
      assert.strictEqual(importedGroup.isClipMask, true);
      assert.ok(importedGroup.clipChildId !== undefined);
      // Contiene el rect y el shape de corte
      assert.strictEqual(importedGroup.children.length, 2);
    });

    it('renderDocumentToCanvas dibuja el grupo recortado respetando límites de exportación ráster', () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;

      const rectFill: Rectangle = {
        id: 'r-raster',
        type: 'rectangle',
        name: 'R',
        x: 0,
        y: 0,
        width: 300,
        height: 300,
        fill: '#38bdf8',
      };
      const maskPoly: Polygon = {
        id: 'poly-mask',
        type: 'polygon',
        name: 'P',
        x: 100,
        y: 100,
        radius: 40,
        sides: 6,
      };

      const clipGroup: Group = {
        id: 'raster-clip',
        type: 'group',
        name: 'Raster Clip',
        isClipMask: true,
        clipChildId: 'poly-mask',
        children: [rectFill, maskPoly],
      };

      sm.addNode(layerId, clipGroup);

      const bounds = calculateExportBounds(sm.getState(), true, ['raster-clip']);
      // Los límites calculados deben corresponder a la máscara (polígono de radio 40 en 100, 100 -> ~80x80)
      assert.ok(bounds.width < 100);
      assert.ok(bounds.height < 100);

      const mockCanvas = createMockCanvas();
      const origDoc = (globalThis as any).document;
      try {
        (globalThis as any).document = {
          createElement: (tag: string) => {
            if (tag === 'canvas') return mockCanvas;
            return {};
          },
        };
        const canvas = renderDocumentToCanvas(sm.getState(), { onlySelected: true, selectedIds: ['raster-clip'] });
        assert.ok(canvas !== null);
      } finally {
        (globalThis as any).document = origDoc;
      }
    });
  });

  describe('6. Serialización JSON (Serializer)', () => {
    it('serializeDocument y parseDocument preservan isClipMask y clipChildId en grupos', async () => {
      const sm = new StateManager();
      const layerId = sm.getState().children[0].id;

      const r: Rectangle = {
        id: 'json-r',
        type: 'rectangle',
        name: 'R',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
      };
      const star: Star = {
        id: 'json-star',
        type: 'star',
        name: 'S',
        x: 50,
        y: 50,
        outerRadius: 40,
        innerRadius: 20,
        points: 6,
      };

      const clipGroup: Group = {
        id: 'json-clip-group',
        type: 'group',
        name: 'Máscara JSON',
        isClipMask: true,
        clipChildId: 'json-star',
        children: [r, star],
      };

      sm.addNode(layerId, clipGroup);

      const json = serializeDocument(sm.getState());
      const restored = await parseDocument(json);

      const restoredGroup = restored.children[0].children[0] as Group;
      assert.ok(restoredGroup && isGroup(restoredGroup));
      assert.strictEqual(restoredGroup.isClipMask, true);
      assert.strictEqual(restoredGroup.clipChildId, 'json-star');
      assert.strictEqual(restoredGroup.children.length, 2);
    });
  });
});
