import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

// Mock simple de DOM para testear setupUIBindings
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public placeholder: string = '';
  public style: Record<string, string> = {};
  public clickCount: number = 0;
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string, tagName: string = 'button') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
  }

  public get className(): string {
    return Array.from(this.classes).join(' ');
  }

  public set className(val: string) {
    this.classes.clear();
    if (val) {
      for (const cls of val.split(/\s+/)) {
        if (cls) this.classes.add(cls);
      }
    }
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

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
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

  public blur(): void {
    this.dispatchEvent({ type: 'blur', target: this });
  }

  public click(): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) {
      e.stopPropagation = () => {};
    }
    if (!e.preventDefault) {
      e.preventDefault = () => {};
    }
    if (!e.target) {
      e.target = this;
    }
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }
}

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    style: { cursor: 'default' },
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    getContext: () => null,
    addEventListener: (event: string, cb: (e: unknown) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    removeEventListener: (event: string, cb: (e: unknown) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((fn) => fn !== cb);
      }
    },
    dispatchEvent: (e: { type: string }) => {
      if (listeners[e.type]) {
        for (const cb of listeners[e.type]) cb(e);
      }
      return true;
    },
  } as unknown as HTMLCanvasElement;
}

function setupMockEnvironment() {
  const elements: Record<string, MockElement> = {
    '#input-fill': new MockElement('input-fill', 'input'),
    '#input-fill-hex': new MockElement('input-fill-hex', 'input'),
    '#btn-fill-none': new MockElement('btn-fill-none', 'button'),
    '#swatch-fill-preview': new MockElement('swatch-fill-preview', 'div'),

    '#input-stroke': new MockElement('input-stroke', 'input'),
    '#input-stroke-hex': new MockElement('input-stroke-hex', 'input'),
    '#btn-stroke-none': new MockElement('btn-stroke-none', 'button'),
    '#swatch-stroke-preview': new MockElement('swatch-stroke-preview', 'div'),

    '#input-stroke-width': new MockElement('input-stroke-width', 'input'),
    '#section-appearance': new MockElement('section-appearance', 'details'),
    '#no-selection-state': new MockElement('no-selection-state', 'div'),
    '#selection-state': new MockElement('selection-state', 'div'),
    '#panel-title': new MockElement('panel-title', 'span'),
  };

  const docListeners: Record<string, ((e: any) => void)[]> = {};

  const mockDoc: any = {
    activeElement: null,
    querySelector: (selector: string) => elements[selector] ?? null,
    querySelectorAll: () => [],
    addEventListener: (event: string, cb: (e: any) => void) => {
      docListeners[event] = docListeners[event] || [];
      docListeners[event].push(cb);
    },
    removeEventListener: (event: string, cb: (e: any) => void) => {
      if (docListeners[event]) {
        docListeners[event] = docListeners[event].filter((fn) => fn !== cb);
      }
    },
    dispatchEvent: (e: any) => {
      if (!e.stopPropagation) e.stopPropagation = () => {};
      if (!e.preventDefault) e.preventDefault = () => {};
      if (docListeners[e.type]) {
        for (const cb of docListeners[e.type]) cb(e);
      }
    },
  };

  (globalThis as any).document = mockDoc;

  const stateManager = new StateManager();
  const commandManager = new CommandManager();
  const canvas = createMockCanvas();
  const inputController = new InputController(canvas, stateManager, commandManager);
  const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

  return {
    elements,
    stateManager,
    commandManager,
    inputController,
    cleanup: () => {
      cleanup();
      inputController.destroy();
      delete (globalThis as any).document;
    },
  };
}

describe('Control de color en Panel de Apariencia', () => {
  it('Hex válido (3 y 6 dígitos, con y sin "#", mayúsculas) aplica y normaliza; hex inválido no cambia nada', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const rect: Rectangle = {
      id: 'rect-hex-test',
      type: 'rectangle',
      name: 'Rect Hex',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      fill: '#000000',
      stroke: 'none',
      strokeWidth: 1,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('rect-hex-test');

    const inputFillHex = elements['#input-fill-hex'];
    const swatchPreview = elements['#swatch-fill-preview'];

    // 1. Hex válido de 3 dígitos con '#'
    inputFillHex.value = '#f00';
    inputFillHex.dispatchEvent({ type: 'keydown', key: 'Enter' });
    let shape = stateManager.findNode('rect-hex-test') as Rectangle;
    assert.equal(shape.fill, '#ff0000');
    assert.equal(inputFillHex.value, '#ff0000');
    assert.equal(swatchPreview.style.backgroundColor, '#ff0000');

    // 2. Hex válido de 6 dígitos sin '#'
    inputFillHex.value = '00ff00';
    inputFillHex.blur();
    shape = stateManager.findNode('rect-hex-test') as Rectangle;
    assert.equal(shape.fill, '#00ff00');
    assert.equal(inputFillHex.value, '#00ff00');
    assert.equal(swatchPreview.style.backgroundColor, '#00ff00');

    // 3. Hex en mayúsculas
    inputFillHex.value = '#AABBCC';
    inputFillHex.dispatchEvent({ type: 'keydown', key: 'Enter' });
    shape = stateManager.findNode('rect-hex-test') as Rectangle;
    assert.equal(shape.fill, '#aabbcc');
    assert.equal(inputFillHex.value, '#aabbcc');

    // 4. Hex inválido: restaura el anterior y marca aria-invalid sin cambiar el estado
    const commandsBefore = commandManager.undoCount;
    inputFillHex.value = 'invalido-xyz';
    inputFillHex.blur();
    shape = stateManager.findNode('rect-hex-test') as Rectangle;
    assert.equal(shape.fill, '#aabbcc', 'Hex inválido no debe alterar la figura');
    assert.equal(inputFillHex.value, '#aabbcc', 'Hex inválido debe restaurar el valor anterior');
    assert.equal(inputFillHex.getAttribute('aria-invalid'), 'true', 'Debe marcar aria-invalid');
    assert.equal(commandManager.undoCount, commandsBefore, 'No debe registrarse comando en el historial');

    cleanup();
  });

  it('Botón sin color: aplica "none" y al pulsarlo otra vez vuelve al color anterior', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const rect: Rectangle = {
      id: 'rect-none-btn',
      type: 'rectangle',
      name: 'Rect None Btn',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: '#112233',
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('rect-none-btn');

    const btnFillNone = elements['#btn-fill-none'];
    const swatchPreview = elements['#swatch-fill-preview'];
    const inputFillHex = elements['#input-fill-hex'];

    // Clic 1: aplica 'none' y recuerda #112233
    btnFillNone.click();
    let shape = stateManager.findNode('rect-none-btn') as Rectangle;
    assert.equal(shape.fill, 'none');
    assert.equal(btnFillNone.getAttribute('aria-pressed'), 'true');
    assert.equal(swatchPreview.className, 'color-swatch-preview state-none');
    assert.equal(inputFillHex.value, '');
    assert.equal(inputFillHex.placeholder, 'ninguno');

    // Clic 2: restaura el color anterior #112233
    btnFillNone.click();
    shape = stateManager.findNode('rect-none-btn') as Rectangle;
    assert.equal(shape.fill, '#112233');
    assert.equal(btnFillNone.getAttribute('aria-pressed'), 'false');
    assert.equal(swatchPreview.style.backgroundColor, '#112233');
    assert.equal(inputFillHex.value, '#112233');

    // Deshacer una vez: vuelve a 'none'
    commandManager.undo();
    shape = stateManager.findNode('rect-none-btn') as Rectangle;
    assert.equal(shape.fill, 'none');

    // Deshacer segunda vez: vuelve a #112233 original
    commandManager.undo();
    shape = stateManager.findNode('rect-none-btn') as Rectangle;
    assert.equal(shape.fill, '#112233');

    cleanup();
  });

  it('Borde de ninguno a color con grosor 0 pone grosor 1', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const rect: Rectangle = {
      id: 'rect-stroke-zero',
      type: 'rectangle',
      name: 'Rect Stroke Zero',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      stroke: 'none',
      strokeWidth: 0,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('rect-stroke-zero');

    const inputStrokeHex = elements['#input-stroke-hex'];
    inputStrokeHex.value = '#0284c7';
    inputStrokeHex.dispatchEvent({ type: 'keydown', key: 'Enter' });

    let shape = stateManager.findNode('rect-stroke-zero') as Rectangle;
    assert.equal(shape.stroke, '#0284c7');
    assert.equal(shape.strokeWidth, 1, 'Al pasar de none a color con grosor 0, debe fijar strokeWidth a 1');

    // Un solo Ctrl+Z revierte tanto el borde a 'none' como el strokeWidth a 0
    commandManager.undo();
    shape = stateManager.findNode('rect-stroke-zero') as Rectangle;
    assert.equal(shape.stroke, 'none');
    assert.equal(shape.strokeWidth, 0);

    // Rehacer restablece ambos
    commandManager.redo();
    shape = stateManager.findNode('rect-stroke-zero') as Rectangle;
    assert.equal(shape.stroke, '#0284c7');
    assert.equal(shape.strokeWidth, 1);

    cleanup();
  });

  it('Selección con valores distintos muestra "Mixto" y una acción se aplica a todas con UNA entrada de historial (un solo Ctrl+Z)', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const rect1: Rectangle = {
      id: 'rect-mix-1',
      type: 'rectangle',
      name: 'Rect Mix 1',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: '#ff0000',
    };
    const rect2: Rectangle = {
      id: 'rect-mix-2',
      type: 'rectangle',
      name: 'Rect Mix 2',
      x: 60,
      y: 0,
      width: 50,
      height: 50,
      fill: '#00ff00',
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect1);
    stateManager.addShape(stateManager.getState().children[0].id, rect2);

    // Seleccionar ambas figuras
    stateManager.setSelection(['rect-mix-1', 'rect-mix-2']);

    const inputFillHex = elements['#input-fill-hex'];
    const swatchPreview = elements['#swatch-fill-preview'];

    assert.equal(inputFillHex.value, '');
    assert.equal(inputFillHex.placeholder, 'Mixto');
    assert.equal(swatchPreview.className, 'color-swatch-preview state-mixed');

    // Aplicar un color común a ambas
    const undoCountBefore = commandManager.undoCount;
    inputFillHex.value = '#0000ff';
    inputFillHex.dispatchEvent({ type: 'keydown', key: 'Enter' });

    const s1 = stateManager.findNode('rect-mix-1') as Rectangle;
    const s2 = stateManager.findNode('rect-mix-2') as Rectangle;
    assert.equal(s1.fill, '#0000ff');
    assert.equal(s2.fill, '#0000ff');

    assert.equal(commandManager.undoCount, undoCountBefore + 1, 'Debe haber exactamente UNA sola entrada en el historial');

    // Un único Ctrl+Z restaura los colores originales distintos
    commandManager.undo();
    const s1Restored = stateManager.findNode('rect-mix-1') as Rectangle;
    const s2Restored = stateManager.findNode('rect-mix-2') as Rectangle;
    assert.equal(s1Restored.fill, '#ff0000');
    assert.equal(s2Restored.fill, '#00ff00');

    cleanup();
  });

  it('Estando enfocado el campo hex, Backspace, Delete y las letras de herramientas no actúan sobre las figuras', () => {
    const { elements, stateManager, inputController, cleanup } = setupMockEnvironment();

    const rect: Rectangle = {
      id: 'rect-focus-test',
      type: 'rectangle',
      name: 'Rect Focus Test',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: '#ff0000',
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('rect-focus-test');

    const inputFillHex = elements['#input-fill-hex'];

    // Simular foco en el campo hex
    (globalThis as any).document.activeElement = inputFillHex;

    // Disparar teclas de atajos que normalmente borrarían figuras o cambiarían de herramienta
    const keyEventBackspace = { type: 'keydown', key: 'Backspace', target: inputFillHex, preventDefault: () => {} };
    const keyEventDelete = { type: 'keydown', key: 'Delete', target: inputFillHex, preventDefault: () => {} };
    const keyEventPen = { type: 'keydown', key: 'p', target: inputFillHex, preventDefault: () => {} };

    inputController.handleKeyDown(keyEventBackspace as any);
    inputController.handleKeyDown(keyEventDelete as any);
    inputController.handleKeyDown(keyEventPen as any);

    // La figura sigue existiendo (no fue eliminada)
    assert.ok(stateManager.findNode('rect-focus-test') !== null, 'La figura no debe ser eliminada mientras un input está enfocado');
    // La herramienta activa no cambió a 'pen'
    assert.equal(inputController.currentTool, 'select', 'La herramienta no debe cambiar mientras un input está enfocado');

    cleanup();
  });

  it('Los tests existentes (los que usan #input-fill) pasan sin modificarlos', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const rect: Rectangle = {
      id: 'rect-compat-test',
      type: 'rectangle',
      name: 'Rect Compat',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: '#123456',
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('rect-compat-test');

    const inputFill = elements['#input-fill'];
    assert.equal(inputFill.value, '#123456');

    // Cambiar valor en #input-fill directamente y despachar 'change' como hacen los tests existentes
    inputFill.value = '#654321';
    inputFill.dispatchEvent({ type: 'change' });

    const updated = stateManager.findNode('rect-compat-test') as Rectangle;
    assert.equal(updated.fill, '#654321');

    commandManager.undo();
    const reverted = stateManager.findNode('rect-compat-test') as Rectangle;
    assert.equal(reverted.fill, '#123456');

    cleanup();
  });

  it('sin selección, cambiar el color de relleno actualiza getDrawingStyle().fill y no agrega entradas al historial; con selección, el cambio sí queda en el historial y actualiza también el estilo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    // 1. Sin selección
    stateManager.setSelection([]);
    const inputFill = elements['#input-fill'];

    inputFill.value = '#e11d48';
    inputFill.dispatchEvent({ type: 'change' });

    assert.equal(stateManager.getDrawingStyle().fill, '#e11d48');
    assert.equal(commandManager.undoCount, 0);

    // 2. Con selección
    const rect: Rectangle = {
      id: 'rect-style-test',
      type: 'rectangle',
      name: 'Rect Style Test',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: '#123456',
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('rect-style-test');

    inputFill.value = '#10b981';
    inputFill.dispatchEvent({ type: 'change' });

    const updated = stateManager.findNode('rect-style-test') as Rectangle;
    assert.equal(updated.fill, '#10b981');
    assert.equal(stateManager.getDrawingStyle().fill, '#10b981');
    assert.equal(commandManager.undoCount, 1);

    cleanup();
  });
});

