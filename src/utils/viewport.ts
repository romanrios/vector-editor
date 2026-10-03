import type { Vector2D } from '../types/scene-graph.ts';

/**
 * Representa el estado inmutable de la cámara/vista 2D en el lienzo.
 * Convención de transformación afín:
 * pantalla = mundo * zoom + pan (con pan en píxeles CSS).
 */
export interface Viewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

/**
 * Límites de escala admitidos para el zoom
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

/**
 * Estado inicial por defecto de la vista (zoom 1:1, sin desplazamiento)
 */
export const DEFAULT_VIEWPORT: Viewport = Object.freeze({
  zoom: 1,
  panX: 0,
  panY: 0,
});

/**
 * Dimensiones físicas o lógicas de un contenedor de lienzo
 */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Forma estructural para cajas de límites en el espacio del mundo
 */
export interface BoundsLike {
  readonly minX?: number;
  readonly minY?: number;
  readonly maxX?: number;
  readonly maxY?: number;
  readonly width?: number;
  readonly height?: number;
  readonly x?: number;
  readonly y?: number;
}

/**
 * Convierte un punto de coordenadas de pantalla (píxeles CSS del canvas)
 * a coordenadas del mundo (Scene Graph).
 *
 * Fórmula: mundo = (pantalla - pan) / zoom
 */
export function screenToWorld(viewport: Viewport, screenPoint: Vector2D): Vector2D {
  return {
    x: (screenPoint.x - viewport.panX) / viewport.zoom,
    y: (screenPoint.y - viewport.panY) / viewport.zoom,
  };
}

/**
 * Convierte un punto de coordenadas del mundo (Scene Graph)
 * a coordenadas de pantalla (píxeles CSS del canvas).
 *
 * Fórmula: pantalla = mundo * zoom + pan
 */
export function worldToScreen(viewport: Viewport, worldPoint: Vector2D): Vector2D {
  return {
    x: worldPoint.x * viewport.zoom + viewport.panX,
    y: worldPoint.y * viewport.zoom + viewport.panY,
  };
}

/**
 * Modifica el nivel de zoom multiplicando por un factor, manteniendo anclado
 * exactamente el punto del mundo que se encuentra bajo la coordenada de pantalla indicada.
 * Respeta estrictamente los límites [MIN_ZOOM, MAX_ZOOM], garantizando que el punto
 * fijo se mantenga incluso si se alcanza alguno de los extremos.
 */
export function zoomAt(viewport: Viewport, screenPoint: Vector2D, factor: number): Viewport {
  if (factor <= 0 || !Number.isFinite(factor)) {
    return viewport;
  }

  const rawZoom = viewport.zoom * factor;
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rawZoom));

  // Punto del mundo que actualmente está bajo el cursor en pantalla
  const worldPoint = screenToWorld(viewport, screenPoint);

  // Calcular el nuevo pan para que worldPoint continúe proyectándose en screenPoint:
  // screenPoint = worldPoint * newZoom + newPan  =>  newPan = screenPoint - worldPoint * newZoom
  const newPanX = screenPoint.x - worldPoint.x * newZoom;
  const newPanY = screenPoint.y - worldPoint.y * newZoom;

  return Object.freeze({
    zoom: newZoom,
    panX: newPanX,
    panY: newPanY,
  });
}

/**
 * Desplaza la vista por un delta (dx, dy) medido en píxeles de pantalla.
 */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return Object.freeze({
    zoom: viewport.zoom,
    panX: viewport.panX + dx,
    panY: viewport.panY + dy,
  });
}

/**
 * Calcula el zoom y desplazamiento necesarios para centrar y encajar una caja delimitadora
 * del mundo dentro del canvas con un margen opcional.
 * Si la caja es nula, indefinida o vacía, devuelve el estado por defecto (zoom 1, centrado en el canvas).
 */
export function fitToBounds(
  canvasSize: CanvasSize,
  worldBounds: BoundsLike | null | undefined,
  margin: number = 0
): Viewport {
  const defaultPanX = canvasSize.width > 0 ? canvasSize.width / 2 : 0;
  const defaultPanY = canvasSize.height > 0 ? canvasSize.height / 2 : 0;

  if (!worldBounds) {
    return Object.freeze({
      zoom: 1,
      panX: defaultPanX,
      panY: defaultPanY,
    });
  }

  const minX = worldBounds.minX ?? worldBounds.x ?? 0;
  const minY = worldBounds.minY ?? worldBounds.y ?? 0;
  const width = worldBounds.width ?? (worldBounds.maxX !== undefined ? worldBounds.maxX - minX : 0);
  const height = worldBounds.height ?? (worldBounds.maxY !== undefined ? worldBounds.maxY - minY : 0);
  const maxX = worldBounds.maxX ?? (minX + width);
  const maxY = worldBounds.maxY ?? (minY + height);

  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return Object.freeze({
      zoom: 1,
      panX: defaultPanX,
      panY: defaultPanY,
    });
  }

  const safeMargin = Math.max(0, margin);
  const availWidth = Math.max(1, canvasSize.width - 2 * safeMargin);
  const availHeight = Math.max(1, canvasSize.height - 2 * safeMargin);

  const scaleX = availWidth / width;
  const scaleY = availHeight / height;
  const targetZoom = Math.min(scaleX, scaleY);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));

  const boxCenterX = (minX + maxX) / 2;
  const boxCenterY = (minY + maxY) / 2;
  const canvasCenterX = canvasSize.width / 2;
  const canvasCenterY = canvasSize.height / 2;

  const panX = canvasCenterX - boxCenterX * zoom;
  const panY = canvasCenterY - boxCenterY * zoom;

  return Object.freeze({
    zoom,
    panX,
    panY,
  });
}

/**
 * Restablece el zoom al 100% (zoom = 1) manteniendo fijo en pantalla el punto
 * de coordenadas de pantalla indicado (por ejemplo, el centro del canvas o el cursor).
 */
export function resetZoom(viewport: Viewport, screenCenter: Vector2D): Viewport {
  const worldPoint = screenToWorld(viewport, screenCenter);
  const newZoom = 1;
  const panX = screenCenter.x - worldPoint.x * newZoom;
  const panY = screenCenter.y - worldPoint.y * newZoom;

  return Object.freeze({
    zoom: newZoom,
    panX,
    panY,
  });
}

/**
 * Callback de suscripción para cambios en el Viewport
 */
export type ViewportListener = (viewport: Readonly<Viewport>) => void;

/**
 * Gestor reactivo para el estado de la vista (cámara / viewport).
 * Permite consultar, mutar y suscribirse a cambios de zoom y desplazamiento
 * de forma completamente desacoplada del Documento y del historial CommandManager.
 */
export class ViewportManager {
  private _viewport: Readonly<Viewport>;
  private _listeners: Set<ViewportListener> = new Set();

  constructor(initialViewport?: Viewport) {
    this._viewport = initialViewport ? Object.freeze({ ...initialViewport }) : DEFAULT_VIEWPORT;
  }

  public get viewport(): Readonly<Viewport> {
    return this._viewport;
  }

  public get zoom(): number {
    return this._viewport.zoom;
  }

  public get panX(): number {
    return this._viewport.panX;
  }

  public get panY(): number {
    return this._viewport.panY;
  }

  public getViewport(): Readonly<Viewport> {
    return this._viewport;
  }

  public setViewport(nextViewport: Viewport): void {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextViewport.zoom));
    if (
      this._viewport.zoom === clampedZoom &&
      this._viewport.panX === nextViewport.panX &&
      this._viewport.panY === nextViewport.panY
    ) {
      return;
    }

    this._viewport = Object.freeze({
      zoom: clampedZoom,
      panX: nextViewport.panX,
      panY: nextViewport.panY,
    });

    this.notify();
  }

  public zoomAt(screenPoint: Vector2D, factor: number): void {
    const next = zoomAt(this._viewport, screenPoint, factor);
    this.setViewport(next);
  }

  public panBy(dx: number, dy: number): void {
    const next = panBy(this._viewport, dx, dy);
    this.setViewport(next);
  }

  public fitToBounds(
    canvasSize: CanvasSize,
    worldBounds: BoundsLike | null | undefined,
    margin?: number
  ): void {
    const next = fitToBounds(canvasSize, worldBounds, margin);
    this.setViewport(next);
  }

  public resetZoom(screenCenter: Vector2D): void {
    const next = resetZoom(this._viewport, screenCenter);
    this.setViewport(next);
  }

  public screenToWorld(screenPoint: Vector2D): Vector2D {
    return screenToWorld(this._viewport, screenPoint);
  }

  public worldToScreen(worldPoint: Vector2D): Vector2D {
    return worldToScreen(this._viewport, worldPoint);
  }

  public subscribe(listener: ViewportListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this._listeners) {
      listener(this._viewport);
    }
  }
}
