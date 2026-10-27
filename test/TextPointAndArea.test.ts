import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { ConvertTextTypeCommand } from '../src/commands/ConvertTextTypeCommand.ts';
import { ChangeTextCaseCommand } from '../src/commands/ChangeTextCaseCommand.ts';
import { setupContextMenuBindings } from '../src/ui/ContextMenuController.ts';
import { setupMenuBarBindings } from '../src/ui/MenuBarController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import type { Document, Text } from '../src/types/scene-graph.ts';

// Mock DOM element for tests
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
  public offsetWidth: number = 200;
  public offsetHeight: number = 200;
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
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      const findId = (el: MockElement): MockElement | null => {
        if (el.id === id) return el;
        for (const c of el.children) {
          const res = findId(c);
          if (res) return res;
        }
        return null;
      };
      return findId(this) as unknown as T;
    }
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

  public querySelectorAll<T = MockElement>(sel: string): T[] {
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      if (sel.startsWith('.') && el.classes.has(sel.slice(1))) {
        results.push(el);
      } else if (sel.startsWith('#') && el.id === sel.slice(1)) {
        results.push(el);
      }
      for (const c of el.children) {
        walk(c);
      }
    };
    walk(this);
    return results as unknown as T[];
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

function createSampleDocument(): Document {
  return {
    id: 'doc-1',
    name: 'Test Document',
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
        children: [
          {
            id: 'text-point',
            type: 'text',
            text: 'Hola Mundo Illustrator',
            x: 100,
            y: 150,
            fontSize: 24,
            fontFamily: 'Inter',
            fill: '#000000',
            stroke: 'none',
            strokeWidth: 0,
            opacity: 1,
            rotation: 0,
            visible: true,
            locked: false,
            textKind: 'point',
          } as Text,
          {
            id: 'text-area',
            type: 'text',
            text: 'Línea uno larga para probar salto automático de texto en área',
            x: 100,
            y: 250,
            boxWidth: 150,
            fontSize: 18,
            fontFamily: 'Roboto',
            fill: '#000000',
            stroke: 'none',
            strokeWidth: 0,
            opacity: 1,
            rotation: 0,
            visible: true,
            locked: false,
            textKind: 'area',
          } as Text,
        ],
      },
    ],
  };
}

describe('Rediseño de Herramienta de Texto (Modos Punto y Área + Menú Texto Illustrator)', () => {
  it('1. ConvertTextTypeCommand: convierte de Texto de Punto a Texto de Área con Undo/Redo', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();

    const initial = sm.findNode('text-point') as Text;
    assert.equal(initial.textKind, 'point');
    assert.equal(initial.boxWidth, undefined);

    const cmd = new ConvertTextTypeCommand(sm, 'text-point', 'area');
    cmd.execute();
    cm.recordCommand(cmd);

    const converted = sm.findNode('text-point') as Text;
    assert.equal(converted.textKind, 'area');
    assert.ok(typeof converted.boxWidth === 'number' && converted.boxWidth > 0);
    assert.equal(converted.text, 'Hola Mundo Illustrator');

    // Deshacer (Undo)
    cm.undo();
    const undone = sm.findNode('text-point') as Text;
    assert.equal(undone.textKind, 'point');
    assert.equal(undone.boxWidth, undefined);

    // Rehacer (Redo)
    cm.redo();
    const redone = sm.findNode('text-point') as Text;
    assert.equal(redone.textKind, 'area');
    assert.equal(redone.boxWidth, converted.boxWidth);
  });

  it('2. ConvertTextTypeCommand: convierte de Texto de Área a Texto de Punto convirtiendo líneas suaves en saltos de línea duros', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();

    const initial = sm.findNode('text-area') as Text;
    assert.equal(initial.textKind, 'area');
    assert.equal(initial.boxWidth, 150);

    const cmd = new ConvertTextTypeCommand(sm, 'text-area', 'point');
    cmd.execute();
    cm.recordCommand(cmd);

    const converted = sm.findNode('text-area') as Text;
    assert.equal(converted.textKind, 'point');
    assert.equal(converted.boxWidth, undefined);
    // Debe haber dividido en líneas con '\n'
    assert.ok(converted.text.includes('\n'));

    // Deshacer restaura el texto original sin saltos forzados y restituye boxWidth
    cm.undo();
    const undone = sm.findNode('text-area') as Text;
    assert.equal(undone.textKind, 'area');
    assert.equal(undone.boxWidth, 150);
    assert.equal(undone.text, 'Línea uno larga para probar salto automático de texto en área');
  });

  it('3. ChangeTextCaseCommand: transforma mayúsculas, minúsculas y tipo título con Undo/Redo', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();

    // MAYÚSCULAS
    const cmdUpper = new ChangeTextCaseCommand(sm, 'text-point', 'uppercase');
    cmdUpper.execute();
    cm.recordCommand(cmdUpper);
    assert.equal((sm.findNode('text-point') as Text).text, 'HOLA MUNDO ILLUSTRATOR');

    cm.undo();
    assert.equal((sm.findNode('text-point') as Text).text, 'Hola Mundo Illustrator');

    // minúsculas
    const cmdLower = new ChangeTextCaseCommand(sm, 'text-point', 'lowercase');
    cmdLower.execute();
    cm.recordCommand(cmdLower);
    assert.equal((sm.findNode('text-point') as Text).text, 'hola mundo illustrator');

    // Tipo Título
    const cmdTitle = new ChangeTextCaseCommand(sm, 'text-point', 'titlecase');
    cmdTitle.execute();
    cm.recordCommand(cmdTitle);
    assert.equal((sm.findNode('text-point') as Text).text, 'Hola Mundo Illustrator');
  });

  it('4. InputController: toggleTextKind conmuta interactivamente y registra en CommandManager', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const input = new InputController(canvas, sm, cm);

    sm.setSelection(['text-point']);
    const success = input.toggleTextKind();
    assert.equal(success, true);
    assert.equal((sm.findNode('text-point') as Text).textKind, 'area');
    assert.equal(cm.canUndo(), true);

    // Segundo toggle convierte de nuevo a point
    input.toggleTextKind();
    assert.equal((sm.findNode('text-point') as Text).textKind, 'point');

    cm.undo();
    assert.equal((sm.findNode('text-point') as Text).textKind, 'area');
  });

  it('5. InputController: changeTextCase y fillLoremIpsum operan sobre selección y soportan multi-selección con BatchCommand', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const input = new InputController(canvas, sm, cm);

    // Selección múltiple de ambos textos
    sm.setSelection(['text-point', 'text-area']);
    const successCase = input.changeTextCase('uppercase');
    assert.equal(successCase, true);

    assert.equal((sm.findNode('text-point') as Text).text, 'HOLA MUNDO ILLUSTRATOR');
    assert.ok((sm.findNode('text-area') as Text).text.startsWith('LÍNEA') || (sm.findNode('text-area') as Text).text.startsWith('LINEA'));

    // Debe ser una sola entrada en el historial
    assert.equal(cm.canUndo(), true);
    cm.undo();
    assert.equal((sm.findNode('text-point') as Text).text, 'Hola Mundo Illustrator');

    // fillLoremIpsum
    sm.setSelection(['text-point']);
    input.fillLoremIpsum();
    assert.ok((sm.findNode('text-point') as Text).text.includes('Lorem ipsum'));
  });

  it('6. InputController: applyTextTypography aplica fuentes, tamaños y estilos con Undo/Redo', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const input = new InputController(canvas, sm, cm);

    sm.setSelection(['text-point']);
    input.applyTextTypography({ fontFamily: 'Montserrat', fontSize: 48, fontWeight: 700 });

    const updated = sm.findNode('text-point') as Text;
    assert.equal(updated.fontFamily, 'Montserrat');
    assert.equal(updated.fontSize, 48);
    assert.equal(updated.fontWeight, 700);

    cm.undo();
    const reverted = sm.findNode('text-point') as Text;
    assert.equal(reverted.fontFamily, 'Inter');
    assert.equal(reverted.fontSize, 24);
  });

  it('7. ContextMenuController: sincroniza opciones de conversión punto/área según la figura seleccionada y conmuta al hacer clic', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const input = new InputController(canvas, sm, cm);

    // Configurar elementos de menú contextual en el mock
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
      '#ctx-item-make-clip-mask': new MockElement('ctx-item-make-clip-mask', 'button'),
      '#ctx-item-release-clip-mask': new MockElement('ctx-item-release-clip-mask', 'button'),
      '#ctx-item-outline-stroke': new MockElement('ctx-item-outline-stroke', 'button'),
      '#ctx-divider-text': new MockElement('ctx-divider-text', 'div'),
      '#ctx-item-convert-to-area-text': new MockElement('ctx-item-convert-to-area-text', 'button'),
      '#ctx-item-convert-to-point-text': new MockElement('ctx-item-convert-to-point-text', 'button'),
      '#ctx-item-align': new MockElement('ctx-item-align', 'button'),
      '#ctx-dropdown-align': new MockElement('ctx-dropdown-align', 'div'),
      '#ctx-item-pathfinder': new MockElement('ctx-item-pathfinder', 'button'),
      '#ctx-dropdown-pathfinder': new MockElement('ctx-dropdown-pathfinder', 'div'),
      '#ctx-item-lock': new MockElement('ctx-item-lock', 'button'),
      '#ctx-item-select-all': new MockElement('ctx-item-select-all', 'button'),
      '#ctx-item-delete': new MockElement('ctx-item-delete', 'button'),
    };

    const docMock = {
      querySelector: (sel: string) => elements[sel] || null,
      querySelectorAll: (_sel: string) => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).document = docMock;

    const ctxController = setupContextMenuBindings(input, cm, sm, { canvas });

    // 1. Con text-point seleccionado: debe mostrarse 'Convertir a texto de área'
    sm.setSelection(['text-point']);
    ctxController.syncContextMenu();

    assert.equal(elements['#ctx-divider-text'].hidden, false);
    assert.equal(elements['#ctx-item-convert-to-area-text'].hidden, false);
    assert.equal(elements['#ctx-item-convert-to-area-text'].disabled, false);
    assert.equal(elements['#ctx-item-convert-to-point-text'].hidden, true);
    assert.equal(elements['#ctx-item-convert-to-point-text'].disabled, true);

    // Clic en 'Convertir a texto de área' debe conmutar el texto
    elements['#ctx-item-convert-to-area-text'].click();
    assert.equal((sm.findNode('text-point') as Text).textKind, 'area');

    // 2. Ahora que es area text, syncContextMenu debe ofrecer 'Convertir a texto de punto'
    ctxController.syncContextMenu();
    assert.equal(elements['#ctx-item-convert-to-area-text'].hidden, true);
    assert.equal(elements['#ctx-item-convert-to-area-text'].disabled, true);
    assert.equal(elements['#ctx-item-convert-to-point-text'].hidden, false);
    assert.equal(elements['#ctx-item-convert-to-point-text'].disabled, false);

    // Clic en 'Convertir a texto de punto'
    elements['#ctx-item-convert-to-point-text'].click();
    assert.equal((sm.findNode('text-point') as Text).textKind, 'point');

    // 3. Sin selección: la sección de texto debe ocultarse
    sm.setSelection([]);
    ctxController.syncContextMenu();
    assert.equal(elements['#ctx-divider-text'].hidden, true);
    assert.equal(elements['#ctx-item-convert-to-area-text'].hidden, true);
    assert.equal(elements['#ctx-item-convert-to-point-text'].hidden, true);

    ctxController.cleanup();
  });

  it('8. MenuBarController: sincroniza el menú Texto y ejecuta acciones de fuente, tamaño, estilo, alineación, mayúsculas y texto falso', () => {
    const doc = createSampleDocument();
    const sm = new StateManager(doc);
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const input = new InputController(canvas, sm, cm);
    const viewportManager = new ViewportManager();

    // Configurar elementos de la barra de menú
    const elements: Record<string, MockElement> = {
      '#viewport-canvas': new MockElement('viewport-canvas', 'canvas'),
      '.menu-bar': new MockElement('menu-bar', 'nav'),
      '#menu-btn-file': new MockElement('menu-btn-file', 'button'),
      '#menu-btn-edit': new MockElement('menu-btn-edit', 'button'),
      '#menu-btn-object': new MockElement('menu-btn-object', 'button'),
      '#menu-btn-type': new MockElement('menu-btn-type', 'button'),
      '#menu-btn-view': new MockElement('menu-btn-view', 'button'),
      '#menu-btn-help': new MockElement('menu-btn-help', 'button'),

      '#menu-dropdown-file': new MockElement('menu-dropdown-file', 'div'),
      '#menu-dropdown-edit': new MockElement('menu-dropdown-edit', 'div'),
      '#menu-dropdown-object': new MockElement('menu-dropdown-object', 'div'),
      '#menu-dropdown-type': new MockElement('menu-dropdown-type', 'div'),
      '#menu-dropdown-view': new MockElement('menu-dropdown-view', 'div'),
      '#menu-dropdown-help': new MockElement('menu-dropdown-help', 'div'),

      '#menu-item-new': new MockElement('menu-item-new', 'button'),
      '#menu-item-open': new MockElement('menu-item-open', 'button'),
      '#menu-item-save-json': new MockElement('menu-item-save-json', 'button'),
      '#menu-item-place': new MockElement('menu-item-place', 'button'),
      '#menu-item-export-modal': new MockElement('menu-item-export-modal', 'button'),
      '#menu-item-undo': new MockElement('menu-item-undo', 'button'),
      '#menu-item-redo': new MockElement('menu-item-redo', 'button'),
      '#menu-item-cut': new MockElement('menu-item-cut', 'button'),
      '#menu-item-copy': new MockElement('menu-item-copy', 'button'),
      '#menu-item-paste': new MockElement('menu-item-paste', 'button'),
      '#menu-item-duplicate': new MockElement('menu-item-duplicate', 'button'),
      '#menu-item-delete': new MockElement('menu-item-delete', 'button'),
      '#menu-item-bring-to-front': new MockElement('menu-item-bring-to-front', 'button'),
      '#menu-item-send-to-back': new MockElement('menu-item-send-to-back', 'button'),
      '#menu-item-group': new MockElement('menu-item-group', 'button'),
      '#menu-item-ungroup': new MockElement('menu-item-ungroup', 'button'),
      '#menu-item-make-clip-mask': new MockElement('menu-item-make-clip-mask', 'button'),
      '#menu-item-release-clip-mask': new MockElement('menu-item-release-clip-mask', 'button'),
      '#menu-item-outline-stroke': new MockElement('menu-item-outline-stroke', 'button'),
      '#menu-item-align': new MockElement('menu-item-align', 'button'),
      '#menu-dropdown-align': new MockElement('menu-dropdown-align', 'div'),
      '#menu-item-distribute': new MockElement('menu-item-distribute', 'button'),
      '#menu-dropdown-distribute': new MockElement('menu-dropdown-distribute', 'div'),
      '#menu-item-pathfinder': new MockElement('menu-item-pathfinder', 'button'),
      '#menu-dropdown-pathfinder': new MockElement('menu-dropdown-pathfinder', 'div'),
      '#menu-item-rulers': new MockElement('menu-item-rulers', 'button'),
      '#menu-item-guides': new MockElement('menu-item-guides', 'button'),
      '#menu-dropdown-guides': new MockElement('menu-dropdown-guides', 'div'),
      '#menu-item-zoom-in': new MockElement('menu-item-zoom-in', 'button'),
      '#menu-item-zoom-out': new MockElement('menu-item-zoom-out', 'button'),
      '#menu-item-zoom-fit': new MockElement('menu-item-zoom-fit', 'button'),
      '#menu-item-zoom-100': new MockElement('menu-item-zoom-100', 'button'),
      '#menu-item-smart-guides': new MockElement('menu-item-smart-guides', 'button'),
      '#menu-item-shortcuts': new MockElement('menu-item-shortcuts', 'button'),
      '#menu-item-about': new MockElement('menu-item-about', 'button'),
      '#btn-about-brand': new MockElement('btn-about-brand', 'button'),

      // Type submenus
      '#menu-item-type-font': new MockElement('menu-item-type-font', 'button'),
      '#menu-dropdown-type-font': new MockElement('menu-dropdown-type-font', 'div'),
      '#menu-item-type-size': new MockElement('menu-item-type-size', 'button'),
      '#menu-dropdown-type-size': new MockElement('menu-dropdown-type-size', 'div'),
      '#menu-item-type-style': new MockElement('menu-item-type-style', 'button'),
      '#menu-dropdown-type-style': new MockElement('menu-dropdown-type-style', 'div'),
      '#menu-item-type-style-regular': new MockElement('menu-item-type-style-regular', 'button'),
      '#menu-item-type-style-bold': new MockElement('menu-item-type-style-bold', 'button'),
      '#menu-item-type-style-italic': new MockElement('menu-item-type-style-italic', 'button'),
      '#menu-item-type-align': new MockElement('menu-item-type-align', 'button'),
      '#menu-dropdown-type-align': new MockElement('menu-dropdown-type-align', 'div'),
      '#menu-item-type-align-left': new MockElement('menu-item-type-align-left', 'button'),
      '#menu-item-type-align-center': new MockElement('menu-item-type-align-center', 'button'),
      '#menu-item-type-align-right': new MockElement('menu-item-type-align-right', 'button'),
      '#menu-item-type-toggle-kind': new MockElement('menu-item-type-toggle-kind', 'button'),
      '#menu-item-type-casing': new MockElement('menu-item-type-casing', 'button'),
      '#menu-dropdown-type-casing': new MockElement('menu-dropdown-type-casing', 'div'),
      '#menu-item-type-uppercase': new MockElement('menu-item-type-uppercase', 'button'),
      '#menu-item-type-lowercase': new MockElement('menu-item-type-lowercase', 'button'),
      '#menu-item-type-titlecase': new MockElement('menu-item-type-titlecase', 'button'),
      '#menu-item-type-lorem': new MockElement('menu-item-type-lorem', 'button'),
    };

    const toggleKindLabel = new MockElement('', 'span');
    toggleKindLabel.classList.add('menu-item-label');
    toggleKindLabel.textContent = 'Convertir a texto de área';
    elements['#menu-item-type-toggle-kind'].appendChild(toggleKindLabel);

    // Opciones de fuente y tamaño
    const fontRoboto = new MockElement('opt-font-roboto', 'button');
    fontRoboto.classList.add('menu-item-type-font-opt');
    fontRoboto.setAttribute('data-font', 'Roboto');
    elements['#menu-dropdown-type-font'].appendChild(fontRoboto);

    const size32 = new MockElement('opt-size-32', 'button');
    size32.classList.add('menu-item-type-size-opt');
    size32.setAttribute('data-size', '32');
    elements['#menu-dropdown-type-size'].appendChild(size32);

    const docMock = {
      querySelector: (sel: string) => elements[sel] || null,
      querySelectorAll: (sel: string) => {
        if (sel === '.menu-item-type-font-opt') return [fontRoboto];
        if (sel === '.menu-item-type-size-opt') return [size32];
        return [];
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).document = docMock;

    const menuBarController = setupMenuBarBindings(input, cm, sm, {
      viewportManager,
      canvas,
    });

    // 1. Sin selección: menú Texto deshabilitado
    sm.setSelection([]);
    menuBarController.syncMenuItems();
    assert.equal(elements['#menu-btn-type'].disabled, true);

    // 2. Con selección de texto: menú Texto habilitado y label de conversión es 'Convertir a texto de área'
    sm.setSelection(['text-point']);
    menuBarController.syncMenuItems();
    assert.equal(elements['#menu-btn-type'].disabled, false);
    assert.equal(toggleKindLabel.textContent, 'Convertir a texto de área');

    // Clic en Negrita (Bold)
    elements['#menu-item-type-style-bold'].click();
    assert.equal((sm.findNode('text-point') as Text).fontWeight, 700);

    // Clic en Fuente Roboto
    fontRoboto.click();
    assert.equal((sm.findNode('text-point') as Text).fontFamily, 'Roboto');

    // Clic en Tamaño 32
    size32.click();
    assert.equal((sm.findNode('text-point') as Text).fontSize, 32);

    // Clic en Alinear a la derecha
    elements['#menu-item-type-align-right'].click();
    assert.equal((sm.findNode('text-point') as Text).textAlign, 'right');

    // Clic en Convertir a texto de área
    elements['#menu-item-type-toggle-kind'].click();
    assert.equal((sm.findNode('text-point') as Text).textKind, 'area');

    // Sync actualiza el label a 'Convertir a texto de punto'
    menuBarController.syncMenuItems();
    assert.equal(toggleKindLabel.textContent, 'Convertir a texto de punto');

    // Clic en MAYÚSCULAS
    elements['#menu-item-type-uppercase'].click();
    assert.equal((sm.findNode('text-point') as Text).text, 'HOLA MUNDO ILLUSTRATOR');

    // Clic en Llenar con texto falso
    elements['#menu-item-type-lorem'].click();
    assert.ok((sm.findNode('text-point') as Text).text.includes('Lorem ipsum'));

    menuBarController.cleanup();
  });
});

