import type {
  AABB,
  Ellipse,
  Group,
  ImageNode,
  Path,
  Polygon,
  Rectangle,
  SelectableNode,
  Shape,
  Star,
  Vector2D,
  DropShadow,
} from '../../types/scene-graph.ts';
import { isShape } from '../../types/scene-graph.ts';
import { getCubicBezierSegmentExtrema1D } from './bezier.ts';
import { getPolygonVertices, getStarVertices } from './vertices.ts';
import { getTextAABB } from './textMetrics.ts';

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
 * Expande un AABB considerando el desplazamiento y desenfoque de una sombra paralela (DropShadow).
 */
export function expandAABBWithShadow(aabb: AABB, shadow?: DropShadow | null): AABB {
  if (!shadow || (shadow.offsetX === 0 && shadow.offsetY === 0 && (!shadow.blur || shadow.blur === 0))) {
    return aabb;
  }
  const blur = Math.max(0, shadow.blur || 0);
  const ox = shadow.offsetX || 0;
  const oy = shadow.offsetY || 0;

  const shadowMinX = aabb.minX + ox - blur;
  const shadowMinY = aabb.minY + oy - blur;
  const shadowMaxX = aabb.maxX + ox + blur;
  const shadowMaxY = aabb.maxY + oy + blur;

  const minX = Math.min(aabb.minX, shadowMinX);
  const minY = Math.min(aabb.minY, shadowMinY);
  const maxX = Math.max(aabb.maxX, shadowMaxX);
  const maxY = Math.max(aabb.maxY, shadowMaxY);

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
 * Obtiene el AABB visual de cualquier figura, incluyendo la expansión de sombra si existe.
 */
export function getShapeVisualAABB(shape: Shape): AABB {
  const baseAABB = getShapeAABB(shape);
  if (shape.dropShadow) {
    return expandAABBWithShadow(baseAABB, shape.dropShadow);
  }
  return baseAABB;
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
