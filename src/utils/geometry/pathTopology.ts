import type { Path, PathPoint, PathPointType, Vector2D } from '../../types/scene-graph.ts';
import {
  splitCubicBezier,
  findNearestPointOnSegment,
  findNearestPointOnCubicBezier,
  isSmoothPoint,
} from './bezier.ts';
import { getPathBaseAABB } from './aabb.ts';

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
