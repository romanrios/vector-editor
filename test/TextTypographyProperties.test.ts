import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Text, Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

// Mock simple de DOM para testear setupUIBindings con controles tipográficos
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

  public focus(): void {
    if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
    this.dispatchEvent({ type: 'focus', target: this });
  }

  public blur(): void {
    if (typeof globalThis !== 'undefined' && (globalThis as any).document && (globalThis as any).document.activeElement === this) {
      (globalThis as any).document.activeElement = null;
    }
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
    // Controles de apariencia
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

    // Controles de tipografía para Text
    '#section-typography': new MockElement('section-typography', 'details'),
    '#input-text-content': new MockElement('input-text-content', 'input'),
    '#select-font-family': new MockElement('select-font-family', 'select'),
    '#input-font-size': new MockElement('input-font-size', 'input'),
    '#select-font-weight': new MockElement('select-font-weight', 'select'),
    '#select-font-style': new MockElement('select-font-style', 'select'),
    '#select-text-align': new MockElement('select-text-align', 'select'),
    '#btn-text-align-left': new MockElement('btn-text-align-left', 'button'),
    '#btn-text-align-center': new MockElement('btn-text-align-center', 'button'),
    '#btn-text-align-right': new MockElement('btn-text-align-right', 'button'),
    '#input-text-color': new MockElement('input-text-color', 'input'),
    '#input-text-color-hex': new MockElement('input-text-color-hex', 'input'),
    '#swatch-text-color-preview': new MockElement('swatch-text-color-preview', 'div'),
    '#btn-text-color-none': new MockElement('btn-text-color-none', 'button'),
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

describe('Propiedades tipográficas para Text en el panel de propiedades', () => {
  it('1. Visibilidad: muestra sección tipografía solo cuando hay un único Text seleccionado', () => {
    const { elements, stateManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-1',
      type: 'text',
      name: 'Texto 1',
      x: 100,
      y: 100,
      text: 'Titular',
      fill: '#112233',
    };
    const rectNode: Rectangle = {
      id: 'rect-1',
      type: 'rectangle',
      name: 'Rect 1',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      fill: '#aabbcc',
      stroke: '#334455',
      strokeWidth: 2,
    };

    stateManager.addShape(layerId, textNode);
    stateManager.addShape(layerId, rectNode);

    // Sin selección: tipografía oculta, apariencia visible
    stateManager.setSelection([]);
    assert.equal(elements['#section-typography'].style.display, 'none');
    assert.equal(elements['#section-appearance'].style.display, 'block');

    // Selección de Rectangle: tipografía oculta, apariencia visible
    stateManager.setSelection(['rect-1']);
    assert.equal(elements['#section-typography'].style.display, 'none');
    assert.equal(elements['#section-appearance'].style.display, 'block');

    // Selección única de Text: tipografía visible, apariencia oculta
    stateManager.setSelection(['text-1']);
    assert.equal(elements['#section-typography'].style.display, 'block');
    assert.equal(elements['#section-appearance'].style.display, 'none');

    // Selección múltiple (Text + Rectangle): tipografía oculta, apariencia visible
    stateManager.setSelection(['text-1', 'rect-1']);
    assert.equal(elements['#section-typography'].style.display, 'none');
    assert.equal(elements['#section-appearance'].style.display, 'block');

    cleanup();
  });

  it('2. Valores iniciales y por defecto: carga valores tipográficos requeridos cuando faltan en el nodo Text', () => {
    const { elements, stateManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    // Nodo Text con propiedades mínimas
    const textNode: Text = {
      id: 'text-default',
      type: 'text',
      name: 'Texto Defecto',
      x: 50,
      y: 50,
      text: 'Texto Inicial',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-default']);

    // Comprobar valores iniciales solicitados:
    // fontFamily: Inter, fontSize: 32, fontWeight: 400, fontStyle: normal, textAlign: left
    assert.equal(elements['#input-text-content'].value, 'Texto Inicial');
    assert.equal(elements['#select-font-family'].value, 'Inter');
    assert.equal(elements['#input-font-size'].value, '32');
    assert.equal(elements['#select-font-weight'].value, '400');
    assert.equal(elements['#select-font-style'].value, 'normal');
    assert.equal(elements['#select-text-align'].value, 'left');
    assert.equal(elements['#btn-text-align-left'].classList.contains('active'), true);
    assert.equal(elements['#btn-text-align-center'].classList.contains('active'), false);
    assert.equal(elements['#btn-text-align-right'].classList.contains('active'), false);

    cleanup();
  });

  it('3. Refleja propiedades existentes de un nodo Text configurado', () => {
    const { elements, stateManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-custom',
      type: 'text',
      name: 'Texto Custom',
      x: 10,
      y: 20,
      text: 'Gráficos Vectoriales',
      fontFamily: 'Georgia',
      fontSize: 48,
      fontWeight: 700,
      fontStyle: 'italic',
      textAlign: 'center',
      fill: '#e11d48',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-custom']);

    assert.equal(elements['#input-text-content'].value, 'Gráficos Vectoriales');
    assert.equal(elements['#select-font-family'].value, 'Georgia');
    assert.equal(elements['#input-font-size'].value, '48');
    assert.equal(elements['#select-font-weight'].value, '700');
    assert.equal(elements['#select-font-style'].value, 'italic');
    assert.equal(elements['#select-text-align'].value, 'center');
    assert.equal(elements['#btn-text-align-center'].classList.contains('active'), true);
    assert.equal(elements['#btn-text-align-left'].classList.contains('active'), false);
    assert.equal(elements['#input-text-color'].value, '#e11d48');
    assert.equal(elements['#input-text-color-hex'].value, '#e11d48');

    cleanup();
  });

  it('4. Modificar contenido actualiza el estado y registra Undo/Redo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-edit-content',
      type: 'text',
      name: 'Texto 1',
      x: 10,
      y: 10,
      text: 'Original',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-edit-content']);

    const input = elements['#input-text-content'];
    input.focus();
    input.value = 'Modificado';
    input.dispatchEvent({ type: 'input' });

    // Actualiza inmediatamente el Scene Graph y marca isDirty
    let current = stateManager.findNode('text-edit-content') as Text;
    assert.equal(current.text, 'Modificado');
    assert.equal(stateManager.isDirty, true);

    // Al confirmar (change) registra comando en CommandManager
    input.dispatchEvent({ type: 'change' });
    assert.equal(commandManager.canUndo(), true);

    // Deshacer (Undo)
    commandManager.undo();
    current = stateManager.findNode('text-edit-content') as Text;
    assert.equal(current.text, 'Original');
    assert.equal(elements['#input-text-content'].value, 'Original');

    // Rehacer (Redo)
    commandManager.redo();
    current = stateManager.findNode('text-edit-content') as Text;
    assert.equal(current.text, 'Modificado');
    assert.equal(elements['#input-text-content'].value, 'Modificado');

    cleanup();
  });

  it('5. Modificar familia tipográfica (fontFamily) actualiza estado y soporta Undo/Redo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-font-family',
      type: 'text',
      name: 'Texto Fuente',
      x: 0,
      y: 0,
      text: 'Texto',
      fontFamily: 'Inter',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-font-family']);

    const select = elements['#select-font-family'];
    select.value = 'Georgia';
    select.dispatchEvent({ type: 'change' });

    let current = stateManager.findNode('text-font-family') as Text;
    assert.equal(current.fontFamily, 'Georgia');
    assert.equal(stateManager.isDirty, true);
    assert.equal(commandManager.canUndo(), true);

    commandManager.undo();
    current = stateManager.findNode('text-font-family') as Text;
    assert.equal(current.fontFamily, 'Inter');
    assert.equal(elements['#select-font-family'].value, 'Inter');

    commandManager.redo();
    current = stateManager.findNode('text-font-family') as Text;
    assert.equal(current.fontFamily, 'Georgia');
    assert.equal(elements['#select-font-family'].value, 'Georgia');

    cleanup();
  });

  it('6. Modificar tamaño (fontSize) actualiza estado y soporta Undo/Redo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-font-size',
      type: 'text',
      name: 'Texto Tamaño',
      x: 0,
      y: 0,
      text: 'Texto',
      fontSize: 32,
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-font-size']);

    const input = elements['#input-font-size'];
    input.focus();
    input.value = '64';
    input.dispatchEvent({ type: 'input' });

    let current = stateManager.findNode('text-font-size') as Text;
    assert.equal(current.fontSize, 64);
    assert.equal(stateManager.isDirty, true);

    input.dispatchEvent({ type: 'change' });
    assert.equal(commandManager.canUndo(), true);

    commandManager.undo();
    current = stateManager.findNode('text-font-size') as Text;
    assert.equal(current.fontSize, 32);
    assert.equal(elements['#input-font-size'].value, '32');

    commandManager.redo();
    current = stateManager.findNode('text-font-size') as Text;
    assert.equal(current.fontSize, 64);
    assert.equal(elements['#input-font-size'].value, '64');

    cleanup();
  });

  it('7. Modificar peso (fontWeight) y estilo (fontStyle) actualiza estado y soporta Undo/Redo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-weight-style',
      type: 'text',
      name: 'Texto Peso Estilo',
      x: 0,
      y: 0,
      text: 'Texto',
      fontWeight: 400,
      fontStyle: 'normal',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-weight-style']);

    // Modificar peso a 700
    const selectWeight = elements['#select-font-weight'];
    selectWeight.value = '700';
    selectWeight.dispatchEvent({ type: 'change' });

    let current = stateManager.findNode('text-weight-style') as Text;
    assert.equal(current.fontWeight, 700);

    // Modificar estilo a italic
    const selectStyle = elements['#select-font-style'];
    selectStyle.value = 'italic';
    selectStyle.dispatchEvent({ type: 'change' });

    current = stateManager.findNode('text-weight-style') as Text;
    assert.equal(current.fontStyle, 'italic');

    // Undo restaura estilo a normal
    commandManager.undo();
    current = stateManager.findNode('text-weight-style') as Text;
    assert.equal(current.fontStyle, 'normal');

    // Undo restaura peso a 400
    commandManager.undo();
    current = stateManager.findNode('text-weight-style') as Text;
    assert.equal(current.fontWeight, 400);

    // Redo peso y estilo
    commandManager.redo();
    current = stateManager.findNode('text-weight-style') as Text;
    assert.equal(current.fontWeight, 700);

    commandManager.redo();
    current = stateManager.findNode('text-weight-style') as Text;
    assert.equal(current.fontStyle, 'italic');

    cleanup();
  });

  it('8. Modificar alineación mediante select y botones rápidos sincroniza UI y Undo/Redo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-align-test',
      type: 'text',
      name: 'Texto Align',
      x: 0,
      y: 0,
      text: 'Texto',
      textAlign: 'left',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-align-test']);

    // Clic en botón centrar
    elements['#btn-text-align-center'].click();

    let current = stateManager.findNode('text-align-test') as Text;
    assert.equal(current.textAlign, 'center');
    assert.equal(elements['#select-text-align'].value, 'center');
    assert.equal(elements['#btn-text-align-center'].classList.contains('active'), true);
    assert.equal(elements['#btn-text-align-left'].classList.contains('active'), false);

    // Clic en botón derecha
    elements['#btn-text-align-right'].click();
    current = stateManager.findNode('text-align-test') as Text;
    assert.equal(current.textAlign, 'right');
    assert.equal(elements['#select-text-align'].value, 'right');
    assert.equal(elements['#btn-text-align-right'].classList.contains('active'), true);

    // Undo vuelve a center
    commandManager.undo();
    current = stateManager.findNode('text-align-test') as Text;
    assert.equal(current.textAlign, 'center');
    assert.equal(elements['#select-text-align'].value, 'center');

    // Undo vuelve a left
    commandManager.undo();
    current = stateManager.findNode('text-align-test') as Text;
    assert.equal(current.textAlign, 'left');
    assert.equal(elements['#select-text-align'].value, 'left');

    cleanup();
  });

  it('9. Modificar color de texto (fill) actualiza estado, muestra y soporta Undo/Redo', () => {
    const { elements, stateManager, commandManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const textNode: Text = {
      id: 'text-color-test',
      type: 'text',
      name: 'Texto Color',
      x: 0,
      y: 0,
      text: 'Colorido',
      fill: '#10b981',
    };
    stateManager.addShape(layerId, textNode);
    stateManager.setSelection(['text-color-test']);

    const colorInput = elements['#input-text-color'];
    colorInput.value = '#6366f1';
    colorInput.dispatchEvent({ type: 'input' });

    let current = stateManager.findNode('text-color-test') as Text;
    assert.equal(current.fill, '#6366f1');

    colorInput.dispatchEvent({ type: 'change' });
    assert.equal(commandManager.canUndo(), true);

    // Probar botón "sin color"
    elements['#btn-text-color-none'].click();
    current = stateManager.findNode('text-color-test') as Text;
    assert.equal(current.fill, 'none');

    // Undo restaura a #6366f1
    commandManager.undo();
    current = stateManager.findNode('text-color-test') as Text;
    assert.equal(current.fill, '#6366f1');

    // Undo restaura a #10b981
    commandManager.undo();
    current = stateManager.findNode('text-color-test') as Text;
    assert.equal(current.fill, '#10b981');

    cleanup();
  });

  it('10. No altera ni afecta propiedades de Rectangle, Ellipse o Path', () => {
    const { elements, stateManager, cleanup } = setupMockEnvironment();

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-standalone',
      type: 'rectangle',
      name: 'Rect Standalone',
      x: 20,
      y: 30,
      width: 100,
      height: 60,
      fill: '#22c55e',
      stroke: '#0f172a',
      strokeWidth: 3,
    };
    const ellipse: Ellipse = {
      id: 'ellipse-standalone',
      type: 'ellipse',
      name: 'Ellipse Standalone',
      x: 150,
      y: 100,
      radiusX: 40,
      radiusY: 20,
      fill: '#3b82f6',
      stroke: '#1e293b',
      strokeWidth: 1,
    };
    const path: Path = {
      id: 'path-standalone',
      type: 'path',
      name: 'Path Standalone',
      x: 200,
      y: 200,
      points: [
        { x: 200, y: 200 },
        { x: 300, y: 300 },
      ],
      fill: 'none',
      stroke: '#f59e0b',
      strokeWidth: 2,
    };

    stateManager.addShape(layerId, rect);
    stateManager.addShape(layerId, ellipse);
    stateManager.addShape(layerId, path);

    // Seleccionar rect
    stateManager.setSelection(['rect-standalone']);
    assert.equal(elements['#section-typography'].style.display, 'none');
    assert.equal(elements['#section-appearance'].style.display, 'block');
    assert.equal(elements['#input-fill'].value, '#22c55e');
    assert.equal(elements['#input-stroke'].value, '#0f172a');
    assert.equal(elements['#input-stroke-width'].value, '3');

    // Seleccionar ellipse
    stateManager.setSelection(['ellipse-standalone']);
    assert.equal(elements['#section-typography'].style.display, 'none');
    assert.equal(elements['#section-appearance'].style.display, 'block');
    assert.equal(elements['#input-fill'].value, '#3b82f6');

    // Seleccionar path
    stateManager.setSelection(['path-standalone']);
    assert.equal(elements['#section-typography'].style.display, 'none');
    assert.equal(elements['#section-appearance'].style.display, 'block');
    assert.equal(elements['#input-stroke'].value, '#f59e0b');

    cleanup();
  });
});
