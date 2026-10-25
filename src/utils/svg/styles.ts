import type {
  BlendMode,
  DropShadow,
} from '../../types/scene-graph.ts';
import type { CssRule, SvgContext, SvgElementLike, SvgRawGradient } from './types.ts';
import { normalizeColor } from '../color.ts';
import { multiplyMatrices, parseTransformAttr } from './matrix.ts';

/**
 * Parsea reglas CSS desde bloques <style>
 */
export function parseCssRules(cssText: string): CssRule[] {
  const rules: CssRule[] = [];
  const cleanCss = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(cleanCss)) !== null) {
    const rawSelectors = match[1].trim();
    const rawDecls = match[2].trim();
    const styles: Record<string, string> = {};

    const declPairs = rawDecls.split(';');
    for (const pair of declPairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const prop = pair.slice(0, colonIdx).trim().toLowerCase();
        const val = pair.slice(colonIdx + 1).trim();
        if (prop && val) {
          styles[prop] = val;
        }
      }
    }

    const selectors = rawSelectors.split(',');
    for (const sel of selectors) {
      const s = sel.trim();
      if (s) {
        rules.push({ selector: s, styles });
      }
    }
  }

  return rules;
}

/**
 * Parsea una cadena de estilo inline 'prop: val; prop2: val2'
 */
export function parseInlineStyle(styleStr: string | null): Record<string, string> {
  if (!styleStr) return {};
  const styles: Record<string, string> = {};
  const pairs = styleStr.split(';');
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const prop = pair.slice(0, colonIdx).trim().toLowerCase();
      const val = pair.slice(colonIdx + 1).trim();
      if (prop && val) {
        styles[prop] = val;
      }
    }
  }
  return styles;
}

/**
 * Evalúa las reglas CSS coincidentes para un elemento
 */
export function getMatchedCssStyles(el: SvgElementLike, rules: CssRule[]): Record<string, string> {
  const matched: Record<string, string> = {};
  const elTag = el.tagName.toLowerCase();
  const elId = el.getAttribute('id');
  const classAttr = el.getAttribute('class') || '';
  const elClasses = classAttr.trim().split(/\s+/).filter(Boolean);

  for (const rule of rules) {
    const sel = rule.selector;
    let isMatch = false;

    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (elClasses.includes(cls)) isMatch = true;
    } else if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (elId === id) isMatch = true;
    } else if (sel.toLowerCase() === elTag) {
      isMatch = true;
    } else if (sel === '*') {
      isMatch = true;
    }

    if (isMatch) {
      Object.assign(matched, rule.styles);
    }
  }

  return matched;
}

/**
 * Extrae componentes de color y opacidad de cadenas como rgba() o hex8.
 */
export function extractColorAndAlpha(val: string): { color: string; opacity?: number } {
  const trimmed = val.trim();
  let opacity: number | undefined;

  const rgbaMatch = trimmed.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
  if (rgbaMatch) {
    const a = parseFloat(rgbaMatch[1]);
    if (!isNaN(a)) opacity = Math.max(0, Math.min(1, a));
  }
  const hex8Match = trimmed.match(/^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/);
  if (hex8Match) {
    const a = parseInt(hex8Match[2], 16) / 255;
    opacity = Math.max(0, Math.min(1, a));
  }

  const norm = normalizeColor(trimmed) ?? '#000000';
  return { color: norm, opacity };
}

/**
 * Parsea filtros CSS drop-shadow(...) inline o en atributos style.
 */
export function parseCssDropShadow(str: string): DropShadow | undefined {
  const match = str.match(/drop-shadow\((.+)\)/i);
  if (!match) return undefined;
  const content = match[1].trim();

  let colorPart = '';
  let rest = content;

  const colorFnMatch = content.match(/(rgba?\([^)]+\)|hsla?\([^)]+\))/i);
  if (colorFnMatch) {
    colorPart = colorFnMatch[1];
    rest = content.replace(colorFnMatch[1], ' ').trim();
  }

  const parts = rest.split(/\s+/).filter(Boolean);
  const numericParts: number[] = [];
  for (const p of parts) {
    if (p.startsWith('#') || !/^[+-]?\d/.test(p)) {
      if (!colorPart) colorPart = p;
    } else {
      const num = parseFloat(p);
      if (!isNaN(num)) numericParts.push(num);
    }
  }

  const offsetX = numericParts[0] ?? 0;
  const offsetY = numericParts[1] ?? 0;
  const blur = numericParts[2] ?? 0;
  const { color, opacity } = extractColorAndAlpha(colorPart || '#000000');

  return {
    color,
    ...(opacity !== undefined ? { opacity } : {}),
    offsetX,
    offsetY,
    blur: Math.max(0, blur),
  };
}

/**
 * Parsea filtros SVG (<filter>) que contengan <feDropShadow>.
 */
export function parseSvgFilters(doc: SvgElementLike): Map<string, DropShadow> {
  const filters = new Map<string, DropShadow>();

  function searchElement(el: SvgElementLike) {
    if (el.tagName.toLowerCase() === 'filter') {
      const id = el.getAttribute('id');
      if (id) {
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          if (child.tagName.toLowerCase() === 'fedropshadow') {
            const dx = parseFloat(child.getAttribute('dx') || '0');
            const dy = parseFloat(child.getAttribute('dy') || '0');
            const stdDevAttr = child.getAttribute('stdDeviation') || '0';
            const stdDevParts = stdDevAttr.trim().split(/[\s,]+/).map(parseFloat);
            const stdDev = !isNaN(stdDevParts[0]) ? stdDevParts[0] : 0;
            const blur = Math.max(0, stdDev * 2);
            const floodColor = child.getAttribute('flood-color') || '#000000';
            const floodOpacityAttr = child.getAttribute('flood-opacity');
            const floodOpacity = floodOpacityAttr !== null ? parseFloat(floodOpacityAttr) : undefined;
            const { color, opacity: extractedOpacity } = extractColorAndAlpha(floodColor);
            const finalOpacity = floodOpacity !== undefined && !isNaN(floodOpacity) ? Math.max(0, Math.min(1, floodOpacity)) : extractedOpacity;

            const shadow: DropShadow = {
              color,
              ...(finalOpacity !== undefined ? { opacity: finalOpacity } : {}),
              offsetX: isNaN(dx) ? 0 : dx,
              offsetY: isNaN(dy) ? 0 : dy,
              blur,
            };
            filters.set(id, shadow);
            break;
          }
        }
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      searchElement(el.children[i]);
    }
  }

  searchElement(doc);
  return filters;
}

/**
 * Extrae y resuelve estilos combinados para un elemento siguiendo la especificidad estándar
 * (inline style > atributos de presentación > reglas CSS <style> > contexto padre).
 */
export function resolveElementStyles(
  el: SvgElementLike,
  parentContext: SvgContext,
  cssRules: CssRule[],
  gradients: Map<string, SvgRawGradient>,
  filters?: Map<string, DropShadow>
): SvgContext {
  const css = getMatchedCssStyles(el, cssRules);
  const inline = parseInlineStyle(el.getAttribute('style'));
  const context: SvgContext = { ...parentContext };

  const getProp = (propName: string, attrName: string = propName): string | undefined => {
    if (inline[propName] !== undefined) return inline[propName];
    const attr = el.getAttribute(attrName);
    if (attr !== null && attr !== undefined) return attr;
    if (css[propName] !== undefined) return css[propName];
    return undefined;
  };

  // 1. Fill
  const fillVal = getProp('fill');
  if (fillVal !== undefined) {
    if (fillVal === 'none' || fillVal === 'transparent') {
      context.fill = 'none';
    } else if (fillVal === 'currentColor') {
      context.fill = '#000000';
    } else if (fillVal.includes('url(')) {
      const idMatch = fillVal.match(/url\(\s*['"]?#?([^'")\s]+)['"]?\s*\)/i);
      if (idMatch && gradients.has(idMatch[1])) {
        context.fill = gradients.get(idMatch[1]);
      } else {
        context.fill = '#000000';
      }
    } else {
      context.fill = fillVal;
    }
  }

  // 2. Stroke
  const strokeVal = getProp('stroke');
  if (strokeVal !== undefined) {
    if (strokeVal === 'none' || strokeVal === 'transparent') {
      context.stroke = 'none';
    } else if (strokeVal === 'currentColor') {
      context.stroke = '#000000';
    } else if (strokeVal.includes('url(')) {
      const idMatch = strokeVal.match(/url\(\s*['"]?#?([^'")\s]+)['"]?\s*\)/i);
      if (idMatch && gradients.has(idMatch[1])) {
        context.stroke = gradients.get(idMatch[1]);
      } else {
        context.stroke = '#000000';
      }
    } else {
      context.stroke = strokeVal;
    }
  }

  // 3. Stroke Width
  const swVal = getProp('stroke-width');
  if (swVal !== undefined) {
    const sw = parseFloat(swVal);
    if (!isNaN(sw)) context.strokeWidth = sw;
  }

  // 4. Stroke Linecap
  const slcVal = getProp('stroke-linecap');
  if (slcVal === 'butt' || slcVal === 'round' || slcVal === 'square') {
    context.strokeLineCap = slcVal;
  }

  // 5. Stroke Linejoin
  const sljVal = getProp('stroke-linejoin');
  if (sljVal === 'miter' || sljVal === 'round' || sljVal === 'bevel') {
    context.strokeLineJoin = sljVal;
  }

  // 6. Stroke Dasharray
  const sdaVal = getProp('stroke-dasharray');
  if (sdaVal !== undefined && sdaVal !== 'none') {
    const parts = sdaVal.trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
    if (parts.length > 0) {
      context.strokeDashArray = parts;
    }
  }

  // 7. Opacity
  const opVal = getProp('opacity');
  if (opVal !== undefined) {
    const op = parseFloat(opVal);
    if (!isNaN(op)) {
      context.opacity = (context.opacity ?? 1) * op;
    }
  }

  // 8. Transform
  const transformAttr = el.getAttribute('transform');
  const localMatrix = parseTransformAttr(transformAttr);
  if (localMatrix) {
    context.transformMatrix = context.transformMatrix
      ? multiplyMatrices(context.transformMatrix, localMatrix)
      : localMatrix;
  }

  // 9. Fill Rule
  const frVal = getProp('fill-rule');
  if (frVal === 'evenodd' || frVal === 'nonzero') {
    context.fillRule = frVal;
  }

  // 10. Blend Mode
  const bmVal = getProp('mix-blend-mode');
  if (bmVal !== undefined) {
    const validModes = new Set([
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
    ]);
    const lower = bmVal.trim().toLowerCase();
    if (validModes.has(lower)) {
      context.blendMode = lower as BlendMode;
    }
  }

  // 11. Drop Shadow / Filter
  const filterVal = getProp('filter');
  if (filterVal !== undefined) {
    if (filterVal.includes('url(')) {
      const idMatch = filterVal.match(/url\(\s*['"]?#?([^'")\s]+)['"]?\s*\)/i);
      if (idMatch && filters && filters.has(idMatch[1])) {
        context.dropShadow = filters.get(idMatch[1]);
      }
    } else if (filterVal.includes('drop-shadow(')) {
      const parsedShadow = parseCssDropShadow(filterVal);
      if (parsedShadow) {
        context.dropShadow = parsedShadow;
      }
    }
  }

  return context;
}
