import type {
  Ellipse,
  Path,
  PathPoint,
  Rectangle,
  Shape,
  Vector2D,
} from '../types/scene-graph.ts';
import { evaluateCubicBezier, getPathBaseAABB } from './geometry.ts';
import { generateClonedShapeId } from './cloneShape.ts';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

/**
 * Calcula el área con signo de un polígono 2D simple.
 * Positivo = Anti-horario (CCW), Negativo = Horario (CW).
 */
export function polygonArea(poly: readonly Vector2D[]): number {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return area / 2;
}

/**
 * Comprueba si un punto está dentro de un anillo poligonal usando ray casting (even-odd rule).
 */
export function isPointInPolygon(p: Vector2D, ring: readonly Vector2D[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;

    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Comprueba si un punto está dentro de un multi-polígono (conjunto de anillos poligonales).
 */
export function isPointInMultiPolygon(p: Vector2D, rings: readonly (readonly Vector2D[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    if (isPointInPolygon(p, ring)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Garantiza que un anillo poligonal esté orientado en sentido anti-horario (CCW, área positiva).
 */
export function ensureCCW(poly: readonly Vector2D[]): Vector2D[] {
  if (polygonArea(poly) < 0) {
    return [...poly].reverse();
  }
  return [...poly];
}

/**
 * Rota un punto 2D alrededor de un centro dado en radianes.
 */
function rotatePoint(p: Vector2D, center: Vector2D, rad: number): Vector2D {
  if (rad === 0) return p;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Determina si una figura es cerrada y por tanto candidata a operaciones booleanas.
 */
export function isClosedShape(shape: Shape): boolean {
  if (shape.type === 'rectangle' || shape.type === 'ellipse') {
    return true;
  }
  if (shape.type === 'path') {
    return Boolean(shape.closed && shape.points && shape.points.length >= 3);
  }
  return false;
}

/**
 * Convierte cualquier figura cerrada (Rectangle, Ellipse o Path cerrado) a un polígono
 * aproximado en coordenadas absolutas de mundo con orientación CCW.
 */
export function shapeToPolygon(shape: Shape): Vector2D[] {
  if (shape.type === 'rectangle') {
    return rectangleToPolygon(shape);
  }
  if (shape.type === 'ellipse') {
    return ellipseToPolygon(shape);
  }
  if (shape.type === 'path' && shape.closed) {
    return pathToPolygon(shape);
  }
  return [];
}

function rectangleToPolygon(rect: Rectangle): Vector2D[] {
  const { x, y, width, height, cornerRadius, rotation } = rect;
  if (width <= 0 || height <= 0) return [];

  const cx = x + width / 2;
  const cy = y + height / 2;
  const rad = rotation ? (rotation * Math.PI) / 180 : 0;
  const center = { x: cx, y: cy };

  const r = cornerRadius && cornerRadius > 0 ? Math.min(cornerRadius, width / 2, height / 2) : 0;

  const points: Vector2D[] = [];

  if (r === 0) {
    points.push(
      rotatePoint({ x, y }, center, rad),
      rotatePoint({ x: x + width, y }, center, rad),
      rotatePoint({ x: x + width, y: y + height }, center, rad),
      rotatePoint({ x, y: y + height }, center, rad)
    );
  } else {
    // 4 esquinas redondeadas
    const steps = 6;
    // Top-Right: centro (x + width - r, y + r), ángulos de -PI/2 a 0
    const trX = x + width - r;
    const trY = y + r;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
      points.push(rotatePoint({ x: trX + r * Math.cos(a), y: trY + r * Math.sin(a) }, center, rad));
    }
    // Bottom-Right: centro (x + width - r, y + height - r), ángulos de 0 a PI/2
    const brX = x + width - r;
    const brY = y + height - r;
    for (let i = 1; i <= steps; i++) {
      const a = (Math.PI / 2) * (i / steps);
      points.push(rotatePoint({ x: brX + r * Math.cos(a), y: brY + r * Math.sin(a) }, center, rad));
    }
    // Bottom-Left: centro (x + r, y + height - r), ángulos de PI/2 a PI
    const blX = x + r;
    const blY = y + height - r;
    for (let i = 1; i <= steps; i++) {
      const a = Math.PI / 2 + (Math.PI / 2) * (i / steps);
      points.push(rotatePoint({ x: blX + r * Math.cos(a), y: blY + r * Math.sin(a) }, center, rad));
    }
    // Top-Left: centro (x + r, y + r), ángulos de PI a 3*PI/2
    const tlX = x + r;
    const tlY = y + r;
    for (let i = 1; i < steps; i++) {
      const a = Math.PI + (Math.PI / 2) * (i / steps);
      points.push(rotatePoint({ x: tlX + r * Math.cos(a), y: tlY + r * Math.sin(a) }, center, rad));
    }
  }

  return ensureCCW(points);
}

function ellipseToPolygon(ellipse: Ellipse): Vector2D[] {
  const { x, y, radiusX, radiusY, rotation } = ellipse;
  if (radiusX <= 0 || radiusY <= 0) return [];

  const rad = rotation ? (rotation * Math.PI) / 180 : 0;
  const center = { x, y };
  const steps = 48;
  const points: Vector2D[] = [];

  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const rawPoint = {
      x: x + radiusX * Math.cos(theta),
      y: y + radiusY * Math.sin(theta),
    };
    points.push(rotatePoint(rawPoint, center, rad));
  }

  return ensureCCW(points);
}

function pathToPolygon(path: Path): Vector2D[] {
  const pts = path.points;
  if (!pts || pts.length < 3) return [];

  const baseAABB = getPathBaseAABB(path);
  const cx = (baseAABB.minX + baseAABB.maxX) / 2;
  const cy = (baseAABB.minY + baseAABB.maxY) / 2;
  const rad = path.rotation ? (path.rotation * Math.PI) / 180 : 0;
  const center = { x: cx, y: cy };

  const rawPoly: Vector2D[] = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const pStart = pts[i];
    const pEnd = pts[(i + 1) % n];

    const isCurved = Boolean(pStart.handleOut || pEnd.handleIn);

    if (!isCurved) {
      rawPoly.push({ x: pStart.x, y: pStart.y });
    } else {
      const p0 = { x: pStart.x, y: pStart.y };
      const p1 = pStart.handleOut ?? p0;
      const p3 = { x: pEnd.x, y: pEnd.y };
      const p2 = pEnd.handleIn ?? p3;

      const steps = 16;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        rawPoly.push(evaluateCubicBezier(p0, p1, p2, p3, t));
      }
    }
  }

  const rotatedPoly = rad === 0 ? rawPoly : rawPoly.map((p) => rotatePoint(p, center, rad));
  return ensureCCW(rotatedPoly);
}

/**
 * Calcula la intersección entre dos segmentos de recta 2D.
 */
function computeSegmentIntersection(
  p1: Vector2D,
  p2: Vector2D,
  q1: Vector2D,
  q2: Vector2D
): { t: number; u: number; point: Vector2D } | null {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;

  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-9) {
    return null;
  }

  const qpx = q1.x - p1.x;
  const qpy = q1.y - p1.y;

  const t = (qpx * sy - qpy * sx) / cross;
  const u = (qpx * ry - qpy * rx) / cross;

  const eps = 1e-7;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    const clampedT = Math.max(0, Math.min(1, t));
    const clampedU = Math.max(0, Math.min(1, u));
    return {
      t: clampedT,
      u: clampedU,
      point: {
        x: p1.x + clampedT * rx,
        y: p1.y + clampedT * ry,
      },
    };
  }
  return null;
}

/**
 * Simplifica un polígono eliminando puntos colineales redundantes.
 */
export function simplifyPolygon(pts: readonly Vector2D[]): Vector2D[] {
  if (pts.length <= 3) return [...pts];
  const result: Vector2D[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-5 || len2 < 1e-5) continue;

    const cross = Math.abs(v1x * v2y - v1y * v2x);
    const dot = v1x * v2x + v1y * v2y;
    // Si los segmentos son colineales en la misma dirección
    if (cross / (len1 * len2) < 1e-4 && dot > 0) {
      continue;
    }
    result.push(curr);
  }
  return result;
}

/**
 * Une un orificio (anillo interior CW) a su anillo exterior (CCW) mediante un puente/costura de ancho cero,
 * permitiendo representarlo como un único trazado cerrado continuo.
 */
export function bridgeHoleToOuter(outer: readonly Vector2D[], hole: readonly Vector2D[]): Vector2D[] {
  let bestHIdx = 0;
  for (let i = 1; i < hole.length; i++) {
    if (hole[i].x > hole[bestHIdx].x) {
      bestHIdx = i;
    }
  }
  const hp = hole[bestHIdx];

  let bestOIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const d = Math.hypot(outer[i].x - hp.x, outer[i].y - hp.y);
    if (d < bestDist) {
      bestDist = d;
      bestOIdx = i;
    }
  }

  const result: Vector2D[] = [];
  for (let i = 0; i <= bestOIdx; i++) {
    result.push(outer[i]);
  }
  for (let i = 0; i <= hole.length; i++) {
    result.push(hole[(bestHIdx + i) % hole.length]);
  }
  for (let i = bestOIdx; i < outer.length; i++) {
    result.push(outer[i]);
  }
  return result;
}

/**
 * Combina dos conjuntos de anillos poligonales utilizando operaciones booleanas 2D (CSG).
 */
export function combineRings(
  op: BooleanOp,
  ringsAIn: readonly (readonly Vector2D[])[],
  ringsBIn: readonly (readonly Vector2D[])[]
): Vector2D[][] {
  if (ringsAIn.length === 0) {
    if (op === 'union' || op === 'exclude') return ringsBIn.map((r) => [...r]);
    return [];
  }
  if (ringsBIn.length === 0) {
    if (op === 'union' || op === 'subtract' || op === 'exclude') return ringsAIn.map((r) => [...r]);
    return [];
  }

  // Exclusión es la unión de las dos sustracciones disjuntas (A \ B) ∪ (B \ A)
  if (op === 'exclude') {
    const diffAB = combineRings('subtract', ringsAIn, ringsBIn);
    const diffBA = combineRings('subtract', ringsBIn, ringsAIn);
    return [...diffAB, ...diffBA];
  }

  const ringsA = ringsAIn.map(ensureCCW);
  const ringsB = ringsBIn.map(ensureCCW);

  interface EdgeRef {
    ringIdx: number;
    edgeIdx: number;
    p1: Vector2D;
    p2: Vector2D;
  }

  const edgesA: EdgeRef[] = [];
  for (let r = 0; r < ringsA.length; r++) {
    const ring = ringsA[r];
    for (let i = 0; i < ring.length; i++) {
      edgesA.push({
        ringIdx: r,
        edgeIdx: i,
        p1: ring[i],
        p2: ring[(i + 1) % ring.length],
      });
    }
  }

  const edgesB: EdgeRef[] = [];
  for (let r = 0; r < ringsB.length; r++) {
    const ring = ringsB[r];
    for (let j = 0; j < ring.length; j++) {
      edgesB.push({
        ringIdx: r,
        edgeIdx: j,
        p1: ring[j],
        p2: ring[(j + 1) % ring.length],
      });
    }
  }

  const splitsA: Map<string, number[]> = new Map();
  const splitsB: Map<string, number[]> = new Map();

  const keyA = (r: number, i: number) => `${r}:${i}`;

  for (let i = 0; i < edgesA.length; i++) {
    splitsA.set(keyA(edgesA[i].ringIdx, edgesA[i].edgeIdx), [0, 1]);
  }
  for (let j = 0; j < edgesB.length; j++) {
    splitsB.set(keyA(edgesB[j].ringIdx, edgesB[j].edgeIdx), [0, 1]);
  }

  for (let i = 0; i < edgesA.length; i++) {
    const eA = edgesA[i];
    const kA = keyA(eA.ringIdx, eA.edgeIdx);

    for (let j = 0; j < edgesB.length; j++) {
      const eB = edgesB[j];
      const kB = keyA(eB.ringIdx, eB.edgeIdx);

      const inter = computeSegmentIntersection(eA.p1, eA.p2, eB.p1, eB.p2);
      if (inter) {
        if (inter.t > 1e-6 && inter.t < 1 - 1e-6) {
          splitsA.get(kA)!.push(inter.t);
        }
        if (inter.u > 1e-6 && inter.u < 1 - 1e-6) {
          splitsB.get(kB)!.push(inter.u);
        }
      } else {
        const rx = eA.p2.x - eA.p1.x;
        const ry = eA.p2.y - eA.p1.y;
        const lenSq = rx * rx + ry * ry;
        if (lenSq > 1e-9) {
          const cross = (eB.p1.x - eA.p1.x) * ry - (eB.p1.y - eA.p1.y) * rx;
          if (Math.abs(cross) < 1e-7) {
            const t1 = ((eB.p1.x - eA.p1.x) * rx + (eB.p1.y - eA.p1.y) * ry) / lenSq;
            const t2 = ((eB.p2.x - eA.p1.x) * rx + (eB.p2.y - eA.p1.y) * ry) / lenSq;
            if (t1 > 1e-6 && t1 < 1 - 1e-6) splitsA.get(kA)!.push(t1);
            if (t2 > 1e-6 && t2 < 1 - 1e-6) splitsA.get(kA)!.push(t2);

            const sx = eB.p2.x - eB.p1.x;
            const sy = eB.p2.y - eB.p1.y;
            const lenBSq = sx * sx + sy * sy;
            if (lenBSq > 1e-9) {
              const u1 = ((eA.p1.x - eB.p1.x) * sx + (eA.p1.y - eB.p1.y) * sy) / lenBSq;
              const u2 = ((eA.p2.x - eB.p1.x) * sx + (eA.p2.y - eB.p1.y) * sy) / lenBSq;
              if (u1 > 1e-6 && u1 < 1 - 1e-6) splitsB.get(kB)!.push(u1);
              if (u2 > 1e-6 && u2 < 1 - 1e-6) splitsB.get(kB)!.push(u2);
            }
          }
        }
      }
    }
  }

  interface DirectedSeg {
    start: Vector2D;
    end: Vector2D;
    mid: Vector2D;
  }

  const atomicA: DirectedSeg[] = [];
  for (let i = 0; i < edgesA.length; i++) {
    const e = edgesA[i];
    const kA = keyA(e.ringIdx, e.edgeIdx);
    const ts = Array.from(new Set(splitsA.get(kA)!)).sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const tStart = ts[k];
      const tEnd = ts[k + 1];
      if (tEnd - tStart < 1e-6) continue;
      const s = {
        x: e.p1.x + tStart * (e.p2.x - e.p1.x),
        y: e.p1.y + tStart * (e.p2.y - e.p1.y),
      };
      const endPt = {
        x: e.p1.x + tEnd * (e.p2.x - e.p1.x),
        y: e.p1.y + tEnd * (e.p2.y - e.p1.y),
      };
      atomicA.push({
        start: s,
        end: endPt,
        mid: { x: (s.x + endPt.x) / 2, y: (s.y + endPt.y) / 2 },
      });
    }
  }

  const atomicB: DirectedSeg[] = [];
  for (let j = 0; j < edgesB.length; j++) {
    const e = edgesB[j];
    const kB = keyA(e.ringIdx, e.edgeIdx);
    const us = Array.from(new Set(splitsB.get(kB)!)).sort((x, y) => x - y);
    for (let k = 0; k < us.length - 1; k++) {
      const uStart = us[k];
      const uEnd = us[k + 1];
      if (uEnd - uStart < 1e-6) continue;
      const s = {
        x: e.p1.x + uStart * (e.p2.x - e.p1.x),
        y: e.p1.y + uStart * (e.p2.y - e.p1.y),
      };
      const endPt = {
        x: e.p1.x + uEnd * (e.p2.x - e.p1.x),
        y: e.p1.y + uEnd * (e.p2.y - e.p1.y),
      };
      atomicB.push({
        start: s,
        end: endPt,
        mid: { x: (s.x + endPt.x) / 2, y: (s.y + endPt.y) / 2 },
      });
    }
  }

  const keptSegments: { start: Vector2D; end: Vector2D }[] = [];
  const handledB = new Set<number>();

  for (let i = 0; i < atomicA.length; i++) {
    const segA = atomicA[i];
    let matchingBIdx = -1;
    let sameDir = true;

    for (let j = 0; j < atomicB.length; j++) {
      const segB = atomicB[j];
      const dMid = Math.hypot(segA.mid.x - segB.mid.x, segA.mid.y - segB.mid.y);
      if (dMid < 1e-4) {
        const vAx = segA.end.x - segA.start.x;
        const vAy = segA.end.y - segA.start.y;
        const vBx = segB.end.x - segB.start.x;
        const vBy = segB.end.y - segB.start.y;
        const dot = vAx * vBx + vAy * vBy;
        matchingBIdx = j;
        sameDir = dot > 0;
        break;
      }
    }

    if (matchingBIdx !== -1) {
      handledB.add(matchingBIdx);
      if (sameDir) {
        if (op === 'union' || op === 'intersect') {
          keptSegments.push({ start: segA.start, end: segA.end });
        }
      } else {
        if (op === 'subtract') {
          keptSegments.push({ start: segA.start, end: segA.end });
        }
      }
    } else {
      const inB = isPointInMultiPolygon(segA.mid, ringsB);
      if (op === 'union' && !inB) {
        keptSegments.push({ start: segA.start, end: segA.end });
      } else if (op === 'intersect' && inB) {
        keptSegments.push({ start: segA.start, end: segA.end });
      } else if (op === 'subtract' && !inB) {
        keptSegments.push({ start: segA.start, end: segA.end });
      }
    }
  }

  for (let j = 0; j < atomicB.length; j++) {
    if (handledB.has(j)) continue;
    const segB = atomicB[j];
    const inA = isPointInMultiPolygon(segB.mid, ringsA);
    if (op === 'union' && !inA) {
      keptSegments.push({ start: segB.start, end: segB.end });
    } else if (op === 'intersect' && inA) {
      keptSegments.push({ start: segB.start, end: segB.end });
    } else if (op === 'subtract' && inA) {
      keptSegments.push({ start: segB.end, end: segB.start });
    }
  }

  return chainSegments(keptSegments);
}

function chainSegments(segments: { start: Vector2D; end: Vector2D }[]): Vector2D[][] {
  if (segments.length === 0) return [];

  const canonical: Vector2D[] = [];
  function getCanonicalIndex(p: Vector2D): number {
    for (let i = 0; i < canonical.length; i++) {
      if (Math.hypot(canonical[i].x - p.x, canonical[i].y - p.y) < 1e-4) {
        return i;
      }
    }
    canonical.push({ x: p.x, y: p.y });
    return canonical.length - 1;
  }

  interface Edge {
    id: number;
    from: number;
    to: number;
  }

  const edges: Edge[] = [];
  const outgoing: Map<number, number[]> = new Map();

  for (let i = 0; i < segments.length; i++) {
    const from = getCanonicalIndex(segments[i].start);
    const to = getCanonicalIndex(segments[i].end);
    if (from === to) continue;
    const edge: Edge = { id: i, from, to };
    edges.push(edge);
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from)!.push(edges.length - 1);
  }

  const used = new Array(edges.length).fill(false);
  const rings: Vector2D[][] = [];

  for (let startEdgeIdx = 0; startEdgeIdx < edges.length; startEdgeIdx++) {
    if (used[startEdgeIdx]) continue;

    const startEdge = edges[startEdgeIdx];
    used[startEdgeIdx] = true;

    const pathVertices = [startEdge.from];
    let currNode = startEdge.to;
    let prevNode = startEdge.from;

    while (currNode !== startEdge.from) {
      pathVertices.push(currNode);
      const outEdgeIndices = outgoing.get(currNode)?.filter((idx) => !used[idx]) ?? [];
      if (outEdgeIndices.length === 0) {
        break;
      }

      let chosenEdgeIdx = outEdgeIndices[0];
      if (outEdgeIndices.length > 1) {
        const inVx = canonical[currNode].x - canonical[prevNode].x;
        const inVy = canonical[currNode].y - canonical[prevNode].y;
        let bestAngle = Infinity;
        for (const idx of outEdgeIndices) {
          const cand = edges[idx];
          const outVx = canonical[cand.to].x - canonical[currNode].x;
          const outVy = canonical[cand.to].y - canonical[currNode].y;
          const cross = inVx * outVy - inVy * outVx;
          const dot = inVx * outVx + inVy * outVy;
          let angle = Math.atan2(cross, dot);
          if (angle < 0) angle += 2 * Math.PI;
          if (angle < bestAngle) {
            bestAngle = angle;
            chosenEdgeIdx = idx;
          }
        }
      }

      used[chosenEdgeIdx] = true;
      const nextEdge = edges[chosenEdgeIdx];
      prevNode = currNode;
      currNode = nextEdge.to;
    }

    if (currNode === startEdge.from && pathVertices.length >= 3) {
      const ring = simplifyPolygon(pathVertices.map((idx) => canonical[idx]));
      if (ring.length >= 3 && Math.abs(polygonArea(ring)) > 1e-3) {
        rings.push(ring);
      }
    }
  }

  return rings;
}

/**
 * Organiza los anillos resultantes: empareja los orificios (área negativa) con sus contornos exteriores (área positiva)
 * mediante costura/puente de ancho cero para crear contornos simples conexos.
 */
export function processHolesAndIslands(rings: Vector2D[][]): Vector2D[][] {
  if (rings.length === 0) return [];

  const outers: Vector2D[][] = [];
  const holes: Vector2D[][] = [];

  for (const ring of rings) {
    const area = polygonArea(ring);
    if (area > 1e-3) {
      outers.push(ring);
    } else if (area < -1e-3) {
      holes.push(ring);
    }
  }

  if (outers.length === 0) {
    return [];
  }

  // Asignar cada orificio al anillo exterior que lo contiene
  const outerHolesMap = new Map<number, Vector2D[][]>();
  for (let i = 0; i < outers.length; i++) {
    outerHolesMap.set(i, []);
  }

  for (const hole of holes) {
    let bestOuterIdx = -1;
    for (let i = 0; i < outers.length; i++) {
      if (isPointInPolygon(hole[0], outers[i])) {
        bestOuterIdx = i;
        break;
      }
    }
    if (bestOuterIdx !== -1) {
      outerHolesMap.get(bestOuterIdx)!.push(hole);
    }
  }

  const finalIslands: Vector2D[][] = [];
  for (let i = 0; i < outers.length; i++) {
    let currentOuter = outers[i];
    const assignedHoles = outerHolesMap.get(i) ?? [];
    for (const h of assignedHoles) {
      currentOuter = bridgeHoleToOuter(currentOuter, h);
    }
    finalIslands.push(currentOuter);
  }

  return finalIslands;
}

/**
 * Aplica una operación booleana (Unión, Sustracción, Intersección o Exclusión) sobre una lista de 2 o más figuras cerradas.
 * Retorna las nuevas figuras de tipo Path generadas.
 */
export function executeBooleanOperation(
  op: BooleanOp,
  orderedShapes: readonly Shape[]
): Path[] {
  const closedShapes = orderedShapes.filter(isClosedShape);
  if (closedShapes.length < 2) {
    return [];
  }

  const baseShape = closedShapes[0];

  let currentRings: Vector2D[][] = [shapeToPolygon(baseShape)];

  for (let i = 1; i < closedShapes.length; i++) {
    const nextPoly = shapeToPolygon(closedShapes[i]);
    currentRings = combineRings(op, currentRings, [nextPoly]);
  }

  const finalIslands = processHolesAndIslands(currentRings);
  if (finalIslands.length === 0) {
    return [];
  }

  const opNames: Record<BooleanOp, string> = {
    union: 'Unión',
    subtract: 'Sustracción',
    intersect: 'Intersección',
    exclude: 'Exclusión',
  };

  const createdPaths: Path[] = finalIslands.map((island, index) => {
    const points: PathPoint[] = island.map((p) => ({
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
    }));

    const pathId = generateClonedShapeId('path');
    const name =
      finalIslands.length > 1
        ? `${opNames[op]} (${index + 1})`
        : `${opNames[op]}`;

    return {
      id: pathId,
      type: 'path',
      name,
      x: 0,
      y: 0,
      closed: true,
      points,
      fill: baseShape.fill,
      stroke: baseShape.stroke,
      strokeWidth: baseShape.strokeWidth,
      opacity: baseShape.opacity,
      ...(baseShape.strokeDashArray ? { strokeDashArray: [...baseShape.strokeDashArray] } : {}),
    };
  });

  return createdPaths;
}
