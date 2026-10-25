import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupToolbarBindings } from '../src/ui/ToolbarController.ts';

class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public clickCount: number = 0;
  public dataset: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  public listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string, tagName: string = 'button') {
    this.id = id;
    this.tagName = tagName;
  }

  public get classList() {
    return {
      add: (...classes: string[]) => classes.forEach((c) => this.classes.add(c)),
      remove: (...classes: string[]) => classes.forEach((c) => this.classes.delete(c)),
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

  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
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

  public click(): void {
    this.clickCount++;
    const set = this.listeners.get('click');
    if (set) {
      for (const listener of set) {
        listener({
          type: 'click',
          target: this,
          currentTarget: this,
          defaultPrevented: false,
          stopPropagation: () => {},
          preventDefault: () => {},
        });
      }
    }
  }

  public dispatchEvent(e: any): boolean {
    if (!e.target) e.target = this;
    if (!e.currentTarget) e.currentTarget = this;
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.preventDefault) {
      e.defaultPrevented = false;
      e.preventDefault = () => {
        e.defaultPrevented = true;
      };
    }
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
    return !e.defaultPrevented;
  }

  public contains(node: any): boolean {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  public querySelectorAll<T = MockElement>(selector: string): T[] {
    const results: MockElement[] = [];
    if (selector === '.flyout-item') {
      for (const child of this.children) {
        if (child.classList.contains('flyout-item')) {
          results.push(child);
        }
      }
    }
    return results as unknown as T[];
  }
}

function createMockCanvas(): HTMLCanvasElement {
  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

interface MockToolbarDOM {
  btnSelect: MockElement;
  btnRectangle: MockElement;
  btnEllipse: MockElement;
  btnPolygon: MockElement;
  btnStar: MockElement;
  groupShapes: MockElement;
  flyoutShapes: MockElement;
  flyoutItemRect: MockElement;
  flyoutItemEllipse: MockElement;
  flyoutItemPoly: MockElement;
  flyoutItemStar: MockElement;
  docListeners: Map<string, Set<(e: any) => void>>;
  restore: () => void;
}

function setupMockToolbar(): MockToolbarDOM {
  const btnSelect = new MockElement('tool-select');
  const btnDirectSelect = new MockElement('tool-direct-select');
  const btnHand = new MockElement('tool-hand');
  const btnPen = new MockElement('tool-pen');
  const btnPencil = new MockElement('tool-pencil');
  const btnRectangle = new MockElement('tool-rectangle');
  const btnEllipse = new MockElement('tool-ellipse');
  const btnPolygon = new MockElement('tool-polygon');
  const btnStar = new MockElement('tool-star');
  const btnLine = new MockElement('tool-line');
  const btnText = new MockElement('tool-text');
  const btnEyedropper = new MockElement('tool-eyedropper');
  const btnArtboard = new MockElement('tool-artboard');
  const btnUndo = new MockElement('btn-undo');
  const btnRedo = new MockElement('btn-redo');

  const groupShapes = new MockElement('group-shapes', 'div');
  const flyoutShapes = new MockElement('flyout-shapes', 'div');
  flyoutShapes.setAttribute('hidden', '');

  const flyoutItemRect = new MockElement('flyout-item-rect', 'button');
  flyoutItemRect.classList.add('flyout-item');
  flyoutItemRect.dataset.shape = 'rectangle';

  const flyoutItemEllipse = new MockElement('flyout-item-ellipse', 'button');
  flyoutItemEllipse.classList.add('flyout-item');
  flyoutItemEllipse.dataset.shape = 'ellipse';

  const flyoutItemPoly = new MockElement('flyout-item-poly', 'button');
  flyoutItemPoly.classList.add('flyout-item');
  flyoutItemPoly.dataset.shape = 'polygon';

  const flyoutItemStar = new MockElement('flyout-item-star', 'button');
  flyoutItemStar.classList.add('flyout-item');
  flyoutItemStar.dataset.shape = 'star';

  flyoutShapes.children = [flyoutItemRect, flyoutItemEllipse, flyoutItemPoly, flyoutItemStar];
  groupShapes.children = [btnRectangle, btnEllipse, btnPolygon, btnStar, flyoutShapes];

  const domMap: Record<string, MockElement> = {
    '#tool-select': btnSelect,
    '#tool-direct-select': btnDirectSelect,
    '#tool-hand': btnHand,
    '#tool-pen': btnPen,
    '#tool-pencil': btnPencil,
    '#tool-rectangle': btnRectangle,
    '#tool-ellipse': btnEllipse,
    '#tool-polygon': btnPolygon,
    '#tool-star': btnStar,
    '#tool-line': btnLine,
    '#tool-text': btnText,
    '#tool-eyedropper': btnEyedropper,
    '#tool-artboard': btnArtboard,
    '#btn-undo': btnUndo,
    '#btn-redo': btnRedo,
    '#group-shapes': groupShapes,
    '#flyout-shapes': flyoutShapes,
  };

  const docListeners = new Map<string, Set<(e: any) => void>>();
  const origDocument = (globalThis as any).document;

  (globalThis as any).document = {
    querySelector: (selector: string) => domMap[selector] || null,
    addEventListener: (event: string, listener: (e: any) => void) => {
      let set = docListeners.get(event);
      if (!set) {
        set = new Set();
        docListeners.set(event, set);
      }
      set.add(listener);
    },
    removeEventListener: (event: string, listener: (e: any) => void) => {
      const set = docListeners.get(event);
      if (set) set.delete(listener);
    },
  };

  return {
    btnSelect,
    btnRectangle,
    btnEllipse,
    btnPolygon,
    btnStar,
    groupShapes,
    flyoutShapes,
    flyoutItemRect,
    flyoutItemEllipse,
    flyoutItemPoly,
    flyoutItemStar,
    docListeners,
    restore: () => {
      (globalThis as any).document = origDocument;
    },
  };
}

describe('Grupo de Herramientas de Figura y Submenú Flyout (Illustrator-style)', () => {
  it('1. Estado inicial: muestra solo Rectángulo con indicador has-flyout, los demás están ocultos', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      assert.strictEqual(tb.getActiveShapeTool(), 'rectangle');
      assert.strictEqual(mock.btnRectangle.classList.contains('tool-hidden'), false);
      assert.strictEqual(mock.btnRectangle.classList.contains('has-flyout'), true);
      assert.strictEqual(mock.btnEllipse.classList.contains('tool-hidden'), true);
      assert.strictEqual(mock.btnPolygon.classList.contains('tool-hidden'), true);
      assert.strictEqual(mock.btnStar.classList.contains('tool-hidden'), true);
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('2. Cambiar de herramienta por atajo actualiza el slot visible y activa la figura correspondiente', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      // Cambiar a Elipse (E)
      ic.setTool('ellipse');
      assert.strictEqual(tb.getActiveShapeTool(), 'ellipse');
      assert.strictEqual(mock.btnEllipse.classList.contains('tool-hidden'), false);
      assert.strictEqual(mock.btnEllipse.classList.contains('active'), true);
      assert.strictEqual(mock.btnRectangle.classList.contains('tool-hidden'), true);

      // Cambiar a Estrella (S)
      ic.setTool('star');
      assert.strictEqual(tb.getActiveShapeTool(), 'star');
      assert.strictEqual(mock.btnStar.classList.contains('tool-hidden'), false);
      assert.strictEqual(mock.btnStar.classList.contains('active'), true);
      assert.strictEqual(mock.btnEllipse.classList.contains('tool-hidden'), true);

      // Cambiar a Selección (V): Estrella sigue visible en el slot pero sin active
      ic.setTool('select');
      assert.strictEqual(tb.getActiveShapeTool(), 'star');
      assert.strictEqual(mock.btnStar.classList.contains('tool-hidden'), false);
      assert.strictEqual(mock.btnStar.classList.contains('active'), false);
      assert.strictEqual(mock.btnSelect.classList.contains('active'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('3. openShapeFlyout y closeShapeFlyout controlan la apertura, atributos y aria-expanded', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      tb.openShapeFlyout();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);
      assert.strictEqual(mock.flyoutShapes.classList.contains('open'), true);
      assert.strictEqual(mock.btnRectangle.getAttribute('aria-expanded'), 'true');

      tb.closeShapeFlyout();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);
      assert.strictEqual(mock.flyoutShapes.classList.contains('open'), false);
      assert.strictEqual(mock.btnRectangle.getAttribute('aria-expanded'), 'false');

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('4. Clic derecho (contextmenu) en el grupo despliega el flyout y previene el menú por defecto', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      const contextEvent = {
        type: 'contextmenu',
        defaultPrevented: false,
        preventDefault: function () {
          this.defaultPrevented = true;
        },
        stopPropagation: () => {},
      };

      mock.groupShapes.dispatchEvent(contextEvent);

      assert.strictEqual(contextEvent.defaultPrevented, true);
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);
      assert.strictEqual(mock.flyoutShapes.classList.contains('open'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('5. Clic en un ítem del flyout selecciona la herramienta, actualiza el slot y cierra el submenú', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      tb.openShapeFlyout();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);

      // Clic en Polígono
      mock.flyoutItemPoly.click();

      assert.strictEqual(ic.currentTool, 'polygon');
      assert.strictEqual(tb.getActiveShapeTool(), 'polygon');
      assert.strictEqual(mock.btnPolygon.classList.contains('tool-hidden'), false);
      assert.strictEqual(mock.btnPolygon.classList.contains('active'), true);
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('6. Pulsar Escape cierra el submenú flyout abierto', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      tb.openShapeFlyout();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);

      const keyListeners = mock.docListeners.get('keydown');
      assert.ok(keyListeners && keyListeners.size > 0);

      for (const listener of keyListeners) {
        listener({ key: 'Escape' });
      }

      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('7. Clic fuera del contenedor cierra el submenú flyout abierto', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      tb.openShapeFlyout();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);

      const pointerListeners = mock.docListeners.get('pointerdown');
      assert.ok(pointerListeners && pointerListeners.size > 0);

      const outsideElement = new MockElement('outside');
      for (const listener of pointerListeners) {
        listener({ target: outsideElement });
      }

      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('8. cleanup() remueve los listeners sin lanzar errores', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      assert.doesNotThrow(() => {
        tb.cleanup();
      });

      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('9. Tocar la herramienta de figura activa conmuta el submenú flyout (ideal para táctil en móvil)', () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      // Seleccionar rectángulo como herramienta activa
      ic.setTool('rectangle');
      assert.strictEqual(ic.currentTool, 'rectangle');
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);

      // Primer toque cuando ya está activa: abre el flyout
      mock.btnRectangle.click();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);
      assert.strictEqual(mock.flyoutShapes.classList.contains('open'), true);

      // Segundo toque cuando ya está activa: cierra el flyout
      mock.btnRectangle.click();
      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('10. Pulsación prolongada táctil (long-press touch) abre el submenú respetando la tolerancia de dedos', async () => {
    const mock = setupMockToolbar();
    try {
      const sm = new StateManager();
      const cm = new CommandManager();
      const ic = new InputController(createMockCanvas(), sm, cm);
      const tb = setupToolbarBindings({ inputController: ic, commandManager: cm });

      const pointerDownEvent = {
        type: 'pointerdown',
        pointerType: 'touch',
        button: 0,
        clientX: 100,
        clientY: 100,
        defaultPrevented: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      };

      mock.groupShapes.dispatchEvent(pointerDownEvent);

      // Movimiento leve de 10px característico de un contacto táctil (por debajo del umbral de 18px)
      const pointerMoveEvent = {
        type: 'pointermove',
        pointerType: 'touch',
        clientX: 106,
        clientY: 108, // hypot = 10
        defaultPrevented: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      };
      mock.groupShapes.dispatchEvent(pointerMoveEvent);

      // Esperar 320ms a que venza el temporizador de long press táctil
      await new Promise((resolve) => setTimeout(resolve, 320));

      assert.strictEqual(mock.flyoutShapes.hasAttribute('hidden'), false);
      assert.strictEqual(mock.flyoutShapes.classList.contains('open'), true);

      tb.cleanup();
      ic.destroy();
    } finally {
      mock.restore();
    }
  });

  it('11. El indicador en CSS es un triángulo (clip-path polygon) estilo Illustrator en vez de cuadradito', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const cssPath = path.resolve('src/styles/layout/toolbar.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Debe contener el clip-path poligonal triangular
    assert.ok(
      css.includes('clip-path: polygon(100% 0, 100% 100%, 0 100%)'),
      'El indicador has-flyout::after debe ser un triángulo con clip-path: polygon(100% 0, 100% 100%, 0 100%)'
    );
    // Debe tener touch-action: manipulation en el grupo para prevenir cancelaciones de gestos móviles
    assert.ok(
      css.includes('touch-action: manipulation'),
      '.tool-group debe incluir touch-action: manipulation para soporte táctil móvil fluido'
    );
  });
});

