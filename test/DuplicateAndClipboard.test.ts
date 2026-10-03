import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { AddShapeCommand } from '../src/commands/AddShapeCommand.ts';
import { cloneShape, generateClonedShapeId } from '../src/utils/cloneShape.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle, Ellipse, Path, PathPoint, Layer } from '../src/types/scene-graph.ts';

// Mock simple de canvas para Node.js
function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
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
  } as unknown as HTMLCanvasElement;
}

// Mock simple de elemento DOM
class MockElement {
  public id: string;
  public tagName: string;
  public style: Record<string, string> = {};
  public value: string = '';
  public isContentEditable: boolean = false;
  private listeners: Record<string, ((e?: unknown) => void)[]> = {};

  constructor(id: string, tagName: string = 'BUTTON') {
    this.id = id;
    this.tagName = tagName;
  }

  public addEventListener(event: string, cb: (e?: unknown) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  public removeEventListener(event: string, cb: (e?: unknown) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((l) => l !== cb);
  }

  public click(): void {
    if (this.listeners['click']) {
      for (const listener of this.listeners['click']) {
        listener({ target: this });
      }
    }
  }

  public classList = {
    toggle: () => {},
    contains: () => false,
  };

  public setAttribute(): void {}
  public getAttribute(): string | null {
    return null;
  }
}

describe('Función pura cloneShape', () => {
  it('clona un Rectangle con nuevo id, nombre derivado ("... copia") y desplazamiento (dx, dy)', () => {
    const original: Rectangle = {
      id: 'rect-original',
      type: 'rectangle',
      name: 'Rectángulo 1',
      x: 50,
      y: 80,
      width: 120,
      height: 60,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
    };

    const cloned = cloneShape(original, { dx: 15, dy: 25 });

    assert.notEqual(cloned, original);
    assert.notEqual(cloned.id, original.id);
    assert.ok(cloned.id.startsWith('rectangle-'));
    assert.equal(cloned.name, 'Rectángulo 1 copia');
    assert.equal(cloned.x, 65);
    assert.equal(cloned.y, 105);
    assert.equal(cloned.width, 120);
    assert.equal(cloned.height, 60);
    assert.equal(cloned.fill, '#ff0000');
    assert.equal(cloned.selected, false);
    assert.ok(Object.isFrozen(cloned));
  });

  it('clona un Ellipse con nuevo id, nombre derivado y desplazamiento', () => {
    const original: Ellipse = {
      id: 'ellipse-original',
      type: 'ellipse',
      name: 'Elipse Base',
      x: 100,
      y: 100,
      radiusX: 40,
      radiusY: 30,
      fill: '#00ff00',
    };

    const cloned = cloneShape(original, { dx: 10, dy: -10 });

    assert.notEqual(cloned, original);
    assert.notEqual(cloned.id, original.id);
    assert.ok(cloned.id.startsWith('ellipse-'));
    assert.equal(cloned.name, 'Elipse Base copia');
    assert.equal(cloned.x, 110);
    assert.equal(cloned.y, 90);
    assert.equal(cloned.radiusX, 40);
    assert.equal(cloned.radiusY, 30);
    assert.equal(cloned.selected, false);
    assert.ok(Object.isFrozen(cloned));
  });

  it('clona un Path sin compartir referencias en puntos ni en manejadores Bézier', () => {
    const originalPoints: PathPoint[] = [
      {
        x: 10,
        y: 20,
        handleIn: { x: 5, y: 15 },
        handleOut: { x: 15, y: 25 },
      },
      {
        x: 100,
        y: 120,
        handleIn: { x: 80, y: 110 },
      },
      {
        x: 200,
        y: 200,
      },
    ];

    const original: Path = {
      id: 'path-original',
      type: 'path',
      name: 'Trazado 1',
      x: 10,
      y: 20,
      points: originalPoints,
      closed: true,
      stroke: '#0000ff',
      strokeWidth: 3,
    };

    const cloned = cloneShape(original, { dx: 10, dy: 10 });

    assert.notEqual(cloned, original);
    assert.notEqual(cloned.id, original.id);
    assert.ok(cloned.id.startsWith('path-'));
    assert.equal(cloned.name, 'Trazado 1 copia');
    assert.equal(cloned.x, 20);
    assert.equal(cloned.y, 30);
    assert.equal(cloned.closed, true);

    // Verificación estricta de referencias no compartidas
    assert.notEqual(cloned.points, original.points);
    assert.equal(cloned.points.length, 3);

    for (let i = 0; i < cloned.points.length; i++) {
      const origPt = original.points[i];
      const clonePt = cloned.points[i];

      assert.notEqual(clonePt, origPt, `Punto en índice ${i} no debe compartir referencia`);
      assert.equal(clonePt.x, origPt.x + 10);
      assert.equal(clonePt.y, origPt.y + 10);

      if (origPt.handleIn) {
        assert.ok(clonePt.handleIn);
        assert.notEqual(clonePt.handleIn, origPt.handleIn, `handleIn en índice ${i} no debe compartir referencia`);
        assert.equal(clonePt.handleIn.x, origPt.handleIn.x + 10);
        assert.equal(clonePt.handleIn.y, origPt.handleIn.y + 10);
      } else {
        assert.equal(clonePt.handleIn, undefined);
      }

      if (origPt.handleOut) {
        assert.ok(clonePt.handleOut);
        assert.notEqual(clonePt.handleOut, origPt.handleOut, `handleOut en índice ${i} no debe compartir referencia`);
        assert.equal(clonePt.handleOut.x, origPt.handleOut.x + 10);
        assert.equal(clonePt.handleOut.y, origPt.handleOut.y + 10);
      } else {
        assert.equal(clonePt.handleOut, undefined);
      }
    }

    assert.ok(Object.isFrozen(cloned));
  });

  it('genera IDs únicos en llamadas consecutivas rápidas', () => {
    const id1 = generateClonedShapeId('rectangle');
    const id2 = generateClonedShapeId('rectangle');
    const id3 = generateClonedShapeId('rectangle');

    assert.notEqual(id1, id2);
    assert.notEqual(id2, id3);
    assert.notEqual(id1, id3);
  });
});

describe('AddShapeCommand con soporte de índice de inserción', () => {
  it('inserta una figura en un índice específico dentro de una capa', () => {
    const stateManager = new StateManager();
    const layerId = stateManager.getState().children[0].id;

    const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'S1', x: 0, y: 0, width: 10, height: 10 };
    const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'S2', x: 10, y: 10, width: 10, height: 10 };
    const s3: Rectangle = { id: 's3', type: 'rectangle', name: 'S3', x: 20, y: 20, width: 10, height: 10 };
    stateManager.addShape(layerId, s1);
    stateManager.addShape(layerId, s2);

    // Insertar s3 en el índice 1 (entre s1 y s2)
    const cmd = new AddShapeCommand(stateManager, layerId, s3, 1);
    cmd.execute();

    const layer = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layer.children.map((s) => s.id), ['s1', 's3', 's2']);

    cmd.undo();
    const layerAfterUndo = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layerAfterUndo.children.map((s) => s.id), ['s1', 's2']);
  });
});

describe('Duplicar (Ctrl+D / duplicate)', () => {
  it('duplica la figura seleccionada con 10 px de desplazamiento, la selecciona y la ubica justo por encima', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'Rect A', x: 100, y: 100, width: 50, height: 50 };
    const s2: Rectangle = { id: 's2', type: 'rectangle', name: 'Rect B', x: 200, y: 200, width: 50, height: 50 };
    stateManager.addShape(layerId, s1);
    stateManager.addShape(layerId, s2);

    // Seleccionar s1 (índice 0)
    stateManager.selectNode('s1');

    const duplicated = controller.duplicate();
    assert.ok(duplicated !== null);
    assert.equal(duplicated.name, 'Rect A copia');
    assert.equal(duplicated.x, 110);
    assert.equal(duplicated.y, 110);

    // La nueva figura debe quedar seleccionada
    assert.equal(stateManager.getSelectedNode()?.id, duplicated.id);

    // Debe insertarse justo por encima de s1 (índice 1), antes de s2
    const layer = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layer.children.map((s) => s.id), ['s1', duplicated.id, 's2']);

    // No debe haber tocado el portapapeles
    assert.equal(controller.clipboard, null);

    // Debe ser una sola entrada en el historial
    assert.equal(commandManager.undoCount, 1);

    // Deshacer elimina la figura duplicada y deselecciona
    commandManager.undo();
    const layerAfterUndo = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layerAfterUndo.children.map((s) => s.id), ['s1', 's2']);
    assert.equal(stateManager.findNode(duplicated.id), null);
    assert.equal(stateManager.getSelectedNode(), null);

    // Rehacer la vuelve a insertar
    commandManager.redo();
    const layerAfterRedo = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layerAfterRedo.children.map((s) => s.id), ['s1', duplicated.id, 's2']);

    controller.destroy();
  });

  it('no hace nada si no hay selección', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    const result = controller.duplicate();
    assert.equal(result, null);
    assert.equal(commandManager.undoCount, 0);

    controller.destroy();
  });
});

describe('Copiar y Pegar (Ctrl+C / Ctrl+V)', () => {
  it('guarda copia con Ctrl+C y pega con desplazamiento acumulativo (10, 20, 30...) al frente', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const original: Rectangle = { id: 'orig', type: 'rectangle', name: 'Original', x: 50, y: 50, width: 40, height: 40 };
    const other: Rectangle = { id: 'other', type: 'rectangle', name: 'Other', x: 200, y: 200, width: 40, height: 40 };
    stateManager.addShape(layerId, original);
    stateManager.addShape(layerId, other);

    // 1. Seleccionar 'orig' y copiar
    stateManager.selectNode('orig');
    const copied = controller.copy();
    assert.equal(copied, true);
    assert.ok(controller.clipboard !== null);
    assert.equal(controller.clipboard.id, 'orig');
    assert.equal(controller.pasteCount, 0);

    // 2. Primer pegado: desplazamiento 10 px
    const paste1 = controller.paste();
    assert.ok(paste1 !== null);
    assert.equal(paste1.x, 60);
    assert.equal(paste1.y, 60);
    assert.equal(paste1.name, 'Original copia');
    assert.equal(controller.pasteCount, 1);
    assert.equal(stateManager.getSelectedNode()?.id, paste1.id);

    // Debe insertarse al frente (final de la capa)
    let layer = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layer.children.map((s) => s.id), ['orig', 'other', paste1.id]);
    assert.equal(commandManager.undoCount, 1);

    // 3. Segundo pegado consecutivo: desplazamiento acumulativo 20 px
    const paste2 = controller.paste();
    assert.ok(paste2 !== null);
    assert.equal(paste2.x, 70); // 50 + 20
    assert.equal(paste2.y, 70);
    assert.equal(controller.pasteCount, 2);
    assert.equal(stateManager.getSelectedNode()?.id, paste2.id);

    layer = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layer.children.map((s) => s.id), ['orig', 'other', paste1.id, paste2.id]);
    assert.equal(commandManager.undoCount, 2);

    // 4. Tercer pegado consecutivo: desplazamiento acumulativo 30 px
    const paste3 = controller.paste();
    assert.ok(paste3 !== null);
    assert.equal(paste3.x, 80); // 50 + 30
    assert.equal(paste3.y, 80);
    assert.equal(controller.pasteCount, 3);
    assert.equal(stateManager.getSelectedNode()?.id, paste3.id);

    // 5. Deshacer elimina paste3
    commandManager.undo();
    layer = stateManager.findNode(layerId) as Layer;
    assert.deepEqual(layer.children.map((s) => s.id), ['orig', 'other', paste1.id, paste2.id]);

    // 6. Nuevo Ctrl+C reinicia el contador de pegados acumulados
    stateManager.selectNode(paste2.id);
    controller.copy();
    assert.equal(controller.pasteCount, 0);

    const pasteFromNew = controller.paste();
    assert.ok(pasteFromNew !== null);
    assert.equal(pasteFromNew.x, paste2.x + 10);
    assert.equal(pasteFromNew.y, paste2.y + 10);
    assert.equal(controller.pasteCount, 1);

    controller.destroy();
  });

  it('no hace nada si el portapapeles está vacío', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    assert.equal(controller.clipboard, null);
    const result = controller.paste();
    assert.equal(result, null);
    assert.equal(commandManager.undoCount, 0);

    controller.destroy();
  });

  it('copy retorna false y no cambia el portapapeles si no hay selección', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    assert.equal(controller.copy(), false);
    assert.equal(controller.clipboard, null);

    controller.destroy();
  });
});

describe('Atajos de teclado (Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+D)', () => {
  it('ejecuta duplicate con Ctrl+D y llama preventDefault', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'Rect', x: 10, y: 10, width: 20, height: 20 };
    stateManager.addShape(layerId, s1);
    stateManager.selectNode('s1');

    let prevented = false;
    controller.handleKeyDown({
      ctrlKey: true,
      key: 'd',
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent);

    assert.equal(prevented, true, 'Ctrl+D debe invocar preventDefault');
    assert.equal(commandManager.undoCount, 1);
    const selected = stateManager.getSelectedNode();
    assert.notEqual(selected?.id, 's1');
    assert.equal(selected?.name, 'Rect copia');

    controller.destroy();
  });

  it('soporta Cmd en macOS (metaKey)', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'Rect', x: 10, y: 10, width: 20, height: 20 };
    stateManager.addShape(layerId, s1);
    stateManager.selectNode('s1');

    // Cmd+C
    controller.handleKeyDown({ metaKey: true, key: 'c', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.clipboard?.id, 's1');

    // Cmd+V
    controller.handleKeyDown({ metaKey: true, key: 'v', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(commandManager.undoCount, 1);

    // Cmd+D
    let preventedD = false;
    controller.handleKeyDown({
      metaKey: true,
      key: 'd',
      preventDefault: () => {
        preventedD = true;
      },
    } as unknown as KeyboardEvent);
    assert.equal(preventedD, true);
    assert.equal(commandManager.undoCount, 2);

    controller.destroy();
  });

  it('ignora atajos cuando el foco está en un input, textarea o selector de color', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const s1: Rectangle = { id: 's1', type: 'rectangle', name: 'Rect', x: 10, y: 10, width: 20, height: 20 };
    stateManager.addShape(layerId, s1);
    stateManager.selectNode('s1');

    // Input de texto
    const textInput = new MockElement('input-text', 'INPUT');
    controller.handleKeyDown({
      ctrlKey: true,
      key: 'c',
      target: textInput,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);
    assert.equal(controller.clipboard, null, 'No debe copiar cuando el foco está en un input');

    // Selector de color
    const colorInput = new MockElement('input-fill', 'INPUT');
    controller.handleKeyDown({
      ctrlKey: true,
      key: 'd',
      target: colorInput,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);
    assert.equal(commandManager.undoCount, 0, 'No debe duplicar cuando el foco está en un selector de color');

    // Textarea
    const textarea = new MockElement('textarea-note', 'TEXTAREA');
    controller.handleKeyDown({
      ctrlKey: true,
      key: 'v',
      target: textarea,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);
    assert.equal(commandManager.undoCount, 0, 'No debe pegar cuando el foco está en un textarea');

    controller.destroy();
  });

  it('Ctrl+D llama preventDefault incluso cuando no hay selección, pero no añade nada', () => {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    let prevented = false;
    controller.handleKeyDown({
      ctrlKey: true,
      key: 'd',
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent);

    assert.equal(prevented, true);
    assert.equal(commandManager.undoCount, 0);

    controller.destroy();
  });
});

describe('Botón Duplicar en Panel de Propiedades (setupUIBindings)', () => {
  it('vincula #btn-duplicate para duplicar la figura seleccionada y cleanup remueve el listener', () => {
    const btnDuplicate = new MockElement('btn-duplicate');

    const domMap: Record<string, MockElement> = {
      '#btn-duplicate': btnDuplicate,
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
      activeElement: null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 30, width: 50, height: 40 };
    stateManager.addShape(layerId, r1);
    stateManager.selectNode('r1');

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Clic en Duplicar
    btnDuplicate.click();
    assert.equal(commandManager.undoCount, 1);
    const selected = stateManager.getSelectedNode();
    assert.notEqual(selected?.id, 'r1');
    assert.equal(selected?.name, 'R1 copia');
    assert.equal(selected?.x, 30);
    assert.equal(selected?.y, 40);

    // Ejecutar cleanup()
    cleanup();

    // Clic tras cleanup no debe duplicar de nuevo
    btnDuplicate.click();
    assert.equal(commandManager.undoCount, 1);

    inputController.destroy();
    delete (globalThis as any).document;
  });
});
