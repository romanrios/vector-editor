import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import { ViewportManager, MIN_ZOOM, MAX_ZOOM } from '../src/utils/viewport.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

// Mock interactivo de DOM para Node.js con soporte estricto de eventos, listeners y ARIA
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public innerHTML: string = '';
  public files: any[] = [];
  public clickCount: number = 0;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
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
    if (!e.currentTarget) e.currentTarget = this;
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }

  public click(): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this, currentTarget: this });
  }

  public focus(): void {
    if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
  }

  public appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  public contains(target: any): boolean {
    if (target === this) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
  }

  public querySelector(sel: string): MockElement | null {
    for (const child of this.children) {
      if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) return child;
      if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
      const sub = child.querySelector(sel);
      if (sub) return sub;
    }
    return null;
  }
}

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    width: 800,
    height: 600,
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
    dispatchEvent: (e: any) => {
      if (!e.preventDefault) e.preventDefault = () => {};
      const list = listeners[e.type];
      if (list) {
        for (const l of list) l(e);
      }
    },
  } as unknown as HTMLCanvasElement;
}

function setupMockEnvironment() {
  const elements: Record<string, MockElement> = {
    '#viewport-canvas': new MockElement('viewport-canvas', 'canvas'),
    '#canvas-container': new MockElement('canvas-container', 'div'),
    '#tool-select': new MockElement('tool-select', 'button'),
    '#tool-direct-select': new MockElement('tool-direct-select', 'button'),
    '#tool-hand': new MockElement('tool-hand', 'button'),
    '#tool-pen': new MockElement('tool-pen', 'button'),
    '#tool-rectangle': new MockElement('tool-rectangle', 'button'),
    '#tool-ellipse': new MockElement('tool-ellipse', 'button'),
    '#btn-undo': new MockElement('btn-undo', 'button'),
    '#btn-redo': new MockElement('btn-redo', 'button'),
    '#btn-export': new MockElement('btn-export', 'button'),
    '#btn-import': new MockElement('btn-import', 'button'),
    '#file-import-input': new MockElement('file-import-input', 'input'),
    '#status-tool-label': new MockElement('status-tool-label', 'span'),
    '#status-shapes-count': new MockElement('status-shapes-count', 'span'),
    '#status-selection-info': new MockElement('status-selection-info', 'span'),
    '#status-selection-separator': new MockElement('status-selection-separator', 'span'),

    // Controles de zoom en la barra de estado
    '#status-zoom-btn': new MockElement('status-zoom-btn', 'button'),
    '#status-zoom-label': new MockElement('status-zoom-label', 'span'),
    '#zoom-dropdown': new MockElement('zoom-dropdown', 'div'),

    // Menú barra
    '.menu-bar': new MockElement('menu-bar', 'nav'),
    '#menu-btn-file': new MockElement('menu-btn-file', 'button'),
    '#menu-btn-edit': new MockElement('menu-btn-edit', 'button'),
    '#menu-btn-object': new MockElement('menu-btn-object', 'button'),
    '#menu-btn-view': new MockElement('menu-btn-view', 'button'),
    '#menu-btn-help': new MockElement('menu-btn-help', 'button'),

    '#menu-dropdown-file': new MockElement('menu-dropdown-file', 'div'),
    '#menu-dropdown-edit': new MockElement('menu-dropdown-edit', 'div'),
    '#menu-dropdown-object': new MockElement('menu-dropdown-object', 'div'),
    '#menu-dropdown-view': new MockElement('menu-dropdown-view', 'div'),
    '#menu-dropdown-help': new MockElement('menu-dropdown-help', 'div'),

    '#menu-item-import': new MockElement('menu-item-import', 'button'),
    '#menu-item-export': new MockElement('menu-item-export', 'button'),
    '#menu-item-undo': new MockElement('menu-item-undo', 'button'),
    '#menu-item-redo': new MockElement('menu-item-redo', 'button'),
    '#menu-item-copy': new MockElement('menu-item-copy', 'button'),
    '#menu-item-paste': new MockElement('menu-item-paste', 'button'),
    '#menu-item-duplicate': new MockElement('menu-item-duplicate', 'button'),
    '#menu-item-delete': new MockElement('menu-item-delete', 'button'),
    '#menu-item-bring-to-front': new MockElement('menu-item-bring-to-front', 'button'),
    '#menu-item-send-to-back': new MockElement('menu-item-send-to-back', 'button'),

    // Ítems del menú Vista
    '#menu-item-zoom-in': new MockElement('menu-item-zoom-in', 'button'),
    '#menu-item-zoom-out': new MockElement('menu-item-zoom-out', 'button'),
    '#menu-item-zoom-fit': new MockElement('menu-item-zoom-fit', 'button'),
    '#menu-item-zoom-100': new MockElement('menu-item-zoom-100', 'button'),

    '#menu-item-shortcuts': new MockElement('menu-item-shortcuts', 'button'),
    '#shortcuts-dialog': new MockElement('shortcuts-dialog', 'dialog'),
    '#btn-close-shortcuts': new MockElement('btn-close-shortcuts', 'button'),
    '#shortcuts-dialog-list': new MockElement('shortcuts-dialog-list', 'div'),
  };

  // Inicializar atributos como en index.html
  elements['#zoom-dropdown'].hidden = true;
  elements['#menu-dropdown-view'].hidden = true;
  elements['#menu-btn-view'].setAttribute('aria-expanded', 'false');
  elements['#status-zoom-btn'].setAttribute('aria-expanded', 'false');

  // Crear elementos para presets de zoom (valores numéricos de escala como en index.html)
  const presetValues = ['0.25', '0.5', '1', '2', '4', 'fit'];
  const presetElements: MockElement[] = presetValues.map((val) => {
    const el = new MockElement(`zoom-preset-${val}`, 'button');
    el.classList.add('zoom-dropdown-item');
    el.setAttribute('data-preset', val);
    elements['#zoom-dropdown'].appendChild(el);
    return el;
  });

  // Jerarquía DOM para menús
  elements['.menu-bar'].appendChild(elements['#menu-btn-view']);
  elements['.menu-bar'].appendChild(elements['#menu-dropdown-view']);
  elements['#menu-dropdown-view'].appendChild(elements['#menu-item-zoom-in']);
  elements['#menu-dropdown-view'].appendChild(elements['#menu-item-zoom-out']);
  elements['#menu-dropdown-view'].appendChild(elements['#menu-item-zoom-fit']);
  elements['#menu-dropdown-view'].appendChild(elements['#menu-item-zoom-100']);

  elements['#status-zoom-btn'].appendChild(elements['#status-zoom-label']);

  const docListeners: Map<string, Set<(e: any) => void>> = new Map();

  const doc = {
    activeElement: null as any,
    querySelector: (sel: string) => elements[sel] || null,
    querySelectorAll: (sel: string) => {
      if (sel === '.zoom-dropdown-item') {
        return presetElements;
      }
      return [];
    },
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
      docListeners.get(e.type)?.forEach((fn) => fn(e));
    },
    getListenerCount: (type: string) => docListeners.get(type)?.size ?? 0,
  };

  (globalThis as any).document = doc;

  return { elements, doc, presetElements };
}

describe('Controles de Navegación, Atajos y Vista (Menú Vista, Atajos, Mano, Zoom)', () => {
  it('1. Menú "Vista" en la barra de menú abre y ejecuta Acercar, Alejar, Ajustar y 100%', () => {
    const { elements } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const btnView = elements['#menu-btn-view'];
    const dropdownView = elements['#menu-dropdown-view'];
    const itemZoomIn = elements['#menu-item-zoom-in'];
    const itemZoomOut = elements['#menu-item-zoom-out'];
    const itemZoomFit = elements['#menu-item-zoom-fit'];
    const itemZoom100 = elements['#menu-item-zoom-100'];

    // Menú inicialmente cerrado
    assert.equal(btnView.getAttribute('aria-expanded'), 'false');
    assert.equal(dropdownView.hidden, true);

    // Clic abre el menú
    btnView.click();
    assert.equal(btnView.getAttribute('aria-expanded'), 'true');
    assert.equal(dropdownView.hidden, false);

    // Clic en Acercar (zoom x1.25)
    assert.equal(viewportManager.zoom, 1.0);
    itemZoomIn.click();
    assert.equal(dropdownView.hidden, true);
    assert.equal(viewportManager.zoom, 1.25);

    // Clic en Alejar (zoom /1.25 -> 1.0)
    btnView.click();
    itemZoomOut.click();
    assert.equal(dropdownView.hidden, true);
    assert.equal(viewportManager.zoom, 1.0);

    // Clic en 100% cuando el zoom ha cambiado
    viewportManager.setViewport({ zoom: 2.5, panX: 50, panY: 50 });
    btnView.click();
    itemZoom100.click();
    assert.equal(dropdownView.hidden, true);
    assert.equal(viewportManager.zoom, 1.0);

    // Clic en Ajustar a la ventana con documento vacío (reset a 1.0 centrado)
    btnView.click();
    itemZoomFit.click();
    assert.equal(dropdownView.hidden, true);
    assert.equal(viewportManager.zoom, 1.0);

    cleanup();
  });

  it('2. Atajos de teclado con Ctrl y Cmd (+, -, 0, 1) con preventDefault y bloqueo con foco en inputs', () => {
    setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    // A) Atajos normales con Ctrl
    let preventedCount = 0;
    const fakePreventDefault = () => { preventedCount++; };

    // Ctrl++ / Ctrl+= (Acercar)
    inputController.handleKeyDown({
      key: '+',
      ctrlKey: true,
      preventDefault: fakePreventDefault,
    } as any);
    assert.equal(viewportManager.zoom, 1.25);
    assert.equal(preventedCount, 1);

    // Ctrl+= (versión sin Shift de la tecla igual/más)
    inputController.handleKeyDown({
      key: '=',
      ctrlKey: true,
      preventDefault: fakePreventDefault,
    } as any);
    assert.equal(viewportManager.zoom, 1.25 * 1.25);
    assert.equal(preventedCount, 2);

    // Cmd+- (Alejar con metaKey en macOS)
    inputController.handleKeyDown({
      key: '-',
      metaKey: true,
      preventDefault: fakePreventDefault,
    } as any);
    assert.equal(Math.abs(viewportManager.zoom - 1.25) < 1e-6, true);
    assert.equal(preventedCount, 3);

    // Ctrl+1 (Tamaño real 100%)
    inputController.handleKeyDown({
      key: '1',
      ctrlKey: true,
      preventDefault: fakePreventDefault,
    } as any);
    assert.equal(viewportManager.zoom, 1.0);
    assert.equal(preventedCount, 4);

    // Ctrl+0 (Ajustar a la ventana)
    viewportManager.setViewport({ zoom: 3.0, panX: 100, panY: 100 });
    inputController.handleKeyDown({
      key: '0',
      ctrlKey: true,
      preventDefault: fakePreventDefault,
    } as any);
    assert.equal(viewportManager.zoom, 1.0);
    assert.equal(preventedCount, 5);

    // B) No deben actuar si el foco está en un input
    const inputElement = new MockElement('some-input', 'INPUT');
    (globalThis as any).document.activeElement = inputElement;

    const initialZoom = viewportManager.zoom;
    inputController.handleKeyDown({
      key: '+',
      ctrlKey: true,
      target: inputElement,
      preventDefault: fakePreventDefault,
    } as any);
    // El zoom NO debe haber cambiado
    assert.equal(viewportManager.zoom, initialZoom);

    // Restablecer activeElement
    (globalThis as any).document.activeElement = null;
  });

  it('3. Ajustar a la ventana (zoomFit): con y sin contenido, y tras importar JSON', () => {
    const { elements } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // A) Sin contenido (documento vacío): centra con zoom 1
    viewportManager.setViewport({ zoom: 4.0, panX: 200, panY: -100 });
    inputController.zoomFit();
    assert.equal(viewportManager.zoom, 1.0);
    assert.equal(viewportManager.panX, 400); // 800 / 2
    assert.equal(viewportManager.panY, 300); // 600 / 2

    // B) Con contenido visible: figura de 200x100 en (100, 100)
    const layer = stateManager.getState().children[0];
    const rect: Rectangle = {
      id: 'rect-fit-test',
      type: 'rectangle',
      name: 'Rect Fit',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    stateManager.addShape(layer.id, rect);

    inputController.zoomFit();
    // Debe calcular zoom adecuado para encajar 200x100 con margen 40 en canvas de 800x600
    // w = 800 - 80 = 720; h = 600 - 80 = 520; scaleX = 720 / 200 = 3.6; scaleY = 520 / 100 = 5.2 -> zoom 3.6
    assert.equal(Math.abs(viewportManager.zoom - 3.6) < 1e-4, true);

    // C) Si la figura no es visible (visible: false), se comporta como vacío
    stateManager.updateShape(rect.id, { visible: false });
    inputController.zoomFit();
    assert.equal(viewportManager.zoom, 1.0);

    // D) Importación de JSON ejecuta zoomFit
    const fileInput = elements['#file-import-input'];
    const fakeDoc = {
      id: 'doc-imported',
      type: 'document',
      version: 1,
      children: [
        {
          id: 'layer-1',
          type: 'layer',
          name: 'Capa 1',
          visible: true,
          locked: false,
          children: [
            {
              id: 'rect-imp',
              type: 'rectangle',
              name: 'Rect Importado',
              x: 0,
              y: 0,
              width: 400,
              height: 400,
              fill: '#00ff00',
              stroke: '#000000',
              strokeWidth: 1,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
            },
          ],
        },
      ],
    };
    const fakeFile = {
      name: 'test.json',
      text: async () => JSON.stringify(fakeDoc),
    };
    fileInput.files = [fakeFile];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Dar un microtick para el async de FileReader / file.text
    setTimeout(() => {
      assert.ok(viewportManager.zoom > 0);
    }, 10);

    cleanup();
  });

  it('4. Herramienta Mano: botón en barra izquierda, atajo H, estado activo, texto de modo y paneo', () => {
    const { elements } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const btnHand = elements['#tool-hand'];
    const statusToolLabel = elements['#status-tool-label'];

    // Herramienta inicial es 'select'
    assert.equal(inputController.currentTool, 'select');
    assert.equal(btnHand.classList.contains('active'), false);
    assert.equal(statusToolLabel.textContent, 'Modo: Selección');

    // A) Atajo 'H' conmuta a Mano
    inputController.handleKeyDown({ key: 'h', code: 'KeyH' } as any);
    assert.equal(inputController.currentTool, 'hand');
    assert.equal(btnHand.classList.contains('active'), true);
    assert.equal(statusToolLabel.textContent, 'Modo: Mano');
    assert.equal(canvas.style.cursor, 'grab');

    // B) Clic en el botón Mano desde otra herramienta
    inputController.setTool('select');
    assert.equal(inputController.currentTool, 'select');
    btnHand.click();
    assert.equal(inputController.currentTool, 'hand');
    assert.equal(btnHand.classList.contains('active'), true);
    assert.equal(statusToolLabel.textContent, 'Modo: Mano');

    // C) Paneo con botón principal (button === 0)
    const initialPanX = viewportManager.panX;
    const initialPanY = viewportManager.panY;

    // mousedown en (100, 100)
    inputController.handleMouseDown({
      clientX: 100,
      clientY: 100,
      button: 0,
      preventDefault: () => {},
    } as any);

    assert.equal(inputController.isPanning, true);
    assert.equal(canvas.style.cursor, 'grabbing');

    // mousemove a (150, 130) -> delta (50, 30)
    inputController.handleMouseMove({
      clientX: 150,
      clientY: 130,
    } as any);

    assert.equal(viewportManager.panX, initialPanX + 50);
    assert.equal(viewportManager.panY, initialPanY + 30);
    assert.equal(canvas.style.cursor, 'grabbing');

    // mouseup restaura 'grab'
    inputController.handleMouseUp({
      clientX: 150,
      clientY: 130,
      button: 0,
    } as any);

    assert.equal(inputController.isPanning, false);
    assert.equal(canvas.style.cursor, 'grab');

    cleanup();
  });

  it('5. Indicador de zoom en barra de estado y menú desplegable de presets (25%, 50%, 100%, 200%, 400%, Ajustar)', () => {
    const { elements, presetElements, doc } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const statusZoomBtn = elements['#status-zoom-btn'];
    const statusZoomLabel = elements['#status-zoom-label'];
    const zoomDropdown = elements['#zoom-dropdown'];

    // Inicialmente refleja 100%
    assert.equal(statusZoomLabel.textContent, '100 %');
    assert.equal(zoomDropdown.hidden, true);

    // Cambio en vivo del zoom mediante viewportManager
    viewportManager.setViewport({ zoom: 1.5, panX: 0, panY: 0 });
    assert.equal(statusZoomLabel.textContent, '150 %');

    // Clic en el botón abre el menú de presets
    statusZoomBtn.click();
    assert.equal(zoomDropdown.hidden, false);
    assert.equal(statusZoomBtn.getAttribute('aria-expanded'), 'true');

    // Clic en preset 200% (data-preset="2")
    const preset200 = presetElements.find((el) => el.getAttribute('data-preset') === '2');
    assert.ok(preset200);
    preset200.click();
    assert.equal(zoomDropdown.hidden, true);
    assert.equal(viewportManager.zoom, 2.0);
    assert.equal(statusZoomLabel.textContent, '200 %');

    // Clic en preset 50% (data-preset="0.5")
    statusZoomBtn.click();
    const preset50 = presetElements.find((el) => el.getAttribute('data-preset') === '0.5');
    assert.ok(preset50);
    preset50.click();
    assert.equal(zoomDropdown.hidden, true);
    assert.equal(viewportManager.zoom, 0.5);
    assert.equal(statusZoomLabel.textContent, '50 %');

    // Clic en preset 'fit'
    statusZoomBtn.click();
    const presetFit = presetElements.find((el) => el.getAttribute('data-preset') === 'fit');
    assert.ok(presetFit);
    presetFit.click();
    assert.equal(zoomDropdown.hidden, true);
    assert.equal(viewportManager.zoom, 1.0); // vacío -> 1.0

    // Clic fuera o tecla Escape cierran el menú de zoom
    statusZoomBtn.click();
    assert.equal(zoomDropdown.hidden, false);
    doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(zoomDropdown.hidden, true);

    cleanup();
  });

  it('6. Casos límite: límites de zoom [0.1, 32] y deshabilitación de ítems en el menú', () => {
    const { elements } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const itemZoomIn = elements['#menu-item-zoom-in'];
    const itemZoomOut = elements['#menu-item-zoom-out'];

    // A) En zoom 1.0, ambos están habilitados
    assert.equal(itemZoomIn.disabled, false);
    assert.equal(itemZoomOut.disabled, false);

    // B) Al llegar a MAX_ZOOM (32), Acercar se deshabilita
    viewportManager.setViewport({ zoom: MAX_ZOOM, panX: 0, panY: 0 });
    assert.equal(itemZoomIn.disabled, true);
    assert.equal(itemZoomIn.getAttribute('aria-disabled'), 'true');
    assert.equal(itemZoomOut.disabled, false);

    // Intentar aumentar más allá de MAX_ZOOM no sobrepasa el límite
    inputController.zoomIn();
    assert.equal(viewportManager.zoom, MAX_ZOOM);

    // C) Al llegar a MIN_ZOOM (0.1), Alejar se deshabilita
    viewportManager.setViewport({ zoom: MIN_ZOOM, panX: 0, panY: 0 });
    assert.equal(itemZoomOut.disabled, true);
    assert.equal(itemZoomOut.getAttribute('aria-disabled'), 'true');
    assert.equal(itemZoomIn.disabled, false);

    // Intentar disminuir más allá de MIN_ZOOM no baja del límite
    inputController.zoomOut();
    assert.equal(viewportManager.zoom, MIN_ZOOM);

    cleanup();
  });

  it('7. cleanup() desvincula correctamente todos los nuevos listeners', () => {
    const { elements, presetElements } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const statusZoomBtn = elements['#status-zoom-btn'];
    const zoomDropdown = elements['#zoom-dropdown'];
    const btnHand = elements['#tool-hand'];
    const itemZoomIn = elements['#menu-item-zoom-in'];

    // Comprobar que los elementos tienen listeners registrados
    assert.ok(statusZoomBtn.getListenerCount('click') > 0);
    assert.ok(statusZoomBtn.getListenerCount('keydown') > 0);
    assert.ok(zoomDropdown.getListenerCount('keydown') > 0);
    assert.ok(btnHand.getListenerCount('click') > 0);
    assert.ok(itemZoomIn.getListenerCount('click') > 0);
    assert.ok(presetElements[0].getListenerCount('click') > 0);

    cleanup();

    // Tras cleanup, todos los listeners deben haber sido removidos
    assert.equal(statusZoomBtn.getListenerCount('click'), 0);
    assert.equal(statusZoomBtn.getListenerCount('keydown'), 0);
    assert.equal(zoomDropdown.getListenerCount('keydown'), 0);
    assert.equal(btnHand.getListenerCount('click'), 0);
    assert.equal(itemZoomIn.getListenerCount('click'), 0);
    assert.equal(presetElements[0].getListenerCount('click'), 0);
  });

  it('8. ResizeObserver mantiene el punto central del mundo tras redimensionar el contenedor', () => {
    let resizeCallback: (() => void) | undefined;
    (globalThis as any).ResizeObserver = class {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    const { elements } = setupMockEnvironment();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager();
    const canvas = createMockCanvas();
    (canvas as any).width = 800;
    (canvas as any).height = 600;
    (canvas as any).getBoundingClientRect = () => ({ width: 800, height: 600, left: 0, top: 0 });

    elements['#viewport-canvas'] = canvas as any;
    elements['#canvas-container'] = canvas as any;

    const inputController = new InputController(canvas, stateManager, commandManager, { viewportManager });
    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Supongamos que estamos en zoom 2 con panX = 100, panY = 50
    viewportManager.setViewport({ zoom: 2.0, panX: 100, panY: 50 });
    const oldCenterWorld = viewportManager.screenToWorld({ x: 400, y: 300 });

    // Redimensionamos canvas a 1000x800
    (canvas as any).getBoundingClientRect = () => ({ width: 1000, height: 800, left: 0, top: 0 });
    if (typeof resizeCallback === 'function') {
      (resizeCallback as () => void)();
    }

    const newCenterWorld = viewportManager.screenToWorld({ x: 500, y: 400 });
    assert.equal(Math.abs(newCenterWorld.x - oldCenterWorld.x) < 1e-4, true);
    assert.equal(Math.abs(newCenterWorld.y - oldCenterWorld.y) < 1e-4, true);

    cleanup();
    delete (globalThis as any).ResizeObserver;
  });
});
