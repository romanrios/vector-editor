import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle, Path } from '../src/types/scene-graph.ts';

class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public placeholder: string = '';
  public open: boolean = true;
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

  public click(): void {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) {
      e.stopPropagation = () => {};
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

function createMockCanvas(): any {
  return {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

describe('Reorganización de paneles: Trazo independiente y Contornear trazado en Acciones', () => {
  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).sessionStorage;
  });

  it('1. Estructura de index.html: Apariencia ya no contiene Trazo, Remate, Esquinas ni Contornear trazado', () => {
    const htmlPath = path.resolve('index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Extraer sección Apariencia
    const appearanceMatch = html.match(/<details[^>]*id="section-appearance"[^>]*>([\s\S]*?)<\/details>/);
    assert.ok(appearanceMatch, 'Debe existir section-appearance');
    const appearanceHtml = appearanceMatch[1];

    assert.equal(appearanceHtml.includes('select-stroke-dash'), false, 'Apariencia no debe tener select-stroke-dash');
    assert.equal(appearanceHtml.includes('select-stroke-cap'), false, 'Apariencia no debe tener select-stroke-cap');
    assert.equal(appearanceHtml.includes('select-stroke-join'), false, 'Apariencia no debe tener select-stroke-join');
    assert.equal(appearanceHtml.includes('btn-outline-stroke'), false, 'Apariencia no debe tener btn-outline-stroke');

    // Mantiene Relleno, Borde, Grosor y Opacidad
    assert.ok(appearanceHtml.includes('select-fill-mode'), 'Apariencia debe conservar Relleno');
    assert.ok(appearanceHtml.includes('input-stroke-hex'), 'Apariencia debe conservar Borde');
    assert.ok(appearanceHtml.includes('input-stroke-width'), 'Apariencia debe conservar Grosor');
    assert.ok(appearanceHtml.includes('input-opacity'), 'Apariencia debe conservar Opacidad');
  });

  it('2. Estructura de index.html: Contornear trazado está reubicado en el panel Acciones', () => {
    const htmlPath = path.resolve('index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Extraer sección Acciones
    const actionsMatch = html.match(/<details[^>]*id="section-actions"[^>]*>([\s\S]*?)<\/details>/);
    assert.ok(actionsMatch, 'Debe existir section-actions');
    const actionsHtml = actionsMatch[1];

    assert.ok(actionsHtml.includes('id="btn-duplicate"'), 'Acciones debe contener botón Duplicar');
    assert.ok(actionsHtml.includes('id="btn-delete-selection"'), 'Acciones debe contener botón Eliminar');
    assert.ok(actionsHtml.includes('id="btn-outline-stroke"'), 'Acciones debe contener botón Contornear trazado');
    assert.ok(actionsHtml.includes('Contornear trazado'), 'Acciones debe mostrar el texto "Contornear trazado"');
  });

  it('3. Estructura de index.html: Nuevo panel Trazo ubicado abajo de todos los otros paneles', () => {
    const htmlPath = path.resolve('index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Extraer nuevo panel section-stroke
    const strokeMatch = html.match(/<details[^>]*id="section-stroke"[^>]*>([\s\S]*?)<\/details>/);
    assert.ok(strokeMatch, 'Debe existir section-stroke');
    const strokeHtml = strokeMatch[1];

    // Contiene Trazo, Remate y Esquinas
    assert.ok(strokeHtml.includes('id="select-stroke-dash"'), 'Trazo debe contener select-stroke-dash');
    assert.ok(strokeHtml.includes('id="select-stroke-cap"'), 'Trazo debe contener select-stroke-cap');
    assert.ok(strokeHtml.includes('id="select-stroke-join"'), 'Trazo debe contener select-stroke-join');
    assert.ok(strokeHtml.includes('Trazo</span>'), 'El encabezado debe llamarse Trazo');

    // Debe estar ubicado después de section-actions (abajo de todos los otros)
    const actionsPos = html.indexOf('id="section-actions"');
    const strokePos = html.indexOf('id="section-stroke"');
    assert.ok(actionsPos > 0 && strokePos > 0, 'Ambas secciones deben existir');
    assert.ok(strokePos > actionsPos, 'section-stroke debe estar ubicado abajo de section-actions');
  });

  it('4. Funcionalidad interactiva: Cambiar Trazo, Remate y Esquinas desde el nuevo panel actualiza la figura y registra Undo/Redo', () => {
    const mockStorage: Record<string, string> = {};
    const elements: Record<string, MockElement> = {
      '#status-tool-label': new MockElement('status-tool-label', 'span'),
      '#status-shapes-count': new MockElement('status-shapes-count', 'span'),
      '#status-selection-info': new MockElement('status-selection-info', 'span'),
      '#status-selection-separator': new MockElement('status-selection-separator', 'span'),
      '#no-selection-state': new MockElement('no-selection-state', 'div'),
      '#selection-state': new MockElement('selection-state', 'div'),
      '#section-appearance': new MockElement('section-appearance', 'details'),
      '#section-actions': new MockElement('section-actions', 'details'),
      '#section-stroke': new MockElement('section-stroke', 'details'),
      '#select-stroke-dash': new MockElement('select-stroke-dash', 'select'),
      '#select-stroke-cap': new MockElement('select-stroke-cap', 'select'),
      '#select-stroke-join': new MockElement('select-stroke-join', 'select'),
      '#btn-outline-stroke': new MockElement('btn-outline-stroke', 'button'),
      '#btn-duplicate': new MockElement('btn-duplicate', 'button'),
      '#btn-delete-selection': new MockElement('btn-delete-selection', 'button'),
    };

    const collapsible = [
      elements['#section-appearance'],
      elements['#section-actions'],
      elements['#section-stroke'],
    ];

    (globalThis as any).sessionStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { for (const k of Object.keys(mockStorage)) delete mockStorage[k]; },
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => elements[sel] ?? null,
      querySelectorAll: (sel: string) => (sel === '.collapsible-section' ? collapsible : []),
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Añadir una figura de prueba
    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-stroke-test',
      type: 'rectangle',
      name: 'Rectángulo Trazo',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      stroke: '#000000',
      strokeWidth: 4,
    };
    stateManager.addShape(layerId, rect);
    stateManager.selectNode(rect.id);

    // 1. Modificar Trazo a discontinuo (dashed)
    elements['#select-stroke-dash'].value = 'dashed';
    elements['#select-stroke-dash'].dispatchEvent({ type: 'change' });
    let shape = stateManager.findNode('rect-stroke-test') as Rectangle;
    assert.deepEqual(shape.strokeDashArray, [6, 6]);
    assert.equal(commandManager.undoCount, 1);

    // 2. Modificar Remate a redondeado (round)
    elements['#select-stroke-cap'].value = 'round';
    elements['#select-stroke-cap'].dispatchEvent({ type: 'change' });
    shape = stateManager.findNode('rect-stroke-test') as Rectangle;
    assert.equal(shape.strokeLineCap, 'round');
    assert.equal(commandManager.undoCount, 2);

    // 3. Modificar Esquinas a redondeada (round)
    elements['#select-stroke-join'].value = 'round';
    elements['#select-stroke-join'].dispatchEvent({ type: 'change' });
    shape = stateManager.findNode('rect-stroke-test') as Rectangle;
    assert.equal(shape.strokeLineJoin, 'round');
    assert.equal(commandManager.undoCount, 3);

    // 4. Undo revierte las modificaciones paso a paso
    commandManager.undo();
    shape = stateManager.findNode('rect-stroke-test') as Rectangle;
    assert.notEqual(shape.strokeLineJoin, 'round');

    // 5. Persistencia del panel Trazo en sessionStorage
    elements['#section-stroke'].open = false;
    elements['#section-stroke'].dispatchEvent({ type: 'toggle' });
    assert.equal(mockStorage['panel-section-section-stroke'], 'false');

    elements['#section-stroke'].open = true;
    elements['#section-stroke'].dispatchEvent({ type: 'toggle' });
    assert.equal(mockStorage['panel-section-section-stroke'], 'true');

    cleanup();
  });

  it('5. Funcionalidad interactiva: El botón Contornear trazado en el panel Acciones convierte el borde en trazado', () => {
    const elements: Record<string, MockElement> = {
      '#status-tool-label': new MockElement('status-tool-label', 'span'),
      '#status-shapes-count': new MockElement('status-shapes-count', 'span'),
      '#status-selection-info': new MockElement('status-selection-info', 'span'),
      '#status-selection-separator': new MockElement('status-selection-separator', 'span'),
      '#no-selection-state': new MockElement('no-selection-state', 'div'),
      '#selection-state': new MockElement('selection-state', 'div'),
      '#section-appearance': new MockElement('section-appearance', 'details'),
      '#section-actions': new MockElement('section-actions', 'details'),
      '#section-stroke': new MockElement('section-stroke', 'details'),
      '#select-stroke-dash': new MockElement('select-stroke-dash', 'select'),
      '#select-stroke-cap': new MockElement('select-stroke-cap', 'select'),
      '#select-stroke-join': new MockElement('select-stroke-join', 'select'),
      '#btn-outline-stroke': new MockElement('btn-outline-stroke', 'button'),
      '#btn-duplicate': new MockElement('btn-duplicate', 'button'),
      '#btn-delete-selection': new MockElement('btn-delete-selection', 'button'),
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => elements[sel] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    const layerId = stateManager.getState().children[0].id;
    const pathNode: Path = {
      id: 'path-outline-test',
      type: 'path',
      name: 'Trazado abierto',
      x: 0,
      y: 0,
      closed: false,
      points: [{ x: 10, y: 10 }, { x: 90, y: 10 }],
      stroke: '#ff0000',
      strokeWidth: 6,
    };
    stateManager.addShape(layerId, pathNode);
    stateManager.selectNode(pathNode.id);

    // Verificar que btn-outline-stroke está habilitado
    assert.equal(elements['#btn-outline-stroke'].disabled, false);
    assert.equal(elements['#btn-outline-stroke'].getAttribute('aria-disabled'), 'false');

    // Clic en Contornear trazado
    elements['#btn-outline-stroke'].click();

    // Se convirtió en un trazado cerrado con fill y sin stroke
    const newSelectedId = stateManager.getSelection()[0];
    assert.ok(newSelectedId, 'Debe haber un nodo seleccionado tras contornear');
    const outlinedNode = stateManager.findNode(newSelectedId) as Path;
    assert.ok(outlinedNode, 'El nodo contorneado debe existir');
    assert.equal(outlinedNode.closed, true, 'El trazado contorneado debe ser cerrado');
    assert.equal(outlinedNode.fill, '#ff0000', 'El fill debe recibir el color del borde original');
    assert.equal(outlinedNode.stroke, 'none', 'El trazo debe convertirse en none');
    assert.equal(commandManager.undoCount, 1, 'Debe registrar un comando en el historial');

    // Deshacer revierte al trazado original abierto
    commandManager.undo();
    const revertedNode = stateManager.findNode('path-outline-test') as Path;
    assert.ok(revertedNode, 'El nodo original debe reaparecer al deshacer');
    assert.equal(revertedNode.closed, false);
    assert.equal(revertedNode.stroke, '#ff0000');

    cleanup();
  });
});
