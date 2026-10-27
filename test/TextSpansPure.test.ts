import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Text, TextSpan } from '../src/types/scene-graph.ts';
import {
  resolveCharacterStyle,
  normalizeSpans,
  applySpanToRange,
  adjustSpansOnTextChange,
  splitTextIntoRuns,
} from '../src/utils/textSpans.ts';

function createDummyText(spans?: TextSpan[]): Text {
  return {
    id: 'text-1',
    name: 'Text',
    type: 'text',
    x: 0,
    y: 0,
    text: 'Hola Mundo Illustrator',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 400,
    fontStyle: 'normal',
    fill: '#000000',
    spans,
  };
}

describe('Módulo de Spans Tipográficos (textSpans.ts)', () => {
  it('resolveCharacterStyle: devuelve el estilo base si no hay spans', () => {
    const text = createDummyText();
    const style = resolveCharacterStyle(text, 2);
    assert.equal(style.fontFamily, 'Inter');
    assert.equal(style.fontSize, 24);
    assert.equal(style.fontWeight, 400);
    assert.equal(style.fontStyle, 'normal');
    assert.equal(style.fill, '#000000');
  });

  it('resolveCharacterStyle: sobreescribe con el span que cubre el índice', () => {
    const text = createDummyText([
      { start: 5, end: 10, fontWeight: 700, fill: '#ff0000', fontSize: 32 },
    ]);
    // 'Hola ' (0..4) usa base
    assert.equal(resolveCharacterStyle(text, 3).fontWeight, 400);
    assert.equal(resolveCharacterStyle(text, 3).fill, '#000000');
    assert.equal(resolveCharacterStyle(text, 3).fontSize, 24);

    // 'Mundo' (5..9) usa span
    assert.equal(resolveCharacterStyle(text, 5).fontWeight, 700);
    assert.equal(resolveCharacterStyle(text, 5).fill, '#ff0000');
    assert.equal(resolveCharacterStyle(text, 5).fontSize, 32);
    assert.equal(resolveCharacterStyle(text, 9).fontWeight, 700);

    // ' Illustrator' (10..) usa base
    assert.equal(resolveCharacterStyle(text, 10).fontWeight, 400);
    assert.equal(resolveCharacterStyle(text, 10).fill, '#000000');
  });

  it('normalizeSpans: descarta tramos vacíos y fusiona tramos contiguos con estilo idéntico', () => {
    const spans: TextSpan[] = [
      { start: 0, end: 5, fontWeight: 700 },
      { start: 5, end: 10, fontWeight: 700 }, // Contiguo e idéntico -> debe fusionarse a 0..10
      { start: 12, end: 12, fontWeight: 700 }, // Vacío -> descartar
      { start: 15, end: 20, fontStyle: 'italic' },
    ];
    const normalized = normalizeSpans(spans, 22);
    assert.equal(normalized.length, 2);
    assert.deepEqual(normalized[0], { start: 0, end: 10, fontWeight: 700 });
    assert.deepEqual(normalized[1], { start: 15, end: 20, fontStyle: 'italic' });
  });

  it('applySpanToRange: aplica estilo sobre una subselección dividiendo o sobreescribiendo spans previos', () => {
    const text = createDummyText();
    // 1. Aplicar negrita a 'Mundo' (5..10)
    let spans = applySpanToRange([], { start: 5, end: 10 }, { fontWeight: 700 }, text);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].start, 5);
    assert.equal(spans[0].end, 10);
    assert.equal(spans[0].fontWeight, 700);

    // 2. Aplicar cursiva a 'do Ill' (8..14)
    spans = applySpanToRange(spans, { start: 8, end: 14 }, { fontStyle: 'italic' }, text);
    // Debe haber dividido:
    // [5, 8]: fontWeight: 700
    // [8, 10]: fontWeight: 700, fontStyle: 'italic'
    // [10, 14]: fontStyle: 'italic'
    assert.equal(spans.length, 3);
    assert.equal(spans[0].start, 5);
    assert.equal(spans[0].end, 8);
    assert.equal(spans[0].fontWeight, 700);

    assert.equal(spans[1].start, 8);
    assert.equal(spans[1].end, 10);
    assert.equal(spans[1].fontWeight, 700);
    assert.equal(spans[1].fontStyle, 'italic');

    assert.equal(spans[2].start, 10);
    assert.equal(spans[2].end, 14);
    assert.equal(spans[2].fontStyle, 'italic');
  });

  it('adjustSpansOnTextChange: al insertar texto antes o dentro de un span, ajusta los índices correctamente', () => {
    const initialSpans: TextSpan[] = [
      { start: 5, end: 10, fontWeight: 700 }, // 'Mundo'
      { start: 15, end: 20, fontStyle: 'italic' },
    ];

    // Inserción de 3 caracteres al inicio (index 0)
    const afterInsertBefore = adjustSpansOnTextChange(initialSpans, 0, 0, 3);
    assert.equal(afterInsertBefore[0].start, 8);
    assert.equal(afterInsertBefore[0].end, 13);
    assert.equal(afterInsertBefore[1].start, 18);
    assert.equal(afterInsertBefore[1].end, 23);

    // Inserción de 2 caracteres dentro del primer span (index 7)
    const afterInsertInside = adjustSpansOnTextChange(initialSpans, 7, 0, 2);
    assert.equal(afterInsertInside[0].start, 5);
    assert.equal(afterInsertInside[0].end, 12); // expandido
    assert.equal(afterInsertInside[1].start, 17);
    assert.equal(afterInsertInside[1].end, 22);
  });

  it('adjustSpansOnTextChange: al borrar texto, contrae o elimina los spans afectados', () => {
    const initialSpans: TextSpan[] = [
      { start: 5, end: 10, fontWeight: 700 }, // 'Mundo' (5..10)
      { start: 15, end: 20, fontStyle: 'italic' },
    ];

    // Borrado de 2 caracteres antes del primer span (indices 1..3)
    const afterDeleteBefore = adjustSpansOnTextChange(initialSpans, 1, 2, 0);
    assert.equal(afterDeleteBefore[0].start, 3);
    assert.equal(afterDeleteBefore[0].end, 8);
    assert.equal(afterDeleteBefore[1].start, 13);
    assert.equal(afterDeleteBefore[1].end, 18);

    // Borrado que consume completamente el primer span (indices 4..11)
    const afterDeleteAll = adjustSpansOnTextChange(initialSpans, 4, 7, 0);
    assert.equal(afterDeleteAll.length, 1);
    assert.equal(afterDeleteAll[0].start, 8);
    assert.equal(afterDeleteAll[0].end, 13);
  });

  it('splitTextIntoRuns: divide un texto en runs continuos respetando los límites de los spans', () => {
    const text = createDummyText([
      { start: 5, end: 10, fontWeight: 700, fill: '#ff0000' },
    ]);
    const runs = splitTextIntoRuns(text, 0, text.text.length);
    assert.equal(runs.length, 3);

    // Run 1: 'Hola ' (0..5)
    assert.equal(runs[0].text, 'Hola ');
    assert.equal(runs[0].start, 0);
    assert.equal(runs[0].end, 5);
    assert.equal(runs[0].style.fontWeight, 400);

    // Run 2: 'Mundo' (5..10)
    assert.equal(runs[1].text, 'Mundo');
    assert.equal(runs[1].start, 5);
    assert.equal(runs[1].end, 10);
    assert.equal(runs[1].style.fontWeight, 700);
    assert.equal(runs[1].style.fill, '#ff0000');

    // Run 3: ' Illustrator' (10..22)
    assert.equal(runs[2].text, ' Illustrator');
    assert.equal(runs[2].start, 10);
    assert.equal(runs[2].end, 22);
    assert.equal(runs[2].style.fontWeight, 400);
  });
});
