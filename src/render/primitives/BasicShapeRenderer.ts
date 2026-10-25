import {
  type Rectangle,
  type Ellipse,
  isGradient,
} from '../../types/scene-graph.ts';
import { isNonePaint } from '../../utils/color.ts';
import { createCanvasGradient } from '../../utils/gradient.ts';
import { clearDropShadow } from '../utils/shadow.ts';

/**
 * Dibuja un nodo Rectangle aplicando rotación centrada y esquinas redondeadas
 */
export function renderRectangle(ctx: CanvasRenderingContext2D, rect: Rectangle): void {
  ctx.save();

  // Rotación respecto al centro del rectángulo
  if (rect.rotation) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rect.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  ctx.beginPath();
  if (rect.cornerRadius && rect.cornerRadius > 0) {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.cornerRadius);
    } else {
      const r = Math.min(rect.cornerRadius, Math.abs(rect.width) / 2, Math.abs(rect.height) / 2);
      const rx = rect.x;
      const ry = rect.y;
      const rw = rect.width;
      const rh = rect.height;
      ctx.moveTo(rx + r, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
      ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
      ctx.arcTo(rx, ry + rh, rx, ry, r);
      ctx.arcTo(rx, ry, rx + rw, ry, r);
      ctx.closePath();
    }
  } else {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
  }

  if (!isNonePaint(rect.fill)) {
    if (isGradient(rect.fill)) {
      const baseAABB = {
        minX: rect.x,
        minY: rect.y,
        maxX: rect.x + rect.width,
        maxY: rect.y + rect.height,
        width: rect.width,
        height: rect.height,
      };
      ctx.fillStyle = createCanvasGradient(ctx, rect.fill, baseAABB);
    } else {
      ctx.fillStyle = rect.fill!;
    }
    ctx.fill();
    if (!isNonePaint(rect.stroke) && rect.strokeWidth && rect.strokeWidth > 0) {
      clearDropShadow(ctx);
    }
  }

  if (!isNonePaint(rect.stroke) && rect.strokeWidth && rect.strokeWidth > 0) {
    ctx.lineWidth = rect.strokeWidth;
    if (rect.strokeDashArray && rect.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...rect.strokeDashArray]);
    }
    if (rect.strokeLineCap) {
      ctx.lineCap = rect.strokeLineCap;
    }
    if (rect.strokeLineJoin) {
      ctx.lineJoin = rect.strokeLineJoin;
    }
    if (isGradient(rect.stroke)) {
      const baseAABB = {
        minX: rect.x,
        minY: rect.y,
        maxX: rect.x + rect.width,
        maxY: rect.y + rect.height,
        width: rect.width,
        height: rect.height,
      };
      ctx.strokeStyle = createCanvasGradient(ctx, rect.stroke, baseAABB);
    } else {
      ctx.strokeStyle = rect.stroke!;
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Dibuja un nodo Ellipse con soporte para rotación y radios X/Y
 */
export function renderEllipse(ctx: CanvasRenderingContext2D, ellipse: Ellipse): void {
  ctx.save();

  if (ellipse.rotation) {
    ctx.translate(ellipse.x, ellipse.y);
    ctx.rotate((ellipse.rotation * Math.PI) / 180);
    ctx.translate(-ellipse.x, -ellipse.y);
  }

  ctx.beginPath();
  ctx.ellipse(
    ellipse.x,
    ellipse.y,
    ellipse.radiusX,
    ellipse.radiusY,
    0,
    0,
    Math.PI * 2
  );

  const baseAABB = {
    minX: ellipse.x - ellipse.radiusX,
    minY: ellipse.y - ellipse.radiusY,
    maxX: ellipse.x + ellipse.radiusX,
    maxY: ellipse.y + ellipse.radiusY,
    width: ellipse.radiusX * 2,
    height: ellipse.radiusY * 2,
  };

  if (!isNonePaint(ellipse.fill)) {
    if (isGradient(ellipse.fill)) {
      ctx.fillStyle = createCanvasGradient(ctx, ellipse.fill, baseAABB);
    } else {
      ctx.fillStyle = ellipse.fill!;
    }
    ctx.fill();
    if (!isNonePaint(ellipse.stroke) && ellipse.strokeWidth && ellipse.strokeWidth > 0) {
      clearDropShadow(ctx);
    }
  }

  if (!isNonePaint(ellipse.stroke) && ellipse.strokeWidth && ellipse.strokeWidth > 0) {
    ctx.lineWidth = ellipse.strokeWidth;
    if (ellipse.strokeDashArray && ellipse.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...ellipse.strokeDashArray]);
    }
    if (ellipse.strokeLineCap) {
      ctx.lineCap = ellipse.strokeLineCap;
    }
    if (ellipse.strokeLineJoin) {
      ctx.lineJoin = ellipse.strokeLineJoin;
    }
    if (isGradient(ellipse.stroke)) {
      const baseAABB = {
        minX: ellipse.x - ellipse.radiusX,
        minY: ellipse.y - ellipse.radiusY,
        maxX: ellipse.x + ellipse.radiusX,
        maxY: ellipse.y + ellipse.radiusY,
        width: ellipse.radiusX * 2,
        height: ellipse.radiusY * 2,
      };
      ctx.strokeStyle = createCanvasGradient(ctx, ellipse.stroke, baseAABB);
    } else {
      ctx.strokeStyle = ellipse.stroke!;
    }
    ctx.stroke();
  }

  ctx.restore();
}
