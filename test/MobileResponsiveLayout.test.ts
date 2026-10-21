import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMobileNavigationBindings } from '../src/ui/MobileNavigationController.ts';

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
    if (name === 'hidden') this.hidden = true;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
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

  public click(): void {
    this.clickCount++;
    const event = {
      type: 'click',
      target: this,
      stopped: false,
      stopPropagation: () => { event.stopped = true; },
      preventDefault: () => {},
    };
    let curr: MockElement | null = this;
    while (curr && !event.stopped) {
      const set = curr.listeners.get('click');
      if (set) {
        for (const listener of set) {
          listener(event);
        }
      }
      curr = curr.parentElement;
    }
  }

  public closest<T extends MockElement>(selector: string): T | null {
    if (selector.includes('button[data-trigger]') && this.tagName === 'button' && this.getAttribute('data-trigger')) {
      return this as unknown as T;
    }
    return null;
  }

  public querySelectorAll<T extends MockElement>(selector: string): T[] {
    const results: T[] = [];
    if (selector === 'button[data-trigger]') {
      for (const child of this.children) {
        if (child.tagName === 'button' && child.getAttribute('data-trigger')) {
          results.push(child as unknown as T);
        }
      }
    }
    return results;
  }

  public focus(): void {}
  public contains(el: any): boolean {
    return this.children.includes(el);
  }
}

describe('MobileNavigationController (Fase 3)', () => {
  let originalDocument: any;
  let mockBody: MockElement;
  let elements: Record<string, MockElement>;
  let docListeners: Map<string, Set<(e: any) => void>>;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
    mockBody = new MockElement('body', 'body');
    docListeners = new Map();

    elements = {
      '#btn-hamburger-menu': new MockElement('btn-hamburger-menu', 'button'),
      '#mobile-menu-drawer': new MockElement('mobile-menu-drawer', 'aside'),
      '#mobile-menu-backdrop': new MockElement('mobile-menu-backdrop', 'div'),
      '#btn-close-drawer': new MockElement('btn-close-drawer', 'button'),
      '#btn-toggle-panel': new MockElement('btn-toggle-panel', 'button'),
      '#panel-backdrop': new MockElement('panel-backdrop', 'div'),
      '#btn-close-sheet': new MockElement('btn-close-sheet', 'button'),
      '#properties-panel': new MockElement('properties-panel', 'aside'),
      '#menu-item-undo': new MockElement('menu-item-undo', 'button'),
      '#menu-item-redo': new MockElement('menu-item-redo', 'button'),
      '#menu-item-delete': new MockElement('menu-item-delete', 'button'),
      '#ctx-item-select-all': new MockElement('ctx-item-select-all', 'button'),
    };

    // Crear elementos de drawer con data-trigger
    const itemUndo = new MockElement('drawer-item-undo', 'button');
    itemUndo.setAttribute('data-trigger', '#menu-item-undo');
    const itemRedo = new MockElement('drawer-item-redo', 'button');
    itemRedo.setAttribute('data-trigger', '#menu-item-redo');
    const itemDelete = new MockElement('drawer-item-delete', 'button');
    itemDelete.setAttribute('data-trigger', '#menu-item-delete');

    itemUndo.parentElement = elements['#mobile-menu-drawer'];
    itemRedo.parentElement = elements['#mobile-menu-drawer'];
    itemDelete.parentElement = elements['#mobile-menu-drawer'];
    elements['#mobile-menu-drawer'].children.push(itemUndo, itemRedo, itemDelete);

    (globalThis as any).document = {
      body: mockBody,
      activeElement: null,
      querySelector: (sel: string) => elements[sel] ?? null,
      querySelectorAll: (sel: string) => {
        if (sel === 'button[data-trigger]') {
          return elements['#mobile-menu-drawer'].children;
        }
        return [];
      },
      addEventListener: (event: string, fn: (e: any) => void) => {
        let set = docListeners.get(event);
        if (!set) {
          set = new Set();
          docListeners.set(event, set);
        }
        set.add(fn);
      },
      removeEventListener: (event: string, fn: (e: any) => void) => {
        docListeners.get(event)?.delete(fn);
      },
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  it('el botón hamburguesa abre y cierra el cajón móvil (Mobile Drawer)', () => {
    const controller = setupMobileNavigationBindings();

    assert.equal(controller.isDrawerOpen(), false);
    assert.equal(elements['#btn-hamburger-menu'].getAttribute('aria-expanded'), null);

    // Clic en hamburguesa abre el drawer
    elements['#btn-hamburger-menu'].click();
    assert.equal(controller.isDrawerOpen(), true);
    assert.equal(elements['#mobile-menu-drawer'].classList.contains('is-open'), true);
    assert.equal(elements['#mobile-menu-backdrop'].classList.contains('is-open'), true);
    assert.equal(elements['#btn-hamburger-menu'].getAttribute('aria-expanded'), 'true');

    // Clic en botón cerrar del drawer lo cierra
    elements['#btn-close-drawer'].click();
    assert.equal(controller.isDrawerOpen(), false);
    assert.equal(elements['#mobile-menu-drawer'].classList.contains('is-open'), false);
    assert.equal(elements['#mobile-menu-backdrop'].classList.contains('is-open'), false);
    assert.equal(elements['#btn-hamburger-menu'].getAttribute('aria-expanded'), 'false');

    controller.cleanup();
  });

  it('hacer clic en el backdrop del drawer lo cierra', () => {
    const controller = setupMobileNavigationBindings();

    controller.openDrawer();
    assert.equal(controller.isDrawerOpen(), true);

    elements['#mobile-menu-backdrop'].click();
    assert.equal(controller.isDrawerOpen(), false);

    controller.cleanup();
  });

  it('el botón de cerrar panel (#btn-close-sheet) y el backdrop cierran el bottom sheet de propiedades', () => {
    const controller = setupMobileNavigationBindings();

    // Abrir panel simulado
    controller.openPanel();
    assert.equal(controller.isPanelOpen(), true);
    assert.equal(mockBody.classList.contains('panel-open'), true);
    assert.equal(elements['#btn-toggle-panel'].getAttribute('aria-expanded'), 'true');
    assert.equal(elements['#panel-backdrop'].classList.contains('is-open'), true);

    // Clic en botón de cerrar del sheet
    elements['#btn-close-sheet'].click();
    assert.equal(controller.isPanelOpen(), false);
    assert.equal(mockBody.classList.contains('panel-open'), false);
    assert.equal(elements['#btn-toggle-panel'].getAttribute('aria-expanded'), 'false');
    assert.equal(elements['#panel-backdrop'].classList.contains('is-open'), false);

    // Abrir de nuevo y cerrar haciendo clic en el backdrop del panel
    controller.openPanel();
    assert.equal(controller.isPanelOpen(), true);

    elements['#panel-backdrop'].click();
    assert.equal(controller.isPanelOpen(), false);
    assert.equal(mockBody.classList.contains('panel-open'), false);

    controller.cleanup();
  });

  it('tocar o hacer clic dentro de #properties-panel no cierra el panel', () => {
    const controller = setupMobileNavigationBindings();

    controller.openPanel();
    assert.equal(controller.isPanelOpen(), true);

    // Clic dentro del panel de propiedades
    elements['#properties-panel'].click();
    assert.equal(controller.isPanelOpen(), true);
    assert.equal(mockBody.classList.contains('panel-open'), true);

    controller.cleanup();
  });

  it('delega el clic desde un botón del drawer con data-trigger al botón real y cierra el drawer', () => {
    const controller = setupMobileNavigationBindings();
    controller.openDrawer();
    assert.equal(controller.isDrawerOpen(), true);

    const itemUndo = elements['#mobile-menu-drawer'].children[0];
    assert.equal(elements['#menu-item-undo'].clickCount, 0);

    // Simular clic en el item del drawer
    itemUndo.click();

    assert.equal(elements['#menu-item-undo'].clickCount, 1);
    assert.equal(controller.isDrawerOpen(), false);

    controller.cleanup();
  });

  it('no delega el clic si el elemento objetivo está deshabilitado', () => {
    const controller = setupMobileNavigationBindings();
    controller.openDrawer();

    const itemRedo = elements['#mobile-menu-drawer'].children[1];
    elements['#menu-item-redo'].disabled = true;

    itemRedo.click();

    assert.equal(elements['#menu-item-redo'].clickCount, 0);
    // El drawer permanece abierto
    assert.equal(controller.isDrawerOpen(), true);

    controller.cleanup();
  });

  it('syncDrawerItems propaga los estados deshabilitados desde los ítems principales', () => {
    const controller = setupMobileNavigationBindings();

    elements['#menu-item-undo'].disabled = true;
    elements['#menu-item-redo'].disabled = false;
    elements['#menu-item-delete'].classList.add('disabled');

    controller.syncDrawerItems();

    const [itemUndo, itemRedo, itemDelete] = elements['#mobile-menu-drawer'].children;

    assert.equal(itemUndo.disabled, true);
    assert.equal(itemUndo.classList.contains('disabled'), true);
    assert.equal(itemUndo.getAttribute('aria-disabled'), 'true');

    assert.equal(itemRedo.disabled, false);
    assert.equal(itemRedo.classList.contains('disabled'), false);
    assert.equal(itemRedo.getAttribute('aria-disabled'), 'false');

    assert.equal(itemDelete.disabled, true);
    assert.equal(itemDelete.classList.contains('disabled'), true);
    assert.equal(itemDelete.getAttribute('aria-disabled'), 'true');

    controller.cleanup();
  });

  it('la tecla Escape cierra el drawer si está abierto, o el panel de propiedades', () => {
    const controller = setupMobileNavigationBindings();

    const keydownListeners = docListeners.get('keydown');
    assert.ok(keydownListeners && keydownListeners.size > 0);
    const fireEscape = () => {
      for (const listener of keydownListeners) {
        listener({ key: 'Escape', preventDefault: () => {} });
      }
    };

    // Caso 1: Drawer abierto
    controller.openDrawer();
    assert.equal(controller.isDrawerOpen(), true);
    fireEscape();
    assert.equal(controller.isDrawerOpen(), false);

    // Caso 2: Panel abierto
    controller.openPanel();
    assert.equal(controller.isPanelOpen(), true);
    fireEscape();
    assert.equal(controller.isPanelOpen(), false);

    controller.cleanup();
  });

  it('cleanup remueve los listeners de todos los controles', () => {
    const controller = setupMobileNavigationBindings();

    assert.ok(elements['#btn-hamburger-menu'].getListenerCount('click') > 0);
    assert.ok(elements['#btn-close-drawer'].getListenerCount('click') > 0);
    assert.ok(elements['#mobile-menu-backdrop'].getListenerCount('click') > 0);
    assert.ok(elements['#btn-close-sheet'].getListenerCount('click') > 0);
    assert.ok(elements['#panel-backdrop'].getListenerCount('click') > 0);
    assert.ok(elements['#properties-panel'].getListenerCount('click') > 0);
    assert.ok(docListeners.get('keydown')?.size ?? 0 > 0);

    controller.cleanup();

    assert.equal(elements['#btn-hamburger-menu'].getListenerCount('click'), 0);
    assert.equal(elements['#btn-close-drawer'].getListenerCount('click'), 0);
    assert.equal(elements['#mobile-menu-backdrop'].getListenerCount('click'), 0);
    assert.equal(elements['#btn-close-sheet'].getListenerCount('click'), 0);
    assert.equal(elements['#panel-backdrop'].getListenerCount('click'), 0);
    assert.equal(elements['#properties-panel'].getListenerCount('click'), 0);
    assert.equal(docListeners.get('keydown')?.size ?? 0, 0);
  });
});
