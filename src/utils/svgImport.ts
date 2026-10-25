import type { LayerChildNode } from '../types/scene-graph.ts';
import type {
  SvgElementLike,
  SvgImportResult,
  SvgContext,
  CssRule,
} from './svg/types.ts';
import { parseXmlToElement } from './svg/xmlParser.ts';
import { parseCssRules, parseSvgFilters, resolveElementStyles } from './svg/styles.ts';
import { parseSvgGradients } from './svg/gradients.ts';
import { parseSvgElement } from './svg/elementConverters.ts';

export type {
  SvgRawGradient,
  SvgImportResult,
  SvgSubpath,
  SvgPathParseResult,
  BezierSegment,
  SvgElementLike,
} from './svg/types.ts';
export { arcToBezier, parseSvgPathD } from './svg/pathParser.ts';

/**
 * Parsea una cadena XML SVG completa y genera figuras vectoriales nativas para Vectedit.
 */
export function parseSvgString(svgText: string): SvgImportResult {
  if (!svgText || typeof svgText !== 'string' || !svgText.trim()) {
    return { success: false, shapes: [], width: 0, height: 0, error: 'Contenido SVG vacío' };
  }

  let svgEl: SvgElementLike | null = null;

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        return { success: false, shapes: [], width: 0, height: 0, error: parserError.textContent || 'Error de parseo XML' };
      }
      svgEl = doc.querySelector('svg') as unknown as SvgElementLike;
    } catch {
      svgEl = null;
    }
  }

  if (!svgEl) {
    svgEl = parseXmlToElement(svgText);
  }

  if (!svgEl) {
    return { success: false, shapes: [], width: 0, height: 0, error: 'No se encontró el elemento <svg> raíz' };
  }

  // 1. Parsear reglas de estilos en bloques <style>
  const cssRules: CssRule[] = [];
  const styleElements = svgEl.querySelectorAll ? svgEl.querySelectorAll('style') : [];
  for (const styleEl of styleElements) {
    if (styleEl.textContent) {
      cssRules.push(...parseCssRules(styleEl.textContent));
    }
  }

  // 2. Dimensiones y viewBox
  let width = parseFloat(svgEl.getAttribute('width') || '0');
  let height = parseFloat(svgEl.getAttribute('height') || '0');
  const viewBoxAttr = svgEl.getAttribute('viewBox');

  let vbMinX = 0;
  let vbMinY = 0;
  let vbWidth = 0;
  let vbHeight = 0;
  let hasViewBox = false;

  if (viewBoxAttr) {
    const vbParts = viewBoxAttr.trim().split(/[\s,]+/).map(parseFloat);
    if (vbParts.length === 4 && !isNaN(vbParts[0]) && !isNaN(vbParts[1]) && vbParts[2] > 0 && vbParts[3] > 0) {
      vbMinX = vbParts[0];
      vbMinY = vbParts[1];
      vbWidth = vbParts[2];
      vbHeight = vbParts[3];
      hasViewBox = true;
      if (!width || width <= 0) width = vbWidth;
      if (!height || height <= 0) height = vbHeight;
    }
  }

  if (!width || width <= 0) width = 800;
  if (!height || height <= 0) height = 600;

  // Transformación raíz derivada del viewBox
  let rootMatrix: [number, number, number, number, number, number] | undefined = undefined;
  if (hasViewBox && (vbWidth !== width || vbHeight !== height || vbMinX !== 0 || vbMinY !== 0)) {
    const scaleX = width / vbWidth;
    const scaleY = height / vbHeight;
    const scale = Math.min(scaleX, scaleY);
    const tx = -vbMinX * scale + (width - vbWidth * scale) / 2;
    const ty = -vbMinY * scale + (height - vbHeight * scale) / 2;
    rootMatrix = [scale, 0, 0, scale, tx, ty];
  }

  // 3. Parsear degradados y filtros (con cssRules y rootMatrix)
  const gradients = parseSvgGradients(svgEl, cssRules, rootMatrix);
  const filters = parseSvgFilters(svgEl);

  // 4. Contexto base inicializado desde el propio <svg>
  let baseContext: SvgContext = {};
  if (rootMatrix) {
    baseContext.transformMatrix = rootMatrix;
  }
  baseContext = resolveElementStyles(svgEl, baseContext, cssRules, gradients, filters);

  const shapes: LayerChildNode[] = [];
  for (let i = 0; i < svgEl.children.length; i++) {
    const child = svgEl.children[i];
    const parsed = parseSvgElement(child, baseContext, cssRules, gradients, filters);
    if (parsed) {
      shapes.push(parsed);
    }
  }

  return {
    success: shapes.length > 0,
    shapes,
    width,
    height,
    error: shapes.length === 0 ? 'No se encontraron figuras vectoriales válidas en el SVG' : undefined,
  };
}
