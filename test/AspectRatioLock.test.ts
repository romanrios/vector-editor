import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TransformSectionController } from '../src/ui/properties/TransformSectionController.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Rectangle, Document } from '../src/types/scene-graph.ts';
import { createNullPropertiesPanelElements } from '../src/ui/properties/domElements.ts';
import type { PropertiesPanelElements } from '../src/ui/properties/types.ts';

class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public checked: boolean = false;
  public placeholder: string = '';
  public style: Record<string, string> = {};
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName;
  }

  public focus(): void {
    this.dispatchEvent({ type: 'focus', target: this });
  }

  public blur(): void {
    this.dispatchEvent({ type: 'blur', target: this });
  }

  public addEventListener(event: string, listener: (e: any) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  public removeEventListener(event: string, listener: (e: any) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.target) e.target = this;
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }
}

function createTestDoc(): Document {
  return {
    id: 'doc-1',
    name: 'Test Doc',
    type: 'document',
    width: 1000,
    height: 800,
    activeArtboardId: 'artboard-1',
    artboards: [
      {
        id: 'artboard-1',
        name: 'Artboard 1',
        x: 0,
        y: 0,
        width: 1000,
        height: 800,
      },
    ],
    children: [
      {
        id: 'layer-1',
        name: 'Capa 1',
        type: 'layer',
        visible: true,
        locked: false,
        children: [],
      },
    ],
  };
}

function createRect(id: string, x: number, y: number, width: number, height: number): Rectangle {
  return {
    id,
    type: 'rectangle',
    name: id,
    x,
    y,
    width,
    height,
    fill: '#ff0000',
    stroke: 'none',
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

describe('Bloqueo de relación de aspecto en propiedades de transformación', () => {
  let stateManager: StateManager;
  let commandManager: CommandManager;
  let elements: Record<string, MockElement>;
  let panelElements: PropertiesPanelElements;
  let controller: TransformSectionController;

  beforeEach(() => {
    stateManager = new StateManager(createTestDoc());
    commandManager = new CommandManager();

    elements = {
      '#section-transform': new MockElement('section-transform', 'details'),
      '#input-object-x': new MockElement('input-object-x', 'input'),
      '#input-object-y': new MockElement('input-object-y', 'input'),
      '#input-object-width': new MockElement('input-object-width', 'input'),
      '#input-object-height': new MockElement('input-object-height', 'input'),
      '#check-object-ratio': new MockElement('check-object-ratio', 'input'),
      '#input-object-rotation': new MockElement('input-object-rotation', 'input'),
      '#group-corner-radius': new MockElement('group-corner-radius', 'div'),
      '#input-corner-radius': new MockElement('input-corner-radius', 'input'),
    };

    panelElements = {
      ...createNullPropertiesPanelElements(),
      sectionTransform: elements['#section-transform'] as any,
      inputObjectX: elements['#input-object-x'] as any,
      inputObjectY: elements['#input-object-y'] as any,
      inputObjectWidth: elements['#input-object-width'] as any,
      inputObjectHeight: elements['#input-object-height'] as any,
      checkObjectRatio: elements['#check-object-ratio'] as any,
      inputObjectRotation: elements['#input-object-rotation'] as any,
      groupCornerRadius: elements['#group-corner-radius'] as any,
      inputCornerRadius: elements['#input-corner-radius'] as any,
    };

    const sync = () => {
      const sel = stateManager.getSelectedNodes();
      const leafShapes = sel.filter((n): n is Rectangle => n.type === 'rectangle');
      const bounds = sel.length > 0
        ? {
            minX: Math.min(...leafShapes.map((s) => s.x)),
            minY: Math.min(...leafShapes.map((s) => s.y)),
            maxX: Math.max(...leafShapes.map((s) => s.x + s.width)),
            maxY: Math.max(...leafShapes.map((s) => s.y + s.height)),
            width: Math.max(...leafShapes.map((s) => s.x + s.width)) - Math.min(...leafShapes.map((s) => s.x)),
            height: Math.max(...leafShapes.map((s) => s.y + s.height)) - Math.min(...leafShapes.map((s) => s.y)),
          }
        : null;
      controller.sync(sel, leafShapes, bounds, leafShapes[0]?.rotation ?? null);
    };

    controller = new TransformSectionController(
      stateManager,
      commandManager,
      panelElements,
      sync
    );

    stateManager.subscribe(sync);

    controller.bind();
  });

  it('1. el checkbox de bloqueo de proporción inicia desmarcado y no altera el comportamiento individual', () => {
    const rect = createRect('rect-1', 10, 20, 200, 100);
    stateManager.addShape('layer-1', rect);
    stateManager.setSelection(['rect-1']);

    assert.equal(elements['#check-object-ratio'].checked, false);
    assert.equal(controller.isRatioLocked(), false);

    // Cambiar solo el ancho sin proporción bloqueada
    elements['#input-object-width'].value = '400';
    elements['#input-object-width'].dispatchEvent({ type: 'change', target: elements['#input-object-width'] });

    const updated = stateManager.findNode('rect-1') as Rectangle;
    assert.equal(updated.width, 400);
    assert.equal(updated.height, 100); // El alto no cambia
  });

  it('2. con proporción bloqueada, cambiar ancho escala alto proporcionalmente con Undo/Redo', () => {
    const rect = createRect('rect-1', 10, 20, 200, 100); // 2:1
    stateManager.addShape('layer-1', rect);
    stateManager.setSelection(['rect-1']);

    // Activar bloqueo de proporción
    elements['#check-object-ratio'].checked = true;
    elements['#check-object-ratio'].dispatchEvent({ type: 'change', target: elements['#check-object-ratio'] });
    assert.equal(controller.isRatioLocked(), true);
    assert.equal(controller.getAspectRatio(), 2);

    // Modificar ancho a 300 -> alto debe ser 150
    elements['#input-object-width'].value = '300';
    elements['#input-object-width'].dispatchEvent({ type: 'change', target: elements['#input-object-width'] });

    assert.equal(elements['#input-object-height'].value, '150');
    const updated = stateManager.findNode('rect-1') as Rectangle;
    assert.equal(updated.width, 300);
    assert.equal(updated.height, 150);

    // Deshacer restaura las dimensiones originales
    assert.ok(commandManager.canUndo);
    commandManager.undo();
    const undone = stateManager.findNode('rect-1') as Rectangle;
    assert.equal(undone.width, 200);
    assert.equal(undone.height, 100);

    // Rehacer restablece los valores proporcionales
    assert.ok(commandManager.canRedo);
    commandManager.redo();
    const redone = stateManager.findNode('rect-1') as Rectangle;
    assert.equal(redone.width, 300);
    assert.equal(redone.height, 150);
  });

  it('3. con proporción bloqueada, cambiar alto escala ancho proporcionalmente', () => {
    const rect = createRect('rect-1', 10, 20, 200, 100); // 2:1
    stateManager.addShape('layer-1', rect);
    stateManager.setSelection(['rect-1']);

    elements['#check-object-ratio'].checked = true;
    elements['#check-object-ratio'].dispatchEvent({ type: 'change', target: elements['#check-object-ratio'] });

    // Modificar alto a 200 -> ancho debe ser 400
    elements['#input-object-height'].value = '200';
    elements['#input-object-height'].dispatchEvent({ type: 'change', target: elements['#input-object-height'] });

    assert.equal(elements['#input-object-width'].value, '400');
    const updated = stateManager.findNode('rect-1') as Rectangle;
    assert.equal(updated.width, 400);
    assert.equal(updated.height, 200);
  });

  it('4. el evento input actualiza en tiempo real el valor del campo opuesto', () => {
    const rect = createRect('rect-1', 10, 20, 400, 200); // 2:1
    stateManager.addShape('layer-1', rect);
    stateManager.setSelection(['rect-1']);

    elements['#check-object-ratio'].checked = true;
    elements['#check-object-ratio'].dispatchEvent({ type: 'change', target: elements['#check-object-ratio'] });

    // Escribir 600 en ancho
    elements['#input-object-width'].value = '600';
    elements['#input-object-width'].dispatchEvent({ type: 'input', target: elements['#input-object-width'] });
    assert.equal(elements['#input-object-height'].value, '300');

    // Escribir 50 en alto
    elements['#input-object-height'].value = '50';
    elements['#input-object-height'].dispatchEvent({ type: 'input', target: elements['#input-object-height'] });
    assert.equal(elements['#input-object-width'].value, '100');
  });

  it('5. presionar Enter en el input aplica la transformación geométrica', () => {
    const rect = createRect('rect-1', 10, 20, 200, 100);
    stateManager.addShape('layer-1', rect);
    stateManager.setSelection(['rect-1']);

    elements['#check-object-ratio'].checked = true;
    elements['#check-object-ratio'].dispatchEvent({ type: 'change', target: elements['#check-object-ratio'] });

    elements['#input-object-width'].value = '500';
    elements['#input-object-width'].dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      target: elements['#input-object-width'],
    });

    const updated = stateManager.findNode('rect-1') as Rectangle;
    assert.equal(updated.width, 500);
    assert.equal(updated.height, 250);
  });

  it('6. cambiar a otra figura sincroniza la relación de aspecto de la nueva figura', () => {
    const rect1 = createRect('rect-1', 0, 0, 300, 100); // 3:1
    const rect2 = createRect('rect-2', 0, 0, 100, 100); // 1:1
    stateManager.addShape('layer-1', rect1);
    stateManager.addShape('layer-1', rect2);

    stateManager.setSelection(['rect-1']);
    elements['#check-object-ratio'].checked = true;
    elements['#check-object-ratio'].dispatchEvent({ type: 'change', target: elements['#check-object-ratio'] });
    assert.equal(controller.getAspectRatio(), 3);

    // Seleccionar rect2 (1:1)
    stateManager.setSelection(['rect-2']);
    assert.equal(controller.getAspectRatio(), 1);

    // Cambiar ancho de rect2 a 180 -> alto debe ser 180
    elements['#input-object-width'].value = '180';
    elements['#input-object-width'].dispatchEvent({ type: 'change', target: elements['#input-object-width'] });

    const updated2 = stateManager.findNode('rect-2') as Rectangle;
    assert.equal(updated2.width, 180);
    assert.equal(updated2.height, 180);
  });

  it('7. soporta multiselección manteniendo la relación de aspecto combinada', () => {
    const r1 = createRect('r1', 0, 0, 100, 100);
    const r2 = createRect('r2', 200, 0, 100, 100);
    // Bounds combinados: minX 0, minY 0, maxX 300, maxY 100 => width 300, height 100 (3:1)
    stateManager.addShape('layer-1', r1);
    stateManager.addShape('layer-1', r2);
    stateManager.setSelection(['r1', 'r2']);

    elements['#check-object-ratio'].checked = true;
    elements['#check-object-ratio'].dispatchEvent({ type: 'change', target: elements['#check-object-ratio'] });
    assert.equal(controller.getAspectRatio(), 3);

    // Duplicar el ancho total a 600 -> alto total debe escalar a 200 (scale 2.0x)
    elements['#input-object-width'].value = '600';
    elements['#input-object-width'].dispatchEvent({ type: 'change', target: elements['#input-object-width'] });

    const up1 = stateManager.findNode('r1') as Rectangle;
    const up2 = stateManager.findNode('r2') as Rectangle;
    assert.equal(up1.width, 200);
    assert.equal(up1.height, 200);
    assert.equal(up2.width, 200);
    assert.equal(up2.height, 200);
    assert.equal(up2.x, 400);

    // Deshacer restaura la multiselección completa
    commandManager.undo();
    const und1 = stateManager.findNode('r1') as Rectangle;
    const und2 = stateManager.findNode('r2') as Rectangle;
    assert.equal(und1.width, 100);
    assert.equal(und1.height, 100);
    assert.equal(und2.width, 100);
    assert.equal(und2.height, 100);
  });

  it('8. en el lienzo (canvas), con isRatioLocked activo, el redimensionado preserva la proporción sin Shift', () => {
    const canvas = {
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }),
      getContext: () => null,
      style: { cursor: 'default' },
    } as unknown as HTMLCanvasElement;

    let ratioLockedState = false;
    const inputController = new InputController(canvas, stateManager, commandManager, {
      isRatioLocked: () => ratioLockedState,
    });

    const rect = createRect('rect-canvas', 100, 100, 200, 100); // 2:1
    stateManager.addShape('layer-1', rect);
    stateManager.setSelection(['rect-canvas']);

    // Iniciar redimensionado desde el tirador bottom-right
    const mouseEvent = { button: 0, shiftKey: false, altKey: false } as MouseEvent;
    (inputController.selectToolHandler as any).resizeHandler.start(
      { x: 300, y: 200 },
      mouseEvent,
      rect,
      'bottom-right'
    );

    // Sin bloqueo de proporción: mover ratón en dx=60, dy=10
    ratioLockedState = false;
    const resUnlocked = inputController.selectToolHandler.calculateSnappedResizeDimensions(
      360,
      210,
      false, // shiftKey = false
      false
    );
    assert.ok(resUnlocked);
    assert.equal(resUnlocked.width, 260);
    assert.equal(resUnlocked.height, 110); // Asimétrico

    // Con bloqueo de proporción activo: mover ratón en dx=60, dy=10
    ratioLockedState = true;
    const resLocked = inputController.selectToolHandler.calculateSnappedResizeDimensions(
      360,
      210,
      false, // shiftKey = false
      false
    );
    assert.ok(resLocked);
    assert.equal((resLocked.width ?? 0) / (resLocked.height ?? 1), 2); // Proporción 2:1 preservada
  });
});
