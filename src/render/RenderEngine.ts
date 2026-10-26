import {
  isGroup,
  isShape,
  type Document,
  type Group,
  type Layer,
  type LayerChildNode,
  type Shape,
  blendModeToCompositeOperation,
} from '../types/scene-graph.ts';
import type { StateManager } from '../state/StateManager.ts';
import { traceShapeClip } from '../utils/geometry.ts';
import { ViewportManager } from '../utils/viewport.ts';
import {
  LayerCacheManager,
  type CachedRenderEntry,
} from './LayerCacheManager.ts';
import { applyDropShadow } from './utils/shadow.ts';
import { renderRectangle, renderEllipse } from './primitives/BasicShapeRenderer.ts';
import { renderPolygon, renderStar } from './primitives/ParametricRenderer.ts';
import { renderPath } from './primitives/PathRenderer.ts';
import { renderText } from './primitives/TextRenderer.ts';
import { renderImage } from './primitives/ImageRenderer.ts';
import {
  renderSelectionOverlay,
  renderSingleShapeSelection,
  renderSingleGroupSelection,
  renderBoxWithHandles,
  renderGroupOutline,
  renderShapeOutline,
} from './overlays/SelectionOverlayRenderer.ts';
import {
  renderGrid,
  renderArtboard,
  renderSnapGuides,
  renderUserGuides,
  renderEyedropperPreview,
} from './overlays/GuidesOverlayRenderer.ts';
import { renderShapePreview } from './overlays/PreviewRenderer.ts';

export type {
  TextEditRenderState,
  PathEditRenderState,
  EyedropperPreviewState,
  ArtboardOverlayState,
  RenderEngineOptions,
} from './types.ts';
import type { RenderEngineOptions } from './types.ts';

/**
 * Motor de renderizado basado en la API Canvas 2D (CanvasRenderingContext2D).
 * Lee el Scene Graph del StateManager e implementa un bucle optimizado
 * con requestAnimationFrame que SOLO redibuja cuando detecta el flag isDirty.
 */
export class RenderEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly stateManager: StateManager;
  private readonly options: RenderEngineOptions;
  public readonly viewportManager: ViewportManager;
  public readonly layerCacheManager: LayerCacheManager | null = null;
  private unsubscribeViewport: (() => void) | null = null;

  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private _renderCount: number = 0;
  private resizeHandler: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    stateManager: StateManager,
    options: RenderEngineOptions = {}
  ) {
    this.canvas = canvas;
    this.stateManager = stateManager;
    this.options = {
      highDpi: true,
      backgroundColor: '#0f172a', // Fondo pizarra oscuro elegante
      ...options,
    };
    this.viewportManager = options.viewportManager ?? new ViewportManager();

    if (options.enableLayerCache || options.layerCacheManager) {
      this.layerCacheManager =
        options.layerCacheManager ?? new LayerCacheManager(options.layerCacheOptions);
    }

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('[RenderEngine] No se pudo obtener el contexto CanvasRenderingContext2D.');
    }
    this.ctx = context;

    this.unsubscribeViewport = this.viewportManager.subscribe(() => {
      this.stateManager.markDirty();
    });

    this.setupResizeListener();
    this.resizeToDisplaySize();
  }

  /**
   * Acceso al contexto 2D para operaciones geométricas o hit-testing (isPointInPath).
   */
  public getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Número total de veces que se ha ejecutado efectivamente el redibujado.
   * Permite verificar que el bucle no redibuja en frames estáticos.
   */
  public get renderCount(): number {
    return this._renderCount;
  }

  /**
   * Ajusta el tamaño físico del canvas con respecto a su tamaño CSS y DPI de pantalla.
   */
  public resizeToDisplaySize(): boolean {
    const dpr = this.options.highDpi && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect = this.canvas.getBoundingClientRect();

    const width = Math.max(1, Math.floor((rect.width || (typeof window !== 'undefined' ? window.innerWidth : 800)) * dpr));
    const height = Math.max(1, Math.floor((rect.height || (typeof window !== 'undefined' ? window.innerHeight : 600)) * dpr));

    if (Math.abs(this.canvas.width - width) > 1 || Math.abs(this.canvas.height - height) > 1) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.render();
      this.stateManager.markDirty();
      return true;
    }

    return false;
  }

  /**
   * Configura el listener de redimensionamiento de ventana para ajustar el canvas a pantalla completa.
   */
  private setupResizeListener(): void {
    if (typeof window === 'undefined') return;

    this.resizeHandler = () => {
      this.resizeToDisplaySize();
    };

    window.addEventListener('resize', this.resizeHandler);

    if (typeof ResizeObserver !== 'undefined') {
      const target = this.canvas.parentElement ?? this.canvas;
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeToDisplaySize();
      });
      this.resizeObserver.observe(target);
    }
  }

  /**
   * Inicia el bucle de renderizado con requestAnimationFrame.
   * En cada tick, verifica la bandera isDirty antes de ejecutar cualquier operación de pintado.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const frame = () => {
      if (!this.isRunning) return;

      const isStateDirty = this.stateManager.isDirty;

      if (isStateDirty) {
        this.render();
        this.stateManager.clearDirty();
      }

      this.animationFrameId = requestAnimationFrame(frame);
    };

    this.animationFrameId = requestAnimationFrame(frame);
  }

  /**
   * Detiene el bucle de requestAnimationFrame.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Libera recursos y remueve listeners.
   */
  public destroy(): void {
    this.stop();
    if (this.layerCacheManager) {
      this.layerCacheManager.clear();
    }
    if (this.unsubscribeViewport) {
      this.unsubscribeViewport();
      this.unsubscribeViewport = null;
    }
    if (typeof window !== 'undefined' && this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Limpia y redibuja la totalidad de los elementos visuales del editor en el canvas.
   */
  public render(): void {
    const documentState = this.stateManager.getState();
    const dpr = this.options.highDpi && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const viewport = this.viewportManager.getViewport();
    const zoom = viewport.zoom || 1;
    const panX = viewport.panX || 0;
    const panY = viewport.panY || 0;

    // Normalizar escala según DPI para limpiar toda la superficie física
    this.ctx.save();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const logicalWidth = this.canvas.width / dpr;
    const logicalHeight = this.canvas.height / dpr;

    // Limpiar pantalla
    if (this.options.backgroundColor) {
      this.ctx.fillStyle = this.options.backgroundColor;
      this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    } else {
      this.ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    }

    // Aplicar matriz de vista combinada con DPR:
    // pantalla = mundo * zoom + pan
    // canvas_pixel = dpr * (mundo * zoom + pan) = (dpr * zoom) * mundo + (dpr * pan)
    this.ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

    // Dibujar cuadrícula tenue adaptativa alineada con el mundo
    renderGrid(this.ctx, logicalWidth, logicalHeight, viewport);

    // Dibujar la mesa de trabajo (Artboard) en el espacio del mundo
    if (this.options.showArtboard !== false) {
      renderArtboard(this.ctx, this.stateManager, this.options, zoom);
    }

    // Colección de IDs en edición activa (selección, edición de anclas de trazado, edición de texto)
    const activeIds = new Set(this.stateManager.getSelection());
    const pathEdit = this.options.pathEditProvider?.();
    if (pathEdit?.pathId) {
      activeIds.add(pathEdit.pathId);
    }
    const textEdit = this.options.textEditProvider?.();
    if (textEdit?.textId) {
      activeIds.add(textEdit.textId);
    }

    // Poda de capas o grupos huérfanos del caché si está activo
    if (this.layerCacheManager) {
      const existingIds: string[] = [];
      for (const layer of documentState.children) {
        existingIds.push(layer.id);
        for (const child of layer.children) {
          if (isGroup(child)) {
            existingIds.push(child.id);
          }
        }
      }
      this.layerCacheManager.prune(existingIds);
    }

    // Iterar sobre el array de nodos (Document -> Layers -> Shapes)
    this.renderDocument(documentState, zoom, activeIds, dpr);

    // Dibujar caja delimitadora (bounding box) azul con manejadores de tamaño constante
    renderSelectionOverlay(this.ctx, this.stateManager, this.options, zoom);

    // Dibujar guías de usuario (cyan #06b6d4)
    renderUserGuides(
      this.ctx,
      this.stateManager,
      documentState,
      this.viewportManager,
      this.canvas,
      Boolean(this.options.highDpi),
      this.options.activeGuideDragProvider?.() ?? null,
      zoom
    );

    // Dibujar vista previa de creación de figura (trazo punteado y semitransparente)
    const activePreview = this.options.previewProvider?.() ?? null;
    if (activePreview) {
      renderShapePreview(this.ctx, activePreview, zoom);
    }

    renderSnapGuides(this.ctx, this.options.activeGuidesProvider?.() ?? [], zoom);

    const eyedropperPreview = this.options.eyedropperPreviewProvider?.() ?? null;
    if (eyedropperPreview) {
      renderEyedropperPreview(this.ctx, eyedropperPreview, dpr);
    }

    this.ctx.restore();
    this._renderCount++;
  }

  /**
   * Itera sobre las capas (Layer) del Documento
   */
  private renderDocument(
    document: Document,
    zoom: number,
    activeIds?: ReadonlySet<string>,
    dpr?: number
  ): void {
    for (const layer of document.children) {
      if (layer.visible === false) {
        continue;
      }
      this.renderLayer(layer, zoom, activeIds, dpr);
    }
  }

  /**
   * Renderiza el contenido de una capa respetando opacidad y visibilidad heredadas.
   * Utiliza LayerCacheManager para blitear la capa pre-rasterizada si es estática.
   */
  private renderLayer(
    layer: Layer,
    zoom: number,
    activeIds?: ReadonlySet<string>,
    dpr?: number
  ): void {
    if (this.layerCacheManager && this.options.enableLayerCache && activeIds && typeof dpr === 'number') {
      if (this.layerCacheManager.hasActiveDescendant(layer, activeIds)) {
        this.layerCacheManager.invalidate(layer.id);
      } else {
        const cached = this.layerCacheManager.get(layer, zoom, dpr);
        if (cached) {
          this.ctx.save();
          if (typeof layer.opacity === 'number') {
            this.ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
          }
          if (layer.blendMode && layer.blendMode !== 'normal') {
            this.ctx.globalCompositeOperation = blendModeToCompositeOperation(layer.blendMode);
          }
          if (layer.dropShadow) {
            applyDropShadow(this.ctx, layer.dropShadow);
          }
          this.ctx.drawImage(
            cached.canvas as any,
            cached.bounds.minX,
            cached.bounds.minY,
            cached.bounds.width,
            cached.bounds.height
          );
          this.ctx.restore();
          return;
        }

        if (this.layerCacheManager.isEligible(layer, activeIds)) {
          const entry = this.rasterizeNodeToCache(layer, zoom, dpr);
          if (entry) {
            this.ctx.save();
            if (typeof layer.opacity === 'number') {
              this.ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
            }
            if (layer.blendMode && layer.blendMode !== 'normal') {
              this.ctx.globalCompositeOperation = blendModeToCompositeOperation(layer.blendMode);
            }
            if (layer.dropShadow) {
              applyDropShadow(this.ctx, layer.dropShadow);
            }
            this.ctx.drawImage(
              entry.canvas as any,
              entry.bounds.minX,
              entry.bounds.minY,
              entry.bounds.width,
              entry.bounds.height
            );
            this.ctx.restore();
            return;
          }
        }
      }
    }

    this.ctx.save();

    if (typeof layer.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
    }
    if (layer.blendMode && layer.blendMode !== 'normal') {
      this.ctx.globalCompositeOperation = blendModeToCompositeOperation(layer.blendMode);
    }
    if (layer.dropShadow) {
      applyDropShadow(this.ctx, layer.dropShadow);
    }

    for (const child of layer.children) {
      this.renderChildNode(child, zoom, activeIds, dpr);
    }

    this.ctx.restore();
  }

  /**
   * Rasteriza un nodo (capa o grupo) fuera de pantalla para acelerar futuros redibujados.
   */
  private rasterizeNodeToCache(
    node: Layer | Group,
    zoom: number,
    dpr: number
  ): CachedRenderEntry | null {
    if (!this.layerCacheManager) return null;
    const bounds = this.layerCacheManager.calculatePaddedBounds(node, zoom);
    if (!bounds) return null;

    const scale = zoom * dpr;
    const pixelWidth = Math.ceil(bounds.width * scale);
    const pixelHeight = Math.ceil(bounds.height * scale);

    if (
      pixelWidth > this.layerCacheManager.maxDimension ||
      pixelHeight > this.layerCacheManager.maxDimension
    ) {
      return null;
    }

    const offscreen = this.layerCacheManager.createCanvas(pixelWidth, pixelHeight);
    if (!offscreen) return null;

    const offscreenCtx = (offscreen as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null;
    if (!offscreenCtx) return null;

    offscreenCtx.setTransform(scale, 0, 0, scale, -bounds.minX * scale, -bounds.minY * scale);

    const prevCtx = this.ctx;
    try {
      (this as any).ctx = offscreenCtx;
      for (const child of node.children) {
        this.renderChildNode(child, zoom);
      }
    } finally {
      (this as any).ctx = prevCtx;
    }

    const entry: CachedRenderEntry = {
      id: node.id,
      nodeRef: node,
      canvas: offscreen,
      bounds,
      zoom,
      dpr,
      lastUsedFrame: this._renderCount,
    };
    this.layerCacheManager.set(entry);
    return entry;
  }

  /**
   * Renderiza recursivamente un nodo hijo (Shape o Group).
   * Si el nodo está oculto (visible === false), se omite junto con todos sus descendientes.
   */
  private renderChildNode(
    child: LayerChildNode,
    zoom: number,
    activeIds?: ReadonlySet<string>,
    dpr?: number
  ): void {
    if (child.visible === false) {
      return;
    }
    if (isGroup(child)) {
      this.renderGroup(child, zoom, activeIds, dpr);
    } else if (isShape(child)) {
      this.renderShape(child, zoom);
    }
  }

  /**
   * Renderiza un Grupo de forma recursiva multiplicando su opacidad acumulada
   * y aislando el estado gráfico mediante save/restore.
   */
  private renderGroup(
    group: Group,
    zoom: number,
    activeIds?: ReadonlySet<string>,
    dpr?: number
  ): void {
    if (group.visible === false) {
      return;
    }

    if (
      this.layerCacheManager &&
      this.options.enableLayerCache &&
      activeIds &&
      typeof dpr === 'number'
    ) {
      if (this.layerCacheManager.hasActiveDescendant(group, activeIds)) {
        this.layerCacheManager.invalidate(group.id);
      } else {
        const cached = this.layerCacheManager.get(group, zoom, dpr);
        if (cached) {
          this.ctx.save();
          if (typeof group.opacity === 'number') {
            this.ctx.globalAlpha *= Math.max(0, Math.min(1, group.opacity));
          }
          if (group.blendMode && group.blendMode !== 'normal') {
            this.ctx.globalCompositeOperation = blendModeToCompositeOperation(group.blendMode);
          }
          if (group.dropShadow) {
            applyDropShadow(this.ctx, group.dropShadow);
          }
          this.ctx.drawImage(
            cached.canvas as any,
            cached.bounds.minX,
            cached.bounds.minY,
            cached.bounds.width,
            cached.bounds.height
          );
          this.ctx.restore();
          return;
        }

        if (this.layerCacheManager.isEligible(group, activeIds)) {
          const entry = this.rasterizeNodeToCache(group, zoom, dpr);
          if (entry) {
            this.ctx.save();
            if (typeof group.opacity === 'number') {
              this.ctx.globalAlpha *= Math.max(0, Math.min(1, group.opacity));
            }
            if (group.blendMode && group.blendMode !== 'normal') {
              this.ctx.globalCompositeOperation = blendModeToCompositeOperation(group.blendMode);
            }
            if (group.dropShadow) {
              applyDropShadow(this.ctx, group.dropShadow);
            }
            this.ctx.drawImage(
              entry.canvas as any,
              entry.bounds.minX,
              entry.bounds.minY,
              entry.bounds.width,
              entry.bounds.height
            );
            this.ctx.restore();
            return;
          }
        }
      }
    }

    this.ctx.save();

    if (typeof group.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, group.opacity));
    }
    if (group.blendMode && group.blendMode !== 'normal') {
      this.ctx.globalCompositeOperation = blendModeToCompositeOperation(group.blendMode);
    }
    if (group.dropShadow) {
      applyDropShadow(this.ctx, group.dropShadow);
    }

    if (group.isClipMask === true && group.children.length > 0) {
      const maskChild = group.clipChildId
        ? group.children.find((c) => c.id === group.clipChildId)
        : group.children[group.children.length - 1];

      if (maskChild && isShape(maskChild)) {
        traceShapeClip(this.ctx, maskChild);
        for (const child of group.children) {
          if (child.id === maskChild.id) {
            continue;
          }
          this.renderChildNode(child, zoom, activeIds, dpr);
        }
        this.ctx.restore();
        return;
      }
    }

    for (const child of group.children) {
      this.renderChildNode(child, zoom, activeIds, dpr);
    }

    this.ctx.restore();
  }

  /**
   * Renderiza una figura según su tipo discriminado (Rectangle, Ellipse, Path, Text, Image, Polygon, Star)
   */
  private renderShape(shape: Shape, zoom: number): void {
    this.ctx.save();

    if (typeof shape.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, shape.opacity));
    }
    if (shape.blendMode && shape.blendMode !== 'normal') {
      this.ctx.globalCompositeOperation = blendModeToCompositeOperation(shape.blendMode);
    }
    if (shape.dropShadow) {
      applyDropShadow(this.ctx, shape.dropShadow);
    }

    if (shape.type === 'rectangle') {
      renderRectangle(this.ctx, shape);
    } else if (shape.type === 'ellipse') {
      renderEllipse(this.ctx, shape);
    } else if (shape.type === 'path') {
      renderPath(this.ctx, shape, zoom);
    } else if (shape.type === 'text') {
      renderText(this.ctx, shape, this.options.textEditProvider?.() ?? null);
    } else if (shape.type === 'image') {
      renderImage(this.ctx, shape, this.stateManager);
    } else if (shape.type === 'polygon') {
      renderPolygon(this.ctx, shape);
    } else if (shape.type === 'star') {
      renderStar(this.ctx, shape);
    }

    this.ctx.restore();
  }

  /**
   * Delegados para preservar compatibilidad con pruebas unitarias que inspeccionan métodos de overlay.
   */
  public renderSingleShapeSelection(shape: Shape, zoom: number): void {
    renderSingleShapeSelection(this.ctx, shape, zoom);
  }

  public renderSingleGroupSelection(group: Group, zoom: number): void {
    renderSingleGroupSelection(this.ctx, group, zoom);
  }

  public renderBoxWithHandles(bounds: import('../types/scene-graph.ts').AABB, zoom: number): void {
    renderBoxWithHandles(this.ctx, bounds, zoom);
  }

  public renderGroupOutline(group: Group, zoom: number): void {
    renderGroupOutline(this.ctx, group, zoom);
  }

  public renderShapeOutline(shape: Shape, zoom: number): void {
    renderShapeOutline(this.ctx, shape, zoom);
  }
}
