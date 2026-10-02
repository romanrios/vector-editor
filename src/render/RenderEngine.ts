import type { Document, Ellipse, Layer, Path, Rectangle, Shape } from '../types/scene-graph.ts';
import type { StateManager } from '../state/StateManager.ts';
import { getPathBaseAABB, getShapeAABB } from '../utils/geometry.ts';

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

  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private _renderCount: number = 0;
  private resizeHandler: (() => void) | null = null;

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

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('[RenderEngine] No se pudo obtener el contexto CanvasRenderingContext2D.');
    }
    this.ctx = context;

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
    if (typeof window !== 'undefined' && this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  /**
   * Ejecuta un ciclo de renderizado recorriendo el árbol del Scene Graph.
   */
  public render(): void {
    const documentState = this.stateManager.getState();
    const dpr = this.options.highDpi && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Normalizar escala según DPI
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

    // Dibujar cuadrícula tenue de fondo para referencia visual
    this.renderGrid(logicalWidth, logicalHeight);

    // Iterar sobre el array de nodos (Document -> Layers -> Shapes)
    this.renderDocument(documentState);

    // Dibujar caja delimitadora (bounding box) azul con manejadores para nodos seleccionados
    this.renderSelectionOverlay(documentState);

    this.ctx.restore();
    this._renderCount++;
  }

  /**
   * Dibuja una cuadrícula sutil de fondo
   */
  private renderGrid(width: number, height: number): void {
    const gridSize = 40;
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    this.ctx.lineWidth = 1;

    this.ctx.beginPath();
    for (let x = 0; x < width; x += gridSize) {
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += gridSize) {
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Itera sobre las capas (Layer) del Documento
   */
  private renderDocument(document: Document): void {
    for (const layer of document.children) {
      if (layer.visible === false) {
        continue;
      }
      this.renderLayer(layer);
    }
  }

  /**
   * Itera sobre las figuras (Shape) dentro de una capa
   */
  private renderLayer(layer: Layer): void {
    this.ctx.save();

    if (typeof layer.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
    }

    for (const shape of layer.children) {
      if (shape.visible === false) {
        continue;
      }
      this.renderShape(shape);
    }

    this.ctx.restore();
  }

  /**
   * Renderiza una figura según su tipo discriminado (Rectangle o Ellipse)
   */
  private renderShape(shape: Shape): void {
    this.ctx.save();

    if (typeof shape.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, shape.opacity));
    }

    if (shape.type === 'rectangle') {
      this.renderRectangle(shape);
    } else if (shape.type === 'ellipse') {
      this.renderEllipse(shape);
    } else if (shape.type === 'path') {
      this.renderPath(shape);
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
   */
  private renderSelectionOverlay(document: Document): void {
    for (const layer of document.children) {
      if (layer.visible === false) {
        continue;
      }

      for (const shape of layer.children) {
        if (shape.visible === false || !shape.selected) {
          continue;
        }

        const aabb = getShapeAABB(shape);
        const handleSize = 8;
        const halfHandle = handleSize / 2;
        const midX = (aabb.minX + aabb.maxX) / 2;
        const rotY = aabb.minY - 30;

        this.ctx.save();

        // 1. Caja delimitadora (Bounding Box) azul
        this.ctx.strokeStyle = '#2563eb'; // Azul primario vibrante
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(aabb.minX, aabb.minY, aabb.width, aabb.height);

        // 2. Conector vertical sutil que une el bounding box principal con el manejador flotante
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#2563eb';
        this.ctx.lineWidth = 1;
        this.ctx.moveTo(midX, aabb.minY);
        this.ctx.lineTo(midX, rotY);
        this.ctx.stroke();

        // 3. Manejadores (cuadrados en las 4 esquinas)
        const corners = [
          { x: aabb.minX, y: aabb.minY }, // Superior Izquierda
          { x: aabb.maxX, y: aabb.minY }, // Superior Derecha
          { x: aabb.maxX, y: aabb.maxY }, // Inferior Derecha
          { x: aabb.minX, y: aabb.maxY }, // Inferior Izquierda
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
          this.ctx.lineWidth = 1.5;
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
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        this.ctx.restore();
      }
    }
  }

  /**
   * Dibuja un nodo Path utilizando curvas de Bézier cúbicas (bezierCurveTo) en Canvas 2D.
   */
  private renderPath(path: Path): void {
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
      this.renderPathControls(path);
    }

    this.ctx.restore();
  }

  /**
   * Dibuja los puntos de ancla y manejadores de control Bézier para un Path seleccionado
   */
  private renderPathControls(path: Path): void {
    const handleRadius = 3.5;
    const anchorSize = 6;

    for (const pt of path.points) {
      this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'; // Celeste suave
      this.ctx.lineWidth = 1;

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
      this.ctx.lineWidth = 1.5;
      this.ctx.fillRect(pt.x - anchorSize / 2, pt.y - anchorSize / 2, anchorSize, anchorSize);
      this.ctx.strokeRect(pt.x - anchorSize / 2, pt.y - anchorSize / 2, anchorSize, anchorSize);
    }
  }
}

