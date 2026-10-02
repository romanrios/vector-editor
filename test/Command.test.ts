import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import { StyleCommand } from '../src/commands/StyleCommand.ts';
import { DeleteCommand } from '../src/commands/DeleteCommand.ts';
import { RotateCommand } from '../src/commands/RotateCommand.ts';
import { PointCommand } from '../src/commands/PointCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Ellipse, Path, Rectangle } from '../src/types/scene-graph.ts';

// Mock de Canvas para simular eventos en Node.js
function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
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
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('Patrón Command & Historial Deshacer/Rehacer', () => {
  it('gestiona la pila de undo y redo mediante CommandManager', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-move',
      type: 'rectangle',
      name: 'Rect',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    };

    manager.addShape(manager.getState().children[0].id, rect);

    // Crear y ejecutar comando de traslación de (100, 100) a (150, 120)
    const command1 = new TranslateCommand(manager, 'rect-move', 100, 100, 150, 120);
    commandManager.executeCommand(command1);

    const shapeAfterExec = manager.findNode('rect-move') as Rectangle;
    assert.equal(shapeAfterExec.x, 150);
    assert.equal(shapeAfterExec.y, 120);
    assert.equal(commandManager.canUndo(), true);
    assert.equal(commandManager.canRedo(), false);

    // Deshacer (Undo)
    assert.equal(commandManager.undo(), true);
    const shapeAfterUndo = manager.findNode('rect-move') as Rectangle;
    assert.equal(shapeAfterUndo.x, 100);
    assert.equal(shapeAfterUndo.y, 100);
    assert.equal(commandManager.canUndo(), false);
    assert.equal(commandManager.canRedo(), true);

    // Rehacer (Redo)
    assert.equal(commandManager.redo(), true);
    const shapeAfterRedo = manager.findNode('rect-move') as Rectangle;
    assert.equal(shapeAfterRedo.x, 150);
    assert.equal(shapeAfterRedo.y, 120);
    assert.equal(commandManager.canUndo(), true);
    assert.equal(commandManager.canRedo(), false);
  });

  it('invalida la pila de redo cuando se ejecuta una nueva acción directa', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-branch',
      type: 'rectangle',
      name: 'Rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    commandManager.executeCommand(new TranslateCommand(manager, 'rect-branch', 0, 0, 10, 10));
    commandManager.undo();
    assert.equal(commandManager.canRedo(), true);

    // Nueva acción directa
    commandManager.executeCommand(new TranslateCommand(manager, 'rect-branch', 0, 0, 99, 99));
    assert.equal(commandManager.canRedo(), false, 'Redo stack debe invalidarse');
  });

  it('arrastre en InputController aplica delta en tiempo real y registra en mouseup', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'drag-shape',
      type: 'rectangle',
      name: 'Draggable',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const controller = new InputController(canvas, manager, commandManager);

    // 1. Mousedown sobre la figura en (210, 210)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 210, clientY: 210 });
    assert.equal(controller.isDragging, true);

    // 2. Mousemove delta (+30 en X, +50 en Y) -> cursor en (240, 260)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 240, clientY: 260 });
    let shape = manager.findNode('drag-shape') as Rectangle;
    assert.equal(shape.x, 230, 'Posición X debe actualizarse en tiempo real (200 + 30)');
    assert.equal(shape.y, 250, 'Posición Y debe actualizarse en tiempo real (200 + 50)');

    // El historial aún no debe tener el comando hasta que se suelte el mouse
    assert.equal(commandManager.undoCount, 0);

    // 3. Mouseup en (240, 260) -> finaliza y registra el comando
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 240, clientY: 260 });
    assert.equal(controller.isDragging, false);
    assert.equal(commandManager.undoCount, 1);

    // 4. Probar Deshacer tras el arrastre
    commandManager.undo();
    shape = manager.findNode('drag-shape') as Rectangle;
    assert.equal(shape.x, 200, 'Undo debe restaurar la posición X original');
    assert.equal(shape.y, 200, 'Undo debe restaurar la posición Y original');

    // 5. Probar Rehacer
    commandManager.redo();
    shape = manager.findNode('drag-shape') as Rectangle;
    assert.equal(shape.x, 230, 'Redo debe restaurar la posición desplazada');
    assert.equal(shape.y, 250);

    controller.destroy();
  });

  it('no registra ningún comando en el historial si se hace clic sin arrastre (delta 0)', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'click-only',
      type: 'rectangle',
      name: 'Click Only',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const controller = new InputController(canvas, manager, commandManager);

    // Mousedown y Mouseup en las mismas coordenadas
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 60, clientY: 60 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 60, clientY: 60 });

    assert.equal(commandManager.undoCount, 0, 'No debe registrarse comando si no hubo movimiento');
    controller.destroy();
  });

  it('ResizeCommand: modifica dimensiones/radios y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'resize-rect',
      type: 'rectangle',
      name: 'Resize Rect',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const initialDims = { x: 100, y: 100, width: 80, height: 60 };
    const finalDims = { x: 90, y: 90, width: 120, height: 100 };

    const command = new ResizeCommand(manager, 'resize-rect', initialDims, finalDims);
    commandManager.executeCommand(command);

    let shape = manager.findNode('resize-rect') as Rectangle;
    assert.equal(shape.x, 90);
    assert.equal(shape.y, 90);
    assert.equal(shape.width, 120);
    assert.equal(shape.height, 100);

    // Deshacer
    assert.equal(commandManager.undo(), true);
    shape = manager.findNode('resize-rect') as Rectangle;
    assert.equal(shape.x, 100);
    assert.equal(shape.y, 100);
    assert.equal(shape.width, 80);
    assert.equal(shape.height, 60);

    // Rehacer
    assert.equal(commandManager.redo(), true);
    shape = manager.findNode('resize-rect') as Rectangle;
    assert.equal(shape.x, 90);
    assert.equal(shape.y, 90);
    assert.equal(shape.width, 120);
    assert.equal(shape.height, 100);
  });

  it('arrastre de manejador de esquina redimensiona figura en tiempo real y registra ResizeCommand en mouseup', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'interactive-resize',
      type: 'rectangle',
      name: 'Interactive Resize',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);
    manager.selectNode('interactive-resize');

    const controller = new InputController(canvas, manager, commandManager);

    // 1. Esquina bottom-right está en (200, 200). Manejador centrado en (200, 200), abarca 196 a 204
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'bottom-right');

    // 2. Mover ratón en +40 en X y +30 en Y -> cursor en (240, 230)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 240, clientY: 230 });
    let shape = manager.findNode('interactive-resize') as Rectangle;
    assert.equal(shape.x, 100, 'X debe permanecer fijo al arrastrar bottom-right');
    assert.equal(shape.y, 100, 'Y debe permanecer fijo al arrastrar bottom-right');
    assert.equal(shape.width, 140, 'Width debe actualizarse en tiempo real (100 + 40)');
    assert.equal(shape.height, 130, 'Height debe actualizarse en tiempo real (100 + 30)');

    // El comando no debe registrarse aún
    assert.equal(commandManager.undoCount, 0);

    // 3. Mouseup en (240, 230)
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 240, clientY: 230 });
    assert.equal(controller.isResizing, false);
    assert.equal(commandManager.undoCount, 1, 'Debe haberse registrado el ResizeCommand');

    // 4. Undo
    commandManager.undo();
    shape = manager.findNode('interactive-resize') as Rectangle;
    assert.equal(shape.width, 100, 'Undo debe restaurar width original');
    assert.equal(shape.height, 100, 'Undo debe restaurar height original');

    // 5. Redo
    commandManager.redo();
    shape = manager.findNode('interactive-resize') as Rectangle;
    assert.equal(shape.width, 140);
    assert.equal(shape.height, 130);

    controller.destroy();
  });

  it('redimensionado con manejador top-left desplaza x, y y actualiza dimensiones correctamente', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'topleft-resize',
      type: 'rectangle',
      name: 'TopLeft Rect',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);
    manager.selectNode('topleft-resize');

    const controller = new InputController(canvas, manager, commandManager);

    // Top-left está en (100, 100)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'top-left');

    // Mover hacia la izquierda (-20 en X) y hacia arriba (-30 en Y) -> cursor en (80, 70)
    // El ancho debe aumentar a 120 (100 - (-20)), la posición X debe desplazarse a 80
    // La altura debe aumentar a 130 (100 - (-30)), la posición Y debe desplazarse a 70
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 80, clientY: 70 });
    let shape = manager.findNode('topleft-resize') as Rectangle;
    assert.equal(shape.x, 80, 'X debe ser 80');
    assert.equal(shape.y, 70, 'Y debe ser 70');
    assert.equal(shape.width, 120, 'Width debe ser 120');
    assert.equal(shape.height, 130, 'Height debe ser 130');

    canvas.dispatchSimulatedEvent('mouseup', { clientX: 80, clientY: 70 });
    assert.equal(commandManager.undoCount, 1);

    commandManager.undo();
    shape = manager.findNode('topleft-resize') as Rectangle;
    assert.equal(shape.x, 100);
    assert.equal(shape.y, 100);
    assert.equal(shape.width, 100);
    assert.equal(shape.height, 100);

    controller.destroy();
  });

  it('redimensionado de una elipse actualiza radiusX, radiusY y centro con soporte de undo/redo', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const ellipse: Ellipse = {
      id: 'ellipse-resize',
      type: 'ellipse',
      name: 'Ellipse',
      x: 200,
      y: 200,
      radiusX: 50,
      radiusY: 50,
    };
    manager.addShape(manager.getState().children[0].id, ellipse);
    manager.selectNode('ellipse-resize');

    // AABB: minX = 150, maxX = 250, minY = 150, maxY = 250
    // Bottom-right handle en (250, 250)
    const controller = new InputController(canvas, manager, commandManager);

    canvas.dispatchSimulatedEvent('mousedown', { clientX: 250, clientY: 250 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'bottom-right');

    // Arrastrar +20 en X y +20 en Y (ancho pasa de 100 a 120, alto de 100 a 120)
    // Nuevo radioX: 60, nuevo radioY: 60
    // Nuevo centro: minX(150) + 60 = 210, minY(150) + 60 = 210
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 270, clientY: 270 });
    let shape = manager.findNode('ellipse-resize') as Ellipse;
    assert.equal(shape.radiusX, 60, 'radiusX debe ser 60');
    assert.equal(shape.radiusY, 60, 'radiusY debe ser 60');
    assert.equal(shape.x, 210, 'Centro X debe ser 210');
    assert.equal(shape.y, 210, 'Centro Y debe ser 210');

    canvas.dispatchSimulatedEvent('mouseup', { clientX: 270, clientY: 270 });
    assert.equal(commandManager.undoCount, 1);

    commandManager.undo();
    shape = manager.findNode('ellipse-resize') as Ellipse;
    assert.equal(shape.radiusX, 50, 'Undo debe restaurar radiusX');
    assert.equal(shape.radiusY, 50, 'Undo debe restaurar radiusY');
    assert.equal(shape.x, 200, 'Undo debe restaurar centro X');
    assert.equal(shape.y, 200, 'Undo debe restaurar centro Y');

    controller.destroy();
  });

  it('no registra ResizeCommand si se hace clic en un manejador sin arrastre', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const rect: Rectangle = {
      id: 'no-move-handle',
      type: 'rectangle',
      name: 'No Move Handle',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    };
    manager.addShape(manager.getState().children[0].id, rect);
    manager.selectNode('no-move-handle');

    const controller = new InputController(canvas, manager, commandManager);

    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 200, clientY: 200 });

    assert.equal(commandManager.undoCount, 0, 'No debe registrar ResizeCommand si el delta fue 0');
    controller.destroy();
  });

  it('StyleCommand: actualiza estilos y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const rect: Rectangle = {
      id: 'rect-style',
      type: 'rectangle',
      name: 'Rect',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 1,
      opacity: 1,
    };
    manager.addShape(manager.getState().children[0].id, rect);

    const initialStyles = { fill: '#ff0000', strokeWidth: 1, opacity: 1 };
    const finalStyles = { fill: '#00ff00', strokeWidth: 5, opacity: 0.5 };

    const cmd = new StyleCommand(manager, 'rect-style', initialStyles, finalStyles);
    commandManager.executeCommand(cmd);

    let current = manager.findNode('rect-style') as Rectangle;
    assert.equal(current.fill, '#00ff00');
    assert.equal(current.strokeWidth, 5);
    assert.equal(current.opacity, 0.5);

    // Undo
    assert.equal(commandManager.undo(), true);
    current = manager.findNode('rect-style') as Rectangle;
    assert.equal(current.fill, '#ff0000');
    assert.equal(current.strokeWidth, 1);
    assert.equal(current.opacity, 1);

    // Redo
    assert.equal(commandManager.redo(), true);
    current = manager.findNode('rect-style') as Rectangle;
    assert.equal(current.fill, '#00ff00');
    assert.equal(current.strokeWidth, 5);
    assert.equal(current.opacity, 0.5);
  });

  it('DeleteCommand: elimina una figura del Scene Graph y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = manager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-delete',
      type: 'rectangle',
      name: 'Rect Para Eliminar',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    };
    manager.addShape(layerId, rect);

    assert.equal(manager.findNode('rect-delete') !== null, true);

    const cmd = new DeleteCommand(manager, rect, layerId);
    commandManager.executeCommand(cmd);

    // Debe haberse eliminado
    assert.equal(manager.findNode('rect-delete'), null);
    assert.equal(commandManager.canUndo(), true);

    // Undo -> debe reinyectar el shape
    assert.equal(commandManager.undo(), true);
    assert.equal(manager.findNode('rect-delete') !== null, true);

    // Redo -> debe eliminarlo de nuevo
    assert.equal(commandManager.redo(), true);
    assert.equal(manager.findNode('rect-delete'), null);
  });

  it('RotateCommand: actualiza el ángulo de rotación y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = manager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-rotate-cmd',
      type: 'rectangle',
      name: 'Rect Rotate Cmd',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
    };
    manager.addShape(layerId, rect);

    const cmd = new RotateCommand(manager, 'rect-rotate-cmd', 0, 45);
    commandManager.executeCommand(cmd);

    let current = manager.findNode('rect-rotate-cmd') as Rectangle;
    assert.equal(current.rotation, 45);
    assert.equal(commandManager.canUndo(), true);

    // Undo -> debe regresar a 0
    assert.equal(commandManager.undo(), true);
    current = manager.findNode('rect-rotate-cmd') as Rectangle;
    assert.equal(current.rotation, 0);

    // Redo -> debe volver a 45
    assert.equal(commandManager.redo(), true);
    current = manager.findNode('rect-rotate-cmd') as Rectangle;
    assert.equal(current.rotation, 45);
  });

  it('PointCommand: modifica los puntos de un Path y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = manager.getState().children[0].id;
    const initialPoints = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ];
    const finalPoints = [
      { x: 25, y: 30 },
      { x: 50, y: 50 },
    ];

    const path: Path = {
      id: 'path-cmd-test',
      type: 'path',
      name: 'Path Cmd Test',
      x: 0,
      y: 0,
      points: initialPoints,
    };
    manager.addShape(layerId, path);

    const cmd = new PointCommand(manager, 'path-cmd-test', initialPoints, finalPoints);
    commandManager.executeCommand(cmd);

    let current = manager.findNode('path-cmd-test') as Path;
    assert.deepEqual(current.points, finalPoints);
    assert.equal(commandManager.canUndo(), true);

    // Undo -> debe restaurar initialPoints
    assert.equal(commandManager.undo(), true);
    current = manager.findNode('path-cmd-test') as Path;
    assert.deepEqual(current.points, initialPoints);

    // Redo -> debe aplicar finalPoints
    assert.equal(commandManager.redo(), true);
    current = manager.findNode('path-cmd-test') as Path;
    assert.deepEqual(current.points, finalPoints);
  });

  it('ResizeCommand: escala puntos y manejadores de un Path y permite deshacer y rehacer', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();

    const layerId = manager.getState().children[0].id;
    const initialPoints = [
      { x: 100, y: 100, handleOut: { x: 150, y: 100 } },
      { x: 200, y: 200, handleIn: { x: 180, y: 200 } },
    ];
    const finalPoints = [
      { x: 100, y: 100, handleOut: { x: 175, y: 100 } },
      { x: 250, y: 250, handleIn: { x: 220, y: 250 } },
    ];

    const path: Path = {
      id: 'path-resize-cmd',
      type: 'path',
      name: 'Path Resize Test',
      x: 100,
      y: 100,
      points: initialPoints,
    };
    manager.addShape(layerId, path);

    const initialDims = { x: 100, y: 100, width: 100, height: 100, points: initialPoints };
    const finalDims = { x: 100, y: 100, width: 150, height: 150, points: finalPoints };

    const cmd = new ResizeCommand(manager, 'path-resize-cmd', initialDims, finalDims);
    commandManager.executeCommand(cmd);

    let current = manager.findNode('path-resize-cmd') as Path;
    assert.deepEqual(current.points, finalPoints);
    assert.equal(commandManager.canUndo(), true);

    // Undo -> restaura initialPoints
    assert.equal(commandManager.undo(), true);
    current = manager.findNode('path-resize-cmd') as Path;
    assert.deepEqual(current.points, initialPoints);

    // Redo -> reaplica finalPoints
    assert.equal(commandManager.redo(), true);
    current = manager.findNode('path-resize-cmd') as Path;
    assert.deepEqual(current.points, finalPoints);
  });

  it('arrastre de manejador de esquina escala un Path interactivamente con soporte de undo/redo', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const layerId = manager.getState().children[0].id;
    const path: Path = {
      id: 'path-interactive-resize',
      type: 'path',
      name: 'Path Interactive Resize',
      x: 100,
      y: 100,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
    };
    manager.addShape(layerId, path);
    manager.selectNode('path-interactive-resize');

    const controller = new InputController(canvas, manager, commandManager);

    // AABB va de (100, 100) a (200, 200). Manejador bottom-right está centrado en (200, 200)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 200 });
    assert.equal(controller.isResizing, true);
    assert.equal(controller.currentResizeHandle, 'bottom-right');

    // Mover ratón +50 en X, +50 en Y -> cursor en (250, 250) (escala a 150x150)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 250, clientY: 250 });
    let current = manager.findNode('path-interactive-resize') as Path;
    assert.equal(current.points[0].x, 100, 'Punto origen permanece fijo');
    assert.equal(current.points[0].y, 100, 'Punto origen permanece fijo');
    assert.equal(current.points[1].x, 250, 'Punto extremo se escala a 250');
    assert.equal(current.points[1].y, 250, 'Punto extremo se escala a 250');

    // Mouse up
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 250, clientY: 250 });
    assert.equal(controller.isResizing, false);
    assert.equal(commandManager.undoCount, 1);

    // Undo -> restaura puntos originales
    commandManager.undo();
    current = manager.findNode('path-interactive-resize') as Path;
    assert.equal(current.points[1].x, 200);
    assert.equal(current.points[1].y, 200);

    // Redo -> reaplica puntos escalados
    commandManager.redo();
    current = manager.findNode('path-interactive-resize') as Path;
    assert.equal(current.points[1].x, 250);
    assert.equal(current.points[1].y, 250);

    controller.destroy();
  });

  it('arrastre de rotation-handle rota un Path interactivamente con soporte de undo/redo', () => {
    const manager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();

    const layerId = manager.getState().children[0].id;
    const path: Path = {
      id: 'path-interactive-rotate',
      type: 'path',
      name: 'Path Interactive Rotate',
      x: 100,
      y: 100,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      rotation: 0,
    };
    manager.addShape(layerId, path);
    manager.selectNode('path-interactive-rotate');

    const controller = new InputController(canvas, manager, commandManager);

    // Centroide: (150, 150)
    const centroid = controller.getShapeCentroid(path);
    assert.deepEqual(centroid, { x: 150, y: 150 });

    // Rotation handle está en (150, 70) (minY: 100 - 30 = 70)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 70 });
    assert.equal(controller.isRotating, true);
    assert.equal(controller.rotatingNodeId, 'path-interactive-rotate');

    // Mover hacia (150, 250) -> deltaX = 0, deltaY = 100 -> 90 grados
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 250 });
    let current = manager.findNode('path-interactive-rotate') as Path;
    assert.equal(current.rotation, 90, 'Path debe rotar a 90 grados en tiempo real');

    // Mouse up
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 250 });
    assert.equal(controller.isRotating, false);
    assert.equal(commandManager.undoCount, 1);

    // Undo -> restaura 0 grados
    commandManager.undo();
    current = manager.findNode('path-interactive-rotate') as Path;
    assert.equal(current.rotation, 0);

    // Redo -> reaplica 90 grados
    commandManager.redo();
    current = manager.findNode('path-interactive-rotate') as Path;
    assert.equal(current.rotation, 90);

    controller.destroy();
  });
});


