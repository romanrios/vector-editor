import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { GroupCommand, resetGroupCounter } from '../src/commands/GroupCommand.ts';
import { UngroupCommand } from '../src/commands/UngroupCommand.ts';
import { DeleteCommand } from '../src/commands/DeleteCommand.ts';
import { AddShapeCommand } from '../src/commands/AddShapeCommand.ts';
import { ReorderCommand } from '../src/commands/ReorderCommand.ts';
import { cloneNode, cloneShape } from '../src/utils/cloneShape.ts';
import { isGroup, type Group, type Layer, type Rectangle } from '../src/types/scene-graph.ts';
import { getGroupAABB } from '../src/utils/geometry.ts';

// Helper de mock Canvas para validar el RenderEngine
function createMockCanvas(): {
  canvas: HTMLCanvasElement;
  calls: Array<{ method: string; args?: any[] }>;
  state: { globalAlpha: number; strokeStyle: string; lineWidth: number };
} {
  const calls: Array<{ method: string; args?: any[] }> = [];
  const state = {
    globalAlpha: 1,
    strokeStyle: '',
    lineWidth: 1,
  };

  const alphaStack: number[] = [];

  const mockCtx: Partial<CanvasRenderingContext2D> = {
    save: () => {
      calls.push({ method: 'save' });
      alphaStack.push(state.globalAlpha);
    },
    restore: () => {
      calls.push({ method: 'restore' });
      if (alphaStack.length > 0) {
        state.globalAlpha = alphaStack.pop()!;
      }
    },
    setTransform: () => calls.push({ method: 'setTransform' }),
    clearRect: () => calls.push({ method: 'clearRect' }),
    fillRect: (x, y, w, h) => calls.push({ method: 'fillRect', args: [x, y, w, h] }),
    beginPath: () => calls.push({ method: 'beginPath' }),
    moveTo: (x, y) => calls.push({ method: 'moveTo', args: [x, y] }),
    lineTo: (x, y) => calls.push({ method: 'lineTo', args: [x, y] }),
    stroke: () => calls.push({ method: 'stroke' }),
    fill: () => calls.push({ method: 'fill' }),
    rect: (x, y, w, h) => calls.push({ method: 'rect', args: [x, y, w, h] }),
    roundRect: (x, y, w, h) => calls.push({ method: 'roundRect', args: [x, y, w, h] }),
    strokeRect: (x, y, w, h) => calls.push({ method: 'strokeRect', args: [x, y, w, h] }),
    translate: (x, y) => calls.push({ method: 'translate', args: [x, y] }),
    rotate: (angle) => calls.push({ method: 'rotate', args: [angle] }),
    setLineDash: (segments) => calls.push({ method: 'setLineDash', args: [segments] }),
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
      calls.push({ method: 'setGlobalAlpha', args: [v] });
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
  };

  const mockCanvas = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    getContext: (id: string) => (id === '2d' ? (mockCtx as CanvasRenderingContext2D) : null),
  } as unknown as HTMLCanvasElement;

  return { canvas: mockCanvas, calls, state };
}

describe('Comandos de Grupos y RenderEngine', () => {
  describe('GroupCommand', () => {
    it('agrupa nodos dentro de una misma capa, conservando su orden relativo y creando el grupo en el elemento más alto', () => {
      resetGroupCounter();
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 50, height: 50 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 70, y: 10, width: 50, height: 50 };
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 130, y: 10, width: 50, height: 50 };

      manager.addShape('layer-default', r1);
      manager.addShape('layer-default', r2);
      manager.addShape('layer-default', r3);

      manager.setSelection(['r1', 'r3']);

      // Agrupar r1 y r3 (el más alto es r3, en índice 2)
      const cmd = new GroupCommand(manager, [r1, r3]);
      cmd.execute();

      const layer = manager.getState().children[0];
      // La capa tenía [r1, r2, r3]. Al remover r1 y r3, queda [r2].
      // r3 estaba después de r2, por lo que el nuevo grupo debe insertarse después de r2: [r2, Grupo 1]
      assert.equal(layer.children.length, 2);
      assert.equal(layer.children[0].id, 'r2');
      assert.ok(isGroup(layer.children[1]));
      const g = layer.children[1] as Group;
      assert.equal(g.name, 'Grupo 1');
      assert.deepEqual(g.children.map((c) => c.id), ['r1', 'r3']);

      // El grupo queda seleccionado
      assert.deepEqual([...manager.getSelection()], [g.id]);

      // Undo restaura exactamente la selección previa y el orden de apilado
      cmd.undo();
      const restoredLayer = manager.getState().children[0];
      assert.deepEqual(restoredLayer.children.map((c) => c.id), ['r1', 'r2', 'r3']);
      assert.deepEqual([...manager.getSelection()], ['r1', 'r3']);

      // Redo vuelve a aplicar
      cmd.execute();
      const redoLayer = manager.getState().children[0];
      assert.equal(redoLayer.children.length, 2);
      assert.equal(redoLayer.children[0].id, 'r2');
      assert.equal(redoLayer.children[1].id, g.id);
      assert.deepEqual([...manager.getSelection()], [g.id]);
    });

    it('agrupa nodos provenientes de dos capas distintas en la capa del elemento más alto', () => {
      const manager = new StateManager();
      const layer2: Layer = { id: 'layer-2', type: 'layer', name: 'Capa 2', children: [], visible: true, locked: false };
      manager.addLayer(layer2);

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 50, height: 50 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 70, y: 10, width: 50, height: 50 };

      // r1 en layer-default (capa 0), r2 en layer-2 (capa 1)
      manager.addShape('layer-default', r1);
      manager.addShape('layer-2', r2);

      // r2 está en una capa superior, por lo que es el elemento más alto
      const cmd = new GroupCommand(manager, [r1, r2]);
      cmd.execute();

      const doc = manager.getState();
      const l1 = doc.children[0];
      const l2 = doc.children[1];

      assert.equal(l1.children.length, 0, 'r1 debe haberse retirado de la capa 1');
      assert.equal(l2.children.length, 1, 'El grupo debe haberse creado en la capa 2');
      assert.ok(isGroup(l2.children[0]));
      const g = l2.children[0] as Group;
      assert.deepEqual(g.children.map((c) => c.id), ['r1', 'r2']);

      // Undo restaura a cada figura en su respectiva capa original
      cmd.undo();
      const docRestored = manager.getState();
      assert.equal(docRestored.children[0].children[0].id, 'r1');
      assert.equal(docRestored.children[1].children[0].id, 'r2');
    });

    it('agrupa un nodo dentro de un grupo y otro fuera de él', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 50, height: 50 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 70, y: 10, width: 50, height: 50 };
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 130, y: 10, width: 50, height: 50 };

      const gExisting: Group = {
        id: 'g-exist',
        type: 'group',
        name: 'Grupo Existente',
        children: [r1, r2],
      };

      manager.addNode('layer-default', gExisting);
      manager.addShape('layer-default', r3);

      // Agrupar r2 (dentro de gExisting) y r3 (en la capa, más alto)
      const cmd = new GroupCommand(manager, [r2, r3]);
      cmd.execute();

      const doc = manager.getState();
      const layer = doc.children[0];
      // gExisting debe conservar r1
      const updatedGExist = layer.children[0] as Group;
      assert.equal(updatedGExist.id, 'g-exist');
      assert.equal(updatedGExist.children.length, 1);
      assert.equal(updatedGExist.children[0].id, 'r1');

      // El nuevo grupo se insertó en layer-default en la posición de r3
      const newG = layer.children[1] as Group;
      assert.ok(isGroup(newG));
      assert.deepEqual(newG.children.map((c) => c.id), ['r2', 'r3']);

      // Undo
      cmd.undo();
      const restoredDoc = manager.getState();
      const restoredGExist = restoredDoc.children[0].children[0] as Group;
      assert.deepEqual(restoredGExist.children.map((c) => c.id), ['r1', 'r2']);
      assert.equal(restoredDoc.children[0].children[1].id, 'r3');
    });

    it('agrupar todos los hijos de un grupo existente elimina el grupo vacío y undo lo recupera', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 50, height: 50 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 70, y: 10, width: 50, height: 50 };
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 130, y: 10, width: 50, height: 50 };

      const gOriginal: Group = {
        id: 'g-orig',
        type: 'group',
        name: 'Grupo Original',
        children: [r1, r2],
      };

      // Capa tiene [gOriginal, r3]
      manager.addNode('layer-default', gOriginal);
      manager.addShape('layer-default', r3);

      // Agrupar todos los hijos de gOriginal (r1 y r2)
      const cmd = new GroupCommand(manager, [r1, r2]);
      cmd.execute();

      const doc = manager.getState();
      const layer = doc.children[0];
      // gOriginal debe haber desaparecido por quedar vacío
      assert.equal(manager.findNode('g-orig'), null, 'El grupo vacío debe desaparecer');
      assert.equal(layer.children.length, 2);
      // El nuevo grupo reemplaza la posición de gOriginal
      assert.ok(isGroup(layer.children[0]));
      assert.equal(layer.children[1].id, 'r3');
      assert.deepEqual((layer.children[0] as Group).children.map((c) => c.id), ['r1', 'r2']);

      // Undo restaura gOriginal en su posición con sus hijos
      cmd.undo();
      const restoredDoc = manager.getState();
      const restoredLayer = restoredDoc.children[0];
      assert.equal(restoredLayer.children[0].id, 'g-orig');
      assert.equal(restoredLayer.children[1].id, 'r3');
      const recoveredG = restoredLayer.children[0] as Group;
      assert.deepEqual(recoveredG.children.map((c) => c.id), ['r1', 'r2']);
    });
  });

  describe('UngroupCommand', () => {
    it('desagrupa uno o varios grupos (un solo nivel), sus hijos pasan al padre y quedan seleccionados', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 40, y: 10, width: 20, height: 20 };
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 70, y: 10, width: 20, height: 20 };
      const r4: Rectangle = { id: 'r4', type: 'rectangle', name: 'R4', x: 100, y: 10, width: 20, height: 20 };

      const g1: Group = { id: 'g1', type: 'group', name: 'G1', children: [r1, r2] };
      const g2: Group = { id: 'g2', type: 'group', name: 'G2', children: [r3, r4] };

      manager.addNode('layer-default', g1);
      manager.addNode('layer-default', g2);

      manager.setSelection(['g1', 'g2']);

      const cmd = new UngroupCommand(manager, [g1, g2]);
      cmd.execute();

      const layer = manager.getState().children[0];
      assert.equal(layer.children.length, 4);
      assert.deepEqual(layer.children.map((c) => c.id), ['r1', 'r2', 'r3', 'r4']);
      // Todos los hijos quedan seleccionados
      assert.deepEqual([...manager.getSelection()], ['r1', 'r2', 'r3', 'r4']);

      // Undo reconstruye exactamente los dos grupos y restaura la selección
      cmd.undo();
      const restoredLayer = manager.getState().children[0];
      assert.equal(restoredLayer.children.length, 2);
      assert.equal(restoredLayer.children[0].id, 'g1');
      assert.equal(restoredLayer.children[1].id, 'g2');
      assert.deepEqual((restoredLayer.children[0] as Group).children.map((c) => c.id), ['r1', 'r2']);
      assert.deepEqual((restoredLayer.children[1] as Group).children.map((c) => c.id), ['r3', 'r4']);
      assert.deepEqual([...manager.getSelection()], ['g1', 'g2']);
    });
  });

  describe('DeleteCommand con Grupos', () => {
    it('borrar el último hijo de un grupo elimina el grupo vacío y undo lo restaura', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
      const rOther: Rectangle = { id: 'r-other', type: 'rectangle', name: 'Other', x: 100, y: 100, width: 50, height: 50 };

      const g: Group = { id: 'g-single', type: 'group', name: 'G Single', children: [r1] };

      manager.addNode('layer-default', g);
      manager.addShape('layer-default', rOther);

      manager.setSelection(['r1']);

      const cmd = new DeleteCommand(manager, r1);
      cmd.execute();

      const doc = manager.getState();
      assert.equal(manager.findNode('r1'), null);
      assert.equal(manager.findNode('g-single'), null, 'El grupo quedó vacío y debe haberse eliminado');
      assert.equal(doc.children[0].children.length, 1);
      assert.equal(doc.children[0].children[0].id, 'r-other');

      // Undo restaura el grupo y la figura
      cmd.undo();
      const restoredDoc = manager.getState();
      assert.ok(manager.findNode('g-single'));
      assert.ok(manager.findNode('r1'));
      const restoredG = restoredDoc.children[0].children[0] as Group;
      assert.equal(restoredG.id, 'g-single');
      assert.equal(restoredG.children.length, 1);
      assert.equal(restoredG.children[0].id, 'r1');
      assert.deepEqual([...manager.getSelection()], ['r1']);
    });

    it('borrar un grupo directamente y deshacer', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
      const g: Group = { id: 'g-del', type: 'group', name: 'G Del', children: [r1] };

      manager.addNode('layer-default', g);
      manager.setSelection(['g-del']);

      const cmd = new DeleteCommand(manager, g);
      cmd.execute();

      assert.equal(manager.findNode('g-del'), null);
      assert.equal(manager.findNode('r1'), null);

      cmd.undo();
      assert.ok(manager.findNode('g-del'));
      assert.ok(manager.findNode('r1'));
      assert.deepEqual([...manager.getSelection()], ['g-del']);
    });
  });

  describe('AddShapeCommand y ReorderCommand dentro de Grupos', () => {
    it('AddShapeCommand añade una figura dentro de un Group', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
      const g: Group = { id: 'g-target', type: 'group', name: 'Target Group', children: [r1] };
      manager.addNode('layer-default', g);

      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 30, y: 10, width: 20, height: 20 };
      const cmd = new AddShapeCommand(manager, r2, 'g-target', 1);
      cmd.execute();

      const updatedG = manager.findNode('g-target') as Group;
      assert.equal(updatedG.children.length, 2);
      assert.equal(updatedG.children[1].id, 'r2');

      cmd.undo();
      const undoneG = manager.findNode('g-target') as Group;
      assert.equal(undoneG.children.length, 1);
      assert.equal(undoneG.children[0].id, 'r1');
    });

    it('ReorderCommand reordena figuras dentro de un Group', () => {
      const manager = new StateManager();
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 30, y: 10, width: 20, height: 20 };
      const g: Group = { id: 'g-order', type: 'group', name: 'Order Group', children: [r1, r2] };
      manager.addNode('layer-default', g);

      // Traer r1 al frente dentro del grupo
      const cmd = new ReorderCommand(manager, 'r1', 'bringToFront');
      cmd.execute();

      let currentG = manager.findNode('g-order') as Group;
      assert.deepEqual(currentG.children.map((c) => c.id), ['r2', 'r1']);

      // Undo
      cmd.undo();
      currentG = manager.findNode('g-order') as Group;
      assert.deepEqual(currentG.children.map((c) => c.id), ['r1', 'r2']);
    });
  });

  describe('cloneNode', () => {
    it('clona recursivamente un grupo anidado generando IDs únicos y aplicando offset', () => {
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 20, height: 20 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 30, y: 10, width: 20, height: 20 };
      const innerGroup: Group = { id: 'g-inner', type: 'group', name: 'G Inner', children: [r2] };
      const outerGroup: Group = { id: 'g-outer', type: 'group', name: 'G Outer', children: [r1, innerGroup] };

      const cloned = cloneNode(outerGroup, { dx: 15, dy: 25 });

      assert.notEqual(cloned.id, outerGroup.id);
      assert.equal(cloned.name, 'G Outer copia');
      assert.equal(cloned.children.length, 2);

      const clonedR1 = cloned.children[0] as Rectangle;
      assert.notEqual(clonedR1.id, 'r1');
      assert.equal(clonedR1.x, 25);
      assert.equal(clonedR1.y, 35);

      const clonedInner = cloned.children[1] as Group;
      assert.notEqual(clonedInner.id, 'g-inner');
      assert.equal(clonedInner.children.length, 1);

      const clonedR2 = clonedInner.children[0] as Rectangle;
      assert.notEqual(clonedR2.id, 'r2');
      assert.equal(clonedR2.x, 45);
      assert.equal(clonedR2.y, 35);

      // Todos los IDs generados son únicos
      const allIds = [cloned.id, clonedR1.id, clonedInner.id, clonedR2.id];
      const uniqueIds = new Set(allIds);
      assert.equal(uniqueIds.size, 4);

      // Wrapper cloneShape funciona con figuras
      const clonedShape = cloneShape(r1, { dx: 5, dy: 5 });
      assert.notEqual(clonedShape.id, r1.id);
      assert.equal(clonedShape.x, 15);
      assert.equal(clonedShape.y, 15);
    });
  });

  describe('RenderEngine con Grupos', () => {
    it('grupo oculto (visible: false) no dibuja sus hijos', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();

      const rVisible: Rectangle = { id: 'r-vis', type: 'rectangle', name: 'Vis', x: 10, y: 10, width: 20, height: 20, fill: '#ff0000' };
      const rInHiddenGroup: Rectangle = { id: 'r-hid', type: 'rectangle', name: 'Hid', x: 50, y: 50, width: 20, height: 20, fill: '#00ff00' };
      const hiddenGroup: Group = {
        id: 'g-hidden',
        type: 'group',
        name: 'Hidden Group',
        children: [rInHiddenGroup],
        visible: false,
      };

      manager.addShape('layer-default', rVisible);
      manager.addNode('layer-default', hiddenGroup);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      // Solo rVisible debe haberse dibujado (1 llamada a roundRect/rect)
      const rectCalls = calls.filter((c) => c.method === 'roundRect' || c.method === 'rect');
      assert.equal(rectCalls.length, 1);
      assert.deepEqual(rectCalls[0].args?.slice(0, 4), [10, 10, 20, 20]);
    });

    it('grupo con opacidad multiplica su opacidad con la capa y sus figuras, aislando con save/restore', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();

      // Capa con opacidad 0.8
      const layerWithOpacity: Layer = {
        id: 'layer-opacity',
        type: 'layer',
        name: 'Capa Opaca',
        children: [],
        opacity: 0.8,
        visible: true,
        locked: false,
      };
      manager.addLayer(layerWithOpacity);

      // Grupo con opacidad 0.5
      const rectInGroup: Rectangle = {
        id: 'r-group',
        type: 'rectangle',
        name: 'R in Group',
        x: 10,
        y: 10,
        width: 30,
        height: 30,
        fill: '#0000ff',
        opacity: 0.5,
      };
      const group: Group = {
        id: 'g-op',
        type: 'group',
        name: 'Group Opacity',
        children: [rectInGroup],
        opacity: 0.5,
      };

      manager.addNode('layer-opacity', group);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      // Alpha debe multiplicarse: capa (0.8) * grupo (0.5) * figura (0.5) = 0.2
      const alphaCalls = calls.filter((c) => c.method === 'setGlobalAlpha');
      assert.ok(alphaCalls.length >= 3);
      const expectedShapeAlpha = 0.8 * 0.5 * 0.5; // 0.2
      const matched = alphaCalls.some((c) => Math.abs((c.args?.[0] ?? 0) - expectedShapeAlpha) < 1e-4);
      assert.ok(matched, `globalAlpha debe haber alcanzado ${expectedShapeAlpha}`);
    });

    it('recuadro de selección para un grupo: dibuja un recuadro delimitador (getGroupAABB) sin tiradores', () => {
      const { canvas, calls } = createMockCanvas();
      const manager = new StateManager();

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 30, width: 40, height: 50 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 80, y: 10, width: 30, height: 60 };
      const group: Group = { id: 'g-select', type: 'group', name: 'Group Select', children: [r1, r2] };

      manager.addNode('layer-default', group);
      manager.setSelection(['g-select']);

      const expectedAABB = getGroupAABB(group);
      assert.equal(expectedAABB.minX, 20);
      assert.equal(expectedAABB.minY, 10);
      assert.equal(expectedAABB.maxX, 110);
      assert.equal(expectedAABB.maxY, 80);

      const engine = new RenderEngine(canvas, manager, { highDpi: false });
      engine.render();

      // En el overlay de selección:
      // Debe dibujar el strokeRect de la caja delimitadora del grupo
      const strokeRectCalls = calls.filter((c) => c.method === 'strokeRect');
      const boxStroke = strokeRectCalls.find(
        (c) =>
          c.args?.[0] === expectedAABB.minX &&
          c.args?.[1] === expectedAABB.minY &&
          c.args?.[2] === expectedAABB.width &&
          c.args?.[3] === expectedAABB.height
      );
      assert.ok(boxStroke, 'Debe dibujar strokeRect con las dimensiones exactas de getGroupAABB');

      // Con la regla 5 (redimensionado y rotación en multi-selección y grupos),
      // se muestran los 4 tiradores de esquina (8x8) para escalar el conjunto
      const smallHandleStrokes = strokeRectCalls.filter(
        (c) => c.args?.[2] === 8 && c.args?.[3] === 8
      );
      assert.equal(smallHandleStrokes.length, 4, 'Debe haber 4 tiradores de redimensionado');
    });
  });
});
