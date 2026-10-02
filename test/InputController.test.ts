import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { getSelectionHandles, getShapeAABB, isPointInAABB } from '../src/utils/geometry.ts';
import type { Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

// Helper para mock de Canvas con eventos en Node.js
function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    getContext: () => null,
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    // Método auxiliar para disparar eventos simulados
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('InputController & Hit-testing AABB', () => {
  it('calcula AABB y colisión de punto correctamente para Rectangle y Ellipse', () => {
    const rect: Rectangle = {
      id: 'r1',
      type: 'rectangle',
      name: 'Rect',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    };

    const rectAABB = getShapeAABB(rect);
    assert.equal(rectAABB.minX, 100);
    assert.equal(rectAABB.maxX, 300);
    assert.equal(rectAABB.minY, 100);
    assert.equal(rectAABB.maxY, 200);

    assert.equal(isPointInAABB(150, 150, rectAABB), true);
    assert.equal(isPointInAABB(50, 50, rectAABB), false);

    const ellipse: Ellipse = {
      id: 'e1',
      type: 'ellipse',
      name: 'Ellipse',
      x: 300,
      y: 300,
      radiusX: 50,
      radiusY: 30,
    };

    const ellipseAABB = getShapeAABB(ellipse);
    assert.equal(ellipseAABB.minX, 250);
    assert.equal(ellipseAABB.maxX, 350);
    assert.equal(ellipseAABB.minY, 270);
    assert.equal(ellipseAABB.maxY, 330);

    assert.equal(isPointInAABB(300, 300, ellipseAABB), true);
    assert.equal(isPointInAABB(400, 400, ellipseAABB), false);
  });

  it('respeta el Z-index visual realizando hit-testing en orden inverso', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    // Dos rectángulos que se superponen completamente
    const shapeBottom: Rectangle = {
      id: 'shape-bottom',
      type: 'rectangle',
      name: 'Fondo',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    };

    const shapeTop: Rectangle = {
      id: 'shape-top',
      type: 'rectangle',
      name: 'Frente',
      x: 150,
      y: 150,
      width: 100,
      height: 100,
    };

    manager.addNode(layerId, shapeBottom);
    manager.addNode(layerId, shapeTop);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, manager);

    // Punto (160, 160) está dentro de AMBOS rectángulos.
    // El hit-test inverso debe retornar shapeTop (el de mayor Z-index).
    const hit = controller.hitTest(160, 160);
    assert.ok(hit !== null);
    assert.equal(hit!.id, 'shape-top');

    // Punto (110, 110) solo está dentro de shapeBottom.
    const hitBottom = controller.hitTest(110, 110);
    assert.ok(hitBottom !== null);
    assert.equal(hitBottom!.id, 'shape-bottom');
  });

  it('actualiza el estado marcando el nodo seleccionado con mousedown', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'target-shape',
      type: 'rectangle',
      name: 'Target',
      x: 200,
      y: 200,
      width: 150,
      height: 100,
    };

    manager.addNode(layerId, rect);

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, manager);

    // Simular mousedown sobre la figura (220, 220)
    canvas.dispatchSimulatedEvent('mousedown', {
      clientX: 220,
      clientY: 220,
    });

    const selected = manager.getSelectedNode();
    assert.ok(selected !== null);
    assert.equal(selected!.id, 'target-shape');
    assert.equal(selected!.selected, true);

    // Simular mousedown en espacio vacío (50, 50) -> deselecciona
    canvas.dispatchSimulatedEvent('mousedown', {
      clientX: 50,
      clientY: 50,
    });

    assert.equal(manager.getSelectedNode(), null);
    controller.destroy();
  });

  it('actualiza el estilo del cursor en mousemove cuando sobrevuela una figura', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'hover-shape',
      type: 'rectangle',
      name: 'Hover Shape',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };

    manager.addNode(layerId, rect);

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, manager);

    // Mover sobre la figura
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 120 });
    assert.equal(canvas.style.cursor, 'pointer');
    assert.equal(controller.hoveredShapeId, 'hover-shape');

    // Mover fuera de la figura
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 300, clientY: 300 });
    assert.equal(canvas.style.cursor, 'default');
    assert.equal(controller.hoveredShapeId, null);

    controller.destroy();
  });

  it('getSelectionHandles calcula 5 AABBs de 8x8px correspondientes a las esquinas y el manejador de rotación', () => {
    const rect: Rectangle = {
      id: 'handle-test-rect',
      type: 'rectangle',
      name: 'Rect',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    };

    const handles = getSelectionHandles(rect);
    assert.equal(handles.length, 5);

    const [tl, tr, br, bl, rot] = handles;

    // Top-Left (100, 100) -> minX: 96, maxX: 104, minY: 96, maxY: 104
    assert.equal(tl.type, 'top-left');
    assert.equal(tl.width, 8);
    assert.equal(tl.height, 8);
    assert.equal(tl.minX, 96);
    assert.equal(tl.maxX, 104);
    assert.equal(tl.minY, 96);
    assert.equal(tl.maxY, 104);

    // Top-Right (300, 100) -> minX: 296, maxX: 304, minY: 96, maxY: 104
    assert.equal(tr.type, 'top-right');
    assert.equal(tr.minX, 296);
    assert.equal(tr.maxX, 304);

    // Bottom-Right (300, 200) -> minX: 296, maxX: 304, minY: 196, maxY: 204
    assert.equal(br.type, 'bottom-right');
    assert.equal(br.minY, 196);
    assert.equal(br.maxY, 204);

    // Bottom-Left (100, 200) -> minX: 96, maxX: 104, minY: 196, maxY: 204
    assert.equal(bl.type, 'bottom-left');
    assert.equal(bl.minX, 96);
    assert.equal(bl.maxX, 104);

    // Rotation-Handle: midX = (100 + 300) / 2 = 200, rotY = 100 - 30 = 70
    assert.equal(rot.type, 'rotation-handle');
    assert.equal(rot.minX, 196);
    assert.equal(rot.maxX, 204);
    assert.equal(rot.minY, 66);
    assert.equal(rot.maxY, 74);
  });

  it('activa _isResizing = true y origen del resize al hacer clic en un manejador en lugar de _isDragging', () => {
    const manager = new StateManager();
    const layerId = manager.getState().children[0].id;

    const rect: Rectangle = {
      id: 'selected-rect',
      type: 'rectangle',
      name: 'Selected Rect',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      selected: true,
    };

    manager.addNode(layerId, rect);
    manager.selectNode('selected-rect');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, manager);

    // Top-Left corner handle está centrado en (200, 200), abarca de 196 a 204
    // Clic en (200, 200) colisiona con el manejador 'top-left'
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });

    assert.equal(controller.isResizing, true, '_isResizing debe ser true al hacer clic en un manejador');
    assert.equal(controller.isDragging, false, '_isDragging debe ser false al hacer clic en un manejador');
    assert.deepEqual(controller.resizeOriginPoint, { x: 200, y: 200 }, 'Debe registrar el origen del resize');
    assert.equal(controller.currentResizeHandle, 'top-left');

    // Soltar el mouse
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 200 });
    assert.equal(controller.isResizing, false);

    // Clic en el cuerpo de la figura (250, 250), lejos de los manejadores
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 250, clientY: 250 });
    assert.equal(controller.isResizing, false, '_isResizing debe ser false');
    assert.equal(controller.isDragging, true, '_isDragging debe ser true');

    controller.destroy();
  });

  it('Event Emitter emite toolChange al cambiar de herramienta y permite desuscribirse', () => {
    const manager = new StateManager();
    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, manager);

    const emittedTools: string[] = [];
    const unsubscribe = controller.on('toolChange', (tool) => {
      emittedTools.push(tool);
    });

    controller.setTool('pen');
    assert.deepEqual(emittedTools, ['pen']);

    controller.setTool('select');
    assert.deepEqual(emittedTools, ['pen', 'select']);

    // Si se establece la misma herramienta activa no se debe reemitir
    controller.setTool('select');
    assert.deepEqual(emittedTools, ['pen', 'select']);

    // Desuscribirse
    unsubscribe();
    controller.setTool('pen');
    assert.deepEqual(emittedTools, ['pen', 'select'], 'No debe emitir tras desuscribirse');

    controller.destroy();
  });

  it('elimina el nodo seleccionado al presionar Delete o Backspace y lo deselecciona', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-kb-del',
      type: 'rectangle',
      name: 'Rect Keyboard Delete',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    };
    stateManager.addShape(layerId, rect);
    stateManager.selectNode('rect-kb-del');

    const controller = new InputController(canvas, stateManager, commandManager);

    // 1. Invocar handleKeyDown con 'Delete'
    (controller as any).handleKeyDown({ key: 'Delete', preventDefault: () => {} });

    // La figura debe haber sido eliminada y la selección debe ser null
    assert.equal(stateManager.findNode('rect-kb-del'), null);
    assert.equal(stateManager.getSelectedNode(), null);
    assert.equal(commandManager.canUndo(), true);

    // Deshacer restaura la figura
    commandManager.undo();
    assert.equal(stateManager.findNode('rect-kb-del') !== null, true);

    // Seleccionar de nuevo y probar 'Backspace'
    stateManager.selectNode('rect-kb-del');
    (controller as any).handleKeyDown({ key: 'Backspace', preventDefault: () => {} });

    assert.equal(stateManager.findNode('rect-kb-del'), null);
    assert.equal(stateManager.getSelectedNode(), null);

    controller.destroy();
  });

  it('activa _isRotating = true al hacer clic en rotation-handle, rota en tiempo real con centroide y atan2, y registra RotateCommand en mouseup', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-rotate-interactive',
      type: 'rectangle',
      name: 'Rect Para Rotar',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
    };
    stateManager.addShape(layerId, rect);
    stateManager.selectNode('rect-rotate-interactive');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);

    // Centroide esperado: (150, 150)
    const centroid = controller.getShapeCentroid(rect);
    assert.deepEqual(centroid, { x: 150, y: 150 });

    // Rotation handle está ubicado en (150, 70)
    // 1. Mouse down sobre rotation handle
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 70 });
    assert.equal(controller.isRotating, true, '_isRotating debe ser true');
    assert.equal(controller.isResizing, false);
    assert.equal(controller.isDragging, false);
    assert.equal(controller.initialRotateAngle, 0);

    // 2. Mouse move hacia (250, 150) -> deltaX = 100, deltaY = 0 -> rotación en sentido horario de 90 grados
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 250, clientY: 150 });
    let currentShape = stateManager.findNode('rect-rotate-interactive') as Rectangle;
    assert.equal(currentShape.rotation, 90, 'Debe actualizar rotation a 90 grados en tiempo real');

    // 3. Mouse up
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 250, clientY: 150 });
    assert.equal(controller.isRotating, false, '_isRotating debe restablecerse a false');
    assert.equal(commandManager.canUndo(), true, 'Debe haber registrado un RotateCommand');

    // 4. Undo -> restaura ángulo inicial 0
    commandManager.undo();
    currentShape = stateManager.findNode('rect-rotate-interactive') as Rectangle;
    assert.equal(currentShape.rotation, 0);

    // 5. Redo -> reaplica 90 grados
    commandManager.redo();
    currentShape = stateManager.findNode('rect-rotate-interactive') as Rectangle;
    assert.equal(currentShape.rotation, 90);

    controller.destroy();
  });

  it('el inicio de giro no sufre salto de 90 grados al hacer clic y arrastrar levemente', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-rotate-smooth',
      type: 'rectangle',
      name: 'Rect Rotación Suave',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
    };
    stateManager.addShape(layerId, rect);
    stateManager.selectNode('rect-rotate-smooth');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);

    // Rotation handle está ubicado en (150, 70)
    // 1. Mousedown sobre rotation handle
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 70 });
    assert.equal(controller.isRotating, true);

    // 2. Movimiento mínimo de 1px hacia arriba (150, 69) -> debe mantenerse en 0 grados (sin salto de 90)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 69 });
    let currentShape = stateManager.findNode('rect-rotate-smooth') as Rectangle;
    assert.equal(currentShape.rotation, 0, 'No debe sufrir un salto de 90 grados al arrastrar levemente');

    // 3. Movimiento mínimo de 2px a la derecha (152, 70) -> debe rotar ~1 grado
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 152, clientY: 70 });
    currentShape = stateManager.findNode('rect-rotate-smooth') as Rectangle;
    assert.ok(
      Math.abs((currentShape.rotation ?? 0) - 1) <= 1,
      `Debe iniciar rotación suavemente cerca de 1 grado, obtenido: ${currentShape.rotation}`
    );

    // 4. Escape cancela y restaura el ángulo inicial 0
    canvas.dispatchSimulatedEvent('keydown', { key: 'Escape' });
    currentShape = stateManager.findNode('rect-rotate-smooth') as Rectangle;
    assert.equal(currentShape.rotation, 0, 'Escape debe restaurar el ángulo inicial');
    assert.equal(controller.isRotating, false, 'Escape debe finalizar el estado _isRotating');

    controller.destroy();
  });

  it('rotación con Shift fuerza saltos discretos de 15 grados', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-rotate-shift',
      type: 'rectangle',
      name: 'Rect Shift Rot',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
    };
    stateManager.addShape(layerId, rect);
    stateManager.selectNode('rect-rotate-shift');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);

    // Mousedown en rotation handle (150, 70)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 70 });

    // Mover hacia un ángulo intermedio (~37 grados) con Shift activo
    // Centro: (150, 150). Radio: 80. Ángulo: -90 + 37 = -53 grados.
    const rad = (-53 * Math.PI) / 180;
    const targetX = 150 + 80 * Math.cos(rad);
    const targetY = 150 + 80 * Math.sin(rad);

    canvas.dispatchSimulatedEvent('mousemove', { clientX: targetX, clientY: targetY, shiftKey: true });
    let currentShape = stateManager.findNode('rect-rotate-shift') as Rectangle;
    // 37 redondeado al múltiplo más cercano de 15 es 30 o 45 (en este caso 37/15 = 2.46 -> 30 o 45)
    assert.ok(
      (currentShape.rotation ?? 0) % 15 === 0,
      `Debe ser múltiplo de 15 grados con Shift, obtenido: ${currentShape.rotation}`
    );

    canvas.dispatchSimulatedEvent('mouseup', { clientX: targetX, clientY: targetY });
    controller.destroy();
  });

  it('no registra RotateCommand si se hace clic en rotation-handle sin cambiar el ángulo', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-rotate-nocmd',
      type: 'rectangle',
      name: 'Rect Sin Rotar',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 20,
    };
    stateManager.addShape(layerId, rect);
    stateManager.selectNode('rect-rotate-nocmd');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);

    const handles = getSelectionHandles(rect);
    const rotHandle = handles.find((h) => h.type === 'rotation-handle')!;
    const clickX = (rotHandle.minX + rotHandle.maxX) / 2;
    const clickY = (rotHandle.minY + rotHandle.maxY) / 2;

    // Mouse down en rotation handle
    canvas.dispatchSimulatedEvent('mousedown', { clientX: clickX, clientY: clickY });
    assert.equal(controller.isRotating, true);

    // Mouse up inmediato sin mover
    canvas.dispatchSimulatedEvent('mouseup', { clientX: clickX, clientY: clickY });
    assert.equal(controller.isRotating, false);
    assert.equal(commandManager.canUndo(), false, 'No debe registrar comando si el ángulo no cambió');

    controller.destroy();
  });

  it('herramienta direct-select: mousedown itera sobre points del Path seleccionado e identifica vértice (anchor) con AABB 10x10px', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const path: Path = {
      id: 'path-subselect-1',
      type: 'path',
      name: 'Trazado Subselección',
      x: 0,
      y: 0,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200, handleIn: { x: 170, y: 200 }, handleOut: { x: 230, y: 200 } },
        { x: 300, y: 150 },
      ],
      stroke: '#000',
      strokeWidth: 2,
    };
    stateManager.addShape(layerId, path);
    stateManager.selectNode('path-subselect-1');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager);

    // Activar herramienta direct-select
    controller.setTool('direct-select');
    assert.equal(controller.currentTool, 'direct-select');

    // 1. Clic cerca del vértice 0 (100, 100) en (103, 98) -> dentro del AABB 10x10 ([95, 105] x [95, 105])
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 103, clientY: 98 });
    assert.equal(controller.draggedPointIndex, 0, 'Debe marcar el índice 0 como _draggedPointIndex');
    assert.equal((controller as any)._draggedPointIndex, 0);
    assert.equal(controller.dragTarget?.type, 'anchor');
    assert.equal(controller.directSelectTarget?.pointIndex, 0);

    // 2. Clic cerca del vértice 2 (300, 150) en (296, 153)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 296, clientY: 153 });
    assert.equal(controller.draggedPointIndex, 2);
    assert.equal(controller.dragTarget?.type, 'anchor');

    // 3. Clic fuera de cualquier punto (400, 400)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 400, clientY: 400 });
    assert.equal(controller.draggedPointIndex, null, 'Debe resetearse si no colisiona');
    assert.equal(controller.dragTarget, null);

    controller.destroy();
  });

  it('herramienta direct-select: detecta clics en manejadores handleIn y handleOut específicos', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const path: Path = {
      id: 'path-handles-test',
      type: 'path',
      name: 'Trazado Handles',
      x: 0,
      y: 0,
      points: [
        { x: 50, y: 50 },
        { x: 200, y: 200, handleIn: { x: 160, y: 190 }, handleOut: { x: 240, y: 210 } },
      ],
      stroke: '#38bdf8',
      strokeWidth: 2,
    };
    stateManager.addShape(layerId, path);
    stateManager.selectNode('path-handles-test');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager);
    controller.setTool('direct-select');

    // 1. Clic en handleIn del punto 1: (160, 190) en (162, 189)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 162, clientY: 189 });
    assert.equal(controller.draggedPointIndex, 1);
    assert.equal(controller.dragTarget?.type, 'handleIn');
    assert.equal(controller.draggedTargetType, 'handleIn');

    // 2. Clic en handleOut del punto 1: (240, 210) en (238, 212)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 238, clientY: 212 });
    assert.equal(controller.draggedPointIndex, 1);
    assert.equal(controller.dragTarget?.type, 'handleOut');
    assert.equal(controller.draggedTargetType, 'handleOut');

    controller.destroy();
  });

  it('herramienta direct-select: NO selecciona shapes completos mediante hitTest', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const path: Path = {
      id: 'selected-path',
      type: 'path',
      name: 'Path Previo',
      x: 0,
      y: 0,
      points: [{ x: 50, y: 50 }, { x: 80, y: 80 }],
    };
    const rect: Rectangle = {
      id: 'other-rect',
      type: 'rectangle',
      name: 'Rectángulo No Seleccionable en Direct Select',
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    };

    stateManager.addShape(layerId, path);
    stateManager.addShape(layerId, rect);
    stateManager.selectNode('selected-path');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager);
    controller.setTool('direct-select');

    // Clic sobre el cuerpo del rectángulo en (350, 350)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 350, clientY: 350 });

    // En direct-select, no debe seleccionar la figura 'other-rect'
    const selected = stateManager.getSelectedNode();
    assert.notEqual(selected?.id, 'other-rect', 'No debe seleccionar un nuevo Shape completo en direct-select');
    assert.equal(controller.draggedPointIndex, null);

    controller.destroy();
  });

  it('atajo de teclado "A" activa el modo direct-select', () => {
    const stateManager = new StateManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    assert.equal(controller.currentTool, 'select');

    (controller as any).handleKeyDown({ key: 'a', preventDefault: () => {} });
    assert.equal(controller.currentTool, 'direct-select');

    controller.destroy();
  });

  it('herramienta direct-select: arrastra exclusivamente el vértice seleccionado en tiempo real y registra PointCommand en mouseup', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const path: Path = {
      id: 'path-drag-vertex',
      type: 'path',
      name: 'Trazado Drag Vertex',
      x: 0,
      y: 0,
      points: [
        { x: 100, y: 100, handleIn: { x: 80, y: 100 }, handleOut: { x: 120, y: 100 } },
        { x: 200, y: 200 },
      ],
      stroke: '#000',
    };
    stateManager.addShape(layerId, path);
    stateManager.selectNode('path-drag-vertex');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('direct-select');

    // 1. Mouse down en vértice 0 (100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
    assert.equal(controller.draggedPointIndex, 0);
    assert.equal(controller.dragTarget?.type, 'anchor');

    // 2. Mouse move con desplazamiento delta (+20, +30) -> (120, 130)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 130 });
    let currentPath = stateManager.findNode('path-drag-vertex') as Path;
    assert.equal(currentPath.points[0].x, 120);
    assert.equal(currentPath.points[0].y, 130);
    // Exclusivamente el vértice: los manejadores no deben desplazarse
    assert.deepEqual(currentPath.points[0].handleIn, { x: 80, y: 100 });
    assert.deepEqual(currentPath.points[0].handleOut, { x: 120, y: 100 });

    // 3. Mouse up -> consolida PointCommand
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 120, clientY: 130 });
    assert.equal(commandManager.canUndo(), true, 'Debe haber registrado un PointCommand');

    // 4. Undo -> restaura vértice inicial (100, 100)
    commandManager.undo();
    currentPath = stateManager.findNode('path-drag-vertex') as Path;
    assert.equal(currentPath.points[0].x, 100);
    assert.equal(currentPath.points[0].y, 100);

    // 5. Redo -> reaplica vértice arrastrado (120, 130)
    commandManager.redo();
    currentPath = stateManager.findNode('path-drag-vertex') as Path;
    assert.equal(currentPath.points[0].x, 120);
    assert.equal(currentPath.points[0].y, 130);

    controller.destroy();
  });

  it('herramienta direct-select: arrastra exclusivamente el manejador handleIn en tiempo real y registra PointCommand en mouseup', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const path: Path = {
      id: 'path-drag-handle',
      type: 'path',
      name: 'Trazado Drag Handle',
      x: 0,
      y: 0,
      points: [
        { x: 100, y: 100, handleIn: { x: 80, y: 100 }, handleOut: { x: 120, y: 100 } },
      ],
      stroke: '#000',
    };
    stateManager.addShape(layerId, path);
    stateManager.selectNode('path-drag-handle');

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('direct-select');

    // 1. Mouse down en handleIn (80, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 80, clientY: 100 });
    assert.equal(controller.draggedPointIndex, 0);
    assert.equal(controller.dragTarget?.type, 'handleIn');

    // 2. Mouse move desplazando el handleIn a (60, 120) -> delta (-20, +20)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 60, clientY: 120 });
    let currentPath = stateManager.findNode('path-drag-handle') as Path;
    // Exclusivamente handleIn cambia
    assert.deepEqual(currentPath.points[0].handleIn, { x: 60, y: 120 });
    assert.equal(currentPath.points[0].x, 100, 'El vértice no debe cambiar al arrastrar el manejador');
    assert.deepEqual(currentPath.points[0].handleOut, { x: 120, y: 100 });

    // 3. Mouse up -> consolida PointCommand
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 60, clientY: 120 });
    assert.equal(commandManager.canUndo(), true);

    // 4. Undo -> restaura handleIn a (80, 100)
    commandManager.undo();
    currentPath = stateManager.findNode('path-drag-handle') as Path;
    assert.deepEqual(currentPath.points[0].handleIn, { x: 80, y: 100 });

    // 5. Redo -> reaplica handleIn a (60, 120)
    commandManager.redo();
    currentPath = stateManager.findNode('path-drag-handle') as Path;
    assert.deepEqual(currentPath.points[0].handleIn, { x: 60, y: 120 });

    controller.destroy();
  });

  it('herramienta rectangle: mousedown + mousemove genera vista previa y mouseup crea Rectangle con estilo por defecto y AddShapeCommand', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('rectangle');

    assert.equal(controller.currentTool, 'rectangle');
    assert.equal(canvas.style.cursor, 'crosshair');

    // 1. Mousedown inicia la creación
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 50, clientY: 60 });
    assert.equal(controller.isCreatingShape, true);

    // 2. Mousemove actualiza la vista previa (no modifica el Scene Graph)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 120 });
    assert.notEqual(controller.shapePreview, null);
    assert.equal(controller.shapePreview?.type, 'rectangle');
    assert.equal(controller.shapePreview?.x, 50);
    assert.equal(controller.shapePreview?.y, 60);
    assert.equal(controller.shapePreview?.width, 100);
    assert.equal(controller.shapePreview?.height, 60);

    const layerBefore = stateManager.findNode(layerId) as any;
    assert.equal(layerBefore.children.length, 0, 'No debe añadirse la figura al Scene Graph antes de soltar');

    // 3. Mouseup consolida la figura en el Scene Graph
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 120 });
    const layerAfter = stateManager.findNode(layerId) as any;
    assert.equal(layerAfter.children.length, 1);

    const createdRect = layerAfter.children[0] as Rectangle;
    assert.equal(createdRect.type, 'rectangle');
    assert.equal(createdRect.x, 50);
    assert.equal(createdRect.y, 60);
    assert.equal(createdRect.width, 100);
    assert.equal(createdRect.height, 60);
    assert.equal(createdRect.fill, '#38bdf8');
    assert.equal(createdRect.stroke, '#0284c7');
    assert.equal(createdRect.strokeWidth, 2);
    assert.equal(createdRect.name, 'Rectángulo 1');

    // Tras crear la figura: seleccionada y retorna a herramienta 'select'
    assert.equal(createdRect.selected, true);
    assert.equal(stateManager.getSelectedNode()?.id, createdRect.id);
    assert.equal(controller.currentTool, 'select');
    assert.equal(controller.shapePreview, null);
    assert.equal(controller.isCreatingShape, false);
    assert.equal(commandManager.canUndo(), true);

    controller.destroy();
  });

  it('herramienta ellipse: mousedown + mousemove genera vista previa y mouseup crea Ellipse con convención de centro x/y', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('ellipse');

    assert.equal(controller.currentTool, 'ellipse');
    assert.equal(canvas.style.cursor, 'crosshair');

    // 1. Mousedown en (100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
    assert.equal(controller.isCreatingShape, true);

    // 2. Mousemove a (200, 160) -> centro (150, 130), radios (50, 30)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 200, clientY: 160 });
    assert.notEqual(controller.shapePreview, null);
    assert.equal(controller.shapePreview?.type, 'ellipse');
    assert.equal(controller.shapePreview?.x, 150);
    assert.equal(controller.shapePreview?.y, 130);
    assert.equal(controller.shapePreview?.radiusX, 50);
    assert.equal(controller.shapePreview?.radiusY, 30);

    // 3. Mouseup consolida la elipse
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 160 });
    const layerAfter = stateManager.findNode(layerId) as any;
    assert.equal(layerAfter.children.length, 1);

    const createdEllipse = layerAfter.children[0] as Ellipse;
    assert.equal(createdEllipse.type, 'ellipse');
    assert.equal(createdEllipse.x, 150);
    assert.equal(createdEllipse.y, 130);
    assert.equal(createdEllipse.radiusX, 50);
    assert.equal(createdEllipse.radiusY, 30);
    assert.equal(createdEllipse.fill, '#38bdf8');
    assert.equal(createdEllipse.stroke, '#0284c7');
    assert.equal(createdEllipse.name, 'Elipse 1');
    assert.equal(createdEllipse.selected, true);

    assert.equal(controller.currentTool, 'select');
    assert.equal(controller.shapePreview, null);

    controller.destroy();
  });

  it('Shift fuerza proporción 1:1 (cuadrado / círculo perfecto) durante el arrastre y creación', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);

    // 1. Rectángulo con Shift (100, 100) a (180, 130) -> lado mayor = 80 -> cuadrado 80x80
    controller.setTool('rectangle');
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: true });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 180, clientY: 130, shiftKey: true });
    assert.equal(controller.shapePreview?.width, 80);
    assert.equal(controller.shapePreview?.height, 80);

    canvas.dispatchSimulatedEvent('mouseup', { clientX: 180, clientY: 130, shiftKey: true });
    let layer = stateManager.findNode(layerId) as any;
    const rect = layer.children[0] as Rectangle;
    assert.equal(rect.width, 80);
    assert.equal(rect.height, 80);

    // 2. Elipse con Shift (100, 100) a (180, 120) -> lado mayor = 80 -> radio = 40 (círculo)
    controller.setTool('ellipse');
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, shiftKey: true });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 180, clientY: 120, shiftKey: true });
    assert.equal(controller.shapePreview?.radiusX, 40);
    assert.equal(controller.shapePreview?.radiusY, 40);

    canvas.dispatchSimulatedEvent('mouseup', { clientX: 180, clientY: 120, shiftKey: true });
    layer = stateManager.findNode(layerId) as any;
    const ellipse = layer.children[1] as Ellipse;
    assert.equal(ellipse.radiusX, 40);
    assert.equal(ellipse.radiusY, 40);

    controller.destroy();
  });

  it('cancelación con Escape descarta la creación y limpia la vista previa', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('rectangle');

    canvas.dispatchSimulatedEvent('mousedown', { clientX: 50, clientY: 50 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 120, clientY: 120 });
    assert.equal(controller.isCreatingShape, true);
    assert.notEqual(controller.shapePreview, null);

    // Cancelar con Escape
    controller.handleKeyDown({ key: 'Escape' } as KeyboardEvent);
    assert.equal(controller.isCreatingShape, false);
    assert.equal(controller.shapePreview, null);

    // mouseup posterior no debe crear figura alguna
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 120, clientY: 120 });
    const layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 0);
    assert.equal(commandManager.canUndo(), false);

    controller.destroy();
  });

  it('umbral mínimo: arrastre menor de 3 px cancela sin crear nada ni registrar comando', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('rectangle');

    // Clic con movimiento menor a 3px (deltaX=1, deltaY=1 -> dist ~1.41px)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 50, clientY: 50 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 51, clientY: 51 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 51, clientY: 51 });

    const layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 0);
    assert.equal(commandManager.canUndo(), false);

    // Clic estático sin movimiento en herramienta elipse
    controller.setTool('ellipse');
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });
    assert.equal(layer.children.length, 0);
    assert.equal(commandManager.canUndo(), false);

    controller.destroy();
  });

  it('deshacer (undo) tras crear la figura la elimina del Scene Graph y la deselecciona, y rehacer (redo) la restaura', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const canvas = createMockCanvas() as unknown as HTMLCanvasElement & {
      dispatchSimulatedEvent: (type: string, e: unknown) => void;
    };
    const controller = new InputController(canvas, stateManager, commandManager);
    controller.setTool('rectangle');

    canvas.dispatchSimulatedEvent('mousedown', { clientX: 50, clientY: 50 });
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 100, clientY: 100 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 100, clientY: 100 });

    let layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1);
    const createdId = layer.children[0].id;
    assert.equal(stateManager.getSelectedNode()?.id, createdId);

    // Undo -> debe eliminar la figura y deseleccionarla
    assert.equal(commandManager.undo(), true);
    layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 0);
    assert.equal(stateManager.getSelectedNode(), null);

    // Redo -> debe restaurar la figura
    assert.equal(commandManager.redo(), true);
    layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1);
    assert.equal(layer.children[0].id, createdId);

    controller.destroy();
  });

  it('atajos de teclado "R" y "E" activan las herramientas rectangle y ellipse y se ignoran al escribir en un input', () => {
    const stateManager = new StateManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager);

    assert.equal(controller.currentTool, 'select');

    // 'r' activa herramienta rectangle
    controller.handleKeyDown({ key: 'r' } as KeyboardEvent);
    assert.equal(controller.currentTool, 'rectangle');

    // 'e' activa herramienta ellipse
    controller.handleKeyDown({ key: 'e' } as KeyboardEvent);
    assert.equal(controller.currentTool, 'ellipse');

    // Al escribir en un input o textarea no deben dispararse los atajos
    controller.setTool('select');
    controller.handleKeyDown({ key: 'r', target: { tagName: 'INPUT' } } as unknown as KeyboardEvent);
    assert.equal(controller.currentTool, 'select', 'No debe cambiar a rectangle si el foco está en un INPUT');

    controller.handleKeyDown({ key: 'e', target: { tagName: 'TEXTAREA' } } as unknown as KeyboardEvent);
    assert.equal(controller.currentTool, 'select', 'No debe cambiar a ellipse si el foco está en un TEXTAREA');

    controller.destroy();
  });
});





