import type {
  Path,
  PathPoint,
  Shape,
  Vector2D,
} from '../../../types/scene-graph.ts';
import { getPathBaseAABB, getShapeAABB, type HandleType } from '../../../utils/geometry.ts';

import type { ShapeDimensions } from '../../../commands/ResizeCommand.ts';

export function getShapeCentroid(shape: Shape): { x: number; y: number } {
  if (shape.type === 'rectangle' || shape.type === 'image') {
    return {
      x: shape.x + shape.width / 2,
      y: shape.y + shape.height / 2,
    };
  }
  if (shape.type === 'ellipse' || shape.type === 'polygon' || shape.type === 'star') {
    return {
      x: shape.x,
      y: shape.y,
    };
  }
  if (shape.type === 'path') {
    const aabb = getPathBaseAABB(shape);
    return {
      x: (aabb.minX + aabb.maxX) / 2,
      y: (aabb.minY + aabb.maxY) / 2,
    };
  }
  const aabb = getShapeAABB(shape);
  return {
    x: (aabb.minX + aabb.maxX) / 2,
    y: (aabb.minY + aabb.maxY) / 2,
  };
}

export function getResizeCursor(handle: HandleType, rotation: number = 0): string {
  const handleAngles: Record<string, number> = {
    'top-left': 225,
    'top-center': 270,
    'top-right': 315,
    'right-center': 0,
    'bottom-right': 45,
    'bottom-center': 90,
    'bottom-left': 135,
    'left-center': 180,
  };
  const baseAngle = handleAngles[handle];
  if (baseAngle === undefined) return 'default';

  let totalAngle = (baseAngle + rotation) % 360;
  if (totalAngle < 0) totalAngle += 360;

  if ((totalAngle >= 337.5 || totalAngle < 22.5) || (totalAngle >= 157.5 && totalAngle < 202.5)) {
    return 'ew-resize';
  }
  if ((totalAngle >= 22.5 && totalAngle < 67.5) || (totalAngle >= 202.5 && totalAngle < 247.5)) {
    return 'nwse-resize';
  }
  if ((totalAngle >= 67.5 && totalAngle < 112.5) || (totalAngle >= 247.5 && totalAngle < 292.5)) {
    return 'ns-resize';
  }
  return 'nesw-resize';
}

export function hasDimensionsChanged(a: ShapeDimensions, b: ShapeDimensions): boolean {
  if (a.points && b.points) {
    if (a.points.length !== b.points.length) return true;
    for (let i = 0; i < a.points.length; i++) {
      const p = a.points[i];
      const n = b.points[i];
      if (p.x !== n.x || p.y !== n.y) return true;
      if (p.handleIn?.x !== n.handleIn?.x || p.handleIn?.y !== n.handleIn?.y) return true;
      if (p.handleOut?.x !== n.handleOut?.x || p.handleOut?.y !== n.handleOut?.y) return true;
    }
    return false;
  }
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.radiusX !== b.radiusX ||
    a.radiusY !== b.radiusY ||
    a.fontSize !== b.fontSize ||
    a.lineHeight !== b.lineHeight ||
    a.letterSpacing !== b.letterSpacing ||
    a.rotation !== b.rotation ||
    a.boxWidth !== b.boxWidth ||
    a.cornerRadius !== b.cornerRadius ||
    a.radius !== b.radius ||
    a.sides !== b.sides ||
    a.outerRadius !== b.outerRadius ||
    a.innerRadius !== b.innerRadius ||
    a.starPoints !== b.starPoints
  );
}

export function calculateResizedDimensions(
  initial: ShapeDimensions,
  handle: HandleType,
  dx: number,
  dy: number,
  preserveAspectRatio: boolean = false,
  fromCenter: boolean = false
): ShapeDimensions {
  const rotation = initial.rotation ?? 0;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;

  if (handle === 'right-center' && (initial.boxWidth !== undefined || initial.fontSize !== undefined)) {
    const initBoxW = initial.boxWidth !== undefined ? initial.boxWidth : (initial.width ?? 0);
    const newBoxWidth = Math.max(5, initBoxW + localDx);
    return {
      x: initial.x,
      y: initial.y,
      rotation,
      boxWidth: newBoxWidth,
    };
  }

  let dxSign = 1;
  let dySign = 1;
  switch (handle) {
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
  }

  // 1. Redimensionado exclusivo para nodos de tipo Text:
  if (initial.fontSize !== undefined) {
    const initX = initial.x ?? 0;
    const initY = initial.y ?? 0;
    const initW = Math.max(1, initial.width ?? 1);
    const initH = Math.max(1, initial.height ?? 1);
    const bX = initial.baseX ?? initX;
    const bY = initial.baseY ?? initY;

    // Anclaje en espacio local sin rotar
    let uA: number;
    let vA: number;
    if (fromCenter) {
      uA = bX + initW / 2;
      vA = bY + initH / 2;
    } else {
      uA = dxSign === 0 ? bX + initW / 2 : (dxSign > 0 ? bX : bX + initW);
      vA = dySign === 0 ? bY + initH / 2 : (dySign > 0 ? bY : bY + initH);
    }

    // Anclaje en coordenadas de mundo (rotado respecto al punto de origen de texto)
    const anchorWorldX = initX + (uA - initX) * cos - (vA - initY) * sin;
    const anchorWorldY = initY + (uA - initX) * sin + (vA - initY) * cos;

    // Progresión del escalado
    let deltaScale: number;
    if (dxSign === 0) {
      deltaScale = (fromCenter ? 2 : 1) * ((dySign * localDy) / initH);
    } else if (dySign === 0) {
      deltaScale = (fromCenter ? 2 : 1) * ((dxSign * localDx) / initW);
    } else {
      const diagLenSq = initW * initW + initH * initH;
      const dot = dxSign * localDx * initW + dySign * localDy * initH;
      deltaScale = (fromCenter ? 2 : 1) * (dot / diagLenSq);
    }

    const rawScale = 1 + deltaScale;
    const minScale = Math.max(4 / Math.max(1, initial.fontSize), 5 / initW, 5 / initH);
    const scale = Math.max(minScale, rawScale);

    const newFontSize = Math.max(4, Math.round(initial.fontSize * scale));
    const effectiveScale = newFontSize / initial.fontSize;

    // Nueva posición (x, y) del nodo Text manteniendo invariante el punto de anclaje en coordenadas de mundo
    const newX = anchorWorldX + effectiveScale * (initX - anchorWorldX);
    const newY = anchorWorldY + effectiveScale * (initY - anchorWorldY);

    const newW = Math.max(5, initW * effectiveScale);
    const newH = Math.max(5, initH * effectiveScale);

    const result: ShapeDimensions = {
      x: newX,
      y: newY,
      width: newW,
      height: newH,
      fontSize: newFontSize,
      rotation,
      ...(initial.boxWidth !== undefined
        ? { boxWidth: Math.max(5, Math.round(initial.boxWidth * effectiveScale)) }
        : {}),
      ...(initial.lineHeight !== undefined
        ? { lineHeight: Math.max(1, Math.round(initial.lineHeight * effectiveScale)) }
        : {}),
      ...(initial.letterSpacing !== undefined
        ? { letterSpacing: Math.round(initial.letterSpacing * effectiveScale * 100) / 100 }
        : {}),
      ...(initial.baseX !== undefined
        ? { baseX: uA + effectiveScale * (bX - uA), baseY: vA + effectiveScale * (bY - vA) }
        : {}),
    };

    return result;
  }

  const computeSize = (
    initW: number,
    initH: number
  ): { newW: number; newH: number; scaleX: number; scaleY: number } => {
    const safeInitW = Math.max(1, initW);
    const safeInitH = Math.max(1, initH);
    const mult = fromCenter ? 2 : 1;

    if (!preserveAspectRatio) {
      const newW = dxSign === 0 ? initW : Math.max(5, initW + mult * dxSign * localDx);
      const newH = dySign === 0 ? initH : Math.max(5, initH + mult * dySign * localDy);
      return {
        newW,
        newH,
        scaleX: dxSign === 0 ? 1 : newW / safeInitW,
        scaleY: dySign === 0 ? 1 : newH / safeInitH,
      };
    }

    const rawNewW = dxSign === 0 ? initW : initW + mult * dxSign * localDx;
    const rawNewH = dySign === 0 ? initH : initH + mult * dySign * localDy;

    let scale: number;
    if (dxSign === 0) {
      scale = rawNewH / safeInitH;
    } else if (dySign === 0) {
      scale = rawNewW / safeInitW;
    } else if (initW < 1) {
      scale = rawNewH / safeInitH;
    } else if (initH < 1) {
      scale = rawNewW / safeInitW;
    } else {
      const sx = rawNewW / safeInitW;
      const sy = rawNewH / safeInitH;
      scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    }

    const minScale = Math.max(5 / safeInitW, 5 / safeInitH);
    scale = Math.max(minScale, scale);

    const newW = Math.max(5, initW * scale);
    const newH = Math.max(5, initH * scale);

    return {
      newW,
      newH,
      scaleX: scale,
      scaleY: scale,
    };
  };

  if (initial.points !== undefined && initial.points.length > 0) {
    const baseAABB = getPathBaseAABB(initial as Path);
    const minX = baseAABB.minX;
    const minY = baseAABB.minY;
    const maxX = baseAABB.maxX;
    const maxY = baseAABB.maxY;
    const initW = Math.max(1, baseAABB.width);
    const initH = Math.max(1, baseAABB.height);

    const { newW, newH, scaleX, scaleY } = computeSize(initW, initH);

    const anchorX = fromCenter ? (minX + maxX) / 2 : (dxSign === 0 ? (minX + maxX) / 2 : (dxSign > 0 ? minX : maxX));
    const anchorY = fromCenter ? (minY + maxY) / 2 : (dySign === 0 ? (minY + maxY) / 2 : (dySign > 0 ? minY : maxY));

    const localShiftX = fromCenter ? 0 : (dxSign * (newW - initW)) / 2;
    const localShiftY = fromCenter ? 0 : (dySign * (newH - initH)) / 2;

    const tx = (localShiftX * cos - localShiftY * sin) - localShiftX;
    const ty = (localShiftX * sin + localShiftY * cos) - localShiftY;

    const scaleCoord = (pt: Vector2D): Vector2D => ({
      x: anchorX + (pt.x - anchorX) * scaleX + tx,
      y: anchorY + (pt.y - anchorY) * scaleY + ty,
    });

    const newPoints: PathPoint[] = initial.points.map((pt) => {
      const scaledMain = scaleCoord(pt);
      return {
        ...pt,
        x: scaledMain.x,
        y: scaledMain.y,
        handleIn: pt.handleIn ? scaleCoord(pt.handleIn) : undefined,
        handleOut: pt.handleOut ? scaleCoord(pt.handleOut) : undefined,
      };
    });

    return {
      x: newPoints[0]?.x ?? initial.x ?? 0,
      y: newPoints[0]?.y ?? initial.y ?? 0,
      width: newW,
      height: newH,
      points: newPoints,
      rotation,
    };
  }

  if (initial.width !== undefined && initial.height !== undefined) {
    const initX = initial.x ?? 0;
    const initY = initial.y ?? 0;
    const initW = initial.width;
    const initH = initial.height;

    const { newW, newH } = computeSize(initW, initH);

    const localShiftX = fromCenter ? 0 : (dxSign * (newW - initW)) / 2;
    const localShiftY = fromCenter ? 0 : (dySign * (newH - initH)) / 2;

    const initCenterX = initX + initW / 2;
    const initCenterY = initY + initH / 2;

    const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
    const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

    return {
      x: newCenterX - newW / 2,
      y: newCenterY - newH / 2,
      width: newW,
      height: newH,
      rotation,
    };
  }

  if (initial.radiusX !== undefined && initial.radiusY !== undefined) {
    const initCenterX = initial.x ?? 0;
    const initCenterY = initial.y ?? 0;
    const initRx = initial.radiusX;
    const initRy = initial.radiusY;

    const initW = initRx * 2;
    const initH = initRy * 2;

    const { newW, newH } = computeSize(initW, initH);

    const localShiftX = fromCenter ? 0 : (dxSign * (newW - initW)) / 2;
    const localShiftY = fromCenter ? 0 : (dySign * (newH - initH)) / 2;

    const newRx = newW / 2;
    const newRy = newH / 2;

    const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
    const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

    return {
      x: newCenterX,
      y: newCenterY,
      radiusX: newRx,
      radiusY: newRy,
      rotation,
    };
  }

  if (initial.radius !== undefined) {
    const initCenterX = initial.x ?? 0;
    const initCenterY = initial.y ?? 0;
    const initR = initial.radius;
    const initSize = initR * 2;
    const mult = fromCenter ? 2 : 1;
    let newR: number;

    if (preserveAspectRatio) {
      const { newW } = computeSize(initSize, initSize);
      newR = Math.max(2, newW / 2);
    } else {
      const rawNewW = dxSign === 0 ? initSize : initSize + mult * dxSign * localDx;
      const rawNewH = dySign === 0 ? initSize : initSize + mult * dySign * localDy;
      const sx = rawNewW / Math.max(1, initSize);
      const sy = rawNewH / Math.max(1, initSize);
      const scale = dxSign === 0 ? sy : dySign === 0 ? sx : Math.max(4 / Math.max(1, initSize), Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy);
      newR = Math.max(2, initR * scale);
    }

    const localShiftX = fromCenter ? 0 : (dxSign * (newR * 2 - initSize)) / 2;
    const localShiftY = fromCenter ? 0 : (dySign * (newR * 2 - initSize)) / 2;

    const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
    const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

    return {
      x: newCenterX,
      y: newCenterY,
      radius: newR,
      sides: initial.sides,
      rotation,
      ...(initial.cornerRadius !== undefined ? { cornerRadius: initial.cornerRadius } : {}),
    };
  }

  if (initial.outerRadius !== undefined && initial.innerRadius !== undefined) {
    const initCenterX = initial.x ?? 0;
    const initCenterY = initial.y ?? 0;
    const initOuter = initial.outerRadius;
    const initSize = initOuter * 2;
    const mult = fromCenter ? 2 : 1;
    let newOuter: number;

    if (preserveAspectRatio) {
      const { newW } = computeSize(initSize, initSize);
      newOuter = Math.max(2, newW / 2);
    } else {
      const rawNewW = dxSign === 0 ? initSize : initSize + mult * dxSign * localDx;
      const rawNewH = dySign === 0 ? initSize : initSize + mult * dySign * localDy;
      const sx = rawNewW / Math.max(1, initSize);
      const sy = rawNewH / Math.max(1, initSize);
      const scale = dxSign === 0 ? sy : dySign === 0 ? sx : Math.max(4 / Math.max(1, initSize), Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy);
      newOuter = Math.max(2, initOuter * scale);
    }

    const ratio = initOuter > 0 ? initial.innerRadius / initOuter : 0.5;
    const newInner = Math.max(1, newOuter * ratio);

    const localShiftX = fromCenter ? 0 : (dxSign * (newOuter * 2 - initSize)) / 2;
    const localShiftY = fromCenter ? 0 : (dySign * (newOuter * 2 - initSize)) / 2;

    const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
    const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

    return {
      x: newCenterX,
      y: newCenterY,
      outerRadius: newOuter,
      innerRadius: newInner,
      starPoints: initial.starPoints,
      rotation,
      ...(initial.cornerRadius !== undefined ? { cornerRadius: initial.cornerRadius } : {}),
      ...(initial.innerCornerRadius !== undefined ? { innerCornerRadius: initial.innerCornerRadius } : {}),
    };
  }

  return initial;
}
