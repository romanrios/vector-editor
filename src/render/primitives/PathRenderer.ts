import {
  type Path,
  type PathPoint,
  isGradient,
} from '../../types/scene-graph.ts';
import { getPathBaseAABB } from '../../utils/geometry.ts';
import { smoothPathPoints } from '../../utils/cornerSmoothing.ts';
import { isNonePaint } from '../../utils/color.ts';
import { createCanvasGradient } from '../../utils/gradient.ts';
import { clearDropShadow } from '../utils/shadow.ts';

/**
 * Traza en el contexto un array de puntos suavizados que pueden contener segmentos rectos y cúbicos.
 */
export function drawSmoothedPoints(ctx: CanvasRenderingContext2D, points: readonly PathPoint[]): void {
  if (points.length === 0) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.handleOut || curr.handleIn) {
      const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
      const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
      const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
      const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
    } else {
      ctx.lineTo(curr.x, curr.y);
    }
  }
  const last = points[points.length - 1];
  const first = points[0];
  if (last.handleOut || first.handleIn) {
    const cp1x = last.handleOut ? last.handleOut.x : last.x;
    const cp1y = last.handleOut ? last.handleOut.y : last.y;
    const cp2x = first.handleIn ? first.handleIn.x : first.x;
    const cp2y = first.handleIn ? first.handleIn.y : first.y;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x, first.y);
  }
  ctx.closePath();
}

/**
 * Dibuja un nodo Path utilizando curvas de Bézier cúbicas (bezierCurveTo) en Canvas 2D.
 */
export function renderPath(ctx: CanvasRenderingContext2D, path: Path, _zoom?: number): void {
  if (!path.points || path.points.length === 0) {
    return;
  }

  ctx.save();

  if (path.rotation) {
    const baseAABB = getPathBaseAABB(path);
    const cx = (baseAABB.minX + baseAABB.maxX) / 2;
    const cy = (baseAABB.minY + baseAABB.maxY) / 2;
    ctx.translate(cx, cy);
    ctx.rotate((path.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  const hasCornerRadius = Boolean(
    (path.cornerRadius && path.cornerRadius > 0) ||
    path.points.some((p) => p.cornerRadius && p.cornerRadius > 0)
  );
  const points = hasCornerRadius
    ? smoothPathPoints(path.points, Boolean(path.closed), path.cornerRadius)
    : path.points;
  ctx.beginPath();
  let subpathStartIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (i === 0 || curr.moveTo) {
      if (i > 0) {
        const prevStart = points[subpathStartIdx];
        const last = points[i - 1];
        const shouldClose = last.closeSubpath ?? path.closed;
        if (shouldClose && i - subpathStartIdx > 1) {
          const cp1x = last.handleOut ? last.handleOut.x : last.x;
          const cp1y = last.handleOut ? last.handleOut.y : last.y;
          const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
          const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, prevStart.x, prevStart.y);
          ctx.closePath();
        }
      }
      subpathStartIdx = i;
      ctx.moveTo(curr.x, curr.y);
    } else {
      const prev = points[i - 1];
      const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
      const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
      const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
      const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
    }
  }

  if (points.length > 0) {
    const prevStart = points[subpathStartIdx];
    const last = points[points.length - 1];
    const shouldClose = last.closeSubpath ?? path.closed;
    if (shouldClose && points.length - subpathStartIdx > 1) {
      const cp1x = last.handleOut ? last.handleOut.x : last.x;
      const cp1y = last.handleOut ? last.handleOut.y : last.y;
      const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
      const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, prevStart.x, prevStart.y);
      ctx.closePath();
    }
  }

  if (!isNonePaint(path.fill)) {
    if (isGradient(path.fill)) {
      const baseAABB = getPathBaseAABB(path);
      ctx.fillStyle = createCanvasGradient(ctx, path.fill, baseAABB);
    } else {
      ctx.fillStyle = path.fill!;
    }
    ctx.fill(path.fillRule ?? 'nonzero');
    if (!isNonePaint(path.stroke) && path.strokeWidth && path.strokeWidth > 0) {
      clearDropShadow(ctx);
    }
  }

  if (!isNonePaint(path.stroke) && path.strokeWidth && path.strokeWidth > 0) {
    ctx.lineWidth = path.strokeWidth;
    if (path.strokeDashArray && path.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...path.strokeDashArray]);
    }
    ctx.lineCap = path.strokeLineCap ?? 'round';
    ctx.lineJoin = path.strokeLineJoin ?? 'round';
    if (isGradient(path.stroke)) {
      const baseAABB = getPathBaseAABB(path);
      ctx.strokeStyle = createCanvasGradient(ctx, path.stroke, baseAABB);
    } else {
      ctx.strokeStyle = path.stroke!;
    }
    ctx.stroke();
  }

  ctx.restore();
}
