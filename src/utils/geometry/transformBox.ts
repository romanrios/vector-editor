import type { AABB, Vector2D } from '../../types/scene-graph.ts';
import type { HandleType } from './handles.ts';

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

/**
 * Normaliza un ángulo en grados al rango semiabierto (-180, 180].
 */
export function normalizeAngle(deg: number): number {
  let angle = ((deg % 360) + 360) % 360;
  if (angle > 180) {
    angle -= 360;
  }
  return Object.is(angle, -0) ? 0 : angle;
}

/**
 * Calcula el ancla opuesta y los factores de escala (sx, sy) al arrastrar un tirador de caja (esquinas o laterales),
 * garantizando un tamaño mínimo de 5 px para el conjunto y respetando aspect ratio si se indica.
 *
 * @param bounds Caja delimitadora (AABB) de la selección
 * @param handle Tirador arrastrado
 * @param dx Desplazamiento horizontal del ratón
 * @param dy Desplazamiento vertical del ratón
 * @param preserveAspect Si es true, restringe la escala para preservar proporciones
 * @param fromCenter Si es true, escala desde el centro
 * @returns { anchor, sx, sy }
 */
export function computeBoxScale(
  bounds: AABB,
  handle: HandleType,
  dx: number,
  dy: number,
  preserveAspect: boolean = false,
  fromCenter: boolean = false
): { anchor: Vector2D; sx: number; sy: number } {
  let anchor: Vector2D;
  let dxSign = 1;
  let dySign = 1;

  if (fromCenter) {
    anchor = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
  } else {
    switch (handle) {
      case 'top-left':
        anchor = { x: bounds.maxX, y: bounds.maxY };
        break;
      case 'top-center':
        anchor = { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY };
        break;
      case 'top-right':
        anchor = { x: bounds.minX, y: bounds.maxY };
        break;
      case 'right-center':
        anchor = { x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2 };
        break;
      case 'bottom-right':
        anchor = { x: bounds.minX, y: bounds.minY };
        break;
      case 'bottom-center':
        anchor = { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
        break;
      case 'bottom-left':
        anchor = { x: bounds.maxX, y: bounds.minY };
        break;
      case 'left-center':
        anchor = { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 };
        break;
      default:
        anchor = { x: bounds.minX, y: bounds.minY };
        break;
    }
  }

  switch (handle) {
    case 'top-left':
      dxSign = -1;
      dySign = -1;
      break;
    case 'top-center':
      dxSign = 0;
      dySign = -1;
      break;
    case 'top-right':
      dxSign = 1;
      dySign = -1;
      break;
    case 'right-center':
      dxSign = 1;
      dySign = 0;
      break;
    case 'bottom-right':
      dxSign = 1;
      dySign = 1;
      break;
    case 'bottom-center':
      dxSign = 0;
      dySign = 1;
      break;
    case 'bottom-left':
      dxSign = -1;
      dySign = 1;
      break;
    case 'left-center':
      dxSign = -1;
      dySign = 0;
      break;
    default:
      dxSign = 1;
      dySign = 1;
      break;
  }

  const initW = bounds.width;
  const initH = bounds.height;
  const safeInitW = Math.max(1, initW);
  const safeInitH = Math.max(1, initH);
  const mult = fromCenter ? 2 : 1;

  if (!preserveAspect) {
    const rawW = dxSign === 0 ? initW : initW + mult * dxSign * dx;
    const rawH = dySign === 0 ? initH : initH + mult * dySign * dy;
    const newW = Math.max(5, rawW);
    const newH = Math.max(5, rawH);
    return {
      anchor,
      sx: dxSign === 0 ? 1 : newW / safeInitW,
      sy: dySign === 0 ? 1 : newH / safeInitH,
    };
  }

  let deltaScale: number;
  if (dxSign === 0) {
    deltaScale = mult * ((dySign * dy) / safeInitH);
  } else if (dySign === 0) {
    deltaScale = mult * ((dxSign * dx) / safeInitW);
  } else {
    const diagLenSq = safeInitW * safeInitW + safeInitH * safeInitH;
    const dot = dxSign * dx * safeInitW + dySign * dy * safeInitH;
    deltaScale = mult * (dot / diagLenSq);
  }
  const rawScale = 1 + deltaScale;

  const minScale = Math.max(5 / safeInitW, 5 / safeInitH);
  const scale = Math.max(minScale, rawScale);

  return {
    anchor,
    sx: scale,
    sy: scale,
  };
}

/**
 * Calcula la variación angular (Δθ) en grados respecto a un pivote, normalizada en (-180, 180].
 * Si snap está activo, redondea en incrementos discretos de 15°.
 *
 * @param pivot Punto pivote de rotación
 * @param startMouse Posición inicial del ratón
 * @param currentMouse Posición actual del ratón
 * @param snap Si es true, ajusta el delta a múltiplos de 15°
 * @returns Delta de rotación en grados
 */
export function computeRotationDelta(
  pivot: Vector2D,
  startMouse: Vector2D,
  currentMouse: Vector2D,
  snap: boolean = false
): number {
  const startDx = startMouse.x - pivot.x;
  const startDy = startMouse.y - pivot.y;
  const curDx = currentMouse.x - pivot.x;
  const curDy = currentMouse.y - pivot.y;

  if ((startDx === 0 && startDy === 0) || (curDx === 0 && curDy === 0)) {
    return 0;
  }

  const startAngle = Math.atan2(startDy, startDx);
  const curAngle = Math.atan2(curDy, curDx);

  let deltaDeg = ((curAngle - startAngle) * 180) / Math.PI;
  deltaDeg = normalizeAngle(deltaDeg);

  if (snap) {
    deltaDeg = Math.round(deltaDeg / 15) * 15;
    deltaDeg = normalizeAngle(deltaDeg);
  }

  return deltaDeg;
}
