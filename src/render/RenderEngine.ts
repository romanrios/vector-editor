import {
  isGroup,
  isShape,
  isText,
  type AABB,
  type Document,
  type Ellipse,
  type Group,
  type Layer,
  type LayerChildNode,
  type Path,
  type Rectangle,
  type SelectableNode,
  type Shape,
  type Text,
} from '../types/scene-graph.ts';
import type { StateManager } from '../state/StateManager.ts';
import {
  getGroupAABB,
  getPathBaseAABB,
  getTextBaseAABB,
  getTextLineHeight,
  getSelectionBounds,
  getShapeAABB,
  getVisiblePathHandles,
} from '../utils/geometry.ts';
import type { ShapePreview } from '../input/InputController.ts';
import { ViewportManager, screenToWorld, type Viewport } from '../utils/viewport.ts';
import { isNonePaint } from '../utils/color.ts';

export interface TextEditRenderState {
  textId: string;
  text: string;
  cursorIndex?: number;
  selectionStart?: number;
  selectionEnd?: number;
  cursorVisible?: boolean;
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
   * Proveedor funcional opcional del estado de edición de nodos para Selección Directa.
   */
  pathEditProvider?: () => { pathId: string; selectedAnchors: ReadonlySet<number> } | null;
  /**
   * Proveedor funcional opcional del estado de edición de texto en curso.
   */
  textEditProvider?: () => TextEditRenderState | null;
  /**
   * Gestor reactivo de la vista (zoom y pan). Si no se proporciona, crea uno nuevo.
   */
  viewportManager?: ViewportManager;
  /**
   * Indica si se dibuja la mesa de trabajo (Artboard).
   * Por defecto es true.
   */
  showArtboard?: boolean;
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

    // Dibujar la mesa de trabajo (Artboard) en el espacio del mundo
    if (this.options.showArtboard !== false) {
      this.renderArtboard(documentState, zoom);
    }

    // Iterar sobre el array de nodos (Document -> Layers -> Shapes)
    this.renderDocument(documentState, zoom);

    // Dibujar caja delimitadora (bounding box) azul con manejadores de tamaño constante
    this.renderSelectionOverlay(documentState, zoom);

    // Dibujar vista previa de creación de figura (trazo punteado y semitransparente)
    const activePreview = this.options.previewProvider?.() ?? null;

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
   * Renderiza la Mesa de Trabajo (Artboard) en el espacio de coordenadas del mundo.
   * Dibuja un rectángulo blanco de (Document.width × Document.height) en el origen (0, 0)
   * con sombra perimetral visual.
   */
  private renderArtboard(document: Document, zoom: number): void {
    const width = document.width;
    const height = document.height;

    if (!width || !height || width <= 0 || height <= 0) {
      return;
    }

    this.ctx.save();

    // Sombra perimetral visual (drop-shadow) escalada por zoom
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    this.ctx.shadowBlur = 24 / zoom;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 4 / zoom;

    // Fondo blanco de la mesa de trabajo
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.restore();

    // Borde delimitador sutil de 1 px en pantalla para definir contornos nítidos
    this.ctx.save();
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    this.ctx.strokeRect(0, 0, width, height);
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
   * Renderiza el contenido de una capa respetando opacidad y visibilidad heredadas.
   */
  private renderLayer(layer: Layer, zoom: number): void {
    this.ctx.save();

    if (typeof layer.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
    }

    for (const child of layer.children) {
      this.renderChildNode(child, zoom);
    }

    this.ctx.restore();
  }

  /**
   * Renderiza recursivamente un nodo hijo (Shape o Group).
   * Si el nodo está oculto (visible === false), se omite junto con todos sus descendientes.
   */
  private renderChildNode(child: LayerChildNode, zoom: number): void {
    if (child.visible === false) {
      return;
    }
    if (isGroup(child)) {
      this.renderGroup(child, zoom);
    } else if (isShape(child)) {
      this.renderShape(child, zoom);
    }
  }

  /**
   * Renderiza un Grupo de forma recursiva multiplicando su opacidad acumulada
   * y aislando el estado gráfico mediante save/restore.
   */
  private renderGroup(group: Group, zoom: number): void {
    if (group.visible === false) {
      return;
    }
    this.ctx.save();

    if (typeof group.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, group.opacity));
    }

    for (const child of group.children) {
      this.renderChildNode(child, zoom);
    }

    this.ctx.restore();
  }

  /**
   * Renderiza una figura según su tipo discriminado (Rectangle, Ellipse, Path o Text)
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
    } else if (shape.type === 'text') {
      this.renderText(shape);
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

    if (!isNonePaint(rect.fill)) {
      this.ctx.fillStyle = rect.fill!;
      this.ctx.fill();
    }

    if (!isNonePaint(rect.stroke) && rect.strokeWidth && rect.strokeWidth > 0) {
      this.ctx.lineWidth = rect.strokeWidth;
      this.ctx.strokeStyle = rect.stroke!;
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

    if (!isNonePaint(ellipse.fill)) {
      this.ctx.fillStyle = ellipse.fill!;
      this.ctx.fill();
    }

    if (!isNonePaint(ellipse.stroke) && ellipse.strokeWidth && ellipse.strokeWidth > 0) {
      this.ctx.lineWidth = ellipse.strokeWidth;
      this.ctx.strokeStyle = ellipse.stroke!;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Dibuja la caja delimitadora (bounding box) y los manejadores de selección.
   * - Con una sola figura: dibuja la caja OBB con manejadores de esquina y rotación.
   * - Con un solo grupo: dibuja la caja delimitadora AABB de grosor constante, SIN tiradores.
   * - Con varias figuras/grupos: dibuja un contorno fino sobre cada elemento y una única caja AABB
   *   combinada (getSelectionBounds) sin tiradores.
   * Mantiene un tamaño constante en pantalla dividiendo las medidas entre el factor de zoom.
   */
  private renderSelectionOverlay(_document: Document, zoom: number): void {
    const selectedNodes: SelectableNode[] = [];
    for (const node of this.stateManager.getSelectedNodes()) {
      if (this.stateManager.isEffectivelyVisible(node.id)) {
        selectedNodes.push(node);
      }
    }

    const pathEdit = this.options.pathEditProvider?.() ?? null;

    if (selectedNodes.length === 0 && !pathEdit) {
      return;
    }

    if (selectedNodes.length === 1) {
      const node = selectedNodes[0];
      if (isGroup(node)) {
        this.renderSingleGroupSelection(node, zoom);
      } else if (isShape(node)) {
        const textEdit = this.options.textEditProvider?.() ?? null;
        if (textEdit && textEdit.textId === node.id && isText(node)) {
          this.renderTextEditOverlay(node, textEdit, zoom);
        } else if (!pathEdit || pathEdit.pathId !== node.id) {
          this.renderSingleShapeSelection(node, zoom);
        }
      }
    } else if (selectedNodes.length > 1) {
      // Múltiples elementos seleccionados:
      // 1. Contorno fino sobre cada elemento seleccionado
      for (const node of selectedNodes) {
        if (isGroup(node)) {
          this.renderGroupOutline(node, zoom);
        } else if (isShape(node)) {
          this.renderShapeOutline(node, zoom);
        }
      }

      // 2. Un recuadro delimitador combinado (getSelectionBounds) con tiradores
      const combinedBounds = getSelectionBounds(selectedNodes);
      if (combinedBounds) {
        this.renderBoxWithHandles(combinedBounds, zoom);
      }
    }

    // Dibujar overlay de edición de trazado DESPUÉS de dibujar todo, para que quede por encima
    if (pathEdit) {
      const pathNode = this.stateManager.findNode(pathEdit.pathId);
      if (pathNode && pathNode.type === 'path' && this.stateManager.isEffectivelyVisible(pathNode.id)) {
        this.renderPathEditOverlay(pathNode as Path, pathEdit, zoom);
      }
    }
  }

  /**
   * Dibuja el recuadro delimitador de un grupo seleccionado con sus 4 tiradores de esquina y de rotación.
   */
  private renderSingleGroupSelection(group: Group, zoom: number): void {
    const aabb = getSelectionBounds([group]) ?? getGroupAABB(group);
    if (!aabb) return;
    this.renderBoxWithHandles(aabb, zoom);
  }

  /**
   * Dibuja la caja delimitadora combinada (AABB), conector vertical, los 4 manejadores cuadrados
   * de esquina y el manejador flotante de rotación para un conjunto (grupo o multiselección).
   */
  private renderBoxWithHandles(bounds: AABB, zoom: number): void {
    const handleSize = 8 / zoom;
    const halfHandle = handleSize / 2;
    const rotationDistance = 30 / zoom;
    const midX = (bounds.minX + bounds.maxX) / 2;
    const rotY = bounds.minY - rotationDistance;

    this.ctx.save();

    // 1. Recuadro delimitador combinado
    this.ctx.strokeStyle = '#2563eb';
    this.ctx.lineWidth = 1.5 / zoom;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

    // 2. Conector vertical sutil hacia el manejador de rotación
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#2563eb';
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.moveTo(midX, bounds.minY);
    this.ctx.lineTo(midX, rotY);
    this.ctx.stroke();

    // 3. Manejadores en las 4 esquinas
    const corners = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];

    for (const corner of corners) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(
        corner.x - halfHandle,
        corner.y - halfHandle,
        handleSize,
        handleSize
      );

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
    } else if (typeof this.ctx.ellipse === 'function') {
      this.ctx.ellipse(midX, rotY, halfHandle, halfHandle, 0, 0, Math.PI * 2);
    }
    this.ctx.fillStyle = '#10b981';
    this.ctx.fill();
    this.ctx.strokeStyle = '#059669';
    this.ctx.lineWidth = 1.5 / zoom;
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * Dibuja un contorno fino de 1px constante sobre un grupo perteneciente a una selección múltiple.
   */
  private renderGroupOutline(group: Group, zoom: number): void {
    const aabb = getGroupAABB(group);
    if (!aabb) return;

    this.ctx.save();
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(aabb.minX, aabb.minY, aabb.width, aabb.height);
    this.ctx.restore();
  }

  /**
   * Dibuja un contorno fino de 1px constante sobre una figura individual perteneciente
   * a una selección múltiple.
   */
  private renderShapeOutline(shape: Shape, zoom: number): void {
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

    this.ctx.save();
    if (rotation) {
      this.ctx.translate(cx, cy);
      this.ctx.rotate((rotation * Math.PI) / 180);
      this.ctx.translate(-cx, -cy);
    }

    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(baseX, baseY, baseWidth, baseHeight);
    this.ctx.restore();
  }

  /**
   * Dibuja la caja delimitadora (Bounding Box) azul orientada y los 4 manejadores cuadrados
   * de redimensionado más el manejador flotante de rotación para una única figura seleccionada.
   */
  private renderSingleShapeSelection(shape: Shape, zoom: number): void {
    const handleSize = 8 / zoom;
    const halfHandle = handleSize / 2;
    const rotationDistance = 30 / zoom;
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
    } else if (shape.type === 'text') {
      const baseAABB = getTextBaseAABB(shape, this.ctx);
      baseX = baseAABB.minX;
      baseY = baseAABB.minY;
      baseWidth = baseAABB.width;
      baseHeight = baseAABB.height;
      cx = shape.x;
      cy = shape.y;
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
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(
        corner.x - halfHandle,
        corner.y - halfHandle,
        handleSize,
        handleSize
      );

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
    } else if (typeof this.ctx.ellipse === 'function') {
      this.ctx.ellipse(midX, rotY, halfHandle, halfHandle, 0, 0, Math.PI * 2);
    }
    this.ctx.fillStyle = '#10b981';
    this.ctx.fill();
    this.ctx.strokeStyle = '#059669';
    this.ctx.lineWidth = 1.5 / zoom;
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * Dibuja un nodo Path utilizando curvas de Bézier cúbicas (bezierCurveTo) en Canvas 2D.
   */
  private renderPath(path: Path, _zoom?: number): void {
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

    if (!isNonePaint(path.fill)) {
      this.ctx.fillStyle = path.fill!;
      this.ctx.fill();
    }

    if (!isNonePaint(path.stroke) && path.strokeWidth && path.strokeWidth > 0) {
      this.ctx.lineWidth = path.strokeWidth;
      this.ctx.strokeStyle = path.stroke!;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Dibuja un nodo Text de una sola línea en Canvas 2D respetando propiedades tipográficas,
   * color de relleno, rotación y alineación.
   *
   * Convención de textBaseline:
   * Se utiliza 'top' de manera consistente para que la coordenada (x, y) represente el ancla
   * superior del texto, asegurando coherencia con las demás figuras del editor (como Rectangle)
   * donde el origen (x, y) define el extremo superior y el eje Y crece hacia abajo.
   */
  private renderText(text: Text): void {
    if (text.fill !== undefined && isNonePaint(text.fill)) {
      return;
    }

    this.ctx.save();

    // 1. Configuración tipográfica (CSS font shorthand: [style] [weight] size family)
    const fontParts: string[] = [];
    if (text.fontStyle && text.fontStyle !== 'normal') {
      fontParts.push(text.fontStyle);
    }
    if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
      fontParts.push(String(text.fontWeight));
    }
    const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
    const fontFamily = text.fontFamily ?? 'sans-serif';
    fontParts.push(`${fontSize}px`);
    fontParts.push(fontFamily);
    this.ctx.font = fontParts.join(' ');

    // 2. Alineación horizontal y vertical
    this.ctx.textAlign = text.textAlign ?? 'left';
    // Convención de alineación vertical: 'top' fija (x, y) en el borde superior del texto.
    this.ctx.textBaseline = 'top';

    // 3. Color de relleno (negro por defecto si no se indica)
    this.ctx.fillStyle = text.fill ?? '#000000';

    // 4. Transformación de rotación respecto a la posición (x, y) del nodo
    if (text.rotation) {
      this.ctx.translate(text.x, text.y);
      this.ctx.rotate((text.rotation * Math.PI) / 180);
      this.ctx.translate(-text.x, -text.y);
    }

    // 5. Dibujo del texto (soporta multilínea)
    const textEdit = this.options.textEditProvider?.() ?? null;
    const isEditingThis = textEdit !== null && textEdit.textId === text.id;
    const displayText = isEditingThis ? textEdit.text : (text.text ?? '');
    const lines = displayText.split('\n');
    const lineHeight = getTextLineHeight(text);

    // 6. Si está en edición y existe selección de caracteres, renderizar el resaltado DETRÁS del texto
    if (
      isEditingThis &&
      textEdit.selectionStart !== undefined &&
      textEdit.selectionEnd !== undefined &&
      textEdit.selectionStart !== textEdit.selectionEnd
    ) {
      this.renderTextSelectionHighlight(
        text,
        displayText,
        textEdit.selectionStart,
        textEdit.selectionEnd,
        fontSize,
        lineHeight
      );
    }

    // 7. Dibujo de cada línea de texto
    for (let i = 0; i < lines.length; i++) {
      const lineY = text.y + i * lineHeight;
      this.ctx.fillText(lines[i], text.x, lineY);
    }

    this.ctx.restore();
  }

  /**
   * Renderiza el recuadro de selección de caracteres detrás del texto dibujado,
   * soportando selección multilínea (primera línea desde inicio, intermedias completas, última hasta fin).
   */
  private renderTextSelectionHighlight(
    text: Text,
    displayText: string,
    selectionStart: number,
    selectionEnd: number,
    fontSize: number,
    lineHeight: number
  ): void {
    const minIdx = Math.max(0, Math.min(displayText.length, Math.min(selectionStart, selectionEnd)));
    const maxIdx = Math.max(0, Math.min(displayText.length, Math.max(selectionStart, selectionEnd)));
    if (minIdx === maxIdx) return;

    const lines = displayText.split('\n');
    const lineStarts: number[] = [];
    let currStart = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStarts.push(currStart);
      currStart += lines[i].length + 1; // +1 por el '\n'
    }

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';

    for (let i = 0; i < lines.length; i++) {
      const lineStart = lineStarts[i];
      const lineText = lines[i];
      const lineEnd = lineStart + lineText.length;

      // Intersección de la selección con el rango de esta línea
      const selStartInLine = Math.max(lineStart, minIdx);
      const selEndInLine = Math.min(lineEnd, maxIdx);

      const hasSelectionInThisLine = selStartInLine < selEndInLine;
      const isNewlineSelected = maxIdx > lineEnd && minIdx <= lineEnd;

      if (!hasSelectionInThisLine && !isNewlineSelected) {
        continue;
      }

      const lineWidth = this.ctx.measureText(lineText).width;
      let lineStartX = text.x;
      if (text.textAlign === 'center') {
        lineStartX = text.x - lineWidth / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x - lineWidth;
      }

      const charStart = Math.max(0, selStartInLine - lineStart);
      const charEnd = Math.max(charStart, selEndInLine - lineStart);

      const wBefore = this.ctx.measureText(lineText.slice(0, charStart)).width;
      let wSelected = this.ctx.measureText(lineText.slice(charStart, charEnd)).width;

      if (isNewlineSelected && wSelected === 0) {
        wSelected = Math.max(6, fontSize * 0.3);
      }

      const lineY = text.y + i * lineHeight;
      this.ctx.fillRect(lineStartX + wBefore, lineY, wSelected, lineHeight);
    }

    this.ctx.restore();
  }

  /**
   * Dibuja la indicación visual de un nodo Text en modo de edición interactiva.
   * Incluye recuadro punteado de acento y cursor/caret en la posición y línea exacta según métricas reales.
   */
  private renderTextEditOverlay(text: Text, textEdit: TextEditRenderState, zoom: number): void {
    const currentText = textEdit.text;
    const tempNode: Text = { ...text, text: currentText };
    const baseAABB = getTextBaseAABB(tempNode, this.ctx);
    const lineHeight = getTextLineHeight(tempNode);

    this.ctx.save();

    if (text.rotation) {
      this.ctx.translate(text.x, text.y);
      this.ctx.rotate((text.rotation * Math.PI) / 180);
      this.ctx.translate(-text.x, -text.y);
    }

    const padding = 3 / zoom;
    const boxX = baseAABB.minX - padding;
    const boxY = baseAABB.minY - padding;
    const boxW = Math.max(6, baseAABB.width) + padding * 2;
    const boxH = Math.max(12, baseAABB.height) + padding * 2;

    // 1. Fondo sutil translúcido para destacar el área activa de escritura
    this.ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    this.ctx.fillRect(boxX, boxY, boxW, boxH);

    // 2. Borde punteado azul primario
    this.ctx.strokeStyle = '#2563eb';
    this.ctx.lineWidth = 1.5 / zoom;
    this.ctx.setLineDash([4 / zoom, 2 / zoom]);
    this.ctx.strokeRect(boxX, boxY, boxW, boxH);

    // 3. Cursor / Caret visible en la posición calculada según métrica tipográfica real
    if (textEdit.cursorVisible !== false) {
      const cursorIndex = Math.max(0, Math.min(currentText.length, textEdit.cursorIndex ?? currentText.length));

      // Configurar fuente para medir prefijo
      const fontParts: string[] = [];
      if (text.fontStyle && text.fontStyle !== 'normal') {
        fontParts.push(text.fontStyle);
      }
      if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
        fontParts.push(String(text.fontWeight));
      }
      const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
      const fontFamily = text.fontFamily ?? 'sans-serif';
      fontParts.push(`${fontSize}px`);
      fontParts.push(fontFamily);
      this.ctx.font = fontParts.join(' ');

      // Determinar en qué línea está el cursor
      const lines = currentText.split('\n');
      let lineIdx = 0;
      let currStart = 0;
      let lineStart = 0;
      for (let i = 0; i < lines.length; i++) {
        const nextStart = currStart + lines[i].length + 1;
        if (cursorIndex <= currStart + lines[i].length || i === lines.length - 1) {
          lineIdx = i;
          lineStart = currStart;
          break;
        }
        currStart = nextStart;
      }

      const currentLine = lines[lineIdx] ?? '';
      const col = Math.max(0, Math.min(currentLine.length, cursorIndex - lineStart));
      const lineWidth = this.ctx.measureText(currentLine).width;

      let lineStartX = text.x;
      if (text.textAlign === 'center') {
        lineStartX = text.x - lineWidth / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x - lineWidth;
      }

      const cursorOffset = this.ctx.measureText(currentLine.slice(0, col)).width;
      const caretX = lineStartX + cursorOffset;
      const caretY = text.y + lineIdx * lineHeight;

      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      this.ctx.moveTo(caretX, caretY);
      this.ctx.lineTo(caretX, caretY + lineHeight);
      this.ctx.strokeStyle = '#2563eb';
      this.ctx.lineWidth = 1.5 / zoom;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Dibuja los manejadores visibles y los puntos de ancla en modo de edición de trazado (Selección Directa).
   */
  private renderPathEditOverlay(
    path: Path,
    state: { pathId: string; selectedAnchors: ReadonlySet<number> },
    zoom: number
  ): void {
    if (!path.points || path.points.length === 0) {
      return;
    }

    this.ctx.save();

    // 1. Aplica la misma transformación de rotación que renderPath (centro de getPathBaseAABB)
    if (path.rotation) {
      const baseAABB = getPathBaseAABB(path);
      const cx = (baseAABB.minX + baseAABB.maxX) / 2;
      const cy = (baseAABB.minY + baseAABB.maxY) / 2;
      this.ctx.translate(cx, cy);
      this.ctx.rotate((path.rotation * Math.PI) / 180);
      this.ctx.translate(-cx, -cy);
    }

    // 2. Dibuja solo los manejadores de getVisiblePathHandles: línea ancla→manejador + círculo
    const handleRadius = 3.5 / zoom;
    const visibleHandles = getVisiblePathHandles(path, state.selectedAnchors);
    for (const h of visibleHandles) {
      // Línea ancla -> manejador
      this.ctx.beginPath();
      this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'; // Celeste suave
      this.ctx.lineWidth = 1 / zoom;
      this.ctx.moveTo(h.anchorX, h.anchorY);
      this.ctx.lineTo(h.x, h.y);
      this.ctx.stroke();

      // Círculo para el manejador
      this.ctx.beginPath();
      this.ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = '#38bdf8';
      this.ctx.fill();
    }

    // 3. Dibuja TODAS las anclas: cuadrado blanco con borde azul; las seleccionadas, rellenas de azul
    const anchorSize = 6 / zoom;
    const halfAnchor = anchorSize / 2;

    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i];
      const isSelected = state.selectedAnchors.has(i);

      this.ctx.fillStyle = isSelected ? '#0284c7' : '#ffffff';
      this.ctx.strokeStyle = '#0284c7';
      this.ctx.lineWidth = 1.5 / zoom;
      this.ctx.fillRect(pt.x - halfAnchor, pt.y - halfAnchor, anchorSize, anchorSize);
      this.ctx.strokeRect(pt.x - halfAnchor, pt.y - halfAnchor, anchorSize, anchorSize);
    }

    this.ctx.restore();
  }

  /**
   * Dibuja la vista previa de una figura en proceso de creación interactiva por arrastre
   * utilizando trazo punteado y relleno semitransparente, manteniendo grosor de trazo constante.
   */
  private renderShapePreview(preview: ShapePreview, zoom: number): void {
    if (preview.type === 'marquee') {
      const minX = Math.min(preview.x, preview.x + preview.width);
      const minY = Math.min(preview.y, preview.y + preview.height);
      const w = Math.abs(preview.width);
      const h = Math.abs(preview.height);

      if (w < 1 && h < 1) {
        return;
      }

      this.ctx.save();
      if (typeof this.ctx.setLineDash === 'function') {
        this.ctx.setLineDash([4 / zoom, 4 / zoom]);
      }
      this.ctx.lineWidth = 1.5 / zoom;
      this.ctx.strokeStyle = '#2563eb';
      this.ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';

      this.ctx.beginPath();
      this.ctx.rect(minX, minY, w, h);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    if (preview.width < 1 && preview.height < 1) {
      return;
    }

    this.ctx.save();

    if (typeof preview.opacity === 'number') {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, preview.opacity));
    }

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

    if (!isNonePaint(preview.fill)) {
      this.ctx.fillStyle = preview.fill!;
      this.ctx.fill();
    }

    const strokeWidth = preview.strokeWidth;
    if (!isNonePaint(preview.stroke) && strokeWidth !== undefined && strokeWidth > 0) {
      this.ctx.lineWidth = strokeWidth;
      this.ctx.strokeStyle = preview.stroke!;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }
}

