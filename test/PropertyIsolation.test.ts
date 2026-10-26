import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { setupPropertiesPanelBindings } from '../src/ui/PropertiesPanelController.ts';
import type { Rectangle, Text, Polygon } from '../src/types/scene-graph.ts';

class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public placeholder: string = '';
  public innerHTML: string = '';
  public open: boolean = true;
  public checked: boolean = false;
  public indeterminate: boolean = false;
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

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) e.stopPropagation = () => {};
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.target) e.target = this;
    e.currentTarget = this;
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }
}

function setupMockDOM(): {
  domMap: Record<string, MockElement>;
  cleanupGlobal: () => void;
} {
  const domMap: Record<string, MockElement> = {};

  const getOrCreate = (id: string, tag: string = 'div') => {
    if (!domMap[id]) {
      domMap[id] = new MockElement(id, tag);
    }
    return domMap[id];
  };

  const neededIds = [
    'selection-state',
    'no-selection-state',
    'panel-title',
    'section-appearance',
    'section-dimensions',
    'section-artboard',
    'section-actions',
    'section-typography',
    'section-parametric',
    'group-corner-radius',
    'input-corner-radius',
    'input-obj-x',
    'input-obj-y',
    'input-obj-w',
    'input-obj-h',
    'input-obj-rot',
    'input-fill-color',
    'input-fill-hex',
    'swatch-fill-preview',
    'btn-fill-none',
    'input-stroke-color',
    'input-stroke-hex',
    'swatch-stroke-preview',
    'btn-stroke-none',
    'input-stroke-width',
    'input-stroke-dash',
    'select-stroke-cap',
    'select-stroke-join',
    'input-opacity',
    'input-opacity-val',
    'select-blend-mode',
    'check-drop-shadow',
    'group-drop-shadow-controls',
    'input-shadow-color',
    'input-shadow-hex',
    'swatch-shadow-preview',
    'input-shadow-opacity',
    'input-shadow-opacity-val',
    'input-shadow-offset-x',
    'input-shadow-offset-y',
    'input-shadow-blur',
    'textarea-text-content',
    'select-font-family',
    'input-text-size',
    'input-line-height',
    'input-letter-spacing',
    'select-font-weight',
    'select-font-style',
    'select-text-align',
    'btn-align-left',
    'btn-align-center',
    'btn-align-right',
    'input-text-color',
    'input-text-color-hex',
    'swatch-text-preview',
    'btn-text-color-none',
    'group-polygon-controls',
    'input-polygon-sides',
    'input-polygon-radius',
    'group-star-controls',
    'input-star-points',
    'input-star-outer-radius',
    'input-star-inner-radius',
    'btn-delete-selection',
    'btn-duplicate-selection',
  ];

  for (const id of neededIds) {
    getOrCreate(id);
  }

  const oldDoc = (globalThis as any).document;
  (globalThis as any).document = {
    getElementById: (id: string) => domMap[id] ?? null,
    querySelector: (sel: string) => {
      const cleanId = sel.replace(/^#/, '');
      return domMap[cleanId] ?? null;
    },
    querySelectorAll: (_sel: string) => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    domMap,
    cleanupGlobal: () => {
      (globalThis as any).document = oldDoc;
    },
  };
}

describe('Property Isolation when Switching Selection', () => {
  let cleanupDOM: () => void;

  afterEach(() => {
    if (cleanupDOM) cleanupDOM();
  });

  it('stroke width edit on Shape 1 does not leak to Shape 2 when selection changes before commit', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const shape1: Rectangle = {
      id: 'rect1',
      name: 'rect1',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      strokeWidth: 2,
      fill: '#111111',
      stroke: '#000000',
    };
    const shape2: Rectangle = {
      id: 'rect2',
      name: 'rect2',
      type: 'rectangle',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      strokeWidth: 10,
      fill: '#222222',
      stroke: '#000000',
    };

    state.addNode(state.getActiveLayer()!.id, shape1);
    state.addNode(state.getActiveLayer()!.id, shape2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    // 1. Select shape1
    state.setSelection(['rect1']);
    controller.syncPropertiesPanel();

    const strokeInput = domMap['input-stroke-width'];
    assert.equal(strokeInput.value, '2');

    // 2. Focus stroke input on shape1 (user starts editing)
    strokeInput.dispatchEvent({ type: 'focus' });
    strokeInput.value = '50';

    // 3. User clicks on shape2 (selection changes to rect2)
    state.setSelection(['rect2']);
    controller.syncPropertiesPanel();

    // 4. Stale change/blur event fires on stroke input with the old value '50'
    strokeInput.dispatchEvent({ type: 'change' });

    // Assert: rect2 MUST retain its original strokeWidth (10), not 50!
    const updatedShape2 = state.findNode('rect2') as Rectangle;
    assert.equal(updatedShape2.strokeWidth, 10, 'rect2 strokeWidth must not be modified by stale edit from rect1');

    controller.cleanup();
  });

  it('fill hex edit on Shape 1 does not leak to Shape 2 when selection changes', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const shape1: Rectangle = {
      id: 'rect1',
      name: 'rect1',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      fill: '#111111',
    };
    const shape2: Rectangle = {
      id: 'rect2',
      name: 'rect2',
      type: 'rectangle',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      fill: '#222222',
    };

    state.addNode(state.getActiveLayer()!.id, shape1);
    state.addNode(state.getActiveLayer()!.id, shape2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    state.setSelection(['rect1']);
    controller.syncPropertiesPanel();

    const fillHexInput = domMap['input-fill-hex'];
    fillHexInput.dispatchEvent({ type: 'focus' });
    fillHexInput.value = '#ff0000';

    // Switch selection to rect2
    state.setSelection(['rect2']);
    controller.syncPropertiesPanel();

    // Stale change event on input-fill-hex
    fillHexInput.dispatchEvent({ type: 'change' });

    const updatedShape2 = state.findNode('rect2') as Rectangle;
    assert.equal(updatedShape2.fill, '#222222', 'rect2 fill must remain #222222');

    controller.cleanup();
  });

  it('transform geometry edit on Shape 1 does not leak to Shape 2', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const shape1: Rectangle = {
      id: 'rect1',
      name: 'rect1',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    };
    const shape2: Rectangle = {
      id: 'rect2',
      name: 'rect2',
      type: 'rectangle',
      x: 100,
      y: 200,
      width: 80,
      height: 80,
    };

    state.addNode(state.getActiveLayer()!.id, shape1);
    state.addNode(state.getActiveLayer()!.id, shape2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    state.setSelection(['rect1']);
    controller.syncPropertiesPanel();

    const xInput = domMap['input-obj-x'];
    xInput.dispatchEvent({ type: 'focus' });
    xInput.value = '999';

    // Switch to rect2
    state.setSelection(['rect2']);
    controller.syncPropertiesPanel();

    // Stale change event
    xInput.dispatchEvent({ type: 'change' });

    const updatedShape2 = state.findNode('rect2') as Rectangle;
    assert.equal(updatedShape2.x, 100, 'rect2 X position must remain 100');

    controller.cleanup();
  });

  it('typography edit on Text 1 does not leak to Text 2', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const text1: Text = {
      id: 'text1',
      name: 'text1',
      type: 'text',
      x: 10,
      y: 10,
      text: 'Hello',
      fontFamily: 'Inter',
      fontSize: 16,
    };
    const text2: Text = {
      id: 'text2',
      name: 'text2',
      type: 'text',
      x: 50,
      y: 50,
      text: 'World',
      fontFamily: 'Roboto',
      fontSize: 32,
    };

    state.addNode(state.getActiveLayer()!.id, text1);
    state.addNode(state.getActiveLayer()!.id, text2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    state.setSelection(['text1']);
    controller.syncPropertiesPanel();

    const fontSizeInput = domMap['input-text-size'];
    fontSizeInput.dispatchEvent({ type: 'focus' });
    fontSizeInput.value = '72';

    // Switch selection to text2
    state.setSelection(['text2']);
    controller.syncPropertiesPanel();

    // Stale change event
    fontSizeInput.dispatchEvent({ type: 'change' });

    const updatedText2 = state.findNode('text2') as Text;
    assert.equal(updatedText2.fontSize, 32, 'text2 fontSize must remain 32');

    controller.cleanup();
  });

  it('parametric sides edit on Polygon 1 does not leak to Polygon 2', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const poly1: Polygon = {
      id: 'poly1',
      name: 'poly1',
      type: 'polygon',
      x: 10,
      y: 10,
      sides: 5,
      radius: 50,
    };
    const poly2: Polygon = {
      id: 'poly2',
      name: 'poly2',
      type: 'polygon',
      x: 100,
      y: 100,
      sides: 8,
      radius: 60,
    };

    state.addNode(state.getActiveLayer()!.id, poly1);
    state.addNode(state.getActiveLayer()!.id, poly2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    state.setSelection(['poly1']);
    controller.syncPropertiesPanel();

    const sidesInput = domMap['input-polygon-sides'];
    sidesInput.dispatchEvent({ type: 'focus' });
    sidesInput.value = '16';

    // Switch selection to poly2
    state.setSelection(['poly2']);
    controller.syncPropertiesPanel();

    // Stale change event
    sidesInput.dispatchEvent({ type: 'change' });

    const updatedPoly2 = state.findNode('poly2') as Polygon;
    assert.equal(updatedPoly2.sides, 8, 'poly2 sides must remain 8');

    controller.cleanup();
  });

  it('corner radius edit on Rectangle 1 does not leak to Rectangle 2', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const rect1: Rectangle = {
      id: 'rect1',
      name: 'rect1',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      cornerRadius: 5,
    };
    const rect2: Rectangle = {
      id: 'rect2',
      name: 'rect2',
      type: 'rectangle',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
    };

    state.addNode(state.getActiveLayer()!.id, rect1);
    state.addNode(state.getActiveLayer()!.id, rect2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    state.setSelection(['rect1']);
    controller.syncPropertiesPanel();

    const crInput = domMap['input-corner-radius'];
    crInput.dispatchEvent({ type: 'focus' });
    crInput.value = '35';

    // Switch selection to rect2
    state.setSelection(['rect2']);
    controller.syncPropertiesPanel();

    // Stale change event
    crInput.dispatchEvent({ type: 'change' });

    const updatedRect2 = state.findNode('rect2') as Rectangle;
    assert.equal(updatedRect2.cornerRadius ?? 0, 0, 'rect2 cornerRadius must remain 0/undefined');

    controller.cleanup();
  });

  it('drop shadow edit on Shape 1 does not leak to Shape 2', () => {
    const { domMap, cleanupGlobal } = setupMockDOM();
    cleanupDOM = cleanupGlobal;

    const state = new StateManager();
    const cmd = new CommandManager();

    const shape1: Rectangle = {
      id: 'rect1',
      name: 'rect1',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      dropShadow: { color: '#000000', opacity: 0.5, offsetX: 2, offsetY: 4, blur: 8 },
    };
    const shape2: Rectangle = {
      id: 'rect2',
      name: 'rect2',
      type: 'rectangle',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
    };

    state.addNode(state.getActiveLayer()!.id, shape1);
    state.addNode(state.getActiveLayer()!.id, shape2);

    const controller = setupPropertiesPanelBindings({
      stateManager: state,
      commandManager: cmd,
      inputController: {} as any,
      canvas: new MockElement('canvas', 'canvas') as any,
    });

    state.setSelection(['rect1']);
    controller.syncPropertiesPanel();

    const blurInput = domMap['input-shadow-blur'];
    blurInput.dispatchEvent({ type: 'focus' });
    blurInput.value = '50';

    // Switch selection to shape2
    state.setSelection(['rect2']);
    controller.syncPropertiesPanel();

    // Stale change event
    blurInput.dispatchEvent({ type: 'change' });

    const updatedRect2 = state.findNode('rect2') as Rectangle;
    assert.equal(updatedRect2.dropShadow ?? null, null, 'rect2 must not acquire drop shadow from rect1');

    controller.cleanup();
  });
});
