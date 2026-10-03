import type { Document, Ellipse, Layer, Path, Rectangle, Shape } from '../types/scene-graph.ts';
import type { StateManager } from '../state/StateManager.ts';
import { getPathBaseAABB, getShapeAABB } from '../utils/geometry.ts';
import type { InputController, ShapePreview } from '../input/InputController.ts';
import { ViewportManager, screenToWorld, type Viewport } from '../utils/viewport.ts';

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
   * Instancia opcional de InputController para consultar la vista previa activa.
   */
  inputController?: InputController;
  /**
   * Proveedor funcional opcional de la vista previa de figuras en creación.
   */
  previewProvider?: () => ShapePreview | null;
  /**
   * Gestor reactivo de la vista (zoom y pan). Si no se proporciona, crea uno nuevo.
   */
  viewportManager?: ViewportManager;
}

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
  private unsubscribeViewport: (() => void) | null = null;

  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private _renderCount: number = 0;
  private resizeHandler: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private inputController: InputController | null = null;
  private preview: ShapePreview | null = null;

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
   * Establece o desvincula la instancia de InputController para la vista previa de creación.
   */
  public setInputController(controller: InputController | null): void {
    this.inputController = controller;
  }

  /**
   * Permite fijar o limpiar directamente una vista previa para testing o renderizado manual.
   */
  public setPreview(preview: ShapePreview | null): void {
    this.preview = preview;
  }

  /**
   * Ajusta el tamaño físico del canvas con respecto a su tamaño CSS y DPI de pantalla.
   */
  public resizeToDisplaySize(): boolean {
    const dpr = this.options.highDpi && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect = this.canvas.getBoundingClientRect();

    const width = Math.max(1, Math.floor((rect.width || (typeof window !== 'undefined' ? window.innerWidth : 800)) * dpr));
    const height = Math.max(1, Math.floor((rect.height || (typeof window !== 'undefined' ? window.innerHeight : 600)) * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
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

      const isStateDirty = this.stateManager.isDirty || Boolean(this.stateManager.getState().isDirty);

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
   * Ejecuta un ciclo de renderizado recorriendo el árbol del Scene Graph.
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
    this.renderGrid(logicalWidth, logicalHeight, viewport);

    // Iterar sobre el array de nodos (Document -> Layers -> Shapes)
    this.renderDocument(documentState, zoom);

    // Dibujar caja delimitadora (bounding box) azul con manejadores de tamaño constante
    this.renderSelectionOverlay(documentState, zoom);

    // Dibujar vista previa de creación de figura (trazo punteado y semitransparente)
    const activePreview =
      this.preview ??
      this.options.previewProvider?.() ??
      this.options.inputController?.shapePreview ??
      this.inputController?.shapePreview ??
      (this.canvas as any).__inputController?.shapePreview ??
      null;

    if (activePreview) {
      this.renderShapePreview(activePreview, zoom);
    }

    this.ctx.restore();
    this._renderCount++;
  }

  /**
   * Dibuja una cuadrícula sutil de fondo alineada con el espacio del documento.
   * Ajusta el espaciado dinámicamente según el nivel de zoom para mantener
   * una densidad visual agradable (~25px a 80px en pantalla) y un grosor constante de 1px.
   */
  private renderGrid(logicalWidth: number, logicalHeight: number, viewport: Viewport): void {
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

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    this.ctx.lineWidth = 1 / zoom;

    this.ctx.beginPath();
    for (let x = startX; x <= endX; x += step) {
      this.ctx.moveTo(x, startY);
      this.ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += step) {
      this.ctx.moveTo(startX, y);
      this.ctx.lineTo(endX, y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Itera sobre las capas (Layer) del Documento
   */
  private renderDocument(document: Document, zoom: number): void {
    for (const layer of document.children) {
      if (layer.visible === false) {
        continue;
      }
      this.renderLayer(layer, zoom);
    }
  }

  /**
   * Itera sobre las figuras (Shape) dentro de una capa
   */
  private renderLayer(layer: Layer, zoom: number): void {
    this.ctx.save();

    if (typeof layer.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
    }

    for (const shape of layer.children) {
      if (shape.visible === false) {
        continue;
      }
      this.renderShape(shape, zoom);
    }

    this.ctx.restore();
  }

  /**
   * Renderiza una figura según su tipo discriminado (Rectangle o Ellipse)
   */
  private renderShape(shape: Shape, zoom: number): void {
    this.ctx.save();

    if (typeof shape.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, shape.opacity));
    }

    if (shape.type === 'rectangle') {
      this.renderRectangle(shape);
    } else if (shape.type === 'ellipse') {
      this.renderEllipse(shape);
    } else if (shape.type === 'path') {
      this.renderPath(shape, zoom);
    }

    this.ctx.restore();
  }

  /**
   * Dibuja un nodo Rectangle aplicando rotación centrada y esquinas redondeadas
   */
  private renderRectangle(rect: Rectangle): void {
    this.ctx.save();

    // Rotación respecto al centro del rectángulo
    if (rect.rotation) {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate((rect.rotation * Math.PI) / 180);
      this.ctx.translate(-cx, -cy);
    }

    this.ctx.beginPath();
    if (rect.cornerRadius && typeof this.ctx.roundRect === 'function') {
      this.ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.cornerRadius);
    } else {
      this.ctx.rect(rect.x, rect.y, rect.width, rect.height);
    }

    if (rect.fill) {
      this.ctx.fillStyle = rect.fill;
      this.ctx.fill();
    }

    if (rect.stroke && rect.strokeWidth) {
      this.ctx.lineWidth = rect.strokeWidth;
      this.ctx.strokeStyle = rect.stroke;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Dibuja un nodo Ellipse con soporte para rotación y radios X/Y
   */
  private renderEllipse(ellipse: Ellipse): void {
    this.ctx.save();

    const rotationRad = ellipse.rotation ? (ellipse.rotation * Math.PI) / 180 : 0;

    this.ctx.beginPath();
    this.ctx.ellipse(
      ellipse.x,
      ellipse.y,
      ellipse.radiusX,
      ellipse.radiusY,
      rotationRad,
      0,
      Math.PI * 2
    );

    if (ellipse.fill) {
      this.ctx.fillStyle = ellipse.fill;
      this.ctx.fill();
    }

    if (ellipse.stroke && ellipse.strokeWidth) {
      this.ctx.lineWidth = ellipse.strokeWidth;
      this.ctx.strokeStyle = ellipse.stroke;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Dibuja la caja delimitadora (bounding box) azul y los manejadores cuadrados en las 4 esquinas
   * para todos los nodos que tengan el flag selected activo.
   * Mantiene un tamaño constante en pantalla dividiendo las medidas entre el factor de zoom.
   */
  private renderSelectionOverlay(document: Document, zoom: number): void {
    const handleSize = 8 / zoom;
    const halfHandle = handleSize / 2;
    const rotationDistance = 30 / zoom;

    for (const layer of document.children) {
      if (layer.visible === false) {
        continue;
      }

      for (const shape of layer.children) {
        if (shape.visible === false || !shape.selected) {
          continue;
        }

        const rotation = shape.rotation ?? 0;

        let baseX = 0;
        let baseY = 0;
        let baseWidth = 0;
        let baseHeight = 0;
        let cx = 0;
        let cy = 0;

        if (!rotation) {
          const aabb = getShapeAABB(shape);
          baseX = aabb.minX;
          baseY = aabb.minY;
          baseWidth = aabb.width;
          baseHeight = aabb.height;
          cx = (baseX + baseWidth) / 2;
          cy = (baseY + baseHeight) / 2;
        } else if (shape.type === 'rectangle') {
          baseX = shape.x;
          baseY = shape.y;
          baseWidth = shape.width;
          baseHeight = shape.height;
          cx = shape.x + shape.width / 2;
          cy = shape.y + shape.height / 2;
        } else if (shape.type === 'ellipse') {
          baseX = shape.x - shape.radiusX;
          baseY = shape.y - shape.radiusY;
          baseWidth = shape.radiusX * 2;
          baseHeight = shape.radiusY * 2;
          cx = shape.x;
          cy = shape.y;
        } else if (shape.type === 'path') {
          const baseAABB = getPathBaseAABB(shape);
          baseX = baseAABB.minX;
          baseY = baseAABB.minY;
          baseWidth = baseAABB.width;
          baseHeight = baseAABB.height;
          cx = (baseAABB.minX + baseAABB.maxX) / 2;
          cy = (baseAABB.minY + baseAABB.maxY) / 2;
        }

        const midX = baseX + baseWidth / 2;
        const rotY = baseY - rotationDistance;

        this.ctx.save();

        if (rotation) {
          this.ctx.translate(cx, cy);
          this.ctx.rotate((rotation * Math.PI) / 180);
          this.ctx.translate(-cx, -cy);
        }

        // 1. Caja delimitadora (Bounding Box) azul
        this.ctx.strokeStyle = '#2563eb'; // Azul primario vibrante
        this.ctx.lineWidth = 1.5 / zoom;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(baseX, baseY, baseWidth, baseHeight);

        // 2. Conector vertical sutil que une el bounding box principal con el manejador flotante
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#2563eb';
        this.ctx.lineWidth = 1 / zoom;
        this.ctx.moveTo(midX, baseY);
        this.ctx.lineTo(midX, rotY);
        this.ctx.stroke();

        // 3. Manejadores (cuadrados en las 4 esquinas)
        const corners = [
          { x: baseX, y: baseY }, // Superior Izquierda
          { x: baseX + baseWidth, y: baseY }, // Superior Derecha
          { x: baseX + baseWidth, y: baseY + baseHeight }, // Inferior Derecha
          { x: baseX, y: baseY + baseHeight }, // Inferior Izquierda
        ];

        for (const corner of corners) {
          // Relleno blanco nítido
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(
            corner.x - halfHandle,
            corner.y - halfHandle,
            handleSize,
            handleSize
          );

          // Borde azul de contraste
          this.ctx.strokeStyle = '#2563eb';
          this.ctx.lineWidth = 1.5 / zoom;
          this.ctx.strokeRect(
            corner.x - halfHandle,
            corner.y - halfHandle,
            handleSize,
            handleSize
          );
        }

        // 4. Manejador de rotación flotante (círculo verde)
        this.ctx.beginPath();
        if (typeof this.ctx.arc === 'function') {
          this.ctx.arc(midX, rotY, halfHandle, 0, Math.PI * 2);
        } else if (typeof (this.ctx as any).ellipse === 'function') {
          (this.ctx as any).ellipse(midX, rotY, halfHandle, halfHandle, 0, 0, Math.PI * 2);
        }
        this.ctx.fillStyle = '#10b981'; // Verde para diferenciarlo visualmente de las esquinas azules
        this.ctx.fill();
        this.ctx.strokeStyle = '#059669'; // Borde verde de definición
        this.ctx.lineWidth = 1.5 / zoom;
        this.ctx.stroke();

        this.ctx.restore();
      }
    }
  }

  /**
   * Dibuja un nodo Path utilizando curvas de Bézier cúbicas (bezierCurveTo) en Canvas 2D.
   */
  private renderPath(path: Path, zoom: number): void {
    if (!path.points || path.points.length === 0) {
      return;
    }

    this.ctx.save();

    if (path.rotation) {
      const baseAABB = getPathBaseAABB(path);
      const cx = (baseAABB.minX + baseAABB.maxX) / 2;
      const cy = (baseAABB.minY + baseAABB.maxY) / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate((path.rotation * Math.PI) / 180);
      this.ctx.translate(-cx, -cy);
    }

    const points = path.points;
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
      const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
      const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
      const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;

      this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
    }

    if (path.closed && points.length > 2) {
      const last = points[points.length - 1];
      const first = points[0];

      const cp1x = last.handleOut ? last.handleOut.x : last.x;
      const cp1y = last.handleOut ? last.handleOut.y : last.y;
      const cp2x = first.handleIn ? first.handleIn.x : first.x;
      const cp2y = first.handleIn ? first.handleIn.y : first.y;

      this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x, first.y);
      this.ctx.closePath();
    }

    if (path.fill && path.fill !== 'transparent' && path.fill !== 'none') {
      this.ctx.fillStyle = path.fill;
      this.ctx.fill();
    }

    if (path.stroke && path.strokeWidth) {
      this.ctx.lineWidth = path.strokeWidth;
      this.ctx.strokeStyle = path.stroke;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    }

    // Si el trazado está seleccionado, dibujar sus puntos de ancla y manejadores de control Bézier
    if (path.selected) {
      this.renderPathControls(path, zoom);
    }

    this.ctx.restore();
  }

  /**
   * Dibuja los puntos de ancla y manejadores de control Bézier para un Path seleccionado
   * con tamaño constante en pantalla.
   */
  private renderPathControls(path: Path, zoom: number): void {
    const handleRadius = 3.5 / zoom;
    const anchorSize = 6 / zoom;

    for (const pt of path.points) {
      this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'; // Celeste suave
      this.ctx.lineWidth = 1 / zoom;

      // Línea y círculo para handleIn
      if (pt.handleIn) {
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x, pt.y);
        this.ctx.lineTo(pt.handleIn.x, pt.handleIn.y);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(pt.handleIn.x, pt.handleIn.y, handleRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = '#38bdf8';
        this.ctx.fill();
      }

      // Línea y círculo para handleOut
      if (pt.handleOut) {
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x, pt.y);
        this.ctx.lineTo(pt.handleOut.x, pt.handleOut.y);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(pt.handleOut.x, pt.handleOut.y, handleRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = '#38bdf8';
        this.ctx.fill();
      }

      // Punto de ancla (cuadrado con borde azul)
      this.ctx.fillStyle = '#ffffff';
      this.ctx.strokeStyle = '#0284c7';
      this.ctx.lineWidth = 1.5 / zoom;
      this.ctx.fillRect(pt.x - anchorSize / 2, pt.y - anchorSize / 2, anchorSize, anchorSize);
      this.ctx.strokeRect(pt.x - anchorSize / 2, pt.y - anchorSize / 2, anchorSize, anchorSize);
    }
  }

  /**
   * Dibuja la vista previa de una figura en proceso de creación interactiva por arrastre
   * utilizando trazo punteado y relleno semitransparente, manteniendo grosor de trazo constante.
   */
  private renderShapePreview(preview: ShapePreview, zoom: number): void {
    if (preview.width < 1 && preview.height < 1) {
      return;
    }

    this.ctx.save();
    if (typeof this.ctx.setLineDash === 'function') {
      this.ctx.setLineDash([6 / zoom, 4 / zoom]);
    }
    this.ctx.lineWidth = 2 / zoom;
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';

    this.ctx.beginPath();
    if (preview.type === 'rectangle') {
      this.ctx.rect(preview.x, preview.y, preview.width, preview.height);
    } else if (preview.type === 'ellipse') {
      const rx = preview.radiusX ?? preview.width / 2;
      const ry = preview.radiusY ?? preview.height / 2;
      if (typeof this.ctx.ellipse === 'function') {
        this.ctx.ellipse(preview.x, preview.y, rx, ry, 0, 0, Math.PI * 2);
      } else if (typeof this.ctx.arc === 'function') {
        this.ctx.arc(preview.x, preview.y, (rx + ry) / 2, 0, Math.PI * 2);
      }
    }

    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.restore();
  }
}

