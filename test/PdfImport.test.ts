import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { parsePdfBytes } from '../src/utils/pdfImport.ts';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { setupPlacementController } from '../src/ui/PlacementController.ts';
import type { Document } from '../src/types/scene-graph.ts';

describe('Importación de PDF (Fase 2: PDF.js + Scene Graph vectorial)', () => {
  it('parsePdfBytes extrae trazados vectoriales y dimensiones de un PDF de una sola página', async () => {
    // Generar un PDF vectorial sintético en memoria
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [500, 400] });
    doc.setDrawColor(239, 68, 68); // #ef4444
    doc.setLineWidth(2);
    doc.rect(40, 50, 120, 80);

    const buffer = doc.output('arraybuffer');
    const result = await parsePdfBytes(buffer);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pages.length, 1);
    assert.strictEqual(result.pages[0].width, 500);
    assert.strictEqual(result.pages[0].height, 400);

    // Debe contener al menos una figura vectorial extraída
    assert.ok(result.shapes.length > 0);
    const shape = result.shapes[0];
    assert.ok(shape.type === 'path' || shape.type === 'rectangle');

    // Comprobar posición cercana a (40, 50)
    assert.ok(Math.abs(shape.x - 40) <= 2);
    assert.ok(Math.abs(shape.y - 50) <= 2);
  });

  it('parsePdfBytes extrae curvas de Bézier cúbicas con sus puntos y manejadores', async () => {
    const doc = new jsPDF({ unit: 'pt', format: [400, 400] });
    doc.setFillColor(59, 130, 246); // #3b82f6
    doc.circle(200, 200, 50, 'F'); // Relleno

    const buffer = doc.output('arraybuffer');
    const result = await parsePdfBytes(buffer);

    assert.strictEqual(result.success, true);
    assert.ok(result.shapes.length > 0);

    const circleShape = result.shapes[0];
    assert.strictEqual(circleShape.type, 'path');
    if (circleShape.type === 'path') {
      // Un círculo en Bézier cúbica contiene 4 o más puntos con manejadores
      assert.ok(circleShape.points.length >= 4);
      const hasHandles = circleShape.points.some((p) => p.handleIn || p.handleOut);
      assert.strictEqual(hasHandles, true);
    }
  });

  it('parsePdfBytes extrae texto como elementos tipográficos editables', async () => {
    const doc = new jsPDF({ unit: 'pt', format: [400, 300] });
    doc.setFontSize(18);
    doc.text('Título Vectorial', 60, 80);

    const buffer = doc.output('arraybuffer');
    const result = await parsePdfBytes(buffer);

    assert.strictEqual(result.success, true);
    assert.ok(result.shapes.length > 0);

    const textShape = result.shapes.find((s) => s.type === 'text');
    assert.ok(textShape, 'Debe haber al menos un nodo de texto');
    if (textShape && textShape.type === 'text') {
      assert.match(textShape.text, /Título Vectorial/);
      assert.ok((textShape.fontSize ?? 0) >= 14);
    }
  });

  it('parsePdfBytes genera Mesas de Trabajo (Artboards) independientes para PDFs multipágina', async () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [400, 300] });
    // Página 1
    doc.rect(20, 20, 50, 50);

    // Página 2 (600 x 400)
    doc.addPage([600, 400], 'landscape');
    doc.rect(30, 30, 80, 80);

    const buffer = doc.output('arraybuffer');
    const result = await parsePdfBytes(buffer);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pages.length, 2);
    assert.strictEqual(result.artboards.length, 2);

    // Mesa 1
    assert.strictEqual(result.artboards[0].name, 'Página 1');
    assert.strictEqual(result.artboards[0].width, 400);
    assert.strictEqual(result.artboards[0].height, 300);
    assert.strictEqual(result.artboards[0].x, 0);

    // Mesa 2: separada por el ancho de la mesa 1 + gap (100)
    assert.strictEqual(result.artboards[1].name, 'Página 2');
    assert.strictEqual(result.artboards[1].width, 600);
    assert.strictEqual(result.artboards[1].height, 400);
    assert.strictEqual(result.artboards[1].x, 500); // 400 + 100

    // Las figuras de la página 2 están desplazadas para ubicarse dentro de su mesa
    const p2Shapes = result.pages[1].shapes;
    assert.ok(p2Shapes.length > 0);
    const firstP2 = p2Shapes[0];
    assert.ok(firstP2.type !== 'group' && firstP2.x >= 500);
  });

  it('parsePdfBytes maneja limpiamente buffers corruptos o datos inválidos sin lanzar excepciones no controladas', async () => {
    const corruptData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = await parsePdfBytes(corruptData);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.strictEqual(result.shapes.length, 0);
    assert.strictEqual(result.artboards.length, 0);
  });

  it('setupPlacementController coloca archivos PDF como figuras vectoriales en el Scene Graph', async () => {
    const docPdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [400, 300] });
    docPdf.rect(10, 10, 100, 80);
    const pdfBuffer = docPdf.output('arraybuffer');

    const fakePdfFile = {
      name: 'logotipo.pdf',
      type: 'application/pdf',
      size: pdfBuffer.byteLength,
      arrayBuffer: async () => pdfBuffer,
      text: async () => '',
    } as unknown as File;

    const initialDoc: Document = {
      id: 'doc-place-test',
      name: 'Lienzo',
      type: 'document',
      width: 1000,
      height: 800,
      children: [
        {
          id: 'layer-main',
          name: 'Capa Principal',
          type: 'layer',
          children: [],
        },
      ],
    };

    const commandManager = new CommandManager();
    const stateManager = new StateManager(initialDoc, commandManager);
    const viewportManager = new ViewportManager();

    const controller = setupPlacementController({
      stateManager,
      commandManager,
      viewportManager,
      canvas: null,
    });

    try {
      // Colocar el archivo PDF centrado en (500, 400)
      await controller.placeFiles([fakePdfFile], { x: 500, y: 400 });

      const state = stateManager.getState();
      const layer = state.children[0];
      assert.ok(layer.children.length > 0, 'Debe haber colocado las figuras en la capa');

      // Comprobar que hay historial reversible
      assert.ok(commandManager.canUndo);
      commandManager.undo();
      assert.strictEqual(stateManager.getState().children[0].children.length, 0);

      commandManager.redo();
      assert.ok(stateManager.getState().children[0].children.length > 0);
    } finally {
      controller.cleanup();
    }
  });
});
