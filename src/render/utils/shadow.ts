import type { DropShadow } from '../../types/scene-graph.ts';
import { colorWithOpacity } from '../../utils/gradient.ts';

/**
 * Aplica la configuración de sombra paralela al contexto 2D.
 */
export function applyDropShadow(ctx: CanvasRenderingContext2D, shadow?: DropShadow): void {
  if (!shadow) return;
  const color = shadow.color || '#000000';
  const opacity = shadow.opacity !== undefined ? Math.max(0, Math.min(1, shadow.opacity)) : 1;
  ctx.shadowColor = colorWithOpacity(color, opacity);
  ctx.shadowOffsetX = shadow.offsetX || 0;
  ctx.shadowOffsetY = shadow.offsetY || 0;
  ctx.shadowBlur = Math.max(0, shadow.blur || 0);
}

/**
 * Restablece las propiedades de sombra para evitar sombras duplicadas (ej: tras dibujar el relleno).
 */
export function clearDropShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
}
