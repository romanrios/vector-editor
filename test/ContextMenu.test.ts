import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Document, Rectangle } from '../src/types/scene-graph.ts';

// Mock interactivo del DOM para tests unitarios
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public innerHTML: string = '';
  public clickCount: number = 0;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public offsetWidth: number = 220;
  public offsetHeight: number = 320;
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'div') {
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

  public getListenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  public dispatchEvent(e: any): void {
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.target) e.target = this;
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }

  public click(): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this });
  }

  public focus(): void {
    if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
  }

  public appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public querySelector<T = MockElement>(sel: string): T | null {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      const findClass = (el: MockElement): MockElement | null => {
        if (el.classes.has(cls)) return el;
        for (const c of el.children) {
          const res = findClass(c);
          if (res) return res;
        }
        return null;
      };
      return findClass(this) as unknown as T;
    }
    return null;
  }

  public closest(sel: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (sel.startsWith('.') && curr.classes.has(sel.slice(1))) {
        return curr;
      }
      if (sel.startsWith('#') && curr.id === sel.slice(1)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  public contains(target: any): boolean {
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }
}

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    focus: () => {},
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  } as unknown as HTMLCanvasElement;
}

function setupMockDOM() {
  const elements: Record<string, MockElement> = {
    '#context-menu': new MockElement('context-menu', 'div'),
    '#ctx-item-cut': new MockElement('ctx-item-cut', 'button'),
    '#ctx-item-copy': new MockElement('ctx-item-copy', 'button'),
    '#ctx-item-paste': new MockElement('ctx-item-paste', 'button'),
    '#ctx-item-paste-here': new MockElement('ctx-item-paste-here', 'button'),
    '#ctx-item-duplicate': new MockElement('ctx-item-duplicate', 'button'),
    '#ctx-item-bring-to-front': new MockElement('ctx-item-bring-to-front', 'button'),
    '#ctx-item-send-to-back': new MockElement('ctx-item-send-to-back', 'button'),
    '#ctx-item-group': new MockElement('ctx-item-group', 'button'),
    '#ctx-item-ungroup': new MockElement('ctx-item-ungroup', 'button'),
    '#ctx-item-align': new MockElement('ctx-item-align', 'button'),
    '#ctx-dropdown-align': new MockElement('ctx-dropdown-align', 'div'),
    '#ctx-item-align-left': new MockElement('ctx-item-align-left', 'button'),
    '#ctx-item-align-center-h': new MockElement('ctx-item-align-center-h', 'button'),
    '#ctx-item-align-right': new MockElement('ctx-item-align-right', 'button'),
    '#ctx-item-align-top': new MockElement('ctx-item-align-top', 'button'),
    '#ctx-item-align-center-v': new MockElement('ctx-item-align-center-v', 'button'),
    '#ctx-item-align-bottom': new MockElement('ctx-item-align-bottom', 'button'),
    '#ctx-item-pathfinder': new MockElement('ctx-item-pathfinder', 'button'),
    '#ctx-dropdown-pathfinder': new MockElement('ctx-dropdown-pathfinder', 'div'),
    '#ctx-item-pathfinder-union': new MockElement('ctx-item-pathfinder-union', 'button'),
    '#ctx-item-pathfinder-subtract': new MockElement('ctx-item-pathfinder-subtract', 'button'),
    '#ctx-item-pathfinder-intersect': new MockElement('ctx-item-pathfinder-intersect', 'button'),
    '#ctx-item-pathfinder-exclude': new MockElement('ctx-item-pathfinder-exclude', 'button'),
    '#ctx-item-lock': new MockElement('ctx-item-lock', 'button'),
    '#ctx-item-select-all': new MockElement('ctx-item-select-all', 'button'),
    '#ctx-item-delete': new MockElement('ctx-item-delete', 'button'),
  };

  const lockLabel = new MockElement('', 'span');
  lockLabel.classList.add('menu-item-label');
  lockLabel.textContent = 'Bloquear';
  elements['#ctx-item-lock'].appendChild(lockLabel);

  const ctxMenu = elements['#context-menu'];
  ctxMenu.appendChild(elements['#ctx-item-cut']);
  ctxMenu.appendChild(elements['#ctx-item-copy']);
  ctxMenu.appendChild(elements['#ctx-item-paste']);
  ctxMenu.appendChild(elements['#ctx-item-paste-here']);
  ctxMenu.appendChild(elements['#ctx-item-duplicate']);
  ctxMenu.appendChild(elements['#ctx-item-bring-to-front']);
  ctxMenu.appendChild(elements['#ctx-item-send-to-back']);
  ctxMenu.appendChild(elements['#ctx-item-group']);
  ctxMenu.appendChild(elements['#ctx-item-ungroup']);

  const alignContainer = new MockElement('ctx-submenu-align-container', 'div');
  alignContainer.classList.add('menu-submenu-container');
  alignContainer.appendChild(elements['#ctx-item-align']);
  alignContainer.appendChild(elements['#ctx-dropdown-align']);
  elements['#ctx-dropdown-align'].appendChild(elements['#ctx-item-align-left']);
  elements['#ctx-dropdown-align'].appendChild(elements['#ctx-item-align-center-h']);
  elements['#ctx-dropdown-align'].appendChild(elements['#ctx-item-align-right']);
  elements['#ctx-dropdown-align'].appendChild(elements['#ctx-item-align-top']);
  elements['#ctx-dropdown-align'].appendChild(elements['#ctx-item-align-center-v']);
  elements['#ctx-dropdown-align'].appendChild(elements['#ctx-item-align-bottom']);
  ctxMenu.appendChild(alignContainer);

  const pathfinderContainer = new MockElement('ctx-submenu-pathfinder-container', 'div');
  pathfinderContainer.classList.add('menu-submenu-container');
  pathfinderContainer.appendChild(elements['#ctx-item-pathfinder']);
  pathfinderContainer.appendChild(elements['#ctx-dropdown-pathfinder']);
  elements['#ctx-dropdown-pathfinder'].appendChild(elements['#ctx-item-pathfinder-union']);
  elements['#ctx-dropdown-pathfinder'].appendChild(elements['#ctx-item-pathfinder-subtract']);
  elements['#ctx-dropdown-pathfinder'].appendChild(elements['#ctx-item-pathfinder-intersect']);
  elements['#ctx-dropdown-pathfinder'].appendChild(elements['#ctx-item-pathfinder-exclude']);
  ctxMenu.appendChild(pathfinderContainer);

  ctxMenu.appendChild(elements['#ctx-item-lock']);
  ctxMenu.appendChild(elements['#ctx-item-select-all']);
  ctxMenu.appendChild(elements['#ctx-item-delete']);

  const docListeners: Map<string, Set<(e: any) => void>> = new Map();

  const doc = {
    activeElement: null as any,
    querySelector: (sel: string) => elements[sel] || null,
    querySelectorAll: (_sel: string) => [],
    createElement: (_tag: string) => new MockElement('', _tag),
    addEventListener: (type: string, fn: any) => {
      let set = docListeners.get(type);
      if (!set) {
        set = new Set();
        docListeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: any) => {
      docListeners.get(type)?.delete(fn);
    },
    dispatchEvent: (e: any) => {
      if (!e.preventDefault) e.preventDefault = () => {};
      const set = docListeners.get(e.type);
      if (set) {
        for (const fn of set) fn(e);
      }
    },
  };

  const oldDoc = (globalThis as any).document;
  const oldWindow = (globalThis as any).window;
  (globalThis as any).document = doc;
  (globalThis as any).window = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    elements,
    doc,
    cleanup: () => {
      (globalThis as any).document = oldDoc;
      (globalThis as any).window = oldWindow;
    },
  };
}

function createSampleDocument(): Document {
  const rect1: Rectangle = {
    id: 'rect-1',
    name: 'Rect 1',
    type: 'rectangle',
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
  };
  const rect2: Rectangle = {
    id: 'rect-2',
    name: 'Rect 2',
    type: 'rectangle',
    x: 200,
    y: 200,
    width: 100,
    height: 100,
    fill: '#00ff00',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
  };
  return {
    id: 'doc-1',
    name: 'Doc',
    type: 'document',
    width: 800,
    height: 600,
    children: [
      {
        id: 'layer-1',
        type: 'layer',
        name: 'Layer 1',
        visible: true,
        locked: false,
        opacity: 1,
        children: [rect1, rect2],
      },
    ],
  };
}

describe('Menú Contextual (Click Derecho en el Lienzo)', () => {
  it('InputController emite canvasContextMenu con coordenadas e información de hit', () => {
    const doc = createSampleDocument();
    const commandManager = new CommandManager();
    const stateManager = new StateManager(doc, commandManager);
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    let eventData: any = null;
    inputController.on('canvasContextMenu', (data) => {
      eventData = data;
    });

    let prevented = false;
    inputController.handleContextMenu({
      clientX: 75,
      clientY: 75,
      shiftKey: false,
      preventDefault: () => {
        prevented = true;
      },
    } as any);

    assert.equal(prevented, true, 'Debe llamar a preventDefault()');
    assert.ok(eventData, 'Debe emitir evento canvasContextMenu');
    assert.equal(eventData.clientX, 75);
    assert.equal(eventData.clientY, 75);
    assert.equal(eventData.hitShape?.id, 'rect-1');
    assert.equal(eventData.targetNode?.id, 'rect-1');
    assert.deepEqual(stateManager.getSelection(), ['rect-1'], 'Debe auto-seleccionar la figura clickeada');

    inputController.destroy();
  });

  it('preserva la multi-selección si se hace click derecho sobre una figura ya seleccionada', () => {
    const doc = createSampleDocument();
    const commandManager = new CommandManager();
    const stateManager = new StateManager(doc, commandManager);
    stateManager.setSelection(['rect-1', 'rect-2']);
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    inputController.handleContextMenu({
      clientX: 75,
      clientY: 75,
      shiftKey: false,
      preventDefault: () => {},
    } as any);

    assert.deepEqual(stateManager.getSelection(), ['rect-1', 'rect-2'], 'Conserva la multi-selección intacta');

    inputController.destroy();
  });

  it('preserva la multi-selección completa durante mousedown (botón 2), mouseup (botón 2) y contextmenu, permitiendo agrupar', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      stateManager.setSelection(['rect-1', 'rect-2']);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      // 1. Simular secuencia de clic derecho en rect-1 (75, 75)
      inputController.handleMouseDown({
        clientX: 75,
        clientY: 75,
        button: 2,
        shiftKey: false,
      } as any);

      assert.deepEqual(stateManager.getSelection(), ['rect-1', 'rect-2'], 'No colapsa selección en mousedown (botón 2)');

      inputController.handleMouseUp({
        clientX: 75,
        clientY: 75,
        button: 2,
        shiftKey: false,
      } as any);

      assert.deepEqual(stateManager.getSelection(), ['rect-1', 'rect-2'], 'No colapsa selección en mouseup (botón 2)');

      let prevented = false;
      inputController.handleContextMenu({
        clientX: 75,
        clientY: 75,
        button: 2,
        shiftKey: false,
        preventDefault: () => {
          prevented = true;
        },
      } as any);

      assert.equal(prevented, true);
      assert.deepEqual(stateManager.getSelection(), ['rect-1', 'rect-2'], 'Conserva multi-selección intacta tras contextmenu');

      // 2. Comprobar que la opción de agrupar en el menú contextual está habilitada
      const ctxItemGroup = elements['#ctx-item-group'];
      assert.equal(ctxItemGroup.disabled, false, 'Opción agrupar debe estar habilitada');
      assert.equal(ctxItemGroup.getAttribute('aria-disabled'), 'false');

      // 3. Ejecutar agrupar desde el menú contextual
      ctxItemGroup.click();

      const newSelection = stateManager.getSelection();
      assert.equal(newSelection.length, 1, 'Ahora hay un grupo seleccionado');
      const groupNode = stateManager.findNode(newSelection[0]);
      assert.ok(groupNode && groupNode.type === 'group', 'El nodo seleccionado es un grupo');

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('deselecciona al hacer click derecho en un área vacía (salvo con tecla Shift)', () => {
    const doc = createSampleDocument();
    const commandManager = new CommandManager();
    const stateManager = new StateManager(doc, commandManager);
    stateManager.setSelection(['rect-1']);
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    // Click derecho en fondo vacío sin Shift
    inputController.handleContextMenu({
      clientX: 700,
      clientY: 500,
      shiftKey: false,
      preventDefault: () => {},
    } as any);

    assert.deepEqual(stateManager.getSelection(), [], 'Deselecciona al clickear en vacío');

    // Con Shift preserva
    stateManager.setSelection(['rect-1']);
    inputController.handleContextMenu({
      clientX: 700,
      clientY: 500,
      shiftKey: true,
      preventDefault: () => {},
    } as any);

    assert.deepEqual(stateManager.getSelection(), ['rect-1'], 'Con Shift preserva la selección');

    inputController.destroy();
  });

  it('setupUIBindings abre el menú contextual y ajusta su posición a los límites del viewport', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      const ctxMenu = elements['#context-menu'];
      ctxMenu.hidden = true;

      // Emitir contextmenu cerca del borde inferior derecho (ej. 950, 750)
      inputController.emit('canvasContextMenu', {
        clientX: 950,
        clientY: 750,
        worldX: 950,
        worldY: 750,
        hitShape: null,
        targetNode: null,
      });

      assert.equal(ctxMenu.hidden, false, 'El menú contextual se hace visible');
      assert.ok(ctxMenu.classList.contains('is-open'), 'Tiene la clase is-open');
      // Viewport 1000x800, menú 220x320 -> Max X: 1000 - 220 - 10 = 770; Max Y: 800 - 320 - 10 = 470
      assert.equal(ctxMenu.style.left, '770px', 'Posición X clampada dentro de la ventana');
      assert.equal(ctxMenu.style.top, '470px', 'Posición Y clampada dentro de la ventana');

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('sincroniza el estado activo/deshabilitado de los ítems del menú contextual según la selección', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      // Sin selección
      stateManager.setSelection([]);
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });

      assert.equal(elements['#ctx-item-cut'].disabled, true);
      assert.equal(elements['#ctx-item-copy'].disabled, true);
      assert.equal(elements['#ctx-item-paste'].disabled, true);
      assert.equal(elements['#ctx-item-paste-here'].disabled, true);
      assert.equal(elements['#ctx-item-duplicate'].disabled, true);
      assert.equal(elements['#ctx-item-group'].disabled, true);
      assert.equal(elements['#ctx-item-align'].disabled, true);
      assert.equal(elements['#ctx-item-pathfinder'].disabled, true);
      assert.equal(elements['#ctx-item-delete'].disabled, true);

      // Con 1 elemento seleccionado
      stateManager.setSelection(['rect-1']);
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });

      assert.equal(elements['#ctx-item-cut'].disabled, false);
      assert.equal(elements['#ctx-item-copy'].disabled, false);
      assert.equal(elements['#ctx-item-duplicate'].disabled, false);
      assert.equal(elements['#ctx-item-delete'].disabled, false);
      assert.equal(elements['#ctx-item-group'].disabled, true); // mínimo 2 para agrupar
      assert.equal(elements['#ctx-item-align'].disabled, true); // mínimo 2 para alinear

      // Con 2 elementos seleccionados
      stateManager.setSelection(['rect-1', 'rect-2']);
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });

      assert.equal(elements['#ctx-item-group'].disabled, false);
      assert.equal(elements['#ctx-item-align'].disabled, false);

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('ejecuta acciones desde el menú contextual: cortar, copiar, pegar y pegar aquí', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      stateManager.setSelection(['rect-1']);

      // 1. Copiar
      elements['#ctx-item-copy'].click();
      assert.ok(inputController.clipboard, 'Clipboard tiene la figura copiada');

      // 2. Pegar Aquí en coordenadas (400, 300)
      inputController.emit('canvasContextMenu', {
        clientX: 400,
        clientY: 300,
        worldX: 400,
        worldY: 300,
        hitShape: null,
        targetNode: null,
      });
      elements['#ctx-item-paste-here'].click();

      const selectionAfterPasteHere = stateManager.getSelection();
      assert.equal(selectionAfterPasteHere.length, 1);
      const pastedShape = stateManager.findNode(selectionAfterPasteHere[0]) as Rectangle;
      // rect-1 original mide 100x100. Centrado en (400, 300), su top-left debe ser (350, 250)
      assert.equal(pastedShape.x, 350);
      assert.equal(pastedShape.y, 250);

      // 3. Cortar la figura recién pegada
      elements['#ctx-item-cut'].click();
      assert.equal(stateManager.findNode(pastedShape.id), null, 'La figura cortada fue eliminada');
      assert.ok(inputController.clipboard, 'El clipboard conserva la figura cortada');

      // 4. Deshacer el corte
      commandManager.undo();
      assert.ok(stateManager.findNode(pastedShape.id), 'Deshacer restaura la figura cortada');

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('bloquea y desbloquea elementos mediante SetLockedCommand / BatchCommand desde el menú contextual', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      stateManager.setSelection(['rect-1', 'rect-2']);
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });

      // Bloquear: al bloquear, StateManager deselecciona automáticamente los nodos bloqueados
      elements['#ctx-item-lock'].click();
      assert.equal(stateManager.findNode('rect-1')?.locked, true);
      assert.equal(stateManager.findNode('rect-2')?.locked, true);
      assert.deepEqual(stateManager.getSelection(), []);

      // Al seleccionar un nodo bloqueado (por ejemplo desde el panel de capas), el menú ofrece "Desbloquear"
      stateManager.setSelection(['rect-1']);
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });

      const label = elements['#ctx-item-lock'].querySelector<MockElement>('.menu-item-label');
      assert.equal(label?.textContent, 'Desbloquear');

      // Desbloquear con click: al desbloquear, no se deselecciona
      elements['#ctx-item-lock'].click();
      assert.equal(stateManager.findNode('rect-1')?.locked, false);
      assert.deepEqual(stateManager.getSelection(), ['rect-1']);

      // Deshacer revierte al estado bloqueado
      commandManager.undo();
      assert.equal(stateManager.findNode('rect-1')?.locked, true);

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('selecciona todo desde el menú contextual', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      stateManager.setSelection([]);
      elements['#ctx-item-select-all'].click();
      assert.deepEqual(stateManager.getSelection(), ['rect-1', 'rect-2']);

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('agrupa y desrupa elementos desde el menú contextual', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const doc = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(doc, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      stateManager.setSelection(['rect-1', 'rect-2']);
      elements['#ctx-item-group'].click();

      const sel = stateManager.getSelection();
      assert.equal(sel.length, 1);
      const groupNode = stateManager.findNode(sel[0]);
      assert.equal(groupNode?.type, 'group');

      // Ahora desagrupar
      elements['#ctx-item-ungroup'].click();
      assert.deepEqual([...stateManager.getSelection()].sort(), ['rect-1', 'rect-2'].sort());

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('cierra el menú contextual al presionar Escape o al hacer click fuera', () => {
    const { elements, doc, cleanup } = setupMockDOM();
    try {
      const docState = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docState, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      const ctxMenu = elements['#context-menu'];

      // Abrir menú
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });
      assert.equal(ctxMenu.hidden, false);

      // Escape
      doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
      assert.equal(ctxMenu.hidden, true, 'Escape cierra el menú contextual');

      // Abrir de nuevo
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });
      assert.equal(ctxMenu.hidden, false);

      // Click fuera
      doc.dispatchEvent({ type: 'click', target: new MockElement('outside', 'div') });
      assert.equal(ctxMenu.hidden, true, 'Click fuera cierra el menú contextual');

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('permite navegación con teclado en el menú contextual (flechas arriba/abajo y Enter)', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const docState = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docState, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      const ctxMenu = elements['#context-menu'];
      stateManager.setSelection(['rect-1']);

      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });

      // Flecha abajo enfoca el primer ítem habilitado
      ctxMenu.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
      assert.equal((globalThis as any).document.activeElement?.id, 'ctx-item-cut');

      // Flecha abajo avanza al segundo ítem habilitado
      ctxMenu.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
      assert.equal((globalThis as any).document.activeElement?.id, 'ctx-item-copy');

      // Flecha arriba vuelve al anterior
      ctxMenu.dispatchEvent({ type: 'keydown', key: 'ArrowUp' });
      assert.equal((globalThis as any).document.activeElement?.id, 'ctx-item-cut');

      bindings.cleanup();
      inputController.destroy();
    } finally {
      cleanup();
    }
  });

  it('cleanup remueve los listeners del menú contextual y de InputController', () => {
    const { elements, cleanup } = setupMockDOM();
    try {
      const docState = createSampleDocument();
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docState, commandManager);
      const canvas = createMockCanvas();
      const inputController = new InputController(canvas, stateManager, commandManager);
      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      const ctxMenu = elements['#context-menu'];
      const initialListeners = ctxMenu.getListenerCount('keydown');
      assert.ok(initialListeners > 0);

      bindings.cleanup();

      assert.equal(ctxMenu.getListenerCount('keydown'), 0);
      assert.equal(ctxMenu.getListenerCount('contextmenu'), 0);

      // Emitir después de cleanup no debe abrir el menú
      ctxMenu.hidden = true;
      inputController.emit('canvasContextMenu', {
        clientX: 100,
        clientY: 100,
        worldX: 100,
        worldY: 100,
        hitShape: null,
        targetNode: null,
      });
      assert.equal(ctxMenu.hidden, true, 'El listener de canvasContextMenu fue desvinculado');

      inputController.destroy();
    } finally {
      cleanup();
    }
  });
});
