import type { Path, Vector2D } from '../../types/scene-graph.ts';
import {
  getPathBaseAABB,
  getVisiblePathHandles,
  getPointType,
} from '../../utils/geometry.ts';
import type { PathEditRenderState } from '../types.ts';
import { renderCornerRadiusHandlesOverlay } from './CornerRadiusOverlayRenderer.ts';

/**
 * Dibuja los manejadores visibles y los puntos de ancla en modo de edición de trazado (Selección Directa).
 */
export function renderPathEditOverlay(
  ctx: CanvasRenderingContext2D,
  path: Path,
  state: PathEditRenderState,
  zoom: number
): void {
  if (!path.points || path.points.length === 0) {
    return;
  }

  ctx.save();

  // 1. Aplica la misma transformación de rotación que renderPath (centro de getPathBaseAABB)
  if (path.rotation) {
    const baseAABB = getPathBaseAABB(path);
    const cx = (baseAABB.minX + baseAABB.maxX) / 2;
    const cy = (baseAABB.minY + baseAABB.maxY) / 2;
    ctx.translate(cx, cy);
    ctx.rotate((path.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // 2. Dibuja previsualización de inserción de nodo sobre la curva si existe
  if (state.hoverInsertPoint) {
    const hip: Vector2D = state.hoverInsertPoint;
    const previewRadius = 4 / zoom;
    ctx.beginPath();
    ctx.arc(hip.x, hip.y, previewRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#0284c7';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    // Cruz indicadora '+'
    const crossSize = 2.2 / zoom;
    ctx.beginPath();
    ctx.moveTo(hip.x - crossSize, hip.y);
    ctx.lineTo(hip.x + crossSize, hip.y);
    ctx.moveTo(hip.x, hip.y - crossSize);
    ctx.lineTo(hip.x, hip.y + crossSize);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
  }

  // 3. Dibuja solo los manejadores de getVisiblePathHandles: línea ancla→manejador + círculo
  const handleRadius = 3.5 / zoom;
  const visibleHandles = getVisiblePathHandles(path, state.selectedAnchors);
  for (const h of visibleHandles) {
    // Línea ancla -> manejador
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'; // Celeste suave
    ctx.lineWidth = 1 / zoom;
    ctx.moveTo(h.anchorX, h.anchorY);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();

    // Círculo para el manejador
    ctx.beginPath();
    ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
  }

  // 4. Dibuja TODAS las anclas con forma representativa de su tipo:
  // - Esquina: cuadrado
  // - Suavizado: círculo
  // - Simétrico: rombo (diamante)
  const anchorSize = 6 / zoom;
  const halfAnchor = anchorSize / 2;

  for (let i = 0; i < path.points.length; i++) {
    const pt = path.points[i];
    const isSelected = state.selectedAnchors.has(i);
    const ptType = pt.pointType ?? getPointType(pt);

    ctx.fillStyle = isSelected ? '#0284c7' : '#ffffff';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5 / zoom;

    if (ptType === 'smooth') {
      // Círculo
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, halfAnchor, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (ptType === 'symmetric') {
      // Rombo (diamante)
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - halfAnchor);
      ctx.lineTo(pt.x + halfAnchor, pt.y);
      ctx.lineTo(pt.x, pt.y + halfAnchor);
      ctx.lineTo(pt.x - halfAnchor, pt.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // Esquina: cuadrado
      ctx.fillRect(pt.x - halfAnchor, pt.y - halfAnchor, anchorSize, anchorSize);
      ctx.strokeRect(pt.x - halfAnchor, pt.y - halfAnchor, anchorSize, anchorSize);
    }
  }

  // 5. Tiradores de radio de esquina sobre el trazado en edición
  renderCornerRadiusHandlesOverlay(ctx, path, zoom);

  ctx.restore();
}
