import type {
  PathPoint,
  Polygon,
  Shape,
  Star,
  Vector2D,
} from '../types/scene-graph.ts';
import { getPolygonVertices, getStarVertices } from './geometry.ts';

/**
 * Información geométrica detallada de un arco tangente en un vértice de esquina.
 */
export interface CornerArcInfo {
  readonly effectiveRadius: number;
  readonly maxRadius: number;
  readonly tangentDistance: number;
  readonly tangentPoint1: Vector2D;
  readonly tangentPoint2: Vector2D;
  readonly controlPoint1: Vector2D;
  readonly controlPoint2: Vector2D;
  readonly center: Vector2D;
  readonly bisector: Vector2D;
  readonly angle: number;
  readonly handlePosition: Vector2D;
}

/**
 * Tirador interactivo de radio de esquina para manipular visualmente en el canvas.
 */
export interface CornerRadiusHandle {
  readonly id: string;
  readonly shapeId: string;
  readonly vertexIndex: number;
  readonly x: number;
  readonly y: number;
  readonly vertexX: number;
  readonly vertexY: number;
  readonly bisectorX: number;
  readonly bisectorY: number;
  readonly currentRadius: number;
  readonly maxRadius: number;
  readonly isInner?: boolean;
}

/**
 * Calcula con precisión analítica el arco tangente y su aproximación Bézier cúbica
 * en un vértice formado por los puntos pPrev -> pCurr -> pNext.
 *
 * @param pPrev Punto anterior
 * @param pCurr Vértice actual (esquina a redondear)
 * @param pNext Punto siguiente
 * @param desiredRadius Radio de curvatura deseado
 * @param zoom Nivel de zoom actual para calcular el espaciado de interfaz del tirador
 * @returns Datos del arco o null si el vértice es degenerado o colineal
 */
export function computeCornerArc(
  pPrev: Vector2D,
  pCurr: Vector2D,
  pNext: Vector2D,
  desiredRadius: number,
  zoom: number = 1
): CornerArcInfo | null {
  const v1x = pPrev.x - pCurr.x;
  const v1y = pPrev.y - pCurr.y;
  const len1 = Math.hypot(v1x, v1y);

  const v2x = pNext.x - pCurr.x;
  const v2y = pNext.y - pCurr.y;
  const len2 = Math.hypot(v2x, v2y);

  if (len1 < 1e-4 || len2 < 1e-4) {
    return null;
  }

  const u1x = v1x / len1;
  const u1y = v1y / len1;
  const u2x = v2x / len2;
  const u2y = v2y / len2;

  const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));

  // Si son colineales (180° o 0°), no existe esquina angular que redondear
  if (dot > 0.9999 || dot < -0.9999) {
    return null;
  }

  const angle = Math.acos(dot);
  const halfAngle = angle / 2;
  const tanHalf = Math.tan(halfAngle);
  const sinHalf = Math.sin(halfAngle);

  if (tanHalf < 1e-4 || sinHalf < 1e-4) {
    return null;
  }

  // La distancia tangencial máxima está limitada por la mitad de la arista adyacente más corta
  const maxTangentDist = Math.min(len1, len2) / 2;
  const maxRadius = maxTangentDist * tanHalf;

  const effectiveRadius = Math.max(0, Math.min(desiredRadius, maxRadius));
  const tangentDist = effectiveRadius / tanHalf;

  // Puntos tangenciales de contacto con los segmentos incidentes
  const t1: Vector2D = {
    x: pCurr.x + u1x * tangentDist,
    y: pCurr.y + u1y * tangentDist,
  };
  const t2: Vector2D = {
    x: pCurr.x + u2x * tangentDist,
    y: pCurr.y + u2y * tangentDist,
  };

  // Vector bisectriz interior normalizado
  let bx = u1x + u2x;
  let by = u1y + u2y;
  const bLen = Math.hypot(bx, by);
  if (bLen < 1e-4) {
    return null;
  }
  bx /= bLen;
  by /= bLen;
  const bisector: Vector2D = { x: bx, y: by };

  // Centro del arco circular
  const distToCenter = effectiveRadius / sinHalf;
  const center: Vector2D = {
    x: pCurr.x + bx * distToCenter,
    y: pCurr.y + by * distToCenter,
  };

  // Puntos de control Bézier cúbicos para aproximar el arco circular:
  // Ángulo del arco = π - angle
  // Factor kappa = (4/3) * tan((π - angle) / 4) * R
  const arcAngle = Math.PI - angle;
  const kappa = (4 / 3) * Math.tan(arcAngle / 4) * effectiveRadius;

  // Tangente en T1 va en dirección -u1 (hacia pCurr)
  const cp1: Vector2D = {
    x: t1.x - u1x * kappa,
    y: t1.y - u1y * kappa,
  };
  // Tangente en T2 va en dirección -u2 (hacia pCurr)
  const cp2: Vector2D = {
    x: t2.x - u2x * kappa,
    y: t2.y - u2y * kappa,
  };

  // Posición del tirador de interfaz en el canvas:
  // Ubicado a lo largo de la bisectriz interior
  const baseOffset = Math.min(maxTangentDist * 0.7, 18 / Math.max(zoom, 0.1));
  const apexDist = effectiveRadius * (1 / sinHalf - 1);
  const handleDist = Math.min(
    maxTangentDist * 0.9,
    Math.max(baseOffset, apexDist + 4 / Math.max(zoom, 0.1))
  );

  const handlePosition: Vector2D = {
    x: pCurr.x + bx * handleDist,
    y: pCurr.y + by * handleDist,
  };

  return {
    effectiveRadius,
    maxRadius,
    tangentDistance: tangentDist,
    tangentPoint1: t1,
    tangentPoint2: t2,
    controlPoint1: cp1,
    controlPoint2: cp2,
    center,
    bisector,
    angle,
    handlePosition,
  };
}

/**
 * Convierte un array de puntos de trazado aplicando redondeo en todas las esquinas que
 * tengan cornerRadius > 0 o que hereden el defaultRadius del trazado.
 *
 * @param points Puntos originales del trazado
 * @param closed Si el trazado está cerrado
 * @param defaultRadius Radio por defecto para vértices que no especifiquen uno propio
 * @returns Nuevo array de puntos con curvas Bézier insertadas en cada esquina redondeada
 */
export function smoothPathPoints(
  points: readonly PathPoint[],
  closed: boolean,
  defaultRadius: number = 0
): PathPoint[] {
  if (!points || points.length < 3) {
    return [...points];
  }

  const n = points.length;
  const result: PathPoint[] = [];

  for (let i = 0; i < n; i++) {
    const curr = points[i];

    // Para trazados abiertos, los extremos no son esquinas intermedias
    if (!closed && (i === 0 || i === n - 1)) {
      result.push(curr);
      continue;
    }

    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const prev = points[prevIdx];
    const next = points[nextIdx];

    // Si el punto o sus segmentos incidentes ya tienen curvatura Bézier explícita,
    // se preserva tal cual (esquinas Bézier no se fuerzan a arco circular)
    const hasCurve = Boolean(
      curr.handleIn ||
      curr.handleOut ||
      prev.handleOut ||
      next.handleIn
    );

    const radius = curr.cornerRadius !== undefined ? curr.cornerRadius : defaultRadius;

    if (hasCurve || radius <= 0) {
      result.push(curr);
      continue;
    }

    const arc = computeCornerArc(prev, curr, next, radius);
    if (!arc || arc.effectiveRadius <= 0) {
      result.push(curr);
      continue;
    }

    // Insertamos el punto de entrada tangencial T1 con control handleOut hacia el vértice
    const pt1: PathPoint = {
      x: arc.tangentPoint1.x,
      y: arc.tangentPoint1.y,
      handleOut: arc.controlPoint1,
      pointType: 'smooth',
      ...(curr.moveTo ? { moveTo: true } : {}),
    };

    // Insertamos el punto de salida tangencial T2 con control handleIn desde el arco
    const pt2: PathPoint = {
      x: arc.tangentPoint2.x,
      y: arc.tangentPoint2.y,
      handleIn: arc.controlPoint2,
      pointType: 'smooth',
      ...(curr.closeSubpath ? { closeSubpath: true } : {}),
    };

    result.push(pt1, pt2);
  }

  return result;
}

/**
 * Genera los puntos de trazado suavizados con curvas Bézier para un Polígono regular.
 */
export function getPolygonPathPoints(polygon: Polygon): PathPoint[] {
  const vertices = getPolygonVertices(polygon);
  const radius = polygon.cornerRadius ?? 0;
  const pathPoints: PathPoint[] = vertices.map((v, i) => ({
    x: v.x,
    y: v.y,
    pointType: 'corner',
    ...(i === 0 ? { moveTo: true } : {}),
  }));

  if (radius <= 0) {
    return pathPoints;
  }

  return smoothPathPoints(pathPoints, true, radius);
}

/**
 * Genera los puntos de trazado suavizados con curvas Bézier para una Estrella regular.
 */
export function getStarPathPoints(star: Star): PathPoint[] {
  const vertices = getStarVertices(star);
  const outerRadius = star.cornerRadius ?? 0;
  const innerRadius = star.innerCornerRadius !== undefined ? star.innerCornerRadius : 0;

  const pathPoints: PathPoint[] = vertices.map((v, i) => {
    const isOuter = i % 2 === 0;
    const r = isOuter ? outerRadius : innerRadius;
    return {
      x: v.x,
      y: v.y,
      pointType: 'corner',
      cornerRadius: r,
      ...(i === 0 ? { moveTo: true } : {}),
    };
  });

  if (outerRadius <= 0 && innerRadius <= 0) {
    return pathPoints;
  }

  return smoothPathPoints(pathPoints, true, 0);
}

/**
 * Obtiene los tiradores interactivos de radio de esquina para una figura.
 */
export function getShapeCornerRadiusHandles(
  shape: Shape,
  zoom: number = 1
): CornerRadiusHandle[] {
  const handles: CornerRadiusHandle[] = [];

  if (shape.type === 'rectangle') {
    const { x, y, width, height, rotation, cornerRadius } = shape;
    const currentRadius = cornerRadius ?? 0;
    const maxRadius = Math.min(width, height) / 2;
    const rad = ((rotation ?? 0) * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const cx = x + width / 2;
    const cy = y + height / 2;

    const corners = [
      { vx: x, vy: y, bx: 1, by: 1 },                   // Top-Left
      { vx: x + width, vy: y, bx: -1, by: 1 },           // Top-Right
      { vx: x + width, vy: y + height, bx: -1, by: -1 }, // Bottom-Right
      { vx: x, vy: y + height, bx: 1, by: -1 },          // Bottom-Left
    ];

    const baseOffset = Math.min(maxRadius * 0.7, Math.max(14 / zoom, currentRadius + 4 / zoom));

    corners.forEach((c, i) => {
      const localHx = c.vx + c.bx * Math.SQRT1_2 * baseOffset;
      const localHy = c.vy + c.by * Math.SQRT1_2 * baseOffset;

      // Rotar al espacio global si rotation != 0
      const rx = rotation ? cx + (localHx - cx) * cosR - (localHy - cy) * sinR : localHx;
      const ry = rotation ? cy + (localHx - cx) * sinR + (localHy - cy) * cosR : localHy;

      const rVx = rotation ? cx + (c.vx - cx) * cosR - (c.vy - cy) * sinR : c.vx;
      const rVy = rotation ? cy + (c.vx - cx) * sinR + (c.vy - cy) * cosR : c.vy;

      const normBx = c.bx * Math.SQRT1_2;
      const normBy = c.by * Math.SQRT1_2;
      const rBx = rotation ? normBx * cosR - normBy * sinR : normBx;
      const rBy = rotation ? normBx * sinR + normBy * cosR : normBy;

      handles.push({
        id: `${shape.id}-cr-${i}`,
        shapeId: shape.id,
        vertexIndex: i,
        x: rx,
        y: ry,
        vertexX: rVx,
        vertexY: rVy,
        bisectorX: rBx,
        bisectorY: rBy,
        currentRadius,
        maxRadius,
      });
    });

    return handles;
  }

  if (shape.type === 'polygon') {
    const vertices = getPolygonVertices(shape);
    const currentRadius = shape.cornerRadius ?? 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const arc = computeCornerArc(prev, curr, next, currentRadius, zoom);
      if (!arc) continue;

      handles.push({
        id: `${shape.id}-cr-${i}`,
        shapeId: shape.id,
        vertexIndex: i,
        x: arc.handlePosition.x,
        y: arc.handlePosition.y,
        vertexX: curr.x,
        vertexY: curr.y,
        bisectorX: arc.bisector.x,
        bisectorY: arc.bisector.y,
        currentRadius,
        maxRadius: arc.maxRadius,
      });
    }

    return handles;
  }

  if (shape.type === 'star') {
    const vertices = getStarVertices(shape);
    const currentRadius = shape.cornerRadius ?? 0;
    const currentInnerRadius = shape.innerCornerRadius ?? 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const isOuter = i % 2 === 0;
      const r = isOuter ? currentRadius : currentInnerRadius;
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const arc = computeCornerArc(prev, curr, next, r, zoom);
      if (!arc) continue;

      handles.push({
        id: `${shape.id}-cr-${i}`,
        shapeId: shape.id,
        vertexIndex: i,
        x: arc.handlePosition.x,
        y: arc.handlePosition.y,
        vertexX: curr.x,
        vertexY: curr.y,
        bisectorX: arc.bisector.x,
        bisectorY: arc.bisector.y,
        currentRadius: r,
        maxRadius: arc.maxRadius,
        isInner: !isOuter,
      });
    }

    return handles;
  }

  if (shape.type === 'path') {
    const points = shape.points;
    if (!points || points.length < 3) return [];
    const closed = Boolean(shape.closed);
    const defaultRadius = shape.cornerRadius ?? 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;

      const curr = points[i];
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];

      // Ignora vértices con curvas Bézier existentes
      if (curr.handleIn || curr.handleOut || prev.handleOut || next.handleIn) {
        continue;
      }

      const r = curr.cornerRadius !== undefined ? curr.cornerRadius : defaultRadius;
      const arc = computeCornerArc(prev, curr, next, r, zoom);
      if (!arc) continue;

      handles.push({
        id: `${shape.id}-cr-${i}`,
        shapeId: shape.id,
        vertexIndex: i,
        x: arc.handlePosition.x,
        y: arc.handlePosition.y,
        vertexX: curr.x,
        vertexY: curr.y,
        bisectorX: arc.bisector.x,
        bisectorY: arc.bisector.y,
        currentRadius: r,
        maxRadius: arc.maxRadius,
      });
    }

    return handles;
  }

  return handles;
}

/**
 * Detecta si una coordenada en el mundo colisiona con algún tirador de radio de esquina.
 */
export function hitTestCornerRadiusHandle(
  handles: readonly CornerRadiusHandle[],
  worldX: number,
  worldY: number,
  tolerance: number = 8
): CornerRadiusHandle | null {
  const tolSq = tolerance * tolerance;
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    const dx = worldX - h.x;
    const dy = worldY - h.y;
    if (dx * dx + dy * dy <= tolSq) {
      return h;
    }
  }
  return null;
}

/**
 * Calcula el nuevo radio de curvatura resultante al arrastrar un tirador de esquina.
 * Proyecta la posición del cursor a lo largo de la bisectriz del vértice.
 */
export function calculateRadiusFromHandleDrag(
  handle: CornerRadiusHandle,
  worldX: number,
  worldY: number
): number {
  const dx = worldX - handle.vertexX;
  const dy = worldY - handle.vertexY;

  // Distancia proyectada sobre la bisectriz interior
  const projDist = dx * handle.bisectorX + dy * handle.bisectorY;

  if (projDist <= 0) {
    return 0;
  }

  // Factor de escala: cuando projDist alcanza la distancia máxima, el radio alcanza maxRadius
  // Para un arrastre intuitivo y directo 1:1:
  const newRadius = Math.max(0, Math.min(handle.maxRadius, projDist));
  return Math.round(newRadius * 100) / 100;
}
