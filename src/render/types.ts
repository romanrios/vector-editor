import type { ShapePreview } from '../input/InputController.ts';
import type { SnapGuide } from '../types/engine.ts';
import type { Guide, Vector2D } from '../types/scene-graph.ts';
import type { ViewportManager } from '../utils/viewport.ts';
import type { LayerCacheManager, LayerCacheManagerOptions } from './LayerCacheManager.ts';

export interface TextEditRenderState {
  textId: string;
  text: string;
  cursorIndex?: number;
  selectionStart?: number;
  selectionEnd?: number;
  cursorVisible?: boolean;
}

export interface PathEditRenderState {
  pathId: string;
  selectedAnchors: ReadonlySet<number>;
  hoverInsertPoint?: Vector2D | null;
}

export interface EyedropperPreviewState {
  readonly screenX: number;
  readonly screenY: number;
  readonly color: string;
}

export interface ArtboardOverlayState {
  readonly isArtboardToolActive: boolean;
  readonly creationBox?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
}

export interface RenderEngineOptions {
  /**
   * Habilita el escalado automático para pantallas de alta densidad (Retina/HiDPI)
   * Por defecto es true.
   */
  highDpi?: boolean;
  /**
   * Color de fondo para limpiar el lienzo en cada frame.
   * Si es undefined, el lienzo se limpia de forma transparente.
   */
  backgroundColor?: string;
  /**
   * Proveedor funcional opcional de la vista previa de figuras en creación.
   */
  previewProvider?: () => ShapePreview | null;
  /**
   * Proveedor funcional opcional del estado de edición de nodos para Selección Directa o Pluma.
   */
  pathEditProvider?: () => PathEditRenderState | null;
  /**
   * Proveedor funcional opcional del estado de edición de texto en curso.
   */
  textEditProvider?: () => TextEditRenderState | null;
  activeGuidesProvider?: () => readonly SnapGuide[];
  /**
   * Proveedor funcional opcional de la guía de usuario en arrastre interactivo.
   */
  activeGuideDragProvider?: () => Guide | null;
  /**
   * Proveedor funcional opcional de la vista previa del cuentagotas (muestreo de color bajo el cursor).
   */
  eyedropperPreviewProvider?: () => EyedropperPreviewState | null;
  /**
   * Gestor reactivo de la vista (zoom y pan). Si no se proporciona, crea uno nuevo.
   */
  viewportManager?: ViewportManager;
  /**
   * Proveedor funcional opcional del estado de la herramienta Mesa de Trabajo (tiradores, preview de creación).
   */
  artboardOverlayProvider?: () => ArtboardOverlayState | null;
  /**
   * Indica si se dibuja la mesa de trabajo (Artboard).
   * Por defecto es true.
   */
  showArtboard?: boolean;
  /**
   * Habilita el caché de capas o grupos estáticos en OffscreenCanvas
   * para acelerar el redibujado durante navegación (pan / zoom).
   * Por defecto false en tests headless, true en producción.
   */
  enableLayerCache?: boolean;
  /**
   * Opciones de configuración para el gestor de caché de capas.
   */
  layerCacheOptions?: LayerCacheManagerOptions;
  /**
   * Instancia opcional de LayerCacheManager. Si no se provee y enableLayerCache es true,
   * RenderEngine crea una internamente.
   */
  layerCacheManager?: LayerCacheManager;
}
