import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateExportBounds,
  renderDocumentToCanvas,
  exportDocumentToRasterBlob,
} from '../src/utils/exportRaster.ts';
import type { Document, Rectangle, Ellipse, Group } from '../src/types/scene-graph.ts';

describe('Exportación Ráster (PNG / WebP / JPEG)', () => {
  it('calculateExportBounds calcula correctamente las dimensiones del documento completo', () => {
    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 1920,
      height: 1080,
      children: [],
    };

    const bounds = calculateExportBounds(doc, false);
    assert.deepStrictEqual(bounds, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('calculateExportBounds calcula los límites de la selección para rectángulo y elipse', () => {
    const rect: Rectangle = {
      id: 'r1',
      name: 'R1',
      type: 'rectangle',
      x: 50,
      y: 60,
      width: 100,
      height: 80,
    };

    const ellipse: Ellipse = {
      id: 'e1',
      name: 'E1',
      type: 'ellipse',
      x: 300,
      y: 200,
      radiusX: 50,
      radiusY: 40,
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 800,
      height: 600,
      children: [
        {
          id: 'l1',
          name: 'L1',
          type: 'layer',
          children: [rect, ellipse],
        },
      ],
    };

    // Solo rect: x=50, y=60, w=100, h=80
    const rectBounds = calculateExportBounds(doc, true, ['r1']);
    assert.deepStrictEqual(rectBounds, {
      x: 50,
      y: 60,
      width: 100,
      height: 80,
    });

    // Solo elipse: x = 300 - 50 = 250, y = 200 - 40 = 160, w = 100, h = 80
    const ellipseBounds = calculateExportBounds(doc, true, ['e1']);
    assert.deepStrictEqual(ellipseBounds, {
      x: 250,
      y: 160,
      width: 100,
      height: 80,
    });

    // Ambos: minX=50, minY=60, maxX=350, maxY=240 -> w=300, h=180
    const combinedBounds = calculateExportBounds(doc, true, ['r1', 'e1']);
    assert.deepStrictEqual(combinedBounds, {
      x: 50,
      y: 60,
      width: 300,
      height: 180,
    });
  });

  it('calculateExportBounds resuelve grupos jerárquicos a sus figuras hoja', () => {
    const group: Group = {
      id: 'g1',
      name: 'Grupo',
      type: 'group',
      children: [
        {
          id: 'r-in-g',
          name: 'R',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
        },
        {
          id: 'e-in-g',
          name: 'E',
          type: 'ellipse',
          x: 200,
          y: 200,
          radiusX: 20,
          radiusY: 20,
        },
      ],
    };

    const doc: Document = {
      id: 'doc-1',
      name: 'Doc',
      type: 'document',
      width: 500,
      height: 500,
      children: [
        {
          id: 'l1',
          name: 'L1',
          type: 'layer',
          children: [group],
        },
      ],
    };

    const groupBounds = calculateExportBounds(doc, true, ['g1']);
    assert.deepStrictEqual(groupBounds, {
      x: 100,
      y: 100,
      width: 120, // 220 - 100
      height: 120, // 220 - 100
    });
  });

  it('renderDocumentToCanvas escala el lienzo y aplica transformación en canvas mock', () => {
    const calls: string[] = [];
    const scales: Array<{ x: number; y: number }> = [];
    const translates: Array<{ x: number; y: number }> = [];
    let fillStyleValue = '';
    const fillRects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];

    const mockCtx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      scale: (x: number, y: number) => {
        calls.push(`scale(${x},${y})`);
        scales.push({ x, y });
      },
      translate: (x: number, y: number) => {
        calls.push(`translate(${x},${y})`);
        translates.push({ x, y });
      },
      clearRect: () => calls.push('clearRect'),
      fillRect: (x: number, y: number, w: number, h: number) => {
        calls.push(`fillRect(${x},${y},${w},${h})`);
        fillRects.push({ x, y, w, h, fill: fillStyleValue });
      },
      beginPath: () => calls.push('beginPath'),
      rect: (x: number, y: number, w: number, h: number) => calls.push(`rect(${x},${y},${w},${h})`),
      stroke: () => calls.push('stroke'),
      fill: () => calls.push('fill'),
      get fillStyle() {
        return fillStyleValue;
      },
      set fillStyle(val: string) {
        fillStyleValue = val;
      },
      set strokeStyle(_: string) {},
      set lineWidth(_: number) {},
      set globalAlpha(_: number) {},
      get globalAlpha() {
        return 1;
      },
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => mockCtx,
      toBlob: (cb: (b: Blob) => void, mime: string) => {
        cb(new Blob(['mock-data'], { type: mime }));
      },
    };

    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') return mockCanvas;
        return origDoc?.createElement?.(tag);
      },
    };

    try {
      const doc: Document = {
        id: 'doc-1',
        name: 'Doc',
        type: 'document',
        width: 400,
        height: 300,
        children: [
          {
            id: 'l1',
            name: 'L1',
            type: 'layer',
            children: [
              {
                id: 'r1',
                name: 'R1',
                type: 'rectangle',
                x: 20,
                y: 30,
                width: 100,
                height: 50,
                fill: '#38bdf8',
              },
            ],
          },
        ],
      };

      // Exportar a 2x con fondo blanco
      const canvas = renderDocumentToCanvas(doc, {
        scale: 2,
        backgroundColor: '#ffffff',
      });

      // Dimensiones escaladas: 400 * 2 = 800, 300 * 2 = 600
      assert.strictEqual(canvas.width, 800);
      assert.strictEqual(canvas.height, 600);

      // Fondo blanco dibujado sobre todo el canvas
      assert.strictEqual(fillRects[0].w, 800);
      assert.strictEqual(fillRects[0].h, 600);
      assert.strictEqual(fillRects[0].fill, '#ffffff');

      // Escala 2x aplicada
      assert.deepStrictEqual(scales[0], { x: 2, y: 2 });
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('exportDocumentToRasterBlob genera el MIME type correcto para png, webp y jpeg', async () => {
    let capturedMime = '';
    const mockCanvas = {
      width: 100,
      height: 100,
      getContext: () => ({
        save: () => {},
        restore: () => {},
        scale: () => {},
        translate: () => {},
        clearRect: () => {},
        fillRect: () => {},
        beginPath: () => {},
        rect: () => {},
        fill: () => {},
        stroke: () => {},
        get globalAlpha() { return 1; },
        set globalAlpha(_: number) {},
      }),
      toBlob: (cb: (b: Blob) => void, mime: string) => {
        capturedMime = mime;
        cb(new Blob(['test'], { type: mime }));
      },
    };

    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') return mockCanvas;
        return origDoc?.createElement?.(tag);
      },
    };

    try {
      const doc: Document = {
        id: 'doc-1',
        name: 'Doc',
        type: 'document',
        width: 100,
        height: 100,
        children: [],
      };

      // PNG
      const blobPng = await exportDocumentToRasterBlob(doc, { format: 'png' });
      assert.strictEqual(capturedMime, 'image/png');
      assert.strictEqual(blobPng.type, 'image/png');

      // WebP
      const blobWebp = await exportDocumentToRasterBlob(doc, { format: 'webp' });
      assert.strictEqual(capturedMime, 'image/webp');
      assert.strictEqual(blobWebp.type, 'image/webp');

      // JPEG
      const blobJpeg = await exportDocumentToRasterBlob(doc, { format: 'jpeg' });
      assert.strictEqual(capturedMime, 'image/jpeg');
      assert.strictEqual(blobJpeg.type, 'image/jpeg');
    } finally {
      (globalThis as any).document = origDoc;
    }
  });
});
