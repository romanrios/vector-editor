import type { StateManager, ShapePositionEntry } from '../state/StateManager.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import {
  isGroup,
  isLayer,
  isSelectable,
  isShape,
  type AABB,
  type Ellipse,
  type Group,
  type LayerChildNode,
  type Path,
  type PathPoint,
  type Rectangle,
  type SelectableNode,
  type Shape,
  type Vector2D,
} from '../types/scene-graph.ts';
import {
  computeBoxScale,
  computeRotationDelta,
  getPathBaseAABB,
  getSelectionBounds,
  getSelectionBoxHandles,
  getSelectionHandles,
  getShapeAABB,
  getShapesIntersectingRect,
  getVisiblePathHandles,
  isPointInAABB,
  isPointInPath,
  isPointInShape,
  isSmoothPoint,
  mirrorHandleCollinear,
  normalizeShapeBounds,
  translatePathAnchors,
  type AlignmentMode,
  type DistributionAxis,
  type HandleType,
} from '../utils/geometry.ts';
import {
  rotateShapesAboutPivot,
  scaleShapesAboutAnchor,
  getShapeDimensions,
} from '../utils/transform.ts';
import {
  TransformShapesCommand,
  type ShapeTransformEntry,
} from '../commands/TransformShapesCommand.ts';
import { CommandManager } from '../commands/CommandManager.ts';
import { TranslateCommand } from '../commands/TranslateCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import { ResizeCommand, type ShapeDimensions } from '../commands/ResizeCommand.ts';
import { RotateCommand } from '../commands/RotateCommand.ts';
import { PointCommand } from '../commands/PointCommand.ts';
import { AddShapeCommand } from '../commands/AddShapeCommand.ts';
import { ViewportManager } from '../utils/viewport.ts';
import {
  SelectionOperations,
  type ClipboardList,
  type ClipboardEntry,
  type PreparedClone,
  createClipboardList,
  asShapeArray,
} from './SelectionOperations.ts';

export type ToolMode = 'select' | 'pen' | 'direct-select' | 'rectangle' | 'ellipse' | 'hand';
export type InputControllerEvent = 'toolChange';
export type ToolChangeCallback = (tool: ToolMode) => void;

/**
 * Definición estructurada de un atajo de teclado soportado en el editor
 */
export interface KeyboardShortcut {
  readonly key: string;
  readonly description: string;
  readonly category: string;
}

/**
 * Lista maestra de atajos de teclado reales implementados en InputController
 */
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { key: 'V', description: 'Herramienta Selección', category: 'Herramientas' },
  { key: 'A', description: 'Herramienta Selección directa', category: 'Herramientas' },
  { key: 'P', description: 'Herramienta Pluma (Bézier)', category: 'Herramientas' },
  { key: 'R', description: 'Herramienta Rectángulo', category: 'Herramientas' },
  { key: 'E', description: 'Herramienta Elipse', category: 'Herramientas' },
  { key: 'H', description: 'Herramienta Mano', category: 'Herramientas' },
  { key: 'Ctrl+A / Cmd+A', description: 'Seleccionar todas las figuras', category: 'Selección' },
  { key: 'Shift + Clic', description: 'Añadir / quitar de la selección', category: 'Selección' },
  { key: 'Arrastrar en el vacío', description: 'Selección por marquesina (rectángulo)', category: 'Selección' },
  { key: 'Alt + arrastrar', description: 'Copiar mientras se mueve', category: 'Selección' },
  { key: 'Ctrl+Z / Cmd+Z', description: 'Deshacer última acción', category: 'Edición' },
  { key: 'Ctrl+Shift+Z / Ctrl+Y', description: 'Rehacer última acción', category: 'Edición' },
  { key: 'Ctrl+C / Cmd+C', description: 'Copiar figuras seleccionadas', category: 'Edición' },
  { key: 'Ctrl+V / Cmd+V', description: 'Pegar figuras del portapapeles', category: 'Edición' },
  { key: 'Ctrl+D / Cmd+D', description: 'Duplicar figuras seleccionadas', category: 'Edición' },
  { key: 'Supr / Backspace', description: 'Eliminar figuras seleccionadas', category: 'Edición' },
  { key: 'Ctrl+Shift+]', description: 'Traer figuras al frente', category: 'Objeto' },
  { key: 'Ctrl+Shift+[', description: 'Enviar figuras al fondo', category: 'Objeto' },
  { key: 'Ctrl+G / Cmd+G', description: 'Agrupar figuras seleccionadas', category: 'Objeto' },
  { key: 'Ctrl+Shift+G / Cmd+Shift+G', description: 'Desagrupar figuras seleccionadas', category: 'Objeto' },
  { key: 'Ctrl++ / Cmd++', description: 'Acercar zoom', category: 'Navegación' },
  { key: 'Ctrl+- / Cmd+-', description: 'Alejar zoom', category: 'Navegación' },
  { key: 'Ctrl+0 / Cmd+0', description: 'Ajustar a la ventana', category: 'Navegación' },
  { key: 'Ctrl+1 / Cmd+1', description: 'Tamaño real 100 %', category: 'Navegación' },
  { key: 'Flechas', description: 'Mover figuras seleccionadas (1 px)', category: 'Transformación' },
  { key: 'Shift + Flechas', description: 'Mover figuras seleccionadas (10 px)', category: 'Transformación' },
  { key: 'Shift (al redimensionar)', description: 'Escalar proporcionalmente sin deformar', category: 'Transformación' },
  { key: 'Shift (al arrastrar)', description: 'Restringir proporción 1:1', category: 'Dibujo' },
  { key: 'Escape', description: 'Cancelar creación/marquesina o deseleccionar', category: 'Navegación' },
  { key: 'Enter', description: 'Finalizar trazado Bézier activo', category: 'Dibujo' },
  { key: 'Espacio + Arrastrar', description: 'Desplazar lienzo (Pan)', category: 'Navegación' },
  { key: 'Ctrl + Rueda', description: 'Acercar / Alejar zoom', category: 'Navegación' },
];

export {
  SelectionOperations,
  type ClipboardList,
  type ClipboardEntry,
  createClipboardList,
  asShapeArray,
};

/**
 * Representa el estado y dimensiones de la vista previa de creación de figura por arrastre
 */
export interface ShapePreview {
  readonly type: 'rectangle' | 'ellipse' | 'marquee';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radiusX?: number;
  readonly radiusY?: number;
}

/**
 * Tipo de objetivo seleccionado dentro de un punto de trazado en modo direct-select
 */
export type DirectSelectTargetType = 'anchor' | 'handleIn' | 'handleOut';

/**
 * Representa el objetivo de arrastre o subselección en la herramienta Selección Directa
 */
export interface DirectSelectTarget {
  readonly pathId: string;
  readonly pointIndex: number;
  readonly index: number;
  readonly type: DirectSelectTargetType;
  readonly targetType: DirectSelectTargetType;
  readonly handleType: DirectSelectTargetType;
}

export interface MultiTransformState {
  type: 'scale' | 'rotate';
  leafShapes: readonly Shape[];
  initialBounds: AABB;
  anchorOrPivot: Vector2D;
  startMouse: Vector2D;
  lastMouse: Vector2D;
  handle?: HandleType;
}

export interface InputControllerOptions {
  /**
   * Permite deseleccionar al hacer clic en un área vacía del lienzo (en modo select).
   * Por defecto true.
   */
  deselectOnEmptyClick?: boolean;
  /**
   * Habilita los atajos de teclado globales (Ctrl+Z, Ctrl+Y, 'P' para pluma, 'V' para selección, 'A' para selección directa).
   * Por defecto true.
   */
  enableKeyboardShortcuts?: boolean;
  /**
   * Gestor reactivo de la vista (zoom y pan). Si no se proporciona, crea uno nuevo.
   */
  viewportManager?: ViewportManager;
}

/**
 * Controlador de entrada interactivo para el editor vectorial.
 * Gestiona herramientas de Selección ('select') y Pluma ('pen') con curvas de Bézier cúbicas,
 * hit-testing avanzado con ctx.isPointInPath() / ray-casting, y arrastre con registro en CommandManager.
 */
export class InputController {
  private readonly canvas: HTMLCanvasElement;
  public readonly stateManager: StateManager;
  public readonly commandManager: CommandManager;
  private readonly options: InputControllerOptions;
  public readonly viewportManager: ViewportManager;

  private _currentTool: ToolMode = 'select';

  // Listeners de eventos
  private onMouseDownHandler: (e: MouseEvent) => void;
  private onDoubleClickHandler: (e: MouseEvent) => void;
  private onMouseMoveHandler: (e: MouseEvent) => void;
  private onMouseUpHandler: (e: MouseEvent) => void;
  private onWheelHandler: (e: WheelEvent) => void;
  private onKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  // Estado de navegación de vista (Pan y Zoom)
  private _isPanning: boolean = false;
  private _isSpacePressed: boolean = false;
  private _panStartScreen: { x: number; y: number } | null = null;

  // Estado de creación interactiva de figuras (modos 'rectangle' y 'ellipse')
  private _isCreatingShape: boolean = false;
  private _creationStart: Vector2D | null = null;
  private _creationCurrent: Vector2D | null = null;
  private _creationShiftKey: boolean = false;
  private _shapePreview: ShapePreview | null = null;
  private rectangleCounter: number = 0;
  private ellipseCounter: number = 0;

  // Estado del arrastre (modo Selección)
  private _isDragging: boolean = false;
  private dragOrigin: { x: number; y: number } | null = null;
  private initialShapesPositions: Map<string, { x: number; y: number }> | null = null;
  private pendingSingleSelectionId: string | null = null;
  private dragStartScreen: { x: number; y: number } | null = null;
  private hasMovedPastThreshold: boolean = false;
  private _isCopyDragging: boolean = false;
  private originalSelectionIds: readonly string[] = [];
  private originalLeafPositions: Map<string, { x: number; y: number }> | null = null;
  private activeClonePlacements: PreparedClone[] | null = null;

  // Estado del rectángulo de selección marquesina (modo Selección)
  private _isMarqueeSelecting: boolean = false;
  private _marqueeStartWorld: { x: number; y: number } | null = null;
  private _marqueeStartScreen: { x: number; y: number } | null = null;
  private _marqueeShiftKey: boolean = false;
  private _marqueeInitialSelection: readonly string[] = [];
  private _hasMarqueeDragged: boolean = false;

  // Estado del redimensionado por manejadores de esquina (modo Selección)
  private _isResizing: boolean = false;
  private resizeOrigin: { x: number; y: number } | null = null;
  private _lastResizeMousePos: { x: number; y: number } | null = null;
  private activeResizeHandle: HandleType | null = null;
  private resizingShapeId: string | null = null;
  private initialDimensions: ShapeDimensions | null = null;

  // Estado de rotación (modo Selección)
  private _isRotating: boolean = false;
  private rotatingShapeId: string | null = null;
  private initialRotation: number | null = null;
  private rotationAngleOffset: number = 0;
  private rotationCentroid: { x: number; y: number } | null = null;

  // Estado de escalado y rotación de conjuntos (grupo o 2+ figuras seleccionadas)
  private _multiTransformState: MultiTransformState | null = null;

  // Operaciones sobre la selección
  private _selectionOperations: SelectionOperations;

  // Estado de la herramienta Selección Directa (modo 'direct-select')
  private _draggedPointIndex: number | null = null;
  private _draggedTargetType: DirectSelectTargetType | null = null;
  private _draggedPointTarget: DirectSelectTarget | null = null;
  private _dragTarget: DirectSelectTarget | null = null;
  private _directSelectTarget: DirectSelectTarget | null = null;
  private _isDraggingPoint: boolean = false;
  private directSelectOrigin: { x: number; y: number } | null = null;
  private initialPathPoints: readonly PathPoint[] | null = null;
  private _selectedAnchors: Set<number> = new Set();
  private _anchorsPathId: string | null = null;
  private _isDraggedPointSmooth: boolean = false;

  // Estado de la herramienta Pluma (modo Pen)
  private activePathId: string | null = null;
  private isCreatingAnchor: boolean = false;
  private currentAnchorIndex: number = -1;
  private _penAnchorIndex: number = -1;
  private _penSelectedAnchors: Set<number> = new Set();

  private _hoveredShapeId: string | null = null;

  // Event Emitter para observabilidad externa desacoplada del DOM
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(
    canvas: HTMLCanvasElement,
    stateManager: StateManager,
    commandManager?: CommandManager,
    options: InputControllerOptions = {}
  ) {
    this.canvas = canvas;
    this.stateManager = stateManager;
    this.commandManager = commandManager ?? new CommandManager();
    this._selectionOperations = new SelectionOperations(this.stateManager, this.commandManager);
    this.options = {
      deselectOnEmptyClick: true,
      enableKeyboardShortcuts: true,
      ...options,
    };
    this.viewportManager = options.viewportManager ?? new ViewportManager();

    this.onMouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e);
    this.onDoubleClickHandler = (e: MouseEvent) => this.handleDoubleClick(e);
    this.onMouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
    this.onMouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);
    this.onWheelHandler = (e: WheelEvent) => this.handleWheel(e);

    this.attachEventListeners();
  }

  public get isPanning(): boolean {
    return this._isPanning;
  }

  public get isSpacePressed(): boolean {
    return this._isSpacePressed;
  }

  public get currentTool(): ToolMode {
    return this._currentTool;
  }

  /**
   * Cambia la herramienta activa en el editor.
   *
   * Reglas de transición y coexistencia con selecciones múltiples:
   * - Si hay un rectángulo de selección marquesina activo al cambiar de herramienta, se cancela y limpia.
   * - Al entrar a 'direct-select': solo opera con exactamente un trazado; si hay varias figuras
   *   seleccionadas, reduce la selección a una sola figura (priorizando el primer Path seleccionado si existe).
   * - La herramienta 'pen' (Pluma) ignora cualquier selección preexistente al crear nuevos trazados.
   * - Al conmutar entre otras herramientas, la selección actual en StateManager se preserva intacta.
   */
  public setTool(tool: ToolMode): void {
    if (this._currentTool === tool) return;

    if (this._isMarqueeSelecting) {
      this.cancelMarquee();
    }
    if (this._currentTool === 'pen' && tool !== 'pen') {
      this.finishActivePath();
    }
    if (this._currentTool === 'direct-select' && tool !== 'direct-select') {
      this.resetDirectSelect();
    }
    if (
      (this._currentTool === 'rectangle' || this._currentTool === 'ellipse') &&
      tool !== 'rectangle' &&
      tool !== 'ellipse'
    ) {
      this.cancelCreation();
    }
    if (this._isRotating) {
      if (this.rotatingShapeId && this.initialRotation !== null) {
        this.stateManager.updateShape(this.rotatingShapeId, { rotation: this.initialRotation });
      }
      this.resetRotate();
    }
    if (this._multiTransformState) {
      this.resetMultiTransform();
    }

    if (tool === 'direct-select' && this.stateManager.getSelection().length > 1) {
      const selectedNodes = this.stateManager.getSelectedNodes();
      const firstPath = selectedNodes.find((n) => n.type === 'path');
      if (firstPath) {
        this.stateManager.selectNode(firstPath.id);
      } else {
        this.stateManager.selectNode(selectedNodes[0].id);
      }
    }

    this._currentTool = tool;
    if (tool === 'hand') {
      this.canvas.style.cursor = 'grab';
    } else if (tool === 'pen' || tool === 'rectangle' || tool === 'ellipse') {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }
    this.stateManager.markDirty();
    this.emit('toolChange', tool);
  }

  /**
   * Registra un oyente de eventos (Event Emitter) en el controlador de entrada.
   * Notifica a la UI externa desacoplando la lógica del canvas de la manipulación del DOM.
   *
   * @param event Nombre del evento ('toolChange')
   * @param listener Callback ejecutado al emitirse el evento
   * @returns Función de desuscripción
   */
  public on(event: 'toolChange', listener: ToolChangeCallback): () => void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(listener as (data: any) => void);
    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Remueve un oyente previamente registrado.
   */
  public off(event: 'toolChange', listener: ToolChangeCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener as (data: any) => void);
    }
  }

  /**
   * Emite un evento a todos los suscriptores registrados.
   */
  public emit(event: 'toolChange', tool: ToolMode): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(tool);
      }
    }
  }

  public get isDragging(): boolean {
    return this._isDragging;
  }

  public get isCopyDragging(): boolean {
    return this._isCopyDragging;
  }

  public get isCreatingShape(): boolean {
    return this._isCreatingShape;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public get isMarqueeSelecting(): boolean {
    return this._isMarqueeSelecting;
  }

  /**
   * Cancela el rectángulo de selección interactivo (marquesina),
   * restaurando la selección previa a su inicio y limpiando la vista previa.
   */
  public cancelMarquee(): void {
    if (!this._isMarqueeSelecting) {
      return;
    }
    this.stateManager.setSelection(this._marqueeInitialSelection);
    this._isMarqueeSelecting = false;
    this._marqueeStartWorld = null;
    this._marqueeStartScreen = null;
    this._marqueeShiftKey = false;
    this._marqueeInitialSelection = [];
    this._hasMarqueeDragged = false;
    this._shapePreview = null;
    this.stateManager.markDirty();
  }

  public get isResizing(): boolean {
    return this._isResizing;
  }

  public get isRotating(): boolean {
    return this._isRotating;
  }

  public get isMultiTransforming(): boolean {
    return this._multiTransformState !== null;
  }

  public get multiTransformState(): MultiTransformState | null {
    return this._multiTransformState;
  }

  public get rotatingNodeId(): string | null {
    return this.rotatingShapeId;
  }

  public get initialRotateAngle(): number | null {
    return this.initialRotation;
  }

  public get draggedPointIndex(): number | null {
    return this._draggedPointIndex;
  }

  public get draggedTargetType(): DirectSelectTargetType | null {
    return this._draggedTargetType;
  }

  public get draggedPointTarget(): DirectSelectTarget | null {
    return this._draggedPointTarget;
  }

  public get dragTarget(): DirectSelectTarget | null {
    return this._dragTarget;
  }

  public get directSelectTarget(): DirectSelectTarget | null {
    return this._directSelectTarget;
  }

  public get pathEditState(): { pathId: string; selectedAnchors: ReadonlySet<number> } | null {
    if (this._currentTool === 'pen') {
      if (this.activePathId !== null) {
        const pathNode = this.stateManager.findNode(this.activePathId) as Path | null;
        if (pathNode && pathNode.type === 'path' && pathNode.points && pathNode.points.length > 0) {
          const lastIndex = pathNode.points.length - 1;
          if (this._penAnchorIndex !== lastIndex) {
            this._penAnchorIndex = lastIndex;
            this._penSelectedAnchors = new Set([lastIndex]);
          }
          return {
            pathId: this.activePathId,
            selectedAnchors: this._penSelectedAnchors,
          };
        }
      }
      return null;
    }

    if (this._currentTool === 'direct-select') {
      const selection = this.stateManager.getSelection();
      if (selection.length === 1) {
        const selectedId = selection[0];
        const node = this.stateManager.findNode(selectedId);
        if (node && node.type === 'path') {
          if (this._anchorsPathId !== selectedId) {
            this._selectedAnchors.clear();
            this._anchorsPathId = selectedId;
          }
          return {
            pathId: selectedId,
            selectedAnchors: this._selectedAnchors,
          };
        }
      }
      if (this._anchorsPathId !== null || this._selectedAnchors.size > 0) {
        this._selectedAnchors.clear();
        this._anchorsPathId = null;
      }
      return null;
    }

    return null;
  }

  public get isDraggingPoint(): boolean {
    return this._isDraggingPoint;
  }

  public get resizeOriginPoint(): { x: number; y: number } | null {
    return this.resizeOrigin;
  }

  public get currentResizeHandle(): HandleType | null {
    return this.activeResizeHandle;
  }

  public get resizingNodeId(): string | null {
    return this.resizingShapeId;
  }

  public get initialResizeDimensions(): ShapeDimensions | null {
    return this.initialDimensions;
  }

  public get hoveredShapeId(): string | null {
    return this._hoveredShapeId;
  }

  public get activePenPathId(): string | null {
    return this.activePathId;
  }

  public get clipboard(): (readonly Shape[] & { readonly id?: string }) | null {
    return this._selectionOperations.clipboard;
  }

  public get pasteCount(): number {
    return this._selectionOperations.pasteCount;
  }

  public get selectionOperations(): SelectionOperations {
    return this._selectionOperations;
  }

  public static readonly SHORTCUTS: readonly KeyboardShortcut[] = KEYBOARD_SHORTCUTS;

  /**
   * Retorna la lista inmutable de atajos de teclado reales soportados por el controlador.
   */
  public getShortcuts(): readonly KeyboardShortcut[] {
    return KEYBOARD_SHORTCUTS;
  }

  /**
   * Conecta los listeners de mouse al canvas y teclado a la ventana.
   */
  private attachEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDownHandler);
    this.canvas.addEventListener('dblclick', this.onDoubleClickHandler);
    this.canvas.addEventListener('mousemove', this.onMouseMoveHandler);
    this.canvas.addEventListener('wheel', this.onWheelHandler, { passive: false });

    if (typeof window !== 'undefined') {
      window.addEventListener('mouseup', this.onMouseUpHandler);
    } else {
      this.canvas.addEventListener('mouseup', this.onMouseUpHandler);
    }

    if (this.options.enableKeyboardShortcuts) {
      this.onKeyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
      this.onKeyUpHandler = (e: KeyboardEvent) => this.handleKeyUp(e);

      if (typeof window !== 'undefined') {
        window.addEventListener('keydown', this.onKeyDownHandler);
        window.addEventListener('keyup', this.onKeyUpHandler);
      } else {
        this.canvas.addEventListener('keydown', this.onKeyDownHandler);
        this.canvas.addEventListener('keyup', this.onKeyUpHandler);
      }
    }
  }

  /**
   * Remueve los listeners de eventos para evitar fugas de memoria.
   */
  public destroy(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDownHandler);
    this.canvas.removeEventListener('dblclick', this.onDoubleClickHandler);
    this.canvas.removeEventListener('mousemove', this.onMouseMoveHandler);
    this.canvas.removeEventListener('wheel', this.onWheelHandler);

    if (typeof window !== 'undefined') {
      window.removeEventListener('mouseup', this.onMouseUpHandler);
      if (this.onKeyDownHandler) {
        window.removeEventListener('keydown', this.onKeyDownHandler);
        this.onKeyDownHandler = null;
      }
      if (this.onKeyUpHandler) {
        window.removeEventListener('keyup', this.onKeyUpHandler);
        this.onKeyUpHandler = null;
      }
    } else {
      this.canvas.removeEventListener('mouseup', this.onMouseUpHandler);
      if (this.onKeyDownHandler) {
        this.canvas.removeEventListener('keydown', this.onKeyDownHandler);
        this.onKeyDownHandler = null;
      }
      if (this.onKeyUpHandler) {
        this.canvas.removeEventListener('keyup', this.onKeyUpHandler);
        this.onKeyUpHandler = null;
      }
    }

    this._isPanning = false;
    this._isSpacePressed = false;
    this._panStartScreen = null;

    this.cancelCreation();
    this.resetDrag();
    this.resetResize();
    this.resetRotate();
    this.resetMultiTransform();
    this.resetDirectSelect();
    this.eventListeners.clear();
  }

  /**
   * Calcula las coordenadas locales del cursor relativas al documento (espacio del Scene Graph).
   * Transforma las coordenadas de pantalla mediante screenToWorld de viewport.
   */
  public getLocalCoordinates(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return this.viewportManager.screenToWorld({ x: screenX, y: screenY });
  }

  /**
   * Obtiene las coordenadas del cursor en píxeles de pantalla (CSS) relativas al canvas.
   */
  public getScreenCoordinates(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  /**
   * Maneja el evento de rueda (wheel) para zoom y pan:
   * - Ctrl/Cmd + Rueda (y pellizco de trackpad con ctrlKey): zoom hacia el cursor con factor exponencial.
   * - Rueda estándar: desplazamiento (pan) horizontal y vertical.
   */
  public handleWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const screenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const factor = Math.exp(-event.deltaY * 0.0025);
      this.viewportManager.zoomAt(screenPoint, factor);
    } else {
      event.preventDefault();
      this.viewportManager.panBy(-event.deltaX, -event.deltaY);
    }
  }

  /**
   * Restaura el cursor por defecto asociado a la herramienta activa.
   */
  private restoreToolCursor(): void {
    if (this._currentTool === 'hand') {
      this.canvas.style.cursor = 'grab';
    } else if (this._currentTool === 'pen' || this._currentTool === 'rectangle' || this._currentTool === 'ellipse') {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Obtiene el centro del lienzo en coordenadas de pantalla (píxeles CSS).
   */
  public getCanvasCenter(): Vector2D {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : null;
    const width = rect?.width || this.canvas.width || 800;
    const height = rect?.height || this.canvas.height || 600;
    return { x: width / 2, y: height / 2 };
  }

  /**
   * Obtiene las dimensiones del contenedor del lienzo en píxeles CSS.
   */
  public getCanvasSize(): { width: number; height: number } {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : null;
    const width = rect?.width || this.canvas.width || 800;
    const height = rect?.height || this.canvas.height || 600;
    return { width, height };
  }

  /**
   * Calcula la envolvente (AABB) conjunta de todas las figuras visibles de todas las capas visibles.
   * Retorna null si el documento está vacío o no contiene figuras visibles.
   */
  public getVisibleWorldBounds(): AABB | null {
    const documentState = this.stateManager.getState();
    const layers = documentState.children;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;

    for (const layer of layers) {
      if (layer.visible === false) continue;
      for (const shape of layer.children) {
        if (shape.visible === false) continue;
        if (isShape(shape)) {
          const aabb = getShapeAABB(shape);
          if (aabb.minX < minX) minX = aabb.minX;
          if (aabb.minY < minY) minY = aabb.minY;
          if (aabb.maxX > maxX) maxX = aabb.maxX;
          if (aabb.maxY > maxY) maxY = aabb.maxY;
          count++;
        }
      }
    }

    if (count === 0 || !Number.isFinite(minX)) {
      return null;
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Incrementa el zoom por un factor fijo de 1.25 centrado en el medio del lienzo.
   */
  public zoomIn(): void {
    this.viewportManager.zoomAt(this.getCanvasCenter(), 1.25);
  }

  /**
   * Reduce el zoom por un factor fijo de 1 / 1.25 (0.8) centrado en el medio del lienzo.
   */
  public zoomOut(): void {
    this.viewportManager.zoomAt(this.getCanvasCenter(), 1 / 1.25);
  }

  /**
   * Restablece el zoom al 100% (escala 1.0) manteniendo centrado el centro del lienzo.
   */
  public zoomReset(): void {
    this.viewportManager.resetZoom(this.getCanvasCenter());
  }

  /**
   * Ajusta la vista para encajar todo el contenido visible de las capas con un margen confortable.
   * Si no hay figuras visibles o el documento está vacío, restablece la vista al estado por defecto.
   */
  public zoomFit(): void {
    const canvasSize = this.getCanvasSize();
    const bounds = this.getVisibleWorldBounds();
    this.viewportManager.fitToBounds(canvasSize, bounds, 40);
  }

  /**
   * Evalúa recursivamente si un nodo (figura o grupo) es alcanzado por las coordenadas (x, y).
   * Ignora nodos efectivamente ocultos o bloqueados (tanto a nivel de nodo como ancestros).
   * Recorre los hijos de arriba hacia abajo (mayor Z-index a menor).
   */
  private hitTestNode(
    node: LayerChildNode,
    x: number,
    y: number,
    ctx: CanvasRenderingContext2D | null,
    zoom: number
  ): Shape | null {
    if (node.visible === false || node.locked === true) {
      return null;
    }

    if (isGroup(node)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const hit = this.hitTestNode(node.children[i], x, y, ctx, zoom);
        if (hit) {
          return hit;
        }
      }
      return null;
    }

    if (isShape(node)) {
      if (node.type === 'path') {
        if (isPointInPath(x, y, node, ctx, 8 / zoom)) {
          return node;
        }
      } else {
        const tolerance = 4 / zoom;
        if (isPointInShape(x, y, node, tolerance)) {
          return node;
        }
      }
    }

    return null;
  }

  /**
   * Realiza hit-testing matemático recorriendo el Scene Graph recursivamente de arriba abajo
   * (desde el elemento superior visualmente con mayor Z-index hacia el fondo).
   *
   * Ignora figuras efectivamente ocultas o bloqueadas (capa y ancestros).
   * Utiliza ctx.isPointInPath() o ray-casting poligonal para figuras de tipo Path,
   * y colisión AABB para rectángulos y elipses.
   * Aplica tolerancia constante en píxeles de pantalla dividida por el zoom.
   */
  public hitTest(x: number, y: number): Shape | null {
    const documentState = this.stateManager.getState();
    const layers = documentState.children;
    const ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    const zoom = this.viewportManager.zoom;

    for (let l = layers.length - 1; l >= 0; l--) {
      const layer = layers[l];
      if (layer.visible === false || layer.locked === true) {
        continue;
      }

      const children = layer.children;
      for (let s = children.length - 1; s >= 0; s--) {
        const hit = this.hitTestNode(children[s], x, y, ctx, zoom);
        if (hit) {
          return hit;
        }
      }
    }

    return null;
  }

  /**
   * Encuentra el ancestro grupo más externo de un nodo en el documento.
   * Si el nodo está directamente en una capa, retorna el nodo mismo.
   */
  private getOutermostGroupOrSelf(node: SelectableNode): SelectableNode {
    let current: SelectableNode = node;
    while (true) {
      const parent = this.stateManager.findParent(current.id);
      if (!parent || isLayer(parent)) {
        return current;
      }
      if (isGroup(parent)) {
        current = parent;
      } else {
        break;
      }
    }
    return current;
  }

  /**
   * Dado un grupo G y un descendiente target (figura o grupo anidado),
   * encuentra el hijo directo de G que contiene o es target.
   * Si target no es descendiente de G, retorna null.
   */
  private findDirectChildInGroup(group: Group, target: SelectableNode): SelectableNode | null {
    let current: SelectableNode = target;
    while (true) {
      const parent = this.stateManager.findParent(current.id);
      if (!parent) return null;
      if (parent.id === group.id) {
        return current;
      }
      if (isLayer(parent) || !isGroup(parent)) {
        return null;
      }
      current = parent;
    }
  }

  /**
   * Resuelve qué nodo debe seleccionarse al hacer clic sobre una figura:
   * 1. Si hay exactamente un nodo seleccionado dentro de un grupo G y el clic
   *    cae sobre otro elemento de G, selecciona el hermano de ese mismo nivel.
   * 2. Si el clic cae fuera de G, o no se está dentro de ese contexto,
   *    selecciona el grupo más externo que contiene a la figura (o a la figura si no está en ningún grupo).
   */
  private resolveNodeToSelect(hitShape: Shape): SelectableNode {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1) {
      const currentSelected = selectedNodes[0];
      const parent = this.stateManager.findParent(currentSelected.id);
      if (parent && isGroup(parent)) {
        const directChild = this.findDirectChildInGroup(parent, hitShape);
        if (directChild) {
          return directChild;
        }
      }
    }

    return this.getOutermostGroupOrSelf(hitShape);
  }

  /**
   * Maneja el evento dblclick (doble clic) en el lienzo.
   * Desciende un nivel en la jerarquía, seleccionando el hijo directo del grupo seleccionado
   * que está bajo el cursor (grupo o figura).
   */
  public handleDoubleClick(event: MouseEvent): void {
    if (this._currentTool !== 'select') {
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);
    const hitShape = this.hitTest(x, y);
    if (!hitShape) {
      return;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isGroup(selectedNodes[0])) {
      const selectedGroup = selectedNodes[0];
      const directChild = this.findDirectChildInGroup(selectedGroup, hitShape);
      if (directChild) {
        this.stateManager.setSelection([directChild.id]);
        this.resetDrag();
        this.resetResize();
        this.resetRotate();
      }
    }
  }

  /**
   * Finaliza el trazado en curso de la herramienta Pluma.
   */
  public finishActivePath(closed: boolean = false): void {
    if (!this.activePathId) return;

    if (closed) {
      this.stateManager.updateShape<Path>(this.activePathId, (p) => ({
        ...p,
        closed: true,
      }));
    }

    this.activePathId = null;
    this.isCreatingAnchor = false;
    this.currentAnchorIndex = -1;
    this._penAnchorIndex = -1;
    this._penSelectedAnchors = new Set();
    this.stateManager.markDirty();
  }

  /**
   * Maneja el evento mousedown según la herramienta activa ('select' o 'pen').
   */
  public handleMouseDown(event: MouseEvent): void {
    // 0. Gestos de navegación de vista: Paneo con botón central (1), Espacio + botón principal (0), o herramienta Mano con botón principal (0)
    const isHandPan = this._currentTool === 'hand' && (event.button === 0 || event.button === undefined);
    if (event.button === 1 || (this._isSpacePressed && (event.button === 0 || event.button === undefined)) || isHandPan) {
      event.preventDefault?.();
      this._isPanning = true;
      this._panStartScreen = { x: event.clientX, y: event.clientY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);

    if (this._currentTool === 'rectangle' || this._currentTool === 'ellipse') {
      this._isCreatingShape = true;
      this._creationStart = { x, y };
      this._creationCurrent = { x, y };
      this._creationShiftKey = Boolean(event.shiftKey);
      this.updateShapePreview();
      this.stateManager.markDirty();
      return;
    }

    if (this._currentTool === 'pen') {
      this.handlePenMouseDown(x, y);
      return;
    }

    if (this._currentTool === 'direct-select') {
      this.handleDirectSelectMouseDown(x, y, Boolean(event.shiftKey));
      return;
    }

    // Modo 'select'
    // 1. Manejadores de redimensionado y rotación:
    const selectedNodes = this.stateManager.getSelectedNodes();
    const isMultiOrGroup = selectedNodes.length >= 2 || (selectedNodes.length === 1 && isGroup(selectedNodes[0]));

    if (isMultiOrGroup) {
      const bounds = getSelectionBounds(selectedNodes);
      if (bounds) {
        const zoom = this.viewportManager.zoom;
        const handles = getSelectionBoxHandles(bounds, 8 / zoom, 30 / zoom);
        const hitHandle = handles.find((handle) => isPointInAABB(x, y, handle));

        if (hitHandle) {
          const leafShapes = getLeafShapes(selectedNodes);
          if (hitHandle.type === 'rotation-handle') {
            const pivot: Vector2D = {
              x: (bounds.minX + bounds.maxX) / 2,
              y: (bounds.minY + bounds.maxY) / 2,
            };
            this._multiTransformState = {
              type: 'rotate',
              leafShapes,
              initialBounds: bounds,
              anchorOrPivot: pivot,
              startMouse: { x, y },
              lastMouse: { x, y },
            };
            this.canvas.style.cursor = 'crosshair';
            return;
          } else {
            const { anchor } = computeBoxScale(bounds, hitHandle.type, 0, 0, false);
            this._multiTransformState = {
              type: 'scale',
              leafShapes,
              initialBounds: bounds,
              anchorOrPivot: anchor,
              startMouse: { x, y },
              lastMouse: { x, y },
              handle: hitHandle.type,
            };
            this.canvas.style.cursor = this.getResizeCursor(hitHandle.type, 0);
            return;
          }
        }
      }
    } else if (selectedNodes.length === 1) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && isShape(selectedNode)) {
        const zoom = this.viewportManager.zoom;
        const handles = getSelectionHandles(selectedNode, 8 / zoom, 30 / zoom);
        const hitHandle = handles.find((handle) => isPointInAABB(x, y, handle));

        if (hitHandle) {
          if (hitHandle.type === 'rotation-handle') {
            this._isRotating = true;
            this._isResizing = false;
            this._isDragging = false;
            this.rotatingShapeId = selectedNode.id;
            this.initialRotation = selectedNode.rotation ?? 0;

            const centroid = this.getShapeCentroid(selectedNode);
            this.rotationCentroid = centroid;
            const clickAngle = (Math.atan2(y - centroid.y, x - centroid.x) * 180) / Math.PI;
            const expectedHandleAngle = this.initialRotation - 90;
            let offset = clickAngle - expectedHandleAngle;
            while (offset > 180) offset -= 360;
            while (offset <= -180) offset += 360;
            this.rotationAngleOffset = offset;

            this.canvas.style.cursor = 'crosshair';
            return;
          }

          // Marca la bandera _isResizing = true (y el origen del resize) en lugar de _isDragging
          this._isResizing = true;
          this._isDragging = false;
          this._isRotating = false;
          this.resizeOrigin = { x, y };
          this._lastResizeMousePos = { x, y };
          this.activeResizeHandle = hitHandle.type;
          this.resizingShapeId = selectedNode.id;

          if (selectedNode.type === 'rectangle') {
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              width: selectedNode.width,
              height: selectedNode.height,
              rotation: selectedNode.rotation ?? 0,
            };
          } else if (selectedNode.type === 'ellipse') {
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              radiusX: selectedNode.radiusX,
              radiusY: selectedNode.radiusY,
              rotation: selectedNode.rotation ?? 0,
            };
          } else if (selectedNode.type === 'path') {
            const aabb = getPathBaseAABB(selectedNode);
            this.initialDimensions = {
              x: selectedNode.x,
              y: selectedNode.y,
              width: aabb.width,
              height: aabb.height,
              points: selectedNode.points,
              rotation: selectedNode.rotation ?? 0,
            };
          } else {
            this.initialDimensions = null;
          }

          this.canvas.style.cursor = this.getResizeCursor(hitHandle.type, selectedNode.rotation ?? 0);
          return;
        }
      }
    }

    // 2. Si no hubo colisión con los manejadores, evaluar colisiones con figuras mediante hitTest
    const hitShape = this.hitTest(x, y);

    if (hitShape) {
      if (this._isMarqueeSelecting) {
        this.cancelMarquee();
      }

      const targetNode = this.resolveNodeToSelect(hitShape);
      const targetId = targetNode.id;

      // A.1: Shift+clic sobre una figura/grupo: la añade o quita de la selección (toggleInSelection). Sin arrastre.
      if (event.shiftKey) {
        this.stateManager.toggleInSelection(targetId);
        this.resetDrag();
        this.resetResize();
        this.resetRotate();
        return;
      }

      // A.2 & A.3: Clic sin Shift sobre una figura/grupo
      const isAlreadySelected = this.stateManager.isSelected(targetId);
      const isMultiSelection = this.stateManager.getSelection().length > 1;

      if (isAlreadySelected && isMultiSelection) {
        // Clic sobre figura/grupo que ya forma parte de selección múltiple: se mantiene y puede arrastrarse el conjunto.
        // Si se suelta sin haber arrastrado (>3px en pantalla), la selección pasa a ser solo ese elemento.
        this.pendingSingleSelectionId = targetId;
      } else if (!isAlreadySelected) {
        // Clic sobre figura/grupo no seleccionado: selección simple.
        this.stateManager.selectNode(targetId);
        this.pendingSingleSelectionId = null;
      } else {
        this.pendingSingleSelectionId = null;
      }

      this._isDragging = true;
      this._isCopyDragging = false;
      this.originalSelectionIds = this.stateManager.getSelection();
      this.activeClonePlacements = null;
      this._isResizing = false;
      this._isRotating = false;
      this.dragOrigin = { x, y };
      this.dragStartScreen = this.getScreenCoordinates(event);
      this.hasMovedPastThreshold = false;

      // Registrar posiciones iniciales de todas las figuras hoja del conjunto seleccionado
      const selectedNodes = this.stateManager.getSelectedNodes();
      const leafShapes = getLeafShapes(selectedNodes);
      this.initialShapesPositions = new Map<string, { x: number; y: number }>();
      this.originalLeafPositions = new Map<string, { x: number; y: number }>();
      for (const node of leafShapes) {
        this.initialShapesPositions.set(node.id, { x: node.x, y: node.y });
        this.originalLeafPositions.set(node.id, { x: node.x, y: node.y });
      }

      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // 3. Clic sobre el vacío (A.4)
    // Prepara el rectángulo de selección marquesina. Con Shift suma a la selección previa; sin Shift reemplaza.
    this.resetDrag();
    this.resetResize();
    this.resetRotate();

    this._isMarqueeSelecting = true;
    this._marqueeStartWorld = { x, y };
    this._marqueeStartScreen = this.getScreenCoordinates(event);
    this._marqueeShiftKey = Boolean(event.shiftKey);
    this._marqueeInitialSelection = [...this.stateManager.getSelection()];
    this._hasMarqueeDragged = false;
    this._shapePreview = null;

    if (!event.shiftKey && this.options.deselectOnEmptyClick) {
      this.stateManager.selectNode(null);
    }
  }

  /**
   * Lógica de la herramienta Pluma al presionar el ratón:
   * Al hacer clic se define un punto de ancla; al arrastrar se definirán sus puntos de control.
   */
  private handlePenMouseDown(x: number, y: number): void {
    const currentState = this.stateManager.getState();
    const targetLayer = currentState.children[0];
    if (!targetLayer) return;

    if (this.activePathId === null) {
      // Iniciar un nuevo trazado con el primer punto de ancla
      const newPathId = `path-${Date.now()}`;
      const initialPoint: PathPoint = {
        x,
        y,
        handleIn: { x, y },
        handleOut: { x, y },
      };

      const newPath: Path = {
        id: newPathId,
        type: 'path',
        name: `Trazado Bézier ${newPathId.slice(-4)}`,
        x,
        y,
        points: [initialPoint],
        closed: false,
        stroke: '#38bdf8', // Celeste vector
        strokeWidth: 2.5,
        fill: 'transparent',
      };

      this.stateManager.addShape(targetLayer.id, newPath);
      this.stateManager.selectNode(newPathId);
      this.activePathId = newPathId;
      this.isCreatingAnchor = true;
      this.currentAnchorIndex = 0;
    } else {
      const activePath = this.stateManager.findNode(this.activePathId) as Path | null;
      if (!activePath || activePath.type !== 'path') {
        this.finishActivePath();
        return;
      }

      // Comprobar si el clic está muy cerca del primer punto para cerrar el trazado
      const firstPoint = activePath.points[0];
      const zoom = this.viewportManager.zoom;
      const closeRadius = 12 / zoom;
      const distToFirst = Math.hypot(x - firstPoint.x, y - firstPoint.y);

      if (distToFirst <= closeRadius && activePath.points.length >= 3) {
        // Cerrar el trazado
        this.finishActivePath(true);
        return;
      }

      // Agregar nuevo punto de ancla al trazado
      const newPoint: PathPoint = {
        x,
        y,
        handleIn: { x, y },
        handleOut: { x, y },
      };

      this.stateManager.updateShape<Path>(this.activePathId, (path) => ({
        ...path,
        points: [...path.points, newPoint],
      }));

      const updated = this.stateManager.findNode(this.activePathId) as Path;
      this.currentAnchorIndex = updated.points.length - 1;
      this.isCreatingAnchor = true;
    }
  }

  /**
   * Maneja el evento mousemove según la herramienta activa.
   */
  public handleMouseMove(event: MouseEvent): void {
    // 0. Paneo activo
    if (this._isPanning && this._panStartScreen) {
      const dx = event.clientX - this._panStartScreen.x;
      const dy = event.clientY - this._panStartScreen.y;
      this._panStartScreen = { x: event.clientX, y: event.clientY };
      this.viewportManager.panBy(dx, dy);
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (this._isSpacePressed || this._currentTool === 'hand') {
      this.canvas.style.cursor = 'grab';
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);

    if (this._currentTool === 'rectangle' || this._currentTool === 'ellipse') {
      if (this._isCreatingShape) {
        this._creationCurrent = { x, y };
        this._creationShiftKey = Boolean(event.shiftKey);
        this.updateShapePreview();
        this.stateManager.markDirty();
      }
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this._currentTool === 'pen') {
      this.handlePenMouseMove(x, y);
      return;
    }

    if (this._currentTool === 'direct-select') {
      this.handleDirectSelectMouseMove(x, y, Boolean(event.altKey));
      return;
    }

    // Modo 'select'
    if (this._multiTransformState) {
      this.applyMultiTransform(x, y, Boolean(event.shiftKey));
      return;
    }

    if (this._isRotating && this.rotatingShapeId) {
      const rawNode = this.stateManager.findNode(this.rotatingShapeId) ?? this.stateManager.getSelectedNode();
      const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
      if (selectedShape) {
        const centroid = this.rotationCentroid ?? this.getShapeCentroid(selectedShape);
        const deltaX = x - centroid.x;
        const deltaY = y - centroid.y;
        const radians = Math.atan2(deltaY, deltaX);
        const mouseAngle = (radians * 180) / Math.PI;

        let degrees = mouseAngle - this.rotationAngleOffset + 90;
        if (event.shiftKey) {
          degrees = Math.round(degrees / 15) * 15;
        } else {
          degrees = Math.round(degrees);
        }
        while (degrees > 180) degrees -= 360;
        while (degrees <= -180) degrees += 360;

        this.stateManager.updateShape(this.rotatingShapeId, { rotation: degrees });
        this.canvas.style.cursor = 'crosshair';
        return;
      }
    }

    // 1. Arrastre del rectángulo de selección marquesina (A.4)
    if (this._isMarqueeSelecting && this._marqueeStartWorld && this._marqueeStartScreen) {
      const screenPos = this.getScreenCoordinates(event);
      const screenDist = Math.hypot(
        screenPos.x - this._marqueeStartScreen.x,
        screenPos.y - this._marqueeStartScreen.y
      );

      if (screenDist > 3 || this._hasMarqueeDragged) {
        this._hasMarqueeDragged = true;

        const minX = Math.min(this._marqueeStartWorld.x, x);
        const minY = Math.min(this._marqueeStartWorld.y, y);
        const width = Math.abs(x - this._marqueeStartWorld.x);
        const height = Math.abs(y - this._marqueeStartWorld.y);

        this._shapePreview = {
          type: 'marquee',
          x: minX,
          y: minY,
          width,
          height,
        };

        const docState = this.stateManager.getState();
        const candidates: SelectableNode[] = [];
        for (const layer of docState.children) {
          if (layer.visible === false || layer.locked === true) {
            continue;
          }
          for (const child of layer.children) {
            if (child.visible === false || child.locked === true) {
              continue;
            }
            if (isSelectable(child)) {
              candidates.push(child);
            }
          }
        }

        const intersecting = getShapesIntersectingRect(candidates, {
          x: minX,
          y: minY,
          width,
          height,
        });

        const hitIds = intersecting.map((s) => s.id);

        if (this._marqueeShiftKey) {
          const combined = new Set([...this._marqueeInitialSelection, ...hitIds]);
          this.stateManager.setSelection(Array.from(combined));
        } else {
          this.stateManager.setSelection(hitIds);
        }

        this.stateManager.markDirty();
      }

      this.canvas.style.cursor = 'default';
      return;
    }

    // 2. Arrastre de figuras (A.2, A.3, A.5)
    if (this._isDragging && this.initialShapesPositions && this.dragOrigin && this.dragStartScreen) {
      const screenPos = this.getScreenCoordinates(event);
      const screenDist = Math.hypot(
        screenPos.x - this.dragStartScreen.x,
        screenPos.y - this.dragStartScreen.y
      );

      const shouldMove = screenDist > 3 || this.hasMovedPastThreshold;

      if (shouldMove) {
        if (screenDist > 3) {
          this.hasMovedPastThreshold = true;
          this.pendingSingleSelectionId = null;
        }

        // Evaluar Alt para alternar entre modo copia y modo normal
        this.syncCopyDragMode(Boolean(event.altKey));

        const deltaX = x - this.dragOrigin.x;
        const deltaY = y - this.dragOrigin.y;

        const entries: ShapePositionEntry[] = [];
        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          entries.push({
            id,
            x: initialPos.x + deltaX,
            y: initialPos.y + deltaY,
          });
        }

        this.stateManager.updateShapesPosition(entries);
        this.canvas.style.cursor = this._isCopyDragging ? 'copy' : 'grabbing';
        return;
      }
    }

    if (this._isResizing) {
      if (
        this.resizingShapeId &&
        this.resizeOrigin &&
        this.activeResizeHandle &&
        this.initialDimensions
      ) {
        this._lastResizeMousePos = { x, y };
        const deltaX = x - this.resizeOrigin.x;
        const deltaY = y - this.resizeOrigin.y;

        const newDimensions = this.calculateResizedDimensions(
          this.initialDimensions,
          this.activeResizeHandle,
          deltaX,
          deltaY,
          Boolean(event.shiftKey)
        );

        this.stateManager.updateShapeDimensions(this.resizingShapeId, newDimensions);

        const currentShape = this.stateManager.findNode(this.resizingShapeId) as Shape | null;
        this.canvas.style.cursor = this.getResizeCursor(
          this.activeResizeHandle,
          currentShape?.rotation ?? this.initialDimensions.rotation ?? 0
        );
      }
      return;
    }

    // Verificar si el cursor sobrevuela uno de los manejadores del nodo seleccionado (o grupo / multiselección)
    const currentSelected = this.stateManager.getSelectedNodes();
    const isMultiOrGroupHover = currentSelected.length >= 2 || (currentSelected.length === 1 && isGroup(currentSelected[0]));

    if (isMultiOrGroupHover) {
      const bounds = getSelectionBounds(currentSelected);
      if (bounds) {
        const zoom = this.viewportManager.zoom;
        const handles = getSelectionBoxHandles(bounds, 8 / zoom, 30 / zoom);
        const hoveredHandle = handles.find((handle) => isPointInAABB(x, y, handle));
        if (hoveredHandle) {
          if (hoveredHandle.type === 'rotation-handle') {
            this.canvas.style.cursor = 'crosshair';
            return;
          }
          this.canvas.style.cursor = this.getResizeCursor(hoveredHandle.type, 0);
          return;
        }
      }
    } else if (currentSelected.length === 1) {
      const selectedShape = currentSelected[0];
      if (isShape(selectedShape)) {
        const zoom = this.viewportManager.zoom;
        const handles = getSelectionHandles(selectedShape, 8 / zoom, 30 / zoom);
        const hoveredHandle = handles.find((handle) => isPointInAABB(x, y, handle));
        if (hoveredHandle) {
          if (hoveredHandle.type === 'rotation-handle') {
            this.canvas.style.cursor = 'crosshair';
            return;
          }
          this.canvas.style.cursor = this.getResizeCursor(hoveredHandle.type, selectedShape.rotation ?? 0);
          return;
        }
      }
    }

    const hitShape = this.hitTest(x, y);
    this._hoveredShapeId = hitShape ? hitShape.id : null;

    if (hitShape) {
      this.canvas.style.cursor = this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Lógica de la herramienta Pluma al mover el ratón:
   * Si se está arrastrando tras el clic, se actualizan los puntos de control Bézier (handleOut y handleIn simétrico).
   */
  private handlePenMouseMove(x: number, y: number): void {
    if (!this.isCreatingAnchor || !this.activePathId || this.currentAnchorIndex < 0) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Al arrastrar, se definen los puntos de control tangentes
    this.stateManager.updateShape<Path>(this.activePathId, (path) => {
      const updatedPoints = path.points.map((pt, idx) => {
        if (idx === this.currentAnchorIndex) {
          // El punto arrastrado define handleOut; handleIn se proyecta de forma simétrica
          const anchorX = pt.x;
          const anchorY = pt.y;

          return {
            ...pt,
            handleOut: { x, y },
            handleIn: {
              x: 2 * anchorX - x,
              y: 2 * anchorY - y,
            },
          };
        }
        return pt;
      });

      return {
        ...path,
        points: updatedPoints,
      };
    });

    this.canvas.style.cursor = 'crosshair';
  }

  /**
   * Maneja el evento mouseup según la herramienta activa.
   */
  public handleMouseUp(event: MouseEvent): void {
    // 0. Finalizar paneo si estaba activo
    if (this._isPanning) {
      this._isPanning = false;
      this._panStartScreen = null;
      if (this._isSpacePressed || this._currentTool === 'hand') {
        this.canvas.style.cursor = 'grab';
      } else {
        this.restoreToolCursor();
      }
      return;
    }

    if (
      this._isCreatingShape &&
      (this._currentTool === 'rectangle' || this._currentTool === 'ellipse')
    ) {
      const { x, y } = this.getLocalCoordinates(event);
      const start = this._creationStart ?? { x, y };
      const dx = x - start.x;
      const dy = y - start.y;
      const distance = Math.hypot(dx, dy);
      const zoom = this.viewportManager.zoom;

      if (distance < 3 / zoom) {
        this.cancelCreation();
        return;
      }

      const isLocked = Boolean(event.shiftKey || this._creationShiftKey);

      const currentState = this.stateManager.getState();
      const targetLayer = currentState.children[0];
      if (!targetLayer) {
        this.cancelCreation();
        return;
      }

      let newShape: Shape;
      if (this._currentTool === 'rectangle') {
        const bounds = normalizeShapeBounds(start, { x, y }, 'rectangle', isLocked);
        this.rectangleCounter++;
        const rectShape: Rectangle = {
          id: `rect-${Date.now()}-${this.rectangleCounter}`,
          type: 'rectangle',
          name: `Rectángulo ${this.rectangleCounter}`,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          fill: '#38bdf8',
          stroke: '#0284c7',
          strokeWidth: 2,
          opacity: 0.85,
          visible: true,
          locked: false,
          rotation: 0,
        };
        newShape = rectShape;
      } else {
        const bounds = normalizeShapeBounds(start, { x, y }, 'ellipse', isLocked);
        this.ellipseCounter++;
        const ellipseShape: Ellipse = {
          id: `ellipse-${Date.now()}-${this.ellipseCounter}`,
          type: 'ellipse',
          name: `Elipse ${this.ellipseCounter}`,
          x: bounds.x,
          y: bounds.y,
          radiusX: bounds.radiusX,
          radiusY: bounds.radiusY,
          fill: '#38bdf8',
          stroke: '#0284c7',
          strokeWidth: 2,
          opacity: 0.85,
          visible: true,
          locked: false,
          rotation: 0,
        };
        newShape = ellipseShape;
      }

      const command = new AddShapeCommand(this.stateManager, targetLayer.id, newShape);
      this.commandManager.executeCommand(command);

      this.stateManager.selectNode(newShape.id);
      this.cancelCreation();
      this.setTool('select');
      return;
    }

    if (this._currentTool === 'pen') {
      this.isCreatingAnchor = false;
      return;
    }

    if (this._currentTool === 'direct-select') {
      if (
        this._isDraggingPoint &&
        this._draggedPointTarget &&
        this.initialPathPoints
      ) {
        const path = this.stateManager.findNode(this._draggedPointTarget.pathId) as Path | null;
        if (path && this.havePointsChanged(this.initialPathPoints, path.points)) {
          const command = new PointCommand(
            this.stateManager,
            this._draggedPointTarget.pathId,
            this.initialPathPoints,
            path.points
          );
          this.commandManager.recordCommand(command);
        }
      }

      this._isDraggingPoint = false;
      this._isDraggedPointSmooth = false;
      this.directSelectOrigin = null;
      this.initialPathPoints = null;

      const { x, y } = this.getLocalCoordinates(event);
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && selectedNode.type === 'path') {
        const hit = this.findPathPointHit(selectedNode as Path, x, y);
        this.canvas.style.cursor = hit ? 'pointer' : 'default';
      } else {
        this.canvas.style.cursor = 'default';
      }
      return;
    }

    // Modo 'select'
    if (this._multiTransformState) {
      const entries: ShapeTransformEntry[] = this._multiTransformState.leafShapes.map((initialShape) => {
        const currentShape = (this.stateManager.findNode(initialShape.id) as Shape | null) ?? initialShape;
        return {
          id: initialShape.id,
          before: getShapeDimensions(initialShape),
          after: getShapeDimensions(currentShape),
        };
      });

      const command = new TransformShapesCommand(this.stateManager, entries);
      if (!command.isAlreadyAtTarget) {
        this.commandManager.recordCommand(command);
      }

      this.resetMultiTransform();
      const { x, y } = this.getLocalCoordinates(event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this._isRotating) {
      if (this.rotatingShapeId && this.initialRotation !== null) {
        const rawNode = this.stateManager.findNode(this.rotatingShapeId) ?? this.stateManager.getSelectedNode();
        const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
        if (selectedShape) {
          const finalRotation = selectedShape.rotation ?? this.initialRotation;
          if (finalRotation !== this.initialRotation) {
            const command = new RotateCommand(
              this.stateManager,
              this.rotatingShapeId,
              this.initialRotation,
              finalRotation
            );
            this.commandManager.recordCommand(command);
          }
        }
      }

      this.resetRotate();
      const { x, y } = this.getLocalCoordinates(event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (this._isResizing) {
      if (
        this.resizingShapeId &&
        this.resizeOrigin &&
        this.activeResizeHandle &&
        this.initialDimensions
      ) {
        const { x, y } = this.getLocalCoordinates(event);
        const deltaX = x - this.resizeOrigin.x;
        const deltaY = y - this.resizeOrigin.y;

        const finalDimensions = this.calculateResizedDimensions(
          this.initialDimensions,
          this.activeResizeHandle,
          deltaX,
          deltaY,
          Boolean(event.shiftKey)
        );

        this.stateManager.updateShapeDimensions(this.resizingShapeId, finalDimensions);

        if (this.hasDimensionsChanged(this.initialDimensions, finalDimensions)) {
          const command = new ResizeCommand(
            this.stateManager,
            this.resizingShapeId,
            this.initialDimensions,
            finalDimensions
          );
          this.commandManager.recordCommand(command);
        }
      }

      this.resetResize();
      const { x, y } = this.getLocalCoordinates(event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    // Finalizar selección marquesina si estaba activa
    if (this._isMarqueeSelecting) {
      if (!this._hasMarqueeDragged) {
        if (!this._marqueeShiftKey && this.options.deselectOnEmptyClick) {
          this.stateManager.selectNode(null);
        } else if (this._marqueeShiftKey) {
          this.stateManager.setSelection(this._marqueeInitialSelection);
        }
      }
      this._isMarqueeSelecting = false;
      this._marqueeStartWorld = null;
      this._marqueeStartScreen = null;
      this._marqueeShiftKey = false;
      this._marqueeInitialSelection = [];
      this._hasMarqueeDragged = false;
      this._shapePreview = null;
      this.stateManager.markDirty();

      const { x, y } = this.getLocalCoordinates(event);
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    if (!this._isDragging) {
      this.resetDrag();
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);
    const screenPos = this.getScreenCoordinates(event);
    const screenDist = this.dragStartScreen
      ? Math.hypot(screenPos.x - this.dragStartScreen.x, screenPos.y - this.dragStartScreen.y)
      : 0;

    // A.2: Soltar sobre una figura que formaba parte de multiselección sin haber arrastrado (>3px):
    if (this.pendingSingleSelectionId && screenDist <= 3 && !this.hasMovedPastThreshold) {
      if (this.initialShapesPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.initialShapesPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }
      this.stateManager.selectNode(this.pendingSingleSelectionId);
      this.resetDrag();
      const hitShape = this.hitTest(x, y);
      this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
      return;
    }

    // Finalizar arrastre de figuras (A.5):
    if (this.hasMovedPastThreshold && this.initialShapesPositions && this.dragOrigin) {
      // Evaluar Alt también en el mouseup
      this.syncCopyDragMode(Boolean(event.altKey));

      const deltaX = x - this.dragOrigin.x;
      const deltaY = y - this.dragOrigin.y;

      if (this._isCopyDragging && this.activeClonePlacements) {
        // Asegurar posición final de las figuras hoja de los clones
        const entries: ShapePositionEntry[] = [];
        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          entries.push({ id, x: initialPos.x + deltaX, y: initialPos.y + deltaY });
        }
        this.stateManager.updateShapesPosition(entries);

        // BatchCommand de AddShapeCommand construido con los clones tal como están ahora en el estado
        const commands: AddShapeCommand[] = [];
        for (const p of this.activeClonePlacements) {
          const finalClone = this.stateManager.findNode(p.clonedNode.id) as SelectableNode;
          if (finalClone) {
            commands.push(new AddShapeCommand(this.stateManager, p.parentId, finalClone, p.targetIndex));
          }
        }

        if (commands.length > 0) {
          const batch = new BatchCommand(commands, 'Copiar y mover');
          this.commandManager.recordCommand(batch);
        }

        this.resetDrag();
        const hitShape = this.hitTest(x, y);
        this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
        return;
      }

      const selectedNodes = this.stateManager.getSelectedNodes();
      const isGroupSelected = selectedNodes.some(isGroup);

      if (this.initialShapesPositions.size > 1 || isGroupSelected) {
        const commands: TranslateCommand[] = [];
        const entries: ShapePositionEntry[] = [];

        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          const finalX = initialPos.x + deltaX;
          const finalY = initialPos.y + deltaY;
          entries.push({ id, x: finalX, y: finalY });

          if (finalX !== initialPos.x || finalY !== initialPos.y) {
            commands.push(
              new TranslateCommand(
                this.stateManager,
                id,
                initialPos.x,
                initialPos.y,
                finalX,
                finalY,
                { mergeTimeout: 0 }
              )
            );
          }
        }

        this.stateManager.updateShapesPosition(entries);

        if (commands.length > 0) {
          const batch = new BatchCommand(commands, 'Mover figuras');
          this.commandManager.recordCommand(batch);
        }
      } else if (this.initialShapesPositions.size === 1) {
        const [singleId, initialPos] = Array.from(this.initialShapesPositions.entries())[0];
        const finalX = initialPos.x + deltaX;
        const finalY = initialPos.y + deltaY;

        this.stateManager.updateShapePosition(singleId, finalX, finalY);

        if (finalX !== initialPos.x || finalY !== initialPos.y) {
          const command = new TranslateCommand(
            this.stateManager,
            singleId,
            initialPos.x,
            initialPos.y,
            finalX,
            finalY,
            { mergeTimeout: 0 }
          );
          this.commandManager.recordCommand(command);
        }
      }
    } else if (!this.hasMovedPastThreshold && this.initialShapesPositions) {
      // Si no superó el umbral de arrastre (>3px), restaurar posiciones originales por si hubo micro-movimiento
      const restoreEntries: ShapePositionEntry[] = [];
      for (const [id, pos] of this.initialShapesPositions.entries()) {
        restoreEntries.push({ id, x: pos.x, y: pos.y });
      }
      this.stateManager.updateShapesPosition(restoreEntries);
    }

    this.resetDrag();

    const hitShape = this.hitTest(x, y);
    this.canvas.style.cursor = hitShape ? (this.stateManager.isSelected(hitShape.id) ? 'move' : 'pointer') : 'default';
  }

  /**
   * Maneja atajos de teclado globales:
   * - Ctrl+Z / Ctrl+Y para Undo / Redo
   * - 'P' para activar herramienta Pluma
   * - 'V' para activar herramienta Selección
   * - 'A' para activar herramienta Selección Directa
   * - 'R' para activar herramienta Rectángulo
   * - 'E' para activar herramienta Elipse
   * - Escape / Enter para finalizar o cancelar trazado/creación activa
   */
  public handleKeyDown(event: KeyboardEvent): void {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isCtrlOrCmd) {
      const key = event.key;
      const keyLower = key ? key.toLowerCase() : '';

      if (keyLower === 'z') {
        event.preventDefault?.();
        if (event.shiftKey) {
          this.commandManager.redo();
        } else {
          this.commandManager.undo();
        }
        return;
      } else if (keyLower === 'y') {
        event.preventDefault?.();
        this.commandManager.redo();
        return;
      }

      const isBringToFront = event.shiftKey && (key === ']' || key === '}' || event.code === 'BracketRight');
      const isSendToBack = event.shiftKey && (key === '[' || key === '{' || event.code === 'BracketLeft');

      if (isBringToFront || isSendToBack) {
        if (!this.isInputFocused(event)) {
          if (this.stateManager.getSelection().length > 0) {
            event.preventDefault?.();
            if (isBringToFront) {
              this.bringToFront();
            } else {
              this.sendToBack();
            }
          }
        }
        return;
      }

      if (keyLower === 'a') {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.stateManager.selectAll();
        }
        return;
      }

      if (keyLower === 'c') {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.copy();
        }
        return;
      }

      if (keyLower === 'v') {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.paste();
        }
        return;
      }

      if (keyLower === 'd') {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.duplicate();
        }
        return;
      }

      if (keyLower === 'g') {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          if (event.shiftKey) {
            this.ungroupSelection();
          } else {
            this.groupSelection();
          }
        }
        return;
      }

      // Atajos de navegación con Ctrl / Cmd (con preventDefault y sin foco en inputs)
      const isZoomIn = key === '+' || key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd';
      const isZoomOut = key === '-' || key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract';
      const isZoomFit = key === '0' || event.code === 'Digit0' || event.code === 'Numpad0';
      const isZoomReset = key === '1' || event.code === 'Digit1' || event.code === 'Numpad1';

      if (isZoomIn) {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.zoomIn();
        }
        return;
      }

      if (isZoomOut) {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.zoomOut();
        }
        return;
      }

      if (isZoomFit) {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.zoomFit();
        }
        return;
      }

      if (isZoomReset) {
        if (!this.isInputFocused(event)) {
          event.preventDefault?.();
          this.zoomReset();
        }
        return;
      }

      return;
    }

    if (this.isInputFocused(event)) {
      return;
    }

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault?.();
      if (!this._isSpacePressed) {
        this._isSpacePressed = true;
        if (!this._isPanning) {
          this.canvas.style.cursor = 'grab';
        }
      }
      return;
    }

    if (event.key === 'Shift') {
      if (this._multiTransformState && this._multiTransformState.lastMouse) {
        this.applyMultiTransform(this._multiTransformState.lastMouse.x, this._multiTransformState.lastMouse.y, true);
        this.stateManager.markDirty();
        return;
      }
      if (this._isResizing) {
        if (
          this.resizingShapeId &&
          this.resizeOrigin &&
          this.activeResizeHandle &&
          this.initialDimensions &&
          this._lastResizeMousePos
        ) {
          const deltaX = this._lastResizeMousePos.x - this.resizeOrigin.x;
          const deltaY = this._lastResizeMousePos.y - this.resizeOrigin.y;
          const newDimensions = this.calculateResizedDimensions(
            this.initialDimensions,
            this.activeResizeHandle,
            deltaX,
            deltaY,
            true
          );
          this.stateManager.updateShapeDimensions(this.resizingShapeId, newDimensions);
          this.stateManager.markDirty();
        }
        return;
      }
      if (this._isCreatingShape) {
        this._creationShiftKey = true;
        this.updateShapePreview(true);
        this.stateManager.markDirty();
        return;
      }
    }

    const key = event.key;
    const isArrowKey = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
      || key === 'Up' || key === 'Down' || key === 'Left' || key === 'Right';

    if (isArrowKey) {
      if (this._currentTool !== 'select') {
        return;
      }

      const selectedShapes = this.stateManager.getSelectedNodes().filter((s) => !s.locked);
      if (selectedShapes.length === 0) {
        return;
      }

      event.preventDefault?.();

      const step = event.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;

      if (key === 'ArrowUp' || key === 'Up') dy = -step;
      else if (key === 'ArrowDown' || key === 'Down') dy = step;
      else if (key === 'ArrowLeft' || key === 'Left') dx = -step;
      else if (key === 'ArrowRight' || key === 'Right') dx = step;

      const customEvent = event as KeyboardEvent & { customTimestamp?: number; time?: number };
      const customTimestamp = customEvent.customTimestamp ?? customEvent.time;
      this.moveSelection(dx, dy, customTimestamp);
      return;
    }

    const keyLower = key ? key.toLowerCase() : '';
    if (keyLower === 'delete' || keyLower === 'backspace') {
      if (this.deleteSelected()) {
        event.preventDefault?.();
      }
      return;
    }

    if (keyLower === 'p') {
      this.setTool('pen');
    } else if (keyLower === 'v') {
      this.setTool('select');
    } else if (keyLower === 'a') {
      this.setTool('direct-select');
    } else if (keyLower === 'r') {
      this.setTool('rectangle');
    } else if (keyLower === 'e') {
      this.setTool('ellipse');
    } else if (keyLower === 'h') {
      this.setTool('hand');
    } else if (keyLower === 'escape') {
      if (this._multiTransformState) {
        const restoreEntries = this._multiTransformState.leafShapes.map((shape) => ({
          id: shape.id,
          dimensions: getShapeDimensions(shape),
        }));
        this.stateManager.updateShapesDimensions(restoreEntries);
        this.resetMultiTransform();
        this.stateManager.markDirty();
        this.canvas.style.cursor = 'default';
        return;
      } else if (this._isDragging && this._isCopyDragging && this.activeClonePlacements) {
        // Escape durante un arrastre en modo copia: elimina los clones, restaura la selección original y cancela el arrastre
        for (const p of this.activeClonePlacements) {
          this.stateManager.removeFromSelection([p.clonedNode.id]);
          this.stateManager.removeNode(p.clonedNode.id);
        }
        this.stateManager.setSelection(this.originalSelectionIds);
        if (this.originalLeafPositions) {
          const restoreEntries: ShapePositionEntry[] = [];
          for (const [id, pos] of this.originalLeafPositions.entries()) {
            restoreEntries.push({ id, x: pos.x, y: pos.y });
          }
          this.stateManager.updateShapesPosition(restoreEntries);
        }
        this.resetDrag();
        this.stateManager.markDirty();
        this.canvas.style.cursor = 'default';
        return;
      } else if (this._isDragging) {
        if (this.initialShapesPositions) {
          const restoreEntries: ShapePositionEntry[] = [];
          for (const [id, pos] of this.initialShapesPositions.entries()) {
            restoreEntries.push({ id, x: pos.x, y: pos.y });
          }
          this.stateManager.updateShapesPosition(restoreEntries);
        }
        this.resetDrag();
        this.stateManager.markDirty();
        this.canvas.style.cursor = 'default';
        return;
      } else if (this._isMarqueeSelecting) {
        this.cancelMarquee();
      } else if (this._isRotating && this.rotatingShapeId && this.initialRotation !== null) {
        this.stateManager.updateShape(this.rotatingShapeId, { rotation: this.initialRotation });
        this.resetRotate();
      } else if (this._isCreatingShape) {
        this.cancelCreation();
      } else if (this._currentTool === 'pen') {
        this.finishActivePath();
      } else if (
        !this._isDragging &&
        !this._isResizing &&
        !this._isRotating &&
        !this._isPanning &&
        !this._isDraggingPoint &&
        this.stateManager.getSelection().length > 0
      ) {
        this.stateManager.selectNode(null);
      }
    } else if (keyLower === 'enter') {
      if (this._currentTool === 'pen') {
        this.finishActivePath();
      }
    }
  }

  public handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      if (this._multiTransformState && this._multiTransformState.lastMouse) {
        this.applyMultiTransform(this._multiTransformState.lastMouse.x, this._multiTransformState.lastMouse.y, false);
        this.stateManager.markDirty();
        return;
      }
      if (this._isResizing) {
        if (
          this.resizingShapeId &&
          this.resizeOrigin &&
          this.activeResizeHandle &&
          this.initialDimensions &&
          this._lastResizeMousePos
        ) {
          const deltaX = this._lastResizeMousePos.x - this.resizeOrigin.x;
          const deltaY = this._lastResizeMousePos.y - this.resizeOrigin.y;
          const newDimensions = this.calculateResizedDimensions(
            this.initialDimensions,
            this.activeResizeHandle,
            deltaX,
            deltaY,
            false
          );
          this.stateManager.updateShapeDimensions(this.resizingShapeId, newDimensions);
          this.stateManager.markDirty();
        }
      }
      if (this._isCreatingShape) {
        this._creationShiftKey = false;
        this.updateShapePreview(false);
        this.stateManager.markDirty();
      }
    }

    if (event.code === 'Space' || event.key === ' ') {
      this._isSpacePressed = false;
      if (!this._isPanning) {
        this.restoreToolCursor();
      }
    }
  }

  /**
   * Determina si el evento de teclado se originó en un elemento de entrada interactivo
   * (input de texto, número, color, textarea o select) o si actualmente un campo tiene el foco.
   */
  private isInputFocused(event: KeyboardEvent): boolean {
    const target = (event.target as HTMLElement | null) ??
      (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
    if (!target) {
      return false;
    }
    const tagName = target.tagName;
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      (tagName as string) === 'SELECT' ||
      Boolean(target.isContentEditable)
    );
  }

  /**
   * Agrupa una colección de figuras (por defecto la selección activa) por capa contenedora,
   * indexando su posición dentro de cada capa y ordenando los elementos por índice de forma ascendente.
   * Delega en SelectionOperations.
   */
  public getSelectedShapesGroupedByLayer(
    shapes: readonly Shape[] = this.stateManager.getSelectedNodes().filter(isShape)
  ): Map<string, { shape: Shape; index: number }[]> {
    return this._selectionOperations.getSelectedShapesGroupedByLayer(shapes);
  }

  /**
   * Trae las figuras seleccionadas al frente de sus capas contenedoras conservando su orden relativo,
   * registrando una sola entrada en el historial de comandos (ReorderCommand o BatchCommand).
   * Delega en SelectionOperations.
   */
  public bringToFront(shapeId?: string): boolean {
    return this._selectionOperations.bringToFront(shapeId);
  }

  /**
   * Envía las figuras seleccionadas al fondo de sus capas contenedoras conservando su orden relativo,
   * registrando una sola entrada en el historial de comandos (ReorderCommand o BatchCommand).
   * Delega en SelectionOperations.
   */
  public sendToBack(shapeId?: string): boolean {
    return this._selectionOperations.sendToBack(shapeId);
  }

  /**
   * Duplica las figuras seleccionadas con un desplazamiento de 10 px,
   * conservando sus posiciones relativas y su orden de apilado relativo.
   * Delega en SelectionOperations.
   */
  public duplicate(): (Shape[] & Shape) | null {
    return this._selectionOperations.duplicate();
  }

  /**
   * Guarda una copia de las figuras seleccionadas en el portapapeles interno en memoria.
   * Delega en SelectionOperations.
   */
  public copy(): boolean {
    return this._selectionOperations.copy();
  }

  /**
   * Crea copias de las figuras del portapapeles conservando sus posiciones relativas
   * y orden de apilado relativo, desplazadas 10 px de forma acumulada en pegados consecutivos.
   * Delega en SelectionOperations.
   */
  public paste(): (Shape[] & Shape) | null {
    return this._selectionOperations.paste();
  }

  /**
   * Agrupa los nodos seleccionados (requiere 2 o más).
   * Delega en SelectionOperations.
   */
  public groupSelection(): Group | null {
    return this._selectionOperations.groupSelection();
  }

  /**
   * Desagrupa los grupos seleccionados (requiere al menos 1 grupo).
   * Delega en SelectionOperations.
   */
  public ungroupSelection(): boolean {
    return this._selectionOperations.ungroupSelection();
  }

  /**
   * Aplica estilos a la selección expandiendo grupos a sus figuras hoja.
   * Delega en SelectionOperations.
   */
  public applyStyle(style: Partial<Pick<Shape, 'fill' | 'stroke' | 'strokeWidth'>>): boolean {
    return this._selectionOperations.applyStyle(style);
  }

  /**
   * Elimina todas las figuras seleccionadas del Scene Graph mediante DeleteCommand.
   * Delega en SelectionOperations.
   */
  public deleteSelected(): boolean {
    return this._selectionOperations.deleteSelected();
  }

  /**
   * Mueve todas las figuras seleccionadas por un desplazamiento relativo (dx, dy).
   * Solo opera si la herramienta activa es 'select'. Delega en SelectionOperations.
   */
  public moveSelection(dx: number, dy: number, timestamp?: number): boolean {
    if (this._currentTool !== 'select') {
      return false;
    }
    return this._selectionOperations.moveSelection(dx, dy, timestamp);
  }

  /**
   * Alinea las figuras actualmente seleccionadas según el modo indicado.
   * Delega en SelectionOperations.
   */
  public alignSelection(mode: AlignmentMode): boolean {
    return this._selectionOperations.alignSelection(mode);
  }

  /**
   * Distribuye las figuras actualmente seleccionadas uniformemente a lo largo del eje indicado.
   * Delega en SelectionOperations.
   */
  public distributeSelection(axis: DistributionAxis): boolean {
    return this._selectionOperations.distributeSelection(axis);
  }

  /**
   * Cancela la creación en curso de una figura por arrastre, limpiando la vista previa.
   */
  public cancelCreation(): void {
    const wasCreating = this._isCreatingShape || this._shapePreview !== null;
    this._isCreatingShape = false;
    this._creationStart = null;
    this._creationCurrent = null;
    this._shapePreview = null;
    if (wasCreating) {
      this.stateManager.markDirty();
    }
  }

  /**
   * Recalcula la vista previa geométrica de la figura según los puntos inicial y actual del arrastre.
   */
  private updateShapePreview(shiftKey?: boolean): void {
    if (!this._creationStart || !this._creationCurrent) {
      this._shapePreview = null;
      return;
    }

    if (this._currentTool !== 'rectangle' && this._currentTool !== 'ellipse') {
      this._shapePreview = null;
      return;
    }

    const lock = shiftKey ?? this._creationShiftKey;
    const bounds = normalizeShapeBounds(
      this._creationStart,
      this._creationCurrent,
      this._currentTool,
      lock
    );

    this._shapePreview = bounds;
  }

  /**
   * Sincroniza el modo copia durante el arrastre (Alt + arrastre).
   * Crea o destruye clones interactivos según el estado de event.altKey.
   */
  private syncCopyDragMode(altKey: boolean): void {
    if (altKey && !this._isCopyDragging) {
      // 1. Restaurar originales a su posición inicial si se habían movido
      if (this.originalLeafPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.originalLeafPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }

      // 2. Obtener los nodos originales para clonar
      const originalNodes: SelectableNode[] = [];
      for (const id of this.originalSelectionIds) {
        const node = this.stateManager.findNode(id);
        if (node && isSelectable(node)) {
          originalNodes.push(node);
        }
      }

      // 3. Crear clones con desplazamiento 0 e insertarlos en el estado (sin historial)
      const prepared = this._selectionOperations.prepareClones(originalNodes, { dx: 0, dy: 0 });
      for (const p of prepared) {
        this.stateManager.addNode(p.parentId, p.clonedNode, p.targetIndex);
      }
      this.activeClonePlacements = prepared;

      // 4. Pasar la selección a los clones
      const cloneIds = prepared.map((p) => p.clonedNode.id);
      this.stateManager.setSelection(cloneIds);

      // 5. Usar las posiciones iniciales de las figuras hoja de los clones como nueva instantánea
      const clonedSelectedNodes = this.stateManager.getSelectedNodes();
      const clonedLeafShapes = getLeafShapes(clonedSelectedNodes);
      this.initialShapesPositions = new Map<string, { x: number; y: number }>();
      for (const leaf of clonedLeafShapes) {
        this.initialShapesPositions.set(leaf.id, { x: leaf.x, y: leaf.y });
      }

      this._isCopyDragging = true;
    } else if (!altKey && this._isCopyDragging) {
      // 1. Eliminar los clones del estado
      if (this.activeClonePlacements) {
        for (const p of this.activeClonePlacements) {
          this.stateManager.removeFromSelection([p.clonedNode.id]);
          this.stateManager.removeNode(p.clonedNode.id);
        }
        this.activeClonePlacements = null;
      }

      // 2. Volver a seleccionar las figuras originales
      this.stateManager.setSelection(this.originalSelectionIds);

      // 3. Restaurar la instantánea a las posiciones iniciales de los originales
      if (this.originalLeafPositions) {
        this.initialShapesPositions = new Map(this.originalLeafPositions);
      }

      this._isCopyDragging = false;
    }
  }

  private resetDrag(): void {
    this._isDragging = false;
    this._isCopyDragging = false;
    this.originalSelectionIds = [];
    this.originalLeafPositions = null;
    this.activeClonePlacements = null;
    this.dragOrigin = null;
    this.initialShapesPositions = null;
    this.pendingSingleSelectionId = null;
    this.dragStartScreen = null;
    this.hasMovedPastThreshold = false;
  }

  private resetResize(): void {
    this._isResizing = false;
    this.resizeOrigin = null;
    this._lastResizeMousePos = null;
    this.activeResizeHandle = null;
    this.resizingShapeId = null;
    this.initialDimensions = null;
    this.resetMultiTransform();
  }

  private resetRotate(): void {
    this._isRotating = false;
    this.rotatingShapeId = null;
    this.initialRotation = null;
    this.rotationAngleOffset = 0;
    this.rotationCentroid = null;
    this.resetMultiTransform();
  }

  private resetMultiTransform(): void {
    this._multiTransformState = null;
  }

  private applyMultiTransform(x: number, y: number, shiftKey: boolean): void {
    if (!this._multiTransformState) {
      return;
    }
    this._multiTransformState.lastMouse = { x, y };

    if (this._multiTransformState.type === 'rotate') {
      const pivot = this._multiTransformState.anchorOrPivot;
      const startMouse = this._multiTransformState.startMouse;
      const currentMouse = { x, y };
      const deltaDeg = computeRotationDelta(pivot, startMouse, currentMouse, shiftKey);
      const changes = rotateShapesAboutPivot(this._multiTransformState.leafShapes, pivot, deltaDeg);
      if (changes.length === 0) {
        const restoreEntries = this._multiTransformState.leafShapes.map((shape) => ({
          id: shape.id,
          dimensions: getShapeDimensions(shape),
        }));
        this.stateManager.updateShapesDimensions(restoreEntries);
      } else {
        this.stateManager.updateShapesDimensions(changes);
      }
      this.canvas.style.cursor = 'crosshair';
    } else if (this._multiTransformState.type === 'scale') {
      const handle = this._multiTransformState.handle!;
      const bounds = this._multiTransformState.initialBounds;
      const dx = x - this._multiTransformState.startMouse.x;
      const dy = y - this._multiTransformState.startMouse.y;
      const { anchor, sx, sy } = computeBoxScale(bounds, handle, dx, dy, shiftKey);
      const changes = scaleShapesAboutAnchor(this._multiTransformState.leafShapes, anchor, sx, sy);
      if (changes.length === 0) {
        const restoreEntries = this._multiTransformState.leafShapes.map((shape) => ({
          id: shape.id,
          dimensions: getShapeDimensions(shape),
        }));
        this.stateManager.updateShapesDimensions(restoreEntries);
      } else {
        this.stateManager.updateShapesDimensions(changes);
      }
      this.canvas.style.cursor = this.getResizeCursor(handle, 0);
    }
  }

  private clearSelectedAnchors(): void {
    if (this._selectedAnchors.size > 0 || this._anchorsPathId !== null) {
      this._selectedAnchors.clear();
      this._anchorsPathId = null;
      this.stateManager.markDirty();
    }
  }

  private ensureAnchorsPathSync(): void {
    const selection = this.stateManager.getSelection();
    if (
      this._anchorsPathId !== null &&
      (selection.length !== 1 || selection[0] !== this._anchorsPathId)
    ) {
      this.clearSelectedAnchors();
    }
  }

  private resetDirectSelect(): void {
    this._draggedPointIndex = null;
    this._draggedTargetType = null;
    this._draggedPointTarget = null;
    this._dragTarget = null;
    this._directSelectTarget = null;
    this._isDraggingPoint = false;
    this._isDraggedPointSmooth = false;
    this.directSelectOrigin = null;
    this.initialPathPoints = null;
    this.clearSelectedAnchors();
  }

  /**
   * Maneja el evento mousedown en modo 'direct-select' (Herramienta de Selección Directa / Subselección).
   * No selecciona figuras completas excepto trazados Bézier ('path'), ignorando agrupaciones.
   * Si el usuario hace clic sobre un punto de ancla o manejador de control (AABB de 10x10px),
   * marca ese vértice o manejador específico como objetivo de arrastre.
   */
  private handleDirectSelectMouseDown(x: number, y: number, shiftKey: boolean = false): void {
    this.ensureAnchorsPathSync();
    const selectedNode = this.stateManager.getSelectedNode();
    let activePath: Path | null =
      selectedNode && selectedNode.type === 'path' ? (selectedNode as Path) : null;
    let hitPoint = activePath ? this.findPathPointHit(activePath, x, y) : null;

    if (!hitPoint) {
      // Evaluar hitTest sobre figuras ignorando grupos: si es un Path, seleccionarlo directamente
      const hitShape = this.hitTest(x, y);
      if (hitShape && hitShape.type === 'path') {
        if (this._anchorsPathId !== hitShape.id) {
          this.clearSelectedAnchors();
        }
        this.stateManager.setSelection([hitShape.id]);
        activePath = hitShape as Path;
        hitPoint = this.findPathPointHit(activePath, x, y);
      } else {
        this.stateManager.setSelection([]);
        this.clearSelectedAnchors();
        this.resetDirectSelect();
        this.canvas.style.cursor = 'default';
        return;
      }
    }

    if (activePath && hitPoint) {
      if (hitPoint.type === 'anchor') {
        if (this._anchorsPathId !== activePath.id) {
          this._selectedAnchors.clear();
          this._anchorsPathId = activePath.id;
        }

        if (!shiftKey) {
          if (!this._selectedAnchors.has(hitPoint.index)) {
            this._selectedAnchors.clear();
            this._selectedAnchors.add(hitPoint.index);
            this._anchorsPathId = activePath.id;
            this.stateManager.markDirty();
          }
        } else {
          if (this._selectedAnchors.has(hitPoint.index)) {
            this._selectedAnchors.delete(hitPoint.index);
          } else {
            this._selectedAnchors.add(hitPoint.index);
            this._anchorsPathId = activePath.id;
          }
          this.stateManager.markDirty();
        }
      }

      if (hitPoint.type === 'handleIn' || hitPoint.type === 'handleOut') {
        const pt = activePath.points[hitPoint.index];
        this._isDraggedPointSmooth = pt ? isSmoothPoint(pt) : false;
      } else {
        this._isDraggedPointSmooth = false;
      }

      this._draggedPointIndex = hitPoint.index;
      this._draggedTargetType = hitPoint.type;
      const target: DirectSelectTarget = {
        pathId: activePath.id,
        pointIndex: hitPoint.index,
        index: hitPoint.index,
        type: hitPoint.type,
        targetType: hitPoint.type,
        handleType: hitPoint.type,
      };
      this._draggedPointTarget = target;
      this._dragTarget = target;
      this._directSelectTarget = target;
      this._isDraggingPoint = true;
      this.directSelectOrigin = { x, y };
      this.dragOrigin = { x, y };
      this.initialPathPoints = structuredClone(activePath.points);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.clearSelectedAnchors();
      this.resetDirectSelect();
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Maneja el evento mousemove en modo 'direct-select'.
   * Arrastra exclusivamente el vértice o manejador seleccionado en tiempo real calculando el delta del cursor.
   * Si está en reposo (hover), actualiza el cursor si sobrevuela un punto o manejador.
   */
  private handleDirectSelectMouseMove(x: number, y: number, altKey: boolean = false): void {
    if (
      this._isDraggingPoint &&
      this._draggedPointTarget &&
      this.directSelectOrigin &&
      this.initialPathPoints
    ) {
      let deltaX = x - this.directSelectOrigin.x;
      let deltaY = y - this.directSelectOrigin.y;
      const { pathId, pointIndex, type } = this._draggedPointTarget;

      const pathNode = this.stateManager.findNode(pathId) as Path | null;
      if (pathNode && pathNode.rotation) {
        const rad = (-pathNode.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotDx = deltaX * cos - deltaY * sin;
        const rotDy = deltaX * sin + deltaY * cos;
        deltaX = rotDx;
        deltaY = rotDy;
      }

      const nextPoints =
        type === 'anchor'
          ? translatePathAnchors(
              this.initialPathPoints,
              this._selectedAnchors.size > 0 ? this._selectedAnchors : new Set([pointIndex]),
              deltaX,
              deltaY
            )
          : this.initialPathPoints.map((pt, idx) => {
              if (idx !== pointIndex) return pt;
              if (type === 'handleIn') {
                const initH = pt.handleIn ?? { x: pt.x, y: pt.y };
                const newHandleIn = {
                  x: initH.x + deltaX,
                  y: initH.y + deltaY,
                };
                let newHandleOut = pt.handleOut;
                if (this._isDraggedPointSmooth && !altKey && pt.handleOut) {
                  newHandleOut = mirrorHandleCollinear(
                    { x: pt.x, y: pt.y },
                    newHandleIn,
                    pt.handleOut
                  );
                }
                return {
                  ...pt,
                  handleIn: newHandleIn,
                  handleOut: newHandleOut,
                };
              } else if (type === 'handleOut') {
                const initH = pt.handleOut ?? { x: pt.x, y: pt.y };
                const newHandleOut = {
                  x: initH.x + deltaX,
                  y: initH.y + deltaY,
                };
                let newHandleIn = pt.handleIn;
                if (this._isDraggedPointSmooth && !altKey && pt.handleIn) {
                  newHandleIn = mirrorHandleCollinear(
                    { x: pt.x, y: pt.y },
                    newHandleOut,
                    pt.handleIn
                  );
                }
                return {
                  ...pt,
                  handleIn: newHandleIn,
                  handleOut: newHandleOut,
                };
              }
              return pt;
            });

      this.stateManager.updateShape<Path>(pathId, { points: nextPoints });
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const selection = this.stateManager.getSelection();
    if (selection.length === 1) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && selectedNode.type === 'path') {
        const hit = this.findPathPointHit(selectedNode as Path, x, y);
        this.canvas.style.cursor = hit ? 'pointer' : 'default';
        return;
      }
    }
    this.canvas.style.cursor = 'default';
  }

  /**
   * Comprueba si la matriz de puntos ha cambiado respecto a la inicial.
   */
  private havePointsChanged(
    prev: readonly PathPoint[],
    next: readonly PathPoint[]
  ): boolean {
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i++) {
      const p = prev[i];
      const n = next[i];
      if (p.x !== n.x || p.y !== n.y) return true;
      if (p.handleIn?.x !== n.handleIn?.x || p.handleIn?.y !== n.handleIn?.y) return true;
      if (p.handleOut?.x !== n.handleOut?.x || p.handleOut?.y !== n.handleOut?.y) return true;
    }
    return false;
  }

  /**
   * Itera sobre los puntos de un Path buscando colisiones con manejadores de control
   * (handleIn / handleOut) o con el vértice principal (punto de ancla) usando una AABB de 10x10px.
   */
  public findPathPointHit(
    path: Path,
    x: number,
    y: number,
    customHandleSize?: number
  ): { index: number; type: DirectSelectTargetType } | null {
    if (!path.points || path.points.length === 0) return null;

    const zoom = this.viewportManager.zoom;
    const handleSize = customHandleSize ?? (10 / zoom);

    let testX = x;
    let testY = y;
    if (path.rotation) {
      const baseAABB = getPathBaseAABB(path);
      const cx = (baseAABB.minX + baseAABB.maxX) / 2;
      const cy = (baseAABB.minY + baseAABB.maxY) / 2;
      const rad = (-path.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = x - cx;
      const dy = y - cy;
      testX = cx + dx * cos - dy * sin;
      testY = cy + dx * sin + dy * cos;
    }

    // 1. Evaluar primero colisiones con manejadores de control Bézier visibles
    const visibleHandles = getVisiblePathHandles(path, this._selectedAnchors);
    for (const h of visibleHandles) {
      const handleAABB = this.createHandleAABB(h.x, h.y, handleSize);
      if (isPointInAABB(testX, testY, handleAABB)) {
        return { index: h.index, type: h.type };
      }
    }

    // 2. Evaluar colisiones con los vértices / puntos de ancla principales
    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i];
      const anchorAABB = this.createHandleAABB(pt.x, pt.y, handleSize);
      if (isPointInAABB(testX, testY, anchorAABB)) {
        return { index: i, type: 'anchor' };
      }
    }

    return null;
  }

  /**
   * Genera un AABB centrado en una coordenada (px, py) de tamaño size x size (por defecto 10x10px).
   */
  public createHandleAABB(px: number, py: number, size: number = 10): AABB {
    const half = size / 2;
    return {
      minX: px - half,
      minY: py - half,
      maxX: px + half,
      maxY: py + half,
      width: size,
      height: size,
    };
  }

  /**
   * Determina el centroide de una figura (rectángulo, elipse o trazado).
   */
  public getShapeCentroid(shape: Shape): { x: number; y: number } {
    if (shape.type === 'rectangle') {
      return {
        x: shape.x + shape.width / 2,
        y: shape.y + shape.height / 2,
      };
    }
    if (shape.type === 'ellipse') {
      return {
        x: shape.x,
        y: shape.y,
      };
    }
    if (shape.type === 'path') {
      const aabb = getPathBaseAABB(shape);
      return {
        x: (aabb.minX + aabb.maxX) / 2,
        y: (aabb.minY + aabb.maxY) / 2,
      };
    }
    const aabb = getShapeAABB(shape);
    return {
      x: (aabb.minX + aabb.maxX) / 2,
      y: (aabb.minY + aabb.maxY) / 2,
    };
  }

  /**
   * Obtiene el estilo de cursor apropiado para un manejador de redimensionamiento,
   * teniendo en cuenta la rotación de la figura para que la dirección visual sea coherente.
   */
  public getResizeCursor(handle: HandleType, rotation: number = 0): string {
    const handleAngles: Record<string, number> = {
      'top-left': 225,
      'top-right': 315,
      'bottom-right': 45,
      'bottom-left': 135,
    };
    const baseAngle = handleAngles[handle];
    if (baseAngle === undefined) return 'default';

    let totalAngle = (baseAngle + rotation) % 360;
    if (totalAngle < 0) totalAngle += 360;

    if ((totalAngle >= 337.5 || totalAngle < 22.5) || (totalAngle >= 157.5 && totalAngle < 202.5)) {
      return 'ew-resize';
    }
    if ((totalAngle >= 22.5 && totalAngle < 67.5) || (totalAngle >= 202.5 && totalAngle < 247.5)) {
      return 'nwse-resize';
    }
    if ((totalAngle >= 67.5 && totalAngle < 112.5) || (totalAngle >= 247.5 && totalAngle < 292.5)) {
      return 'ns-resize';
    }
    return 'nesw-resize';
  }

  /**
   * Calcula las dimensiones redimensionadas relativas a la esquina de manejador arrastrada,
   * manteniendo fijo el vértice opuesto (ancla) en espacio global y respetando la rotación de la figura.
   * Si preserveAspectRatio es true (tecla Shift), escala proporcionalmente sin deformar.
   */
  public calculateResizedDimensions(
    initial: ShapeDimensions,
    handle: HandleType,
    dx: number,
    dy: number,
    preserveAspectRatio: boolean = false
  ): ShapeDimensions {
    const rotation = initial.rotation ?? 0;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Proyectar el desplazamiento del cursor (delta de pantalla) en el sistema de coordenadas local rotado
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;

    let dxSign = 1;
    let dySign = 1;
    switch (handle) {
      case 'bottom-right':
        dxSign = 1;
        dySign = 1;
        break;
      case 'bottom-left':
        dxSign = -1;
        dySign = 1;
        break;
      case 'top-right':
        dxSign = 1;
        dySign = -1;
        break;
      case 'top-left':
        dxSign = -1;
        dySign = -1;
        break;
    }

    const computeSize = (
      initW: number,
      initH: number
    ): { newW: number; newH: number; scaleX: number; scaleY: number } => {
      const safeInitW = Math.max(1, initW);
      const safeInitH = Math.max(1, initH);

      if (!preserveAspectRatio) {
        const newW = Math.max(5, initW + dxSign * localDx);
        const newH = Math.max(5, initH + dySign * localDy);
        return {
          newW,
          newH,
          scaleX: newW / safeInitW,
          scaleY: newH / safeInitH,
        };
      }

      const rawNewW = initW + dxSign * localDx;
      const rawNewH = initH + dySign * localDy;

      let scale: number;
      if (initW < 1) {
        scale = rawNewH / safeInitH;
      } else if (initH < 1) {
        scale = rawNewW / safeInitW;
      } else {
        const sx = rawNewW / safeInitW;
        const sy = rawNewH / safeInitH;
        scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      }

      const minScale = Math.max(5 / safeInitW, 5 / safeInitH);
      scale = Math.max(minScale, scale);

      const newW = Math.max(5, initW * scale);
      const newH = Math.max(5, initH * scale);

      return {
        newW,
        newH,
        scaleX: scale,
        scaleY: scale,
      };
    };

    if (initial.points !== undefined && initial.points.length > 0) {
      const baseAABB = getPathBaseAABB(initial as Path);
      const minX = baseAABB.minX;
      const minY = baseAABB.minY;
      const maxX = baseAABB.maxX;
      const maxY = baseAABB.maxY;
      const initW = Math.max(1, baseAABB.width);
      const initH = Math.max(1, baseAABB.height);

      const { newW, newH, scaleX, scaleY } = computeSize(initW, initH);

      const anchorX = dxSign > 0 ? minX : maxX;
      const anchorY = dySign > 0 ? minY : maxY;

      const localShiftX = (dxSign * (newW - initW)) / 2;
      const localShiftY = (dySign * (newH - initH)) / 2;

      // Compensación de rotación para mantener fijo el punto ancla en coordenadas de pantalla:
      // T = (R(theta) - I) * localShift
      const tx = (localShiftX * cos - localShiftY * sin) - localShiftX;
      const ty = (localShiftX * sin + localShiftY * cos) - localShiftY;

      const scaleCoord = (pt: Vector2D): Vector2D => ({
        x: anchorX + (pt.x - anchorX) * scaleX + tx,
        y: anchorY + (pt.y - anchorY) * scaleY + ty,
      });

      const newPoints: PathPoint[] = initial.points.map((pt) => {
        const scaledMain = scaleCoord(pt);
        return {
          x: scaledMain.x,
          y: scaledMain.y,
          handleIn: pt.handleIn ? scaleCoord(pt.handleIn) : undefined,
          handleOut: pt.handleOut ? scaleCoord(pt.handleOut) : undefined,
        };
      });

      return {
        x: newPoints[0]?.x ?? initial.x ?? 0,
        y: newPoints[0]?.y ?? initial.y ?? 0,
        width: newW,
        height: newH,
        points: newPoints,
        rotation,
      };
    }

    if (initial.width !== undefined && initial.height !== undefined) {
      const initX = initial.x ?? 0;
      const initY = initial.y ?? 0;
      const initW = initial.width;
      const initH = initial.height;

      const { newW, newH } = computeSize(initW, initH);

      const localShiftX = (dxSign * (newW - initW)) / 2;
      const localShiftY = (dySign * (newH - initH)) / 2;

      const initCenterX = initX + initW / 2;
      const initCenterY = initY + initH / 2;

      const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
      const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

      return {
        x: newCenterX - newW / 2,
        y: newCenterY - newH / 2,
        width: newW,
        height: newH,
        rotation,
      };
    }

    if (initial.radiusX !== undefined && initial.radiusY !== undefined) {
      const initCenterX = initial.x ?? 0;
      const initCenterY = initial.y ?? 0;
      const initRx = initial.radiusX;
      const initRy = initial.radiusY;

      const initW = initRx * 2;
      const initH = initRy * 2;

      const { newW, newH } = computeSize(initW, initH);

      const localShiftX = (dxSign * (newW - initW)) / 2;
      const localShiftY = (dySign * (newH - initH)) / 2;

      const newRx = newW / 2;
      const newRy = newH / 2;

      const newCenterX = initCenterX + localShiftX * cos - localShiftY * sin;
      const newCenterY = initCenterY + localShiftX * sin + localShiftY * cos;

      return {
        x: newCenterX,
        y: newCenterY,
        radiusX: newRx,
        radiusY: newRy,
        rotation,
      };
    }

    return initial;
  }

  /**
   * Comprueba si las dimensiones han cambiado respecto a las iniciales.
   */
  private hasDimensionsChanged(a: ShapeDimensions, b: ShapeDimensions): boolean {
    if (a.points && b.points) {
      return this.havePointsChanged(a.points, b.points);
    }
    return (
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.radiusX !== b.radiusX ||
      a.radiusY !== b.radiusY
    );
  }
}

