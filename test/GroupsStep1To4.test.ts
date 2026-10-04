import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager, getLeafShapes } from '../src/state/StateManager.ts';
import { findNodeById, findParentOfNode } from '../src/utils/immutable.ts';
import {
  getGroupAABB,
  getNodeAABB,
  getSelectionBounds,
  getShapesIntersectingRect,
  groupAABBCache,
} from '../src/utils/geometry.ts';
import {
  parseDocument,
  serializeDocument,
  DocumentParseError,
} from '../src/state/Serializer.ts';
import type {
  Document,
  Group,
  Layer,
  Rectangle,
} from '../src/types/scene-graph.ts';

describe('Pasos 1 a 4: Soporte de Grupos en el Vector Editor', () => {
  // Helper para construir un árbol de prueba de 3 niveles de profundidad
  function create3LevelDocument(): {
    doc: Document;
    layer: Layer;
    g1: Group;
    g2: Group;
    s1: Rectangle;
    s2: Rectangle;
    s3: Rectangle;
  } {
    const s1: Rectangle = {
      id: 's1',
      type: 'rectangle',
      name: 'Rect 1',
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    };
    const s2: Rectangle = {
      id: 's2',
      type: 'rectangle',
      name: 'Rect 2',
      x: 50,
      y: 40,
      width: 10,
      height: 20,
    };
    const s3: Rectangle = {
      id: 's3',
      type: 'rectangle',
      name: 'Rect 3',
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    };

    const g2: Group = {
      id: 'g2',
      type: 'group',
      name: 'Subgrupo Nivel 3',
      children: [s1, s2],
    };

    const g1: Group = {
      id: 'g1',
      type: 'group',
      name: 'Grupo Nivel 2',
      children: [g2, s3],
    };

    const layer: Layer = {
      id: 'layer-1',
      type: 'layer',
      name: 'Capa 1',
      children: [g1],
    };

    const doc: Document = {
      id: 'doc-root',
      type: 'document',
      name: 'Doc Test',
      width: 800,
      height: 600,
      children: [layer],
    };

    return { doc, layer, g1, g2, s1, s2, s3 };
  }

  describe('1. Índice de Documento y Búsqueda Recursiva', () => {
    it('nodeMap y parentMap indexan correctamente 3 niveles de jerarquía en O(1)', () => {
      const { doc } = create3LevelDocument();
      const manager = new StateManager(doc);

      // Verificación de existencia y recuperación en O(1) de todos los nodos
      assert.equal(manager.findNode('doc-root')?.type, 'document');
      assert.equal(manager.findNode('layer-1')?.type, 'layer');
      assert.equal(manager.findNode('g1')?.type, 'group');
      assert.equal(manager.findNode('g2')?.type, 'group');
      assert.equal(manager.findNode('s1')?.type, 'rectangle');
      assert.equal(manager.findNode('s2')?.type, 'rectangle');
      assert.equal(manager.findNode('s3')?.type, 'rectangle');
      assert.equal(manager.findNode('inexistente'), null);

      // Verificación de parentMap recursivo
      assert.equal(manager.findParent('layer-1')?.id, 'doc-root');
      assert.equal(manager.findParent('g1')?.id, 'layer-1');
      assert.equal(manager.findParent('g2')?.id, 'g1');
      assert.equal(manager.findParent('s3')?.id, 'g1');
      assert.equal(manager.findParent('s1')?.id, 'g2');
      assert.equal(manager.findParent('s2')?.id, 'g2');
      assert.equal(manager.findParent('doc-root'), null);
    });

    it('findNodeById y findParentOfNode en immutable.ts recorren recursivamente grupos anidados', () => {
      const { doc } = create3LevelDocument();

      assert.equal(findNodeById(doc, 's1')?.id, 's1');
      assert.equal(findNodeById(doc, 'g2')?.id, 'g2');
      assert.equal(findNodeById(doc, 'no-id'), null);

      assert.equal(findParentOfNode(doc, 's1')?.id, 'g2');
      assert.equal(findParentOfNode(doc, 'g2')?.id, 'g1');
      assert.equal(findParentOfNode(doc, 'g1')?.id, 'layer-1');
    });
  });

  describe('2. Normalización de la Selección', () => {
    it('setSelection no permite coexistencia de ancestro y descendiente (prevalece ancestro)', () => {
      const { doc } = create3LevelDocument();
      const manager = new StateManager(doc);

      // Ancestor g1 y descendant s1 pasados juntos: s1 se descarta
      manager.setSelection(['g1', 's1']);
      assert.deepEqual(manager.getSelection(), ['g1']);

      // Subgrupo g2 y su hijo s1: s1 se descarta
      manager.setSelection(['s1', 'g2']);
      assert.deepEqual(manager.getSelection(), ['g2']);

      // Ancestro g1 y subgrupo g2: g2 se descarta
      manager.setSelection(['g1', 'g2', 's3']);
      assert.deepEqual(manager.getSelection(), ['g1']);
    });

    it('addToSelection descarta descendientes si se agrega un ancestro e ignora descendientes si el ancestro ya está seleccionado', () => {
      const { doc } = create3LevelDocument();
      const manager = new StateManager(doc);

      // 1. Iniciar con s1 seleccionado. Al añadir g1, s1 se descarta y queda g1
      manager.setSelection(['s1']);
      assert.deepEqual(manager.getSelection(), ['s1']);

      manager.addToSelection(['g1']);
      assert.deepEqual(manager.getSelection(), ['g1']);

      // 2. Con g1 ya seleccionado, intentar añadir su descendiente s2 se ignora
      let notifyCount = 0;
      manager.subscribe(() => notifyCount++);
      manager.addToSelection(['s2']);
      assert.deepEqual(manager.getSelection(), ['g1']);
      assert.equal(notifyCount, 0, 'No debe notificar si se ignora la selección de descendiente');
    });

    it('toggleInSelection respeta la jerarquía en los tres casos', () => {
      const { doc } = create3LevelDocument();
      const manager = new StateManager(doc);

      // Caso 1: Quitar nodo seleccionado
      manager.setSelection(['g1']);
      manager.toggleInSelection('g1');
      assert.deepEqual(manager.getSelection(), []);

      // Caso 2: Si el ancestro g1 está seleccionado, conmutar un descendiente s1 se ignora
      manager.setSelection(['g1']);
      manager.toggleInSelection('s1');
      assert.deepEqual(manager.getSelection(), ['g1']);

      // Caso 3: Si s1 y s3 están seleccionados, al conmutar el ancestro g1, se eliminan s1 y s3 y queda g1
      manager.setSelection(['s1', 's3']);
      assert.deepEqual(manager.getSelection(), ['s1', 's3']);
      manager.toggleInSelection('g1');
      assert.deepEqual(manager.getSelection(), ['g1']);
    });
  });

  describe('3. selectAll y Helpers de Visibilidad/Bloqueo Efectivo', () => {
    it('selectAll selecciona elementos de primer nivel de cada capa excluyendo efectivamente ocultos o bloqueados', () => {
      const sVisible: Rectangle = {
        id: 's-vis',
        type: 'rectangle',
        name: 'Visible',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      };
      const gVisible: Group = {
        id: 'g-vis',
        type: 'group',
        name: 'Grupo Visible',
        children: [
          { id: 's-in-g', type: 'rectangle', name: 'In G', x: 0, y: 0, width: 5, height: 5 },
        ],
      };
      const gHidden: Group = {
        id: 'g-hid',
        type: 'group',
        name: 'Grupo Oculto',
        visible: false,
        children: [
          { id: 's-in-hid', type: 'rectangle', name: 'In Hid', x: 0, y: 0, width: 5, height: 5 },
        ],
      };
      const gLocked: Group = {
        id: 'g-lock',
        type: 'group',
        name: 'Grupo Bloqueado',
        locked: true,
        children: [
          { id: 's-in-lock', type: 'rectangle', name: 'In Lock', x: 0, y: 0, width: 5, height: 5 },
        ],
      };

      const layer1: Layer = {
        id: 'l1',
        type: 'layer',
        name: 'Capa 1',
        children: [sVisible, gVisible, gHidden, gLocked],
      };

      const layerHidden: Layer = {
        id: 'l-hid',
        type: 'layer',
        name: 'Capa Oculta',
        visible: false,
        children: [
          { id: 's-in-lhid', type: 'rectangle', name: 'En Capa Oculta', x: 0, y: 0, width: 5, height: 5 },
        ],
      };

      const doc: Document = {
        id: 'doc-root',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [layer1, layerHidden],
      };

      const manager = new StateManager(doc);

      // Verificación de helpers isEffectivelyVisible e isEffectivelyLocked
      assert.equal(manager.isEffectivelyVisible('s-vis'), true);
      assert.equal(manager.isEffectivelyVisible('g-vis'), true);
      assert.equal(manager.isEffectivelyVisible('s-in-g'), true);
      assert.equal(manager.isEffectivelyVisible('g-hid'), false);
      assert.equal(manager.isEffectivelyVisible('s-in-hid'), false); // Hereda de g-hid
      assert.equal(manager.isEffectivelyVisible('s-in-lhid'), false); // Hereda de layerHidden

      assert.equal(manager.isEffectivelyLocked('g-lock'), true);
      assert.equal(manager.isEffectivelyLocked('s-in-lock'), true); // Hereda de g-lock
      assert.equal(manager.isEffectivelyLocked('s-vis'), false);

      // selectAll debe seleccionar solo los elementos raíz de layer1: sVisible y gVisible
      manager.selectAll();
      assert.deepEqual(manager.getSelection(), ['s-vis', 'g-vis']);
    });
  });

  describe('4. getLeafShapes', () => {
    it('expande grupos recursivamente a figuras hoja sin duplicados y preservando orden de apilado', () => {
      const { g1, g2, s1 } = create3LevelDocument();
      const s4: Rectangle = { id: 's4', type: 'rectangle', name: 'R4', x: 0, y: 0, width: 5, height: 5 };

      // Expansión de g1: g1 tiene [g2 (s1, s2), s3] -> [s1, s2, s3]
      const leaves = getLeafShapes([g1, s4]);
      assert.deepEqual(
        leaves.map((s) => s.id),
        ['s1', 's2', 's3', 's4']
      );

      // Si se pasa un nodo repetido o un ancestro junto con su descendiente: sin duplicados
      const leavesDeduplicated = getLeafShapes([g1, g2, s1]);
      assert.deepEqual(
        leavesDeduplicated.map((s) => s.id),
        ['s1', 's2', 's3']
      );
    });
  });

  describe('5. getEmptiedAncestors', () => {
    it('devuelve de abajo hacia arriba los grupos que quedarían vacíos al retirar nodos', () => {
      const { doc } = create3LevelDocument();
      const manager = new StateManager(doc);

      // Retirar solo s1: g2 todavía tiene s2 -> ninguno queda vacío
      assert.deepEqual(manager.getEmptiedAncestors(['s1']), []);

      // Retirar s1 y s2: g2 queda vacío, pero g1 todavía tiene s3
      const emptiedG2 = manager.getEmptiedAncestors(['s1', 's2']);
      assert.equal(emptiedG2.length, 1);
      assert.equal(emptiedG2[0].id, 'g2');

      // Retirar s1, s2 y s3: g2 queda vacío y en cascada g1 queda vacío
      const emptiedAll = manager.getEmptiedAncestors(['s1', 's2', 's3']);
      assert.equal(emptiedAll.length, 2);
      // Orden de abajo hacia arriba: g2 (más profundo) antes que g1
      assert.equal(emptiedAll[0].id, 'g2');
      assert.equal(emptiedAll[1].id, 'g1');
    });
  });

  describe('6. updateShapesPosition con Grupos Anidados y Estructura Compartida', () => {
    it('actualiza figuras dentro de grupos anidados compartiendo ramas no modificadas y con 1 sola notificación', () => {
      const { doc } = create3LevelDocument();
      // Agregar una segunda rama en la capa con un grupo independiente
      const sIndependent: Rectangle = {
        id: 's-indep',
        type: 'rectangle',
        name: 'Indep',
        x: 200,
        y: 200,
        width: 50,
        height: 50,
      };
      const gIndependent: Group = {
        id: 'g-indep',
        type: 'group',
        name: 'Rama Independiente',
        children: [sIndependent],
      };

      const docMultiBranch: Document = {
        ...doc,
        children: [
          {
            ...doc.children[0],
            children: [...doc.children[0].children, gIndependent],
          },
        ],
      };

      const manager = new StateManager(docMultiBranch);

      let notifyCount = 0;
      manager.subscribe(() => notifyCount++);

      const initialDoc = manager.getState();
      const initialLayer = initialDoc.children[0];
      const initialGIndep = initialLayer.children[1];
      const initialS2 = ((initialLayer.children[0] as Group).children[0] as Group).children[1];

      // Mover únicamente s1 de (10, 10) a (15, 25)
      const updated = manager.updateShapesPosition([{ id: 's1', x: 15, y: 25 }]);
      assert.equal(updated, true);
      assert.equal(notifyCount, 1, 'Debe emitir exactamente una notificación');

      const nextDoc = manager.getState();
      const nextLayer = nextDoc.children[0];
      const nextG1 = nextLayer.children[0] as Group;
      const nextG2 = nextG1.children[0] as Group;
      const nextS1 = nextG2.children[0] as Rectangle;
      const nextS2 = nextG2.children[1] as Rectangle;
      const nextGIndep = nextLayer.children[1] as Group;

      // 1. s1 se actualizó
      assert.equal(nextS1.x, 15);
      assert.equal(nextS1.y, 25);

      // 2. Estructura compartida: s2 no modificado conserva exactamente su identidad de referencia
      assert.equal(nextS2, initialS2, 's2 debe conservar la misma referencia');

      // 3. Estructura compartida: la rama gIndependent no modificada conserva su referencia
      assert.equal(nextGIndep, initialGIndep, 'gIndependent debe conservar la misma referencia');

      // 4. Los ancestros de s1 fueron recreados inmutablemente
      assert.notEqual(nextG2, doc.children[0].children[0]);
      assert.notEqual(nextG1, doc.children[0].children[0]);
    });
  });

  describe('7. Geometría: getNodeAABB, getGroupAABB y Cache de AABB', () => {
    it('getGroupAABB calcula la unión correcta y almacena en groupAABBCache', () => {
      const { g2, s1 } = create3LevelDocument();
      // s1: [10, 10, w=20, h=30] -> minX=10, minY=10, maxX=30, maxY=40
      // s2: [50, 40, w=10, h=20] -> minX=50, minY=40, maxX=60, maxY=60
      // g2 AABB esperado: minX=10, minY=10, maxX=60, maxY=60 -> width=50, height=50

      assert.equal(groupAABBCache.has(g2), false);

      const aabb = getGroupAABB(g2);
      assert.equal(aabb.minX, 10);
      assert.equal(aabb.minY, 10);
      assert.equal(aabb.maxX, 60);
      assert.equal(aabb.maxY, 60);
      assert.equal(aabb.width, 50);
      assert.equal(aabb.height, 50);

      // Ahora debe estar en la caché
      assert.equal(groupAABBCache.has(g2), true);
      assert.equal(getGroupAABB(g2), aabb, 'Debe devolver la misma instancia en O(1)');

      // getNodeAABB delega correctamente
      assert.deepEqual(getNodeAABB(g2), aabb);
      assert.deepEqual(getNodeAABB(s1).width, 20);
    });

    it('mover una figura crea un nuevo grupo e invalida automáticamente la caché de la referencia previa', () => {
      const { doc } = create3LevelDocument();
      const manager = new StateManager(doc);

      const oldG1 = manager.findNode('g1') as Group;
      const oldG2 = manager.findNode('g2') as Group;

      // Calcular y poblar caché
      const oldAABB = getGroupAABB(oldG2);
      assert.ok(oldAABB);
      assert.equal(groupAABBCache.has(oldG2), true);

      // Mover s1: crea nuevas referencias para g2 y g1
      manager.updateShapesPosition([{ id: 's1', x: 0, y: 0 }]);

      const newG2 = manager.findNode('g2') as Group;
      const newG1 = manager.findNode('g1') as Group;
      assert.notEqual(newG2, oldG2);
      assert.notEqual(newG1, oldG1);

      // La nueva referencia no está aún en caché
      assert.equal(groupAABBCache.has(newG2), false);

      const newAABB = getGroupAABB(newG2);
      assert.equal(newAABB.minX, 0); // Desplazado
      assert.equal(groupAABBCache.has(newG2), true);
    });

    it('getSelectionBounds y getShapesIntersectingRect soportan SelectableNode (grupos)', () => {
      const { g1 } = create3LevelDocument();

      const bounds = getSelectionBounds([g1]);
      assert.ok(bounds);
      assert.equal(bounds.minX, 10);
      assert.equal(bounds.maxX, 140); // s3 llega hasta 100+40 = 140

      // Rectángulo que toca solo a g1 (en x=5..15, y=5..15)
      const intersecting = getShapesIntersectingRect([g1], { x: 5, y: 5, width: 10, height: 10 });
      assert.equal(intersecting.length, 1);
      assert.equal(intersecting[0].id, 'g1');

      // Rectángulo lejano que no intersecta
      const none = getShapesIntersectingRect([g1], { x: 500, y: 500, width: 10, height: 10 });
      assert.equal(none.length, 0);
    });
  });

  describe('8. Serializer con Grupos', () => {
    it('serializeDocument y parseDocument completan el ciclo roundtrip con grupos anidados', async () => {
      const { doc } = create3LevelDocument();

      const json = serializeDocument(doc, true);
      const parsed = await parseDocument(json);

      assert.equal(parsed.id, doc.id);
      assert.equal(parsed.children.length, 1);

      const parsedLayer = parsed.children[0];
      assert.equal(parsedLayer.children.length, 1);

      const parsedG1 = parsedLayer.children[0] as Group;
      assert.equal(parsedG1.type, 'group');
      assert.equal(parsedG1.name, 'Grupo Nivel 2');
      assert.equal(parsedG1.children.length, 2);

      const parsedG2 = parsedG1.children[0] as Group;
      assert.equal(parsedG2.type, 'group');
      assert.equal(parsedG2.children.length, 2);

      const parsedS1 = parsedG2.children[0] as Rectangle;
      assert.equal(parsedS1.id, 's1');
      assert.equal(parsedS1.x, 10);
    });

    it('lanza DocumentParseError si un grupo está vacío', async () => {
      const emptyGroupDoc = {
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer 1',
            children: [
              {
                id: 'g-empty',
                type: 'group',
                name: 'Grupo Vacío',
                children: [],
              },
            ],
          },
        ],
      };

      await assert.rejects(
        async () => {
          await parseDocument(JSON.stringify(emptyGroupDoc));
        },
        (err: unknown) => {
          assert.ok(err instanceof DocumentParseError);
          assert.match(
            (err as Error).message,
            /children\[0\]\.children\[0\]\.children no puede estar vacío/
          );
          return true;
        }
      );
    });

    it('lanza DocumentParseError si existe un ID duplicado entre grupo y figura con ruta exacta', async () => {
      const duplicateIdDoc = {
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer 1',
            children: [
              {
                id: 'shared-id',
                type: 'group',
                name: 'Grupo',
                children: [
                  {
                    id: 'shared-id',
                    type: 'rectangle',
                    name: 'Rect con mismo ID',
                    x: 10,
                    y: 10,
                    width: 20,
                    height: 20,
                  },
                ],
              },
            ],
          },
        ],
      };

      await assert.rejects(
        async () => {
          await parseDocument(JSON.stringify(duplicateIdDoc));
        },
        (err: unknown) => {
          assert.ok(err instanceof DocumentParseError);
          assert.match(
            (err as Error).message,
            /ID duplicado 'shared-id' en children\[0\]\.children\[0\]\.children\[0\]/
          );
          return true;
        }
      );
    });

    it('lanza DocumentParseError si la profundidad de anidamiento excede 32', async () => {
      // Construir 33 niveles de anidamiento
      let currentChild: any = {
        id: 'deep-rect',
        type: 'rectangle',
        name: 'Deep Rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      };

      // 32 grupos anidados: depth layer = 1, primer grupo = 2, ..., grupo 32 = 33
      for (let i = 32; i >= 1; i--) {
        currentChild = {
          id: `g-level-${i}`,
          type: 'group',
          name: `Nivel ${i}`,
          children: [currentChild],
        };
      }

      const deepDoc = {
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer 1',
            children: [currentChild],
          },
        ],
      };

      await assert.rejects(
        async () => {
          await parseDocument(JSON.stringify(deepDoc));
        },
        (err: unknown) => {
          assert.ok(err instanceof DocumentParseError);
          assert.match(
            (err as Error).message,
            /Profundidad máxima de anidamiento \(32\) excedida/
          );
          return true;
        }
      );
    });

    it('valida que opacity en un grupo sea numérico finito si existe', async () => {
      const invalidOpacityDoc = {
        id: 'doc-1',
        type: 'document',
        name: 'Doc',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Layer 1',
            children: [
              {
                id: 'g1',
                type: 'group',
                name: 'G',
                opacity: 'semi',
                children: [
                  {
                    id: 'r1',
                    type: 'rectangle',
                    name: 'R1',
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                  },
                ],
              },
            ],
          },
        ],
      };

      await assert.rejects(
        async () => {
          await parseDocument(JSON.stringify(invalidOpacityDoc));
        },
        (err: unknown) => {
          assert.ok(err instanceof DocumentParseError);
          assert.match(
            (err as Error).message,
            /children\[0\]\.children\[0\]\.opacity debe ser un número finito/
          );
          return true;
        }
      );
    });
  });
});
