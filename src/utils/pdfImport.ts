import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { LayerChildNode, Artboard } from '../types/scene-graph.ts';
import { parseSvgString } from './svgImport.ts';

export interface PdfPageImportResult {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly LayerChildNode[];
  readonly svgString: string;
}

export interface PdfImportResult {
  readonly success: boolean;
  readonly pages: readonly PdfPageImportResult[];
  readonly shapes: readonly LayerChildNode[];
  readonly artboards: readonly Artboard[];
  readonly width: number;
  readonly height: number;
  readonly error?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toHexByte(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0');
}

function rgbArgsToHex(args: any[]): string {
  if (!args || args.length === 0) return '#000000';
  if (typeof args[0] === 'string' && args[0].startsWith('#')) {
    return args[0];
  }
  const r = args[0] <= 1 && args[1] <= 1 && args[2] <= 1 && (args[0] > 0 || args[1] > 0 || args[2] > 0)
    ? args[0] * 255
    : args[0];
  const g = args[0] <= 1 && args[1] <= 1 && args[2] <= 1 && (args[0] > 0 || args[1] > 0 || args[2] > 0)
    ? args[1] * 255
    : args[1];
  const b = args[0] <= 1 && args[1] <= 1 && args[2] <= 1 && (args[0] > 0 || args[1] > 0 || args[2] > 0)
    ? args[2] * 255
    : args[2];
  return `#${toHexByte(r)}#${toHexByte(g)}#${toHexByte(b)}`.replace(/##/g, '');
}

function cmykToHex(c: number, m: number, y: number, k: number): string {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function grayToHex(g: number): string {
  const val = g <= 1 ? g * 255 : g;
  const hex = toHexByte(val);
  return `#${hex}${hex}${hex}`;
}

const OPS = (pdfjsLib as any).OPS || {
  setLineWidth: 2,
  setLineCap: 3,
  setLineJoin: 4,
  setMiterLimit: 5,
  setDash: 6,
  setGState: 9,
  save: 10,
  restore: 11,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  setStrokeGray: 56,
  setFillGray: 57,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeCMYKColor: 60,
  setFillCMYKColor: 61,
  constructPath: 91,
};

function isFillOp(op: number): boolean {
  return (
    op === OPS.fill ||
    op === OPS.eoFill ||
    op === OPS.fillStroke ||
    op === OPS.eoFillStroke ||
    op === OPS.closeFillStroke ||
    op === OPS.closeEOFillStroke
  );
}

function isStrokeOp(op: number): boolean {
  return (
    op === OPS.stroke ||
    op === OPS.closeStroke ||
    op === OPS.fillStroke ||
    op === OPS.eoFillStroke ||
    op === OPS.closeFillStroke ||
    op === OPS.closeEOFillStroke
  );
}

function isEoOp(op: number): boolean {
  return (
    op === OPS.eoFill ||
    op === OPS.eoFillStroke ||
    op === OPS.closeEOFillStroke
  );
}

interface GraphicState {
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  opacity: number;
}

/**
 * Convierte una página de PDF.js en marcado SVG estándar para ser ingerido por el Scene Graph.
 */
export async function convertPdfPageToSvg(page: any): Promise<{ svg: string; width: number; height: number }> {
  const viewport = page.getViewport({ scale: 1 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);

  let state: GraphicState = {
    fillColor: '#000000',
    strokeColor: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    opacity: 1,
  };
  const stateStack: GraphicState[] = [];

  const svgElements: string[] = [];
  let currentPathParts: string[] = [];

  const ops = await page.getOperatorList();
  const fnCount = ops.fnArray.length;

  for (let i = 0; i < fnCount; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    if (fn === OPS.save) {
      stateStack.push({ ...state });
    } else if (fn === OPS.restore) {
      if (stateStack.length > 0) {
        state = stateStack.pop()!;
      }
    } else if (fn === OPS.setLineWidth) {
      state.lineWidth = Math.max(0.1, Number(args[0]) || 1);
    } else if (fn === OPS.setLineCap) {
      const caps = ['butt', 'round', 'square'];
      state.lineCap = caps[args[0]] ?? 'butt';
    } else if (fn === OPS.setLineJoin) {
      const joins = ['miter', 'round', 'bevel'];
      state.lineJoin = joins[args[0]] ?? 'miter';
    } else if (fn === OPS.setStrokeRGBColor) {
      state.strokeColor = rgbArgsToHex(args);
    } else if (fn === OPS.setFillRGBColor) {
      state.fillColor = rgbArgsToHex(args);
    } else if (fn === OPS.setStrokeGray) {
      state.strokeColor = grayToHex(Number(args[0]) || 0);
    } else if (fn === OPS.setFillGray) {
      state.fillColor = grayToHex(Number(args[0]) || 0);
    } else if (fn === OPS.setStrokeCMYKColor) {
      state.strokeColor = cmykToHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
    } else if (fn === OPS.setFillCMYKColor) {
      state.fillColor = cmykToHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
    } else if (fn === OPS.constructPath) {
      // args: [drawingType, subpathsArray, bbox]
      const drawingType = args[0];
      const subpaths = args[1] || [];
      const pathDParts: string[] = [];

      for (const steps of subpaths) {
        let stepIdx = 0;
        const len = steps.length || Object.keys(steps).length;
        while (stepIdx < len) {
          const code = steps[stepIdx++];
          if (code === 0) {
            // moveTo
            const px = steps[stepIdx++];
            const py = steps[stepIdx++];
            const [vx, vy] = viewport.convertToViewportPoint(px, py);
            pathDParts.push(`M ${vx.toFixed(2)} ${vy.toFixed(2)}`);
          } else if (code === 1) {
            // lineTo
            const px = steps[stepIdx++];
            const py = steps[stepIdx++];
            const [vx, vy] = viewport.convertToViewportPoint(px, py);
            pathDParts.push(`L ${vx.toFixed(2)} ${vy.toFixed(2)}`);
          } else if (code === 2) {
            // curveTo (cubic bezier)
            const cp1x = steps[stepIdx++];
            const cp1y = steps[stepIdx++];
            const cp2x = steps[stepIdx++];
            const cp2y = steps[stepIdx++];
            const px = steps[stepIdx++];
            const py = steps[stepIdx++];
            const [vcp1x, vcp1y] = viewport.convertToViewportPoint(cp1x, cp1y);
            const [vcp2x, vcp2y] = viewport.convertToViewportPoint(cp2x, cp2y);
            const [vx, vy] = viewport.convertToViewportPoint(px, py);
            pathDParts.push(
              `C ${vcp1x.toFixed(2)} ${vcp1y.toFixed(2)} ${vcp2x.toFixed(2)} ${vcp2y.toFixed(2)} ${vx.toFixed(2)} ${vy.toFixed(2)}`
            );
          } else if (code === 3) {
            // curveTo2
            const cp2x = steps[stepIdx++];
            const cp2y = steps[stepIdx++];
            const px = steps[stepIdx++];
            const py = steps[stepIdx++];
            const [vcp2x, vcp2y] = viewport.convertToViewportPoint(cp2x, cp2y);
            const [vx, vy] = viewport.convertToViewportPoint(px, py);
            pathDParts.push(`S ${vcp2x.toFixed(2)} ${vcp2y.toFixed(2)} ${vx.toFixed(2)} ${vy.toFixed(2)}`);
          } else if (code === 4) {
            // closePath
            pathDParts.push('Z');
          }
        }
      }

      if (pathDParts.length > 0) {
        const hasFill = isFillOp(drawingType);
        const hasStroke = isStrokeOp(drawingType);
        const fill = hasFill ? state.fillColor : 'none';
        const stroke = hasStroke ? state.strokeColor : 'none';
        const fillRule = isEoOp(drawingType) ? ' fill-rule="evenodd"' : '';

        svgElements.push(
          `  <path d="${pathDParts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${state.lineWidth}" stroke-linecap="${state.lineCap}" stroke-linejoin="${state.lineJoin}"${fillRule} />`
        );
      }
    } else if (fn === OPS.moveTo) {
      const [vx, vy] = viewport.convertToViewportPoint(args[0], args[1]);
      currentPathParts.push(`M ${vx.toFixed(2)} ${vy.toFixed(2)}`);
    } else if (fn === OPS.lineTo) {
      const [vx, vy] = viewport.convertToViewportPoint(args[0], args[1]);
      currentPathParts.push(`L ${vx.toFixed(2)} ${vy.toFixed(2)}`);
    } else if (fn === OPS.curveTo) {
      const [vcp1x, vcp1y] = viewport.convertToViewportPoint(args[0], args[1]);
      const [vcp2x, vcp2y] = viewport.convertToViewportPoint(args[2], args[3]);
      const [vx, vy] = viewport.convertToViewportPoint(args[4], args[5]);
      currentPathParts.push(
        `C ${vcp1x.toFixed(2)} ${vcp1y.toFixed(2)} ${vcp2x.toFixed(2)} ${vcp2y.toFixed(2)} ${vx.toFixed(2)} ${vy.toFixed(2)}`
      );
    } else if (fn === OPS.closePath) {
      currentPathParts.push('Z');
    } else if (fn === OPS.rectangle) {
      const x = args[0];
      const y = args[1];
      const w = args[2];
      const h = args[3];
      const [vx1, vy1] = viewport.convertToViewportPoint(x, y + h);
      const [vx2, vy2] = viewport.convertToViewportPoint(x + w, y);
      currentPathParts.push(
        `M ${vx1.toFixed(2)} ${vy1.toFixed(2)} L ${vx2.toFixed(2)} ${vy1.toFixed(2)} L ${vx2.toFixed(2)} ${vy2.toFixed(2)} L ${vx1.toFixed(2)} ${vy2.toFixed(2)} Z`
      );
    } else if (isFillOp(fn) || isStrokeOp(fn)) {
      if (currentPathParts.length > 0) {
        const hasFill = isFillOp(fn);
        const hasStroke = isStrokeOp(fn);
        const fill = hasFill ? state.fillColor : 'none';
        const stroke = hasStroke ? state.strokeColor : 'none';
        const fillRule = isEoOp(fn) ? ' fill-rule="evenodd"' : '';

        svgElements.push(
          `  <path d="${currentPathParts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${state.lineWidth}" stroke-linecap="${state.lineCap}" stroke-linejoin="${state.lineJoin}"${fillRule} />`
        );
        currentPathParts = [];
      }
    }
  }

  // Extraer texto tipográfico de la página
  try {
    const textContent = await page.getTextContent();
    if (textContent && textContent.items) {
      for (const item of textContent.items) {
        if (!item || !item.str || !item.str.trim()) continue;
        const tf = item.transform;
        if (!tf || tf.length < 6) continue;

        const a = tf[0];
        const b = tf[1];
        const e = tf[4];
        const f = tf[5];

        const fontSize = Math.round(Math.hypot(a, b)) || 14;
        const [vx, vy] = viewport.convertToViewportPoint(e, f);
        const angle = Math.atan2(b, a);
        const rotAttr =
          Math.abs(angle) > 1e-4
            ? ` transform="rotate(${((angle * 180) / Math.PI).toFixed(2)} ${vx.toFixed(2)} ${vy.toFixed(2)})"`
            : '';

        svgElements.push(
          `  <text x="${vx.toFixed(2)}" y="${vy.toFixed(2)}" font-size="${fontSize}" fill="${state.fillColor}" font-family="sans-serif"${rotAttr}>${escapeXml(item.str)}</text>`
        );
      }
    }
  } catch {
    // Si no hay capas de texto disponibles continúa
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...svgElements,
    '</svg>',
  ].join('\n');

  return { svg, width, height };
}

/**
 * Parsea un documento PDF completo desde un buffer binario (ArrayBuffer o Uint8Array)
 * y devuelve figuras vectoriales nativas y mesas de trabajo (Artboards) para Vectedit.
 */
export async function parsePdfBytes(data: ArrayBuffer | Uint8Array): Promise<PdfImportResult> {
  try {
    const uint8Data = data instanceof Uint8Array ? data : new Uint8Array(data);
    const loadingTask = (pdfjsLib as any).getDocument({
      data: uint8Data,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    const pages: PdfPageImportResult[] = [];
    const allShapes: LayerChildNode[] = [];
    const artboards: Artboard[] = [];

    let currentX = 0;
    let maxHeight = 0;

    for (let pageIdx = 1; pageIdx <= numPages; pageIdx++) {
      const page = await pdfDoc.getPage(pageIdx);
      const { svg, width, height } = await convertPdfPageToSvg(page);
      const importResult = parseSvgString(svg);

      const pageShapes = importResult.success ? importResult.shapes : [];
      maxHeight = Math.max(maxHeight, height);

      // Si es multipágina o tiene mesas de trabajo, asignar un Artboard para esta página
      if (numPages > 1) {
        const artboard: Artboard = {
          id: `artboard-pdf-${pageIdx}-${Date.now()}`,
          name: `Página ${pageIdx}`,
          x: currentX,
          y: 0,
          width,
          height,
        };
        artboards.push(artboard);

        // Desplazar las figuras a la coordenada X de la mesa
        const offsetNode = (node: LayerChildNode): LayerChildNode => {
          if (node.type === 'group') {
            return {
              ...node,
              children: node.children.map(offsetNode),
            };
          }
          if (node.type === 'path') {
            return {
              ...node,
              x: node.x + currentX,
              points: node.points.map((pt) => ({
                ...pt,
                x: pt.x + currentX,
                handleIn: pt.handleIn ? { ...pt.handleIn, x: pt.handleIn.x + currentX } : undefined,
                handleOut: pt.handleOut ? { ...pt.handleOut, x: pt.handleOut.x + currentX } : undefined,
              })),
            };
          }
          return {
            ...node,
            x: node.x + currentX,
          };
        };

        const offsetShapes = pageShapes.map(offsetNode);

        allShapes.push(...offsetShapes);
        pages.push({
          pageIndex: pageIdx - 1,
          width,
          height,
          shapes: offsetShapes,
          svgString: svg,
        });

        currentX += width + 100; // 100px separación entre mesas
      } else {
        allShapes.push(...pageShapes);
        pages.push({
          pageIndex: 0,
          width,
          height,
          shapes: pageShapes,
          svgString: svg,
        });
        currentX = width;
      }
    }

    return {
      success: true,
      pages,
      shapes: allShapes,
      artboards,
      width: Math.max(1, currentX),
      height: Math.max(1, maxHeight),
    };
  } catch (err) {
    return {
      success: false,
      pages: [],
      shapes: [],
      artboards: [],
      width: 0,
      height: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parsea un archivo File de tipo PDF (.pdf / application/pdf).
 */
export async function parsePdfFile(file: File): Promise<PdfImportResult> {
  const buffer = await file.arrayBuffer();
  return parsePdfBytes(buffer);
}
