import {
  type Shape,
  type Gradient,
  isLinearGradient,
} from '../../types/scene-graph.ts';
import { gradientToWorldPoint } from '../../utils/gradient.ts';

/**
 * Dibuja los tiradores visuales del degradado activo sobre la figura seleccionada:
 * línea conectora, tiradores de inicio/fin (o centro/radio) y marcadores para cada stop.
 */
export function renderGradientOverlay(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  gradient: Gradient,
  zoom: number
): void {
  const handleRadius = 6 / zoom;
  const stopRadius = 5 / zoom;
  ctx.save();

  if (isLinearGradient(gradient)) {
    const p1 = gradientToWorldPoint(shape, gradient.x1, gradient.y1, ctx);
    const p2 = gradientToWorldPoint(shape, gradient.x2, gradient.y2, ctx);

    // 1. Línea conectora entre inicio y fin (sombra + línea blanca)
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 3 / zoom;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    // 2. Marcadores para cada parada (stop) de color a lo largo de la línea
    for (const stop of gradient.stops) {
      const offset = Math.max(0, Math.min(1, stop.offset));
      const px = p1.x + offset * (p2.x - p1.x);
      const py = p1.y + offset * (p2.y - p1.y);

      ctx.beginPath();
      ctx.arc(px, py, stopRadius, 0, Math.PI * 2);
      ctx.fillStyle = stop.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, stopRadius + 1 / zoom, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    // 3. Tirador circular de inicio (p1)
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();

    // 4. Tirador circular de fin (p2)
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();
  } else {
    // Degradado Radial
    const center = gradientToWorldPoint(shape, gradient.cx, gradient.cy, ctx);
    const radiusPoint = gradientToWorldPoint(shape, gradient.cx + gradient.r, gradient.cy, ctx);
    const radDist = Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y);

    // Círculo perimetral de referencia tenue
    ctx.beginPath();
    ctx.arc(center.x, center.y, radDist, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
    ctx.setLineDash([]);

    // Línea de radio
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(radiusPoint.x, radiusPoint.y);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 3 / zoom;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(radiusPoint.x, radiusPoint.y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    // Stops a lo largo del radio
    for (const stop of gradient.stops) {
      const offset = Math.max(0, Math.min(1, stop.offset));
      const px = center.x + offset * (radiusPoint.x - center.x);
      const py = center.y + offset * (radiusPoint.y - center.y);

      ctx.beginPath();
      ctx.arc(px, py, stopRadius, 0, Math.PI * 2);
      ctx.fillStyle = stop.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, stopRadius + 1 / zoom, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    // Tirador central
    ctx.beginPath();
    ctx.arc(center.x, center.y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();

    // Tirador perimetral de radio
    ctx.beginPath();
    ctx.arc(radiusPoint.x, radiusPoint.y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();
  }

  ctx.restore();
}
