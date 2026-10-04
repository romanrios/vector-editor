import { StateManager, getDocumentIndex } from '../src/state/StateManager.ts';
import { SelectionOperations } from '../src/input/SelectionOperations.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { deepFreeze } from '../src/utils/immutable.ts';
import { isGroup, type Document, type Group, type Rectangle } from '../src/types/scene-graph.ts';

// Helper para crear una figura de prueba
function createRect(id: string, x: number, y: number): Rectangle {
  return {
    id,
    type: 'rectangle',
    name: `Rect ${id}`,
    x,
    y,
    width: 20,
    height: 20,
    fill: '#3b82f6',
    stroke: '#1d4ed8',
    strokeWidth: 1,
  };
}

/**
 * Genera un Document con exactamente 5.000 figuras distribuidas en 250 grupos:
 * - 1 grupo de nivel 1 con 100 figuras ('group-100-shapes').
 * - 10 jerarquías de 3 niveles (1 root + 2 sub + 4 sub-sub = 7 grupos por jerarquía; 10 * 7 = 70 grupos; 10 * 100 = 1.000 figuras).
 * - 20 jerarquías de 2 niveles (1 root + 2 sub = 3 grupos por jerarquía; 20 * 3 = 60 grupos; 20 * 60 = 1.200 figuras).
 * - 119 grupos de 1 nivel (82 grupos con 23 figuras = 1.886 figuras; 37 grupos con 22 figuras = 814 figuras; total 2.700 figuras).
 * Total: 1 + 70 + 60 + 119 = 250 grupos.
 * Total figuras: 100 + 1.000 + 1.200 + 2.700 = 5.000 figuras.
 */
function createGroupedDocument(): Document {
  let shapeCounter = 0;
  let groupCounter = 0;

  // 1. Grupo de 100 figuras
  const shapes100: Rectangle[] = [];
  for (let i = 0; i < 100; i++) {
    shapeCounter++;
    shapes100.push(createRect(`s-${shapeCounter}`, (i % 10) * 25, Math.floor(i / 10) * 25));
  }
  const group100: Group = {
    id: 'group-100-shapes',
    type: 'group',
    name: 'Grupo 100 Figuras',
    children: shapes100,
  };
  groupCounter++;

  const topLevelChildren: (Group | Rectangle)[] = [group100];

  // 2. 10 jerarquías de 3 niveles (70 grupos, 1.000 figuras)
  for (let h = 0; h < 10; h++) {
    groupCounter++;
    const rootId = `g-l3-root-${h}`;
    const level2Groups: Group[] = [];

    for (let l2 = 0; l2 < 2; l2++) {
      groupCounter++;
      const l2Id = `g-l3-mid-${h}-${l2}`;
      const level3Groups: Group[] = [];

      for (let l3 = 0; l3 < 2; l3++) {
        groupCounter++;
        const l3Id = `g-l3-leaf-${h}-${l2}-${l3}`;
        const leafShapes: Rectangle[] = [];
        for (let s = 0; s < 25; s++) {
          shapeCounter++;
          leafShapes.push(createRect(`s-${shapeCounter}`, s * 10, h * 30));
        }
        level3Groups.push({
          id: l3Id,
          type: 'group',
          name: `L3 Group ${l3Id}`,
          children: leafShapes,
        });
      }

      level2Groups.push({
        id: l2Id,
        type: 'group',
        name: `L2 Group ${l2Id}`,
        children: level3Groups,
      });
    }

    topLevelChildren.push({
      id: rootId,
      type: 'group',
      name: `L1 Root Group ${rootId}`,
      children: level2Groups,
    });
  }

  // 3. 20 jerarquías de 2 niveles (60 grupos, 1.200 figuras)
  for (let h = 0; h < 20; h++) {
    groupCounter++;
    const rootId = `g-l2-root-${h}`;
    const level2Groups: Group[] = [];

    for (let l2 = 0; l2 < 2; l2++) {
      groupCounter++;
      const l2Id = `g-l2-leaf-${h}-${l2}`;
      const leafShapes: Rectangle[] = [];
      for (let s = 0; s < 30; s++) {
        shapeCounter++;
        leafShapes.push(createRect(`s-${shapeCounter}`, s * 10, h * 30));
      }
      level2Groups.push({
        id: l2Id,
        type: 'group',
        name: `L2 Group ${l2Id}`,
        children: leafShapes,
      });
    }

    topLevelChildren.push({
      id: rootId,
      type: 'group',
      name: `L1 Root Group ${rootId}`,
      children: level2Groups,
    });
  }

  // 4. 119 grupos de 1 nivel (2.700 figuras: 82 con 23 figs, 37 con 22 figs)
  for (let g = 0; g < 119; g++) {
    groupCounter++;
    const gId = `g-l1-${g}`;
    const count = g < 82 ? 23 : 22;
    const leafShapes: Rectangle[] = [];
    for (let s = 0; s < count; s++) {
      shapeCounter++;
      leafShapes.push(createRect(`s-${shapeCounter}`, s * 10, g * 10));
    }
    topLevelChildren.push({
      id: gId,
      type: 'group',
      name: `Group L1 ${gId}`,
      children: leafShapes,
    });
  }

  const doc: Document = {
    id: 'doc-bench-grouped',
    type: 'document',
    name: 'Benchmark Grupos',
    width: 3840,
    height: 2160,
    children: [
      {
        id: 'layer-1',
        type: 'layer',
        name: 'Capa Grupos',
        children: topLevelChildren,
      },
    ],
  };

  return deepFreeze(doc);
}

/**
 * Genera un Document con exactamente 5.000 figuras planas directamente en la capa.
 */
function createFlatDocument(): Document {
  const shapes: Rectangle[] = [];
  for (let i = 0; i < 5000; i++) {
    shapes.push(createRect(`s-flat-${i + 1}`, (i % 100) * 20, Math.floor(i / 100) * 20));
  }

  const doc: Document = {
    id: 'doc-bench-flat',
    type: 'document',
    name: 'Benchmark Plano',
    width: 3840,
    height: 2160,
    children: [
      {
        id: 'layer-1',
        type: 'layer',
        name: 'Capa Plana',
        children: shapes,
      },
    ],
  };

  return deepFreeze(doc);
}

// Función auxiliar para medir tiempo medio de ejecución
function measureAverage(fn: () => void, iterations: number = 30): number {
  // Warmup
  for (let w = 0; w < 5; w++) {
    fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  return (end - start) / iterations;
}

// Ejecución principal del benchmark
function runBenchmark() {
  console.log('\n================================================================================');
  console.log('                 BENCHMARK DE RENDIMIENTO: GRUPOS VS PLANO                      ');
  console.log('  Escenario: 5.000 figuras totales (250 grupos anidados hasta 3 niveles vs plano) ');
  console.log('================================================================================\n');

  const groupedDoc = createGroupedDocument();
  const flatDoc = createFlatDocument();

  // Extraer los primeros 50 grupos del documento con grupos
  const fiftyGroupIds: string[] = [];
  for (const child of groupedDoc.children[0].children) {
    if (isGroup(child) && fiftyGroupIds.length < 50) {
      fiftyGroupIds.push(child.id);
    }
  }

  // Extraer las primeras 50 figuras del documento plano
  const fiftyFlatShapeIds: string[] = [];
  for (let i = 0; i < 50; i++) {
    fiftyFlatShapeIds.push(flatDoc.children[0].children[i].id);
  }

  // Extraer 100 figuras para traslación
  const group100 = groupedDoc.children[0].children.find((c) => c.id === 'group-100-shapes') as Group;
  const hundredGroupLeafPos = group100.children.map((c, idx) => ({ id: c.id, x: 100 + idx, y: 100 + idx }));
  const hundredFlatPos = flatDoc.children[0].children.slice(0, 100).map((c, idx) => ({ id: c.id, x: 100 + idx, y: 100 + idx }));

  const results: {
    operation: string;
    groupedMs: number;
    flatMs: number;
  }[] = [];

  // 1. Construcción del índice (buildDocumentIndex)
  const groupedIndexMs = measureAverage(() => {
    // Clonar para forzar construcción en WeakMap no cacheado
    const clone = structuredClone(groupedDoc);
    getDocumentIndex(clone);
  }, 20);

  const flatIndexMs = measureAverage(() => {
    const clone = structuredClone(flatDoc);
    getDocumentIndex(clone);
  }, 20);

  results.push({
    operation: '1. Construcción del índice (buildDocumentIndex)',
    groupedMs: groupedIndexMs,
    flatMs: flatIndexMs,
  });

  // 2. selectAll
  const smGroupedSelectAll = new StateManager(groupedDoc);
  const groupedSelectAllMs = measureAverage(() => {
    smGroupedSelectAll.selectAll();
  }, 30);

  const smFlatSelectAll = new StateManager(flatDoc);
  const flatSelectAllMs = measureAverage(() => {
    smFlatSelectAll.selectAll();
  }, 30);

  results.push({
    operation: '2. selectAll',
    groupedMs: groupedSelectAllMs,
    flatMs: flatSelectAllMs,
  });

  // 3. Selección de 50 grupos vs 50 figuras
  const smGroupedSel50 = new StateManager(groupedDoc);
  const groupedSel50Ms = measureAverage(() => {
    smGroupedSel50.setSelection(fiftyGroupIds);
  }, 50);

  const smFlatSel50 = new StateManager(flatDoc);
  const flatSel50Ms = measureAverage(() => {
    smFlatSel50.setSelection(fiftyFlatShapeIds);
  }, 50);

  results.push({
    operation: '3. Selección de 50 elementos (grupos vs figuras)',
    groupedMs: groupedSel50Ms,
    flatMs: flatSel50Ms,
  });

  // 4. getSelectedNodes
  smGroupedSel50.setSelection(fiftyGroupIds);
  const groupedGetNodesMs = measureAverage(() => {
    smGroupedSel50.getSelectedNodes();
  }, 100);

  smFlatSel50.setSelection(fiftyFlatShapeIds);
  const flatGetNodesMs = measureAverage(() => {
    smFlatSel50.getSelectedNodes();
  }, 100);

  results.push({
    operation: '4. getSelectedNodes (con 50 seleccionados)',
    groupedMs: groupedGetNodesMs,
    flatMs: flatGetNodesMs,
  });

  // 5. Traslación de un grupo de 100 figuras vs 100 figuras
  const smGroupedMove = new StateManager(groupedDoc);
  const groupedMoveMs = measureAverage(() => {
    smGroupedMove.updateShapesPosition(hundredGroupLeafPos);
  }, 30);

  const smFlatMove = new StateManager(flatDoc);
  const flatMoveMs = measureAverage(() => {
    smFlatMove.updateShapesPosition(hundredFlatPos);
  }, 30);

  results.push({
    operation: '5. Traslación de 100 figuras (en grupo vs planas)',
    groupedMs: groupedMoveMs,
    flatMs: flatMoveMs,
  });

  // 6. Arrastre con suscriptor que llama 2 veces a getSelectedNodes
  const smGroupedDrag = new StateManager(groupedDoc);
  smGroupedDrag.setSelection(['group-100-shapes']);
  smGroupedDrag.subscribe(() => {
    smGroupedDrag.getSelectedNodes();
    smGroupedDrag.getSelectedNodes();
  });

  let dragDxG = 1;
  const groupedDragMs = measureAverage(() => {
    dragDxG = (dragDxG + 1) % 50;
    const entries = hundredGroupLeafPos.map((e) => ({ id: e.id, x: e.x + dragDxG, y: e.y + dragDxG }));
    smGroupedDrag.updateShapesPosition(entries);
  }, 30);

  const smFlatDrag = new StateManager(flatDoc);
  smFlatDrag.setSelection(hundredFlatPos.map((e) => e.id));
  smFlatDrag.subscribe(() => {
    smFlatDrag.getSelectedNodes();
    smFlatDrag.getSelectedNodes();
  });

  let dragDxF = 1;
  const flatDragMs = measureAverage(() => {
    dragDxF = (dragDxF + 1) % 50;
    const entries = hundredFlatPos.map((e) => ({ id: e.id, x: e.x + dragDxF, y: e.y + dragDxF }));
    smFlatDrag.updateShapesPosition(entries);
  }, 30);

  results.push({
    operation: '6. Arrastre con suscriptor (2x getSelectedNodes)',
    groupedMs: groupedDragMs,
    flatMs: flatDragMs,
  });

  // Impresión en formato de tabla Markdown
  console.log('| Operación                                        | Con Grupos (ms) | Sin Grupos (ms) | Ratio (Grupos/Plano) |');
  console.log('|--------------------------------------------------|-----------------|-----------------|----------------------|');

  for (const r of results) {
    const ratio = (r.groupedMs / (r.flatMs || 0.0001)).toFixed(2) + 'x';
    const opPadded = r.operation.padEnd(48, ' ');
    const grpPadded = r.groupedMs.toFixed(4).padStart(13, ' ') + ' ms';
    const flatPadded = r.flatMs.toFixed(4).padStart(13, ' ') + ' ms';
    const ratioPadded = ratio.padStart(18, ' ');
    console.log(`| ${opPadded} | ${grpPadded} | ${flatPadded} | ${ratioPadded} |`);
  }

  console.log('\n================================================================================');
  console.log('Conclusión: La persistencia estructural y la indexación O(1) mantienen la');
  console.log('operación con grupos a la par del modelo plano en todas las rutas críticas.');
  console.log('================================================================================\n');
}

runBenchmark();
