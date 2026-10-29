import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportDocumentToPdf,
  exportDocumentToPdfBlob,
  downloadPdf,
  parseSvgElement,
} from '../src/utils/exportPdf.ts';
import type { Document, Rectangle, Ellipse } from '../src/types/scene-graph.ts';

describe('Exportación a PDF (Fase 1: jsPDF + Vector)', () => {
  const createTestDoc = (): Document => ({
    id: 'doc-pdf-1',
    name: 'Documento Prueba',
    type: 'document',
    width: 800,
    height: 600,
    children: [
      {
        id: 'layer-1',
        name: 'Capa 1',
        type: 'layer',
        children: [
          {
            id: 'rect-1',
            name: 'Rectángulo',
            type: 'rectangle',
            x: 50,
            y: 50,
            width: 200,
            height: 100,
            fill: '#ef4444',
            stroke: '#1e293b',
            strokeWidth: 2,
          } as Rectangle,
          {
            id: 'ellipse-1',
            name: 'Elipse',
            type: 'ellipse',
            x: 400,
            y: 300,
            radiusX: 80,
            radiusY: 60,
            fill: '#3b82f6',
          } as Ellipse,
        ],
      },
    ],
    artboards: [
      {
        id: 'ab-1',
        name: 'Mesa Tarjeta',
        x: 0,
        y: 0,
        width: 400,
        height: 250,
      },
      {
        id: 'ab-2',
        name: 'Mesa Poster',
        x: 500,
        y: 0,
        width: 600,
        height: 900,
      },
    ],
  });

  it('exportDocumentToPdf genera un PDF para el documento completo con dimensiones del lienzo', async () => {
    const doc = createTestDoc();
    const renderedCalls: Array<{ x: number; y: number; width: number; height: number }> = [];

    const pdf = await exportDocumentToPdf(doc, {
      scope: 'document',
      parseElement: () => ({} as Element),
      renderSvg: async (_elem, _pdf, opts) => {
        renderedCalls.push(opts);
      },
    });

    assert.strictEqual(pdf.getNumberOfPages(), 1);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    assert.strictEqual(pageWidth, 800);
    assert.strictEqual(pageHeight, 600);

    assert.strictEqual(renderedCalls.length, 1);
    assert.deepStrictEqual(renderedCalls[0], { x: 0, y: 0, width: 800, height: 600 });
  });

  it('exportDocumentToPdf con scope selection calcula los límites y ajusta el tamaño de página', async () => {
    const doc = createTestDoc();
    const renderedCalls: Array<{ x: number; y: number; width: number; height: number }> = [];

    // Solo rect-1 (x: 50, y: 50, w: 200, h: 100)
    const pdf = await exportDocumentToPdf(doc, {
      scope: 'selection',
      selectedIds: ['rect-1'],
      parseElement: () => ({} as Element),
      renderSvg: async (_elem, _pdf, opts) => {
        renderedCalls.push(opts);
      },
    });

    assert.strictEqual(pdf.getNumberOfPages(), 1);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    assert.strictEqual(pageWidth, 200);
    assert.strictEqual(pageHeight, 100);

    assert.strictEqual(renderedCalls.length, 1);
    assert.deepStrictEqual(renderedCalls[0], { x: 0, y: 0, width: 200, height: 100 });
  });

  it('exportDocumentToPdf con scope artboard individual exporta solo la mesa seleccionada', async () => {
    const doc = createTestDoc();
    const renderedCalls: Array<{ x: number; y: number; width: number; height: number }> = [];

    // ab-2 es de 600 x 900 (portrait)
    const pdf = await exportDocumentToPdf(doc, {
      scope: 'artboard',
      artboardId: 'ab-2',
      parseElement: () => ({} as Element),
      renderSvg: async (_elem, _pdf, opts) => {
        renderedCalls.push(opts);
      },
    });

    assert.strictEqual(pdf.getNumberOfPages(), 1);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    assert.strictEqual(pageWidth, 600);
    assert.strictEqual(pageHeight, 900);

    assert.strictEqual(renderedCalls.length, 1);
    assert.deepStrictEqual(renderedCalls[0], { x: 0, y: 0, width: 600, height: 900 });
  });

  it('exportDocumentToPdf genera documento multipágina (un solo PDF) para todas las mesas de trabajo', async () => {
    const doc = createTestDoc();
    const renderedCalls: Array<{ x: number; y: number; width: number; height: number }> = [];

    // doc tiene 2 mesas de trabajo: ab-1 (400x250) y ab-2 (600x900)
    const pdf = await exportDocumentToPdf(doc, {
      scope: 'artboard',
      artboardMode: 'single',
      parseElement: () => ({} as Element),
      renderSvg: async (_elem, _pdf, opts) => {
        renderedCalls.push(opts);
      },
    });

    assert.strictEqual(pdf.getNumberOfPages(), 2);

    // Página 1: ab-1 (400x250 landscape)
    pdf.setPage(1);
    assert.strictEqual(pdf.internal.pageSize.getWidth(), 400);
    assert.strictEqual(pdf.internal.pageSize.getHeight(), 250);

    // Página 2: ab-2 (600x900 portrait)
    pdf.setPage(2);
    assert.strictEqual(pdf.internal.pageSize.getWidth(), 600);
    assert.strictEqual(pdf.internal.pageSize.getHeight(), 900);

    // Dos llamadas de renderizado, una para cada mesa
    assert.strictEqual(renderedCalls.length, 2);
    assert.deepStrictEqual(renderedCalls[0], { x: 0, y: 0, width: 400, height: 250 });
    assert.deepStrictEqual(renderedCalls[1], { x: 0, y: 0, width: 600, height: 900 });
  });

  it('exportDocumentToPdfBlob retorna un objeto Blob con tipo application/pdf', async () => {
    const doc = createTestDoc();
    const blob = await exportDocumentToPdfBlob(doc, {
      scope: 'document',
      parseElement: () => ({} as Element),
      renderSvg: async () => { },
    });

    assert.ok(blob instanceof Blob);
    assert.strictEqual(blob.type, 'application/pdf');
    assert.ok(blob.size > 0);
  });

  it('downloadPdf crea un enlace ancla, dispara la descarga y revoca la URL creada', () => {
    let capturedHref = '';
    let capturedDownload = '';
    let clicked = false;
    let appended = false;
    let removed = false;
    let revokedUrl = '';

    const mockAnchor = {
      set href(v: string) {
        capturedHref = v;
      },
      get href() {
        return capturedHref;
      },
      set download(v: string) {
        capturedDownload = v;
      },
      get download() {
        return capturedDownload;
      },
      style: { display: '' },
      setAttribute: () => { },
      click: () => {
        clicked = true;
      },
    };

    const origWindow = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const origUrl = (globalThis as any).URL;

    (globalThis as any).window = {};
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'a') return mockAnchor;
        return null;
      },
      body: {
        appendChild: () => {
          appended = true;
        },
        removeChild: () => {
          removed = true;
        },
      },
    };
    (globalThis as any).URL = {
      createObjectURL: (b: Blob) => `blob:mock-pdf-${b.size}`,
      revokeObjectURL: (u: string) => {
        revokedUrl = u;
      },
    };

    try {
      const blob = new Blob(['test-pdf'], { type: 'application/pdf' });
      downloadPdf('mi-diseno', blob);

      assert.strictEqual(capturedDownload, 'mi-diseno.pdf');
      assert.strictEqual(capturedHref, 'blob:mock-pdf-8');
      assert.strictEqual(clicked, true);
      assert.strictEqual(appended, true);
      assert.strictEqual(removed, true);
      assert.strictEqual(revokedUrl, 'blob:mock-pdf-8');

      // Con extensión explícita no duplica .pdf
      downloadPdf('archivo.pdf', blob);
      assert.strictEqual(capturedDownload, 'archivo.pdf');
    } finally {
      (globalThis as any).window = origWindow;
      (globalThis as any).document = origDoc;
      (globalThis as any).URL = origUrl;
    }
  });

  it('parseSvgElement parsea correctamente mediante DOMParser disponible', () => {
    const origDOMParser = (globalThis as any).DOMParser;

    (globalThis as any).DOMParser = class {
      parseFromString(str: string, type: string) {
        return {
          documentElement: { tagName: 'SVG', raw: str, mime: type } as any,
          querySelector: () => null,
        };
      }
    };

    try {
      const elem = parseSvgElement('<svg width="100" height="100"></svg>');
      assert.ok(elem);
      assert.strictEqual((elem as any).tagName, 'SVG');
    } finally {
      (globalThis as any).DOMParser = origDOMParser;
    }
  });

  it('exportDocumentToPdf convierte texto a curvas por defecto (outlineText=true) y omite <text> SVG', async () => {
    const docWithText: Document = {
      id: 'doc-text-pdf',
      type: 'document',
      name: 'Doc Con Texto',
      width: 500,
      height: 400,
      children: [
        {
          id: 'layer-text',
          name: 'Capa Texto',
          type: 'layer',
          children: [
            {
              id: 'text-1',
              type: 'text',
              name: 'Titular',
              x: 50,
              y: 50,
              text: 'PDF Curvas',
              fontSize: 24,
              fontFamily: 'Inter',
              fill: '#000000',
            },
          ],
        },
      ],
    };

    let renderedSvgOutline = '';
    await exportDocumentToPdf(docWithText, {
      parseElement: (svgString) => {
        renderedSvgOutline = svgString;
        return { tagName: 'svg' } as any;
      },
      renderSvg: async () => {},
    });

    // Con outlineText=true (por defecto), el texto fue vectorizado en <path> y no existe <text>
    assert.ok(renderedSvgOutline.includes('<path'));
    assert.strictEqual(renderedSvgOutline.includes('<text'), false);

    let renderedSvgTextOnly = '';
    await exportDocumentToPdf(docWithText, {
      outlineText: false,
      parseElement: (svgString) => {
        renderedSvgTextOnly = svgString;
        return { tagName: 'svg' } as any;
      },
      renderSvg: async () => {},
    });

    // Con outlineText=false, se exporta el elemento <text> nativo de SVG
    assert.ok(renderedSvgTextOnly.includes('<text'));
  });
});

