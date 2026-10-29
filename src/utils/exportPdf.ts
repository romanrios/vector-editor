import { jsPDF } from 'jspdf';
import type { Svg2pdfOptions } from 'svg2pdf.js';
// @ts-expect-error - svg2pdf ESM subpath resolution for browser and node bundlers
import { svg2pdf as svg2pdfFn } from 'svg2pdf.js/dist/svg2pdf.es.min.js';
import type { Document } from '../types/scene-graph.ts';
import { exportDocumentToSvg } from './exportSvg.ts';
import { calculateExportBounds } from './exportRaster.ts';
import { isNonePaint } from './color.ts';
import { convertDocumentTextToCurves } from './textToPath.ts';

const svg2pdf = svg2pdfFn as (element: Element, pdf: jsPDF, options?: Svg2pdfOptions) => Promise<jsPDF>;

export interface ExportPdfOptions {
  /**
   * Alcance de la exportación:
   * - 'document': Todo el documento en las dimensiones del lienzo base (ancho y alto).
   * - 'selection': Solo las figuras seleccionadas, ajustado a sus límites geométricos.
   * - 'artboard': Mesas de trabajo.
   */
  readonly scope?: 'document' | 'selection' | 'artboard';

  /**
   * IDs de las figuras seleccionadas cuando scope === 'selection'.
   */
  readonly selectedIds?: readonly string[];

  /**
   * ID de la mesa de trabajo específica. Si scope === 'artboard' y se omite (o es 'all'),
   * se exportan todas las mesas de trabajo.
   */
  readonly artboardId?: string;

  /**
   * Modo de estructuración cuando se exportan todas las mesas de trabajo:
   * - 'single': Un único archivo PDF con múltiples páginas (una página por mesa).
   * - 'individual': Archivos PDF independientes por mesa (gestionado en DialogsController).
   */
  readonly artboardMode?: 'single' | 'individual';

  /**
   * Color de fondo. Si es nulo, 'transparent' o 'none', el fondo no se dibuja (transparente).
   * Si es '#ffffff' u otro color, se dibuja un rectángulo de fondo.
   */
  readonly backgroundColor?: string | null;

  /**
   * Precisión de decimales en las coordenadas SVG subyacentes (por defecto 2).
   */
  readonly precision?: number;

  /**
   * Si es true (por defecto), convierte todos los textos tipográficos a trazados vectoriales (curvas Bézier)
   * antes de generar el SVG y PDF. Esto garantiza una fidelidad visual del 100% en cualquier visor o sistema.
   * Si es false, exporta elementos <text> SVG estándar.
   */
  readonly outlineText?: boolean;

  /**
   * Gancho opcional para parsear la cadena SVG a Element (útil para pruebas en entornos no DOM).
   */
  readonly parseElement?: (svgString: string) => Element;

  /**
   * Gancho opcional para renderizar el Element SVG en jsPDF (útil para pruebas unitarias).
   */
  readonly renderSvg?: (
    element: Element,
    pdf: jsPDF,
    options: { x: number; y: number; width: number; height: number }
  ) => Promise<void>;
}

/**
 * Parsea una cadena de texto SVG a un elemento del DOM compatible con svg2pdf.
 */
export function parseSvgElement(svgString: string): Element {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error(`Error de sintaxis SVG al preparar PDF: ${parserError.textContent}`);
    }
    return doc.documentElement;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).DOMParser) {
    const parser = new (globalThis as any).DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    return doc.documentElement;
  }
  throw new Error('No se encontró un parser DOM (DOMParser) en el entorno actual para exportar PDF.');
}

/**
 * Genera una instancia de jsPDF a partir de un documento del Scene Graph de Vectedit.
 * Soporta exportación completa, por selección y mesas de trabajo (individuales o multipágina).
 */
export async function exportDocumentToPdf(
  doc: Document,
  options: ExportPdfOptions = {}
): Promise<jsPDF> {
  const {
    scope = 'document',
    selectedIds = [],
    artboardId,
    artboardMode = 'single',
    backgroundColor,
    precision = 2,
    outlineText = true,
    parseElement = parseSvgElement,
    renderSvg = async (elem, pdf, opts) => {
      await svg2pdf(elem, pdf, opts);
    },
  } = options;

  const shouldOutlineText = outlineText !== false;
  const targetDoc = shouldOutlineText
    ? await convertDocumentTextToCurves(doc, { precision })
    : doc;

  const shouldIncludeBg = Boolean(
    backgroundColor && !isNonePaint(backgroundColor) && backgroundColor !== 'transparent'
  );
  const bgColor = shouldIncludeBg ? (backgroundColor as string) : undefined;

  const artboards = targetDoc.artboards ?? [];
  const isAllArtboards =
    scope === 'artboard' &&
    (!artboardId || artboardId === 'all') &&
    artboards.length > 0;

  if (isAllArtboards && artboardMode === 'single') {
    // Caso: Un único PDF multipágina con todas las mesas de trabajo
    const firstAb = artboards[0];
    const firstW = Math.max(1, firstAb.width);
    const firstH = Math.max(1, firstAb.height);
    const firstOrientation = firstW >= firstH ? 'landscape' : 'portrait';

    const pdf = new jsPDF({
      orientation: firstOrientation,
      unit: 'pt',
      format: [firstW, firstH],
      compress: true,
    });

    for (let i = 0; i < artboards.length; i++) {
      const ab = artboards[i];
      const w = Math.max(1, ab.width);
      const h = Math.max(1, ab.height);
      const orientation = w >= h ? 'landscape' : 'portrait';

      if (i > 0) {
        pdf.addPage([w, h], orientation);
      }

      const svgString = exportDocumentToSvg(targetDoc, {
        artboardId: ab.id,
        includeBackground: shouldIncludeBg,
        backgroundColor: bgColor,
        precision,
      });

      const elem = parseElement(svgString);
      await renderSvg(elem, pdf, { x: 0, y: 0, width: w, height: h });
    }

    return pdf;
  }

  // Dimensiones para una sola página (mesa concreta, selección o documento)
  let pageWidth = Math.max(1, targetDoc.width);
  let pageHeight = Math.max(1, targetDoc.height);
  let targetArtboardId: string | undefined = undefined;
  const isSelectionScope = scope === 'selection' && selectedIds.length > 0;

  if (isSelectionScope) {
    const bounds = calculateExportBounds(targetDoc, true, selectedIds);
    pageWidth = Math.max(1, bounds.width);
    pageHeight = Math.max(1, bounds.height);
  } else if (scope === 'artboard' && artboards.length > 0) {
    const targetAb =
      (artboardId && artboards.find((a) => a.id === artboardId)) || artboards[0];
    if (targetAb) {
      pageWidth = Math.max(1, targetAb.width);
      pageHeight = Math.max(1, targetAb.height);
      targetArtboardId = targetAb.id;
    }
  }

  const orientation = pageWidth >= pageHeight ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'pt',
    format: [pageWidth, pageHeight],
    compress: true,
  });

  const svgString = exportDocumentToSvg(targetDoc, {
    onlySelected: isSelectionScope,
    selectedIds: isSelectionScope ? selectedIds : undefined,
    artboardId: targetArtboardId,
    includeBackground: shouldIncludeBg,
    backgroundColor: bgColor,
    precision,
  });

  const elem = parseElement(svgString);
  await renderSvg(elem, pdf, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  return pdf;
}

/**
 * Exporta un documento de Vectedit a un Blob binario de formato PDF ('application/pdf').
 */
export async function exportDocumentToPdfBlob(
  doc: Document,
  options: ExportPdfOptions = {}
): Promise<Blob> {
  const pdf = await exportDocumentToPdf(doc, options);
  const blobOutput = pdf.output('blob');
  return blobOutput;
}

/**
 * Descarga en el navegador un archivo PDF mediante un elemento ancla efímero.
 *
 * @param filename Nombre del archivo destino (ej: 'escena.pdf')
 * @param blob Objeto Blob del PDF
 */
export function downloadPdf(filename: string, blob: Blob): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const normalizedFilename = filename.toLowerCase().endsWith('.pdf')
    ? filename
    : `${filename}.pdf`;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = normalizedFilename;
  anchor.style.display = 'none';
  anchor.setAttribute('aria-hidden', 'true');

  document.body.appendChild(anchor);
  anchor.click();

  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

