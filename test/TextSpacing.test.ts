import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { serializeDocument, parseDocument, DocumentParseError } from '../src/state/Serializer.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { setupPropertiesPanelBindings } from '../src/ui/PropertiesPanelController.ts';
import {
  getTextLineHeight,
  measureSingleLineTextWidth,
  measureTextWidth,
  getTextBaseAABB,
  getWrappedTextLines,
  getTextIndexAtPosition,
} from '../src/utils/geometry.ts';
import { scaleShapesAboutAnchor } from '../src/utils/transform.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { renderDocumentToCanvas } from '../src/utils/exportRaster.ts';
import type { Text, Document } from '../src/types/scene-graph.ts';

// Helper de simulación de elementos DOM para probar el panel de propiedades
class MockElement {
  public id: string;
  public tagName: string;
  public value: string = '';
  public placeholder: string = '';
  public textContent: string = '';
  public style: Record<string, string> = {};
  public classList = {
    classes: new Set<string>(),
    add: (c: string) => this.classList.classes.add(c),
    remove: (c: string) => this.classList.classes.delete(c),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined) {
        if (this.classList.classes.has(c)) this.classList.classes.delete(c);
        else this.classList.classes.add(c);
      } else if (force) {
        this.classList.classes.add(c);
      } else {
        this.classList.classes.delete(c);
      }
      return this.classList.classes.has(c);
    },
    contains: (c: string) => this.classList.classes.has(c),
  };
  public attributes: Record<string, string> = {};
  private listeners: Record<string, ((e: any) => void)[]> = {};

  constructor(id: string, tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  public addEventListener(event: string, cb: (e: any) => void): void {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  }

  public removeEventListener(event: string, cb: (e: any) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((fn) => fn !== cb);
  }

  public dispatch(event: string, eventData: any = {}): void {
    const handlers = this.listeners[event] || [];
    for (const h of handlers) {
      h({ target: this, ...eventData });
    }
  }
}

function createMockTextNode(overrides?: Partial<Text>): Text {
  return {
    id: 'text-1',
    name: 'Text 1',
    type: 'text',
    x: 100,
    y: 150,
    text: 'Hola Mundo',
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: 400,
    fontStyle: 'normal',
    textAlign: 'left',
    fill: '#000000',
    ...overrides,
  };
}

function createMockDocument(children: Text[]): Document {
  return {
    id: 'doc-1',
    name: 'Document',
    type: 'document',
    width: 800,
    height: 600,
    children: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        type: 'layer',
        visible: true,
        locked: false,
        children,
      },
    ],
  };
}

describe('Text Spacing: Line Height (Leading) e Interletrado (Tracking / Letter Spacing)', () => {
  describe('1. Modelo de Datos y Serialización', () => {
    it('soporta lineHeight y letterSpacing en nodos Text', () => {
      const text = createMockTextNode({
        lineHeight: 28,
        letterSpacing: 2.5,
      });

      assert.equal(text.lineHeight, 28);
      assert.equal(text.letterSpacing, 2.5);
      assert.equal(getTextLineHeight(text), 28);
    });

    it('serializa y restaura correctamente lineHeight y letterSpacing', async () => {
      const doc = createMockDocument([
        createMockTextNode({
          lineHeight: 32,
          letterSpacing: -1.5,
        }),
      ]);

      const json = serializeDocument(doc);
      const restored = await parseDocument(json);
      const restoredText = restored.children[0].children[0] as Text;

      assert.equal(restoredText.lineHeight, 32);
      assert.equal(restoredText.letterSpacing, -1.5);
    });

    it('valida que lineHeight sea un número finito positivo', async () => {
      const invalidJsonZero = JSON.stringify(
        createMockDocument([{ ...createMockTextNode(), lineHeight: 0 }])
      );
      await assert.rejects(async () => parseDocument(invalidJsonZero), DocumentParseError);

      const invalidJsonNeg = JSON.stringify(
        createMockDocument([{ ...createMockTextNode(), lineHeight: -10 }])
      );
      await assert.rejects(async () => parseDocument(invalidJsonNeg), DocumentParseError);
    });

    it('valida que letterSpacing sea un número finito (admite negativos, cero y positivos)', async () => {
      const validZero = JSON.stringify(
        createMockDocument([{ ...createMockTextNode(), letterSpacing: 0 }])
      );
      await assert.doesNotReject(async () => parseDocument(validZero));

      const validNeg = JSON.stringify(
        createMockDocument([{ ...createMockTextNode(), letterSpacing: -3.5 }])
      );
      await assert.doesNotReject(async () => parseDocument(validNeg));

      const invalidNaN = JSON.stringify(
        createMockDocument([{ ...createMockTextNode(), letterSpacing: 'invalido' as any }])
      );
      await assert.rejects(async () => parseDocument(invalidNaN), DocumentParseError);
    });
  });

  describe('2. Métricas y Geometría Tipográfica', () => {
    it('measureSingleLineTextWidth incrementa el ancho con letterSpacing positivo', () => {
      const baseText = createMockTextNode({ text: 'ABCDE', fontSize: 20 });
      const spacedText = createMockTextNode({ text: 'ABCDE', fontSize: 20, letterSpacing: 5 });

      const baseWidth = measureSingleLineTextWidth(baseText, 'ABCDE');
      const spacedWidth = measureSingleLineTextWidth(spacedText, 'ABCDE');

      // 'ABCDE' tiene 5 caracteres -> 4 espacios entre ellos. Con letterSpacing: 5, suma 4 * 5 = 20 px.
      assert.equal(spacedWidth, baseWidth + 20);
    });

    it('measureSingleLineTextWidth decrementa el ancho con letterSpacing negativo', () => {
      const baseText = createMockTextNode({ text: 'ABCDE', fontSize: 20 });
      const tightText = createMockTextNode({ text: 'ABCDE', fontSize: 20, letterSpacing: -2 });

      const baseWidth = measureSingleLineTextWidth(baseText, 'ABCDE');
      const tightWidth = measureSingleLineTextWidth(tightText, 'ABCDE');

      // 4 espacios * -2 = -8 px
      assert.equal(tightWidth, baseWidth - 8);
    });

    it('un solo carácter no añade letterSpacing adicional', () => {
      const baseText = createMockTextNode({ text: 'A', fontSize: 20 });
      const spacedText = createMockTextNode({ text: 'A', fontSize: 20, letterSpacing: 10 });

      const baseWidth = measureSingleLineTextWidth(baseText, 'A');
      const spacedWidth = measureSingleLineTextWidth(spacedText, 'A');

      assert.equal(spacedWidth, baseWidth);
    });

    it('getTextBaseAABB calcula la altura basada en lines * lineHeight', () => {
      const textAuto = createMockTextNode({ text: 'L1\nL2\nL3', fontSize: 20 });
      const aabbAuto = getTextBaseAABB(textAuto);
      // Auto leading = 20 * 1.2 = 24 -> 3 * 24 = 72
      assert.equal(aabbAuto.height, 72);

      const textCustom = createMockTextNode({ text: 'L1\nL2\nL3', fontSize: 20, lineHeight: 30 });
      const aabbCustom = getTextBaseAABB(textCustom);
      // 3 * 30 = 90
      assert.equal(aabbCustom.height, 90);
    });

    it('getTextBaseAABB refleja el ancho ensanchado por letterSpacing', () => {
      const baseText = createMockTextNode({ text: 'HOLA', fontSize: 20 });
      const spacedText = createMockTextNode({ text: 'HOLA', fontSize: 20, letterSpacing: 4 });

      const aabbBase = getTextBaseAABB(baseText);
      const aabbSpaced = getTextBaseAABB(spacedText);

      // 3 espacios * 4 = 12 px
      assert.equal(aabbSpaced.width, aabbBase.width + 12);
    });

    it('getWrappedTextLines ajusta las líneas antes cuando letterSpacing ensancha las palabras', () => {
      // Con boxWidth = 60, sin spacing: cada carácter mide 10px aprox (20 * 0.6 = 12px)
      const baseText = createMockTextNode({ text: 'hola mundo texto', fontSize: 10, boxWidth: 60 });
      const spacedText = createMockTextNode({ text: 'hola mundo texto', fontSize: 10, boxWidth: 60, letterSpacing: 4 });

      const baseLines = getWrappedTextLines(baseText);
      const spacedLines = getWrappedTextLines(spacedText);

      // spacedLines debe tener más o igual cantidad de líneas debido al espaciado mayor
      assert.ok(spacedLines.length >= baseLines.length);
    });

    it('getTextIndexAtPosition localiza el carácter correcto considerando letterSpacing', () => {
      const text = createMockTextNode({
        text: 'ABCD',
        x: 100,
        y: 100,
        fontSize: 20,
        letterSpacing: 10,
      });

      // Primer carácter en x = 100
      const idxStart = getTextIndexAtPosition(text, 100, 105);
      assert.equal(idxStart, 0);

      // Fin de la palabra
      const totalWidth = measureTextWidth(text);
      const idxEnd = getTextIndexAtPosition(text, 100 + totalWidth + 10, 105);
      assert.equal(idxEnd, 4);
    });
  });

  describe('3. Renderizado y Contexto Canvas 2D', () => {
    it('RenderEngine aplica ctx.letterSpacing al dibujar texto', () => {
      let appliedLetterSpacing = '';
      const fillTexts: { text: string; x: number; y: number }[] = [];

      const mockCtx: any = {
        font: '',
        textAlign: 'left',
        textBaseline: 'top',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        letterSpacing: '0px',
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        setTransform: () => {},
        clearRect: () => {},
        clip: () => {},
        rect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        measureText: (str: string) => ({ width: str.length * 10 }),
        fillText: (text: string, x: number, y: number) => {
          appliedLetterSpacing = mockCtx.letterSpacing;
          fillTexts.push({ text, x, y });
        },
      };

      const mockCanvas: any = {
        getContext: () => mockCtx,
        width: 800,
        height: 600,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      };

      const doc = createMockDocument([createMockTextNode({ letterSpacing: 4.5 })]);

      const sm = new StateManager(doc);
      const engine = new RenderEngine(mockCanvas, sm);
      engine.render();

      assert.equal(appliedLetterSpacing, '4.5px');
      assert.equal(fillTexts.length, 1);
      assert.equal(fillTexts[0].text, 'Hola Mundo');
    });

    it('RenderEngine renderiza multilíneas espaciadas por lineHeight', () => {
      const fillTexts: { text: string; x: number; y: number }[] = [];

      const mockCtx: any = {
        font: '',
        textAlign: 'left',
        textBaseline: 'top',
        fillStyle: '',
        letterSpacing: '0px',
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        setTransform: () => {},
        clearRect: () => {},
        clip: () => {},
        rect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        measureText: (str: string) => ({ width: str.length * 10 }),
        fillText: (text: string, x: number, y: number) => {
          fillTexts.push({ text, x, y });
        },
      };

      const mockCanvas: any = {
        getContext: () => mockCtx,
        width: 800,
        height: 600,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      };

      const doc = createMockDocument([
        createMockTextNode({
          x: 50,
          y: 100,
          text: 'Línea 1\nLínea 2',
          lineHeight: 35,
        }),
      ]);

      const sm = new StateManager(doc);
      const engine = new RenderEngine(mockCanvas, sm);
      engine.render();

      assert.equal(fillTexts.length, 2);
      assert.equal(fillTexts[0].y, 100);
      assert.equal(fillTexts[1].y, 100 + 35);
    });
  });

  describe('4. Exportación SVG y Raster', () => {
    it('exportDocumentToSvg incluye letter-spacing cuando es diferente de cero', () => {
      const doc = createMockDocument([
        createMockTextNode({
          letterSpacing: 3,
        }),
      ]);

      const svg = exportDocumentToSvg(doc);
      assert.ok(svg.includes('letter-spacing="3px"'));
    });

    it('exportDocumentToSvg no incluye letter-spacing cuando es 0 o undefined', () => {
      const doc = createMockDocument([createMockTextNode({ letterSpacing: 0 })]);

      const svg = exportDocumentToSvg(doc);
      assert.ok(!svg.includes('letter-spacing'));
    });

    it('exportDocumentToSvg espacia multilíneas con coordenadas y según lineHeight', () => {
      const doc = createMockDocument([
        createMockTextNode({
          y: 100,
          text: 'L1\nL2',
          lineHeight: 40,
        }),
      ]);

      const svg = exportDocumentToSvg(doc);
      assert.ok(svg.includes('<tspan x="100" y="100">L1</tspan>'));
      assert.ok(svg.includes('<tspan x="100" y="140">L2</tspan>'));
    });

    it('renderDocumentToCanvas aplica letterSpacing al renderizar', () => {
      let appliedLetterSpacing = '';

      const mockCtx: any = {
        font: '',
        fillStyle: '',
        letterSpacing: '0px',
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        setTransform: () => {},
        clearRect: () => {},
        clip: () => {},
        rect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillRect: () => {},
        measureText: (str: string) => ({ width: str.length * 10 }),
        fillText: () => {
          appliedLetterSpacing = mockCtx.letterSpacing;
        },
      };

      const mockCanvas: any = {
        width: 400,
        height: 400,
        getContext: () => mockCtx,
      };

      const origDoc = (globalThis as any).document;
      (globalThis as any).document = {
        createElement: (tag: string) => (tag === 'canvas' ? mockCanvas : null),
      };

      const doc = createMockDocument([createMockTextNode({ letterSpacing: 6 })]);

      try {
        renderDocumentToCanvas(doc, { scale: 1 });

        assert.equal(appliedLetterSpacing, '6px');
      } finally {
        (globalThis as any).document = origDoc;
      }
    });
  });

  describe('5. Transformaciones y Escalado', () => {
    it('scaleShapesAboutAnchor escala proporcionalmente lineHeight y letterSpacing', () => {
      const text = createMockTextNode({
        fontSize: 20,
        lineHeight: 24,
        letterSpacing: 2,
      });

      const entries = scaleShapesAboutAnchor([text], { x: 0, y: 0 }, 2, 2);
      assert.equal(entries.length, 1);
      const dims = entries[0].dimensions;

      assert.equal(dims.fontSize, 40);
      assert.equal(dims.lineHeight, 48);
      assert.equal(dims.letterSpacing, 4);
    });
  });

  describe('6. Panel de Propiedades y Undo/Redo', () => {
    function setupTestEnvironment() {
      const elements: Record<string, MockElement> = {
        '#input-fill': new MockElement('input-fill', 'input'),
        '#input-fill-hex': new MockElement('input-fill-hex', 'input'),
        '#btn-fill-none': new MockElement('btn-fill-none', 'button'),
        '#swatch-fill-preview': new MockElement('swatch-fill-preview', 'div'),
        '#input-stroke': new MockElement('input-stroke', 'input'),
        '#input-stroke-hex': new MockElement('input-stroke-hex', 'input'),
        '#btn-stroke-none': new MockElement('btn-stroke-none', 'button'),
        '#swatch-stroke-preview': new MockElement('swatch-stroke-preview', 'div'),
        '#input-stroke-width': new MockElement('input-stroke-width', 'input'),
        '#no-selection-state': new MockElement('no-selection-state', 'div'),
        '#selection-state': new MockElement('selection-state', 'div'),
        '#panel-title': new MockElement('panel-title', 'span'),
        '#section-typography': new MockElement('section-typography', 'details'),
        '#section-appearance': new MockElement('section-appearance', 'details'),
        '#group-text-color': new MockElement('group-text-color', 'div'),
        '#input-text-content': new MockElement('input-text-content', 'input'),
        '#select-font-family': new MockElement('select-font-family', 'select'),
        '#input-font-size': new MockElement('input-font-size', 'input'),
        '#input-line-height': new MockElement('input-line-height', 'input'),
        '#input-letter-spacing': new MockElement('input-letter-spacing', 'input'),
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

      const mockDoc: any = {
        activeElement: null,
        querySelector: (selector: string) => elements[selector] ?? null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      (globalThis as any).document = mockDoc;
      return { elements };
    }

    it('sincroniza los valores iniciales de lineHeight y letterSpacing al seleccionar Text', () => {
      const { elements } = setupTestEnvironment();
      const textNode = createMockTextNode({
        fontSize: 24,
        lineHeight: 36,
        letterSpacing: 1.5,
      });

      const doc = createMockDocument([textNode]);

      const sm = new StateManager(doc);
      const cm = new CommandManager();
      const bindings = setupPropertiesPanelBindings({
        stateManager: sm,
        commandManager: cm,
        inputController: null as any,
        canvas: null,
      });

      sm.setSelection([textNode.id]);
      bindings.syncPropertiesPanel();

      assert.equal(elements['#input-line-height'].value, '36');
      assert.equal(elements['#input-letter-spacing'].value, '1.5');

      bindings.cleanup();
    });

    it('muestra Auto en placeholder cuando lineHeight no está definido', () => {
      const { elements } = setupTestEnvironment();
      const textNode = createMockTextNode({
        fontSize: 20,
        lineHeight: undefined,
        letterSpacing: undefined,
      });

      const doc = createMockDocument([textNode]);

      const sm = new StateManager(doc);
      const cm = new CommandManager();
      const bindings = setupPropertiesPanelBindings({
        stateManager: sm,
        commandManager: cm,
        inputController: null as any,
        canvas: null,
      });

      sm.setSelection([textNode.id]);
      bindings.syncPropertiesPanel();

      assert.equal(elements['#input-line-height'].value, '');
      assert.ok(elements['#input-line-height'].placeholder.includes('Auto'));
      assert.equal(elements['#input-letter-spacing'].value, '0');

      bindings.cleanup();
    });

    it('modificar lineHeight registra UpdateTextTypographyCommand y permite Undo/Redo', () => {
      const { elements } = setupTestEnvironment();
      const textNode = createMockTextNode({
        fontSize: 20,
        lineHeight: 24,
      });

      const doc = createMockDocument([textNode]);

      const sm = new StateManager(doc);
      const cm = new CommandManager();
      const bindings = setupPropertiesPanelBindings({
        stateManager: sm,
        commandManager: cm,
        inputController: null as any,
        canvas: null,
      });

      sm.setSelection([textNode.id]);
      bindings.syncPropertiesPanel();

      // Foco, cambio a 32, change
      elements['#input-line-height'].dispatch('focus');
      elements['#input-line-height'].value = '32';
      elements['#input-line-height'].dispatch('input');
      elements['#input-line-height'].dispatch('change');

      let updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.lineHeight, 32);
      assert.ok(cm.canUndo());

      // Undo
      cm.undo();
      updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.lineHeight, 24);

      // Redo
      cm.redo();
      updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.lineHeight, 32);

      bindings.cleanup();
    });

    it('vaciar input-line-height restaura lineHeight a undefined (Auto) con Undo/Redo', () => {
      const { elements } = setupTestEnvironment();
      const textNode = createMockTextNode({
        fontSize: 20,
        lineHeight: 30,
      });

      const doc = createMockDocument([textNode]);

      const sm = new StateManager(doc);
      const cm = new CommandManager();
      const bindings = setupPropertiesPanelBindings({
        stateManager: sm,
        commandManager: cm,
        inputController: null as any,
        canvas: null,
      });

      sm.setSelection([textNode.id]);
      bindings.syncPropertiesPanel();

      // Borrar valor
      elements['#input-line-height'].dispatch('focus');
      elements['#input-line-height'].value = '';
      elements['#input-line-height'].dispatch('change');

      let updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.lineHeight, undefined);

      cm.undo();
      updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.lineHeight, 30);

      bindings.cleanup();
    });

    it('modificar letterSpacing registra UpdateTextTypographyCommand y permite Undo/Redo', () => {
      const { elements } = setupTestEnvironment();
      const textNode = createMockTextNode({
        letterSpacing: 0,
      });

      const doc = createMockDocument([textNode]);

      const sm = new StateManager(doc);
      const cm = new CommandManager();
      const bindings = setupPropertiesPanelBindings({
        stateManager: sm,
        commandManager: cm,
        inputController: null as any,
        canvas: null,
      });

      sm.setSelection([textNode.id]);
      bindings.syncPropertiesPanel();

      // Foco, cambio a 3.5, change
      elements['#input-letter-spacing'].dispatch('focus');
      elements['#input-letter-spacing'].value = '3.5';
      elements['#input-letter-spacing'].dispatch('input');
      elements['#input-letter-spacing'].dispatch('change');

      let updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.letterSpacing, 3.5);
      assert.ok(cm.canUndo());

      // Undo
      cm.undo();
      updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.letterSpacing, 0);

      // Redo
      cm.redo();
      updated = sm.findNode(textNode.id) as Text;
      assert.equal(updated.letterSpacing, 3.5);

      bindings.cleanup();
    });
  });
});
