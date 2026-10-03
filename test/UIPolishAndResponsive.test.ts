import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle, Ellipse, Path } from '../src/types/scene-graph.ts';

// Mock de elemento DOM para Node test runner (--experimental-strip-types)
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public innerHTML: string = '';
  public open: boolean = true;
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

  public hasListener(event: string, listener: (e: any) => void): boolean {
    const set = this.listeners.get(event);
    return set ? set.has(listener) : false;
  }

  public getListenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  public click(): void {
    this.clickCount++;
    const set = this.listeners.get('click');
    if (set) {
      for (const listener of set) {
        listener({ type: 'click', target: this, stopPropagation: () => {}, preventDefault: () => {} });
      }
    }
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.preventDefault) e.preventDefault = () => {};
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
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

interface TestDOMContext {
  domMap: Record<string, MockElement>;
  mockStorage: Record<string, string>;
  mockBody: MockElement;
  elements: {
    statusToolLabel: MockElement;
    statusShapesCount: MockElement;
    statusSelectionInfo: MockElement;
    statusSelectionSeparator: MockElement;
    noSelectionState: MockElement;
    selectionState: MockElement;
    btnDeleteSelection: MockElement;
    btnTogglePanel: MockElement;
    sectionAppearance: MockElement;
    sectionOrder: MockElement;
    sectionActions: MockElement;
  };
}

function setupTestDOM(): TestDOMContext {
  const mockStorage: Record<string, string> = {};
  const mockBody = new MockElement('body', 'body');

  const statusToolLabel = new MockElement('status-tool-label', 'span');
  const statusShapesCount = new MockElement('status-shapes-count', 'span');
  const statusSelectionInfo = new MockElement('status-selection-info', 'span');
  const statusSelectionSeparator = new MockElement('status-selection-separator', 'span');

  const noSelectionState = new MockElement('no-selection-state', 'div');
  const selectionState = new MockElement('selection-state', 'div');

  const inputFill = new MockElement('input-fill', 'input');
  const inputStroke = new MockElement('input-stroke', 'input');
  const inputStrokeWidth = new MockElement('input-stroke-width', 'input');

  const btnBringToFront = new MockElement('btn-bring-to-front', 'button');
  const btnSendToBack = new MockElement('btn-send-to-back', 'button');
  const btnDuplicate = new MockElement('btn-duplicate', 'button');
  const btnDeleteSelection = new MockElement('btn-delete-selection', 'button');
  const btnTogglePanel = new MockElement('btn-toggle-panel', 'button');

  const sectionAppearance = new MockElement('section-appearance', 'details');
  const sectionOrder = new MockElement('section-order', 'details');
  const sectionActions = new MockElement('section-actions', 'details');

  const domMap: Record<string, MockElement> = {
    '#status-tool-label': statusToolLabel,
    '#status-shapes-count': statusShapesCount,
    '#status-selection-info': statusSelectionInfo,
    '#status-selection-separator': statusSelectionSeparator,
    '#no-selection-state': noSelectionState,
    '#selection-state': selectionState,
    '#input-fill': inputFill,
    '#input-stroke': inputStroke,
    '#input-stroke-width': inputStrokeWidth,
    '#btn-bring-to-front': btnBringToFront,
    '#btn-send-to-back': btnSendToBack,
    '#btn-duplicate': btnDuplicate,
    '#btn-delete-selection': btnDeleteSelection,
    '#btn-toggle-panel': btnTogglePanel,
    '#section-appearance': sectionAppearance,
    '#section-order': sectionOrder,
    '#section-actions': sectionActions,
  };

  const collapsibleSections = [sectionAppearance, sectionOrder, sectionActions];

  (globalThis as any).sessionStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { for (const k of Object.keys(mockStorage)) delete mockStorage[k]; },
  };

  (globalThis as any).document = {
    body: mockBody,
    querySelector: (selector: string) => domMap[selector] || null,
    querySelectorAll: (selector: string) => {
      if (selector === '.collapsible-section') return collapsibleSections;
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    domMap,
    mockStorage,
    mockBody,
    elements: {
      statusToolLabel,
      statusShapesCount,
      statusSelectionInfo,
      statusSelectionSeparator,
      noSelectionState,
      selectionState,
      btnDeleteSelection,
      btnTogglePanel,
      sectionAppearance,
      sectionOrder,
      sectionActions,
    },
  };
}

describe('Puliendo la Interfaz: Panel de Propiedades, Barra de Estado y Responsive', () => {
  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).sessionStorage;
  });

  it('panel de propiedades: alterna entre "Sin selección" y estado con selección', () => {
    const { elements } = setupTestDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Sin selección inicial
    assert.equal(elements.noSelectionState.style.display, 'block');
    assert.equal(elements.selectionState.style.display, 'none');

    // Añadir una figura y seleccionarla
    const rect: Rectangle = {
      id: 'rect-1',
      type: 'rectangle',
      name: 'Rectángulo de prueba',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
      visible: true,
      locked: false,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode(rect.id);

    // Con selección
    assert.equal(elements.noSelectionState.style.display, 'none');
    assert.equal(elements.selectionState.style.display, 'block');

    // Deseleccionar
    stateManager.selectNode(null);
    assert.equal(elements.noSelectionState.style.display, 'block');
    assert.equal(elements.selectionState.style.display, 'none');

    cleanup();
  });

  it('panel de propiedades: botón eliminar (#btn-delete-selection) borra la figura seleccionada', () => {
    const { elements } = setupTestDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const rect: Rectangle = {
      id: 'rect-to-delete',
      type: 'rectangle',
      name: 'Rectángulo a eliminar',
      x: 20,
      y: 20,
      width: 80,
      height: 40,
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 1,
      visible: true,
      locked: false,
    };
    const layerId = stateManager.getState().children[0].id;
    stateManager.addShape(layerId, rect);
    stateManager.selectNode(rect.id);

    assert.equal(stateManager.getSelectedNode()?.id, 'rect-to-delete');

    // Clic en botón eliminar del panel de propiedades
    elements.btnDeleteSelection.click();

    // La figura debe haber sido eliminada del Scene Graph
    assert.equal(stateManager.getSelectedNode(), null);
    const layer = stateManager.getState().children[0];
    assert.equal(layer.children.length, 0);

    cleanup();
  });

  it('panel de propiedades: secciones plegables recuerdan su estado en sessionStorage', () => {
    const { elements, mockStorage } = setupTestDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Plegar la sección de apariencia
    elements.sectionAppearance.open = false;
    elements.sectionAppearance.dispatchEvent({ type: 'toggle' });

    // Verificar que se guardó en sessionStorage
    assert.equal(mockStorage['panel-section-section-appearance'], 'false');

    // Desplegar la sección de apariencia nuevamente
    elements.sectionAppearance.open = true;
    elements.sectionAppearance.dispatchEvent({ type: 'toggle' });
    assert.equal(mockStorage['panel-section-section-appearance'], 'true');

    cleanup();

    // Nueva inicialización: simular que el usuario tenía una sección cerrada
    mockStorage['panel-section-section-order'] = 'false';
    const bindings2 = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(elements.sectionOrder.open, false);
    bindings2.cleanup();
  });

  it('barra de estado: refleja herramienta activa, conteo de figuras y figura seleccionada con su tipo', () => {
    const { elements } = setupTestDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // 1. Estado inicial con 0 figuras
    assert.equal(elements.statusShapesCount.textContent, '0 figuras');
    assert.equal(elements.statusSelectionInfo.style.display, 'none');

    // 2. Agregar una figura
    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-status-1',
      type: 'rectangle',
      name: 'Mi Rectángulo',
      x: 50,
      y: 50,
      width: 120,
      height: 60,
      fill: '#123456',
      stroke: '#000000',
      strokeWidth: 2,
      visible: true,
      locked: false,
    };
    stateManager.addShape(layerId, rect);

    assert.equal(elements.statusShapesCount.textContent, '1 figura');

    // 3. Seleccionar la figura: debe mostrar nombre y tipo "Rectángulo"
    stateManager.selectNode(rect.id);
    assert.equal(elements.statusSelectionInfo.textContent, 'Mi Rectángulo (Rectángulo)');
    assert.equal(elements.statusSelectionInfo.style.display, 'inline');
    assert.equal(elements.statusSelectionSeparator.style.display, 'inline');

    // 4. Agregar otra figura (Elipse) y seleccionarla
    const ellipse: Ellipse = {
      id: 'ellipse-status-1',
      type: 'ellipse',
      name: 'Mi Círculo',
      x: 200,
      y: 200,
      radiusX: 40,
      radiusY: 40,
      fill: '#abcdef',
      stroke: '#000000',
      strokeWidth: 1,
      visible: true,
      locked: false,
    };
    stateManager.addShape(layerId, ellipse);
    assert.equal(elements.statusShapesCount.textContent, '2 figuras');

    stateManager.selectNode(ellipse.id);
    assert.equal(elements.statusSelectionInfo.textContent, 'Mi Círculo (Elipse)');

    // 5. Agregar un Path y seleccionarlo
    const path: Path = {
      id: 'path-status-1',
      type: 'path',
      name: 'Curva Bézier',
      x: 0,
      y: 0,
      points: [{ x: 10, y: 10 }],
      fill: 'none',
      stroke: '#ff00ff',
      strokeWidth: 2,
      visible: true,
      locked: false,
    };
    stateManager.addShape(layerId, path);
    assert.equal(elements.statusShapesCount.textContent, '3 figuras');

    stateManager.selectNode(path.id);
    assert.equal(elements.statusSelectionInfo.textContent, 'Curva Bézier (Trazado)');

    // 6. Al deseleccionar, la información de selección se oculta
    stateManager.selectNode(null);
    assert.equal(elements.statusSelectionInfo.style.display, 'none');
    assert.equal(elements.statusSelectionSeparator.style.display, 'none');

    cleanup();
  });

  it('responsive: botón #btn-toggle-panel conmuta la clase panel-open y aria-expanded', () => {
    const { elements, mockBody } = setupTestDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(mockBody.classList.contains('panel-open'), false);

    // Primer clic: abre panel
    elements.btnTogglePanel.click();
    assert.equal(mockBody.classList.contains('panel-open'), true);
    assert.equal(elements.btnTogglePanel.getAttribute('aria-expanded'), 'true');

    // Segundo clic: cierra panel
    elements.btnTogglePanel.click();
    assert.equal(mockBody.classList.contains('panel-open'), false);
    assert.equal(elements.btnTogglePanel.getAttribute('aria-expanded'), 'false');

    cleanup();
  });

  it('cleanup() desvincula correctamente los listeners de los nuevos controles', () => {
    const { elements } = setupTestDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    assert.equal(elements.btnDeleteSelection.getListenerCount('click'), 1);
    assert.equal(elements.btnTogglePanel.getListenerCount('click'), 1);
    assert.equal(elements.sectionAppearance.getListenerCount('toggle'), 1);

    cleanup();

    assert.equal(elements.btnDeleteSelection.getListenerCount('click'), 0);
    assert.equal(elements.btnTogglePanel.getListenerCount('click'), 0);
    assert.equal(elements.sectionAppearance.getListenerCount('toggle'), 0);
  });
});
