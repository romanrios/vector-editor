import type { PathPoint, Vector2D } from '../../types/scene-graph.ts';
import type { BezierSegment, SvgPathParseResult, SvgSubpath } from './types.ts';

/**
 * Convierte un arco elíptico SVG en una serie de segmentos cúbicos Bézier según el estándar W3C.
 */
export function arcToBezier(
  x1: number,
  y1: number,
  rxRaw: number,
  ryRaw: number,
  xAxisRotationDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number
): BezierSegment[] {
  if (x1 === x2 && y1 === y2) {
    return [];
  }

  let rx = Math.abs(rxRaw);
  let ry = Math.abs(ryRaw);

  if (rx === 0 || ry === 0) {
    return [{
      cp1: { x: x1, y: y1 },
      cp2: { x: x2, y: y2 },
      to: { x: x2, y: y2 },
    }];
  }

  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const num = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
  const den = rxSq * y1pSq + rySq * x1pSq;
  const sq = den === 0 ? 0 : Math.sqrt(num / den);
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const cxp = sign * sq * ((rx * y1p) / ry);
  const cyp = sign * sq * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    if (len === 0) return 0;
    let cos = dot / len;
    if (cos < -1) cos = -1;
    if (cos > 1) cos = 1;
    let ang = Math.acos(cos);
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  }

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta1 = vectorAngle(1, 0, ux, uy);
  let dTheta = vectorAngle(ux, uy, vx, vy);

  if (sweepFlag === 0 && dTheta > 0) {
    dTheta -= 2 * Math.PI;
  } else if (sweepFlag === 1 && dTheta < 0) {
    dTheta += 2 * Math.PI;
  }

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const result: BezierSegment[] = [];

  for (let i = 0; i < segments; i++) {
    const t1 = theta1 + i * delta;
    const t2 = t1 + delta;

    const alpha = (4 / 3) * Math.tan(delta / 4);

    const cosT1 = Math.cos(t1);
    const sinT1 = Math.sin(t1);
    const cosT2 = Math.cos(t2);
    const sinT2 = Math.sin(t2);

    const p1x = cosT1 - alpha * sinT1;
    const p1y = sinT1 + alpha * cosT1;
    const p2x = cosT2 + alpha * sinT2;
    const p2y = sinT2 - alpha * cosT2;
    const p3x = cosT2;
    const p3y = sinT2;

    function mapPoint(px: number, py: number): Vector2D {
      const sx = px * rx;
      const sy = py * ry;
      return {
        x: cosPhi * sx - sinPhi * sy + cx,
        y: sinPhi * sx + cosPhi * sy + cy,
      };
    }

    result.push({
      cp1: mapPoint(p1x, p1y),
      cp2: mapPoint(p2x, p2y),
      to: mapPoint(p3x, p3y),
    });
  }

  if (result.length > 0) {
    result[result.length - 1] = {
      cp1: result[result.length - 1].cp1,
      cp2: result[result.length - 1].cp2,
      to: { x: x2, y: y2 },
    };
  }

  return result;
}

/**
 * Parsea una cadena de comando SVG path 'd' y la convierte en una colección de puntos PathPoint y subpaths.
 */
export function parseSvgPathD(d: string): SvgPathParseResult {
  const points: PathPoint[] = [];
  let closed = false;

  // Normalizar y separar comandos y números
  const commandRegex = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = commandRegex.exec(d)) !== null) {
    tokens.push(match[0]);
  }

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  let currentCommand = '';
  let lastCommandType = '';
  let lastQuadraticCp: Vector2D | null = null;

  function nextNumber(): number {
    if (i >= tokens.length) return 0;
    return parseFloat(tokens[i++]) || 0;
  }

  function nextFlag(): number {
    if (i >= tokens.length) return 0;
    const tok = tokens[i];
    if (tok.length > 1 && (tok[0] === '0' || tok[0] === '1')) {
      const flag = parseInt(tok[0], 10);
      tokens[i] = tok.slice(1);
      return flag;
    }
    i++;
    return parseInt(tok, 10) || 0;
  }

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-df-z]$/i.test(token)) {
      currentCommand = token;
      i++;
    }

    const isRelative = currentCommand === currentCommand.toLowerCase();
    const cmd = currentCommand.toUpperCase();

    if (cmd === 'M') {
      const x = nextNumber();
      const y = nextNumber();
      currentX = isRelative ? currentX + x : x;
      currentY = isRelative ? currentY + y : y;
      startX = currentX;
      startY = currentY;

      const isSubpath = points.length > 0;
      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
        ...(isSubpath ? { moveTo: true } : {}),
      });

      lastCommandType = 'M';
      lastQuadraticCp = null;
      // Comandos M sucesivos implican comando L
      currentCommand = isRelative ? 'l' : 'L';
    } else if (cmd === 'L') {
      const x = nextNumber();
      const y = nextNumber();
      currentX = isRelative ? currentX + x : x;
      currentY = isRelative ? currentY + y : y;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });

      lastCommandType = 'L';
      lastQuadraticCp = null;
    } else if (cmd === 'H') {
      const x = nextNumber();
      currentX = isRelative ? currentX + x : x;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });

      lastCommandType = 'H';
      lastQuadraticCp = null;
    } else if (cmd === 'V') {
      const y = nextNumber();
      currentY = isRelative ? currentY + y : y;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });

      lastCommandType = 'V';
      lastQuadraticCp = null;
    } else if (cmd === 'C') {
      const cp1xRaw = nextNumber();
      const cp1yRaw = nextNumber();
      const cp2xRaw = nextNumber();
      const cp2yRaw = nextNumber();
      const toXRaw = nextNumber();
      const toYRaw = nextNumber();

      const cp1x = isRelative ? currentX + cp1xRaw : cp1xRaw;
      const cp1y = isRelative ? currentY + cp1yRaw : cp1yRaw;
      const cp2x = isRelative ? currentX + cp2xRaw : cp2xRaw;
      const cp2y = isRelative ? currentY + cp2yRaw : cp2yRaw;
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
      lastCommandType = 'C';
      lastQuadraticCp = null;
    } else if (cmd === 'S') {
      let cp1x = currentX;
      let cp1y = currentY;
      if (points.length > 0) {
        const prev = points[points.length - 1];
        if (prev.handleIn && (lastCommandType === 'C' || lastCommandType === 'S')) {
          cp1x = currentX + (currentX - prev.handleIn.x);
          cp1y = currentY + (currentY - prev.handleIn.y);
        }
      }

      const cp2xRaw = nextNumber();
      const cp2yRaw = nextNumber();
      const toXRaw = nextNumber();
      const toYRaw = nextNumber();

      const cp2x = isRelative ? currentX + cp2xRaw : cp2xRaw;
      const cp2y = isRelative ? currentY + cp2yRaw : cp2yRaw;
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
      lastCommandType = 'S';
      lastQuadraticCp = null;
    } else if (cmd === 'Q') {
      const qxRaw = nextNumber();
      const qyRaw = nextNumber();
      const toXRaw = nextNumber();
      const toYRaw = nextNumber();

      const qx = isRelative ? currentX + qxRaw : qxRaw;
      const qy = isRelative ? currentY + qyRaw : qyRaw;
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      lastQuadraticCp = { x: qx, y: qy };

      const cp1x = currentX + (2 / 3) * (qx - currentX);
      const cp1y = currentY + (2 / 3) * (qy - currentY);
      const cp2x = toX + (2 / 3) * (qx - toX);
      const cp2y = toY + (2 / 3) * (qy - toY);

      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
      lastCommandType = 'Q';
    } else if (cmd === 'T') {
      const toXRaw = nextNumber();
      const toYRaw = nextNumber();
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      let qx = currentX;
      let qy = currentY;
      if (lastQuadraticCp && (lastCommandType === 'Q' || lastCommandType === 'T')) {
        qx = 2 * currentX - lastQuadraticCp.x;
        qy = 2 * currentY - lastQuadraticCp.y;
      }

      lastQuadraticCp = { x: qx, y: qy };

      const cp1x = currentX + (2 / 3) * (qx - currentX);
      const cp1y = currentY + (2 / 3) * (qy - currentY);
      const cp2x = toX + (2 / 3) * (qx - toX);
      const cp2y = toY + (2 / 3) * (qy - toY);

      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
      lastCommandType = 'T';
    } else if (cmd === 'A') {
      const rxRaw = nextNumber();
      const ryRaw = nextNumber();
      const rot = nextNumber();
      const largeArc = nextFlag();
      const sweep = nextFlag();
      const toXRaw = nextNumber();
      const toYRaw = nextNumber();

      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      const beziers = arcToBezier(currentX, currentY, rxRaw, ryRaw, rot, largeArc, sweep, toX, toY);

      for (const b of beziers) {
        if (points.length > 0) {
          const lastIdx = points.length - 1;
          const prev = points[lastIdx];
          points[lastIdx] = {
            ...prev,
            handleOut: b.cp1,
            pointType: 'smooth',
          };
        }
        points.push({
          x: b.to.x,
          y: b.to.y,
          handleIn: b.cp2,
          pointType: 'smooth',
        });
      }

      currentX = toX;
      currentY = toY;
      lastCommandType = 'A';
      lastQuadraticCp = null;
    } else if (cmd === 'Z') {
      closed = true;
      if (points.length > 0) {
        points[points.length - 1] = {
          ...points[points.length - 1],
          closeSubpath: true,
        };
      }
      currentX = startX;
      currentY = startY;
      lastCommandType = 'Z';
      lastQuadraticCp = null;
    } else {
      i++;
    }
  }

  // Desglosar subpaths
  const subpaths: SvgSubpath[] = [];
  let currentSubpathPoints: PathPoint[] = [];

  for (let k = 0; k < points.length; k++) {
    const pt = points[k];
    if (k > 0 && pt.moveTo) {
      if (currentSubpathPoints.length > 0) {
        const lastPt = currentSubpathPoints[currentSubpathPoints.length - 1];
        subpaths.push({
          points: currentSubpathPoints,
          closed: lastPt.closeSubpath ?? closed,
        });
      }
      currentSubpathPoints = [];
    }
    currentSubpathPoints.push(pt);
  }

  if (currentSubpathPoints.length > 0) {
    const lastPt = currentSubpathPoints[currentSubpathPoints.length - 1];
    subpaths.push({
      points: currentSubpathPoints,
      closed: lastPt.closeSubpath ?? closed,
    });
  }

  if (subpaths.length <= 1 && points.length > 0) {
    for (let k = 0; k < points.length; k++) {
      if (points[k].moveTo !== undefined || points[k].closeSubpath !== undefined) {
        const { moveTo, closeSubpath, ...rest } = points[k];
        points[k] = rest;
      }
    }
  }

  return { points, closed, subpaths };
}
