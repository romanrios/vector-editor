import {
  type Polygon,
  type Star,
  isGradient,
} from '../../types/scene-graph.ts';
import {
  getPolygonBaseVertices,
  getStarBaseVertices,
} from '../../utils/geometry.ts';
import {
  getPolygonPathPoints,
  getStarPathPoints,
} from '../../utils/cornerSmoothing.ts';
import { isNonePaint } from '../../utils/color.ts';
import { createCanvasGradient } from '../../utils/gradient.ts';
import { clearDropShadow } from '../utils/shadow.ts';
import { drawSmoothedPoints } from './PathRenderer.ts';

/**
 * Dibuja un nodo Polygon con soporte para rotación, lados y radio.
 */
export function renderPolygon(ctx: CanvasRenderingContext2D, polygon: Polygon): void {
  ctx.save();

  if (polygon.rotation) {
    ctx.translate(polygon.x, polygon.y);
    ctx.rotate((polygon.rotation * Math.PI) / 180);
    ctx.translate(-polygon.x, -polygon.y);
  }

  const hasCornerRadius = Boolean(polygon.cornerRadius && polygon.cornerRadius > 0);
  ctx.beginPath();
  if (hasCornerRadius) {
    const smoothedPts = getPolygonPathPoints({ ...polygon, rotation: 0 });
    drawSmoothedPoints(ctx, smoothedPts);
  } else {
    const verts = getPolygonBaseVertices(polygon);
    if (verts.length > 0) {
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
    }
  }

  const baseAABB = {
    minX: polygon.x - polygon.radius,
    minY: polygon.y - polygon.radius,
    maxX: polygon.x + polygon.radius,
    maxY: polygon.y + polygon.radius,
    width: polygon.radius * 2,
    height: polygon.radius * 2,
  };

  if (!isNonePaint(polygon.fill)) {
    if (isGradient(polygon.fill)) {
      ctx.fillStyle = createCanvasGradient(ctx, polygon.fill, baseAABB);
    } else {
      ctx.fillStyle = polygon.fill!;
    }
    ctx.fill();
    if (!isNonePaint(polygon.stroke) && polygon.strokeWidth && polygon.strokeWidth > 0) {
      clearDropShadow(ctx);
    }
  }

  if (!isNonePaint(polygon.stroke) && polygon.strokeWidth && polygon.strokeWidth > 0) {
    ctx.lineWidth = polygon.strokeWidth;
    if (polygon.strokeDashArray && polygon.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...polygon.strokeDashArray]);
    }
    if (polygon.strokeLineCap) {
      ctx.lineCap = polygon.strokeLineCap;
    }
    if (polygon.strokeLineJoin) {
      ctx.lineJoin = polygon.strokeLineJoin;
    }
    if (isGradient(polygon.stroke)) {
      ctx.strokeStyle = createCanvasGradient(ctx, polygon.stroke, baseAABB);
    } else {
      ctx.strokeStyle = polygon.stroke!;
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Dibuja un nodo Star con soporte para rotación, puntas y radios exterior/interior.
 */
export function renderStar(ctx: CanvasRenderingContext2D, star: Star): void {
  ctx.save();

  if (star.rotation) {
    ctx.translate(star.x, star.y);
    ctx.rotate((star.rotation * Math.PI) / 180);
    ctx.translate(-star.x, -star.y);
  }

  const hasCornerRadius = Boolean(
    (star.cornerRadius && star.cornerRadius > 0) ||
    (star.innerCornerRadius && star.innerCornerRadius > 0)
  );
  ctx.beginPath();
  if (hasCornerRadius) {
    const smoothedPts = getStarPathPoints({ ...star, rotation: 0 });
    drawSmoothedPoints(ctx, smoothedPts);
  } else {
    const verts = getStarBaseVertices(star);
    if (verts.length > 0) {
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
    }
  }

  const baseAABB = {
    minX: star.x - star.outerRadius,
    minY: star.y - star.outerRadius,
    maxX: star.x + star.outerRadius,
    maxY: star.y + star.outerRadius,
    width: star.outerRadius * 2,
    height: star.outerRadius * 2,
  };

  if (!isNonePaint(star.fill)) {
    if (isGradient(star.fill)) {
      ctx.fillStyle = createCanvasGradient(ctx, star.fill, baseAABB);
    } else {
      ctx.fillStyle = star.fill!;
    }
    ctx.fill();
    if (!isNonePaint(star.stroke) && star.strokeWidth && star.strokeWidth > 0) {
      clearDropShadow(ctx);
    }
  }

  if (!isNonePaint(star.stroke) && star.strokeWidth && star.strokeWidth > 0) {
    ctx.lineWidth = star.strokeWidth;
    if (star.strokeDashArray && star.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...star.strokeDashArray]);
    }
    if (star.strokeLineCap) {
      ctx.lineCap = star.strokeLineCap;
    }
    if (star.strokeLineJoin) {
      ctx.lineJoin = star.strokeLineJoin;
    }
    if (isGradient(star.stroke)) {
      ctx.strokeStyle = createCanvasGradient(ctx, star.stroke, baseAABB);
    } else {
      ctx.strokeStyle = star.stroke!;
    }
    ctx.stroke();
  }

  ctx.restore();
}
