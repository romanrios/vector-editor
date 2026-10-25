import type { AABB, FillType, GradientStop } from '../../types/scene-graph.ts';
import type { CssRule, SvgElementLike, SvgRawGradient } from './types.ts';
import { normalizeColor } from '../color.ts';
import { applyTransform, decomposeMatrix, multiplyMatrices, parseTransformAttr } from './matrix.ts';
import { getMatchedCssStyles, parseInlineStyle } from './styles.ts';

/**
 * Parsea degradados lineales y radiales definidos en SVG (<defs> o documento).
 * Soporta herencia via href / xlink:href, gradientUnits, gradientTransform y colores CSS.
 */
export function parseSvgGradients(
  doc: SvgElementLike,
  cssRules: CssRule[] = [],
  rootMatrix?: [number, number, number, number, number, number]
): Map<string, SvgRawGradient> {
  function parseStopColorAndOpacity(el: SvgElementLike): { color: string; opacity: number } {
    let color: string | undefined;
    let opacity = 1;

    // 1. Reglas CSS desde <style>
    const css = getMatchedCssStyles(el, cssRules);
    if (css['stop-color']) color = css['stop-color'];
    if (css['stop-opacity']) {
      const o = parseFloat(css['stop-opacity']);
      if (!isNaN(o)) opacity = o;
    }

    // 2. Atributos de presentación
    const attrColor = el.getAttribute('stop-color');
    if (attrColor) color = attrColor;
    const attrOp = el.getAttribute('stop-opacity');
    if (attrOp) {
      const o = parseFloat(attrOp);
      if (!isNaN(o)) opacity = o;
    }

    // 3. Estilos inline
    const style = parseInlineStyle(el.getAttribute('style'));
    if (style['stop-color']) color = style['stop-color'];
    if (style['stop-opacity']) {
      const o = parseFloat(style['stop-opacity']);
      if (!isNaN(o)) opacity = o;
    }

    if (color === 'currentColor') {
      color = '#000000';
    }

    const norm = normalizeColor(color);
    return { color: norm ?? color ?? '#000000', opacity };
  }

  function parseStops(parent: SvgElementLike): GradientStop[] {
    const stops: GradientStop[] = [];
    const stopEls = parent.querySelectorAll ? parent.querySelectorAll('stop') : [];
    for (let idx = 0; idx < stopEls.length; idx++) {
      const stopEl = stopEls[idx];
      let offset = 0;
      const offsetAttr = stopEl.getAttribute('offset');
      if (offsetAttr !== null && offsetAttr !== undefined) {
        const trimmed = offsetAttr.trim();
        if (trimmed.endsWith('%')) {
          offset = parseFloat(trimmed) / 100;
        } else {
          offset = parseFloat(trimmed);
        }
      } else {
        offset = idx === 0 ? 0 : stops[idx - 1]?.offset ?? 0;
      }
      const { color, opacity } = parseStopColorAndOpacity(stopEl);
      stops.push({
        id: `stop-${idx + 1}`,
        offset: Math.max(0, Math.min(1, isNaN(offset) ? 0 : offset)),
        color,
        opacity,
      });
    }
    return stops;
  }

  function parseCoord(val: string | null | undefined): number | undefined {
    if (val === null || val === undefined) return undefined;
    const trimmed = val.trim();
    if (trimmed === '') return undefined;
    if (trimmed.endsWith('%')) return parseFloat(trimmed) / 100;
    const n = parseFloat(trimmed);
    return isNaN(n) ? undefined : n;
  }

  const rawMap = new Map<string, SvgRawGradient>();

  const linearEls = doc.querySelectorAll ? doc.querySelectorAll('linearGradient') : [];
  for (const lg of linearEls) {
    const id = lg.getAttribute('id');
    if (!id) continue;
    const href = (lg.getAttribute('href') || lg.getAttribute('xlink:href') || '').replace(/^#/, '');
    const gUnits = lg.getAttribute('gradientUnits');
    const gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox' =
      gUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';

    const tAttr = lg.getAttribute('gradientTransform') || lg.getAttribute('transform');
    const transformMatrix = parseTransformAttr(tAttr);

    const x1 = parseCoord(lg.getAttribute('x1'));
    const y1 = parseCoord(lg.getAttribute('y1'));
    const x2 = parseCoord(lg.getAttribute('x2'));
    const y2 = parseCoord(lg.getAttribute('y2'));

    rawMap.set(id, {
      id,
      type: 'linear',
      gradientUnits,
      x1,
      y1,
      x2,
      y2,
      transformMatrix,
      stops: parseStops(lg),
      href: href || undefined,
    });
  }

  const radialEls = doc.querySelectorAll ? doc.querySelectorAll('radialGradient') : [];
  for (const rg of radialEls) {
    const id = rg.getAttribute('id');
    if (!id) continue;
    const href = (rg.getAttribute('href') || rg.getAttribute('xlink:href') || '').replace(/^#/, '');
    const gUnits = rg.getAttribute('gradientUnits');
    const gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox' =
      gUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';

    const tAttr = rg.getAttribute('gradientTransform') || rg.getAttribute('transform');
    const transformMatrix = parseTransformAttr(tAttr);

    const cx = parseCoord(rg.getAttribute('cx'));
    const cy = parseCoord(rg.getAttribute('cy'));
    const r = parseCoord(rg.getAttribute('r'));
    const fx = parseCoord(rg.getAttribute('fx'));
    const fy = parseCoord(rg.getAttribute('fy'));

    rawMap.set(id, {
      id,
      type: 'radial',
      gradientUnits,
      cx,
      cy,
      r,
      fx,
      fy,
      transformMatrix,
      stops: parseStops(rg),
      href: href || undefined,
    });
  }

  const resolved = new Map<string, SvgRawGradient>();
  function resolveGradient(id: string, visited: Set<string> = new Set()): SvgRawGradient | undefined {
    if (visited.has(id)) return undefined;
    if (resolved.has(id)) return resolved.get(id);
    const raw = rawMap.get(id);
    if (!raw) return undefined;
    visited.add(id);

    let parent: SvgRawGradient | undefined;
    if (raw.href) {
      parent = resolveGradient(raw.href, visited);
    }

    let finalT = raw.transformMatrix ?? parent?.transformMatrix;
    const gUnits = raw.gradientUnits ?? parent?.gradientUnits ?? 'objectBoundingBox';
    if (gUnits === 'userSpaceOnUse' && rootMatrix) {
      finalT = finalT ? multiplyMatrices(rootMatrix, finalT) : rootMatrix;
    }

    const merged: SvgRawGradient = {
      id: raw.id,
      type: raw.type,
      gradientUnits: gUnits,
      x1: raw.x1 ?? parent?.x1,
      y1: raw.y1 ?? parent?.y1,
      x2: raw.x2 ?? parent?.x2,
      y2: raw.y2 ?? parent?.y2,
      cx: raw.cx ?? parent?.cx,
      cy: raw.cy ?? parent?.cy,
      r: raw.r ?? parent?.r,
      fx: raw.fx ?? parent?.fx,
      fy: raw.fy ?? parent?.fy,
      transformMatrix: finalT,
      stops: raw.stops.length > 0 ? raw.stops : (parent?.stops && parent.stops.length > 0 ? parent.stops : []),
    };

    if (merged.stops.length === 0) {
      merged.stops = [
        { id: 'stop-1', offset: 0, color: '#000000', opacity: 1 },
        { id: 'stop-2', offset: 1, color: '#ffffff', opacity: 1 },
      ];
    }

    resolved.set(id, merged);
    return merged;
  }

  for (const id of rawMap.keys()) {
    resolveGradient(id);
  }

  return resolved;
}

/**
 * Normaliza un degradado SVG (SvgRawGradient) a las coordenadas relativas [0, 1] de la caja base de la figura.
 */
export function materializeGradient(
  paint: FillType | SvgRawGradient | undefined,
  shapeAABB: AABB
): FillType | undefined {
  if (!paint || typeof paint === 'string') return paint;
  if ('stops' in paint && !('gradientUnits' in paint)) {
    return paint;
  }
  const raw = paint as SvgRawGradient;
  const w = Math.max(1e-4, shapeAABB.width);
  const h = Math.max(1e-4, shapeAABB.height);

  if (raw.type === 'linear') {
    let p1 = { x: raw.x1 ?? 0, y: raw.y1 ?? 0 };
    let p2 = { x: raw.x2 ?? 1, y: raw.y2 ?? 0 };

    if (raw.gradientUnits === 'userSpaceOnUse' || p1.x > 1 || p1.y > 1 || p2.x > 1 || p2.y > 1) {
      if (raw.transformMatrix) {
        p1 = applyTransform(p1, raw.transformMatrix);
        p2 = applyTransform(p2, raw.transformMatrix);
      }
      return {
        type: 'linear',
        x1: (p1.x - shapeAABB.minX) / w,
        y1: (p1.y - shapeAABB.minY) / h,
        x2: (p2.x - shapeAABB.minX) / w,
        y2: (p2.y - shapeAABB.minY) / h,
        stops: raw.stops,
      };
    } else {
      if (raw.transformMatrix) {
        p1 = applyTransform(p1, raw.transformMatrix);
        p2 = applyTransform(p2, raw.transformMatrix);
      }
      return {
        type: 'linear',
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        stops: raw.stops,
      };
    }
  } else {
    // radial
    let center = { x: raw.cx ?? 0.5, y: raw.cy ?? 0.5 };
    let radius = raw.r ?? 0.5;
    let focus = raw.fx !== undefined || raw.fy !== undefined
      ? { x: raw.fx ?? center.x, y: raw.fy ?? center.y }
      : undefined;

    if (raw.gradientUnits === 'userSpaceOnUse' || center.x > 1 || center.y > 1 || radius > 1) {
      if (raw.transformMatrix) {
        center = applyTransform(center, raw.transformMatrix);
        if (focus) focus = applyTransform(focus, raw.transformMatrix);
        const { scaleX, scaleY } = decomposeMatrix(raw.transformMatrix);
        radius *= Math.max(scaleX, scaleY);
      }
      const maxDim = Math.max(1e-4, Math.max(w, h));
      return {
        type: 'radial',
        cx: (center.x - shapeAABB.minX) / w,
        cy: (center.y - shapeAABB.minY) / h,
        r: radius / maxDim,
        ...(focus
          ? {
              fx: (focus.x - shapeAABB.minX) / w,
              fy: (focus.y - shapeAABB.minY) / h,
            }
          : {}),
        stops: raw.stops,
      };
    } else {
      if (raw.transformMatrix) {
        center = applyTransform(center, raw.transformMatrix);
        if (focus) focus = applyTransform(focus, raw.transformMatrix);
        const { scaleX, scaleY } = decomposeMatrix(raw.transformMatrix);
        radius *= Math.max(scaleX, scaleY);
      }
      return {
        type: 'radial',
        cx: center.x,
        cy: center.y,
        r: radius,
        ...(focus ? { fx: focus.x, fy: focus.y } : {}),
        stops: raw.stops,
      };
    }
  }
}
