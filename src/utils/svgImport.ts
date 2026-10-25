import {
  isShape,
  type AABB,
  type Ellipse,
  type FillType,
  type GradientStop,
  type Group,
  type LayerChildNode,
  type Path,
  type PathPoint,
  type Rectangle,
  type StrokeLineCap,
  type StrokeLineJoin,
  type Text,
  type Vector2D,
  type BlendMode,
  type DropShadow,
} from '../types/scene-graph.ts';
import { getPathBaseAABB } from './geometry.ts';
import { normalizeColor } from './color.ts';

export interface SvgRawGradient {
  id: string;
  type: 'linear' | 'radial';
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox';
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  r?: number;
  fx?: number;
  fy?: number;
  transformMatrix?: [number, number, number, number, number, number];
  stops: GradientStop[];
  href?: string;
}

export interface SvgImportResult {
  readonly success: boolean;
  readonly shapes: readonly LayerChildNode[];
  readonly width: number;
  readonly height: number;
  readonly error?: string;
}

export interface SvgSubpath {
  readonly points: PathPoint[];
  readonly closed: boolean;
}

export interface SvgPathParseResult {
  readonly points: PathPoint[];
  readonly closed: boolean;
  readonly subpaths: readonly SvgSubpath[];
}

export interface BezierSegment {
  readonly cp1: Vector2D;
  readonly cp2: Vector2D;
  readonly to: Vector2D;
}

interface SvgContext {
  fill?: FillType | SvgRawGradient;
  stroke?: FillType | SvgRawGradient;
  strokeWidth?: number;
  strokeLineCap?: StrokeLineCap;
  strokeLineJoin?: StrokeLineJoin;
  strokeDashArray?: readonly number[];
  opacity?: number;
  blendMode?: BlendMode;
  dropShadow?: DropShadow;
  fillRule?: 'nonzero' | 'evenodd';
  transformMatrix?: [number, number, number, number, number, number];
}

interface CssRule {
  readonly selector: string;
  readonly styles: Record<string, string>;
}

export interface SvgElementLike {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly children: ArrayLike<SvgElementLike>;
  readonly textContent?: string | null;
  ownerDocument?: {
    getElementById(id: string): SvgElementLike | null;
  };
  querySelectorAll?(selector: string): SvgElementLike[];
  querySelector?(selector: string): SvgElementLike | null;
}

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}

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

/**
 * Multiplica un punto por una matriz de transformación afín 2D [a, b, c, d, e, f].
 */
function applyTransform(p: Vector2D, matrix?: [number, number, number, number, number, number]): Vector2D {
  if (!matrix) return p;
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  };
}

/**
 * Combina dos matrices afines 2D [a, b, c, d, e, f]
 */
function multiplyMatrices(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Descompone una matriz de transformación afín en factores de escala y ángulo de rotación.
 */
function decomposeMatrix(matrix?: [number, number, number, number, number, number]): {
  scaleX: number;
  scaleY: number;
  rotation: number;
} {
  if (!matrix) return { scaleX: 1, scaleY: 1, rotation: 0 };
  const [a, b, c, d] = matrix;
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  return { scaleX: scaleX || 1, scaleY: scaleY || 1, rotation };
}

/**
 * Parsea un atributo transform SVG soportando matrix, translate, scale, rotate, skewX, skewY encadenados.
 */
function parseTransformAttr(transformStr: string | null): [number, number, number, number, number, number] | undefined {
  if (!transformStr) return undefined;
  const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let resultMatrix: [number, number, number, number, number, number] | undefined = undefined;

  while ((match = regex.exec(transformStr)) !== null) {
    const fn = match[1].toLowerCase();
    const args = match[2].trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
    let m: [number, number, number, number, number, number] | undefined;

    if (fn === 'matrix' && args.length >= 6) {
      m = [args[0], args[1], args[2], args[3], args[4], args[5]];
    } else if (fn === 'translate' && args.length >= 1) {
      m = [1, 0, 0, 1, args[0], args[1] ?? 0];
    } else if (fn === 'scale' && args.length >= 1) {
      m = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    } else if (fn === 'rotate' && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (args.length >= 3) {
        const cx = args[1];
        const cy = args[2];
        const t1: [number, number, number, number, number, number] = [1, 0, 0, 1, cx, cy];
        const r: [number, number, number, number, number, number] = [cos, sin, -sin, cos, 0, 0];
        const t2: [number, number, number, number, number, number] = [1, 0, 0, 1, -cx, -cy];
        m = multiplyMatrices(multiplyMatrices(t1, r), t2);
      } else {
        m = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === 'skewx' && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      m = [1, 0, Math.tan(rad), 1, 0, 0];
    } else if (fn === 'skewy' && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      m = [1, Math.tan(rad), 0, 1, 0, 0];
    }

    if (m) {
      resultMatrix = resultMatrix ? multiplyMatrices(resultMatrix, m) : m;
    }
  }

  return resultMatrix;
}

/**
 * Parsea reglas CSS desde bloques <style>
 */
function parseCssRules(cssText: string): CssRule[] {
  const rules: CssRule[] = [];
  const cleanCss = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(cleanCss)) !== null) {
    const rawSelectors = match[1].trim();
    const rawDecls = match[2].trim();
    const styles: Record<string, string> = {};

    const declPairs = rawDecls.split(';');
    for (const pair of declPairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const prop = pair.slice(0, colonIdx).trim().toLowerCase();
        const val = pair.slice(colonIdx + 1).trim();
        if (prop && val) {
          styles[prop] = val;
        }
      }
    }

    const selectors = rawSelectors.split(',');
    for (const sel of selectors) {
      const s = sel.trim();
      if (s) {
        rules.push({ selector: s, styles });
      }
    }
  }

  return rules;
}

/**
 * Parsea una cadena de estilo inline 'prop: val; prop2: val2'
 */
function parseInlineStyle(styleStr: string | null): Record<string, string> {
  if (!styleStr) return {};
  const styles: Record<string, string> = {};
  const pairs = styleStr.split(';');
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const prop = pair.slice(0, colonIdx).trim().toLowerCase();
      const val = pair.slice(colonIdx + 1).trim();
      if (prop && val) {
        styles[prop] = val;
      }
    }
  }
  return styles;
}

/**
 * Evalúa las reglas CSS coincidentes para un elemento
 */
function getMatchedCssStyles(el: SvgElementLike, rules: CssRule[]): Record<string, string> {
  const matched: Record<string, string> = {};
  const elTag = el.tagName.toLowerCase();
  const elId = el.getAttribute('id');
  const classAttr = el.getAttribute('class') || '';
  const elClasses = classAttr.trim().split(/\s+/).filter(Boolean);

  for (const rule of rules) {
    const sel = rule.selector;
    let isMatch = false;

    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (elClasses.includes(cls)) isMatch = true;
    } else if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (elId === id) isMatch = true;
    } else if (sel.toLowerCase() === elTag) {
      isMatch = true;
    } else if (sel === '*') {
      isMatch = true;
    }

    if (isMatch) {
      Object.assign(matched, rule.styles);
    }
  }

  return matched;
}

/**
 * Extrae componentes de color y opacidad de cadenas como rgba() o hex8.
 */
function extractColorAndAlpha(val: string): { color: string; opacity?: number } {
  const trimmed = val.trim();
  let opacity: number | undefined;

  const rgbaMatch = trimmed.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
  if (rgbaMatch) {
    const a = parseFloat(rgbaMatch[1]);
    if (!isNaN(a)) opacity = Math.max(0, Math.min(1, a));
  }
  const hex8Match = trimmed.match(/^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/);
  if (hex8Match) {
    const a = parseInt(hex8Match[2], 16) / 255;
    opacity = Math.max(0, Math.min(1, a));
  }

  const norm = normalizeColor(trimmed) ?? '#000000';
  return { color: norm, opacity };
}

/**
 * Parsea filtros CSS drop-shadow(...) inline o en atributos style.
 */
function parseCssDropShadow(str: string): DropShadow | undefined {
  const match = str.match(/drop-shadow\((.+)\)/i);
  if (!match) return undefined;
  const content = match[1].trim();

  let colorPart = '';
  let rest = content;

  const colorFnMatch = content.match(/(rgba?\([^)]+\)|hsla?\([^)]+\))/i);
  if (colorFnMatch) {
    colorPart = colorFnMatch[1];
    rest = content.replace(colorFnMatch[1], ' ').trim();
  }

  const parts = rest.split(/\s+/).filter(Boolean);
  const numericParts: number[] = [];
  for (const p of parts) {
    if (p.startsWith('#') || !/^[+-]?\d/.test(p)) {
      if (!colorPart) colorPart = p;
    } else {
      const num = parseFloat(p);
      if (!isNaN(num)) numericParts.push(num);
    }
  }

  const offsetX = numericParts[0] ?? 0;
  const offsetY = numericParts[1] ?? 0;
  const blur = numericParts[2] ?? 0;
  const { color, opacity } = extractColorAndAlpha(colorPart || '#000000');

  return {
    color,
    ...(opacity !== undefined ? { opacity } : {}),
    offsetX,
    offsetY,
    blur: Math.max(0, blur),
  };
}

/**
 * Parsea filtros SVG (<filter>) que contengan <feDropShadow>.
 */
function parseSvgFilters(doc: SvgElementLike): Map<string, DropShadow> {
  const filters = new Map<string, DropShadow>();

  function searchElement(el: SvgElementLike) {
    if (el.tagName.toLowerCase() === 'filter') {
      const id = el.getAttribute('id');
      if (id) {
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          if (child.tagName.toLowerCase() === 'fedropshadow') {
            const dx = parseFloat(child.getAttribute('dx') || '0');
            const dy = parseFloat(child.getAttribute('dy') || '0');
            const stdDevAttr = child.getAttribute('stdDeviation') || '0';
            const stdDevParts = stdDevAttr.trim().split(/[\s,]+/).map(parseFloat);
            const stdDev = !isNaN(stdDevParts[0]) ? stdDevParts[0] : 0;
            const blur = Math.max(0, stdDev * 2);
            const floodColor = child.getAttribute('flood-color') || '#000000';
            const floodOpacityAttr = child.getAttribute('flood-opacity');
            const floodOpacity = floodOpacityAttr !== null ? parseFloat(floodOpacityAttr) : undefined;
            const { color, opacity: extractedOpacity } = extractColorAndAlpha(floodColor);
            const finalOpacity = floodOpacity !== undefined && !isNaN(floodOpacity) ? Math.max(0, Math.min(1, floodOpacity)) : extractedOpacity;

            const shadow: DropShadow = {
              color,
              ...(finalOpacity !== undefined ? { opacity: finalOpacity } : {}),
              offsetX: isNaN(dx) ? 0 : dx,
              offsetY: isNaN(dy) ? 0 : dy,
              blur,
            };
            filters.set(id, shadow);
            break;
          }
        }
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      searchElement(el.children[i]);
    }
  }

  searchElement(doc);
  return filters;
}

/**
 * Extrae y resuelve estilos combinados para un elemento siguiendo la especificidad estándar
 * (inline style > atributos de presentación > reglas CSS <style> > contexto padre).
 */
function resolveElementStyles(
  el: SvgElementLike,
  parentContext: SvgContext,
  cssRules: CssRule[],
  gradients: Map<string, SvgRawGradient>,
  filters?: Map<string, DropShadow>
): SvgContext {
  const css = getMatchedCssStyles(el, cssRules);
  const inline = parseInlineStyle(el.getAttribute('style'));
  const context: SvgContext = { ...parentContext };

  const getProp = (propName: string, attrName: string = propName): string | undefined => {
    if (inline[propName] !== undefined) return inline[propName];
    const attr = el.getAttribute(attrName);
    if (attr !== null && attr !== undefined) return attr;
    if (css[propName] !== undefined) return css[propName];
    return undefined;
  };

  // 1. Fill
  const fillVal = getProp('fill');
  if (fillVal !== undefined) {
    if (fillVal === 'none' || fillVal === 'transparent') {
      context.fill = 'none';
    } else if (fillVal === 'currentColor') {
      context.fill = '#000000';
    } else if (fillVal.includes('url(')) {
      const idMatch = fillVal.match(/url\(\s*['"]?#?([^'")\s]+)['"]?\s*\)/i);
      if (idMatch && gradients.has(idMatch[1])) {
        context.fill = gradients.get(idMatch[1]);
      } else {
        context.fill = '#000000';
      }
    } else {
      context.fill = fillVal;
    }
  }

  // 2. Stroke
  const strokeVal = getProp('stroke');
  if (strokeVal !== undefined) {
    if (strokeVal === 'none' || strokeVal === 'transparent') {
      context.stroke = 'none';
    } else if (strokeVal === 'currentColor') {
      context.stroke = '#000000';
    } else if (strokeVal.includes('url(')) {
      const idMatch = strokeVal.match(/url\(\s*['"]?#?([^'")\s]+)['"]?\s*\)/i);
      if (idMatch && gradients.has(idMatch[1])) {
        context.stroke = gradients.get(idMatch[1]);
      } else {
        context.stroke = '#000000';
      }
    } else {
      context.stroke = strokeVal;
    }
  }

  // 3. Stroke Width
  const swVal = getProp('stroke-width');
  if (swVal !== undefined) {
    const sw = parseFloat(swVal);
    if (!isNaN(sw)) context.strokeWidth = sw;
  }

  // 4. Stroke Linecap
  const slcVal = getProp('stroke-linecap');
  if (slcVal === 'butt' || slcVal === 'round' || slcVal === 'square') {
    context.strokeLineCap = slcVal;
  }

  // 5. Stroke Linejoin
  const sljVal = getProp('stroke-linejoin');
  if (sljVal === 'miter' || sljVal === 'round' || sljVal === 'bevel') {
    context.strokeLineJoin = sljVal;
  }

  // 6. Stroke Dasharray
  const sdaVal = getProp('stroke-dasharray');
  if (sdaVal !== undefined && sdaVal !== 'none') {
    const parts = sdaVal.trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
    if (parts.length > 0) {
      context.strokeDashArray = parts;
    }
  }

  // 7. Opacity
  const opVal = getProp('opacity');
  if (opVal !== undefined) {
    const op = parseFloat(opVal);
    if (!isNaN(op)) {
      context.opacity = (context.opacity ?? 1) * op;
    }
  }

  // 8. Transform
  const transformAttr = el.getAttribute('transform');
  const localMatrix = parseTransformAttr(transformAttr);
  if (localMatrix) {
    context.transformMatrix = context.transformMatrix
      ? multiplyMatrices(context.transformMatrix, localMatrix)
      : localMatrix;
  }

  // 9. Fill Rule
  const frVal = getProp('fill-rule');
  if (frVal === 'evenodd' || frVal === 'nonzero') {
    context.fillRule = frVal;
  }

  // 10. Blend Mode
  const bmVal = getProp('mix-blend-mode');
  if (bmVal !== undefined) {
    const validModes = new Set([
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
    ]);
    const lower = bmVal.trim().toLowerCase();
    if (validModes.has(lower)) {
      context.blendMode = lower as BlendMode;
    }
  }

  // 11. Drop Shadow / Filter
  const filterVal = getProp('filter');
  if (filterVal !== undefined) {
    if (filterVal.includes('url(')) {
      const idMatch = filterVal.match(/url\(\s*['"]?#?([^'")\s]+)['"]?\s*\)/i);
      if (idMatch && filters && filters.has(idMatch[1])) {
        context.dropShadow = filters.get(idMatch[1]);
      }
    } else if (filterVal.includes('drop-shadow(')) {
      const parsedShadow = parseCssDropShadow(filterVal);
      if (parsedShadow) {
        context.dropShadow = parsedShadow;
      }
    }
  }

  return context;
}

/**
 * Parsea degradados lineales y radiales definidos en SVG (<defs> o documento).
 * Soporta herencia via href / xlink:href, gradientUnits, gradientTransform y colores CSS.
 */
function parseSvgGradients(
  doc: SvgElementLike,
  cssRules: CssRule[] = [],
  rootMatrix?: [number, number, number, number, number, number]
): Map<string, SvgRawGradient> {
  function parseStopColorAndOpacity(el: SvgElementLike): { color: string; opacity: number } {
    let color: string | undefined;
    let opacity = 1;

    // 1. Reglas CSS desde <style>
    const css = getMatchedCssStyles(el, cssRules);
    if (css['stop-color']) color = css['stop-color'];
    if (css['stop-opacity']) {
      const o = parseFloat(css['stop-opacity']);
      if (!isNaN(o)) opacity = o;
    }

    // 2. Atributos de presentación
    const attrColor = el.getAttribute('stop-color');
    if (attrColor) color = attrColor;
    const attrOp = el.getAttribute('stop-opacity');
    if (attrOp) {
      const o = parseFloat(attrOp);
      if (!isNaN(o)) opacity = o;
    }

    // 3. Estilos inline
    const style = parseInlineStyle(el.getAttribute('style'));
    if (style['stop-color']) color = style['stop-color'];
    if (style['stop-opacity']) {
      const o = parseFloat(style['stop-opacity']);
      if (!isNaN(o)) opacity = o;
    }

    if (color === 'currentColor') {
      color = '#000000';
    }

    const norm = normalizeColor(color);
    return { color: norm ?? color ?? '#000000', opacity };
  }

  function parseStops(parent: SvgElementLike): GradientStop[] {
    const stops: GradientStop[] = [];
    const stopEls = parent.querySelectorAll ? parent.querySelectorAll('stop') : [];
    for (let idx = 0; idx < stopEls.length; idx++) {
      const stopEl = stopEls[idx];
      let offset = 0;
      const offsetAttr = stopEl.getAttribute('offset');
      if (offsetAttr !== null && offsetAttr !== undefined) {
        const trimmed = offsetAttr.trim();
        if (trimmed.endsWith('%')) {
          offset = parseFloat(trimmed) / 100;
        } else {
          offset = parseFloat(trimmed);
        }
      } else {
        offset = idx === 0 ? 0 : stops[idx - 1]?.offset ?? 0;
      }
      const { color, opacity } = parseStopColorAndOpacity(stopEl);
      stops.push({
        id: `stop-${idx + 1}`,
        offset: Math.max(0, Math.min(1, isNaN(offset) ? 0 : offset)),
        color,
        opacity,
      });
    }
    return stops;
  }

  function parseCoord(val: string | null | undefined): number | undefined {
    if (val === null || val === undefined) return undefined;
    const trimmed = val.trim();
    if (trimmed === '') return undefined;
    if (trimmed.endsWith('%')) return parseFloat(trimmed) / 100;
    const n = parseFloat(trimmed);
    return isNaN(n) ? undefined : n;
  }

  const rawMap = new Map<string, SvgRawGradient>();

  const linearEls = doc.querySelectorAll ? doc.querySelectorAll('linearGradient') : [];
  for (const lg of linearEls) {
    const id = lg.getAttribute('id');
    if (!id) continue;
    const href = (lg.getAttribute('href') || lg.getAttribute('xlink:href') || '').replace(/^#/, '');
    const gUnits = lg.getAttribute('gradientUnits');
    const gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox' =
      gUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';

    const tAttr = lg.getAttribute('gradientTransform') || lg.getAttribute('transform');
    const transformMatrix = parseTransformAttr(tAttr);

    const x1 = parseCoord(lg.getAttribute('x1'));
    const y1 = parseCoord(lg.getAttribute('y1'));
    const x2 = parseCoord(lg.getAttribute('x2'));
    const y2 = parseCoord(lg.getAttribute('y2'));

    rawMap.set(id, {
      id,
      type: 'linear',
      gradientUnits,
      x1,
      y1,
      x2,
      y2,
      transformMatrix,
      stops: parseStops(lg),
      href: href || undefined,
    });
  }

  const radialEls = doc.querySelectorAll ? doc.querySelectorAll('radialGradient') : [];
  for (const rg of radialEls) {
    const id = rg.getAttribute('id');
    if (!id) continue;
    const href = (rg.getAttribute('href') || rg.getAttribute('xlink:href') || '').replace(/^#/, '');
    const gUnits = rg.getAttribute('gradientUnits');
    const gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox' =
      gUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';

    const tAttr = rg.getAttribute('gradientTransform') || rg.getAttribute('transform');
    const transformMatrix = parseTransformAttr(tAttr);

    const cx = parseCoord(rg.getAttribute('cx'));
    const cy = parseCoord(rg.getAttribute('cy'));
    const r = parseCoord(rg.getAttribute('r'));
    const fx = parseCoord(rg.getAttribute('fx'));
    const fy = parseCoord(rg.getAttribute('fy'));

    rawMap.set(id, {
      id,
      type: 'radial',
      gradientUnits,
      cx,
      cy,
      r,
      fx,
      fy,
      transformMatrix,
      stops: parseStops(rg),
      href: href || undefined,
    });
  }

  const resolved = new Map<string, SvgRawGradient>();
  function resolveGradient(id: string, visited: Set<string> = new Set()): SvgRawGradient | undefined {
    if (visited.has(id)) return undefined;
    if (resolved.has(id)) return resolved.get(id);
    const raw = rawMap.get(id);
    if (!raw) return undefined;
    visited.add(id);

    let parent: SvgRawGradient | undefined;
    if (raw.href) {
      parent = resolveGradient(raw.href, visited);
    }

    let finalT = raw.transformMatrix ?? parent?.transformMatrix;
    const gUnits = raw.gradientUnits ?? parent?.gradientUnits ?? 'objectBoundingBox';
    if (gUnits === 'userSpaceOnUse' && rootMatrix) {
      finalT = finalT ? multiplyMatrices(rootMatrix, finalT) : rootMatrix;
    }

    const merged: SvgRawGradient = {
      id: raw.id,
      type: raw.type,
      gradientUnits: gUnits,
      x1: raw.x1 ?? parent?.x1,
      y1: raw.y1 ?? parent?.y1,
      x2: raw.x2 ?? parent?.x2,
      y2: raw.y2 ?? parent?.y2,
      cx: raw.cx ?? parent?.cx,
      cy: raw.cy ?? parent?.cy,
      r: raw.r ?? parent?.r,
      fx: raw.fx ?? parent?.fx,
      fy: raw.fy ?? parent?.fy,
      transformMatrix: finalT,
      stops: raw.stops.length > 0 ? raw.stops : (parent?.stops && parent.stops.length > 0 ? parent.stops : []),
    };

    if (merged.stops.length === 0) {
      merged.stops = [
        { id: 'stop-1', offset: 0, color: '#000000', opacity: 1 },
        { id: 'stop-2', offset: 1, color: '#ffffff', opacity: 1 },
      ];
    }

    resolved.set(id, merged);
    return merged;
  }

  for (const id of rawMap.keys()) {
    resolveGradient(id);
  }

  return resolved;
}

/**
 * Normaliza un degradado SVG (SvgRawGradient) a las coordenadas relativas [0, 1] de la caja base de la figura.
 */
function materializeGradient(
  paint: FillType | SvgRawGradient | undefined,
  shapeAABB: AABB
): FillType | undefined {
  if (!paint || typeof paint === 'string') return paint;
  if ('stops' in paint && !('gradientUnits' in paint)) {
    return paint;
  }
  const raw = paint as SvgRawGradient;
  const w = Math.max(1e-4, shapeAABB.width);
  const h = Math.max(1e-4, shapeAABB.height);

  if (raw.type === 'linear') {
    let p1 = { x: raw.x1 ?? 0, y: raw.y1 ?? 0 };
    let p2 = { x: raw.x2 ?? 1, y: raw.y2 ?? 0 };

    if (raw.gradientUnits === 'userSpaceOnUse' || p1.x > 1 || p1.y > 1 || p2.x > 1 || p2.y > 1) {
      if (raw.transformMatrix) {
        p1 = applyTransform(p1, raw.transformMatrix);
        p2 = applyTransform(p2, raw.transformMatrix);
      }
      return {
        type: 'linear',
        x1: (p1.x - shapeAABB.minX) / w,
        y1: (p1.y - shapeAABB.minY) / h,
        x2: (p2.x - shapeAABB.minX) / w,
        y2: (p2.y - shapeAABB.minY) / h,
        stops: raw.stops,
      };
    } else {
      if (raw.transformMatrix) {
        p1 = applyTransform(p1, raw.transformMatrix);
        p2 = applyTransform(p2, raw.transformMatrix);
      }
      return {
        type: 'linear',
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        stops: raw.stops,
      };
    }
  } else {
    // radial
    let center = { x: raw.cx ?? 0.5, y: raw.cy ?? 0.5 };
    let radius = raw.r ?? 0.5;
    let focus = raw.fx !== undefined || raw.fy !== undefined
      ? { x: raw.fx ?? center.x, y: raw.fy ?? center.y }
      : undefined;

    if (raw.gradientUnits === 'userSpaceOnUse' || center.x > 1 || center.y > 1 || radius > 1) {
      if (raw.transformMatrix) {
        center = applyTransform(center, raw.transformMatrix);
        if (focus) focus = applyTransform(focus, raw.transformMatrix);
        const { scaleX, scaleY } = decomposeMatrix(raw.transformMatrix);
        radius *= Math.max(scaleX, scaleY);
      }
      const maxDim = Math.max(1e-4, Math.max(w, h));
      return {
        type: 'radial',
        cx: (center.x - shapeAABB.minX) / w,
        cy: (center.y - shapeAABB.minY) / h,
        r: radius / maxDim,
        ...(focus
          ? {
              fx: (focus.x - shapeAABB.minX) / w,
              fy: (focus.y - shapeAABB.minY) / h,
            }
          : {}),
        stops: raw.stops,
      };
    } else {
      if (raw.transformMatrix) {
        center = applyTransform(center, raw.transformMatrix);
        if (focus) focus = applyTransform(focus, raw.transformMatrix);
        const { scaleX, scaleY } = decomposeMatrix(raw.transformMatrix);
        radius *= Math.max(scaleX, scaleY);
      }
      return {
        type: 'radial',
        cx: center.x,
        cy: center.y,
        r: radius,
        ...(focus ? { fx: focus.x, fy: focus.y } : {}),
        stops: raw.stops,
      };
    }
  }
}

/**
 * Parsea un nodo del DOM SVG recursivamente y devuelve los nodos LayerChildNode correspondientes.
 */
function parseSvgElement(
  el: SvgElementLike,
  parentContext: SvgContext,
  cssRules: CssRule[],
  gradients: Map<string, SvgRawGradient>,
  filters?: Map<string, DropShadow>
): LayerChildNode | null {
  const tagName = el.tagName.toLowerCase();

  // Ignorar etiquetas de metadatos o no gráficas
  if (
    tagName === 'defs' ||
    tagName === 'style' ||
    tagName === 'title' ||
    tagName === 'desc' ||
    tagName === 'metadata' ||
    tagName === 'clippath'
  ) {
    return null;
  }

  // Comprobar visibilidad
  const inline = parseInlineStyle(el.getAttribute('style'));
  if (inline['display'] === 'none' || inline['visibility'] === 'hidden') {
    return null;
  }
  if (el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden') {
    return null;
  }

  // Resolver estilos heredados y combinados
  const context = resolveElementStyles(el, parentContext, cssRules, gradients, filters);
  const nameAttr = el.getAttribute('id') || el.getAttribute('data-name') || tagName;

  // 1. Grupos (<g>)
  if (tagName === 'g') {
    const children: LayerChildNode[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const childNode = parseSvgElement(el.children[i], context, cssRules, gradients, filters);
      if (childNode) children.push(childNode);
    }
    if (children.length === 0) return null;

    const clipPathAttr = el.getAttribute('clip-path') || el.getAttribute('clipPath') || inline['clip-path'];
    let isClipMask = false;
    let clipChildId: string | undefined;

    if (clipPathAttr && clipPathAttr.includes('url(#')) {
      const match = clipPathAttr.match(/url\(#([^)]+)\)/);
      if (match && match[1]) {
        const clipId = match[1];
        let clipEl = el.ownerDocument?.getElementById ? el.ownerDocument.getElementById(clipId) : null;
        if (!clipEl && (el.ownerDocument as any)?.querySelector) {
          clipEl = (el.ownerDocument as any).querySelector(`#${clipId}`);
        }
        if (clipEl) {
          for (let c = 0; c < clipEl.children.length; c++) {
            const clipShape = parseSvgElement(clipEl.children[c], parentContext, cssRules, gradients, filters);
            if (clipShape && isShape(clipShape)) {
              isClipMask = true;
              clipChildId = clipShape.id;
              children.push(clipShape);
              break;
            }
          }
        }
      }
    }

    const group: Group = {
      id: nextId('group'),
      type: 'group',
      name: nameAttr,
      children,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
      ...(isClipMask ? { isClipMask: true, clipChildId } : {}),
    };
    return group;
  }

  // 2. Uso de símbolos (<use>)
  if (tagName === 'use') {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href');
    if (!href || !href.startsWith('#')) return null;
    const targetId = href.slice(1);
    let targetEl: SvgElementLike | null = null;
    if (el.ownerDocument?.getElementById) {
      targetEl = el.ownerDocument.getElementById(targetId);
    }
    if (!targetEl && (el.ownerDocument as any)?.querySelector) {
      targetEl = (el.ownerDocument as any).querySelector(`#${targetId}`);
    }
    if (!targetEl) return null;

    const useX = parseFloat(el.getAttribute('x') || '0');
    const useY = parseFloat(el.getAttribute('y') || '0');
    let useContext = { ...context };
    if (useX !== 0 || useY !== 0) {
      const tMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, useX, useY];
      useContext.transformMatrix = useContext.transformMatrix
        ? multiplyMatrices(useContext.transformMatrix, tMatrix)
        : tMatrix;
    }

    return parseSvgElement(targetEl, useContext, cssRules, gradients, filters);
  }

  // 3. Rectángulos (<rect>)
  if (tagName === 'rect') {
    const rawX = parseFloat(el.getAttribute('x') || '0');
    const rawY = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    if (w <= 0 || h <= 0) return null;

    const rx = parseFloat(el.getAttribute('rx') || el.getAttribute('ry') || '0');
    const { scaleX, scaleY, rotation } = decomposeMatrix(context.transformMatrix);
    const transformed = applyTransform({ x: rawX, y: rawY }, context.transformMatrix);
    const rectW = w * scaleX;
    const rectH = h * scaleY;
    const rectAABB: AABB = {
      minX: transformed.x,
      minY: transformed.y,
      maxX: transformed.x + rectW,
      maxY: transformed.y + rectH,
      width: rectW,
      height: rectH,
    };

    const rect: Rectangle = {
      id: nextId('rect'),
      type: 'rectangle',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      width: rectW,
      height: rectH,
      cornerRadius: rx > 0 ? rx * Math.min(scaleX, scaleY) : undefined,
      fill: materializeGradient(context.fill, rectAABB) ?? '#000000',
      stroke: materializeGradient(context.stroke, rectAABB) ?? 'none',
      strokeWidth: context.strokeWidth ? context.strokeWidth * Math.min(scaleX, scaleY) : 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      rotation: rotation !== 0 ? rotation : undefined,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return rect;
  }

  // 4. Círculos y Elipses (<circle>, <ellipse>)
  if (tagName === 'circle' || tagName === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = tagName === 'circle' ? parseFloat(el.getAttribute('r') || '0') : parseFloat(el.getAttribute('rx') || '0');
    const ry = tagName === 'circle' ? parseFloat(el.getAttribute('r') || '0') : parseFloat(el.getAttribute('ry') || '0');
    if (rx <= 0 || ry <= 0) return null;

    const { scaleX, scaleY, rotation } = decomposeMatrix(context.transformMatrix);
    const transformed = applyTransform({ x: cx, y: cy }, context.transformMatrix);
    const radX = rx * scaleX;
    const radY = ry * scaleY;
    const ellipseAABB: AABB = {
      minX: transformed.x - radX,
      minY: transformed.y - radY,
      maxX: transformed.x + radX,
      maxY: transformed.y + radY,
      width: radX * 2,
      height: radY * 2,
    };

    const ellipse: Ellipse = {
      id: nextId('ellipse'),
      type: 'ellipse',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      radiusX: radX,
      radiusY: radY,
      fill: materializeGradient(context.fill, ellipseAABB) ?? '#000000',
      stroke: materializeGradient(context.stroke, ellipseAABB) ?? 'none',
      strokeWidth: context.strokeWidth ? context.strokeWidth * Math.min(scaleX, scaleY) : 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      rotation: rotation !== 0 ? rotation : undefined,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return ellipse;
  }

  // 5. Trazados (<path>)
  if (tagName === 'path') {
    const d = el.getAttribute('d');
    if (!d) return null;

    const { points: rawPoints, closed } = parseSvgPathD(d);
    if (rawPoints.length === 0) return null;

    // Aplicar transformación completa a puntos de ancla y manejadores
    const points: PathPoint[] = rawPoints.map((pt) => {
      const transformedPt = applyTransform({ x: pt.x, y: pt.y }, context.transformMatrix);
      const transformedIn = pt.handleIn ? applyTransform(pt.handleIn, context.transformMatrix) : undefined;
      const transformedOut = pt.handleOut ? applyTransform(pt.handleOut, context.transformMatrix) : undefined;
      return {
        x: transformedPt.x,
        y: transformedPt.y,
        ...(transformedIn ? { handleIn: transformedIn } : {}),
        ...(transformedOut ? { handleOut: transformedOut } : {}),
        pointType: pt.pointType,
        ...(pt.moveTo ? { moveTo: true } : {}),
        ...(pt.closeSubpath ? { closeSubpath: true } : {}),
      };
    });

    const pathAABB = getPathBaseAABB({ points } as unknown as Path);
    const resolvedFill = materializeGradient(context.fill, pathAABB);
    const resolvedStroke = materializeGradient(context.stroke, pathAABB);

    let finalFill = resolvedFill;
    let finalStroke = resolvedStroke;

    // Si el trazado es abierto y tiene trazo definido, pero no fill explícito en el elemento, fill es 'none'
    if (finalFill === undefined) {
      if (!closed && finalStroke && finalStroke !== 'none') {
        finalFill = 'none';
      } else {
        finalFill = '#000000';
      }
    }

    if (finalStroke === undefined) {
      finalStroke = 'none';
    }

    const pathNode: Path = {
      id: nextId('path'),
      type: 'path',
      name: nameAttr,
      x: points[0].x,
      y: points[0].y,
      points,
      closed,
      fill: finalFill,
      stroke: finalStroke,
      strokeWidth: context.strokeWidth ?? 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
      fillRule: context.fillRule,
    };
    return pathNode;
  }

  // 6. Líneas (<line>)
  if (tagName === 'line') {
    const x1 = parseFloat(el.getAttribute('x1') || '0');
    const y1 = parseFloat(el.getAttribute('y1') || '0');
    const x2 = parseFloat(el.getAttribute('x2') || '0');
    const y2 = parseFloat(el.getAttribute('y2') || '0');

    const pt1 = applyTransform({ x: x1, y: y1 }, context.transformMatrix);
    const pt2 = applyTransform({ x: x2, y: y2 }, context.transformMatrix);
    const linePoints: PathPoint[] = [
      { x: pt1.x, y: pt1.y, pointType: 'corner' },
      { x: pt2.x, y: pt2.y, pointType: 'corner' },
    ];
    const lineAABB = getPathBaseAABB({ points: linePoints } as unknown as Path);
    const resolvedStroke = materializeGradient(context.stroke, lineAABB);

    const path: Path = {
      id: nextId('line'),
      type: 'path',
      name: nameAttr,
      x: pt1.x,
      y: pt1.y,
      points: linePoints,
      closed: false,
      fill: 'none',
      stroke: resolvedStroke ?? '#000000',
      strokeWidth: context.strokeWidth ?? 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return path;
  }

  // 7. Polilíneas y Polígonos (<polyline>, <polygon>)
  if (tagName === 'polyline' || tagName === 'polygon') {
    const pointsAttr = el.getAttribute('points') || '';
    const coords = pointsAttr
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => !isNaN(n));

    if (coords.length < 4) return null;

    const points: PathPoint[] = [];
    for (let c = 0; c < coords.length; c += 2) {
      const pt = applyTransform({ x: coords[c], y: coords[c + 1] }, context.transformMatrix);
      points.push({ x: pt.x, y: pt.y, pointType: 'corner' });
    }

    const polyAABB = getPathBaseAABB({ points } as unknown as Path);
    const isPolygon = tagName === 'polygon';
    const defaultFill = isPolygon ? '#000000' : 'none';
    const resolvedFill = materializeGradient(context.fill, polyAABB);
    const resolvedStroke = materializeGradient(context.stroke, polyAABB);

    const path: Path = {
      id: nextId(tagName),
      type: 'path',
      name: nameAttr,
      x: points[0].x,
      y: points[0].y,
      points,
      closed: isPolygon,
      fill: resolvedFill ?? defaultFill,
      stroke: resolvedStroke ?? (isPolygon ? 'none' : '#000000'),
      strokeWidth: context.strokeWidth ?? 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
      fillRule: context.fillRule,
    };
    return path;
  }

  // 8. Texto (<text>)
  if (tagName === 'text') {
    const rawX = parseFloat(el.getAttribute('x') || '0');
    const rawY = parseFloat(el.getAttribute('y') || '0');
    const content = el.textContent?.trim() || '';
    if (!content) return null;

    const transformed = applyTransform({ x: rawX, y: rawY }, context.transformMatrix);
    const fontSize = parseFloat(el.getAttribute('font-size') || '16') || 16;
    const fontFamily = el.getAttribute('font-family') || 'sans-serif';

    const textW = Math.max(10, content.length * fontSize * 0.6);
    const textH = Math.max(10, fontSize * 1.2);
    const textAABB: AABB = {
      minX: transformed.x,
      minY: transformed.y - fontSize,
      maxX: transformed.x + textW,
      maxY: transformed.y - fontSize + textH,
      width: textW,
      height: textH,
    };

    const textNode: Text = {
      id: nextId('text'),
      type: 'text',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      text: content,
      fontSize,
      fontFamily,
      fill: (materializeGradient(context.fill, textAABB) as any) ?? '#000000',
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return textNode;
  }

  return null;
}

/**
 * Parser elemental de XML en estructura de árbol SvgElementLike para entornos sin DOMParser nativo.
 */
function parseXmlToElement(xmlText: string): SvgElementLike | null {
  const clean = xmlText
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const idMap = new Map<string, SvgElementLike>();

  const docRef = {
    getElementById(id: string) {
      return idMap.get(id) ?? null;
    },
    querySelector(sel: string) {
      if (sel.startsWith('#')) {
        return idMap.get(sel.slice(1)) ?? null;
      }
      return null;
    },
  };

  function makeElement(tagName: string, attrStr: string): SvgElementLike {
    const attributes: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRegex.exec(attrStr)) !== null) {
      const key = aMatch[1].toLowerCase();
      const val = aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '';
      attributes[key] = val;
    }

    const children: SvgElementLike[] = [];
    const el: SvgElementLike = {
      tagName: tagName.toLowerCase(),
      children,
      textContent: '',
      ownerDocument: docRef,
      getAttribute(name: string) {
        return attributes[name.toLowerCase()] ?? null;
      },
      hasAttribute(name: string) {
        return attributes[name.toLowerCase()] !== undefined;
      },
      querySelectorAll(selector: string) {
        const results: SvgElementLike[] = [];
        const sel = selector.toLowerCase();
        function search(curr: SvgElementLike) {
          for (let c = 0; c < curr.children.length; c++) {
            const ch = curr.children[c];
            if (ch.tagName === sel) results.push(ch);
            search(ch);
          }
        }
        search(el);
        return results;
      },
      querySelector(selector: string) {
        const sel = selector.toLowerCase();
        function find(curr: SvgElementLike): SvgElementLike | null {
          for (let c = 0; c < curr.children.length; c++) {
            const ch = curr.children[c];
            if (ch.tagName === sel) return ch;
            const nested = find(ch);
            if (nested) return nested;
          }
          return null;
        }
        return find(el);
      },
    };

    if (attributes['id']) {
      idMap.set(attributes['id'], el);
    }

    return el;
  }

  const root = makeElement('__root__', '');
  const stack: SvgElementLike[] = [root];

  const tagRegex = /<(\/)?([a-zA-Z0-9_:-]+)((?:\s+[^=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(clean)) !== null) {
    const isClose = !!match[1];
    const tagName = match[2];
    const attrStr = match[3];
    const isSelfClosing = !!match[4];
    const textContent = match[5];

    if (textContent) {
      if (stack.length > 0) {
        const curr = stack[stack.length - 1];
        (curr as { textContent: string }).textContent += textContent;
      }
      continue;
    }

    if (!tagName) continue;

    if (isClose) {
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === tagName.toLowerCase()) {
          stack.splice(s);
          break;
        }
      }
    } else {
      const el = makeElement(tagName, attrStr || '');
      const parent = stack[stack.length - 1];
      (parent.children as SvgElementLike[]).push(el);
      if (!isSelfClosing && tagName.toLowerCase() !== 'br' && tagName.toLowerCase() !== 'hr') {
        stack.push(el);
      }
    }
  }

  const svgEl = root.querySelector ? root.querySelector('svg') : null;
  if (svgEl) {
    svgEl.ownerDocument = {
      getElementById(id: string) {
        return idMap.get(id) ?? null;
      },
    };
  }
  return svgEl;
}

/**
 * Parsea una cadena XML SVG completa y genera figuras vectoriales nativas para Vectedit.
 */
export function parseSvgString(svgText: string): SvgImportResult {
  if (!svgText || typeof svgText !== 'string' || !svgText.trim()) {
    return { success: false, shapes: [], width: 0, height: 0, error: 'Contenido SVG vacío' };
  }

  let svgEl: SvgElementLike | null = null;

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        return { success: false, shapes: [], width: 0, height: 0, error: parserError.textContent || 'Error de parseo XML' };
      }
      svgEl = doc.querySelector('svg') as unknown as SvgElementLike;
    } catch {
      svgEl = null;
    }
  }

  if (!svgEl) {
    svgEl = parseXmlToElement(svgText);
  }

  if (!svgEl) {
    return { success: false, shapes: [], width: 0, height: 0, error: 'No se encontró el elemento <svg> raíz' };
  }

  // 1. Parsear reglas de estilos en bloques <style>
  const cssRules: CssRule[] = [];
  const styleElements = svgEl.querySelectorAll ? svgEl.querySelectorAll('style') : [];
  for (const styleEl of styleElements) {
    if (styleEl.textContent) {
      cssRules.push(...parseCssRules(styleEl.textContent));
    }
  }

  // 2. Dimensiones y viewBox
  let width = parseFloat(svgEl.getAttribute('width') || '0');
  let height = parseFloat(svgEl.getAttribute('height') || '0');
  const viewBoxAttr = svgEl.getAttribute('viewBox');

  let vbMinX = 0;
  let vbMinY = 0;
  let vbWidth = 0;
  let vbHeight = 0;
  let hasViewBox = false;

  if (viewBoxAttr) {
    const vbParts = viewBoxAttr.trim().split(/[\s,]+/).map(parseFloat);
    if (vbParts.length === 4 && !isNaN(vbParts[0]) && !isNaN(vbParts[1]) && vbParts[2] > 0 && vbParts[3] > 0) {
      vbMinX = vbParts[0];
      vbMinY = vbParts[1];
      vbWidth = vbParts[2];
      vbHeight = vbParts[3];
      hasViewBox = true;
      if (!width || width <= 0) width = vbWidth;
      if (!height || height <= 0) height = vbHeight;
    }
  }

  if (!width || width <= 0) width = 800;
  if (!height || height <= 0) height = 600;

  // Transformación raíz derivada del viewBox
  let rootMatrix: [number, number, number, number, number, number] | undefined = undefined;
  if (hasViewBox && (vbWidth !== width || vbHeight !== height || vbMinX !== 0 || vbMinY !== 0)) {
    const scaleX = width / vbWidth;
    const scaleY = height / vbHeight;
    const scale = Math.min(scaleX, scaleY);
    const tx = -vbMinX * scale + (width - vbWidth * scale) / 2;
    const ty = -vbMinY * scale + (height - vbHeight * scale) / 2;
    rootMatrix = [scale, 0, 0, scale, tx, ty];
  }

  // 3. Parsear degradados y filtros (con cssRules y rootMatrix)
  const gradients = parseSvgGradients(svgEl, cssRules, rootMatrix);
  const filters = parseSvgFilters(svgEl);

  // 4. Contexto base inicializado desde el propio <svg>
  let baseContext: SvgContext = {};
  if (rootMatrix) {
    baseContext.transformMatrix = rootMatrix;
  }
  baseContext = resolveElementStyles(svgEl, baseContext, cssRules, gradients, filters);

  const shapes: LayerChildNode[] = [];
  for (let i = 0; i < svgEl.children.length; i++) {
    const child = svgEl.children[i];
    const parsed = parseSvgElement(child, baseContext, cssRules, gradients, filters);
    if (parsed) {
      shapes.push(parsed);
    }
  }

  return {
    success: shapes.length > 0,
    shapes,
    width,
    height,
    error: shapes.length === 0 ? 'No se encontraron figuras vectoriales válidas en el SVG' : undefined,
  };
}
