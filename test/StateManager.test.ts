import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager, hasCachedDocumentIndex } from '../src/state/StateManager.ts';
import { injectSampleShapes, SAMPLE_SHAPES } from '../src/state/injectSampleShapes.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import type { Document, Layer, Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

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

  it('loadState deja getSelection() vacío incluso si el nuevo documento comparte los MISMOS IDs que el actual', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    // Seleccionar una figura existente
    manager.selectNode('shape-rect-1');
    assert.deepEqual(manager.getSelection(), ['shape-rect-1']);

    // Crear un documento nuevo que tiene exactamente los mismos IDs (ej. reimportación de export JSON)
    const sameIdsDoc: Document = structuredClone(manager.getState());

    manager.loadState(sameIdsDoc);

    // Al cargar un documento nuevo la selección debe quedar siempre vacía
    assert.deepEqual(manager.getSelection(), [], 'La selección debe quedar vacía tras loadState');
    assert.equal(manager.getSelectedNode(), null);
  });

  it('loadState notifica a los suscriptores y getState() devuelve el documento nuevo', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    let notified = false;
    manager.subscribe(() => {
      notified = true;
    });

    const newDoc: Document = {
      id: 'doc-fresh-notify',
      type: 'document',
      name: 'Documento Notificado',
      width: 1024,
      height: 768,
      children: [
        {
          id: 'l-fresh-notify',
          type: 'layer',
          name: 'Capa Nueva',
          children: [],
        },
      ],
    };

    manager.loadState(newDoc);

    assert.equal(notified, true, 'loadState debe notificar a los suscriptores');
    assert.equal(manager.getState().id, 'doc-fresh-notify');
    assert.equal(manager.getState().name, 'Documento Notificado');
    assert.equal(manager.getState().width, 1024);
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

  it('toggleInSelection conmuta la presencia de un ID y no notifica si el ID es inválido', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    let notifyCount = 0;
    manager.subscribe(() => notifyCount++);

    // 1. Añadir 'shape-rect-1' a la selección
    manager.toggleInSelection('shape-rect-1');
    assert.deepEqual(manager.getSelection(), ['shape-rect-1']);
    assert.equal(notifyCount, 1);

    // 2. Quitar 'shape-rect-1' de la selección
    manager.toggleInSelection('shape-rect-1');
    assert.deepEqual(manager.getSelection(), []);
    assert.equal(notifyCount, 2);

    // 3. Conmutar con un ID inexistente: no cambia nada ni notifica
    manager.toggleInSelection('no-existe');
    assert.deepEqual(manager.getSelection(), []);
    assert.equal(notifyCount, 2, 'No debe notificar si el ID no es una figura válida');
  });

  it('addToSelection y removeFromSelection operan acumulativamente y no notifican si no hay cambios', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);

    let notifyCount = 0;
    manager.subscribe(() => notifyCount++);

    // 1. addToSelection añade IDs válidos
    manager.addToSelection(['shape-rect-1', 'shape-ellipse-1']);
    assert.deepEqual(manager.getSelection(), ['shape-rect-1', 'shape-ellipse-1']);
    assert.equal(notifyCount, 1);

    // 2. addToSelection con los mismos IDs o inválidos: no notifica
    manager.addToSelection(['shape-rect-1', 'fantasma']);
    assert.equal(notifyCount, 1, 'No debe notificar si no se agregan IDs nuevos válidos');

    // 3. removeFromSelection remueve un ID
    manager.removeFromSelection(['shape-rect-1']);
    assert.deepEqual(manager.getSelection(), ['shape-ellipse-1']);
    assert.equal(notifyCount, 2);

    // 4. removeFromSelection con ID no seleccionado: no notifica
    manager.removeFromSelection(['no-estaba']);
    assert.equal(notifyCount, 2, 'No debe notificar si ningún ID fue removido');
  });

  it('selectAll selecciona todas las figuras visibles y desbloqueadas respetando capas', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);
    const layer1Id = manager.getState().children[0].id;

    // Añadir una figura oculta y una bloqueada a la capa 1
    const hiddenShape: Rectangle = {
      id: 'hidden-rect',
      type: 'rectangle',
      name: 'Oculta',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      visible: false,
    };
    const lockedShape: Rectangle = {
      id: 'locked-rect',
      type: 'rectangle',
      name: 'Bloqueada',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      locked: true,
    };
    manager.addShape(layer1Id, hiddenShape);
    manager.addShape(layer1Id, lockedShape);

    // Añadir una capa oculta con una figura normal
    const hiddenLayerId = 'hidden-layer';
    manager.addLayer({
      id: hiddenLayerId,
      type: 'layer',
      name: 'Capa Oculta',
      visible: false,
      children: [
        {
          id: 'rect-in-hidden-layer',
          type: 'rectangle',
          name: 'En Capa Oculta',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ],
    });

    // selectAll debe seleccionar solo las 3 figuras iniciales de la capa 1 (visibles y desbloqueadas)
    manager.selectAll();
    assert.deepEqual(manager.getSelection(), [
      'shape-rect-1',
      'shape-ellipse-1',
      'shape-ellipse-2',
    ]);
  });

  it('updateShapesPosition mueve múltiples figuras en UNA sola actualización y UNA notificación', () => {
    const manager = new StateManager();
    injectSampleShapes(manager);
    const layerId = manager.getState().children[0].id;

    // Añadir un Path para comprobar el desplazamiento de puntos
    const path: Path = {
      id: 'test-path',
      type: 'path',
      name: 'Path',
      x: 100,
      y: 100,
      points: [
        { x: 100, y: 100, handleOut: { x: 120, y: 110 } },
        { x: 150, y: 150, handleIn: { x: 140, y: 130 } },
      ],
    };
    manager.addShape(layerId, path);

    let notifyCount = 0;
    manager.subscribe(() => notifyCount++);

    manager.clearDirty();
    assert.equal(manager.isDirty, false);

    // Mover simultáneamente un rectángulo y el trazado
    const updated = manager.updateShapesPosition([
      { id: 'shape-rect-1', x: 200, y: 250 },
      { id: 'test-path', x: 120, y: 130 }, // dx=+20, dy=+30
    ]);

    assert.equal(updated, true);
    assert.equal(notifyCount, 1, 'Debe emitir exactamente UNA sola notificación para todas las figuras');
    assert.equal(manager.isDirty, true);

    const r = manager.findNode('shape-rect-1') as Rectangle;
    assert.equal(r.x, 200);
    assert.equal(r.y, 250);

    const p = manager.findNode('test-path') as Path;
    assert.equal(p.x, 120);
    assert.equal(p.y, 130);
    assert.equal(p.points[0].x, 120);
    assert.equal(p.points[0].y, 130);
    assert.equal(p.points[0].handleOut?.x, 140);
    assert.equal(p.points[0].handleOut?.y, 140);
    assert.equal(p.points[1].x, 170);
    assert.equal(p.points[1].y, 180);
    assert.equal(p.points[1].handleIn?.x, 160);
    assert.equal(p.points[1].handleIn?.y, 160);

    // Si se envían las mismas coordenadas exactas: no actualiza ni notifica
    const noopUpdated = manager.updateShapesPosition([
      { id: 'shape-rect-1', x: 200, y: 250 },
    ]);
    assert.equal(noopUpdated, false);
    assert.equal(notifyCount, 1, 'No debe notificar si no hubo desplazamientos reales');
  });

  describe('Optimización de Índice Perezoso (WeakMap) e Invarianza de Selección', () => {
    it('el índice se invalida (nuevo documento sin índice en cache) al añadir, borrar, mover y cargar un documento', () => {
      const manager = new StateManager();
      const doc0 = manager.getState();
      const layerId = doc0.children[0].id;

      // Inicialmente doc0 no tiene índice en cache
      assert.equal(hasCachedDocumentIndex(doc0), false);

      // Al consultar findNode, se construye perezosamente
      assert.notEqual(manager.findNode(doc0.id), null);
      assert.equal(hasCachedDocumentIndex(doc0), true);

      // 1. Añadir figura: doc1 !== doc0, doc1 inicia sin índice
      const rect1: Rectangle = {
        id: 'rect-dyn-1',
        type: 'rectangle',
        name: 'Rect Dyn 1',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      };
      manager.addShape(layerId, rect1);
      const doc1 = manager.getState();
      assert.notEqual(doc1, doc0);
      assert.equal(hasCachedDocumentIndex(doc1), false, 'Añadir un nodo produce un nuevo Document cuyo índice no está en cache');

      // Consultar nodo en doc1 construye el índice
      assert.equal(manager.findNode('rect-dyn-1')?.id, 'rect-dyn-1');
      assert.equal(hasCachedDocumentIndex(doc1), true);

      // 2. Mover figura: doc2 !== doc1, doc2 inicia sin índice
      manager.updateShapePosition('rect-dyn-1', 45, 65);
      const doc2 = manager.getState();
      assert.notEqual(doc2, doc1);
      assert.equal(hasCachedDocumentIndex(doc2), false, 'Mover una figura produce un nuevo Document sin índice previo');

      const movedNode = manager.findNode('rect-dyn-1') as Rectangle;
      assert.equal(movedNode.x, 45);
      assert.equal(movedNode.y, 65);
      assert.equal(hasCachedDocumentIndex(doc2), true);

      // 3. Borrar figura: doc3 !== doc2, doc3 inicia sin índice
      manager.removeShape('rect-dyn-1');
      const doc3 = manager.getState();
      assert.notEqual(doc3, doc2);
      assert.equal(hasCachedDocumentIndex(doc3), false, 'Borrar una figura produce un nuevo Document sin índice previo');

      assert.equal(manager.findNode('rect-dyn-1'), null);
      assert.equal(hasCachedDocumentIndex(doc3), true);

      // 4. Cargar documento nuevo (loadState): doc4 !== doc3, doc4 inicia sin índice
      const freshDoc: Document = {
        id: 'doc-loaded-custom',
        type: 'document',
        name: 'Doc Cargado',
        width: 1200,
        height: 800,
        children: [
          {
            id: 'layer-loaded-custom',
            type: 'layer',
            name: 'Capa Cargada',
            children: [
              {
                id: 'rect-in-loaded',
                type: 'rectangle',
                name: 'Rect Cargado',
                x: 30,
                y: 40,
                width: 70,
                height: 70,
              },
            ],
          },
        ],
      };
      manager.loadState(freshDoc);
      const doc4 = manager.getState();
      assert.notEqual(doc4, doc3);
      assert.equal(hasCachedDocumentIndex(doc4), false, 'loadState reemplaza el documento y el nuevo Document no tiene índice hasta su primer uso');

      assert.equal(manager.findNode('rect-in-loaded')?.id, 'rect-in-loaded');
      assert.equal(hasCachedDocumentIndex(doc4), true);

      // findParent también utiliza el índice en O(1)
      const parent = manager.findParent('rect-in-loaded');
      assert.notEqual(parent, null);
      assert.equal(parent?.id, 'layer-loaded-custom');
    });

    it('isSelected y getSelectedNodes devuelven exactamente el mismo resultado y preservan compatibilidad', () => {
      const manager = new StateManager();
      injectSampleShapes(manager);

      // Sin selección
      assert.deepEqual(manager.getSelectedNodes(), []);
      assert.equal(manager.isSelected('shape-rect-1'), false);
      assert.equal(manager.isSelected('shape-ellipse-1'), false);
      assert.equal(manager.isSelected('inexistente'), false);

      // Selección única
      manager.setSelection(['shape-rect-1']);
      assert.equal(manager.isSelected('shape-rect-1'), true);
      assert.equal(manager.isSelected('shape-ellipse-1'), false);
      assert.equal(manager.isSelected('inexistente'), false);

      const nodes1 = manager.getSelectedNodes();
      assert.equal(nodes1.length, 1);
      assert.equal(nodes1[0].id, 'shape-rect-1');

      // Selección múltiple
      manager.setSelection(['shape-rect-1', 'shape-ellipse-1']);
      assert.equal(manager.isSelected('shape-rect-1'), true);
      assert.equal(manager.isSelected('shape-ellipse-1'), true);
      assert.equal(manager.isSelected('shape-ellipse-2'), false);

      const nodes2 = manager.getSelectedNodes();
      assert.equal(nodes2.length, 2);
      assert.equal(nodes2[0].id, 'shape-rect-1');
      assert.equal(nodes2[1].id, 'shape-ellipse-1');

      // Modificar la selección no invalida el documento de getState()
      const docBeforeSelection = manager.getState();
      assert.equal(hasCachedDocumentIndex(docBeforeSelection), true);
      manager.setSelection(['shape-ellipse-2']);
      assert.equal(manager.getState(), docBeforeSelection, 'La identidad del documento se preserva al cambiar selección');
      assert.equal(hasCachedDocumentIndex(manager.getState()), true, 'El índice del documento no se invalida por cambios de selección');

      // toggleInSelection, addToSelection y removeFromSelection operan fielmente
      manager.toggleInSelection('shape-rect-1');
      assert.equal(manager.isSelected('shape-rect-1'), true);
      assert.equal(manager.isSelected('shape-ellipse-2'), true);

      manager.removeFromSelection(['shape-rect-1']);
      assert.equal(manager.isSelected('shape-rect-1'), false);
      assert.equal(manager.isSelected('shape-ellipse-2'), true);

      manager.addToSelection(['shape-rect-1']);
      assert.equal(manager.isSelected('shape-rect-1'), true);
      assert.equal(manager.isSelected('shape-ellipse-2'), true);
    });
  });
});




