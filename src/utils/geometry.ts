import type { AABB, Ellipse, Group, Path, PathPoint, PathPointType, Rectangle, SelectableNode, Shape, Text, Vector2D, ImageNode, Polygon, Star } from '../types/scene-graph.ts';
import { isShape } from '../types/scene-graph.ts';
import type { SnapGuide } from '../types/engine.ts';
import type { ShapePositionEntry } from '../state/StateManager.ts';
import { isNonePaint } from './color.ts';

/**
 * Calcula el Axis-Aligned Bounding Box (AABB) de un nodo Rectangle o ImageNode.
 * Si tiene rotación, calcula la envolvente exacta de sus cuatro esquinas rotadas.
 */
export function getRectangleAABB(rect: Rectangle | ImageNode): AABB {
  if (!rect.rotation) {
    return {
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
      width: rect.width,
      height: rect.height,
    };
  }

  const rad = (rect.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;

  // Cuatro esquinas relativas al centro
  const corners = [
    { dx: -hw, dy: -hh },
    { dx: hw, dy: -hh },
    { dx: hw, dy: hh },
    { dx: -hw, dy: hh },
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const { dx, dy } of corners) {
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;

    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calcula el Axis-Aligned Bounding Box (AABB) de un nodo Ellipse.
 * Si tiene rotación, calcula los extremos paramétricos de la elipse rotada.
 */
export function getEllipseAABB(ellipse: Ellipse): AABB {
  if (!ellipse.rotation) {
    return {
      minX: ellipse.x - ellipse.radiusX,
      minY: ellipse.y - ellipse.radiusY,
      maxX: ellipse.x + ellipse.radiusX,
      maxY: ellipse.y + ellipse.radiusY,
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  }

  const rad = (ellipse.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Extremos paramétricos del radio de una elipse con rotación
  const halfWidth = Math.sqrt((ellipse.radiusX * cos) ** 2 + (ellipse.radiusY * sin) ** 2);
  const halfHeight = Math.sqrt((ellipse.radiusX * sin) ** 2 + (ellipse.radiusY * cos) ** 2);

  return {
    minX: ellipse.x - halfWidth,
    minY: ellipse.y - halfHeight,
    maxX: ellipse.x + halfWidth,
    maxY: ellipse.y + halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}

/**
 * Evalúa el valor escalar de una curva de Bézier cúbica en 1D para el parámetro t en [0, 1].
 */
export function evalCubicBezier1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Calcula los valores mínimo y máximo exactos de un segmento de curva Bézier cúbica 1D para t en [0, 1].
 * Evalúa los extremos en la frontera (t=0, t=1) y en los puntos críticos donde la derivada se anula.
 */
export function getCubicBezierSegmentExtrema1D(
  p0: number,
  p1: number,
  p2: number,
  p3: number
): { min: number; max: number } {
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);

  // Derivada de la curva Bézier cúbica dividida por 3: a*t^2 + b*t + c = 0
  const a = p3 - 3 * p2 + 3 * p1 - p0;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;

  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) {
      const t = -c / b;
      if (t > 0 && t < 1) {
        const val = evalCubicBezier1D(p0, p1, p2, p3, t);
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b + sqrtDisc) / (2 * a);
      const t2 = (-b - sqrtDisc) / (2 * a);

      if (t1 > 0 && t1 < 1) {
        const val = evalCubicBezier1D(p0, p1, p2, p3, t1);
        if (val < min) min = val;
        if (val > max) max = val;
      }
      if (t2 > 0 && t2 < 1) {
        const val = evalCubicBezier1D(p0, p1, p2, p3, t2);
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
  }

  return { min, max };
}

/**
 * Calcula el Axis-Aligned Bounding Box (AABB) de un nodo Path sin rotación.
 * Se limita exclusivamente al objeto geométrico (la curva y sus puntos de ancla)
 * sin expandirse hacia los manejadores de control Bézier (handleIn/handleOut).
 */
export function getPathBaseAABB(path: Path): AABB {
  if (!path.points || path.points.length === 0) {
    return {
      minX: path.x,
      minY: path.y,
      maxX: path.x,
      maxY: path.y,
      width: 0,
      height: 0,
    };
  }

  if (path.points.length === 1) {
    const pt = path.points[0];
    return {
      minX: pt.x,
      minY: pt.y,
      maxX: pt.x,
      maxY: pt.y,
      width: 0,
      height: 0,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const points = path.points;
  let subpathStartIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;

    if (i === 0 || pt.moveTo) {
      if (i > 0) {
        const prevStart = points[subpathStartIdx];
        const last = points[i - 1];
        const shouldClose = last.closeSubpath ?? path.closed;
        if (shouldClose && i - subpathStartIdx > 1) {
          const p0 = last;
          const p3 = prevStart;
          const p1 = p0.handleOut ?? p0;
          const p2 = p3.handleIn ?? p3;
          const xExt = getCubicBezierSegmentExtrema1D(p0.x, p1.x, p2.x, p3.x);
          const yExt = getCubicBezierSegmentExtrema1D(p0.y, p1.y, p2.y, p3.y);
          if (xExt.min < minX) minX = xExt.min;
          if (xExt.max > maxX) maxX = xExt.max;
          if (yExt.min < minY) minY = yExt.min;
          if (yExt.max > maxY) maxY = yExt.max;
        }
      }
      subpathStartIdx = i;
    } else {
      const p0 = points[i - 1];
      const p3 = points[i];
      const p1 = p0.handleOut ?? p0;
      const p2 = p3.handleIn ?? p3;

      const xExt = getCubicBezierSegmentExtrema1D(p0.x, p1.x, p2.x, p3.x);
      const yExt = getCubicBezierSegmentExtrema1D(p0.y, p1.y, p2.y, p3.y);

      if (xExt.min < minX) minX = xExt.min;
      if (xExt.max > maxX) maxX = xExt.max;
      if (yExt.min < minY) minY = yExt.min;
      if (yExt.max > maxY) maxY = yExt.max;
    }
  }

  if (points.length > 0) {
    const prevStart = points[subpathStartIdx];
    const last = points[points.length - 1];
    const shouldClose = last.closeSubpath ?? path.closed;
    if (shouldClose && points.length - subpathStartIdx > 1) {
      const p0 = last;
      const p3 = prevStart;
      const p1 = p0.handleOut ?? p0;
      const p2 = p3.handleIn ?? p3;
      const xExt = getCubicBezierSegmentExtrema1D(p0.x, p1.x, p2.x, p3.x);
      const yExt = getCubicBezierSegmentExtrema1D(p0.y, p1.y, p2.y, p3.y);
      if (xExt.min < minX) minX = xExt.min;
      if (xExt.max > maxX) maxX = xExt.max;
      if (yExt.min < minY) minY = yExt.min;
      if (yExt.max > maxY) maxY = yExt.max;
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calcula el Axis-Aligned Bounding Box (AABB) de un nodo Path (trazado vectorial).
 * Se limita exclusivamente al objeto geométrico (curva Bézier) sin incluir los
 * manejadores de control, aplicando la rotación centrada si está presente.
 */
export function getPathAABB(path: Path): AABB {
  const baseAABB = getPathBaseAABB(path);
  if (!path.rotation || !path.points || path.points.length === 0) {
    return baseAABB;
  }

  if (path.points.length === 1) {
    const pt = path.points[0];
    return {
      minX: pt.x,
      minY: pt.y,
      maxX: pt.x,
      maxY: pt.y,
      width: 0,
      height: 0,
    };
  }

  const cx = (baseAABB.minX + baseAABB.maxX) / 2;
  const cy = (baseAABB.minY + baseAABB.maxY) / 2;
  const rad = (path.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotateCoord = (pt: { x: number; y: number }): { x: number; y: number } => ({
    x: cx + (pt.x - cx) * cos - (pt.y - cy) * sin,
    y: cy + (pt.x - cx) * sin + (pt.y - cy) * cos,
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const points = path.points;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p3 = points[i];
    const p1 = p0.handleOut ?? p0;
    const p2 = p3.handleIn ?? p3;

    const rotP0 = rotateCoord(p0);
    const rotP1 = rotateCoord(p1);
    const rotP2 = rotateCoord(p2);
    const rotP3 = rotateCoord(p3);

    const xExt = getCubicBezierSegmentExtrema1D(rotP0.x, rotP1.x, rotP2.x, rotP3.x);
    const yExt = getCubicBezierSegmentExtrema1D(rotP0.y, rotP1.y, rotP2.y, rotP3.y);

    if (xExt.min < minX) minX = xExt.min;
    if (xExt.max > maxX) maxX = xExt.max;
    if (yExt.min < minY) minY = yExt.min;
    if (yExt.max > maxY) maxY = yExt.max;
  }

  if (path.closed && points.length > 2) {
    const p0 = points[points.length - 1];
    const p3 = points[0];
    const p1 = p0.handleOut ?? p0;
    const p2 = p3.handleIn ?? p3;

    const rotP0 = rotateCoord(p0);
    const rotP1 = rotateCoord(p1);
    const rotP2 = rotateCoord(p2);
    const rotP3 = rotateCoord(p3);

    const xExt = getCubicBezierSegmentExtrema1D(rotP0.x, rotP1.x, rotP2.x, rotP3.x);
    const yExt = getCubicBezierSegmentExtrema1D(rotP0.y, rotP1.y, rotP2.y, rotP3.y);

    if (xExt.min < minX) minX = xExt.min;
    if (xExt.max > maxX) maxX = xExt.max;
    if (yExt.min < minY) minY = yExt.min;
    if (yExt.max > maxY) maxY = yExt.max;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

let sharedMeasureContext: CanvasRenderingContext2D | null = null;

/**
 * Obtiene o crea un contexto 2D compartido para mediciones de texto en entornos con Canvas.
 */
export function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureContext) {
    return sharedMeasureContext;
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    sharedMeasureContext = canvas.getContext('2d');
  } else if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    sharedMeasureContext = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  }
  return sharedMeasureContext;
}

/**
 * Permite registrar un contexto 2D para mediciones tipográficas (útil para pruebas unitarias o configuración personalizada).
 */
export function setSharedMeasureContext(ctx: CanvasRenderingContext2D | null): void {
  sharedMeasureContext = ctx;
}

/**
 * Obtiene el lineHeight efectivo de un nodo Text.
 * Si no está definido o no es válido, retorna por defecto fontSize * 1.2.
 */
export function getTextLineHeight(text: Text): number {
  const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
  if (typeof text.lineHeight === 'number' && text.lineHeight > 0) {
    return text.lineHeight;
  }
  return fontSize * 1.2;
}

/**
 * Mide el ancho de una única línea de texto usando CanvasRenderingContext2D.measureText cuando está disponible.
 */
export function measureSingleLineTextWidth(
  text: Text,
  line: string,
  ctx?: CanvasRenderingContext2D | null
): number {
  if (!line) {
    return 0;
  }

  const activeCtx = ctx ?? getTextMeasureContext();
  const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
  const fontFamily = text.fontFamily ?? 'sans-serif';
  const letterSpacing = typeof text.letterSpacing === 'number' && Number.isFinite(text.letterSpacing) ? text.letterSpacing : 0;
  const spacingCount = Math.max(0, line.length - 1);

  if (activeCtx && typeof activeCtx.measureText === 'function') {
    const fontParts: string[] = [];
    if (text.fontStyle && text.fontStyle !== 'normal') {
      fontParts.push(text.fontStyle);
    }
    if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
      fontParts.push(String(text.fontWeight));
    }
    fontParts.push(`${fontSize}px`);
    fontParts.push(fontFamily);
    activeCtx.font = fontParts.join(' ');

    if ('letterSpacing' in activeCtx) {
      try {
        (activeCtx as any).letterSpacing = `${letterSpacing}px`;
      } catch (_) {}
    }

    const metrics = activeCtx.measureText(line);
    if (metrics && typeof metrics.width === 'number' && metrics.width > 0) {
      const isNativeBrowserCanvas =
        typeof (globalThis as any).CanvasRenderingContext2D !== 'undefined' &&
        activeCtx instanceof (globalThis as any).CanvasRenderingContext2D;

      if (!isNativeBrowserCanvas && letterSpacing !== 0) {
        return Math.max(0, metrics.width + spacingCount * letterSpacing);
      }
      return metrics.width;
    }
  }

  // Fallback heurístico determinista para entornos sin motor tipográfico nativo
  const baseWidth = line.length * (fontSize * 0.6);
  const extraSpacing = letterSpacing !== 0 ? spacingCount * letterSpacing : 0;
  return Math.max(0, baseWidth + extraSpacing);
}

/**
 * Divide el contenido de un nodo Text en líneas respetando saltos de línea explícitos
 * y aplicando ajuste de línea automático (word-wrapping) si `boxWidth` está definido.
 */
export function calculateSnapping(
  movingAABB: AABB,
  targetAABBs: readonly AABB[],
  tolerance: number = 5
): { dx: number; dy: number; guides: SnapGuide[] } {
  const movingX = [movingAABB.minX, (movingAABB.minX + movingAABB.maxX) / 2, movingAABB.maxX];
  const movingY = [movingAABB.minY, (movingAABB.minY + movingAABB.maxY) / 2, movingAABB.maxY];
  let dx = 0;
  let dy = 0;
  let bestXDistance = tolerance + Number.EPSILON;
  let bestYDistance = tolerance + Number.EPSILON;
  let xGuidePosition: number | null = null;
  let xGuideTarget: AABB | null = null;
  let yGuidePosition: number | null = null;
  let yGuideTarget: AABB | null = null;

  for (const target of targetAABBs) {
    const targetX = [target.minX, (target.minX + target.maxX) / 2, target.maxX];
    const targetY = [target.minY, (target.minY + target.maxY) / 2, target.maxY];

    for (const movingPosition of movingX) {
      for (const targetPosition of targetX) {
        const correction = targetPosition - movingPosition;
        const distance = Math.abs(correction);
        if (distance <= tolerance && distance < bestXDistance) {
          bestXDistance = distance;
          dx = correction;
          xGuidePosition = targetPosition;
          xGuideTarget = target;
        }
      }
    }

    for (const movingPosition of movingY) {
      for (const targetPosition of targetY) {
        const correction = targetPosition - movingPosition;
        const distance = Math.abs(correction);
        if (distance <= tolerance && distance < bestYDistance) {
          bestYDistance = distance;
          dy = correction;
          yGuidePosition = targetPosition;
          yGuideTarget = target;
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (xGuidePosition !== null && xGuideTarget) {
    guides.push({
      axis: 'x',
      position: xGuidePosition,
      start: Math.min(movingAABB.minY + dy, xGuideTarget.minY),
      end: Math.max(movingAABB.maxY + dy, xGuideTarget.maxY),
    });
  }
  if (yGuidePosition !== null && yGuideTarget) {
    guides.push({
      axis: 'y',
      position: yGuidePosition,
      start: Math.min(movingAABB.minX + dx, yGuideTarget.minX),
      end: Math.max(movingAABB.maxX + dx, yGuideTarget.maxX),
    });
  }
  return { dx, dy, guides };
}

export function calculateAnchoredSnapping(
  movingAABB: AABB,
  targetAABBs: readonly AABB[],
  fixedXFeature: 0 | 2 | 'all',
  fixedYFeature: 0 | 2 | 'all',
  tolerance: number = 5
): { dx: number; dy: number; guides: SnapGuide[] } {
  const findAxisSnap = (
    axis: 'x' | 'y',
    fixedFeature: 0 | 2 | 'all'
  ): { pointerDelta: number; featureDelta: number; movingFeature: number; position: number; target: AABB } | null => {
    if (fixedFeature === 'all') return null;

    const movingMin = axis === 'x' ? movingAABB.minX : movingAABB.minY;
    const movingMax = axis === 'x' ? movingAABB.maxX : movingAABB.maxY;
    const movingFeatures = [movingMin, (movingMin + movingMax) / 2, movingMax];
    let best: ReturnType<typeof findAxisSnap> = null;
    let bestDistance = tolerance + Number.EPSILON;

    for (const target of targetAABBs) {
      const targetMin = axis === 'x' ? target.minX : target.minY;
      const targetMax = axis === 'x' ? target.maxX : target.maxY;
      const targetFeatures = [targetMin, (targetMin + targetMax) / 2, targetMax];

      for (let movingIndex = 0; movingIndex < movingFeatures.length; movingIndex++) {
        if (movingIndex === fixedFeature) continue;
        for (const targetPosition of targetFeatures) {
          const featureDelta = targetPosition - movingFeatures[movingIndex];
          const distance = Math.abs(featureDelta);
          if (distance <= tolerance && distance < bestDistance) {
            bestDistance = distance;
            best = {
              pointerDelta: movingIndex === 1 ? featureDelta * 2 : featureDelta,
              featureDelta,
              movingFeature: movingIndex,
              position: targetPosition,
              target,
            };
          }
        }
      }
    }

    return best;
  };

  const xSnap = findAxisSnap('x', fixedXFeature);
  const ySnap = findAxisSnap('y', fixedYFeature);
  const correctedMinX = xSnap
    ? fixedXFeature === 0 ? movingAABB.minX : movingAABB.minX + xSnap.pointerDelta
    : movingAABB.minX;
  const correctedMaxX = xSnap
    ? fixedXFeature === 2 ? movingAABB.maxX : movingAABB.maxX + xSnap.pointerDelta
    : movingAABB.maxX;
  const correctedMinY = ySnap
    ? fixedYFeature === 0 ? movingAABB.minY : movingAABB.minY + ySnap.pointerDelta
    : movingAABB.minY;
  const correctedMaxY = ySnap
    ? fixedYFeature === 2 ? movingAABB.maxY : movingAABB.maxY + ySnap.pointerDelta
    : movingAABB.maxY;

  const guides: SnapGuide[] = [];
  if (xSnap) {
    guides.push({
      axis: 'x',
      position: xSnap.position,
      start: Math.min(correctedMinY, xSnap.target.minY),
      end: Math.max(correctedMaxY, xSnap.target.maxY),
    });
  }
  if (ySnap) {
    guides.push({
      axis: 'y',
      position: ySnap.position,
      start: Math.min(correctedMinX, ySnap.target.minX),
      end: Math.max(correctedMaxX, ySnap.target.maxX),
    });
  }

  return {
    dx: xSnap?.pointerDelta ?? 0,
    dy: ySnap?.pointerDelta ?? 0,
    guides,
  };
}

export function getTextLineRanges(
  text: Text,
  ctx?: CanvasRenderingContext2D | null
): Array<{ text: string; start: number; end: number }> {
  const content = text.text ?? '';
  if (text.boxWidth === undefined) {
    let start = 0;
    return content.split('\n').map((line) => {
      const range = { text: line, start, end: start + line.length };
      start = range.end + 1;
      return range;
    });
  }

  const ranges: Array<{ text: string; start: number; end: number }> = [];
  const paragraphs = content.split('\n');
  let paragraphStart = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      ranges.push({ text: '', start: paragraphStart, end: paragraphStart });
      paragraphStart++;
      continue;
    }

    const words = paragraph.split(' ');
    let wordStart = paragraphStart;
    let currentLine = '';
    let currentStart = wordStart;
    let currentEnd = wordStart;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = measureSingleLineTextWidth(text, testLine, ctx);

      if (width <= text.boxWidth || !currentLine) {
        if (!currentLine) {
          currentStart = wordStart;
        }
        currentLine = testLine;
        currentEnd = wordStart + word.length;
      } else {
        ranges.push({ text: currentLine, start: currentStart, end: currentEnd });
        currentLine = word;
        currentStart = wordStart;
        currentEnd = wordStart + word.length;
      }

      wordStart += word.length + (i < words.length - 1 ? 1 : 0);
    }

    if (currentLine) {
      ranges.push({ text: currentLine, start: currentStart, end: currentEnd });
    }
    paragraphStart += paragraph.length + 1;
  }

  return ranges.length > 0 ? ranges : [{ text: '', start: 0, end: 0 }];
}

export function getWrappedTextLines(text: Text, ctx?: CanvasRenderingContext2D | null): string[] {
  return getTextLineRanges(text, ctx).map((line) => line.text);
}

/**
 * Mide el ancho de un nodo Text.
 * Si boxWidth está definido, retorna boxWidth como ancho.
 * Para texto multilínea sin boxWidth, corresponde al ancho de la línea más ancha.
 */
export function measureTextWidth(text: Text, ctx?: CanvasRenderingContext2D | null): number {
  if (text.boxWidth !== undefined) {
    return text.boxWidth;
  }

  const content = text.text ?? '';
  if (!content) {
    return 0;
  }

  const lines = content.split('\n');
  if (lines.length === 1) {
    return measureSingleLineTextWidth(text, lines[0], ctx);
  }

  let maxWidth = 0;
  for (const line of lines) {
    const w = measureSingleLineTextWidth(text, line, ctx);
    if (w > maxWidth) {
      maxWidth = w;
    }
  }
  return maxWidth;
}

/**
 * Mide el ancho de un prefijo de longitud `length` de un nodo Text.
 */
export function getTextSubstrWidth(text: Text, length: number, ctx?: CanvasRenderingContext2D | null): number {
  const content = text.text ?? '';
  if (length <= 0 || !content) {
    return 0;
  }
  if (length >= content.length) {
    return measureTextWidth(text, ctx);
  }
  const subNode: Text = { ...text, text: content.slice(0, length) };
  return measureTextWidth(subNode, ctx);
}

/**
 * Calcula el índice de carácter más cercano a una posición (worldX, worldY) en coordenadas del mundo,
 * utilizando CanvasRenderingContext2D.measureText para métricas tipográficas reales.
 * Identifica la línea más cercana verticalmente y el carácter más cercano dentro de ella.
 */
export function getTextIndexAtPosition(
  text: Text,
  worldX: number,
  worldY: number,
  ctx?: CanvasRenderingContext2D | null
): number {
  const content = text.text ?? '';
  if (!content) {
    return 0;
  }

  // 1. Des-rotar el punto con respecto al anclaje (text.x, text.y) si hay rotación
  const rotation = text.rotation ?? 0;
  let unrotX = worldX;
  let unrotY = worldY;
  if (rotation !== 0) {
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = worldX - text.x;
    const dy = worldY - text.y;
    unrotX = text.x + (dx * cos - dy * sin);
    unrotY = text.y + (dx * sin + dy * cos);
  }

  // 2. Dividir en líneas y calcular posiciones iniciales
  const lines = getTextLineRanges(text, ctx);

  // 3. Identificar la línea más cercana según coordenada Y y lineHeight
  const lineHeight = getTextLineHeight(text);
  const offsetY = unrotY - text.y;
  let lineIndex = Math.floor(offsetY / lineHeight);
  if (lineIndex < 0) lineIndex = 0;
  if (lineIndex >= lines.length) lineIndex = lines.length - 1;

  // 4. Determinar la posición horizontal de inicio de la línea seleccionada según textAlign
  const { text: currentLine, start: lineStart, end: lineEnd } = lines[lineIndex];
  const lineWidth = measureSingleLineTextWidth(text, currentLine, ctx);
  let startX = text.x;
  if (text.textAlign === 'center') {
    startX = text.x - lineWidth / 2;
  } else if (text.textAlign === 'right') {
    startX = text.x - lineWidth;
  }

  // 5. Desplazamiento horizontal relativo al inicio de la línea
  const offsetX = unrotX - startX;
  if (offsetX <= 0) {
    return lineStart;
  }
  if (offsetX >= lineWidth) {
    return lineEnd;
  }

  // 6. Buscar el carácter más cercano dentro de esa línea
  let closestCol = 0;
  let minDiff = Infinity;
  for (let i = 0; i <= currentLine.length; i++) {
    const w = measureSingleLineTextWidth(text, currentLine.slice(0, i), ctx);
    const diff = Math.abs(w - offsetX);
    if (diff < minDiff) {
      minDiff = diff;
      closestCol = i;
    }
  }

  return Math.min(lineStart + closestCol, lineEnd);
}

/**
 * Obtiene el Bounding Box base (sin rotación) de un nodo Text en coordenadas del mundo.
 * Para texto con boxWidth, el ancho es boxWidth y la altura se calcula simulando el salto de línea.
 * Para texto multilínea sin boxWidth, el ancho es la línea más ancha y la altura corresponde a lines.length * lineHeight.
 * Para compatibilidad, si es de una sola línea sin lineHeight explícito, la altura es fontSize.
 */
export function getTextBaseAABB(text: Text, ctx?: CanvasRenderingContext2D | null): AABB {
  const isWrapped = text.boxWidth !== undefined;
  const lines = isWrapped ? getWrappedTextLines(text, ctx) : (text.text ?? '').split('\n');
  const width = isWrapped ? text.boxWidth! : measureTextWidth(text, ctx);
  const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
  const lineHeight = getTextLineHeight(text);
  const height = lines.length <= 1 && text.lineHeight === undefined ? fontSize : lines.length * lineHeight;

  let minX = text.x;
  if (text.textAlign === 'center') {
    minX = text.x - width / 2;
  } else if (text.textAlign === 'right') {
    minX = text.x - width;
  }

  const strokePadding = !isNonePaint(text.stroke) ? Math.max(0, text.strokeWidth ?? 1) / 2 : 0;
  minX -= strokePadding;
  const minY = text.y - strokePadding;
  const maxX = minX + width + strokePadding * 2;
  const maxY = minY + height + strokePadding * 2;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Obtiene el Axis-Aligned Bounding Box (AABB) de un nodo Text.
 * Si tiene rotación, calcula la envolvente exacta de sus cuatro esquinas rotadas
 * respecto al punto de rotación (text.x, text.y).
 */
export function getTextAABB(text: Text, ctx?: CanvasRenderingContext2D | null): AABB {
  const baseAABB = getTextBaseAABB(text, ctx);

  if (!text.rotation) {
    return baseAABB;
  }

  const rad = (text.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const cx = text.x;
  const cy = text.y;

  const corners = [
    { x: baseAABB.minX, y: baseAABB.minY },
    { x: baseAABB.maxX, y: baseAABB.minY },
    { x: baseAABB.maxX, y: baseAABB.maxY },
    { x: baseAABB.minX, y: baseAABB.maxY },
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const { x, y } of corners) {
    const rx = cx + (x - cx) * cos - (y - cy) * sin;
    const ry = cy + (x - cx) * sin + (y - cy) * cos;

    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calcula los vértices base de un Polígono regular sin rotación (con el vértice superior a 12 en punto / -90°).
 */
export function getPolygonBaseVertices(polygon: Polygon): Vector2D[] {
  const n = Math.max(3, Math.round(polygon.sides || 3));
  const r = Math.max(0, polygon.radius);
  const cx = polygon.x;
  const cy = polygon.y;
  const vertices: Vector2D[] = new Array(n);
  const startAngle = -Math.PI / 2;
  const step = (Math.PI * 2) / n;

  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula los vértices finales de un Polígono regular aplicando su rotación.
 */
export function getPolygonVertices(polygon: Polygon): Vector2D[] {
  const n = Math.max(3, Math.round(polygon.sides || 3));
  const r = Math.max(0, polygon.radius);
  const cx = polygon.x;
  const cy = polygon.y;
  const rotRad = ((polygon.rotation ?? 0) * Math.PI) / 180;
  const startAngle = -Math.PI / 2 + rotRad;
  const step = (Math.PI * 2) / n;
  const vertices: Vector2D[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula los vértices base de una Estrella regular sin rotación (con la primera punta exterior a 12 en punto / -90°).
 */
export function getStarBaseVertices(star: Star): Vector2D[] {
  const p = Math.max(3, Math.round(star.points || 3));
  const rOut = Math.max(0, star.outerRadius);
  const rIn = Math.max(0, star.innerRadius);
  const cx = star.x;
  const cy = star.y;
  const totalVertices = p * 2;
  const vertices: Vector2D[] = new Array(totalVertices);
  const startAngle = -Math.PI / 2;
  const step = Math.PI / p;

  for (let i = 0; i < totalVertices; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula los vértices finales de una Estrella regular aplicando su rotación.
 */
export function getStarVertices(star: Star): Vector2D[] {
  const p = Math.max(3, Math.round(star.points || 3));
  const rOut = Math.max(0, star.outerRadius);
  const rIn = Math.max(0, star.innerRadius);
  const cx = star.x;
  const cy = star.y;
  const rotRad = ((star.rotation ?? 0) * Math.PI) / 180;
  const startAngle = -Math.PI / 2 + rotRad;
  const step = Math.PI / p;
  const totalVertices = p * 2;
  const vertices: Vector2D[] = new Array(totalVertices);

  for (let i = 0; i < totalVertices; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula el AABB de un polígono regular (respetando rotación si la tiene).
 */
export function getPolygonAABB(polygon: Polygon): AABB {
  const vertices = getPolygonVertices(polygon);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  if (minX === Infinity) {
    return { minX: polygon.x, minY: polygon.y, maxX: polygon.x, maxY: polygon.y, width: 0, height: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calcula el AABB de una estrella regular (respetando rotación si la tiene).
 */
export function getStarAABB(star: Star): AABB {
  const vertices = getStarVertices(star);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  if (minX === Infinity) {
    return { minX: star.x, minY: star.y, maxX: star.x, maxY: star.y, width: 0, height: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Obtiene el AABB (Axis-Aligned Bounding Box) de cualquier figura (Shape).
 */
export function getShapeAABB(shape: Shape): AABB {
  if (shape.type === 'rectangle' || shape.type === 'image') {
    return getRectangleAABB(shape);
  }
  if (shape.type === 'ellipse') {
    return getEllipseAABB(shape);
  }
  if (shape.type === 'polygon') {
    return getPolygonAABB(shape);
  }
  if (shape.type === 'star') {
    return getStarAABB(shape);
  }
  if (shape.type === 'text') {
    return getTextAABB(shape);
  }
  return getPathAABB(shape);
}

/**
 * Cache WeakMap para las envolventes AABB de grupos.
 * Se invalida automáticamente ante modificaciones estructurales del Scene Graph
 * porque cualquier cambio en un descendiente crea nuevas referencias inmutables de grupo.
 */
export const groupAABBCache = new WeakMap<Group, AABB>();

/**
 * Calcula el AABB unificado de un Grupo a partir de las envolventes de sus hijos directos.
 * Utiliza groupAABBCache (WeakMap) para garantizar O(1) en consultas sucesivas sobre la misma referencia.
 */
export function getGroupAABB(group: Group): AABB {
  const cached = groupAABBCache.get(group);
  if (cached) {
    return cached;
  }

  if (!group.children || group.children.length === 0) {
    const emptyAABB: AABB = {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
    groupAABBCache.set(group, emptyAABB);
    return emptyAABB;
  }

  if (group.isClipMask === true && group.children.length > 0) {
    const maskChild = group.clipChildId
      ? group.children.find((c) => c.id === group.clipChildId)
      : group.children[group.children.length - 1];
    if (maskChild) {
      const maskAABB = getNodeAABB(maskChild);
      groupAABBCache.set(group, maskAABB);
      return maskAABB;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i];
    const aabb = getNodeAABB(child);
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }

  const aabb: AABB = {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };

  groupAABBCache.set(group, aabb);
  return aabb;
}

/**
 * Obtiene el AABB (Axis-Aligned Bounding Box) de cualquier nodo seleccionable (figura o grupo).
 */
export function getNodeAABB(node: SelectableNode): AABB {
  if (isShape(node)) {
    return getShapeAABB(node);
  }
  return getGroupAABB(node);
}

/**
 * Evalúa colisión punto-caja (Hit-testing matemático AABB).
 * Retorna true si el punto (px, py) está contenido dentro del AABB.
 */
export function isPointInAABB(px: number, py: number, aabb: AABB): boolean {
  return (
    px >= aabb.minX &&
    px <= aabb.maxX &&
    py >= aabb.minY &&
    py <= aabb.maxY
  );
}

/**
 * Determina de forma pura si un punto (x, y) en coordenadas del mundo colisiona
 * con una figura de tipo Rectangle o Ellipse, considerando su geometría exacta,
 * su rotación centrada y un margen de tolerancia opcional.
 *
 * - Fase rápida: descarta con el AABB de la figura ampliado por la tolerancia.
 * - Si la figura tiene rotación, transforma el punto al espacio local invirtiendo
 *   la rotación respecto al centro geométrico (la misma convención que RenderEngine).
 * - Para Rectangle: evalúa si el punto local cae dentro del rectángulo ampliado por la tolerancia.
 * - Para Ellipse: evalúa la ecuación normalizada con radios ampliados por la tolerancia:
 *   ((localX - cx) / (rx + t))^2 + ((localY - cy) / (ry + t))^2 <= 1, manejando radios cero sin dividir por cero.
 */
/**
 * Determina si un punto (x, y) en coordenadas del mundo colisiona con el área visible
 * de un nodo Text, considerando su orientación y un margen de tolerancia opcional.
 */
export function isPointInText(
  x: number,
  y: number,
  text: Text,
  tolerance: number = 0,
  ctx?: CanvasRenderingContext2D | null
): boolean {
  const t = Math.max(0, tolerance);

  // 1. Fase rápida: descarte mediante AABB ampliado con tolerancia
  const aabb = getTextAABB(text, ctx);
  if (
    x < aabb.minX - t ||
    x > aabb.maxX + t ||
    y < aabb.minY - t ||
    y > aabb.maxY + t
  ) {
    return false;
  }

  // 2. Transformar el punto al espacio local si hay rotación
  let localX = x;
  let localY = y;

  const rotation = text.rotation ?? 0;
  if (rotation !== 0) {
    const cx = text.x;
    const cy = text.y;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = x - cx;
    const dy = y - cy;
    // Rotación inversa alrededor de (cx, cy): R(-θ)
    localX = cx + dx * cos + dy * sin;
    localY = cy - dx * sin + dy * cos;
  }

  // 3. Evaluar colisión contra el baseAABB no rotado
  const baseAABB = getTextBaseAABB(text, ctx);
  return (
    localX >= baseAABB.minX - t - 1e-9 &&
    localX <= baseAABB.maxX + t + 1e-9 &&
    localY >= baseAABB.minY - t - 1e-9 &&
    localY <= baseAABB.maxY + t + 1e-9
  );
}

/**
 * Determina de forma pura si un punto (x, y) en coordenadas del mundo colisiona
 * con una figura de tipo Rectangle, Ellipse o Text, considerando su geometría exacta,
 * su rotación centrada y un margen de tolerancia opcional.
 *
 * - Fase rápida: descarta con el AABB de la figura ampliado por la tolerancia.
 * - Si la figura tiene rotación, transforma el punto al espacio local invirtiendo
 *   la rotación respecto al centro geométrico (la misma convención que RenderEngine).
 * - Para Rectangle: evalúa si el punto local cae dentro del rectángulo ampliado por la tolerancia.
 * - Para Ellipse: evalúa la ecuación normalizada con radios ampliados por la tolerancia:
 *   ((localX - cx) / (rx + t))^2 + ((localY - cy) / (ry + t))^2 <= 1, manejando radios cero sin dividir por cero.
 * - Para Text: delega en isPointInText evaluando colisión contra la caja de texto.
 */
function distToSegmentSquared(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    const dpx = px - x1;
    const dpy = py - y1;
    return dpx * dpx + dpy * dpy;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const dpx = px - projX;
  const dpy = py - projY;
  return dpx * dpx + dpy * dpy;
}

export function isPointInPolygonVertices(px: number, py: number, vertices: readonly Vector2D[]): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInShape(
  x: number,
  y: number,
  shape: Shape,
  tolerance: number = 0,
  ctx?: CanvasRenderingContext2D | null
): boolean {
  if (shape.type === 'text') {
    return isPointInText(x, y, shape, tolerance, ctx);
  }

  const t = Math.max(0, tolerance);

  if (shape.type === 'polygon' || shape.type === 'star') {
    const aabb = shape.type === 'polygon' ? getPolygonAABB(shape) : getStarAABB(shape);
    if (
      x < aabb.minX - t ||
      x > aabb.maxX + t ||
      y < aabb.minY - t ||
      y > aabb.maxY + t
    ) {
      return false;
    }

    const vertices = shape.type === 'polygon' ? getPolygonVertices(shape) : getStarVertices(shape);
    if (isPointInPolygonVertices(x, y, vertices)) {
      return true;
    }

    if (t > 0) {
      const tSq = t * t;
      const n = vertices.length;
      for (let i = 0; i < n; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % n];
        if (distToSegmentSquared(x, y, v1.x, v1.y, v2.x, v2.y) <= tSq) {
          return true;
        }
      }
    }
    return false;
  }

  if (shape.type !== 'rectangle' && shape.type !== 'ellipse' && shape.type !== 'image') {
    return false;
  }

  // 1. Fase rápida: descarte mediante AABB ampliado con tolerancia
  const aabb = (shape.type === 'rectangle' || shape.type === 'image') ? getRectangleAABB(shape) : getEllipseAABB(shape);
  if (
    x < aabb.minX - t ||
    x > aabb.maxX + t ||
    y < aabb.minY - t ||
    y > aabb.maxY + t
  ) {
    return false;
  }

  // 2. Transformar el punto al espacio local si hay rotación
  let localX = x;
  let localY = y;

  const rotation = shape.rotation ?? 0;
  if (rotation !== 0) {
    const cx = (shape.type === 'rectangle' || shape.type === 'image') ? shape.x + shape.width / 2 : shape.x;
    const cy = (shape.type === 'rectangle' || shape.type === 'image') ? shape.y + shape.height / 2 : shape.y;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = x - cx;
    const dy = y - cy;
    // Rotación inversa alrededor de (cx, cy): R(-θ)
    localX = cx + dx * cos + dy * sin;
    localY = cy - dx * sin + dy * cos;
  }

  // 3. Evaluación según el tipo de figura en espacio local
  if (shape.type === 'rectangle' || shape.type === 'image') {
    const rx = Math.min(shape.x, shape.x + shape.width);
    const ry = Math.min(shape.y, shape.y + shape.height);
    const rw = Math.abs(shape.width);
    const rh = Math.abs(shape.height);
    const minX = rx - t;
    const maxX = rx + rw + t;
    const minY = ry - t;
    const maxY = ry + rh + t;

    if (
      localX < minX - 1e-9 ||
      localX > maxX + 1e-9 ||
      localY < minY - 1e-9 ||
      localY > maxY + 1e-9
    ) {
      return false;
    }

    const radius = ('cornerRadius' in shape && typeof shape.cornerRadius === 'number') ? shape.cornerRadius : 0;
    if (radius > 0) {
      const maxR = Math.min(rw / 2, rh / 2);
      const r = Math.min(radius, maxR);
      const effR = r + t;
      // Esquina superior izquierda
      if (localX < rx + r && localY < ry + r) {
        const cdx = localX - (rx + r);
        const cdy = localY - (ry + r);
        return cdx * cdx + cdy * cdy <= effR * effR + 1e-9;
      }
      // Esquina superior derecha
      if (localX > rx + rw - r && localY < ry + r) {
        const cdx = localX - (rx + rw - r);
        const cdy = localY - (ry + r);
        return cdx * cdx + cdy * cdy <= effR * effR + 1e-9;
      }
      // Esquina inferior izquierda
      if (localX < rx + r && localY > ry + rh - r) {
        const cdx = localX - (rx + r);
        const cdy = localY - (ry + rh - r);
        return cdx * cdx + cdy * cdy <= effR * effR + 1e-9;
      }
      // Esquina inferior derecha
      if (localX > rx + rw - r && localY > ry + rh - r) {
        const cdx = localX - (rx + rw - r);
        const cdy = localY - (ry + rh - r);
        return cdx * cdx + cdy * cdy <= effR * effR + 1e-9;
      }
    }

    return true;
  }

  // Ellipse:
  const cx = shape.x;
  const cy = shape.y;
  const rx = Math.abs(shape.radiusX);
  const ry = Math.abs(shape.radiusY);
  const effRx = rx + t;
  const effRy = ry + t;

  if (effRx <= 0 && effRy <= 0) {
    return Math.abs(localX - cx) <= 1e-9 && Math.abs(localY - cy) <= 1e-9;
  }
  if (effRx <= 0) {
    return Math.abs(localX - cx) <= 1e-9 && Math.abs(localY - cy) <= effRy + 1e-9;
  }
  if (effRy <= 0) {
    return Math.abs(localY - cy) <= 1e-9 && Math.abs(localX - cx) <= effRx + 1e-9;
  }

  const normX = (localX - cx) / effRx;
  const normY = (localY - cy) / effRy;
  return normX * normX + normY * normY <= 1 + 1e-9;
}

/**
 * Tipos de manejadores de esquina y rotación
 */
export type HandleType = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left' | 'rotation-handle' | 'right-center';

/**
 * Representación de un manejador de selección como AABB pequeño
 */
export interface SelectionHandle extends AABB {
  readonly type: HandleType;
}

/**
 * Calcula el AABB de un Shape y devuelve un array con objetos geométricos
 * (AABBs pequeños de 8x8px) correspondientes a las esquinas, al manejador de rotación flotante,
 * y exclusivamente para nodos Text, un manejador de tipo 'right-center'.
 *
 * @param shape Figura seleccionada
 * @param handleSize Tamaño en píxeles del manejador (por defecto 8px)
 * @returns Array con los manejadores de la figura
 */
export function getSelectionHandles(
  shape: Shape,
  handleSize: number = 8,
  rotationDistance: number = 30
): SelectionHandle[] {
  const half = handleSize / 2;
  const rotation = shape.rotation ?? 0;

  if (!rotation) {
    const aabb = getShapeAABB(shape);
    const midX = (aabb.minX + aabb.maxX) / 2;
    const rotY = aabb.minY - rotationDistance;

    const handles: SelectionHandle[] = [
      {
        type: 'top-left',
        minX: aabb.minX - half,
        minY: aabb.minY - half,
        maxX: aabb.minX + half,
        maxY: aabb.minY + half,
        width: handleSize,
        height: handleSize,
      },
      {
        type: 'top-right',
        minX: aabb.maxX - half,
        minY: aabb.minY - half,
        maxX: aabb.maxX + half,
        maxY: aabb.minY + half,
        width: handleSize,
        height: handleSize,
      },
      {
        type: 'bottom-right',
        minX: aabb.maxX - half,
        minY: aabb.maxY - half,
        maxX: aabb.maxX + half,
        maxY: aabb.maxY + half,
        width: handleSize,
        height: handleSize,
      },
      {
        type: 'bottom-left',
        minX: aabb.minX - half,
        minY: aabb.maxY - half,
        maxX: aabb.minX + half,
        maxY: aabb.maxY + half,
        width: handleSize,
        height: handleSize,
      },
      {
        type: 'rotation-handle',
        minX: midX - half,
        minY: rotY - half,
        maxX: midX + half,
        maxY: rotY + half,
        width: handleSize,
        height: handleSize,
      },
    ];

    if (shape.type === 'text') {
      const midY = (aabb.minY + aabb.maxY) / 2;
      handles.push({
        type: 'right-center',
        minX: aabb.maxX - half,
        minY: midY - half,
        maxX: aabb.maxX + half,
        maxY: midY + half,
        width: handleSize,
        height: handleSize,
      });
    }

    return handles;
  }

  // Figura con rotación: calcular esquinas y manejador de rotación en espacio rotado (OBB)
  let cx = 0;
  let cy = 0;
  let hw = 0;
  let hh = 0;

  if (shape.type === 'rectangle' || shape.type === 'image') {
    hw = shape.width / 2;
    hh = shape.height / 2;
    cx = shape.x + hw;
    cy = shape.y + hh;
  } else if (shape.type === 'ellipse') {
    hw = shape.radiusX;
    hh = shape.radiusY;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'polygon') {
    hw = shape.radius;
    hh = shape.radius;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'star') {
    hw = shape.outerRadius;
    hh = shape.outerRadius;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'path') {
    const baseAABB = getPathBaseAABB(shape);
    hw = baseAABB.width / 2;
    hh = baseAABB.height / 2;
    cx = (baseAABB.minX + baseAABB.maxX) / 2;
    cy = (baseAABB.minY + baseAABB.maxY) / 2;
  } else if (shape.type === 'text') {
    const baseAABB = getTextBaseAABB(shape);
    cx = shape.x;
    cy = shape.y;

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatePoint = (dx: number, dy: number): { x: number; y: number } => ({
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    });

    const tl = rotatePoint(baseAABB.minX - cx, baseAABB.minY - cy);
    const tr = rotatePoint(baseAABB.maxX - cx, baseAABB.minY - cy);
    const br = rotatePoint(baseAABB.maxX - cx, baseAABB.maxY - cy);
    const bl = rotatePoint(baseAABB.minX - cx, baseAABB.maxY - cy);
    const midX = (baseAABB.minX + baseAABB.maxX) / 2;
    const rot = rotatePoint(midX - cx, baseAABB.minY - cy - rotationDistance);

    const createHandle = (pt: { x: number; y: number }, type: HandleType): SelectionHandle => ({
      type,
      minX: pt.x - half,
      minY: pt.y - half,
      maxX: pt.x + half,
      maxY: pt.y + half,
      width: handleSize,
      height: handleSize,
    });

    const midY = (baseAABB.minY + baseAABB.maxY) / 2;
    const rc = rotatePoint(baseAABB.maxX - cx, midY - cy);

    return [
      createHandle(tl, 'top-left'),
      createHandle(tr, 'top-right'),
      createHandle(br, 'bottom-right'),
      createHandle(bl, 'bottom-left'),
      createHandle(rot, 'rotation-handle'),
      createHandle(rc, 'right-center'),
    ];
  }

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotatePoint = (dx: number, dy: number): { x: number; y: number } => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  });

  const tl = rotatePoint(-hw, -hh);
  const tr = rotatePoint(hw, -hh);
  const br = rotatePoint(hw, hh);
  const bl = rotatePoint(-hw, hh);
  const rot = rotatePoint(0, -hh - rotationDistance);

  const createHandle = (pt: { x: number; y: number }, type: HandleType): SelectionHandle => ({
    type,
    minX: pt.x - half,
    minY: pt.y - half,
    maxX: pt.x + half,
    maxY: pt.y + half,
    width: handleSize,
    height: handleSize,
  });

  return [
    createHandle(tl, 'top-left'),
    createHandle(tr, 'top-right'),
    createHandle(br, 'bottom-right'),
    createHandle(bl, 'bottom-left'),
    createHandle(rot, 'rotation-handle'),
  ];
}

/**
 * Construye una instancia de Path2D para un trazado con curvas de Bézier cúbicas.
 */
export function buildPath2D(path: Path): Path2D | null {
  if (typeof Path2D === 'undefined' || !path.points || path.points.length === 0) {
    return null;
  }

  const path2d = new Path2D();
  const points = path.points;
  let subpathStartIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (i === 0 || curr.moveTo) {
      if (i > 0) {
        const prevStart = points[subpathStartIdx];
        const last = points[i - 1];
        const shouldClose = last.closeSubpath ?? path.closed;
        if (shouldClose && i - subpathStartIdx > 1) {
          const cp1x = last.handleOut ? last.handleOut.x : last.x;
          const cp1y = last.handleOut ? last.handleOut.y : last.y;
          const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
          const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
          path2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, prevStart.x, prevStart.y);
          path2d.closePath();
        }
      }
      subpathStartIdx = i;
      path2d.moveTo(curr.x, curr.y);
    } else {
      const prev = points[i - 1];
      const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
      const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
      const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
      const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;
      path2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
    }
  }

  if (points.length > 0) {
    const prevStart = points[subpathStartIdx];
    const last = points[points.length - 1];
    const shouldClose = last.closeSubpath ?? path.closed;
    if (shouldClose && points.length - subpathStartIdx > 1) {
      const cp1x = last.handleOut ? last.handleOut.x : last.x;
      const cp1y = last.handleOut ? last.handleOut.y : last.y;
      const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
      const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
      path2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, prevStart.x, prevStart.y);
      path2d.closePath();
    }
  }

  return path2d;
}

/**
 * Muestrea puntos a lo largo de una curva de Bézier cúbica
 */
function sampleCubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  steps: number = 10
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    result.push({ x, y });
  }
  return result;
}

/**
 * Calcula la distancia más corta de un punto (px, py) a un segmento de línea (x1, y1) -> (x2, y2)
 */
function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Algoritmo de Ray-Casting poligonal para determinar si un punto está dentro de un polígono cerrado.
 */
function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Evalúa colisión de un punto (px, py) sobre un Path vectorial.
 * Utiliza Canvas 2D ctx.isPointInPath() / ctx.isPointInStroke() cuando están disponibles,
 * o algoritmos geométricos de ray-casting y distancia a curvas de Bézier como fallback de alta precisión.
 */
export function isPointInPath(
  px: number,
  py: number,
  path: Path,
  ctx?: CanvasRenderingContext2D | null,
  customTolerance?: number
): boolean {
  if (!path.points || path.points.length === 0) {
    return false;
  }

  // 1. Broad-phase: AABB con margen de tolerancia
  const strokeWidth = path.strokeWidth ?? 2;
  const tolerance = customTolerance !== undefined ? customTolerance : Math.max(strokeWidth / 2 + 5, 8);
  const aabb = getPathAABB(path);

  const paddedAABB: AABB = {
    minX: aabb.minX - tolerance,
    minY: aabb.minY - tolerance,
    maxX: aabb.maxX + tolerance,
    maxY: aabb.maxY + tolerance,
    width: aabb.width + tolerance * 2,
    height: aabb.height + tolerance * 2,
  };

  if (!isPointInAABB(px, py, paddedAABB)) {
    return false;
  }

  // Si tiene rotación, transformar (px, py) al espacio local del trazado no rotado
  let testX = px;
  let testY = py;
  if (path.rotation) {
    const baseAABB = getPathBaseAABB(path);
    const cx = (baseAABB.minX + baseAABB.maxX) / 2;
    const cy = (baseAABB.minY + baseAABB.maxY) / 2;
    const rad = (-path.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = px - cx;
    const dy = py - cy;
    testX = cx + dx * cos - dy * sin;
    testY = cy + dx * sin + dy * cos;
  }

  // 2. Intentar evaluación directa con Canvas 2D API (ctx.isPointInPath / ctx.isPointInStroke)
  if (ctx) {
    const path2d = buildPath2D(path);
    if (path2d) {
      // Si el trazado tiene relleno
      if (path.fill && path.fill !== 'transparent' && path.fill !== 'none') {
        if (ctx.isPointInPath(path2d, testX, testY, path.fillRule ?? 'nonzero')) {
          return true;
        }
      }

      // Si el trazado tiene trazo (stroke)
      if (ctx.isPointInStroke) {
        ctx.save();
        ctx.lineWidth = customTolerance !== undefined ? Math.max(strokeWidth, customTolerance * 2) : Math.max(strokeWidth, 8);
        const inStroke = ctx.isPointInStroke(path2d, testX, testY);
        ctx.restore();
        if (inStroke) {
          return true;
        }
      }
    }
  }

  // 3. Fallback geométrico puro (Ray-casting poligonal y muestreo de curvas Bézier)
  const sampledPolygon: { x: number; y: number }[] = [];
  const points = path.points;

  sampledPolygon.push({ x: points[0].x, y: points[0].y });

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p3 = points[i];
    const p1 = p0.handleOut ?? p0;
    const p2 = p3.handleIn ?? p3;

    const samples = sampleCubicBezier(p0, p1, p2, p3, 12);
    // Añadir los puntos muestreados omitiendo el primero para evitar duplicados
    for (let k = 1; k < samples.length; k++) {
      sampledPolygon.push(samples[k]);
    }
  }

  if (path.closed && points.length > 2) {
    const last = points[points.length - 1];
    const first = points[0];
    const p1 = last.handleOut ?? last;
    const p2 = first.handleIn ?? first;

    const closingSamples = sampleCubicBezier(last, p1, p2, first, 12);
    for (let k = 1; k < closingSamples.length; k++) {
      sampledPolygon.push(closingSamples[k]);
    }

    // Si está cerrado y tiene relleno, verificar con Ray-Casting
    if (path.fill && path.fill !== 'transparent' && path.fill !== 'none') {
      if (pointInPolygon(testX, testY, sampledPolygon)) {
        return true;
      }
    }
  }

  // Verificar proximidad al trazo en los segmentos de la curva
  for (let i = 0; i < sampledPolygon.length - 1; i++) {
    const segA = sampledPolygon[i];
    const segB = sampledPolygon[i + 1];
    if (distToSegment(testX, testY, segA.x, segA.y, segB.x, segB.y) <= tolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Resultado normalizado de dimensiones y posición para un Rectangle.
 * (x, y) representa la esquina superior izquierda.
 */
export interface NormalizedRectangleBounds {
  readonly type: 'rectangle';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resultado normalizado de dimensiones y posición para un Ellipse.
 * (x, y) representa el centro geométrico de la elipse.
 */
export interface NormalizedEllipseBounds {
  readonly type: 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly width: number;
  readonly height: number;
}

export type NormalizedShapeBounds = NormalizedRectangleBounds | NormalizedEllipseBounds;

/**
 * Calcula las dimensiones y coordenadas normalizadas para una figura dada la posición
 * inicial y final de un arrastre interactivo sobre el lienzo.
 *
 * Funciona al arrastrar en cualquier dirección (los 4 cuadrantes), soporta
 * forzar proporción 1:1 (cuadrado / círculo perfecto) y respeta las convenciones de coordenadas:
 * - Para 'rectangle': (x, y) es la esquina superior izquierda.
 * - Para 'ellipse': (x, y) es el centro de la figura (radiusX = width / 2, radiusY = height / 2).
 *
 * @param start Punto inicial donde comenzó el arrastre
 * @param end Punto final o actual del cursor
 * @param type Tipo de figura a normalizar ('rectangle' | 'ellipse')
 * @param lockAspectRatio Si es true o { lockAspectRatio: true }, restringe las dimensiones a 1:1
 */
export function normalizeShapeBounds(
  start: Vector2D,
  end: Vector2D,
  type: 'rectangle',
  lockAspectRatio?: boolean | { lockAspectRatio?: boolean }
): NormalizedRectangleBounds;

export function normalizeShapeBounds(
  start: Vector2D,
  end: Vector2D,
  type: 'ellipse',
  lockAspectRatio?: boolean | { lockAspectRatio?: boolean }
): NormalizedEllipseBounds;

export function normalizeShapeBounds(
  start: Vector2D,
  end: Vector2D,
  type?: 'rectangle' | 'ellipse',
  lockAspectRatio?: boolean | { lockAspectRatio?: boolean }
): NormalizedRectangleBounds | NormalizedEllipseBounds;

export function normalizeShapeBounds(
  start: Vector2D,
  end: Vector2D,
  type: 'rectangle' | 'ellipse' = 'rectangle',
  lockAspectRatio: boolean | { lockAspectRatio?: boolean } = false
): NormalizedRectangleBounds | NormalizedEllipseBounds {
  const isLocked =
    typeof lockAspectRatio === 'boolean'
      ? lockAspectRatio
      : Boolean(lockAspectRatio?.lockAspectRatio);

  let currentEndX = end.x;
  let currentEndY = end.y;

  if (isLocked) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;

    currentEndX = start.x + signX * side;
    currentEndY = start.y + signY * side;
  }

  const minX = Math.min(start.x, currentEndX);
  const maxX = Math.max(start.x, currentEndX);
  const minY = Math.min(start.y, currentEndY);
  const maxY = Math.max(start.y, currentEndY);

  const width = maxX - minX;
  const height = maxY - minY;

  if (type === 'ellipse') {
    return {
      type: 'ellipse',
      x: minX + width / 2,
      y: minY + height / 2,
      radiusX: width / 2,
      radiusY: height / 2,
      width,
      height,
    };
  }

  return {
    type: 'rectangle',
    x: minX,
    y: minY,
    width,
    height,
  };
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calcula el Axis-Aligned Bounding Box (AABB) unificado que envuelve a todos los
 * nodos seleccionables provistos (figuras o grupos, considerando su geometría exacta).
 * Retorna null si la lista está vacía o no contiene elementos con dimensiones finitas.
 */
export function getSelectionBounds(nodes: readonly SelectableNode[]): AABB | null {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const aabb = getNodeAABB(node);
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Filtra y retorna los nodos seleccionables cuyo AABB intersecta con el rectángulo provisto.
 * Un grupo es incluido si su AABB intersecta el rectángulo de selección.
 * Normaliza el rectángulo para tolerar cualquier dirección de arrastre
 * (anchos o alturas negativos, o extremos min/max invertidos).
 */
export function getShapesIntersectingRect<T extends SelectableNode = SelectableNode>(
  nodes: readonly T[],
  rect: RectLike | AABB
): T[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  let rMinX: number;
  let rMaxX: number;
  let rMinY: number;
  let rMaxY: number;

  if ('x' in rect && 'y' in rect) {
    const x = rect.x;
    const y = rect.y;
    const w = rect.width;
    const h = rect.height;
    rMinX = Math.min(x, x + w);
    rMaxX = Math.max(x, x + w);
    rMinY = Math.min(y, y + h);
    rMaxY = Math.max(y, y + h);
  } else {
    rMinX = Math.min(rect.minX, rect.maxX);
    rMaxX = Math.max(rect.minX, rect.maxX);
    rMinY = Math.min(rect.minY, rect.maxY);
    rMaxY = Math.max(rect.minY, rect.maxY);
  }

  return nodes.filter((node) => {
    const aabb = getNodeAABB(node);
    return (
      aabb.minX <= rMaxX &&
      aabb.maxX >= rMinX &&
      aabb.minY <= rMaxY &&
      aabb.maxY >= rMinY
    );
  });
}

export type AlignmentMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type DistributionAxis = 'horizontal' | 'vertical';

/**
 * Calcula las nuevas posiciones (x, y) para alinear una lista de figuras
 * con respecto a su caja combinada (getSelectionBounds), considerando la geometría
 * exacta y rotación de cada figura mediante getShapeAABB.
 *
 * Retorna únicamente las entradas de aquellas figuras que realmente cambian de posición.
 * Si hay menos de 2 figuras, no es posible calcular la caja unificada, o ninguna figura
 * cambia de posición, retorna un array vacío.
 *
 * @param shapes Lista de figuras a alinear
 * @param mode Modo de alineación ('left', 'center-h', 'right', 'top', 'center-v', 'bottom')
 * @returns Array de entradas { id, x, y } para updateShapesPosition
 */
export function computeAlignment(
  shapes: readonly Shape[],
  mode: AlignmentMode
): ShapePositionEntry[] {
  if (!shapes || shapes.length < 2) {
    return [];
  }

  const bounds = getSelectionBounds(shapes);
  if (!bounds) {
    return [];
  }

  const EPSILON = 1e-5;
  const centerH = (bounds.minX + bounds.maxX) / 2;
  const centerV = (bounds.minY + bounds.maxY) / 2;

  const entries: ShapePositionEntry[] = [];

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const aabb = getShapeAABB(shape);

    let dx = 0;
    let dy = 0;

    switch (mode) {
      case 'left':
        dx = bounds.minX - aabb.minX;
        break;
      case 'center-h': {
        const shapeCenterH = (aabb.minX + aabb.maxX) / 2;
        dx = centerH - shapeCenterH;
        break;
      }
      case 'right':
        dx = bounds.maxX - aabb.maxX;
        break;
      case 'top':
        dy = bounds.minY - aabb.minY;
        break;
      case 'center-v': {
        const shapeCenterV = (aabb.minY + aabb.maxY) / 2;
        dy = centerV - shapeCenterV;
        break;
      }
      case 'bottom':
        dy = bounds.maxY - aabb.maxY;
        break;
    }

    const finalX = Math.abs(dx) > EPSILON ? shape.x + dx : shape.x;
    const finalY = Math.abs(dy) > EPSILON ? shape.y + dy : shape.y;

    if (finalX !== shape.x || finalY !== shape.y) {
      entries.push({
        id: shape.id,
        x: finalX,
        y: finalY,
      });
    }
  }

  return entries;
}

/**
 * Distribuye uniformemente una lista de figuras a lo largo de un eje ('horizontal' o 'vertical'),
 * haciendo que los espacios libres (gaps) entre los bordes de figuras contiguas sean exactamente iguales.
 *
 * Reglas:
 * 1. Requiere 3 o más figuras. Si recibe menos de 3 figuras, retorna un array vacío.
 * 2. Ordena las figuras según su posición espacial a lo largo del eje elegido (minX para horizontal,
 *    minY para vertical), NO por su orden en el array o de selección.
 * 3. Mantiene completamente fijas la primera y la última figura de la secuencia ordenada.
 * 4. Calcula el espacio total disponible entre el borde posterior de la primera figura y el borde anterior
 *    de la última, resta la suma de anchos/alturas de las figuras intermedias, y divide el espacio restante
 *    en (n - 1) espacios iguales.
 * 5. Retorna únicamente las entradas { id, x, y } de las figuras intermedias que realmente cambian de posición.
 *
 * @param shapes Lista de figuras a distribuir
 * @param axis Eje de distribución ('horizontal' o 'vertical')
 * @returns Array de entradas { id, x, y } para updateShapesPosition
 */
export function computeDistribution(
  shapes: readonly Shape[],
  axis: DistributionAxis
): ShapePositionEntry[] {
  if (!shapes || shapes.length < 3) {
    return [];
  }

  interface ShapeWithAABB {
    readonly shape: Shape;
    readonly aabb: AABB;
  }

  const items: ShapeWithAABB[] = shapes.map((shape) => ({
    shape,
    aabb: getShapeAABB(shape),
  }));

  const EPSILON = 1e-5;
  const entries: ShapePositionEntry[] = [];
  const n = items.length;

  if (axis === 'horizontal') {
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minX - b.aabb.minX) > EPSILON) {
        return a.aabb.minX - b.aabb.minX;
      }
      return a.aabb.maxX - b.aabb.maxX;
    });

    const firstEdge = items[0].aabb.maxX;
    const lastEdge = items[n - 1].aabb.minX;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateWidth = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateWidth += items[i].aabb.width;
    }

    const remainingSpace = totalSpan - totalIntermediateWidth;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinX = currentPos + gap;
      const dx = targetMinX - item.aabb.minX;
      const finalX = Math.abs(dx) > EPSILON ? item.shape.x + dx : item.shape.x;
      const finalY = item.shape.y;

      if (finalX !== item.shape.x || finalY !== item.shape.y) {
        entries.push({
          id: item.shape.id,
          x: finalX,
          y: finalY,
        });
      }

      currentPos = targetMinX + item.aabb.width;
    }
  } else {
    // vertical
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minY - b.aabb.minY) > EPSILON) {
        return a.aabb.minY - b.aabb.minY;
      }
      return a.aabb.maxY - b.aabb.maxY;
    });

    const firstEdge = items[0].aabb.maxY;
    const lastEdge = items[n - 1].aabb.minY;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateHeight = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateHeight += items[i].aabb.height;
    }

    const remainingSpace = totalSpan - totalIntermediateHeight;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinY = currentPos + gap;
      const dy = targetMinY - item.aabb.minY;
      const finalX = item.shape.x;
      const finalY = Math.abs(dy) > EPSILON ? item.shape.y + dy : item.shape.y;

      if (finalX !== item.shape.x || finalY !== item.shape.y) {
        entries.push({
          id: item.shape.id,
          x: finalX,
          y: finalY,
        });
      }

      currentPos = targetMinY + item.aabb.height;
    }
  }

  return entries;
}

export interface NodeDeltaEntry {
  readonly node: SelectableNode;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Calcula el desplazamiento relativo (dx, dy) necesario para alinear una colección
 * de nodos seleccionables (figuras o grupos) según el modo indicado.
 * Cada grupo es tratado como una unidad indivisible utilizando su getNodeAABB.
 */
export function computeNodesAlignment(
  nodes: readonly SelectableNode[],
  mode: AlignmentMode
): NodeDeltaEntry[] {
  if (!nodes || nodes.length < 2) {
    return [];
  }

  const bounds = getSelectionBounds(nodes);
  if (!bounds) {
    return [];
  }

  const EPSILON = 1e-5;
  const entries: NodeDeltaEntry[] = [];
  const centerH = bounds.minX + bounds.width / 2;
  const centerV = bounds.minY + bounds.height / 2;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const aabb = getNodeAABB(node);
    let dx = 0;
    let dy = 0;

    switch (mode) {
      case 'left':
        dx = bounds.minX - aabb.minX;
        break;
      case 'center-h': {
        const nodeCenterH = (aabb.minX + aabb.maxX) / 2;
        dx = centerH - nodeCenterH;
        break;
      }
      case 'right':
        dx = bounds.maxX - aabb.maxX;
        break;
      case 'top':
        dy = bounds.minY - aabb.minY;
        break;
      case 'center-v': {
        const nodeCenterV = (aabb.minY + aabb.maxY) / 2;
        dy = centerV - nodeCenterV;
        break;
      }
      case 'bottom':
        dy = bounds.maxY - aabb.maxY;
        break;
    }

    if (Math.abs(dx) > EPSILON || Math.abs(dy) > EPSILON) {
      entries.push({
        node,
        dx: Math.abs(dx) > EPSILON ? dx : 0,
        dy: Math.abs(dy) > EPSILON ? dy : 0,
      });
    }
  }

  return entries;
}

/**
 * Distribuye uniformemente una lista de nodos seleccionables (figuras o grupos)
 * a lo largo de un eje ('horizontal' o 'vertical'), dejando espacios libres iguales entre bordes.
 * Cada grupo es evaluado como una unidad indivisible con su getNodeAABB.
 */
export function computeNodesDistribution(
  nodes: readonly SelectableNode[],
  axis: DistributionAxis
): NodeDeltaEntry[] {
  if (!nodes || nodes.length < 3) {
    return [];
  }

  interface NodeWithAABB {
    readonly node: SelectableNode;
    readonly aabb: AABB;
  }

  const items: NodeWithAABB[] = nodes.map((node) => ({
    node,
    aabb: getNodeAABB(node),
  }));

  const EPSILON = 1e-5;
  const entries: NodeDeltaEntry[] = [];
  const n = items.length;

  if (axis === 'horizontal') {
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minX - b.aabb.minX) > EPSILON) {
        return a.aabb.minX - b.aabb.minX;
      }
      return a.aabb.maxX - b.aabb.maxX;
    });

    const firstEdge = items[0].aabb.maxX;
    const lastEdge = items[n - 1].aabb.minX;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateWidth = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateWidth += items[i].aabb.width;
    }

    const remainingSpace = totalSpan - totalIntermediateWidth;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinX = currentPos + gap;
      const dx = targetMinX - item.aabb.minX;

      if (Math.abs(dx) > EPSILON) {
        entries.push({
          node: item.node,
          dx,
          dy: 0,
        });
      }

      currentPos = targetMinX + item.aabb.width;
    }
  } else {
    // vertical
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minY - b.aabb.minY) > EPSILON) {
        return a.aabb.minY - b.aabb.minY;
      }
      return a.aabb.maxY - b.aabb.maxY;
    });

    const firstEdge = items[0].aabb.maxY;
    const lastEdge = items[n - 1].aabb.minY;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateHeight = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateHeight += items[i].aabb.height;
    }

    const remainingSpace = totalSpan - totalIntermediateHeight;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinY = currentPos + gap;
      const dy = targetMinY - item.aabb.minY;

      if (Math.abs(dy) > EPSILON) {
        entries.push({
          node: item.node,
          dx: 0,
          dy,
        });
      }

      currentPos = targetMinY + item.aabb.height;
    }
  }

  return entries;
}

export { getLeafShapes } from '../state/StateManager.ts';

/**
 * Normaliza un ángulo en grados al rango semiabierto (-180, 180].
 */
export function normalizeAngle(deg: number): number {
  let angle = ((deg % 360) + 360) % 360;
  if (angle > 180) {
    angle -= 360;
  }
  return Object.is(angle, -0) ? 0 : angle;
}

/**
 * Genera los 5 manejadores de selección (4 esquinas y rotación) para un AABB envolvente.
 * Utiliza los mismos tipos que getSelectionHandles.
 *
 * @param bounds Caja delimitadora (AABB) de la selección
 * @param handleSize Tamaño en píxeles del manejador (por defecto 8px)
 * @param rotationDistance Distancia del tirador de rotación (por defecto 30px)
 * @returns Array con los 5 manejadores: 'top-left', 'top-right', 'bottom-right', 'bottom-left' y 'rotation-handle'
 */
export function getSelectionBoxHandles(
  bounds: AABB,
  handleSize: number = 8,
  rotationDistance: number = 30
): SelectionHandle[] {
  const half = handleSize / 2;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const rotY = bounds.minY - rotationDistance;

  return [
    {
      type: 'top-left',
      minX: bounds.minX - half,
      minY: bounds.minY - half,
      maxX: bounds.minX + half,
      maxY: bounds.minY + half,
      width: handleSize,
      height: handleSize,
    },
    {
      type: 'top-right',
      minX: bounds.maxX - half,
      minY: bounds.minY - half,
      maxX: bounds.maxX + half,
      maxY: bounds.minY + half,
      width: handleSize,
      height: handleSize,
    },
    {
      type: 'bottom-right',
      minX: bounds.maxX - half,
      minY: bounds.maxY - half,
      maxX: bounds.maxX + half,
      maxY: bounds.maxY + half,
      width: handleSize,
      height: handleSize,
    },
    {
      type: 'bottom-left',
      minX: bounds.minX - half,
      minY: bounds.maxY - half,
      maxX: bounds.minX + half,
      maxY: bounds.maxY + half,
      width: handleSize,
      height: handleSize,
    },
    {
      type: 'rotation-handle',
      minX: midX - half,
      minY: rotY - half,
      maxX: midX + half,
      maxY: rotY + half,
      width: handleSize,
      height: handleSize,
    },
  ];
}

/**
 * Calcula el ancla opuesta y los factores de escala (sx, sy) al arrastrar un tirador de caja,
 * garantizando un tamaño mínimo de 5 px para el conjunto y respetando aspect ratio si se indica.
 *
 * @param bounds Caja delimitadora (AABB) de la selección
 * @param handle Tirador arrastrado ('top-left' | 'top-right' | 'bottom-right' | 'bottom-left')
 * @param dx Desplazamiento horizontal del ratón
 * @param dy Desplazamiento vertical del ratón
 * @param preserveAspect Si es true, restringe la escala para preservar proporciones
 * @returns { anchor, sx, sy }
 */
export function computeBoxScale(
  bounds: AABB,
  handle: HandleType,
  dx: number,
  dy: number,
  preserveAspect: boolean = false,
  fromCenter: boolean = false
): { anchor: Vector2D; sx: number; sy: number } {
  let anchor: Vector2D;
  let dxSign = 1;
  let dySign = 1;

  if (fromCenter) {
    anchor = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
  } else {
    switch (handle) {
      case 'top-left':
        anchor = { x: bounds.maxX, y: bounds.maxY };
        break;
      case 'top-right':
        anchor = { x: bounds.minX, y: bounds.maxY };
        break;
      case 'bottom-right':
        anchor = { x: bounds.minX, y: bounds.minY };
        break;
      case 'bottom-left':
        anchor = { x: bounds.maxX, y: bounds.minY };
        break;
      default:
        anchor = { x: bounds.minX, y: bounds.minY };
        break;
    }
  }

  switch (handle) {
    case 'top-left':
      dxSign = -1;
      dySign = -1;
      break;
    case 'top-right':
      dxSign = 1;
      dySign = -1;
      break;
    case 'bottom-right':
      dxSign = 1;
      dySign = 1;
      break;
    case 'bottom-left':
      dxSign = -1;
      dySign = 1;
      break;
    default:
      dxSign = 1;
      dySign = 1;
      break;
  }

  const initW = bounds.width;
  const initH = bounds.height;
  const safeInitW = Math.max(1, initW);
  const safeInitH = Math.max(1, initH);
  const mult = fromCenter ? 2 : 1;

  if (!preserveAspect) {
    const rawW = initW + mult * dxSign * dx;
    const rawH = initH + mult * dySign * dy;
    const newW = Math.max(5, rawW);
    const newH = Math.max(5, rawH);
    return {
      anchor,
      sx: newW / safeInitW,
      sy: newH / safeInitH,
    };
  }

  const diagLenSq = safeInitW * safeInitW + safeInitH * safeInitH;
  const dot = dxSign * dx * safeInitW + dySign * dy * safeInitH;
  const deltaScale = mult * (dot / diagLenSq);
  const rawScale = 1 + deltaScale;

  const minScale = Math.max(5 / safeInitW, 5 / safeInitH);
  const scale = Math.max(minScale, rawScale);

  return {
    anchor,
    sx: scale,
    sy: scale,
  };
}

/**
 * Calcula la variación angular (Δθ) en grados respecto a un pivote, normalizada en (-180, 180].
 * Si snap está activo, redondea en incrementos discretos de 15°.
 *
 * @param pivot Punto pivote de rotación
 * @param startMouse Posición inicial del ratón
 * @param currentMouse Posición actual del ratón
 * @param snap Si es true, ajusta el delta a múltiplos de 15°
 * @returns Delta de rotación en grados
 */
export function computeRotationDelta(
  pivot: Vector2D,
  startMouse: Vector2D,
  currentMouse: Vector2D,
  snap: boolean = false
): number {
  const startDx = startMouse.x - pivot.x;
  const startDy = startMouse.y - pivot.y;
  const curDx = currentMouse.x - pivot.x;
  const curDy = currentMouse.y - pivot.y;

  if ((startDx === 0 && startDy === 0) || (curDx === 0 && curDy === 0)) {
    return 0;
  }

  const startAngle = Math.atan2(startDy, startDx);
  const curAngle = Math.atan2(curDy, curDx);

  let deltaDeg = ((curAngle - startAngle) * 180) / Math.PI;
  deltaDeg = normalizeAngle(deltaDeg);

  if (snap) {
    deltaDeg = Math.round(deltaDeg / 15) * 15;
    deltaDeg = normalizeAngle(deltaDeg);
  }

  return deltaDeg;
}

/**
 * Desplaza las anclas especificadas por (dx, dy).
 * Para cada índice de `indices` desplaza x, y, handleIn y handleOut (si existen) por (dx, dy).
 * Los demás puntos se devuelven sin cambios (misma referencia). No muta la entrada.
 */
export function translatePathAnchors(
  points: readonly PathPoint[],
  indices: ReadonlySet<number>,
  dx: number,
  dy: number
): PathPoint[] {
  return points.map((pt, i) => {
    if (!indices.has(i)) {
      return pt;
    }
    return {
      ...pt,
      x: pt.x + dx,
      y: pt.y + dy,
      ...(pt.handleIn ? { handleIn: { x: pt.handleIn.x + dx, y: pt.handleIn.y + dy } } : {}),
      ...(pt.handleOut ? { handleOut: { x: pt.handleOut.x + dx, y: pt.handleOut.y + dy } } : {}),
    };
  });
}

/**
 * Referencia a un punto de control Bézier (manejador) visible para un trazado.
 */
export interface PathHandleRef {
  index: number;
  type: 'handleIn' | 'handleOut';
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Determina los manejadores de control Bézier visibles según las anclas seleccionadas.
 * Replicando el comportamiento estándar de programas como Adobe Illustrator:
 * - Para cada ancla seleccionada `i`: se exponen sus manejadores `handleIn` y `handleOut`.
 * - Para las anclas contiguas adyacentes (`i-1` e `i+1` dentro del mismo subtrazado): se exponen sus manejadores (`handleIn` y `handleOut`).
 * Si el trazado o el subtrazado está cerrado, `i-1` e `i+1` hacen wrap cíclico; si es abierto, se omiten los que salgan de los límites.
 * Ignora manejadores undefined o coincidentes con su ancla. Sin duplicados. Ignora índices >= points.length.
 */
export function getVisiblePathHandles(
  path: Path,
  selected: ReadonlySet<number>
): PathHandleRef[] {
  if (!path.points || path.points.length === 0 || selected.size === 0) {
    return [];
  }

  const n = path.points.length;
  const isClosed = Boolean(path.closed);
  const result: PathHandleRef[] = [];
  const seen = new Set<string>();

  const checkAndAdd = (idx: number, type: 'handleIn' | 'handleOut') => {
    const key = `${idx}:${type}`;
    if (seen.has(key)) return;
    seen.add(key);

    const pt = path.points[idx];
    if (!pt) return;

    const handle = type === 'handleIn' ? pt.handleIn : pt.handleOut;
    if (!handle) return;
    if (handle.x === pt.x && handle.y === pt.y) return;

    result.push({
      index: idx,
      type,
      x: handle.x,
      y: handle.y,
      anchorX: pt.x,
      anchorY: pt.y,
    });
  };

  for (const i of selected) {
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n) {
      continue;
    }

    // 1. Manejadores del nodo seleccionado i
    checkAndAdd(i, 'handleIn');
    checkAndAdd(i, 'handleOut');

    // 2. Determinar límites del subtrazado al que pertenece el ancla i
    let subpathStart = i;
    while (subpathStart > 0 && !path.points[subpathStart].moveTo) {
      subpathStart--;
    }
    let subpathEnd = i;
    while (subpathEnd < n - 1 && !path.points[subpathEnd + 1].moveTo) {
      subpathEnd++;
    }
    const subpathLen = subpathEnd - subpathStart + 1;
    const subpathClosed = isClosed || Boolean(path.points[subpathEnd].closeSubpath);

    let prevIdx = -1;
    let nextIdx = -1;

    if (subpathClosed && subpathLen > 1) {
      prevIdx = subpathStart + (i - subpathStart - 1 + subpathLen) % subpathLen;
      nextIdx = subpathStart + (i - subpathStart + 1) % subpathLen;
    } else {
      if (i > subpathStart) {
        prevIdx = i - 1;
      }
      if (i < subpathEnd) {
        nextIdx = i + 1;
      }
    }

    // 3. Manejadores de los nodos contiguos
    if (prevIdx >= 0) {
      checkAndAdd(prevIdx, 'handleIn');
      checkAndAdd(prevIdx, 'handleOut');
    }

    if (nextIdx >= 0) {
      checkAndAdd(nextIdx, 'handleIn');
      checkAndAdd(nextIdx, 'handleOut');
    }
  }

  return result;
}

/**
 * Refleja colinealmente un manejador opuesto respecto a su punto de ancla,
 * conservando la longitud original del opuesto.
 * opposite = anchor - normalize(dragged - anchor) * |oppositeInitial - anchor|
 */
export function mirrorHandleCollinear(
  anchor: Vector2D,
  dragged: Vector2D,
  oppositeInitial: Vector2D
): Vector2D {
  const dx = dragged.x - anchor.x;
  const dy = dragged.y - anchor.y;
  const lenDragged = Math.hypot(dx, dy);

  if (lenDragged === 0) {
    return { x: oppositeInitial.x, y: oppositeInitial.y };
  }

  const opDx = oppositeInitial.x - anchor.x;
  const opDy = oppositeInitial.y - anchor.y;
  const lenOpposite = Math.hypot(opDx, opDy);

  const normX = dx / lenDragged;
  const normY = dy / lenDragged;

  return {
    x: anchor.x - normX * lenOpposite,
    y: anchor.y - normY * lenOpposite,
  };
}

/**
 * Determina si un punto es suave: ambos manejadores existen, no coinciden con el ancla,
 * apuntan a lados opuestos y el producto vectorial normalizado es < 1e-3.
 */
export function isSmoothPoint(point: PathPoint): boolean {
  if (!point.handleIn || !point.handleOut) return false;
  const inX = point.handleIn.x - point.x;
  const inY = point.handleIn.y - point.y;
  const outX = point.handleOut.x - point.x;
  const outY = point.handleOut.y - point.y;

  const lenIn = Math.hypot(inX, inY);
  const lenOut = Math.hypot(outX, outY);
  if (lenIn < 1e-6 || lenOut < 1e-6) return false;

  const uInX = inX / lenIn;
  const uInY = inY / lenIn;
  const uOutX = outX / lenOut;
  const uOutY = outY / lenOut;

  // Apuntan a lados opuestos (producto escalar < 0)
  const dot = uInX * uOutX + uInY * uOutY;
  if (dot >= 0) return false;

  // Producto vectorial normalizado < 1e-3
  const cross = Math.abs(uInX * uOutY - uInY * uOutX);
  return cross < 1e-3;
}

/**
 * Subdivide una curva Bézier cúbica en el parámetro t ∈ [0, 1] usando el algoritmo de De Casteljau,
 * preservando exactamente la geometría de la curva en dos segmentos cúbicos contiguos.
 */
export function splitCubicBezier(
  p0: Vector2D,
  p1: Vector2D,
  p2: Vector2D,
  p3: Vector2D,
  t: number
): {
  left: [Vector2D, Vector2D, Vector2D, Vector2D];
  right: [Vector2D, Vector2D, Vector2D, Vector2D];
} {
  const clampT = Math.max(0, Math.min(1, t));
  const u = 1 - clampT;

  const p01 = { x: u * p0.x + clampT * p1.x, y: u * p0.y + clampT * p1.y };
  const p12 = { x: u * p1.x + clampT * p2.x, y: u * p1.y + clampT * p2.y };
  const p23 = { x: u * p2.x + clampT * p3.x, y: u * p2.y + clampT * p3.y };

  const p012 = { x: u * p01.x + clampT * p12.x, y: u * p01.y + clampT * p12.y };
  const p123 = { x: u * p12.x + clampT * p23.x, y: u * p12.y + clampT * p23.y };

  const p0123 = { x: u * p012.x + clampT * p123.x, y: u * p012.y + clampT * p123.y };

  return {
    left: [p0, p01, p012, p0123],
    right: [p0123, p123, p23, p3],
  };
}

/**
 * Evalúa el punto sobre una curva Bézier cúbica en el parámetro t ∈ [0, 1].
 */
export function evaluateCubicBezier(
  p0: Vector2D,
  p1: Vector2D,
  p2: Vector2D,
  p3: Vector2D,
  t: number
): Vector2D {
  const clampT = Math.max(0, Math.min(1, t));
  const u = 1 - clampT;
  const tt = clampT * clampT;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * clampT;

  return {
    x: uuu * p0.x + 3 * uu * clampT * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * clampT * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Proyecta un punto sobre un segmento de línea recta (p0 -> p1) y encuentra el punto más cercano, parámetro t y distancia.
 */
export function findNearestPointOnSegment(
  p0: Vector2D,
  p1: Vector2D,
  px: number,
  py: number
): { t: number; point: Vector2D; distance: number } {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-9) {
    return {
      t: 0,
      point: { x: p0.x, y: p0.y },
      distance: Math.hypot(px - p0.x, py - p0.y),
    };
  }

  const rawT = ((px - p0.x) * dx + (py - p0.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const point = {
    x: p0.x + t * dx,
    y: p0.y + t * dy,
  };

  return {
    t,
    point,
    distance: Math.hypot(px - point.x, py - point.y),
  };
}

/**
 * Encuentra el punto más cercano sobre una curva Bézier cúbica a un punto objetivo (px, py).
 * Utiliza muestreo uniforme inicial seguido de búsqueda ternaria para precisión subpíxel.
 */
export function findNearestPointOnCubicBezier(
  p0: Vector2D,
  p1: Vector2D,
  p2: Vector2D,
  p3: Vector2D,
  px: number,
  py: number,
  samples: number = 40
): { t: number; point: Vector2D; distance: number } {
  let bestT = 0;
  let bestDistSq = Infinity;
  let bestPoint = p0;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = evaluateCubicBezier(p0, p1, p2, p3, t);
    const dSq = (px - pt.x) ** 2 + (py - pt.y) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestT = t;
      bestPoint = pt;
    }
  }

  // Refinamiento fino mediante búsqueda ternaria en vecindad de bestT
  const step = 1 / samples;
  let left = Math.max(0, bestT - step);
  let right = Math.min(1, bestT + step);

  for (let iter = 0; iter < 14; iter++) {
    const m1 = left + (right - left) / 3;
    const m2 = right - (right - left) / 3;
    const pt1 = evaluateCubicBezier(p0, p1, p2, p3, m1);
    const pt2 = evaluateCubicBezier(p0, p1, p2, p3, m2);
    const d1 = (px - pt1.x) ** 2 + (py - pt1.y) ** 2;
    const d2 = (px - pt2.x) ** 2 + (py - pt2.y) ** 2;

    if (d1 < d2) {
      right = m2;
      if (d1 < bestDistSq) {
        bestDistSq = d1;
        bestT = m1;
        bestPoint = pt1;
      }
    } else {
      left = m1;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestT = m2;
        bestPoint = pt2;
      }
    }
  }

  return {
    t: bestT,
    point: bestPoint,
    distance: Math.sqrt(bestDistSq),
  };
}

/**
 * Resultado de la proyección más cercana sobre los segmentos de un trazado Path.
 */
export interface PathSegmentProjection {
  readonly segmentIndex: number;
  readonly t: number;
  readonly point: Vector2D; // En coordenadas locales del trazado
  readonly worldPoint: Vector2D; // En coordenadas del mundo
  readonly distance: number; // Distancia euclidiana en el mundo
}

/**
 * Proyecta un punto en coordenadas del mundo sobre los segmentos de un trazado Path,
 * calculando la distancia mínima y el parámetro t. Contempla rotación del trazado.
 */
export function findNearestPointOnPath(
  path: Path,
  worldX: number,
  worldY: number,
  maxDistance: number = Infinity
): PathSegmentProjection | null {
  if (!path.points || path.points.length < 2) {
    return null;
  }

  const n = path.points.length;
  const numSegments = path.closed ? n : n - 1;
  if (numSegments < 1) {
    return null;
  }

  // Desrotar punto de consulta si el trazado tiene rotación
  let localX = worldX;
  let localY = worldY;
  let cx = 0;
  let cy = 0;

  if (path.rotation) {
    const baseAABB = getPathBaseAABB(path);
    cx = (baseAABB.minX + baseAABB.maxX) / 2;
    cy = (baseAABB.minY + baseAABB.maxY) / 2;
    const rad = (-path.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = worldX - cx;
    const dy = worldY - cy;
    localX = cx + dx * cos - dy * sin;
    localY = cy + dx * sin + dy * cos;
  }

  let bestSegment = -1;
  let bestT = 0;
  let bestDist = Infinity;
  let bestLocalPoint: Vector2D = { x: 0, y: 0 };

  for (let i = 0; i < numSegments; i++) {
    const p0 = path.points[i];
    const p3 = path.points[(i + 1) % n];

    const hOut = p0.handleOut;
    const hIn = p3.handleIn;

    const hasOut = hOut && (hOut.x !== p0.x || hOut.y !== p0.y);
    const hasIn = hIn && (hIn.x !== p3.x || hIn.y !== p3.y);

    let res: { t: number; point: Vector2D; distance: number };
    if (!hasOut && !hasIn) {
      // Segmento recto
      res = findNearestPointOnSegment(p0, p3, localX, localY);
    } else {
      // Curva Bézier cúbica
      const p1 = hOut ?? p0;
      const p2 = hIn ?? p3;
      res = findNearestPointOnCubicBezier(p0, p1, p2, p3, localX, localY);
    }

    if (res.distance < bestDist) {
      bestDist = res.distance;
      bestSegment = i;
      bestT = res.t;
      bestLocalPoint = res.point;
    }
  }

  if (bestSegment < 0 || bestDist > maxDistance) {
    return null;
  }

  // Convertir punto local a coordenadas del mundo si existe rotación
  let worldPoint: Vector2D = bestLocalPoint;
  if (path.rotation) {
    const rad = (path.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = bestLocalPoint.x - cx;
    const dy = bestLocalPoint.y - cy;
    worldPoint = {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  return {
    segmentIndex: bestSegment,
    t: bestT,
    point: bestLocalPoint,
    worldPoint,
    distance: bestDist,
  };
}

/**
 * Subdivide un segmento del trazado en el parámetro t usando el algoritmo de De Casteljau,
 * insertando un nuevo PathPoint entre los vértices del segmento y preservando la forma exacta del trazado.
 */
export function splitPathSegment(
  path: Path,
  segmentIndex: number,
  t: number
): readonly PathPoint[] {
  const points = path.points;
  const n = points.length;
  if (n < 2 || segmentIndex < 0 || segmentIndex >= (path.closed ? n : n - 1)) {
    return points;
  }

  const i0 = segmentIndex;
  const i1 = (segmentIndex + 1) % n;
  const p0 = points[i0];
  const p3 = points[i1];

  const hOut = p0.handleOut;
  const hIn = p3.handleIn;

  const hasOut = hOut && (hOut.x !== p0.x || hOut.y !== p0.y);
  const hasIn = hIn && (hIn.x !== p3.x || hIn.y !== p3.y);

  const clampT = Math.max(0, Math.min(1, t));

  let updatedP0: PathPoint;
  let newPoint: PathPoint;
  let updatedP3: PathPoint;

  if (!hasOut && !hasIn) {
    // Segmento de línea recta
    const newX = (1 - clampT) * p0.x + clampT * p3.x;
    const newY = (1 - clampT) * p0.y + clampT * p3.y;
    updatedP0 = p0;
    updatedP3 = p3;
    newPoint = {
      x: newX,
      y: newY,
      pointType: 'corner',
    };
  } else {
    // Segmento Bézier cúbico: De Casteljau
    const p1 = hOut ?? p0;
    const p2 = hIn ?? p3;
    const { left, right } = splitCubicBezier(p0, p1, p2, p3, clampT);

    updatedP0 = {
      ...p0,
      handleOut: left[1],
    };
    newPoint = {
      x: left[3].x,
      y: left[3].y,
      handleIn: left[2],
      handleOut: right[1],
      pointType: 'smooth',
    };
    updatedP3 = {
      ...p3,
      handleIn: right[2],
    };
  }

  const result: PathPoint[] = [];
  if (segmentIndex < n - 1) {
    for (let i = 0; i < n; i++) {
      if (i === i0) {
        result.push(updatedP0);
        result.push(newPoint);
      } else if (i === i1) {
        result.push(updatedP3);
      } else {
        result.push(points[i]);
      }
    }
  } else {
    // Cierre del trazado: el segmento conecta el último punto (n - 1) con el primero (0)
    result.push(updatedP3);
    for (let i = 1; i < n - 1; i++) {
      result.push(points[i]);
    }
    result.push(updatedP0);
    result.push(newPoint);
  }

  return result;
}

/**
 * Elimina uno o varios vértices de un trazado por índice, reconectando los puntos adyacentes.
 * Retorna null si la cantidad de puntos resultantes es menor a 2.
 */
export function deletePathPointsFromPath(
  path: Path,
  indicesToDelete: readonly number[] | ReadonlySet<number>
): readonly PathPoint[] | null {
  const set = indicesToDelete instanceof Set ? indicesToDelete : new Set(indicesToDelete);
  const remaining: PathPoint[] = [];

  for (let i = 0; i < path.points.length; i++) {
    if (!set.has(i)) {
      remaining.push(path.points[i]);
    }
  }

  if (remaining.length < 2) {
    return null;
  }

  return remaining;
}

/**
 * Determina el tipo de vértice de un punto de ancla (corner, smooth, o symmetric).
 */
export function getPointType(point: PathPoint): PathPointType {
  if (point.pointType) {
    return point.pointType;
  }
  if (!point.handleIn || !point.handleOut) {
    return 'corner';
  }
  if (!isSmoothPoint(point)) {
    return 'corner';
  }
  const lenIn = Math.hypot(point.handleIn.x - point.x, point.handleIn.y - point.y);
  const lenOut = Math.hypot(point.handleOut.x - point.x, point.handleOut.y - point.y);
  if (Math.abs(lenIn - lenOut) < 0.5) {
    return 'symmetric';
  }
  return 'smooth';
}

/**
 * Aplica un nuevo tipo de vértice a un punto de ancla, recalculando o sincronizando sus manejadores.
 */
export function applyPointType(
  point: PathPoint,
  targetType: PathPointType,
  prevPoint?: PathPoint,
  nextPoint?: PathPoint
): PathPoint {
  if (targetType === 'corner') {
    return {
      ...point,
      pointType: 'corner',
    };
  }

  const lenIn = point.handleIn ? Math.hypot(point.handleIn.x - point.x, point.handleIn.y - point.y) : 0;
  const lenOut = point.handleOut ? Math.hypot(point.handleOut.x - point.x, point.handleOut.y - point.y) : 0;

  if (targetType === 'smooth') {
    if (lenIn > 1e-4 && lenOut > 1e-4) {
      const alignedIn = mirrorHandleCollinear(
        { x: point.x, y: point.y },
        point.handleOut!,
        point.handleIn!
      );
      return {
        ...point,
        handleIn: alignedIn,
        pointType: 'smooth',
      };
    } else if (lenOut > 1e-4) {
      const dx = point.handleOut!.x - point.x;
      const dy = point.handleOut!.y - point.y;
      return {
        ...point,
        handleIn: { x: point.x - dx, y: point.y - dy },
        pointType: 'smooth',
      };
    } else if (lenIn > 1e-4) {
      const dx = point.handleIn!.x - point.x;
      const dy = point.handleIn!.y - point.y;
      return {
        ...point,
        handleOut: { x: point.x - dx, y: point.y - dy },
        pointType: 'smooth',
      };
    } else {
      // Sintetizar manejadores tangentes si no existen
      let dirX = 1;
      let dirY = 0;
      let defaultLen = 30;
      if (prevPoint && nextPoint) {
        const dx = nextPoint.x - prevPoint.x;
        const dy = nextPoint.y - prevPoint.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-4) {
          dirX = dx / d;
          dirY = dy / d;
          defaultLen = Math.min(d / 4, 40);
        }
      }
      return {
        ...point,
        handleIn: { x: point.x - dirX * defaultLen, y: point.y - dirY * defaultLen },
        handleOut: { x: point.x + dirX * defaultLen, y: point.y + dirY * defaultLen },
        pointType: 'smooth',
      };
    }
  }

  // targetType === 'symmetric'
  let targetLen = Math.max(lenIn, lenOut);
  if (lenIn > 1e-4 && lenOut > 1e-4) {
    targetLen = (lenIn + lenOut) / 2;
  } else if (targetLen < 1e-4) {
    targetLen = 30;
  }

  let dirX = 1;
  let dirY = 0;
  if (lenOut > 1e-4) {
    dirX = (point.handleOut!.x - point.x) / lenOut;
    dirY = (point.handleOut!.y - point.y) / lenOut;
  } else if (lenIn > 1e-4) {
    dirX = -(point.handleIn!.x - point.x) / lenIn;
    dirY = -(point.handleIn!.y - point.y) / lenIn;
  } else if (prevPoint && nextPoint) {
    const dx = nextPoint.x - prevPoint.x;
    const dy = nextPoint.y - prevPoint.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      dirX = dx / d;
      dirY = dy / d;
      targetLen = Math.min(d / 4, 40);
    }
  }

  return {
    ...point,
    handleIn: { x: point.x - dirX * targetLen, y: point.y - dirY * targetLen },
    handleOut: { x: point.x + dirX * targetLen, y: point.y + dirY * targetLen },
    pointType: 'symmetric',
  };
}

/**
 * Sincroniza el manejador opuesto respecto al ancla según el tipo de vértice cuando se arrastra uno de ellos.
 */
export function syncOppositeHandle(
  anchor: Vector2D,
  draggedHandle: Vector2D,
  oppositeInitial: Vector2D,
  pointType?: PathPointType
): Vector2D {
  if (pointType === 'symmetric') {
    return {
      x: 2 * anchor.x - draggedHandle.x,
      y: 2 * anchor.y - draggedHandle.y,
    };
  }
  if (pointType === 'corner') {
    return oppositeInitial;
  }
  return mirrorHandleCollinear(anchor, draggedHandle, oppositeInitial);
}

/**
 * Calcula la distancia perpendicular desde un punto p al segmento de línea recta (lineStart, lineEnd).
 */
export function perpendicularDistance(
  p: Vector2D,
  lineStart: Vector2D,
  lineEnd: Vector2D
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-12) {
    return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - lineStart.x) * dx + (p.y - lineStart.y) * dy) / lenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Algoritmo Ramer-Douglas-Peucker (RDP) para simplificación y reducción de ruido en polilíneas.
 * Reduce el número de puntos conservando la curvatura y forma general del trazo libre.
 *
 * @param points Secuencia de puntos muestreados durante el arrastre libre
 * @param epsilon Umbral de tolerancia de distancia máxima
 */
export function simplifyPointsRDP(
  points: readonly Vector2D[],
  epsilon: number
): Vector2D[] {
  if (points.length <= 2) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPointsRDP(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPointsRDP(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [
      { x: first.x, y: first.y },
      { x: last.x, y: last.y },
    ];
  }
}

/**
 * Ajusta una curva suave de Bézier cúbica continua (C1) a partir de una secuencia de puntos 2D,
 * utilizando la formulación de derivadas y tangentes continuas de Catmull-Rom.
 * Genera puntos de ancla con manejadores handleIn y handleOut tangenciales.
 *
 * @param points Puntos 2D simplificados
 * @param tension Factor de curvatura / tensión (0.5 por defecto)
 * @returns Array de PathPoint listos para un nodo Path
 */
export function fitCurveCatmullRom(
  points: readonly Vector2D[],
  tension: number = 0.5
): PathPoint[] {
  const n = points.length;
  if (n === 0) {
    return [];
  }

  if (n === 1) {
    return [
      {
        x: points[0].x,
        y: points[0].y,
        pointType: 'corner',
      },
    ];
  }

  if (n === 2) {
    return [
      {
        x: points[0].x,
        y: points[0].y,
        pointType: 'corner',
      },
      {
        x: points[1].x,
        y: points[1].y,
        pointType: 'corner',
      },
    ];
  }

  const result: PathPoint[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const curr = points[i];

    if (i === 0) {
      const next = points[1];
      const tx = (next.x - curr.x) * tension;
      const ty = (next.y - curr.y) * tension;
      result[i] = {
        x: curr.x,
        y: curr.y,
        handleOut: {
          x: curr.x + tx / 3,
          y: curr.y + ty / 3,
        },
        pointType: 'corner',
      };
    } else if (i === n - 1) {
      const prev = points[n - 2];
      const tx = (curr.x - prev.x) * tension;
      const ty = (curr.y - prev.y) * tension;
      result[i] = {
        x: curr.x,
        y: curr.y,
        handleIn: {
          x: curr.x - tx / 3,
          y: curr.y - ty / 3,
        },
        pointType: 'corner',
      };
    } else {
      const prev = points[i - 1];
      const next = points[i + 1];
      const tx = ((next.x - prev.x) / 2) * tension;
      const ty = ((next.y - prev.y) / 2) * tension;
      result[i] = {
        x: curr.x,
        y: curr.y,
        handleIn: {
          x: curr.x - tx / 3,
          y: curr.y - ty / 3,
        },
        handleOut: {
          x: curr.x + tx / 3,
          y: curr.y + ty / 3,
        },
        pointType: 'smooth',
      };
    }
  }

  return result;
}

/**
 * Obtiene el Axis-Aligned Bounding Box (AABB) de una colección de puntos Vector2D.
 */
export function getPointsAABB(points: readonly Vector2D[]): AABB {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Traza el contorno geométrico de una figura en el contexto de Canvas 2D
 * y aplica el recorte mediante ctx.clip() en coordenadas del mundo.
 */
export function traceShapeClip(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.beginPath();

  if (shape.type === 'rectangle') {
    const rect = shape as Rectangle;
    if (!rect.rotation) {
      if (rect.cornerRadius && rect.cornerRadius > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.cornerRadius);
      } else {
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
      }
    } else {
      const rad = (rect.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const hw = rect.width / 2;
      const hh = rect.height / 2;

      const corners = [
        { x: cx - hw * cos - -hh * sin, y: cy - hw * sin + -hh * cos },
        { x: cx + hw * cos - -hh * sin, y: cy + hw * sin + -hh * cos },
        { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos },
        { x: cx - hw * cos - hh * sin, y: cy - hw * sin + hh * cos },
      ];
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
    }
    ctx.clip();
  } else if (shape.type === 'ellipse') {
    const ellipse = shape as Ellipse;
    const rad = ((ellipse.rotation ?? 0) * Math.PI) / 180;
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(
        ellipse.x,
        ellipse.y,
        Math.abs(ellipse.radiusX),
        Math.abs(ellipse.radiusY),
        rad,
        0,
        2 * Math.PI
      );
    } else {
      ctx.arc(ellipse.x, ellipse.y, Math.max(Math.abs(ellipse.radiusX), Math.abs(ellipse.radiusY)), 0, 2 * Math.PI);
    }
    ctx.clip();
  } else if (shape.type === 'polygon') {
    const poly = shape as Polygon;
    const verts = getPolygonVertices(poly);
    if (verts.length > 0) {
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
    }
    ctx.clip();
  } else if (shape.type === 'star') {
    const star = shape as Star;
    const verts = getStarVertices(star);
    if (verts.length > 0) {
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
    }
    ctx.clip();
  } else if (shape.type === 'path') {
    const path = shape as Path;
    const points = path.points;
    if (!points || points.length === 0) {
      ctx.clip();
      return;
    }

    let transformPt = (pt: { x: number; y: number }) => pt;
    if (path.rotation) {
      const baseAABB = getPathBaseAABB(path);
      const cx = (baseAABB.minX + baseAABB.maxX) / 2;
      const cy = (baseAABB.minY + baseAABB.maxY) / 2;
      const rad = (path.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      transformPt = (pt: { x: number; y: number }) => {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        return {
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        };
      };
    }

    let subpathStartIdx = 0;
    for (let i = 0; i < points.length; i++) {
      const curr = points[i];
      const tCurr = transformPt(curr);
      if (i === 0 || curr.moveTo) {
        if (i > 0) {
          const prevStart = points[subpathStartIdx];
          const last = points[i - 1];
          const shouldClose = last.closeSubpath ?? path.closed;
          if (shouldClose && i - subpathStartIdx > 1) {
            const pStart = transformPt(prevStart);
            const pLast = transformPt(last);
            const cp1 = last.handleOut ? transformPt(last.handleOut) : pLast;
            const cp2 = prevStart.handleIn ? transformPt(prevStart.handleIn) : pStart;
            ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pStart.x, pStart.y);
            ctx.closePath();
          }
        }
        subpathStartIdx = i;
        ctx.moveTo(tCurr.x, tCurr.y);
      } else {
        const prev = points[i - 1];
        const pPrev = transformPt(prev);
        const cp1 = prev.handleOut ? transformPt(prev.handleOut) : pPrev;
        const cp2 = curr.handleIn ? transformPt(curr.handleIn) : tCurr;
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, tCurr.x, tCurr.y);
      }
    }

    if (points.length > 0) {
      const prevStart = points[subpathStartIdx];
      const last = points[points.length - 1];
      const shouldClose = last.closeSubpath ?? path.closed;
      if (shouldClose && points.length - subpathStartIdx > 1) {
        const pStart = transformPt(prevStart);
        const pLast = transformPt(last);
        const cp1 = last.handleOut ? transformPt(last.handleOut) : pLast;
        const cp2 = prevStart.handleIn ? transformPt(prevStart.handleIn) : pStart;
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pStart.x, pStart.y);
        ctx.closePath();
      }
    }

    const fillRule = path.fillRule ?? 'nonzero';
    try {
      ctx.clip(fillRule);
    } catch {
      ctx.clip();
    }
  } else if (shape.type === 'text') {
    const text = shape as Text;
    const aabb = getTextBaseAABB(text, ctx);
    ctx.rect(aabb.minX, aabb.minY, aabb.width, aabb.height);
    ctx.clip();
  } else if (shape.type === 'image') {
    const img = shape as ImageNode;
    ctx.rect(img.x, img.y, img.width, img.height);
    ctx.clip();
  }
}

