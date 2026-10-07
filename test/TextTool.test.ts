import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController, KEYBOARD_SHORTCUTS } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { isText, type Text } from '../src/types/scene-graph.ts';

// Helper para mock de Canvas con eventos en Node.js
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

// Mock de elemento DOM para verificar setupUIBindings
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public style: Record<string, string> = {};
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'button') {
    this.id = id;
    this.tagName = tagName;
  }

  public get classList() {
    return {
      add: (cls: string) => this.classes.add(cls),
      remove: (cls: string) => this.classes.delete(cls),
      contains: (cls: string) => this.classes.has(cls),
      toggle: (cls: string, force?: boolean) => {
        if (force !== undefined) {
          if (force) this.classes.add(cls);
          else this.classes.delete(cls);
          return force;
        }
        if (this.classes.has(cls)) {
          this.classes.delete(cls);
          return false;
        }
        this.classes.add(cls);
        return true;
      },
    };
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public click(): void {
    const list = this.listeners.get('click');
    if (list) {
      for (const fn of list) {
        fn({ target: this });
      }
    }
  }
}

describe('Herramienta Texto (Text Tool)', () => {
  it('1. cambio a herramienta text actualiza ToolMode, emite evento y establece cursor: text', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    let emittedTool: string | null = null;
    controller.on('toolChange', (tool) => {
      emittedTool = tool;
    });

    controller.setTool('text');

    assert.equal(controller.currentTool, 'text');
    assert.equal(emittedTool, 'text', 'Debe emitir el evento toolChange con "text"');
    assert.equal(canvas.style.cursor, 'text', 'El cursor del canvas debe ser "text"');
  });

  it('2. atajo de teclado T (minúscula y mayúscula) conmuta a herramienta text', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    assert.equal(controller.currentTool, 'select');

    // Pulsar tecla 't'
    controller.handleKeyDown({ key: 't', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.currentTool, 'text', 'Tecla t minúscula debe activar herramienta text');

    // Cambiar a select y probar con 'T' mayúscula
    controller.setTool('select');
    controller.handleKeyDown({ key: 'T', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.currentTool, 'text', 'Tecla T mayúscula debe activar herramienta text');

    // Verificar que esté documentado en KEYBOARD_SHORTCUTS
    const textShortcut = KEYBOARD_SHORTCUTS.find((s) => s.key === 'T');
    assert.ok(textShortcut !== undefined, 'KEYBOARD_SHORTCUTS debe incluir la tecla T');
    assert.equal(textShortcut?.description, 'Herramienta Texto');
  });

  it('3. al hacer clic sobre el canvas, crea un nodo Text con contenido inicial "Texto" y tipografía por defecto', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('text');

    // Clic en pantalla en (150, 220)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 220, button: 0 });

    const layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1, 'Debe insertar exactamente un nodo en la capa');

    const createdNode = layer.children[0];
    assert.equal(isText(createdNode), true, 'El nodo creado debe ser de tipo Text');

    const textNode = createdNode as Text;
    assert.equal(textNode.text, 'Texto', 'El contenido inicial debe ser "Texto"');
    assert.equal(textNode.x, 150, 'Coordenada x debe corresponder a la posición del clic');
    assert.equal(textNode.y, 220, 'Coordenada y debe corresponder a la posición del clic');
    assert.equal(textNode.fontFamily, 'Inter', 'fontFamily por defecto debe ser Inter');
    assert.equal(textNode.fontSize, 16, 'fontSize por defecto debe ser 16');
    assert.equal(textNode.fontWeight, 'normal', 'fontWeight por defecto debe ser normal');
    assert.equal(textNode.fontStyle, 'normal', 'fontStyle por defecto debe ser normal');
    assert.equal(textNode.textAlign, 'left', 'textAlign por defecto debe ser left');
    assert.equal(textNode.rotation, 0, 'rotation inicial debe ser 0');
    assert.equal(textNode.opacity, 1, 'opacity inicial debe ser 1');

    // El nuevo texto debe quedar seleccionado
    assert.equal(stateManager.isSelected(textNode.id), true, 'El nuevo texto debe seleccionarse automáticamente');
    assert.equal(stateManager.getSelectedNodes().length, 1);
  });

  it('4. convierte coordenadas de pantalla a world coordinates respetando zoom y pan del viewport', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager({ zoom: 2, panX: 50, panY: 100 });
    const controller = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('text');

    // screen = (250, 300) -> world = screenToWorld = (screen - pan) / zoom
    // x = (250 - 50) / 2 = 100
    // y = (300 - 100) / 2 = 100
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 250, clientY: 300, button: 0 });

    const layer = stateManager.findNode(layerId) as any;
    const textNode = layer.children[0] as Text;

    assert.equal(textNode.x, 100, 'x en coordenadas del mundo debe ser 100');
    assert.equal(textNode.y, 100, 'y en coordenadas del mundo debe ser 100');
  });

  it('5. creación de Text es reversible con Undo y Redo', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);

    const layerId = stateManager.getState().children[0].id;
    controller.setTool('text');

    // Clic para crear texto
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 200, clientY: 150, button: 0 });

    const layerAfterCreate = stateManager.findNode(layerId) as any;
    assert.equal(layerAfterCreate.children.length, 1);
    const textId = layerAfterCreate.children[0].id;
    assert.equal(stateManager.isSelected(textId), true);

    // Deshacer (Undo)
    assert.equal(commandManager.canUndo(), true);
    commandManager.undo();

    const layerAfterUndo = stateManager.findNode(layerId) as any;
    assert.equal(layerAfterUndo.children.length, 0, 'Undo debe remover el nodo Text de la capa');
    assert.equal(stateManager.isSelected(textId), false, 'Undo debe deseleccionar el nodo');

    // Rehacer (Redo)
    assert.equal(commandManager.canRedo(), true);
    commandManager.redo();

    const layerAfterRedo = stateManager.findNode(layerId) as any;
    assert.equal(layerAfterRedo.children.length, 1, 'Redo debe reinsertar el nodo Text en la capa');
    assert.equal(layerAfterRedo.children[0].id, textId);
  });

  it('6. setupUIBindings sincroniza el botón #tool-text y la etiqueta "Modo: Texto"', () => {
    const btnSelect = new MockElement('tool-select');
    const btnText = new MockElement('tool-text');
    const statusLabel = new MockElement('status-tool-label');

    const domMap: Record<string, MockElement> = {
      '#tool-select': btnSelect,
      '#tool-text': btnText,
      '#status-tool-label': statusLabel,
    };

    const originalQuerySelector = (globalThis as any).document?.querySelector;
    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    try {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const controller = new InputController(canvas, stateManager, commandManager);

      const bindings = setupUIBindings(controller, commandManager, stateManager);

      // Estado inicial es 'select'
      assert.equal(btnSelect.classList.contains('active'), true);
      assert.equal(btnText.classList.contains('active'), false);
      assert.equal(btnText.getAttribute('aria-pressed'), 'false');

      // Activar herramienta text
      controller.setTool('text');

      assert.equal(btnSelect.classList.contains('active'), false);
      assert.equal(btnText.classList.contains('active'), true, 'Botón #tool-text debe tener clase active');
      assert.equal(btnText.getAttribute('aria-pressed'), 'true');
      assert.equal(statusLabel.textContent, 'Modo: Texto', 'La etiqueta de estado debe ser "Modo: Texto"');

      // Clic en botón HTML #tool-text
      controller.setTool('select');
      assert.equal(btnText.classList.contains('active'), false);

      btnText.click();
      assert.equal(controller.currentTool, 'text', 'Clic en #tool-text debe conmutar el controlador a "text"');
      assert.equal(btnText.classList.contains('active'), true);

      bindings.cleanup();
    } finally {
      if (originalQuerySelector) {
        (globalThis as any).document.querySelector = originalQuerySelector;
      } else {
        delete (globalThis as any).document;
      }
    }
  });
});
