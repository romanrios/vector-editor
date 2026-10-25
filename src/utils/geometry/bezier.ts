import type { PathPoint, Vector2D } from '../../types/scene-graph.ts';

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
