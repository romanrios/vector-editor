import type { Shape } from '../../types/scene-graph.ts';
import { getShapeCornerRadiusHandles } from '../../utils/cornerSmoothing.ts';

/**
 * Dibuja los tiradores circulares de radio de esquina para una figura seleccionada.
 */
export function renderCornerRadiusHandlesOverlay(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  zoom: number
): void {
  const handles = getShapeCornerRadiusHandles(shape, zoom);
  if (!handles || handles.length === 0) return;

  const handleRadius = 4 / zoom;
  const dotRadius = 1.5 / zoom;

  ctx.save();
  for (const h of handles) {
    ctx.beginPath();
    if (typeof ctx.arc === 'function') {
      ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
    } else if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(h.x, h.y, handleRadius, handleRadius, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(h.x - handleRadius, h.y - handleRadius, handleRadius * 2, handleRadius * 2);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    ctx.beginPath();
    if (typeof ctx.arc === 'function') {
      ctx.arc(h.x, h.y, dotRadius, 0, Math.PI * 2);
    } else if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(h.x, h.y, dotRadius, dotRadius, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(h.x - dotRadius, h.y - dotRadius, dotRadius * 2, dotRadius * 2);
    }
    ctx.fillStyle = '#0284c7';
    ctx.fill();
  }
  ctx.restore();
}
