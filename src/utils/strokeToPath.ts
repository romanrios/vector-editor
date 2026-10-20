import type {
  Ellipse,
  Path,
  PathPoint,
  Polygon,
  Rectangle,
  SceneNode,
  Shape,
  Star,
  StrokeLineCap,
  StrokeLineJoin,
  Vector2D,
} from '../types/scene-graph.ts';
import { isShape } from '../types/scene-graph.ts';
import { isNonePaint } from './color.ts';
import {
  evaluateCubicBezier,
  getPathBaseAABB,
  getPolygonVertices,
  getStarVertices,
} from './geometry.ts';
import {
  combineRings,
  ensureCCW,
  isPointInPolygon,
  polygonArea,
  processHolesAndIslands,
  simplifyPolygon,
} from './booleanOperations.ts';
import { generateClonedShapeId } from './cloneShape.ts';

/**
 * Determina si un nodo (figura) posee un contorno válido y con grosor susceptible de ser contorneado.
 */
export function canOutlineStroke(node: SceneNode): boolean {
  if (!isShape(node)) return false;
  if (node.type === 'text' || node.type === 'image') return false;
  if (!node.stroke || isNonePaint(node.stroke)) return false;
  const strokeWidth = node.strokeWidth ?? 1;
  return strokeWidth > 0;
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
 * Muestrea una curva Bézier cúbica entre p0 y p3 con puntos de control p1 y p2.
 */
function sampleCubicBezier(
  p0: Vector2D,
  p1: Vector2D,
  p2: Vector2D,
  p3: Vector2D,
  steps: number = 16
): Vector2D[] {
  const pts: Vector2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(evaluateCubicBezier(p0, p1, p2, p3, t));
  }
  return pts;
}

/**
 * Convierte un trazado Path en una lista de subtrazados (polilíneas en coordenadas de mundo).
 */
export function pathSubpathsToPolylines(path: Path): { points: Vector2D[]; closed: boolean }[] {
  const pts = path.points;
  if (!pts || pts.length === 0) return [];

  const baseAABB = getPathBaseAABB(path);
  const cx = (baseAABB.minX + baseAABB.maxX) / 2;
  const cy = (baseAABB.minY + baseAABB.maxY) / 2;
  const rad = path.rotation ? (path.rotation * Math.PI) / 180 : 0;
  const center = { x: cx, y: cy };

  const subpaths: { points: Vector2D[]; closed: boolean }[] = [];
  let currentPolyline: Vector2D[] = [];
  let subpathStartIdx = 0;

  for (let i = 0; i < pts.length; i++) {
    const curr = pts[i];
    if (i === 0 || curr.moveTo) {
      if (i > 0 && currentPolyline.length > 0) {
        const last = pts[i - 1];
        const isClosed = Boolean(last.closeSubpath ?? path.closed);
        subpaths.push({ points: currentPolyline, closed: isClosed });
        currentPolyline = [];
      }
      subpathStartIdx = i;
      currentPolyline.push({ x: curr.x, y: curr.y });
    } else {
      const prev = pts[i - 1];
      const isCurved = Boolean(prev.handleOut || curr.handleIn);
      if (!isCurved) {
        currentPolyline.push({ x: curr.x, y: curr.y });
      } else {
        const p0 = { x: prev.x, y: prev.y };
        const p1 = prev.handleOut ?? p0;
        const p3 = { x: curr.x, y: curr.y };
        const p2 = curr.handleIn ?? p3;
        const sampled = sampleCubicBezier(p0, p1, p2, p3, 16);
        // Omitir el primer punto para evitar duplicado con el último del segmento anterior
        for (let s = 1; s < sampled.length; s++) {
          currentPolyline.push(sampled[s]);
        }
      }
    }
  }

  if (currentPolyline.length > 0) {
    const last = pts[pts.length - 1];
    const isClosed = Boolean(last.closeSubpath ?? path.closed);
    if (isClosed && pts.length - subpathStartIdx > 1) {
      const startPt = pts[subpathStartIdx];
      const isCurved = Boolean(last.handleOut || startPt.handleIn);
      if (!isCurved) {
        currentPolyline.push({ x: startPt.x, y: startPt.y });
      } else {
        const p0 = { x: last.x, y: last.y };
        const p1 = last.handleOut ?? p0;
        const p3 = { x: startPt.x, y: startPt.y };
        const p2 = startPt.handleIn ?? p3;
        const sampled = sampleCubicBezier(p0, p1, p2, p3, 16);
        for (let s = 1; s < sampled.length; s++) {
          currentPolyline.push(sampled[s]);
        }
      }
    }
    subpaths.push({ points: currentPolyline, closed: isClosed });
  }

  // Aplicar rotación si existe
  if (rad !== 0) {
    for (const sub of subpaths) {
      sub.points = sub.points.map((p) => rotatePoint(p, center, rad));
    }
  }

  return subpaths;
}

/**
 * Limpia una polilínea eliminando puntos consecutivos idénticos o excesivamente cercanos.
 */
function cleanPolyline(pts: readonly Vector2D[]): Vector2D[] {
  if (pts.length < 2) return [...pts];
  const result: Vector2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 1e-4) {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Divide una polilínea en intervalos de trazo discontinuo según strokeDashArray.
 */
function dashPolyline(
  polyline: readonly Vector2D[],
  dashArray: readonly number[]
): Vector2D[][] {
  if (dashArray.length === 0 || polyline.length < 2) return [[...polyline]];

  // Si la longitud es impar, duplicar para formar pares (guion, espacio)
  const pattern = dashArray.length % 2 === 1 ? [...dashArray, ...dashArray] : [...dashArray];
  let patternIdx = 0;
  let remainingInDash = pattern[0];
  let isDrawing = true;

  const dashes: Vector2D[][] = [];
  let currentDash: Vector2D[] = [];

  if (isDrawing) {
    currentDash.push(polyline[0]);
  }

  for (let i = 0; i < polyline.length - 1; i++) {
    let pStart = polyline[i];
    const pEnd = polyline[i + 1];
    let segLen = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);

    if (segLen < 1e-5) continue;

    const dx = (pEnd.x - pStart.x) / segLen;
    const dy = (pEnd.y - pStart.y) / segLen;

    while (segLen > 0) {
      if (segLen < remainingInDash) {
        remainingInDash -= segLen;
        if (isDrawing) {
          currentDash.push(pEnd);
        }
        segLen = 0;
      } else {
        const stepDist = remainingInDash;
        const splitPt: Vector2D = {
          x: pStart.x + dx * stepDist,
          y: pStart.y + dy * stepDist,
        };

        if (isDrawing) {
          currentDash.push(splitPt);
          if (currentDash.length >= 2) {
            dashes.push(currentDash);
          }
          currentDash = [];
        } else {
          currentDash = [splitPt];
        }

        pStart = splitPt;
        segLen -= stepDist;

        // Avanzar al siguiente segmento del patrón
        patternIdx = (patternIdx + 1) % pattern.length;
        remainingInDash = pattern[patternIdx];
        isDrawing = !isDrawing;
      }
    }
  }

  if (isDrawing && currentDash.length >= 2) {
    dashes.push(currentDash);
  }

  return dashes;
}

/**
 * Genera el contorno poligonal de un trazo abierto (polilínea) con grosor width = 2*r,
 * remates (lineCap) y esquinas (lineJoin).
 */
export function outlineOpenPolyline(
  rawPoints: readonly Vector2D[],
  width: number,
  lineCap: StrokeLineCap = 'round',
  lineJoin: StrokeLineJoin = 'round',
  miterLimit: number = 4
): Vector2D[] {
  const points = cleanPolyline(rawPoints);
  if (points.length < 2 || width <= 0) return [];

  const r = width / 2;
  const n = points.length;

  interface SegmentInfo {
    p1: Vector2D;
    p2: Vector2D;
    len: number;
    T: Vector2D; // Tangente unitaria
    N: Vector2D; // Normal unitaria izquierda (-Ty, Tx)
  }

  const segments: SegmentInfo[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    const T = { x: dx / len, y: dy / len };
    const N = { x: -T.y, y: T.x };
    segments.push({ p1, p2, len, T, N });
  }

  if (segments.length === 0) return [];

  const leftPts: Vector2D[] = [];
  const rightPts: Vector2D[] = [];

  // 1. Punto inicial del lado izquierdo (+r * N)
  leftPts.push({
    x: segments[0].p1.x + r * segments[0].N.x,
    y: segments[0].p1.y + r * segments[0].N.y,
  });

  // 2. Vértices internos en el lado izquierdo
  for (let i = 0; i < segments.length - 1; i++) {
    const sPrev = segments[i];
    const sCurr = segments[i + 1];
    const vertex = sCurr.p1;

    const cross = sPrev.T.x * sCurr.T.y - sPrev.T.y * sCurr.T.x; // sin(turn)
    const dot = sPrev.T.x * sCurr.T.x + sPrev.T.y * sCurr.T.y; // cos(turn)

    // Si cross < 0 -> giro a la derecha -> lado izquierdo es esquina EXTERIOR
    if (cross < -1e-5) {
      if (lineJoin === 'round') {
        const aStart = Math.atan2(sPrev.N.y, sPrev.N.x);
        let aEnd = Math.atan2(sCurr.N.y, sCurr.N.x);
        // Debe girar en sentido horario (CW, ángulo decreciente)
        while (aEnd > aStart) aEnd -= 2 * Math.PI;
        const diff = aStart - aEnd;
        const steps = Math.max(2, Math.ceil(diff / (Math.PI / 8)));
        for (let s = 0; s <= steps; s++) {
          const a = aStart - diff * (s / steps);
          leftPts.push({ x: vertex.x + r * Math.cos(a), y: vertex.y + r * Math.sin(a) });
        }
      } else if (lineJoin === 'miter') {
        const denom = Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
        const miterLen = r / denom;
        if (miterLen <= miterLimit * r) {
          const bisectX = sPrev.N.x + sCurr.N.x;
          const bisectY = sPrev.N.y + sCurr.N.y;
          const bisectLen = Math.hypot(bisectX, bisectY);
          const uBisectX = bisectLen > 1e-6 ? bisectX / bisectLen : sPrev.N.x;
          const uBisectY = bisectLen > 1e-6 ? bisectY / bisectLen : sPrev.N.y;
          leftPts.push({ x: vertex.x + miterLen * uBisectX, y: vertex.y + miterLen * uBisectY });
        } else {
          // Excede miter limit: biselado
          leftPts.push(
            { x: vertex.x + r * sPrev.N.x, y: vertex.y + r * sPrev.N.y },
            { x: vertex.x + r * sCurr.N.x, y: vertex.y + r * sCurr.N.y }
          );
        }
      } else {
        // lineJoin === 'bevel'
        leftPts.push(
          { x: vertex.x + r * sPrev.N.x, y: vertex.y + r * sPrev.N.y },
          { x: vertex.x + r * sCurr.N.x, y: vertex.y + r * sCurr.N.y }
        );
      }
    } else if (cross > 1e-5) {
      // Giro a la izquierda -> lado izquierdo es esquina INTERIOR
      const denom = Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
      const innerLen = r / denom;
      const bisectX = sPrev.N.x + sCurr.N.x;
      const bisectY = sPrev.N.y + sCurr.N.y;
      const bisectLen = Math.hypot(bisectX, bisectY);
      const uBisectX = bisectLen > 1e-6 ? bisectX / bisectLen : sPrev.N.x;
      const uBisectY = bisectLen > 1e-6 ? bisectY / bisectLen : sPrev.N.y;
      leftPts.push({ x: vertex.x + innerLen * uBisectX, y: vertex.y + innerLen * uBisectY });
    } else {
      // Línea prácticamente recta
      leftPts.push({ x: vertex.x + r * sCurr.N.x, y: vertex.y + r * sCurr.N.y });
    }
  }

  // 3. Extremo final del lado izquierdo
  const lastSeg = segments[segments.length - 1];
  leftPts.push({
    x: lastSeg.p2.x + r * lastSeg.N.x,
    y: lastSeg.p2.y + r * lastSeg.N.y,
  });

  // 4. Remate final (End Cap)
  const endCapPts: Vector2D[] = [];
  const endVertex = lastSeg.p2;
  const leftEnd = leftPts[leftPts.length - 1];
  const rightEnd: Vector2D = {
    x: endVertex.x - r * lastSeg.N.x,
    y: endVertex.y - r * lastSeg.N.y,
  };

  if (lineCap === 'round') {
    const aStart = Math.atan2(lastSeg.N.y, lastSeg.N.x);
    // Semicírculo en sentido horario (CW) atravesando la tangente T hasta -N
    const steps = 8;
    for (let s = 1; s < steps; s++) {
      const a = aStart - Math.PI * (s / steps);
      endCapPts.push({ x: endVertex.x + r * Math.cos(a), y: endVertex.y + r * Math.sin(a) });
    }
  } else if (lineCap === 'square') {
    endCapPts.push(
      { x: leftEnd.x + r * lastSeg.T.x, y: leftEnd.y + r * lastSeg.T.y },
      { x: rightEnd.x + r * lastSeg.T.x, y: rightEnd.y + r * lastSeg.T.y }
    );
  }

  // 5. Lado derecho (-r * N), recorrido en sentido inverso desde lastSeg hacia firstSeg
  rightPts.push(rightEnd);

  for (let i = segments.length - 1; i > 0; i--) {
    const sCurr = segments[i];
    const sPrev = segments[i - 1];
    const vertex = sCurr.p1;

    const cross = sPrev.T.x * sCurr.T.y - sPrev.T.y * sCurr.T.x;
    const dot = sPrev.T.x * sCurr.T.x + sPrev.T.y * sCurr.T.y;

    // Si cross > 0 -> giro original a la izquierda -> en retroceso el lado derecho es esquina EXTERIOR
    if (cross > 1e-5) {
      if (lineJoin === 'round') {
        const aStart = Math.atan2(-sCurr.N.y, -sCurr.N.x);
        let aEnd = Math.atan2(-sPrev.N.y, -sPrev.N.x);
        while (aEnd > aStart) aEnd -= 2 * Math.PI;
        const diff = aStart - aEnd;
        const steps = Math.max(2, Math.ceil(diff / (Math.PI / 8)));
        for (let s = 0; s <= steps; s++) {
          const a = aStart - diff * (s / steps);
          rightPts.push({ x: vertex.x + r * Math.cos(a), y: vertex.y + r * Math.sin(a) });
        }
      } else if (lineJoin === 'miter') {
        const denom = Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
        const miterLen = r / denom;
        if (miterLen <= miterLimit * r) {
          const bisectX = -(sPrev.N.x + sCurr.N.x);
          const bisectY = -(sPrev.N.y + sCurr.N.y);
          const bisectLen = Math.hypot(bisectX, bisectY);
          const uBisectX = bisectLen > 1e-6 ? bisectX / bisectLen : -sCurr.N.x;
          const uBisectY = bisectLen > 1e-6 ? bisectY / bisectLen : -sCurr.N.y;
          rightPts.push({ x: vertex.x + miterLen * uBisectX, y: vertex.y + miterLen * uBisectY });
        } else {
          rightPts.push(
            { x: vertex.x - r * sCurr.N.x, y: vertex.y - r * sCurr.N.y },
            { x: vertex.x - r * sPrev.N.x, y: vertex.y - r * sPrev.N.y }
          );
        }
      } else {
        // lineJoin === 'bevel'
        rightPts.push(
          { x: vertex.x - r * sCurr.N.x, y: vertex.y - r * sCurr.N.y },
          { x: vertex.x - r * sPrev.N.x, y: vertex.y - r * sPrev.N.y }
        );
      }
    } else if (cross < -1e-5) {
      // Giro original a la derecha -> lado derecho es esquina INTERIOR
      const denom = Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
      const innerLen = r / denom;
      const bisectX = -(sPrev.N.x + sCurr.N.x);
      const bisectY = -(sPrev.N.y + sCurr.N.y);
      const bisectLen = Math.hypot(bisectX, bisectY);
      const uBisectX = bisectLen > 1e-6 ? bisectX / bisectLen : -sCurr.N.x;
      const uBisectY = bisectLen > 1e-6 ? bisectY / bisectLen : -sCurr.N.y;
      rightPts.push({ x: vertex.x + innerLen * uBisectX, y: vertex.y + innerLen * uBisectY });
    } else {
      rightPts.push({ x: vertex.x - r * sPrev.N.x, y: vertex.y - r * sPrev.N.y });
    }
  }

  // 6. Extremo inicial del lado derecho
  const firstSeg = segments[0];
  const rightStart: Vector2D = {
    x: firstSeg.p1.x - r * firstSeg.N.x,
    y: firstSeg.p1.y - r * firstSeg.N.y,
  };
  rightPts.push(rightStart);

  // 7. Remate inicial (Start Cap)
  const startCapPts: Vector2D[] = [];
  const startVertex = firstSeg.p1;
  const leftStart = leftPts[0];

  if (lineCap === 'round') {
    const aStart = Math.atan2(-firstSeg.N.y, -firstSeg.N.x);
    const steps = 8;
    for (let s = 1; s < steps; s++) {
      const a = aStart - Math.PI * (s / steps);
      startCapPts.push({ x: startVertex.x + r * Math.cos(a), y: startVertex.y + r * Math.sin(a) });
    }
  } else if (lineCap === 'square') {
    startCapPts.push(
      { x: rightStart.x - r * firstSeg.T.x, y: rightStart.y - r * firstSeg.T.y },
      { x: leftStart.x - r * firstSeg.T.x, y: leftStart.y - r * firstSeg.T.y }
    );
  }

  const fullContour = [...leftPts, ...endCapPts, ...rightPts, ...startCapPts];
  return ensureCCW(simplifyPolygon(fullContour));
}

/**
 * Contornea un trazado de polígono cerrado expandiendo su contorno exterior y contrayendo su interior.
 */
function outlineClosedPolygon(
  poly: readonly Vector2D[],
  width: number
): Vector2D[][] {
  const points = cleanPolyline(ensureCCW(poly));
  const n = points.length;
  if (n < 3 || width <= 0) return [];

  const r = width / 2;

  // Calcular normales exteriores para cada arista
  interface Edge {
    p1: Vector2D;
    p2: Vector2D;
    T: Vector2D;
    N: Vector2D; // Normal exterior (a la derecha en sentido antihorario)
  }

  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    const T = { x: dx / len, y: dy / len };
    // En polígono CCW, la normal exterior apunta hacia la derecha: (Ty, -Tx)
    const N = { x: T.y, y: -T.x };
    edges.push({ p1, p2, T, N });
  }

  const m = edges.length;
  if (m < 3) return [];

  // Anillo exterior (+r hacia afuera en normal exterior N)
  const outerRing: Vector2D[] = [];
  // Anillo interior (-r hacia adentro en normal exterior N)
  const innerRing: Vector2D[] = [];

  for (let i = 0; i < m; i++) {
    const ePrev = edges[(i - 1 + m) % m];
    const eCurr = edges[i];
    const vertex = eCurr.p1;

    const dot = ePrev.T.x * eCurr.T.x + ePrev.T.y * eCurr.T.y;
    const denom = Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
    const h = r / denom;

    const bisectX = ePrev.N.x + eCurr.N.x;
    const bisectY = ePrev.N.y + eCurr.N.y;
    const bLen = Math.hypot(bisectX, bisectY);
    const uBX = bLen > 1e-6 ? bisectX / bLen : ePrev.N.x;
    const uBY = bLen > 1e-6 ? bisectY / bLen : ePrev.N.y;

    // Vértice exterior
    if (h <= 4 * r) {
      outerRing.push({ x: vertex.x + h * uBX, y: vertex.y + h * uBY });
    } else {
      outerRing.push(
        { x: vertex.x + r * ePrev.N.x, y: vertex.y + r * ePrev.N.y },
        { x: vertex.x + r * eCurr.N.x, y: vertex.y + r * eCurr.N.y }
      );
    }

    // Vértice interior
    innerRing.push({ x: vertex.x - h * uBX, y: vertex.y - h * uBY });
  }

  const outerPoly = ensureCCW(simplifyPolygon(outerRing));
  const innerPoly = ensureCCW(simplifyPolygon(innerRing));

  // Comprobar si el anillo interior sigue siendo válido (área positiva y no colapsado)
  const innerArea = polygonArea(innerPoly);
  if (innerArea > 1e-2 && isPointInPolygon(innerPoly[0], outerPoly)) {
    return combineRings('subtract', [outerPoly], [innerPoly]);
  }

  return [outerPoly];
}

/**
 * Contornea un rectángulo generando un anillo exterior e interior con esquinas proporcionales.
 */
function outlineRectangle(rect: Rectangle, width: number): Vector2D[][] {
  const r = width / 2;
  const { x, y, width: w, height: h, rotation, cornerRadius: crRaw } = rect;
  const cr = crRaw ?? 0;
  const rad = rotation ? (rotation * Math.PI) / 180 : 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const center = { x: cx, y: cy };

  const outerW = w + 2 * r;
  const outerH = h + 2 * r;
  const outerX = x - r;
  const outerY = y - r;
  const outerCR = cr > 0 ? cr + r : rect.strokeLineJoin === 'round' ? r : 0;

  const outerRect: Rectangle = {
    ...rect,
    x: outerX,
    y: outerY,
    width: outerW,
    height: outerH,
    cornerRadius: outerCR,
  };

  const outerPoly = rectangleToPolygon(outerRect, center, rad);

  if (w > 2 * r && h > 2 * r) {
    const innerW = w - 2 * r;
    const innerH = h - 2 * r;
    const innerX = x + r;
    const innerY = y + r;
    const innerCR = cr > 0 ? Math.max(0, cr - r) : 0;

    const innerRect: Rectangle = {
      ...rect,
      x: innerX,
      y: innerY,
      width: innerW,
      height: innerH,
      cornerRadius: innerCR,
    };

    const innerPoly = rectangleToPolygon(innerRect, center, rad);
    return combineRings('subtract', [outerPoly], [innerPoly]);
  }

  return [outerPoly];
}

function rectangleToPolygon(rect: Rectangle, center: Vector2D, rad: number): Vector2D[] {
  const { x, y, width, height, cornerRadius } = rect;
  const r = cornerRadius && cornerRadius > 0 ? Math.min(cornerRadius, width / 2, height / 2) : 0;
  const pts: Vector2D[] = [];

  if (r === 0) {
    pts.push(
      rotatePoint({ x, y }, center, rad),
      rotatePoint({ x: x + width, y }, center, rad),
      rotatePoint({ x: x + width, y: y + height }, center, rad),
      rotatePoint({ x, y: y + height }, center, rad)
    );
  } else {
    const steps = 6;
    const trX = x + width - r;
    const trY = y + r;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
      pts.push(rotatePoint({ x: trX + r * Math.cos(a), y: trY + r * Math.sin(a) }, center, rad));
    }
    const brX = x + width - r;
    const brY = y + height - r;
    for (let i = 1; i <= steps; i++) {
      const a = (Math.PI / 2) * (i / steps);
      pts.push(rotatePoint({ x: brX + r * Math.cos(a), y: brY + r * Math.sin(a) }, center, rad));
    }
    const blX = x + r;
    const blY = y + height - r;
    for (let i = 1; i <= steps; i++) {
      const a = Math.PI / 2 + (Math.PI / 2) * (i / steps);
      pts.push(rotatePoint({ x: blX + r * Math.cos(a), y: blY + r * Math.sin(a) }, center, rad));
    }
    const tlX = x + r;
    const tlY = y + r;
    for (let i = 1; i < steps; i++) {
      const a = Math.PI + (Math.PI / 2) * (i / steps);
      pts.push(rotatePoint({ x: tlX + r * Math.cos(a), y: tlY + r * Math.sin(a) }, center, rad));
    }
  }

  return ensureCCW(pts);
}

/**
 * Contornea una elipse generando una corona elíptica (anillo).
 */
function outlineEllipse(ellipse: Ellipse, width: number): Vector2D[][] {
  const r = width / 2;
  const { x, y, radiusX, radiusY, rotation } = ellipse;
  const rad = rotation ? (rotation * Math.PI) / 180 : 0;
  const center = { x, y };

  const outerRX = radiusX + r;
  const outerRY = radiusY + r;

  const outerPoly = ellipseToPolygon(x, y, outerRX, outerRY, center, rad);

  if (radiusX > r && radiusY > r) {
    const innerRX = radiusX - r;
    const innerRY = radiusY - r;
    const innerPoly = ellipseToPolygon(x, y, innerRX, innerRY, center, rad);
    return combineRings('subtract', [outerPoly], [innerPoly]);
  }

  return [outerPoly];
}

function ellipseToPolygon(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  center: Vector2D,
  rad: number
): Vector2D[] {
  const steps = 48;
  const pts: Vector2D[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const pt = {
      x: cx + rx * Math.cos(theta),
      y: cy + ry * Math.sin(theta),
    };
    pts.push(rotatePoint(pt, center, rad));
  }
  return ensureCCW(pts);
}

/**
 * Contornea un polígono regular.
 */
function outlinePolygon(poly: Polygon, width: number): Vector2D[][] {
  const r = width / 2;
  const { sides, radius } = poly;
  const apothem = radius * Math.cos(Math.PI / sides);
  const outerRadius = (apothem + r) / Math.cos(Math.PI / sides);

  const outerPoly = ensureCCW(getPolygonVertices({ ...poly, radius: outerRadius }));

  if (apothem > r) {
    const innerRadius = (apothem - r) / Math.cos(Math.PI / sides);
    const innerPoly = ensureCCW(getPolygonVertices({ ...poly, radius: innerRadius }));
    return combineRings('subtract', [outerPoly], [innerPoly]);
  }

  return [outerPoly];
}

/**
 * Contornea una figura de tipo estrella.
 */
function outlineStar(star: Star, width: number): Vector2D[][] {
  const verts = getStarVertices(star);
  return outlineClosedPolygon(verts, width);
}

/**
 * Convierte los anillos poligonales resultantes del contorneado en uno o más nodos Path de Scene Graph.
 */
function ringsToPaths(
  rings: Vector2D[][],
  baseShape: Shape,
  nameSuffix: string = 'Contorno'
): Path[] {
  const islands = processHolesAndIslands(rings);
  if (islands.length === 0) return [];

  return islands.map((island, idx) => {
    const points: PathPoint[] = island.map((p) => ({
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
    }));

    const pathId = generateClonedShapeId('path');
    const shapeName =
      islands.length > 1
        ? `${nameSuffix} de ${baseShape.name} (${idx + 1})`
        : `${nameSuffix} de ${baseShape.name}`;

    return {
      id: pathId,
      type: 'path',
      name: shapeName,
      x: 0,
      y: 0,
      closed: true,
      points,
      fill: baseShape.stroke!,
      stroke: 'none',
      strokeWidth: 0,
      opacity: baseShape.opacity,
    };
  });
}

/**
 * Contornea el borde de una figura vectorial produciendo uno o más nodos Path cerrados con relleno.
 * Si la figura no tiene un borde válido, retorna un array vacío.
 */
export function outlineStroke(shape: Shape): Path[] {
  if (!canOutlineStroke(shape)) return [];

  const width = shape.strokeWidth ?? 1;
  const lineCap = shape.strokeLineCap ?? 'round';
  const lineJoin = shape.strokeLineJoin ?? 'round';
  const dashArray = shape.strokeDashArray;

  // 1. Rectangle
  if (shape.type === 'rectangle') {
    if (dashArray && dashArray.length > 0) {
      const rectPoly = rectangleToPolygon(shape, { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }, (shape.rotation ?? 0) * Math.PI / 180);
      const dashes = dashPolyline(rectPoly.concat([rectPoly[0]]), dashArray);
      const allRings: Vector2D[][] = dashes.map((d) => outlineOpenPolyline(d, width, lineCap, lineJoin));
      return ringsToPaths(allRings.filter((r) => r.length >= 3), shape);
    }
    const rings = outlineRectangle(shape, width);
    return ringsToPaths(rings, shape);
  }

  // 2. Ellipse
  if (shape.type === 'ellipse') {
    if (dashArray && dashArray.length > 0) {
      const ellPoly = ellipseToPolygon(shape.x, shape.y, shape.radiusX, shape.radiusY, { x: shape.x, y: shape.y }, (shape.rotation ?? 0) * Math.PI / 180);
      const dashes = dashPolyline(ellPoly.concat([ellPoly[0]]), dashArray);
      const allRings: Vector2D[][] = dashes.map((d) => outlineOpenPolyline(d, width, lineCap, lineJoin));
      return ringsToPaths(allRings.filter((r) => r.length >= 3), shape);
    }
    const rings = outlineEllipse(shape, width);
    return ringsToPaths(rings, shape);
  }

  // 3. Polygon
  if (shape.type === 'polygon') {
    if (dashArray && dashArray.length > 0) {
      const polyVerts = ensureCCW(getPolygonVertices(shape));
      const dashes = dashPolyline(polyVerts.concat([polyVerts[0]]), dashArray);
      const allRings: Vector2D[][] = dashes.map((d) => outlineOpenPolyline(d, width, lineCap, lineJoin));
      return ringsToPaths(allRings.filter((r) => r.length >= 3), shape);
    }
    const rings = outlinePolygon(shape, width);
    return ringsToPaths(rings, shape);
  }

  // 4. Star
  if (shape.type === 'star') {
    if (dashArray && dashArray.length > 0) {
      const starVerts = ensureCCW(getStarVertices(shape));
      const dashes = dashPolyline(starVerts.concat([starVerts[0]]), dashArray);
      const allRings: Vector2D[][] = dashes.map((d) => outlineOpenPolyline(d, width, lineCap, lineJoin));
      return ringsToPaths(allRings.filter((r) => r.length >= 3), shape);
    }
    const rings = outlineStar(shape, width);
    return ringsToPaths(rings, shape);
  }

  // 5. Path
  if (shape.type === 'path') {
    const subpaths = pathSubpathsToPolylines(shape);
    if (subpaths.length === 0) return [];

    const allRings: Vector2D[][] = [];

    for (const sub of subpaths) {
      if (sub.points.length < 2) continue;

      if (dashArray && dashArray.length > 0) {
        const pts = sub.closed ? sub.points.concat([sub.points[0]]) : sub.points;
        const dashes = dashPolyline(pts, dashArray);
        for (const d of dashes) {
          if (d.length >= 2) {
            allRings.push(outlineOpenPolyline(d, width, lineCap, lineJoin));
          }
        }
      } else if (sub.closed) {
        const closedRings = outlineClosedPolygon(sub.points, width);
        allRings.push(...closedRings);
      } else {
        const openRing = outlineOpenPolyline(sub.points, width, lineCap, lineJoin);
        if (openRing.length >= 3) {
          allRings.push(openRing);
        }
      }
    }

    return ringsToPaths(allRings.filter((r) => r.length >= 3), shape);
  }

  return [];
}

/**
 * Resultado de expandir el trazo de una figura:
 * - fillShape: si la figura original tenía relleno, la figura resultante sin borde (stroke = 'none')
 * - strokeShapes: figuras de tipo Path generadas que representan el borde contorneado
 */
export interface ExpandedShapeResult {
  readonly originalShape: Shape;
  readonly fillShape?: Shape;
  readonly strokeShapes: readonly Path[];
}

/**
 * Expande el trazo de una figura preservando su relleno en una figura independiente si existe.
 */
export function expandShapeStroke(shape: Shape): ExpandedShapeResult | null {
  if (!canOutlineStroke(shape)) return null;

  const strokeShapes = outlineStroke(shape);
  if (strokeShapes.length === 0) return null;

  const hasFill = !isNonePaint(shape.fill);

  let fillShape: Shape | undefined;
  if (hasFill) {
    fillShape = {
      ...shape,
      stroke: 'none',
      strokeWidth: 0,
      strokeDashArray: undefined,
    };
  }

  return {
    originalShape: shape,
    fillShape,
    strokeShapes,
  };
}
