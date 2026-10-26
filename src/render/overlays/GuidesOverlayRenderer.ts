import type { Document, Guide } from '../../types/scene-graph.ts';
import type { SnapGuide } from '../../types/engine.ts';
import type { StateManager } from '../../state/StateManager.ts';
import { screenToWorld, type Viewport, ViewportManager } from '../../utils/viewport.ts';
import type { RenderEngineOptions, EyedropperPreviewState } from '../types.ts';

/**
 * Dibuja una cuadrícula sutil de fondo alineada con el espacio del documento.
 * Ajusta el espaciado dinámicamente según el nivel de zoom para mantener
 * una densidad visual agradable (~25px a 80px en pantalla) y un grosor constante de 1px.
 */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  logicalWidth: number,
  logicalHeight: number,
  viewport: Viewport
): void {
  const zoom = viewport.zoom;
  const topLeft = screenToWorld(viewport, { x: 0, y: 0 });
  const bottomRight = screenToWorld(viewport, { x: logicalWidth, y: logicalHeight });

  let step = 40;
  while (step * zoom < 25) {
    step *= 2;
  }
  while (step * zoom > 80) {
    step /= 2;
  }

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  const startX = Math.floor(minX / step) * step;
  const endX = Math.ceil(maxX / step) * step;
  const startY = Math.floor(minY / step) * step;
  const endY = Math.ceil(maxY / step) * step;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1 / zoom;

  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Renderiza las Mesas de Trabajo (Artboards) en el espacio de coordenadas del mundo.
 * Dibuja cada lienzo con sombra perimetral, fondo personalizable y título identificador.
 */
export function renderArtboard(
  ctx: CanvasRenderingContext2D,
  stateManager: StateManager,
  options: RenderEngineOptions,
  zoom: number
): void {
  const artboards = stateManager.getArtboards();
  if (!artboards || artboards.length === 0) {
    return;
  }

  const activeArtboardId = stateManager.getActiveArtboardId();

  const validArtboards = artboards.filter(
    (ab) => ab.width && ab.height && ab.width > 0 && ab.height > 0
  );
  if (validArtboards.length === 0) {
    return;
  }

  // PASO 1: Sombras perimetrales (drop-shadow) de todas las mesas de trabajo
  // Se renderizan primero todas juntas como capa base para que ninguna sombra
  // de una mesa se dibuje por encima de la superficie o borde de otra mesa vecina.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 24 / zoom;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4 / zoom;
  ctx.fillStyle = '#ffffff';

  for (const ab of validArtboards) {
    ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
  }
  ctx.restore();

  // PASO 2: Fondos limpios y opacos de todas las mesas de trabajo
  // Al dibujarse después de todas las sombras y sin sombra activa, se garantiza
  // matemáticamente que ninguna sombra vecina manche la superficie de otra mesa.
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  for (const ab of validArtboards) {
    const bg =
      !ab.backgroundColor || ab.backgroundColor === 'none' || ab.backgroundColor === 'transparent'
        ? '#ffffff'
        : ab.backgroundColor;
    ctx.fillStyle = bg;
    ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
  }
  ctx.restore();

  // PASO 3: Bordes delimitadores, títulos y tiradores de interacción
  // Se renderizan nítidamente sobre los fondos limpios sin sombras superpuestas
  for (const ab of validArtboards) {
    const { x, y, width, height, name, id } = ab;

    ctx.save();
    const isActive = id === activeArtboardId;
    const isToolActive = options.artboardOverlayProvider?.()?.isArtboardToolActive === true;
    const isMulti = artboards.length > 1;
    const isHighlighted = isActive && (isMulti || isToolActive);
    ctx.lineWidth = (isActive && isToolActive ? 2 : isHighlighted ? 1.5 : 1) / zoom;
    ctx.strokeStyle = isHighlighted
      ? (isToolActive ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)')
      : 'rgba(0, 0, 0, 0.1)';
    ctx.strokeRect(x, y, width, height);

    // Etiqueta con el nombre de la mesa de trabajo sobre la esquina superior izquierda
    if ((artboards.length > 1 || isToolActive) && name && typeof ctx.fillText === 'function') {
      ctx.fillStyle = isActive ? '#38bdf8' : '#71717a';
      const fontSize = Math.max(10, Math.min(14, 12 / zoom));
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.fillText(name, x, y - 6 / zoom);
    }

    // Si la herramienta Mesa de Trabajo está activa y esta es la mesa activa, dibujar 8 tiradores
    if (isActive && isToolActive) {
      const handleSize = 8 / zoom;
      const half = handleSize / 2;
      const midX = x + width / 2;
      const midY = y + height / 2;
      const handles = [
        [x, y],
        [midX, y],
        [x + width, y],
        [x + width, midY],
        [x + width, y + height],
        [midX, y + height],
        [x, y + height],
        [x, midY],
      ];

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5 / zoom;
      for (const [hx, hy] of handles) {
        ctx.fillRect(hx - half, hy - half, handleSize, handleSize);
        ctx.strokeRect(hx - half, hy - half, handleSize, handleSize);
      }
    }

    ctx.restore();
  }

  // Dibujar caja de creación interactiva si la herramienta está arrastrando en el vacío
  const overlayState = options.artboardOverlayProvider?.();
  if (overlayState?.isArtboardToolActive && overlayState.creationBox) {
    const box = overlayState.creationBox;
    if (box.width > 0 && box.height > 0) {
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.fillRect(box.x, box.y, box.width, box.height);

      if (typeof ctx.fillText === 'function') {
        ctx.fillStyle = '#38bdf8';
        const tag = `${Math.round(box.width)} × ${Math.round(box.height)} px`;
        const fontSize = Math.max(10, Math.min(13, 11 / zoom));
        ctx.font = `600 ${fontSize}px sans-serif`;
        ctx.fillText(tag, box.x, box.y + box.height + 16 / zoom);
      }
      ctx.restore();
    }
  }
}

/**
 * Dibuja las guías de alineación magnética (Snap Guides) activas en color magenta (#FF00FF).
 */
export function renderSnapGuides(
  ctx: CanvasRenderingContext2D,
  guides: readonly SnapGuide[],
  zoom: number
): void {
  if (guides.length === 0) return;

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = '#FF00FF';
  ctx.beginPath();
  for (const guide of guides) {
    if (guide.axis === 'x') {
      ctx.moveTo(guide.position, guide.start);
      ctx.lineTo(guide.position, guide.end);
    } else {
      ctx.moveTo(guide.start, guide.position);
      ctx.lineTo(guide.end, guide.position);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Dibuja las guías de usuario (cyan #06b6d4) registradas en el Documento y la guía en arrastre activo.
 */
export function renderUserGuides(
  ctx: CanvasRenderingContext2D,
  stateManager: StateManager,
  doc: Document,
  viewportManager: ViewportManager,
  canvas: HTMLCanvasElement,
  highDpi: boolean,
  activeGuideDrag: Guide | null,
  zoom: number
): void {
  if (!stateManager.isGuidesVisible()) return;

  const guides = doc.guides ?? [];
  if (guides.length === 0 && !activeGuideDrag) return;

  const isLocked = stateManager.isGuidesLocked();
  const vp = viewportManager.getViewport();
  const screenWidth = canvas.width / (highDpi ? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) : 1);
  const screenHeight = canvas.height / (highDpi ? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) : 1);
  const minWorldX = -vp.panX / vp.zoom - 1000;
  const maxWorldX = (screenWidth - vp.panX) / vp.zoom + 1000;
  const minWorldY = -vp.panY / vp.zoom - 1000;
  const maxWorldY = (screenHeight - vp.panY) / vp.zoom + 1000;

  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = isLocked ? 'rgba(6, 182, 212, 0.6)' : '#06b6d4';
  if (isLocked) {
    ctx.setLineDash([4 / zoom, 4 / zoom]);
  } else {
    ctx.setLineDash([]);
  }

  if (guides.length > 0) {
    ctx.beginPath();
    for (const guide of guides) {
      if (guide.axis === 'x') {
        ctx.moveTo(guide.position, minWorldY);
        ctx.lineTo(guide.position, maxWorldY);
      } else {
        ctx.moveTo(minWorldX, guide.position);
        ctx.lineTo(maxWorldX, guide.position);
      }
    }
    ctx.stroke();
  }

  if (activeGuideDrag) {
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 3 / zoom]);
    if (activeGuideDrag.axis === 'x') {
      ctx.moveTo(activeGuideDrag.position, minWorldY);
      ctx.lineTo(activeGuideDrag.position, maxWorldY);
    } else {
      ctx.moveTo(minWorldX, activeGuideDrag.position);
      ctx.lineTo(maxWorldX, activeGuideDrag.position);
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Dibuja una muestra/lupa circular flotante junto al cursor durante el modo Cuentagotas.
 */
export function renderEyedropperPreview(
  ctx: CanvasRenderingContext2D,
  preview: EyedropperPreviewState,
  dpr: number
): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = preview.screenX + 16;
  const cy = preview.screenY - 16;
  const r = 9;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = preview.color === 'none' || preview.color === 'transparent' ? '#1e293b' : preview.color;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.stroke();

  ctx.restore();
}
