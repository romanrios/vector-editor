import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { InputController, KEYBOARD_SHORTCUTS } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

// Mock de elemento DOM con compatibilidad estricta para --experimental-strip-types
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

  public showModal(): void {
    this.setAttribute('open', '');
    this.style.display = 'block';
  }

  public close(): void {
    this.removeAttribute('open');
    this.style.display = 'none';
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
    '.menu-bar': new MockElement('menu-bar', 'nav'),
    '#menu-btn-file': new MockElement('menu-btn-file', 'button'),
    '#menu-btn-edit': new MockElement('menu-btn-edit', 'button'),
    '#menu-btn-object': new MockElement('menu-btn-object', 'button'),
    '#menu-btn-help': new MockElement('menu-btn-help', 'button'),
    '#menu-dropdown-file': new MockElement('menu-dropdown-file', 'div'),
    '#menu-dropdown-edit': new MockElement('menu-dropdown-edit', 'div'),
    '#menu-dropdown-object': new MockElement('menu-dropdown-object', 'div'),
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
    '#menu-item-shortcuts': new MockElement('menu-item-shortcuts', 'button'),
    '#shortcuts-dialog': new MockElement('shortcuts-dialog', 'dialog'),
    '#btn-close-shortcuts': new MockElement('btn-close-shortcuts', 'button'),
    '#shortcuts-dialog-list': new MockElement('shortcuts-dialog-list', 'div'),
    '#file-import-input': new MockElement('file-import-input', 'input'),
    '#btn-undo': new MockElement('btn-undo', 'button'),
    '#btn-redo': new MockElement('btn-redo', 'button'),
    '#btn-export': new MockElement('btn-export', 'button'),
    '#btn-import': new MockElement('btn-import', 'button'),
    '#btn-duplicate': new MockElement('btn-duplicate', 'button'),
    '#btn-bring-to-front': new MockElement('btn-bring-to-front', 'button'),
    '#btn-send-to-back': new MockElement('btn-send-to-back', 'button'),
  };

  // Jerarquía DOM para contains()
  elements['.menu-bar'].appendChild(elements['#menu-btn-file']);
  elements['.menu-bar'].appendChild(elements['#menu-dropdown-file']);
  elements['#menu-dropdown-file'].appendChild(elements['#menu-item-import']);
  elements['#menu-dropdown-file'].appendChild(elements['#menu-item-export']);

  elements['.menu-bar'].appendChild(elements['#menu-btn-edit']);
  elements['.menu-bar'].appendChild(elements['#menu-dropdown-edit']);
  elements['#menu-dropdown-edit'].appendChild(elements['#menu-item-undo']);
  elements['#menu-dropdown-edit'].appendChild(elements['#menu-item-redo']);
  elements['#menu-dropdown-edit'].appendChild(elements['#menu-item-copy']);
  elements['#menu-dropdown-edit'].appendChild(elements['#menu-item-paste']);
  elements['#menu-dropdown-edit'].appendChild(elements['#menu-item-duplicate']);
  elements['#menu-dropdown-edit'].appendChild(elements['#menu-item-delete']);

  elements['.menu-bar'].appendChild(elements['#menu-btn-object']);
  elements['.menu-bar'].appendChild(elements['#menu-dropdown-object']);
  elements['#menu-dropdown-object'].appendChild(elements['#menu-item-bring-to-front']);
  elements['#menu-dropdown-object'].appendChild(elements['#menu-item-send-to-back']);

  elements['.menu-bar'].appendChild(elements['#menu-btn-help']);
  elements['.menu-bar'].appendChild(elements['#menu-dropdown-help']);
  elements['#menu-dropdown-help'].appendChild(elements['#menu-item-shortcuts']);

  const docListeners: Map<string, Set<(e: any) => void>> = new Map();

  const doc = {
    activeElement: null as any,
    querySelector: (sel: string) => elements[sel] || null,
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
  return { elements, doc };
}

describe('Menús Desplegables y Diálogo de Atajos (setupUIBindings)', () => {
  it('apertura y cierre de menús mediante clic, toggle y cambio al pasar el ratón (hover switch)', () => {
    const { elements } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const btnFile = elements['#menu-btn-file'];
    const dropdownFile = elements['#menu-dropdown-file'];
    const btnEdit = elements['#menu-btn-edit'];
    const dropdownEdit = elements['#menu-dropdown-edit'];

    // 1. Clic en Archivo lo abre
    btnFile.click();
    assert.equal(btnFile.getAttribute('aria-expanded'), 'true');
    assert.equal(btnFile.classList.contains('is-open'), true);
    assert.equal(dropdownFile.hidden, false);
    assert.equal(dropdownFile.classList.contains('is-open'), true);

    // 2. Clic nuevamente en Archivo lo cierra
    btnFile.click();
    assert.equal(btnFile.getAttribute('aria-expanded'), 'false');
    assert.equal(btnFile.classList.contains('is-open'), false);
    assert.equal(dropdownFile.hidden, true);
    assert.equal(dropdownFile.classList.contains('is-open'), false);

    // 3. Abrir Archivo, y al pasar el ratón a Edición cambia automáticamente de menú
    btnFile.click();
    assert.equal(dropdownFile.hidden, false);

    btnEdit.dispatchEvent({ type: 'mouseenter' });
    assert.equal(btnFile.getAttribute('aria-expanded'), 'false');
    assert.equal(dropdownFile.hidden, true);
    assert.equal(btnEdit.getAttribute('aria-expanded'), 'true');
    assert.equal(dropdownEdit.hidden, false);

    cleanup();
  });

  it('clic fuera o pulsar Escape cierran el menú desplegable abierto', () => {
    const { elements, doc } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const btnFile = elements['#menu-btn-file'];
    const dropdownFile = elements['#menu-dropdown-file'];

    // Abrir menú
    btnFile.click();
    assert.equal(dropdownFile.hidden, false);

    // Clic fuera de la barra de menú cierra
    const outsideEl = new MockElement('outside');
    doc.dispatchEvent({ type: 'click', target: outsideEl });
    assert.equal(dropdownFile.hidden, true);
    assert.equal(btnFile.getAttribute('aria-expanded'), 'false');

    // Abrir de nuevo y presionar Escape en el documento
    btnFile.click();
    assert.equal(dropdownFile.hidden, false);
    doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(dropdownFile.hidden, true);
    assert.equal(btnFile.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, btnFile);

    cleanup();
  });

  it('deshabilita y habilita automáticamente los ítems según el estado del documento e historial', () => {
    const { elements } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const itemUndo = elements['#menu-item-undo'];
    const itemRedo = elements['#menu-item-redo'];
    const itemCopy = elements['#menu-item-copy'];
    const itemPaste = elements['#menu-item-paste'];
    const itemDuplicate = elements['#menu-item-duplicate'];
    const itemDelete = elements['#menu-item-delete'];
    const itemBringToFront = elements['#menu-item-bring-to-front'];
    const itemSendToBack = elements['#menu-item-send-to-back'];
    const btnObject = elements['#menu-btn-object'];

    // 1. Estado inicial sin historial ni selección
    assert.equal(itemUndo.disabled, true);
    assert.equal(itemRedo.disabled, true);
    assert.equal(itemCopy.disabled, true);
    assert.equal(itemPaste.disabled, true);
    assert.equal(itemDuplicate.disabled, true);
    assert.equal(itemDelete.disabled, true);
    assert.equal(btnObject.disabled, true);
    assert.equal(itemBringToFront.disabled, true);
    assert.equal(itemSendToBack.disabled, true);

    // 2. Insertar una figura y seleccionarla
    const layer = stateManager.getState().children[0];
    const rect: Rectangle = {
      id: 'rect-menu-test',
      type: 'rectangle',
      name: 'Rectángulo Prueba',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    stateManager.addShape(layer.id, rect);
    stateManager.selectNode(rect.id);

    // Con figura seleccionada, los ítems dependientes de selección se habilitan
    assert.equal(itemCopy.disabled, false);
    assert.equal(itemDuplicate.disabled, false);
    assert.equal(itemDelete.disabled, false);
    assert.equal(btnObject.disabled, false);
    assert.equal(itemBringToFront.disabled, false);
    assert.equal(itemSendToBack.disabled, false);

    // Pegar sigue deshabilitado (portapapeles aún vacío)
    assert.equal(itemPaste.disabled, true);

    // 3. Copiar la figura
    itemCopy.click();
    assert.equal(inputController.clipboard?.id, rect.id);
    // Ahora Pegar está habilitado
    assert.equal(itemPaste.disabled, false);

    // 4. Registrar comando en CommandManager: Deshacer se habilita
    const cmd = new TranslateCommand(stateManager, rect.id, 10, 20, 30, 40);
    commandManager.executeCommand(cmd);
    assert.equal(itemUndo.disabled, false);
    assert.equal(itemRedo.disabled, true);

    // 5. Deshacer: Rehacer se habilita
    itemUndo.click();
    assert.equal(itemUndo.disabled, true);
    assert.equal(itemRedo.disabled, false);

    // 6. Deseleccionar figura: ítems dependientes de selección se deshabilitan
    stateManager.selectNode(null);
    assert.equal(itemCopy.disabled, true);
    assert.equal(itemDuplicate.disabled, true);
    assert.equal(itemDelete.disabled, true);
    assert.equal(btnObject.disabled, true);
    assert.equal(itemBringToFront.disabled, true);
    assert.equal(itemSendToBack.disabled, true);

    cleanup();
  });

  it('los ítems de menú ejecutan las acciones correctas y cierran el menú', () => {
    const { elements } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Preparar figura en escena
    const layer = stateManager.getState().children[0];
    const rect: Rectangle = {
      id: 'rect-action-test',
      type: 'rectangle',
      name: 'Figura Prueba',
      x: 50,
      y: 50,
      width: 80,
      height: 60,
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 2,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    stateManager.addShape(layer.id, rect);
    stateManager.selectNode(rect.id);

    // Abrir menú Edición
    elements['#menu-btn-edit'].click();
    assert.equal(elements['#menu-dropdown-edit'].hidden, false);

    // Ejecutar Duplicar desde el menú
    elements['#menu-item-duplicate'].click();
    // El menú debe haberse cerrado
    assert.equal(elements['#menu-dropdown-edit'].hidden, true);
    assert.equal(elements['#menu-btn-edit'].getAttribute('aria-expanded'), 'false');

    // Debe haberse creado una copia
    const currentShapes = stateManager.getState().children[0].children;
    assert.equal(currentShapes.length, 2);
    assert.equal(currentShapes[1].name.includes('copia'), true);

    // Eliminar la copia
    elements['#menu-btn-edit'].click();
    elements['#menu-item-delete'].click();
    assert.equal(elements['#menu-dropdown-edit'].hidden, true);
    assert.equal(stateManager.getState().children[0].children.length, 1);

    // Deshacer la eliminación
    elements['#menu-btn-edit'].click();
    elements['#menu-item-undo'].click();
    assert.equal(elements['#menu-dropdown-edit'].hidden, true);
    assert.equal(stateManager.getState().children[0].children.length, 2);

    // Importar JSON activa el input file
    elements['#menu-btn-file'].click();
    elements['#menu-item-import'].click();
    assert.equal(elements['#menu-dropdown-file'].hidden, true);
    assert.equal(elements['#file-import-input'].clickCount, 1);

    cleanup();
  });

  it('el menú Ayuda abre el diálogo de atajos con los atajos reales de InputController', () => {
    const { elements } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const dialog = elements['#shortcuts-dialog'];
    const dialogList = elements['#shortcuts-dialog-list'];

    // Clic en Ayuda -> Atajos de teclado
    elements['#menu-btn-help'].click();
    elements['#menu-item-shortcuts'].click();

    // Diálogo abierto
    assert.equal(dialog.getAttribute('open'), '');
    assert.equal(dialog.style.display, 'block');

    // Verifica que contiene la tabla con atajos reales de InputController
    const shortcuts = inputController.getShortcuts();
    assert.ok(shortcuts.length >= 15);
    assert.deepEqual(shortcuts, KEYBOARD_SHORTCUTS);
    assert.equal(dialogList.children.length > 0, true);

    // Botón de cerrar diálogo
    elements['#btn-close-shortcuts'].click();
    assert.equal(dialog.getAttribute('open'), null);
    assert.equal(dialog.style.display, 'none');

    cleanup();
  });

  it('navegación con teclado: flechas, Enter y Escape en la barra de menú', () => {
    const { elements, doc } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const btnFile = elements['#menu-btn-file'];
    const btnEdit = elements['#menu-btn-edit'];
    const btnHelp = elements['#menu-btn-help'];
    const dropdownFile = elements['#menu-dropdown-file'];
    const itemImport = elements['#menu-item-import'];
    const itemExport = elements['#menu-item-export'];

    // Foco en btnFile
    btnFile.focus();
    assert.equal(doc.activeElement, btnFile);

    // 1. Flecha derecha pasa a btnEdit
    btnFile.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
    assert.equal(doc.activeElement, btnEdit);

    // 2. Flecha izquierda en btnFile pasa a btnHelp (wrap)
    btnFile.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
    assert.equal(doc.activeElement, btnHelp);

    // 3. Flecha abajo en btnFile abre el menú y enfoca el primer ítem habilitado
    btnFile.focus();
    btnFile.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
    assert.equal(dropdownFile.hidden, false);
    assert.equal(btnFile.getAttribute('aria-expanded'), 'true');
    assert.equal(doc.activeElement, itemImport);

    // 4. Flecha abajo en el dropdown navega a itemExport
    dropdownFile.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
    assert.equal(doc.activeElement, itemExport);

    // 5. Flecha arriba regresa a itemImport
    dropdownFile.dispatchEvent({ type: 'keydown', key: 'ArrowUp' });
    assert.equal(doc.activeElement, itemImport);

    // 6. Escape cierra el menú y devuelve el foco al trigger
    dropdownFile.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(dropdownFile.hidden, true);
    assert.equal(btnFile.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, btnFile);

    // 7. Enter en un ítem activado ejecuta su clic y cierra el menú
    btnFile.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
    assert.equal(dropdownFile.hidden, false);
    assert.equal(doc.activeElement, itemImport);

    dropdownFile.dispatchEvent({ type: 'keydown', key: 'Enter' });
    assert.equal(dropdownFile.hidden, true);
    assert.equal(elements['#file-import-input'].clickCount, 1);

    cleanup();
  });

  it('cleanup() desvincula correctamente todos los listeners', () => {
    const { elements, doc } = setupMockDOM();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Verificar que los triggers y el documento tienen listeners
    assert.ok(elements['#menu-btn-file'].getListenerCount('click') > 0);
    assert.ok(elements['#menu-item-undo'].getListenerCount('click') > 0);
    assert.ok(doc.getListenerCount('click') > 0);

    cleanup();

    // Después de cleanup, los listeners deben haber sido removidos
    assert.equal(elements['#menu-btn-file'].getListenerCount('click'), 0);
    assert.equal(elements['#menu-btn-file'].getListenerCount('mouseenter'), 0);
    assert.equal(elements['#menu-btn-file'].getListenerCount('keydown'), 0);
    assert.equal(elements['#menu-dropdown-file'].getListenerCount('keydown'), 0);
    assert.equal(elements['#menu-item-undo'].getListenerCount('click'), 0);
    assert.equal(elements['#btn-close-shortcuts'].getListenerCount('click'), 0);
    assert.equal(doc.getListenerCount('click'), 0);
    assert.equal(doc.getListenerCount('keydown'), 0);
  });
});
