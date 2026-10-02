import type { AABB, Ellipse, Path, Rectangle, Shape } from '../types/scene-graph.ts';

/**
 * Calcula el Axis-Aligned Bounding Box (AABB) de un nodo Rectangle.
 * Si tiene rotación, calcula la envolvente exacta de sus cuatro esquinas rotadas.
 */
export function getRectangleAABB(rect: Rectangle): AABB {
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
 * Calcula el Axis-Aligned Bounding Box (AABB) de un nodo Path (trazado vectorial).
 * Incluye los puntos de ancla y sus manejadores de control Bézier.
 */
export function getPathAABB(path: Path): AABB {
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

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of path.points) {
    const checkCoords = [pt];
    if (pt.handleIn) checkCoords.push(pt.handleIn);
    if (pt.handleOut) checkCoords.push(pt.handleOut);

    for (const { x, y } of checkCoords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
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
 * Obtiene el AABB (Axis-Aligned Bounding Box) de cualquier figura (Shape).
 */
export function getShapeAABB(shape: Shape): AABB {
  if (shape.type === 'rectangle') {
    return getRectangleAABB(shape);
  }
  if (shape.type === 'ellipse') {
    return getEllipseAABB(shape);
  }
  return getPathAABB(shape);
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
 * Tipos de manejadores de esquina
 */
export type HandleType = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/**
 * Representación de un manejador de esquina como AABB pequeño
 */
export interface SelectionHandle extends AABB {
  readonly type: HandleType;
}

/**
 * Calcula el AABB de un Shape y devuelve un array con 4 objetos geométricos
 * (AABBs pequeños de 8x8px) correspondientes a los manejadores de sus 4 esquinas.
 *
 * @param shape Figura seleccionada
 * @param handleSize Tamaño en píxeles del manejador (por defecto 8px)
 * @returns Array con los 4 manejadores: 'top-left', 'top-right', 'bottom-right', 'bottom-left'
 */
export function getSelectionHandles(shape: Shape, handleSize: number = 8): SelectionHandle[] {
  const aabb = getShapeAABB(shape);
  const half = handleSize / 2;

  return [
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

  path2d.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
    const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
    const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
    const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;

    path2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
  }

  if (path.closed && points.length > 2) {
    const last = points[points.length - 1];
    const first = points[0];

    const cp1x = last.handleOut ? last.handleOut.x : last.x;
    const cp1y = last.handleOut ? last.handleOut.y : last.y;
    const cp2x = first.handleIn ? first.handleIn.x : first.x;
    const cp2y = first.handleIn ? first.handleIn.y : first.y;

    path2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x, first.y);
    path2d.closePath();
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
  ctx?: CanvasRenderingContext2D | null
): boolean {
  if (!path.points || path.points.length === 0) {
    return false;
  }

  // 1. Broad-phase: AABB con margen de tolerancia
  const strokeWidth = path.strokeWidth ?? 2;
  const tolerance = Math.max(strokeWidth / 2 + 5, 8);
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

  // 2. Intentar evaluación directa con Canvas 2D API (ctx.isPointInPath / ctx.isPointInStroke)
  if (ctx) {
    const path2d = buildPath2D(path);
    if (path2d) {
      // Si el trazado tiene relleno
      if (path.fill && path.fill !== 'transparent' && path.fill !== 'none') {
        if (ctx.isPointInPath(path2d, px, py)) {
          return true;
        }
      }

      // Si el trazado tiene trazo (stroke)
      if (ctx.isPointInStroke) {
        ctx.save();
        ctx.lineWidth = Math.max(strokeWidth, 8);
        const inStroke = ctx.isPointInStroke(path2d, px, py);
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
      if (pointInPolygon(px, py, sampledPolygon)) {
        return true;
      }
    }
  }

  // Verificar proximidad al trazo en los segmentos de la curva
  for (let i = 0; i < sampledPolygon.length - 1; i++) {
    const segA = sampledPolygon[i];
    const segB = sampledPolygon[i + 1];
    if (distToSegment(px, py, segA.x, segA.y, segB.x, segB.y) <= tolerance) {
      return true;
    }
  }

  return false;
}

