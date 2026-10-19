import type {
  AABB,
  Gradient,
  GradientStop,
  LinearGradient,
  RadialGradient,
  Shape,
  Vector2D,
} from '../types/scene-graph.ts';
import { isLinearGradient } from '../types/scene-graph.ts';
import { getPathBaseAABB, getTextBaseAABB } from './geometry.ts';
import { normalizeColor } from './color.ts';

/**
 * Crea un degradado lineal por defecto (de startColor a endColor de izquierda a derecha)
 */
export function createDefaultLinearGradient(
  startColor: string = '#3b82f6',
  endColor: string = '#8b5cf6'
): LinearGradient {
  return {
    type: 'linear',
    x1: 0,
    y1: 0.5,
    x2: 1,
    y2: 0.5,
    stops: [
      { id: 'stop-1', offset: 0, color: startColor, opacity: 1 },
      { id: 'stop-2', offset: 1, color: endColor, opacity: 1 },
    ],
  };
}

/**
 * Crea un degradado radial por defecto (centrado de startColor a endColor)
 */
export function createDefaultRadialGradient(
  startColor: string = '#ffffff',
  endColor: string = '#3b82f6'
): RadialGradient {
  return {
    type: 'radial',
    cx: 0.5,
    cy: 0.5,
    r: 0.5,
    stops: [
      { id: 'stop-1', offset: 0, color: startColor, opacity: 1 },
      { id: 'stop-2', offset: 1, color: endColor, opacity: 1 },
    ],
  };
}

/**
 * Obtiene la caja delimitadora (AABB) base no rotada de cualquier figura
 */
export function getShapeBaseAABB(shape: Shape, ctx?: CanvasRenderingContext2D | null): AABB {
  if (shape.type === 'rectangle' || shape.type === 'image') {
    return {
      minX: shape.x,
      minY: shape.y,
      maxX: shape.x + shape.width,
      maxY: shape.y + shape.height,
      width: shape.width,
      height: shape.height,
    };
  } else if (shape.type === 'ellipse') {
    return {
      minX: shape.x - shape.radiusX,
      minY: shape.y - shape.radiusY,
      maxX: shape.x + shape.radiusX,
      maxY: shape.y + shape.radiusY,
      width: shape.radiusX * 2,
      height: shape.radiusY * 2,
    };
  } else if (shape.type === 'path') {
    return getPathBaseAABB(shape);
  } else {
    return getTextBaseAABB(shape, ctx);
  }
}

/**
 * Obtiene el centroide de rotación de la figura
 */
export function getShapeCentroid(shape: Shape, _ctx?: CanvasRenderingContext2D | null): Vector2D {
  if (shape.type === 'rectangle' || shape.type === 'image') {
    return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  } else if (shape.type === 'ellipse') {
    return { x: shape.x, y: shape.y };
  } else if (shape.type === 'path') {
    const aabb = getPathBaseAABB(shape);
    return { x: (aabb.minX + aabb.maxX) / 2, y: (aabb.minY + aabb.maxY) / 2 };
  } else {
    // En renderText, la rotación se aplica respecto a (text.x, text.y)
    return { x: shape.x, y: shape.y };
  }
}

/**
 * Convierte coordenadas normalizadas [0, 1] de la caja base a coordenadas de pantalla/mundo (respetando rotación)
 */
export function gradientToWorldPoint(
  shape: Shape,
  u: number,
  v: number,
  ctx?: CanvasRenderingContext2D | null
): Vector2D {
  const baseAABB = getShapeBaseAABB(shape, ctx);
  const localX = baseAABB.minX + u * baseAABB.width;
  const localY = baseAABB.minY + v * baseAABB.height;

  const rotation = shape.rotation ?? 0;
  if (!rotation) {
    return { x: localX, y: localY };
  }

  const centroid = getShapeCentroid(shape, ctx);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const dx = localX - centroid.x;
  const dy = localY - centroid.y;

  return {
    x: centroid.x + dx * cos - dy * sin,
    y: centroid.y + dx * sin + dy * cos,
  };
}

/**
 * Proyecta un punto en coordenadas del mundo hacia las coordenadas normalizadas [0, 1] de la caja base de la figura
 */
export function worldToGradientCoord(
  shape: Shape,
  worldX: number,
  worldY: number,
  ctx?: CanvasRenderingContext2D | null
): Vector2D {
  const baseAABB = getShapeBaseAABB(shape, ctx);
  const rotation = shape.rotation ?? 0;
  let localX = worldX;
  let localY = worldY;

  if (rotation) {
    const centroid = getShapeCentroid(shape, ctx);
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = worldX - centroid.x;
    const dy = worldY - centroid.y;

    localX = centroid.x + dx * cos + dy * sin;
    localY = centroid.y - dx * sin + dy * cos;
  }

  const w = Math.max(1e-6, baseAABB.width);
  const h = Math.max(1e-6, baseAABB.height);

  return {
    x: (localX - baseAABB.minX) / w,
    y: (localY - baseAABB.minY) / h,
  };
}

/**
 * Proyecta ortogonalmente un punto sobre un segmento de línea (p1 -> p2) y retorna el factor normalizado t [0, 1]
 */
export function projectPointOnSegment(point: Vector2D, p1: Vector2D, p2: Vector2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-8) {
    return 0;
  }
  const t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
  return Math.max(0, Math.min(1, t));
}

/**
 * Convierte color y opacidad en cadena 'rgba(r, g, b, a)' o hex si opacidad es 1
 */
export function colorWithOpacity(color: string, opacity: number = 1): string {
  const clampedOp = Math.max(0, Math.min(1, opacity));
  const hex = normalizeColor(color);
  if (!hex) {
    if (color.startsWith('rgb')) {
      return color;
    }
    return clampedOp >= 1 ? '#000000' : `rgba(0, 0, 0, ${clampedOp})`;
  }
  if (clampedOp >= 1) {
    return hex;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampedOp})`;
}

/**
 * Interpola linealmente el color en un offset dado [0, 1] entre las paradas (stops) existentes
 */
export function interpolateGradientColor(
  target: Gradient | readonly GradientStop[],
  offset: number
): string {
  const stops: readonly GradientStop[] = Array.isArray(target) ? target : (target as Gradient).stops;
  if (!stops || stops.length === 0) {
    return '#000000';
  }
  if (stops.length === 1) {
    return normalizeColor(stops[0].color) ?? '#000000';
  }

  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const clampedOffset = Math.max(0, Math.min(1, offset));

  if (clampedOffset <= sorted[0].offset) {
    return normalizeColor(sorted[0].color) ?? '#000000';
  }
  if (clampedOffset >= sorted[sorted.length - 1].offset) {
    return normalizeColor(sorted[sorted.length - 1].color) ?? '#000000';
  }

  let s1 = sorted[0];
  let s2 = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (clampedOffset >= sorted[i].offset && clampedOffset <= sorted[i + 1].offset) {
      s1 = sorted[i];
      s2 = sorted[i + 1];
      break;
    }
  }

  const range = s2.offset - s1.offset;
  const t = range > 1e-6 ? (clampedOffset - s1.offset) / range : 0;

  const hex1 = normalizeColor(s1.color) ?? '#000000';
  const hex2 = normalizeColor(s2.color) ?? '#000000';

  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);

  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  const hexR = r.toString(16).padStart(2, '0');
  const hexG = g.toString(16).padStart(2, '0');
  const hexB = b.toString(16).padStart(2, '0');

  return `#${hexR}${hexG}${hexB}`;
}

/**
 * Resuelve y crea un objeto CanvasGradient para rellenar o contornear figuras en el Canvas 2D
 */
export function createCanvasGradient(
  ctx: CanvasRenderingContext2D,
  gradient: Gradient,
  baseAABB: AABB,
  compositeOpacity: number = 1
): CanvasGradient {
  let canvasGradient: CanvasGradient;

  if (isLinearGradient(gradient)) {
    const x1 = baseAABB.minX + gradient.x1 * baseAABB.width;
    const y1 = baseAABB.minY + gradient.y1 * baseAABB.height;
    const x2 = baseAABB.minX + gradient.x2 * baseAABB.width;
    const y2 = baseAABB.minY + gradient.y2 * baseAABB.height;

    canvasGradient = ctx.createLinearGradient(x1, y1, x2, y2);
  } else {
    // Radial
    const cx = baseAABB.minX + gradient.cx * baseAABB.width;
    const cy = baseAABB.minY + gradient.cy * baseAABB.height;
    const maxDim = Math.max(baseAABB.width, baseAABB.height);
    const radius = Math.max(0.1, gradient.r * maxDim);

    const fx = gradient.fx !== undefined ? baseAABB.minX + gradient.fx * baseAABB.width : cx;
    const fy = gradient.fy !== undefined ? baseAABB.minY + gradient.fy * baseAABB.height : cy;

    canvasGradient = ctx.createRadialGradient(fx, fy, 0, cx, cy, radius);
  }

  // Ordenar los stops por offset para Canvas
  const sortedStops = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  for (const stop of sortedStops) {
    const clampedOffset = Math.max(0, Math.min(1, stop.offset));
    const stopOpacity = (stop.opacity !== undefined ? stop.opacity : 1) * compositeOpacity;
    const colorStr = colorWithOpacity(stop.color, stopOpacity);
    canvasGradient.addColorStop(clampedOffset, colorStr);
  }

  return canvasGradient;
}

export interface GradientHandleHit {
  readonly type: 'gradient-start' | 'gradient-end' | 'gradient-center' | 'gradient-radius' | 'gradient-stop';
  readonly stopId?: string;
  readonly point: Vector2D;
}

/**
 * Detecta si las coordenadas del ratón coinciden con algún tirador o stop del degradado
 */
export function hitTestGradientHandles(
  shape: Shape,
  gradient: Gradient,
  worldX: number,
  worldY: number,
  tolerance: number,
  ctx?: CanvasRenderingContext2D | null
): GradientHandleHit | null {
  if (isLinearGradient(gradient)) {
    const p1 = gradientToWorldPoint(shape, gradient.x1, gradient.y1, ctx);
    const p2 = gradientToWorldPoint(shape, gradient.x2, gradient.y2, ctx);

    // Tirador de inicio
    if (Math.hypot(worldX - p1.x, worldY - p1.y) <= tolerance) {
      return { type: 'gradient-start', point: p1 };
    }

    // Tirador de fin
    if (Math.hypot(worldX - p2.x, worldY - p2.y) <= tolerance) {
      return { type: 'gradient-end', point: p2 };
    }

    // Stops intermedios
    for (const stop of gradient.stops) {
      const offset = Math.max(0, Math.min(1, stop.offset));
      const sp = {
        x: p1.x + offset * (p2.x - p1.x),
        y: p1.y + offset * (p2.y - p1.y),
      };
      if (Math.hypot(worldX - sp.x, worldY - sp.y) <= tolerance) {
        return { type: 'gradient-stop', stopId: stop.id, point: sp };
      }
    }
  } else {
    // Radial
    const center = gradientToWorldPoint(shape, gradient.cx, gradient.cy, ctx);
    const radiusPoint = gradientToWorldPoint(shape, gradient.cx + gradient.r, gradient.cy, ctx);

    // Tirador central
    if (Math.hypot(worldX - center.x, worldY - center.y) <= tolerance) {
      return { type: 'gradient-center', point: center };
    }

    // Tirador de radio
    if (Math.hypot(worldX - radiusPoint.x, worldY - radiusPoint.y) <= tolerance) {
      return { type: 'gradient-radius', point: radiusPoint };
    }

    // Stops intermedios
    for (const stop of gradient.stops) {
      const offset = Math.max(0, Math.min(1, stop.offset));
      const sp = {
        x: center.x + offset * (radiusPoint.x - center.x),
        y: center.y + offset * (radiusPoint.y - center.y),
      };
      if (Math.hypot(worldX - sp.x, worldY - sp.y) <= tolerance) {
        return { type: 'gradient-stop', stopId: stop.id, point: sp };
      }
    }
  }

  return null;
}

