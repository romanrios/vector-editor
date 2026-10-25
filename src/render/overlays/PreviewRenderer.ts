import type { ShapePreview } from '../../input/InputController.ts';
import { isNonePaint } from '../../utils/color.ts';

/**
 * Dibuja la vista previa de una figura en proceso de creación interactiva por arrastre
 * utilizando trazo punteado y relleno semitransparente, manteniendo grosor de trazo constante.
 */
export function renderShapePreview(
  ctx: CanvasRenderingContext2D,
  preview: ShapePreview,
  zoom: number
): void {
  if (preview.type === 'marquee') {
    const minX = Math.min(preview.x, preview.x + preview.width);
    const minY = Math.min(preview.y, preview.y + preview.height);
    const w = Math.abs(preview.width);
    const h = Math.abs(preview.height);

    if (w < 1 && h < 1) {
      return;
    }

    ctx.save();
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([4 / zoom, 4 / zoom]);
    }
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';

    ctx.beginPath();
    ctx.rect(minX, minY, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (preview.width < 1 && preview.height < 1) {
    return;
  }

  ctx.save();

  if (typeof preview.opacity === 'number') {
    ctx.globalAlpha *= Math.max(0, Math.min(1, preview.opacity));
  }

  ctx.beginPath();
  if (preview.type === 'rectangle') {
    ctx.rect(preview.x, preview.y, preview.width, preview.height);
  } else if (preview.type === 'ellipse') {
    const rx = preview.radiusX ?? preview.width / 2;
    const ry = preview.radiusY ?? preview.height / 2;
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(preview.x, preview.y, rx, ry, 0, 0, Math.PI * 2);
    } else if (typeof ctx.arc === 'function') {
      ctx.arc(preview.x, preview.y, (rx + ry) / 2, 0, Math.PI * 2);
    }
  } else if (preview.type === 'line' && preview.x2 !== undefined && preview.y2 !== undefined) {
    ctx.moveTo(preview.x, preview.y);
    ctx.lineTo(preview.x2, preview.y2);
  } else if (preview.type === 'pencil' && preview.points && preview.points.length > 0) {
    ctx.moveTo(preview.points[0].x, preview.points[0].y);
    for (let i = 1; i < preview.points.length; i++) {
      ctx.lineTo(preview.points[i].x, preview.points[i].y);
    }
  } else if ((preview.type === 'polygon' || preview.type === 'star') && preview.points && preview.points.length > 0) {
    ctx.moveTo(preview.points[0].x, preview.points[0].y);
    for (let i = 1; i < preview.points.length; i++) {
      ctx.lineTo(preview.points[i].x, preview.points[i].y);
    }
    ctx.closePath();
  }

  if (preview.type !== 'line' && preview.type !== 'pencil' && !isNonePaint(preview.fill)) {
    ctx.fillStyle = preview.fill!;
    ctx.fill();
  }

  const strokeWidth = preview.strokeWidth;
  if (!isNonePaint(preview.stroke) && strokeWidth !== undefined && strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    if (preview.strokeDashArray && preview.strokeDashArray.length > 0 && typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([...preview.strokeDashArray]);
    }
    if (preview.strokeLineCap) {
      ctx.lineCap = preview.strokeLineCap;
    }
    if (preview.strokeLineJoin) {
      ctx.lineJoin = preview.strokeLineJoin;
    }
    ctx.strokeStyle = preview.stroke!;
    ctx.stroke();
  }

  ctx.restore();
}
