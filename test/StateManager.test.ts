import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from '../src/state/injectSampleShapes.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import type { Document, Layer, Rectangle, Ellipse } from '../src/types/scene-graph.ts';

describe('StateManager - Scene Graph Inmutable', () => {
  it('inicializa con un documento y una capa base por defecto', () => {
    const manager = new StateManager();
    const state = manager.getState();

    assert.equal(state.type, 'document');
    assert.equal(state.children.length, 1);
    assert.equal(state.children[0].type, 'layer');
    assert.equal(state.children[0].children.length, 0);
  });

  it('mantiene la inmutabilidad y previene mutaciones directas (Object.freeze)', () => {
    const manager = new StateManager();
    const state = manager.getState();

    assert.throws(() => {
      // Intentar mutar una propiedad congelada
      (state as unknown as { width: number }).width = 100;
    }, TypeError);

    assert.throws(() => {
      // Intentar mutar el array de hijos
      (state.children as unknown as unknown[]).push({} as Layer);
    }, TypeError);
  });

  it('agrega figuras a una capa de forma inmutable (structural sharing)', () => {
    const manager = new StateManager();
    const state0 = manager.getState();
    const layerId = state0.children[0].id;

    const rect: Rectangle = {
      id: 'rect-1',
      type: 'rectangle',
      name: 'Rect 1',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    };

    manager.addNode(layerId, rect);
    const state1 = manager.getState();

    // El estado anterior permanece intacto
    assert.notEqual(state0, state1);
    assert.equal(state0.children[0].children.length, 0);
    assert.equal(state1.children[0].children.length, 1);
    assert.equal(state1.children[0].children[0].id, 'rect-1');
  });

  it('agrega capas al documento de forma inmutable', () => {
    const manager = new StateManager();
    const state0 = manager.getState();

    const newLayer: Layer = {
      id: 'layer-vector',
      type: 'layer',
      name: 'Capa Vector',
      children: [],
    };

    manager.addNode(state0.id, newLayer);
    const state1 = manager.getState();

    assert.equal(state0.children.length, 1);
    assert.equal(state1.children.length, 2);
    assert.equal(state1.children[1].id, 'layer-vector');
  });

  it('rechaza agregar nodos en contenedores incompatibles', () => {
    const manager = new StateManager();
    const state = manager.getState();
    const layerId = state.children[0].id;

    const invalidLayer: Layer = {
      id: 'sub-layer',
      type: 'layer',
      name: 'Sub-layer',
      children: [],
    };

    const rect: Rectangle = {
      id: 'rect-alone',
      type: 'rectangle',
      name: 'Rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    };

    // Intentar agregar una capa dentro de otra capa
    assert.throws(() => {
      manager.addNode(layerId, invalidLayer);
    }, /Solo se admiten figuras/);

    // Intentar agregar una figura directamente al documento
    assert.throws(() => {
      manager.addNode(state.id, rect);
    }, /Solo se admiten capas/);
  });

  it('reordena nodos en el array de una capa', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 0, width: 10, height: 10 };
    const ellipse: Ellipse = { id: 'e1', type: 'ellipse', name: 'E1', x: 0, y: 0, radiusX: 5, radiusY: 5 };

    manager.addNode(layerId, rect);
    manager.addNode(layerId, ellipse);

    const beforeOrder = manager.getState().children[0].children.map((s) => s.id);
    assert.deepEqual(beforeOrder, ['r1', 'e1']);

    // Mover 'e1' (índice 1) a la posición 0
    manager.reorderNodes(layerId, 1, 0);

    const afterOrder = manager.getState().children[0].children.map((s) => s.id);
    assert.deepEqual(afterOrder, ['e1', 'r1']);
  });

  it('elimina nodos por ID de una capa y del documento', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = { id: 'r-del', type: 'rectangle', name: 'R', x: 0, y: 0, width: 10, height: 10 };
    manager.addNode(layerId, rect);
    assert.equal(manager.getState().children[0].children.length, 1);

    const removedShape = manager.removeNode('r-del');
    assert.equal(removedShape, true);
    assert.equal(manager.getState().children[0].children.length, 0);

    // Agregar y eliminar una capa
    const secondLayer: Layer = { id: 'layer-temp', type: 'layer', name: 'Temp', children: [] };
    manager.addLayer(secondLayer);
    assert.equal(manager.getState().children.length, 2);

    const removedLayer = manager.removeNode('layer-temp');
    assert.equal(removedLayer, true);
    assert.equal(manager.getState().children.length, 1);
  });

  it('no permite eliminar el documento raíz', () => {
    const manager = new StateManager();
    assert.throws(() => {
      manager.removeNode(manager.getState().id);
    }, /No se puede eliminar el nodo raíz Document/);
  });

  it('inyecta las 3 figuras de prueba hardcodeadas correctamente', () => {
    const manager = new StateManager();
    const injected = injectSampleShapes(manager);

    assert.equal(injected.length, 3);
    assert.deepEqual(injected, SAMPLE_SHAPES);

    const currentShapes = manager.getState().children[0].children;
    assert.equal(currentShapes.length, 3);
    assert.equal(currentShapes[0].type, 'rectangle');
    assert.equal(currentShapes[1].type, 'ellipse');
    assert.equal(currentShapes[2].type, 'ellipse');
  });

  it('notifica a los suscriptores en cada cambio de estado', () => {
    const manager = new StateManager();
    let callCount = 0;

    const unsubscribe = manager.subscribe(() => {
      callCount++;
    });

    injectSampleShapes(manager); // 3 figuras agregadas -> 3 eventos
    assert.equal(callCount, 3);

    unsubscribe();
    manager.addLayer({ id: 'layer-silent', type: 'layer', name: 'Silent', children: [] });
    // Ya no debe incrementar porque se desuscribió
    assert.equal(callCount, 3);
  });

  it('bringToFront: mueve el elemento al final del array y recalcula valores discretos de zIndex', () => {
    const manager = new StateManager();
    injectSampleShapes(manager); // 3 figuras: shape-rect-1, shape-ellipse-1, shape-ellipse-2

    // Estado inicial: [shape-rect-1, shape-ellipse-1, shape-ellipse-2]
    let shapes = manager.getState().children[0].children;
    assert.equal(shapes[0].id, 'shape-rect-1');
    assert.equal(shapes[1].id, 'shape-ellipse-1');
    assert.equal(shapes[2].id, 'shape-ellipse-2');

    // Mover la primera figura al frente
    const res = manager.bringToFront('shape-rect-1');
    assert.equal(res, true);

    shapes = manager.getState().children[0].children;
    assert.equal(shapes.length, 3);
    assert.equal(shapes[0].id, 'shape-ellipse-1');
    assert.equal(shapes[1].id, 'shape-ellipse-2');
    assert.equal(shapes[2].id, 'shape-rect-1'); // Ahora al frente (último)

    // Verificar que los valores discretos de zIndex coincidan con su orden
    assert.equal(shapes[0].zIndex, 0);
    assert.equal(shapes[1].zIndex, 1);
    assert.equal(shapes[2].zIndex, 2);
    assert.equal(manager.isDirty, true);
  });

  it('sendToBack: mueve el elemento al inicio del array y recalcula valores discretos de zIndex', () => {
    const manager = new StateManager();
    injectSampleShapes(manager); // 3 figuras: shape-rect-1, shape-ellipse-1, shape-ellipse-2

    // Mover la última figura (shape-ellipse-2) al fondo
    const res = manager.sendToBack('shape-ellipse-2');
    assert.equal(res, true);

    const shapes = manager.getState().children[0].children;
    assert.equal(shapes.length, 3);
    assert.equal(shapes[0].id, 'shape-ellipse-2'); // Ahora al fondo (primero)
    assert.equal(shapes[1].id, 'shape-rect-1');
    assert.equal(shapes[2].id, 'shape-ellipse-1');

    // Verificar valores discretos de zIndex recalculados
    assert.equal(shapes[0].zIndex, 0);
    assert.equal(shapes[1].zIndex, 1);
    assert.equal(shapes[2].zIndex, 2);
  });

  it('loadState: reemplaza por completo _state, marca _isDirty = true, notifica y preserva inmutabilidad', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);
    assert.equal(manager.getState().children[0].children.length, 3);

    let notifyCalled = false;
    manager.subscribe(() => {
      notifyCalled = true;
    });

    const newDoc: Document = {
      id: 'loaded-doc',
      type: 'document',
      name: 'Documento Cargado',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-loaded',
          type: 'layer',
          name: 'Capa Cargada',
          children: [
            {
              id: 'rect-loaded',
              type: 'rectangle',
              name: 'Rect Cargado',
              x: 10,
              y: 20,
              width: 100,
              height: 50,
            },
          ],
        },
      ],
    };

    manager.loadState(newDoc);

    // 1. Estado reemplazado por completo
    const state = manager.getState();
    assert.equal(state.id, 'loaded-doc');
    assert.equal(state.name, 'Documento Cargado');
    assert.equal(state.children.length, 1);
    assert.equal(state.children[0].children.length, 1);
    assert.equal(state.children[0].children[0].id, 'rect-loaded');

    // 2. isDirty activo y notificado
    assert.equal(manager.isDirty, true);
    assert.equal(notifyCalled, true);

    // 3. Inmutabilidad
    assert.throws(() => {
      (state as any).width = 999;
    });
  });

  it('loadState: invalida e historial de comandos (CommandManager) al cargar nuevo estado', () => {
    const commandManager = new CommandManager();
    const manager = new StateManager(undefined, commandManager);
    injectSampleShapes(manager);

    // Ejecutar un comando de traslación
    const cmd = new TranslateCommand(manager, 'shape-rect-1', 80, 100, 120, 150);
    commandManager.executeCommand(cmd);
    assert.equal(commandManager.canUndo(), true);
    assert.equal(commandManager.undoCount, 1);

    // Cargar nuevo estado -> debe invalidar/limpiar CommandManager
    const freshDoc: Document = {
      id: 'doc-clean',
      type: 'document',
      name: 'Limpio',
      width: 1000,
      height: 1000,
      children: [],
    };

    manager.loadState(freshDoc);

    assert.equal(commandManager.canUndo(), false, 'Pila de undo debe quedar vacía');
    assert.equal(commandManager.canRedo(), false, 'Pila de redo debe quedar vacía');
    assert.equal(commandManager.undoCount, 0);
  });

  it('loadState: arroja error si el objeto provisto no es un Document válido', () => {
    const manager = new StateManager();
    assert.throws(() => {
      manager.loadState(null as any);
    }, /loadState requiere un objeto Document válido/);

    assert.throws(() => {
      manager.loadState({ type: 'layer', id: 'l1', children: [] } as any);
    }, /loadState requiere un objeto Document válido con type 'document'/);
  });
});

describe('StateManager - Selección fuera del Documento e isDirty', () => {
  it('la selección se almacena fuera del Documento y getSelection() inicia vacía', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    assert.deepEqual(manager.getSelection(), []);
    assert.deepEqual(manager.getSelectedNodes(), []);
    assert.equal(manager.getSelectedNode(), null);
    assert.equal(manager.isSelected('shape-rect-1'), false);
  });

  it('selectNode(id) y setSelection(ids) actualizan la selección sin crear un nuevo Document (preserva identidad de getState)', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    const stateBefore = manager.getState();

    // Seleccionar una figura
    manager.selectNode('shape-rect-1');
    const stateAfterSelect = manager.getState();

    // LA IDENTIDAD DE getState() DEBE SER EXACTAMENTE LA MISMA (referencia idéntica)
    assert.equal(stateAfterSelect, stateBefore, 'getState() debe mantener identidad referencial tras seleccionar');
    assert.deepEqual(manager.getSelection(), ['shape-rect-1']);
    assert.equal(manager.isSelected('shape-rect-1'), true);
    assert.equal(manager.getSelectedNode()?.id, 'shape-rect-1');
    assert.equal(manager.getSelectedNodes().length, 1);

    // Selección múltiple con setSelection
    manager.setSelection(['shape-rect-1', 'shape-ellipse-1']);
    const stateAfterMulti = manager.getState();
    assert.equal(stateAfterMulti, stateBefore, 'getState() debe mantener identidad referencial tras setSelection');
    assert.deepEqual(manager.getSelection(), ['shape-rect-1', 'shape-ellipse-1']);
    assert.equal(manager.isSelected('shape-rect-1'), true);
    assert.equal(manager.isSelected('shape-ellipse-1'), true);
    assert.equal(manager.getSelectedNodes().length, 2);
    assert.equal(manager.getSelectedNode()?.id, 'shape-rect-1', 'getSelectedNode debe devolver la primera');

    // Deseleccionar con selectNode(null)
    manager.selectNode(null);
    assert.equal(manager.getState(), stateBefore);
    assert.deepEqual(manager.getSelection(), []);
    assert.equal(manager.getSelectedNode(), null);
  });

  it('markDirty() y clearDirty() alternan el flag privado sin modificar la referencia de getState()', () => {
    const manager = new StateManager();
    assert.equal(manager.isDirty, true, 'isDirty debe iniciar en true');

    const state0 = manager.getState();
    assert.equal((state0 as any).isDirty, undefined, 'El Document no debe tener propiedad isDirty');

    manager.clearDirty();
    assert.equal(manager.isDirty, false);
    assert.equal(manager.getState(), state0, 'clearDirty no debe recrear el Document');

    manager.markDirty();
    assert.equal(manager.isDirty, true);
    assert.equal(manager.getState(), state0, 'markDirty no debe recrear el Document');
  });

  it('removeNode(shapeId) purga automáticamente el ID de la selección', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    manager.setSelection(['shape-rect-1', 'shape-ellipse-1']);
    assert.deepEqual(manager.getSelection(), ['shape-rect-1', 'shape-ellipse-1']);

    // Eliminar una figura seleccionada
    manager.removeNode('shape-rect-1');

    assert.deepEqual(manager.getSelection(), ['shape-ellipse-1'], 'Debe haber purgado shape-rect-1');
    assert.equal(manager.isSelected('shape-rect-1'), false);
    assert.equal(manager.isSelected('shape-ellipse-1'), true);
  });

  it('removeNode(layerId) purga de la selección todas las figuras de la capa eliminada', () => {
    const manager = new StateManager();
    const layer1Id = manager.getState().children[0].id;

    // Crear segunda capa
    const layer2: Layer = {
      id: 'layer-2',
      type: 'layer',
      name: 'Capa 2',
      children: [],
    };
    manager.addNode(manager.getState().id, layer2);

    const rect1: Rectangle = {
      id: 'rect-in-l1',
      type: 'rectangle',
      name: 'R1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const rect2: Rectangle = {
      id: 'rect-in-l2',
      type: 'rectangle',
      name: 'R2',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };

    manager.addShape(layer1Id, rect1);
    manager.addShape('layer-2', rect2);

    manager.setSelection(['rect-in-l1', 'rect-in-l2']);
    assert.deepEqual(manager.getSelection(), ['rect-in-l1', 'rect-in-l2']);

    // Eliminar capa 1
    manager.removeNode(layer1Id);

    assert.deepEqual(manager.getSelection(), ['rect-in-l2'], 'Debe purgar las figuras contenidas en la capa borrada');
    assert.equal(manager.isSelected('rect-in-l1'), false);
    assert.equal(manager.isSelected('rect-in-l2'), true);
  });

  it('loadState(newState) purga de la selección los IDs que no existen en el nuevo documento', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    manager.selectNode('shape-rect-1');
    assert.deepEqual(manager.getSelection(), ['shape-rect-1']);

    const freshDoc: Document = {
      id: 'doc-fresh',
      type: 'document',
      name: 'Nuevo',
      width: 800,
      height: 600,
      children: [
        {
          id: 'l-fresh',
          type: 'layer',
          name: 'Capa',
          children: [
            {
              id: 'fresh-rect',
              type: 'rectangle',
              name: 'Nuevo Rect',
              x: 50,
              y: 50,
              width: 50,
              height: 50,
            },
          ],
        },
      ],
    };

    manager.loadState(freshDoc);

    assert.deepEqual(manager.getSelection(), [], 'La selección previa debe haber sido purgada');
    assert.equal(manager.getSelectedNode(), null);
  });

  it('los cambios de selección notifican a los suscriptores y marcan isDirty = true', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    manager.clearDirty();
    assert.equal(manager.isDirty, false);

    let notifyCount = 0;
    const unsubscribe = manager.subscribe(() => {
      notifyCount++;
    });

    // 1. Cambiar selección: notifica y marca dirty
    manager.selectNode('shape-rect-1');
    assert.equal(notifyCount, 1);
    assert.equal(manager.isDirty, true);

    // 2. Establecer la MISMA selección: no notifica de nuevo ni retrabaja
    manager.clearDirty();
    manager.setSelection(['shape-rect-1']);
    assert.equal(notifyCount, 1, 'No debe notificar si la selección no cambió');
    assert.equal(manager.isDirty, false, 'No debe marcar sucio si la selección no cambió');

    // 3. Deseleccionar: notifica y marca dirty
    manager.selectNode(null);
    assert.equal(notifyCount, 2);
    assert.equal(manager.isDirty, true);

    unsubscribe();
  });

  it('setSelection normaliza eliminando duplicados e IDs de nodos inexistentes', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    manager.setSelection(['shape-rect-1', 'inexistente-1', 'shape-rect-1', 'shape-ellipse-1', 'inexistente-2']);
    assert.deepEqual(manager.getSelection(), ['shape-rect-1', 'shape-ellipse-1']);
  });
});



