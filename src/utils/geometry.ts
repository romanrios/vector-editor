import type { AABB, Ellipse, Group, Path, Rectangle, SelectableNode, Shape, Vector2D } from '../types/scene-graph.ts';
import { isShape } from '../types/scene-graph.ts';
import type { ShapePositionEntry } from '../state/StateManager.ts';

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
  for (let i = 1; i < points.length; i++) {
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

  if (path.closed && points.length > 2) {
    const p0 = points[points.length - 1];
    const p3 = points[0];
    const p1 = p0.handleOut ?? p0;
    const p2 = p3.handleIn ?? p3;

    const xExt = getCubicBezierSegmentExtrema1D(p0.x, p1.x, p2.x, p3.x);
    const yExt = getCubicBezierSegmentExtrema1D(p0.y, p1.y, p2.y, p3.y);

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
export function isPointInShape(
  x: number,
  y: number,
  shape: Rectangle | Ellipse,
  tolerance: number = 0
): boolean {
  if (shape.type !== 'rectangle' && shape.type !== 'ellipse') {
    return false;
  }

  const t = Math.max(0, tolerance);

  // 1. Fase rápida: descarte mediante AABB ampliado con tolerancia
  const aabb = shape.type === 'rectangle' ? getRectangleAABB(shape) : getEllipseAABB(shape);
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
    const cx = shape.type === 'rectangle' ? shape.x + shape.width / 2 : shape.x;
    const cy = shape.type === 'rectangle' ? shape.y + shape.height / 2 : shape.y;
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
  if (shape.type === 'rectangle') {
    const minX = Math.min(shape.x, shape.x + shape.width) - t;
    const maxX = Math.max(shape.x, shape.x + shape.width) + t;
    const minY = Math.min(shape.y, shape.y + shape.height) - t;
    const maxY = Math.max(shape.y, shape.y + shape.height) + t;

    return (
      localX >= minX - 1e-9 &&
      localX <= maxX + 1e-9 &&
      localY >= minY - 1e-9 &&
      localY <= maxY + 1e-9
    );
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
export type HandleType = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left' | 'rotation-handle';

/**
 * Representación de un manejador de selección como AABB pequeño
 */
export interface SelectionHandle extends AABB {
  readonly type: HandleType;
}

/**
 * Calcula el AABB de un Shape y devuelve un array con 5 objetos geométricos
 * (AABBs pequeños de 8x8px) correspondientes a las 4 esquinas y al manejador de rotación flotante.
 *
 * @param shape Figura seleccionada
 * @param handleSize Tamaño en píxeles del manejador (por defecto 8px)
 * @returns Array con los 5 manejadores: 'top-left', 'top-right', 'bottom-right', 'bottom-left' y 'rotation-handle'
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

  // Figura con rotación: calcular esquinas y manejador de rotación en espacio rotado (OBB)
  let cx = 0;
  let cy = 0;
  let hw = 0;
  let hh = 0;

  if (shape.type === 'rectangle') {
    hw = shape.width / 2;
    hh = shape.height / 2;
    cx = shape.x + hw;
    cy = shape.y + hh;
  } else if (shape.type === 'ellipse') {
    hw = shape.radiusX;
    hh = shape.radiusY;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'path') {
    const baseAABB = getPathBaseAABB(shape);
    hw = baseAABB.width / 2;
    hh = baseAABB.height / 2;
    cx = (baseAABB.minX + baseAABB.maxX) / 2;
    cy = (baseAABB.minY + baseAABB.maxY) / 2;
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
        if (ctx.isPointInPath(path2d, testX, testY)) {
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



