import type {
  AABB,
  Ellipse,
  ImageNode,
  Path,
  Polygon,
  Rectangle,
  Shape,
  Star,
  Text,
  Vector2D,
} from '../../types/scene-graph.ts';
import {
  getRectangleAABB,
  getEllipseAABB,
  getPolygonAABB,
  getStarAABB,
  getPathAABB,
  getPathBaseAABB,
  isPointInAABB,
} from './aabb.ts';
import { getPolygonVertices, getStarVertices } from './vertices.ts';
import { isPointInText, getTextBaseAABB } from './textMetrics.ts';

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
