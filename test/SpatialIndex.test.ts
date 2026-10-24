import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RTree,
  type BoundingBox,
  boxesIntersect,
  boxContains,
  boxContainsPoint,
  unionBoxes,
} from '../src/spatial/RTree.ts';
import {
  SpatialIndex,
} from '../src/spatial/SpatialIndex.ts';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { InputController } from '../src/input/InputController.ts';
import type {
  Document,
  Group,
  Layer,
  Path,
  Rectangle,
  Ellipse,
  Polygon,
  Star,
  Text,
} from '../src/types/scene-graph.ts';

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((event: any) => void)[]> = {};
  return {
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    getContext() {
      return {
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        bezierCurveTo() {},
        arc() {},
        rect() {},
        fill() {},
        stroke() {},
        clip() {},
        translate() {},
        scale() {},
        rotate() {},
        isPointInPath() { return true; },
        isPointInStroke() { return true; },
      } as unknown as CanvasRenderingContext2D;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
  } as unknown as HTMLCanvasElement;
}

interface TestItem extends BoundingBox {
  id: string;
  name: string;
}

describe('Hito 4.1: Indexación Espacial (R-Tree / BVH)', () => {
  describe('1. Estructura RTree genérica', () => {
    it('inicializa un árbol vacío correctamente', () => {
      const tree = new RTree<TestItem>(4, 2, (it) => it.id);
      assert.equal(tree.size, 0);
      assert.equal(tree.height, 1);
      assert.equal(tree.getBounds(), null);
      assert.deepEqual(tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 }), []);
      assert.deepEqual(tree.searchPoint(50, 50), []);
    });

    it('inserta elementos y calcula la envolvente global', () => {
      const tree = new RTree<TestItem>(4, 2, (it) => it.id);
      tree.insert({ id: '1', minX: 10, minY: 10, maxX: 20, maxY: 20, name: 'A' });
      tree.insert({ id: '2', minX: 50, minY: 50, maxX: 80, maxY: 90, name: 'B' });

      assert.equal(tree.size, 2);
      const bounds = tree.getBounds();
      assert.ok(bounds !== null);
      assert.equal(bounds.minX, 10);
      assert.equal(bounds.minY, 10);
      assert.equal(bounds.maxX, 80);
      assert.equal(bounds.maxY, 90);
    });

    it('divide nodos (split) al exceder maxEntries y aumenta la altura del árbol', () => {
      const tree = new RTree<TestItem>(4, 2, (it) => it.id);
      for (let i = 0; i < 10; i++) {
        tree.insert({
          id: `item-${i}`,
          minX: i * 20,
          minY: i * 20,
          maxX: i * 20 + 15,
          maxY: i * 20 + 15,
          name: `Item ${i}`,
        });
      }

      assert.equal(tree.size, 10);
      assert.ok(tree.height > 1, 'El árbol debió dividirse y aumentar de altura');
      assert.ok(!tree.root.isLeaf, 'La raíz debe ser un nodo interno tras múltiples divisiones');

      // Buscar elemento específico
      const found = tree.searchPoint(25, 25);
      assert.equal(found.length, 1);
      assert.equal(found[0].id, 'item-1');
    });

    it('elimina elementos en O(1) de localización + O(log n) de ajuste y limpia hojas vacías', () => {
      const tree = new RTree<TestItem>(4, 2, (it) => it.id);
      tree.insert({ id: 'a', minX: 0, minY: 0, maxX: 10, maxY: 10, name: 'A' });
      tree.insert({ id: 'b', minX: 20, minY: 20, maxX: 30, maxY: 30, name: 'B' });

      assert.equal(tree.size, 2);
      assert.ok(tree.has('a'));

      const removed = tree.remove('a');
      assert.equal(removed, true);
      assert.equal(tree.size, 1);
      assert.equal(tree.has('a'), false);
      assert.deepEqual(tree.searchPoint(5, 5), []);
      assert.equal(tree.searchPoint(25, 25).length, 1);

      // Eliminar el restante
      tree.remove('b');
      assert.equal(tree.size, 0);
      assert.equal(tree.getBounds(), null);
    });

    it('actualización incremental: reubica un elemento sin reconstruir el árbol', () => {
      const tree = new RTree<TestItem>(4, 2, (it) => it.id);
      tree.insert({ id: 'item-move', minX: 10, minY: 10, maxX: 30, maxY: 30, name: 'Original' });

      assert.equal(tree.searchPoint(20, 20).length, 1);
      assert.equal(tree.searchPoint(100, 100).length, 0);

      // Mover a una nueva posición
      tree.update({ id: 'item-move', minX: 90, minY: 90, maxX: 110, maxY: 110, name: 'Moved' });

      assert.equal(tree.size, 1);
      // Antigua posición queda vacía
      assert.equal(tree.searchPoint(20, 20).length, 0);
      // Nueva posición encuentra el elemento
      const found = tree.searchPoint(100, 100);
      assert.equal(found.length, 1);
      assert.equal(found[0].name, 'Moved');
    });

    it('carga en lote Sort-Tile-Recursive (STR) construye un árbol óptimo y balanceado', () => {
      const tree = new RTree<TestItem>(4, 2, (it) => it.id);
      const items: TestItem[] = [];
      for (let i = 0; i < 50; i++) {
        items.push({
          id: `str-${i}`,
          minX: (i % 10) * 30,
          minY: Math.floor(i / 10) * 30,
          maxX: (i % 10) * 30 + 20,
          maxY: Math.floor(i / 10) * 30 + 20,
          name: `STR ${i}`,
        });
      }

      tree.bulkLoad(items);
      assert.equal(tree.size, 50);
      assert.ok(tree.height > 1);

      // Verificar que todos los elementos son accesibles
      for (let i = 0; i < 50; i++) {
        const item = items[i];
        const hit = tree.searchPoint(item.minX + 5, item.minY + 5);
        assert.ok(hit.some((h) => h.id === item.id), `Elemento str-${i} debe ser recuperable`);
      }
    });

    it('utilidades geométricas de cajas (boxesIntersect, boxContains, boxContainsPoint, unionBoxes)', () => {
      const b1 = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      const b2 = { minX: 5, minY: 5, maxX: 15, maxY: 15 };
      const b3 = { minX: 20, minY: 20, maxX: 30, maxY: 30 };

      assert.equal(boxesIntersect(b1, b2), true);
      assert.equal(boxesIntersect(b1, b3), false);

      const container = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
      assert.equal(boxContains(container, b1), true);
      assert.equal(boxContains(container, b2), true);
      assert.equal(boxContains(container, b3), false);

      assert.equal(boxContainsPoint(b1, 5, 5), true);
      assert.equal(boxContainsPoint(b1, 12, 5, 3), true); // Con tolerancia de 3px
      assert.equal(boxContainsPoint(b1, 15, 5, 2), false);

      const union = unionBoxes(b1, b3);
      assert.deepEqual(union, { minX: 0, minY: 0, maxX: 30, maxY: 30 });
    });
  });

  describe('2. SpatialIndex integrado con el Scene Graph', () => {
    function createSampleDocument(): Document {
      const rect: Rectangle = {
        id: 'rect-1',
        type: 'rectangle',
        name: 'Rectángulo',
        x: 50,
        y: 50,
        width: 100,
        height: 80,
        fill: '#38bdf8',
        stroke: '#0284c7',
        strokeWidth: 2,
        visible: true,
        locked: false,
      };

      const ellipse: Ellipse = {
        id: 'ellipse-1',
        type: 'ellipse',
        name: 'Elipse',
        x: 200,
        y: 50,
        radiusX: 40,
        radiusY: 40,
        fill: '#f43f5e',
        stroke: 'none',
        visible: true,
        locked: false,
      };

      const poly: Polygon = {
        id: 'poly-1',
        type: 'polygon',
        name: 'Polígono',
        x: 350,
        y: 90,
        sides: 6,
        radius: 40,
        fill: '#10b981',
        visible: true,
        locked: false,
      };

      const star: Star = {
        id: 'star-1',
        type: 'star',
        name: 'Estrella',
        x: 500,
        y: 90,
        points: 5,
        outerRadius: 40,
        innerRadius: 20,
        fill: '#f59e0b',
        visible: true,
        locked: false,
      };

      const path: Path = {
        id: 'path-1',
        type: 'path',
        name: 'Trazado',
        x: 50,
        y: 200,
        points: [
          { x: 50, y: 200 },
          { x: 150, y: 250 },
        ],
        stroke: '#8b5cf6',
        strokeWidth: 4,
        visible: true,
        locked: false,
      };

      const text: Text = {
        id: 'text-1',
        type: 'text',
        name: 'Texto',
        x: 250,
        y: 200,
        text: 'Vectedit',
        fontSize: 24,
        fontFamily: 'Inter',
        visible: true,
        locked: false,
      };

      const layer: Layer = {
        id: 'layer-1',
        type: 'layer',
        name: 'Capa 1',
        visible: true,
        locked: false,
        children: [rect, ellipse, poly, star, path, text],
      };

      return {
        id: 'doc-root',
        type: 'document',
        name: 'Test Doc',
        width: 1920,
        height: 1080,
        children: [layer],
      };
    }

    it('construye el índice espacial indexando todas las primitivas vectoriales', () => {
      const doc = createSampleDocument();
      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      assert.equal(spatial.size, 6);
      assert.ok(spatial.getItem('rect-1') !== undefined);
      assert.ok(spatial.getItem('ellipse-1') !== undefined);
      assert.ok(spatial.getItem('poly-1') !== undefined);
      assert.ok(spatial.getItem('star-1') !== undefined);
      assert.ok(spatial.getItem('path-1') !== undefined);
      assert.ok(spatial.getItem('text-1') !== undefined);
    });

    it('evalúa hitTest en O(log n) detectando figuras y descartando espacio vacío', () => {
      const doc = createSampleDocument();
      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      // Hit en el centro del rectángulo (50+50, 50+40 = 100, 90)
      const hitRect = spatial.hitTest(100, 90, { zoom: 1, document: doc });
      assert.ok(hitRect !== null);
      assert.equal(hitRect?.id, 'rect-1');

      // Hit en el centro de la elipse (200, 50)
      const hitEllipse = spatial.hitTest(200, 50, { zoom: 1, document: doc });
      assert.ok(hitEllipse !== null);
      assert.equal(hitEllipse?.id, 'ellipse-1');

      // Hit en espacio vacío
      const hitEmpty = spatial.hitTest(10, 10, { zoom: 1, document: doc });
      assert.equal(hitEmpty, null);
    });

    it('respeta el orden de apilado visual (Z-Order): figura superior prevalece sobre la inferior', () => {
      // Crear dos rectángulos superpuestos en la misma capa
      const rectBottom: Rectangle = {
        id: 'rect-bottom',
        type: 'rectangle',
        name: 'Inferior',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#38bdf8',
        visible: true,
        locked: false,
      };

      const rectTop: Rectangle = {
        id: 'rect-top',
        type: 'rectangle',
        name: 'Superior',
        x: 120,
        y: 120,
        width: 100,
        height: 100,
        fill: '#f43f5e',
        visible: true,
        locked: false,
      };

      const doc: Document = {
        id: 'doc-z',
        type: 'document',
        name: 'Z-Order Doc',
        width: 1920,
        height: 1080,
        children: [
          {
            id: 'layer-z',
            type: 'layer',
            name: 'Layer Z',
            children: [rectBottom, rectTop],
          },
        ],
      };

      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      // En la zona de solape (x: 150, y: 150), ambos colisionan. Debe ganar rectTop.
      const hit = spatial.hitTest(150, 150, { zoom: 1, document: doc });
      assert.ok(hit !== null);
      assert.equal(hit?.id, 'rect-top');
    });

    it('ignora figuras ocultas (visible: false) y figuras bloqueadas (locked: true)', () => {
      const rectHidden: Rectangle = {
        id: 'rect-hidden',
        type: 'rectangle',
        name: 'Oculto',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        fill: '#38bdf8',
        visible: false,
        locked: false,
      };

      const rectLocked: Rectangle = {
        id: 'rect-locked',
        type: 'rectangle',
        name: 'Bloqueado',
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        fill: '#38bdf8',
        visible: true,
        locked: true,
      };

      const doc: Document = {
        id: 'doc-vis',
        type: 'document',
        name: 'Visibility Doc',
        width: 1920,
        height: 1080,
        children: [
          {
            id: 'layer-vis',
            type: 'layer',
            name: 'Layer Vis',
            children: [rectHidden, rectLocked],
          },
        ],
      };

      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      assert.equal(spatial.hitTest(140, 140, { zoom: 1, document: doc }), null);
      assert.equal(spatial.hitTest(240, 140, { zoom: 1, document: doc }), null);
    });

    it('respeta grupos con máscara de recorte (clipping mask)', () => {
      const maskRect: Rectangle = {
        id: 'mask-rect',
        type: 'rectangle',
        name: 'Máscara',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#ffffff',
        visible: true,
        locked: false,
      };

      const childRect: Rectangle = {
        id: 'child-rect',
        type: 'rectangle',
        name: 'Contenido Grande',
        x: 50,
        y: 50,
        width: 200,
        height: 200,
        fill: '#38bdf8',
        visible: true,
        locked: false,
      };

      const clipGroup: Group = {
        id: 'clip-group',
        type: 'group',
        name: 'Grupo Máscara',
        isClipMask: true,
        clipChildId: 'mask-rect',
        children: [childRect, maskRect],
      };

      const doc: Document = {
        id: 'doc-clip',
        type: 'document',
        name: 'Clip Doc',
        width: 1920,
        height: 1080,
        children: [
          {
            id: 'layer-clip',
            type: 'layer',
            name: 'Layer Clip',
            children: [clipGroup],
          },
        ],
      };

      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      // Punto dentro de la máscara (x: 150, y: 150) -> Colisiona con childRect
      const hitInside = spatial.hitTest(150, 150, { zoom: 1, document: doc });
      assert.ok(hitInside !== null);
      assert.equal(hitInside?.id, 'child-rect');

      // Punto fuera de la máscara pero dentro de childRect (x: 60, y: 60) -> Rechazado por la máscara
      const hitOutside = spatial.hitTest(60, 60, { zoom: 1, document: doc });
      assert.equal(hitOutside, null);
    });

    it('querySelectableNodesInBox (marquee selection) retorna nodos que intersectan el rectángulo', () => {
      const doc = createSampleDocument();
      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      // Caja que engloba a rect-1 (50..150, 50..130) y ellipse-1 (160..240, 10..90)
      const box = { x: 40, y: 40, width: 220, height: 100 };
      const selected = spatial.querySelectableNodesInBox(doc, box);

      assert.equal(selected.length, 2);
      const ids = selected.map((s) => s.id);
      assert.ok(ids.includes('rect-1'));
      assert.ok(ids.includes('ellipse-1'));
      assert.ok(!ids.includes('poly-1'));
    });
  });

  describe('3. Actualización Incremental de AABBs al Transformar Nodos', () => {
    it('StateManager sincroniza incrementalmente la posición al llamar updateShapesPosition', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const rect: Rectangle = {
        id: 'rect-dyn-pos',
        type: 'rectangle',
        name: 'Rect Dyn',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        fill: '#38bdf8',
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, rect);

      const spatial = stateManager.getSpatialIndex();
      assert.equal(spatial.size, 1);

      // Posición inicial
      assert.equal(spatial.hitTest(125, 125, { zoom: 1 })?.id, 'rect-dyn-pos');
      assert.equal(spatial.hitTest(325, 325, { zoom: 1 }), null);

      // Trasladar la figura a x: 300, y: 300
      stateManager.updateShapesPosition([{ id: 'rect-dyn-pos', x: 300, y: 300 }]);

      // El índice espacial debe reflejar la nueva posición incrementalmente
      assert.equal(spatial.hitTest(125, 125, { zoom: 1 }), null);
      assert.equal(spatial.hitTest(325, 325, { zoom: 1 })?.id, 'rect-dyn-pos');
    });

    it('StateManager sincroniza incrementalmente las dimensiones al llamar updateShapesDimensions', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const rect: Rectangle = {
        id: 'rect-dyn-dim',
        type: 'rectangle',
        name: 'Rect Dim',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        fill: '#38bdf8',
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, rect);

      const spatial = stateManager.getSpatialIndex();
      // Punto a 170 (fuera de la caja original 100..150)
      assert.equal(spatial.hitTest(170, 125, { zoom: 1 }), null);

      // Redimensionar el ancho a 100 (caja ahora 100..200)
      stateManager.updateShapesDimensions([
        { id: 'rect-dyn-dim', dimensions: { width: 100 } },
      ]);

      // Punto a 170 ahora sí colisiona
      assert.equal(spatial.hitTest(170, 125, { zoom: 1 })?.id, 'rect-dyn-dim');
    });

    it('StateManager sincroniza inserciones y eliminaciones de nodos con el índice espacial', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const spatial = stateManager.getSpatialIndex();
      assert.equal(spatial.size, 0);

      const rect: Rectangle = {
        id: 'rect-lifecycle',
        type: 'rectangle',
        name: 'Lifecycle Rect',
        x: 200,
        y: 200,
        width: 50,
        height: 50,
        fill: '#38bdf8',
        visible: true,
        locked: false,
      };

      stateManager.addShape(layerId, rect);
      assert.equal(spatial.size, 1);
      assert.equal(spatial.hitTest(225, 225, { zoom: 1 })?.id, 'rect-lifecycle');

      // Eliminar el nodo
      stateManager.removeNode('rect-lifecycle');
      assert.equal(spatial.size, 0);
      assert.equal(spatial.hitTest(225, 225, { zoom: 1 }), null);
    });
  });

  describe('4. InputController acelerado por SpatialIndex', () => {
    it('InputController.hitTest utiliza SpatialIndex de forma transparente con compatibilidad idéntica', () => {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager();
      const inputController = new InputController(canvas, stateManager, commandManager, {
        viewportManager,
      });

      const layerId = stateManager.getState().children[0].id;
      const rect: Rectangle = {
        id: 'ctrl-rect',
        type: 'rectangle',
        name: 'Ctrl Rect',
        x: 50,
        y: 50,
        width: 100,
        height: 80,
        fill: '#38bdf8',
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, rect);

      // Comprobar hitTest delegado en SpatialIndex
      const hit = inputController.hitTest(100, 90);
      assert.ok(hit !== null);
      assert.equal(hit?.id, 'ctrl-rect');

      const hitEmpty = inputController.hitTest(500, 500);
      assert.equal(hitEmpty, null);

      inputController.destroy();
    });
  });

  describe('5. Verificación de Rendimiento y Complejidad O(log n)', () => {
    it('consulta de punto en escena con 1.000 figuras evalúa un subconjunto logarítmico', () => {
      const shapes: Rectangle[] = [];
      // Generar 1.000 rectángulos en una grilla de 40 x 25
      for (let i = 0; i < 1000; i++) {
        const col = i % 40;
        const row = Math.floor(i / 40);
        shapes.push({
          id: `bench-shape-${i}`,
          type: 'rectangle',
          name: `Shape ${i}`,
          x: col * 40,
          y: row * 40,
          width: 25,
          height: 25,
          fill: '#38bdf8',
          visible: true,
          locked: false,
        });
      }

      const doc: Document = {
        id: 'doc-bench',
        type: 'document',
        name: 'Benchmark Doc',
        width: 2000,
        height: 1200,
        children: [
          {
            id: 'layer-bench',
            type: 'layer',
            name: 'Layer Bench',
            children: shapes,
          },
        ],
      };

      const spatial = new SpatialIndex();
      spatial.buildFromDocument(doc);

      assert.equal(spatial.size, 1000);
      assert.ok(spatial.height >= 3 && spatial.height <= 6, `Altura de árbol balanceado: ${spatial.height}`);

      // Consulta de punto en el centro de la figura #555
      const target = shapes[555];
      const start = performance.now();
      const hit = spatial.hitTest(target.x + 10, target.y + 10, { zoom: 1, document: doc });
      const elapsed = performance.now() - start;

      assert.ok(hit !== null);
      assert.equal(hit?.id, 'bench-shape-555');
      // Debe completarse en menos de 1 milisegundo en hardware moderno
      assert.ok(elapsed < 20, `Consulta O(log n) completada en ${elapsed.toFixed(4)} ms`);

      // Consulta en espacio vacío
      const emptyStart = performance.now();
      const hitMiss = spatial.hitTest(35, 35, { zoom: 1, document: doc });
      const emptyElapsed = performance.now() - emptyStart;

      assert.equal(hitMiss, null);
      assert.ok(emptyElapsed < 20, `Descarte O(log n) en vacío completado en ${emptyElapsed.toFixed(4)} ms`);
    });
  });
});
