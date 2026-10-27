import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ApplyTextSpanCommand } from '../src/commands/ApplyTextSpanCommand.ts';
import { UpdateTextCommand } from '../src/commands/UpdateTextCommand.ts';
import { TextEditManager } from '../src/input/TextEditManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { KeyboardShortcutsHandler } from '../src/input/KeyboardShortcutsHandler.ts';
import type { Text, TextSpan } from '../src/types/scene-graph.ts';
import {
  getTextLineHeight,
  getTextLineRanges,
  getTextIndexAtPosition,
} from '../src/utils/geometry.ts';

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    getContext: () => ({
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      beginPath: () => {},
      closePath: () => {},
      rect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 8 }),
    }),
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
  } as unknown as HTMLCanvasElement;
}

describe('Text Rich Styles (Multi-Style Spans)', () => {
  it('ApplyTextSpanCommand aplica parches de estilo con soporte exacto de undo y redo', () => {
    const sm = new StateManager();
    const cm = new CommandManager();

    const textNode: Text = {
      id: 'text-1',
      name: 'Text 1',
      type: 'text',
      x: 0,
      y: 0,
      text: 'Hola Mundo',
      fontSize: 16,
      fill: '#000000',
    };
    sm.addNode(sm.getActiveLayer()!.id, textNode);

    const cmd = new ApplyTextSpanCommand(sm, 'text-1', 5, 10, { fontWeight: 'bold', fill: '#ff0000' });
    cm.executeCommand(cmd);

    let current = sm.findNode('text-1') as Text;
    assert.ok(current.spans);
    assert.equal(current.spans.length, 1);
    assert.deepEqual(current.spans[0], {
      start: 5,
      end: 10,
      fontWeight: 'bold',
      fill: '#ff0000',
    });

    // Undo
    cm.undo();
    current = sm.findNode('text-1') as Text;
    assert.equal(current.spans, undefined);

    // Redo
    cm.redo();
    current = sm.findNode('text-1') as Text;
    assert.ok(current.spans);
    assert.equal(current.spans.length, 1);
    assert.equal(current.spans[0].fontWeight, 'bold');
  });

  it('UpdateTextCommand preserva y actualiza spans junto con el texto al hacer undo y redo', () => {
    const sm = new StateManager();
    const cm = new CommandManager();

    const originalSpans: TextSpan[] = [{ start: 0, end: 4, fontWeight: 'bold' }];
    const newSpans: TextSpan[] = [{ start: 0, end: 5, fontWeight: 'bold' }];

    const textNode: Text = {
      id: 'text-2',
      name: 'Text 2',
      type: 'text',
      x: 0,
      y: 0,
      text: 'Hola',
      spans: originalSpans,
    };
    sm.addNode(sm.getActiveLayer()!.id, textNode);

    const cmd = new UpdateTextCommand(sm, 'text-2', 'Hola', 'Hello', originalSpans, newSpans);
    cm.executeCommand(cmd);

    let current = sm.findNode('text-2') as Text;
    assert.equal(current.text, 'Hello');
    assert.deepEqual(current.spans, newSpans);

    // Undo
    cm.undo();
    current = sm.findNode('text-2') as Text;
    assert.equal(current.text, 'Hola');
    assert.deepEqual(current.spans, originalSpans);

    // Redo
    cm.redo();
    current = sm.findNode('text-2') as Text;
    assert.equal(current.text, 'Hello');
    assert.deepEqual(current.spans, newSpans);
  });

  it('TextEditManager ajusta spans al escribir y borrar caracteres', () => {
    const sm = new StateManager();
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const tem = new TextEditManager(sm, cm, canvas);

    const textNode: Text = {
      id: 'text-3',
      name: 'Text 3',
      type: 'text',
      x: 0,
      y: 0,
      text: 'ABC DEF',
      spans: [{ start: 4, end: 7, fontWeight: 'bold' }], // 'DEF' es negrita
    };
    sm.addNode(sm.getActiveLayer()!.id, textNode);

    // Iniciar edición con cursor en índice 0
    tem.startEditingText('text-3', 0);

    // Escribir '1' al principio (índice 0)
    tem.handleKeyDown({ key: '1' } as KeyboardEvent);

    assert.equal(tem.textEditingState?.currentText, '1ABC DEF');
    // El span 'DEF' ahora debe haberse desplazado de [4, 7) a [5, 8)
    assert.deepEqual(tem.textEditingState?.currentSpans, [
      { start: 5, end: 8, fontWeight: 'bold' },
    ]);

    // Borrar un carácter al principio con delete
    tem.handleKeyDown({ key: 'Delete' } as KeyboardEvent);
    assert.equal(tem.textEditingState?.currentText, '1BC DEF');
    // Longitud reducida en 1 antes del span, debe retroceder a [4, 7)
    assert.deepEqual(tem.textEditingState?.currentSpans, [
      { start: 4, end: 7, fontWeight: 'bold' },
    ]);

    // Confirmar edición
    tem.commitTextEdit();
    const saved = sm.findNode('text-3') as Text;
    assert.equal(saved.text, '1BC DEF');
    assert.deepEqual(saved.spans, [{ start: 4, end: 7, fontWeight: 'bold' }]);
  });

  it('applySpanToSelection aplica y alterna estilos en la selección interactiva (Ctrl+B, Ctrl+I)', () => {
    const sm = new StateManager();
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const tem = new TextEditManager(sm, cm, canvas);

    const textNode: Text = {
      id: 'text-4',
      name: 'Text 4',
      type: 'text',
      x: 0,
      y: 0,
      text: 'Texto de prueba',
    };
    sm.addNode(sm.getActiveLayer()!.id, textNode);

    tem.startEditingText('text-4', 0);
    // Seleccionar la palabra 'Texto' [0, 5)
    tem.textEditingState!.selectionStart = 0;
    tem.textEditingState!.selectionEnd = 5;

    // Aplicar negrita con Ctrl+B
    tem.handleKeyDown({ key: 'b', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.ok(tem.textEditingState?.currentSpans);
    assert.equal(tem.textEditingState?.currentSpans.length, 1);
    assert.equal(tem.textEditingState?.currentSpans[0].start, 0);
    assert.equal(tem.textEditingState?.currentSpans[0].end, 5);
    assert.equal(tem.textEditingState?.currentSpans[0].fontWeight, 'bold');

    // Comprobar getActiveSelectionStyle
    const style1 = tem.getActiveSelectionStyle();
    assert.equal(style1?.fontWeight, 'bold');

    // Pulsar Ctrl+B nuevamente debe alternar la negrita de vuelta a normal
    tem.handleKeyDown({ key: 'b', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(tem.textEditingState?.currentSpans?.length, 0);

    // Seleccionar 'prueba' [9, 15) y aplicar cursiva con Ctrl+I
    tem.textEditingState!.selectionStart = 9;
    tem.textEditingState!.selectionEnd = 15;
    tem.handleKeyDown({ key: 'i', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.equal(tem.textEditingState?.currentSpans?.length, 1);
    assert.equal(tem.textEditingState?.currentSpans[0].fontStyle, 'italic');

    // Confirmar edición
    tem.commitTextEdit();
    const saved = sm.findNode('text-4') as Text;
    assert.equal(saved.spans?.length, 1);
    assert.equal(saved.spans[0].fontStyle, 'italic');
  });

  it('InputController.applyTextTypography y KeyboardShortcutsHandler manejan selección de caracteres y objetos', () => {
    const sm = new StateManager();
    const cm = new CommandManager();
    const canvas = createMockCanvas();
    const ic = new InputController(canvas, sm, cm);
    const ksh = new KeyboardShortcutsHandler(ic);

    const textNode: Text = {
      id: 'text-5',
      name: 'Text 5',
      type: 'text',
      x: 0,
      y: 0,
      text: 'Vectedit Editor',
      fontSize: 20,
    };
    sm.addNode(sm.getActiveLayer()!.id, textNode);
    sm.selectNode('text-5');

    // 1. En modo objeto (sin estar editando texto), Ctrl+B alterna negrita de todo el nodo
    ksh.handleKeyDown({ key: 'b', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    let updated = sm.findNode('text-5') as Text;
    assert.equal(updated.fontWeight, 700);

    // 2. Iniciar edición y seleccionar 'Editor' [9, 15)
    ic.textEditManager.startEditingText('text-5', 0);
    ic.textEditManager.textEditingState!.selectionStart = 9;
    ic.textEditManager.textEditingState!.selectionEnd = 15;

    // 3. Aplicar color rojo mediante ic.applyTextTypography
    ic.applyTextTypography({ fill: '#ff0000', fontSize: 32 });

    const spans = ic.textEditManager.textEditingState?.currentSpans;
    assert.ok(spans);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].start, 9);
    assert.equal(spans[0].end, 15);
    assert.equal(spans[0].fill, '#ff0000');
    assert.equal(spans[0].fontSize, 32);

    // Terminar edición
    ic.textEditManager.commitTextEdit();
    updated = sm.findNode('text-5') as Text;
    assert.ok(updated.spans);
    assert.equal(updated.spans[0].fill, '#ff0000');
    assert.equal(updated.spans[0].fontSize, 32);
  });

  it('textMetrics calcula altura de línea y anchos basándose en los spans con distintos tamaños', () => {
    const textNode: Text = {
      id: 'text-6',
      name: 'Text 6',
      type: 'text',
      x: 10,
      y: 20,
      text: 'Texto Grande Normal',
      fontSize: 16,
      spans: [
        { start: 6, end: 12, fontSize: 40 }, // 'Grande' tiene 40px
      ],
    };

    // La altura de línea debe adaptarse al tamaño máximo (40 * 1.2 = 48 en vez de 16 * 1.2 = 19.2)
    const lh = getTextLineHeight(textNode);
    assert.equal(lh, 40 * 1.2);

    // Con el mock context (8 px por carácter * fontSize / 16):
    const ctx = createMockCanvas().getContext('2d') as CanvasRenderingContext2D;
    const ranges = getTextLineRanges(textNode, ctx);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].text, 'Texto Grande Normal');

    // Mediciones de posición
    const index = getTextIndexAtPosition(textNode, 10, 20, ctx);
    assert.equal(index, 0);
  });
});
