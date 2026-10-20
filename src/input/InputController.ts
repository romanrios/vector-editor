import type { StateManager } from '../state/StateManager.ts';
import type { SnapGuide } from '../types/engine.ts';
import {
  isDocument,
  isGroup,
  isLayer,
  isShape,
  isText,
  type AABB,
  type Group,
  type LayerChildNode,
  type Path,
  type PathPointType,
  type SelectableNode,
  type Shape,
  type Vector2D,
  type StrokeLineCap,
  type StrokeLineJoin,
} from '../types/scene-graph.ts';
import {
  getShapeAABB,
  getTextIndexAtPosition,
  isPointInPath,
  isPointInShape,
  isPointInText,
  type AlignmentMode,
  type DistributionAxis,
  type HandleType,
} from '../utils/geometry.ts';
import { CommandManager } from '../commands/CommandManager.ts';
import { type ShapeDimensions } from '../commands/ResizeCommand.ts';
import { ViewportManager } from '../utils/viewport.ts';
import {
  SelectionOperations,
  type ClipboardList,
  type ClipboardEntry,
  createClipboardList,
  asShapeArray,
} from './SelectionOperations.ts';
import type { BooleanOp } from '../utils/booleanOperations.ts';
import {
  TextEditManager,
  type TextEditingState,
  type TextEditStateView,
} from './TextEditManager.ts';
import {
  SelectToolHandler,
  type MultiTransformState,
} from './tools/SelectToolHandler.ts';
import { PenToolHandler } from './tools/PenToolHandler.ts';
import {
  DirectSelectToolHandler,
  type DirectSelectTarget,
  type DirectSelectTargetType,
} from './tools/DirectSelectToolHandler.ts';
import { CreationToolHandler } from './tools/CreationToolHandler.ts';
import { LineToolHandler } from './tools/LineToolHandler.ts';
import { TextToolHandler } from './tools/TextToolHandler.ts';
import { PencilToolHandler } from './tools/PencilToolHandler.ts';
import { EyedropperToolHandler, type EyedropperPreview, type EyedropperSampleResult } from './tools/EyedropperToolHandler.ts';

export type ToolMode = 'select' | 'pen' | 'direct-select' | 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'hand' | 'text' | 'pencil' | 'eyedropper';
export interface CanvasContextMenuData {
  readonly clientX: number;
  readonly clientY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly hitShape: Shape | null;
  readonly targetNode: SelectableNode | null;
}
export type CanvasContextMenuCallback = (data: CanvasContextMenuData) => void;
export type ColorSampledCallback = (data: EyedropperSampleResult) => void;
export type InputControllerEvent = 'toolChange' | 'exportRequest' | 'canvasContextMenu' | 'colorSampled';
export type ToolChangeCallback = (tool: ToolMode) => void;
export type ExportRequestCallback = () => void;
export type SmartGuidesChangeCallback = (enabled: boolean) => void;

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
  { key: 'Ctrl+E / Cmd+E', description: 'Abrir diálogo de exportación', category: 'Archivo' },
  { key: 'V', description: 'Herramienta Selección', category: 'Herramientas' },
  { key: 'A', description: 'Herramienta Selección directa', category: 'Herramientas' },
  { key: 'P', description: 'Herramienta Pluma (Bézier)', category: 'Herramientas' },
  { key: 'B / N', description: 'Herramienta Lápiz (trazo libre)', category: 'Herramientas' },
  { key: 'I', description: 'Herramienta Cuentagotas (muestreo de color)', category: 'Herramientas' },
  { key: 'R', description: 'Herramienta Rectángulo', category: 'Herramientas' },
  { key: 'E', description: 'Herramienta Elipse', category: 'Herramientas' },
  { key: 'Y', description: 'Herramienta Polígono regular', category: 'Herramientas' },
  { key: 'S', description: 'Herramienta Estrella', category: 'Herramientas' },
  { key: 'L', description: 'Herramienta Línea', category: 'Herramientas' },
  { key: 'T', description: 'Herramienta Texto', category: 'Herramientas' },
  { key: 'H', description: 'Herramienta Mano', category: 'Herramientas' },
  { key: 'Ctrl+A / Cmd+A', description: 'Seleccionar todas las figuras', category: 'Selección' },
  { key: 'Shift + Clic', description: 'Añadir / quitar de la selección', category: 'Selección' },
  { key: 'Arrastrar en el vacío', description: 'Selección por marquesina (rectángulo)', category: 'Selección' },
  { key: 'Alt + arrastrar', description: 'Copiar mientras se mueve', category: 'Selección' },
  { key: 'Ctrl+Z / Cmd+Z', description: 'Deshacer última acción', category: 'Edición' },
  { key: 'Ctrl+Shift+Z / Ctrl+Y', description: 'Rehacer última acción', category: 'Edición' },
  { key: 'Ctrl+X / Cmd+X', description: 'Cortar figuras seleccionadas', category: 'Edición' },
  { key: 'Ctrl+C / Cmd+C', description: 'Copiar figuras seleccionadas', category: 'Edición' },
  { key: 'Ctrl+V / Cmd+V', description: 'Pegar figuras del portapapeles', category: 'Edición' },
  { key: 'Ctrl+D / Cmd+D', description: 'Duplicar figuras seleccionadas', category: 'Edición' },
  { key: 'Supr / Backspace', description: 'Eliminar figuras seleccionadas', category: 'Edición' },
  { key: 'Ctrl+Shift+]', description: 'Traer figuras al frente', category: 'Objeto' },
  { key: 'Ctrl+Shift+[', description: 'Enviar figuras al fondo', category: 'Objeto' },
  { key: 'Ctrl+G / Cmd+G', description: 'Agrupar figuras seleccionadas', category: 'Objeto' },
  { key: 'Ctrl+Shift+G / Cmd+Shift+G', description: 'Desagrupar figuras seleccionadas', category: 'Objeto' },
  { key: 'Ctrl+7 / Cmd+7', description: 'Crear máscara de recorte', category: 'Objeto' },
  { key: 'Ctrl+Alt+7 / Cmd+Alt+7', description: 'Soltar máscara de recorte', category: 'Objeto' },
  { key: 'Ctrl+Shift+O / Cmd+Shift+O', description: 'Contornear trazado (Stroke to Path)', category: 'Objeto' },
  { key: 'Ctrl++ / Cmd++', description: 'Acercar zoom', category: 'Navegación' },
  { key: 'Ctrl+- / Cmd+-', description: 'Alejar zoom', category: 'Navegación' },
  { key: 'Ctrl+0 / Cmd+0', description: 'Ajustar a la ventana', category: 'Navegación' },
  { key: 'Ctrl+1 / Cmd+1', description: 'Tamaño real 100 %', category: 'Navegación' },
  { key: 'Ctrl+U', description: 'Activar / desactivar guías inteligentes', category: 'Vista' },
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
  readonly type: 'rectangle' | 'ellipse' | 'marquee' | 'line' | 'pencil' | 'polygon' | 'star';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly radiusX?: number;
  readonly radiusY?: number;
  readonly points?: readonly Vector2D[];
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeDashArray?: readonly number[];
  readonly strokeLineCap?: StrokeLineCap;
  readonly strokeLineJoin?: StrokeLineJoin;
  readonly opacity?: number;
}

export {
  type DirectSelectTargetType,
  type DirectSelectTarget,
  type MultiTransformState,
  type TextEditingState,
};

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
 * Gestiona herramientas de Selección ('select'), Pluma ('pen'), Selección Directa ('direct-select'),
 * Rectángulo ('rectangle'), Elipse ('ellipse'), Texto ('text') y Mano ('hand').
 */
export class InputController {
  public static readonly SHORTCUTS: readonly KeyboardShortcut[] = KEYBOARD_SHORTCUTS;

  public readonly canvas: HTMLCanvasElement;
  public readonly stateManager: StateManager;
  public readonly commandManager: CommandManager;
  public readonly viewportManager: ViewportManager;
  private readonly options: InputControllerOptions;

  private _currentTool: ToolMode = 'select';

  // Listeners de eventos DOM
  private onMouseDownHandler: (e: MouseEvent) => void;
  private onDoubleClickHandler: (e: MouseEvent) => void;
  private onMouseMoveHandler: (e: MouseEvent) => void;
  private onMouseUpHandler: (e: MouseEvent) => void;
  private onWheelHandler: (e: WheelEvent) => void;
  private onContextMenuHandler: (e: MouseEvent) => void;
  private onKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  // Estado de navegación de vista (Pan y Zoom)
  private _isPanning: boolean = false;
  private _isSpacePressed: boolean = false;
  private _panStartScreen: { x: number; y: number } | null = null;

  // Smart guides y guías activas
  public activeGuides: SnapGuide[] = [];
  private _smartGuidesEnabled: boolean = true;

  // Operaciones de selección
  private readonly _selectionOperations: SelectionOperations;

  // Gestor de edición de texto aislado
  public readonly textEditManager: TextEditManager;

  // Estrategias de herramientas dedicadas
  public readonly selectToolHandler: SelectToolHandler;
  public readonly penToolHandler: PenToolHandler;
  public readonly directSelectToolHandler: DirectSelectToolHandler;
  public readonly creationToolHandler: CreationToolHandler;
  public readonly lineToolHandler: LineToolHandler;
  public readonly textToolHandler: TextToolHandler;
  public readonly pencilToolHandler: PencilToolHandler;
  public readonly eyedropperToolHandler: EyedropperToolHandler;

  // Event Emitter para observabilidad externa desacoplada del DOM
  private readonly eventListeners: Map<string, Set<(data: any) => void>> = new Map();
  private readonly smartGuidesListeners: Set<SmartGuidesChangeCallback> = new Set();

  constructor(
    canvas: HTMLCanvasElement,
    stateManager: StateManager,
    commandManager?: CommandManager,
    options: InputControllerOptions = {}
  ) {
    this.canvas = canvas;
    this.stateManager = stateManager;
    this.commandManager = commandManager ?? new CommandManager();
    this.options = {
      deselectOnEmptyClick: true,
      enableKeyboardShortcuts: true,
      ...options,
    };
    this.viewportManager = options.viewportManager ?? new ViewportManager();
    this._selectionOperations = new SelectionOperations(this.stateManager, this.commandManager);

    // 1. Inicializar TextEditManager
    this.textEditManager = new TextEditManager(
      this.stateManager,
      this.commandManager,
      this.canvas,
      {
        onStartEditing: () => {
          this.selectToolHandler?.resetDrag();
          this.selectToolHandler?.resetResize();
          this.selectToolHandler?.resetRotate();
          if (this.selectToolHandler?.isMarqueeSelecting) {
            this.selectToolHandler.cancelMarquee();
          }
        },
      }
    );

    // 2. Inicializar SelectToolHandler
    this.selectToolHandler = new SelectToolHandler(
      this.stateManager,
      this.commandManager,
      this._selectionOperations,
      this.canvas,
      () => this.viewportManager,
      (x, y) => this.hitTest(x, y),
      (hitShape) => this.resolveNodeToSelect(hitShape),
      () => this._smartGuidesEnabled,
      (guides) => {
        this.activeGuides = guides;
      },
      (e) => this.getScreenCoordinates(e),
      { deselectOnEmptyClick: this.options.deselectOnEmptyClick }
    );

    // 3. Inicializar PenToolHandler
    this.penToolHandler = new PenToolHandler(
      this.stateManager,
      this.canvas,
      () => this.viewportManager,
      this.commandManager
    );

    // 4. Inicializar DirectSelectToolHandler
    this.directSelectToolHandler = new DirectSelectToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      () => this.viewportManager,
      (x, y) => this.hitTest(x, y)
    );

    // 5. Inicializar CreationToolHandler
    this.creationToolHandler = new CreationToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      () => this.viewportManager,
      (tool) => this.setTool(tool),
      () => this._smartGuidesEnabled,
      (guides) => {
        this.activeGuides = guides;
      }
    );

    // 6. Inicializar LineToolHandler
    this.lineToolHandler = new LineToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      () => this.viewportManager,
      (tool) => this.setTool(tool)
    );

    // 7. Inicializar TextToolHandler
    this.textToolHandler = new TextToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      this.textEditManager,
      (x, y) => this.hitTest(x, y)
    );

    // 8. Inicializar PencilToolHandler
    this.pencilToolHandler = new PencilToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      () => this.viewportManager
    );

    // 9. Inicializar EyedropperToolHandler
    this.eyedropperToolHandler = new EyedropperToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      (x, y) => this.hitTest(x, y),
      (event, data) => this.emit(event, data)
    );

    this.onMouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e);
    this.onDoubleClickHandler = (e: MouseEvent) => this.handleDoubleClick(e);
    this.onMouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
    this.onMouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);
    this.onWheelHandler = (e: WheelEvent) => this.handleWheel(e);
    this.onContextMenuHandler = (e: MouseEvent) => this.handleContextMenu(e);

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
   */
  public setTool(tool: ToolMode): void {
    if (this._currentTool === tool) return;

    if (this.textEditManager.isEditingText) {
      this.commitTextEdit();
    }

    if (this._currentTool === 'select' && tool !== 'select') {
      this.selectToolHandler.onDeactivate(tool);
    }
    if (this._currentTool === 'pen' && tool !== 'pen') {
      this.penToolHandler.onDeactivate(tool);
    }
    if (this._currentTool === 'direct-select' && tool !== 'direct-select') {
      this.directSelectToolHandler.onDeactivate(tool);
    }
    if (
      (this._currentTool === 'rectangle' ||
        this._currentTool === 'ellipse' ||
        this._currentTool === 'polygon' ||
        this._currentTool === 'star') &&
      tool !== 'rectangle' &&
      tool !== 'ellipse' &&
      tool !== 'polygon' &&
      tool !== 'star'
    ) {
      this.creationToolHandler.onDeactivate(tool);
    }
    if (this._currentTool === 'line' && tool !== 'line') {
      this.lineToolHandler.onDeactivate(tool);
    }
    if (this._currentTool === 'text' && tool !== 'text') {
      this.textToolHandler.onDeactivate(tool);
    }
    if (this._currentTool === 'pencil' && tool !== 'pencil') {
      this.pencilToolHandler.onDeactivate(tool);
    }
    if (this._currentTool === 'eyedropper' && tool !== 'eyedropper') {
      this.eyedropperToolHandler.onDeactivate(tool);
    }

    this._currentTool = tool;

    if (tool === 'direct-select') {
      this.directSelectToolHandler.onActivate();
    } else if (tool === 'pen') {
      this.penToolHandler.onActivate();
    } else if (tool === 'pencil') {
      this.pencilToolHandler.onActivate();
    } else if (tool === 'eyedropper') {
      this.eyedropperToolHandler.onActivate();
    } else if (
      tool === 'rectangle' ||
      tool === 'ellipse' ||
      tool === 'polygon' ||
      tool === 'star'
    ) {
      this.creationToolHandler.onActivate();
    } else if (tool === 'line') {
      this.lineToolHandler.onActivate();
    } else if (tool === 'text') {
      this.textToolHandler.onActivate();
    } else if (tool === 'select') {
      this.selectToolHandler.onActivate();
    } else if (tool === 'hand') {
      this.canvas.style.cursor = 'grab';
    }

    this.emit('toolChange', tool);
    this.restoreToolCursor();
  }

  public on(event: 'toolChange', listener: ToolChangeCallback): () => void;
  public on(event: 'exportRequest', listener: ExportRequestCallback): () => void;
  public on(event: 'canvasContextMenu', listener: CanvasContextMenuCallback): () => void;
  public on(event: 'colorSampled', listener: ColorSampledCallback): () => void;
  public on(event: InputControllerEvent, listener: (...args: any[]) => void): () => void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(listener);

    return () => {
      (this.off as (e: InputControllerEvent, l: any) => void)(event, listener);
    };
  }

  public off(event: 'toolChange', listener: ToolChangeCallback): void;
  public off(event: 'exportRequest', listener: ExportRequestCallback): void;
  public off(event: 'canvasContextMenu', listener: CanvasContextMenuCallback): void;
  public off(event: 'colorSampled', listener: ColorSampledCallback): void;
  public off(event: InputControllerEvent, listener: (...args: any[]) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  public emit(event: 'toolChange', tool: ToolMode): void;
  public emit(event: 'exportRequest'): void;
  public emit(event: 'canvasContextMenu', data: CanvasContextMenuData): void;
  public emit(event: 'colorSampled', data: EyedropperSampleResult): void;
  public emit(event: InputControllerEvent, arg?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(arg);
      }
    }
  }

  public get isDragging(): boolean {
    return this.selectToolHandler.isDragging;
  }

  public get smartGuidesEnabled(): boolean {
    return this._smartGuidesEnabled;
  }

  public setSmartGuidesEnabled(enabled: boolean): void {
    if (this._smartGuidesEnabled === enabled) return;
    this._smartGuidesEnabled = enabled;
    if (!enabled && this.activeGuides.length > 0) {
      this.activeGuides = [];
      this.stateManager.markDirty();
    }
    for (const listener of this.smartGuidesListeners) {
      listener(enabled);
    }
  }

  public onSmartGuidesChange(listener: SmartGuidesChangeCallback): () => void {
    this.smartGuidesListeners.add(listener);
    return () => {
      this.smartGuidesListeners.delete(listener);
    };
  }

  public get isCopyDragging(): boolean {
    return this.selectToolHandler.isCopyDragging;
  }

  public get isCreatingShape(): boolean {
    return this.creationToolHandler.isCreatingShape;
  }

  public get isCreatingLine(): boolean {
    return this.lineToolHandler.isCreating;
  }

  public get shapePreview(): ShapePreview | null {
    if (
      this._currentTool === 'rectangle' ||
      this._currentTool === 'ellipse' ||
      this._currentTool === 'polygon' ||
      this._currentTool === 'star'
    ) {
      return this.creationToolHandler.shapePreview;
    }
    if (this._currentTool === 'line') {
      return this.lineToolHandler.shapePreview;
    }
    if (this._currentTool === 'pencil') {
      return this.pencilToolHandler.shapePreview;
    }
    if (this._currentTool === 'select') {
      return this.selectToolHandler.shapePreview;
    }
    return null;
  }

  public get isDrawingPencil(): boolean {
    return this.pencilToolHandler.isDrawing;
  }

  public get eyedropperPreview(): EyedropperPreview | null {
    return this._currentTool === 'eyedropper' ? this.eyedropperToolHandler.preview : null;
  }

  public get isMarqueeSelecting(): boolean {
    return this.selectToolHandler.isMarqueeSelecting;
  }

  public get isEditingText(): boolean {
    return this.textEditManager.isEditingText;
  }

  public get textEditingState(): TextEditingState | null {
    return this.textEditManager.textEditingState;
  }

  public get hasTextSelection(): boolean {
    return this.textEditManager.hasTextSelection;
  }

  public get textCursorPosition(): number {
    return this.textEditManager.textCursorPosition;
  }

  public get textSelectionRange(): { start: number; end: number } | null {
    return this.textEditManager.textSelectionRange;
  }

  public get textEditState(): TextEditStateView | null {
    return this.textEditManager.textEditState;
  }

  public cancelMarquee(): void {
    this.selectToolHandler.cancelMarquee();
  }

  public get isResizing(): boolean {
    return this.selectToolHandler.isResizing;
  }

  public get isRotating(): boolean {
    return this.selectToolHandler.isRotating;
  }

  public get isMultiTransforming(): boolean {
    return this.selectToolHandler.isMultiTransforming;
  }

  public get multiTransformState(): MultiTransformState | null {
    return this.selectToolHandler.multiTransformState;
  }

  public get rotatingNodeId(): string | null {
    return this.selectToolHandler.rotatingNodeId;
  }

  public get initialRotateAngle(): number | null {
    return this.selectToolHandler.initialRotateAngle;
  }

  public get draggedPointIndex(): number | null {
    return this.directSelectToolHandler.draggedPointIndex;
  }

  public get _draggedPointIndex(): number | null {
    return this.directSelectToolHandler.draggedPointIndex;
  }

  public get draggedTargetType(): DirectSelectTargetType | null {
    return this.directSelectToolHandler.draggedTargetType;
  }

  public get draggedPointTarget(): DirectSelectTarget | null {
    return this.directSelectToolHandler.draggedPointTarget;
  }

  public get dragTarget(): DirectSelectTarget | null {
    return this.directSelectToolHandler.dragTarget;
  }

  public get directSelectTarget(): DirectSelectTarget | null {
    return this.directSelectToolHandler.directSelectTarget;
  }

  public get pathEditState(): {
    pathId: string;
    selectedAnchors: ReadonlySet<number>;
    hoverInsertPoint?: Vector2D | null;
  } | null {
    if (this._currentTool === 'pen') {
      return this.penToolHandler.pathEditState;
    }
    if (this._currentTool === 'direct-select') {
      return this.directSelectToolHandler.pathEditState;
    }
    return null;
  }

  public get isDraggingPoint(): boolean {
    return this.directSelectToolHandler.isDraggingPoint;
  }

  public get resizeOriginPoint(): { x: number; y: number } | null {
    return this.selectToolHandler.resizeOriginPoint;
  }

  public get currentResizeHandle(): HandleType | null {
    return this.selectToolHandler.currentResizeHandle;
  }

  public get resizingNodeId(): string | null {
    return this.selectToolHandler.resizingNodeId;
  }

  public get initialResizeDimensions(): ShapeDimensions | null {
    return this.selectToolHandler.initialResizeDimensions;
  }

  public get hoveredShapeId(): string | null {
    return this.selectToolHandler.hoveredShapeId;
  }

  public get activePenPathId(): string | null {
    return this.penToolHandler.activePathId;
  }

  public get clipboard(): (readonly Shape[] & { readonly id?: string }) | null {
    return this._selectionOperations.clipboard as unknown as (readonly Shape[] & { readonly id?: string }) | null;
  }

  public get pasteCount(): number {
    return this._selectionOperations.pasteCount;
  }

  public get selectionOperations(): SelectionOperations {
    return this._selectionOperations;
  }

  public getShortcuts(): readonly KeyboardShortcut[] {
    return KEYBOARD_SHORTCUTS;
  }

  private attachEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDownHandler);
    this.canvas.addEventListener('dblclick', this.onDoubleClickHandler);
    this.canvas.addEventListener('mousemove', this.onMouseMoveHandler);
    this.canvas.addEventListener('wheel', this.onWheelHandler, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenuHandler);

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

  public destroy(): void {
    this.textEditManager.destroy();
    this.selectToolHandler.destroy();
    this.penToolHandler.destroy();
    this.directSelectToolHandler.destroy();
    this.creationToolHandler.destroy();
    this.lineToolHandler.destroy();
    this.textToolHandler.destroy();

    this.canvas.removeEventListener('mousedown', this.onMouseDownHandler);
    this.canvas.removeEventListener('dblclick', this.onDoubleClickHandler);
    this.canvas.removeEventListener('mousemove', this.onMouseMoveHandler);
    this.canvas.removeEventListener('wheel', this.onWheelHandler);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuHandler);

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

    this.eventListeners.clear();
    this.smartGuidesListeners.clear();
  }

  public getLocalCoordinates(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return this.viewportManager.screenToWorld({ x: screenX, y: screenY });
  }

  public getScreenCoordinates(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  public handleWheel(event: WheelEvent): void {
    event.preventDefault?.();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (event.ctrlKey || event.metaKey) {
      const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
      this.viewportManager.zoomAt({ x: screenX, y: screenY }, zoomFactor);
    } else {
      this.viewportManager.panBy(-event.deltaX, -event.deltaY);
    }
  }

  private restoreToolCursor(): void {
    if (this._currentTool === 'hand') {
      this.canvas.style.cursor = 'grab';
    } else if (
      this._currentTool === 'pen' ||
      this._currentTool === 'pencil' ||
      this._currentTool === 'eyedropper' ||
      this._currentTool === 'rectangle' ||
      this._currentTool === 'ellipse' ||
      this._currentTool === 'polygon' ||
      this._currentTool === 'star' ||
      this._currentTool === 'line'
    ) {
      this.canvas.style.cursor = 'crosshair';
    } else if (this._currentTool === 'text') {
      this.canvas.style.cursor = 'text';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  public getCanvasCenter(): Vector2D {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : null;
    const width = rect?.width || this.canvas.width || 800;
    const height = rect?.height || this.canvas.height || 600;
    return { x: width / 2, y: height / 2 };
  }

  public getCanvasSize(): { width: number; height: number } {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : null;
    const width = rect?.width || this.canvas.width || 800;
    const height = rect?.height || this.canvas.height || 600;
    return { width, height };
  }

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

  public zoomIn(): void {
    this.viewportManager.zoomAt(this.getCanvasCenter(), 1.25);
  }

  public zoomOut(): void {
    this.viewportManager.zoomAt(this.getCanvasCenter(), 1 / 1.25);
  }

  public zoomReset(): void {
    this.viewportManager.resetZoom(this.getCanvasCenter());
  }

  public zoomFit(): void {
    const canvasSize = this.getCanvasSize();
    const bounds = this.getVisibleWorldBounds();
    this.viewportManager.fitToBounds(canvasSize, bounds, 40);
  }

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
      if (node.isClipMask) {
        const maskShape = node.clipChildId
          ? node.children.find((c) => c.id === node.clipChildId)
          : node.children[node.children.length - 1];
        if (maskShape && isShape(maskShape)) {
          let insideMask = false;
          if (maskShape.type === 'path') {
            insideMask = isPointInPath(x, y, maskShape as Path, ctx, 8 / zoom);
          } else {
            insideMask = isPointInShape(x, y, maskShape, 4 / zoom);
          }
          if (!insideMask) {
            return null;
          }
        }
      }

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
        if (isPointInPath(x, y, node as Path, ctx, 8 / zoom)) {
          return node;
        }
      } else if (node.type === 'text') {
        const tolerance = 4 / zoom;
        const currentText =
          this.textEditManager.isEditingText && this.textEditManager.textEditingState?.textId === node.id
            ? this.textEditManager.textEditingState.currentText
            : node.text;
        const effectiveText = {
          ...node,
          text: currentText.length > 0 ? currentText : ' ',
        };
        if (isPointInText(x, y, effectiveText, tolerance, ctx)) {
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

  public hitTest(x: number, y: number): Shape | null {
    const state = this.stateManager.getState();
    const ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    const zoom = this.viewportManager.zoom;

    for (let l = state.children.length - 1; l >= 0; l--) {
      const layer = state.children[l];
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

  private getOutermostGroupOrSelf(node: SelectableNode): SelectableNode {
    let current: SelectableNode = node;
    while (true) {
      const parent = this.stateManager.findParent(current.id);
      if (parent && isGroup(parent)) {
        current = parent;
      } else {
        break;
      }
    }
    return current;
  }

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

  public resolveNodeToSelect(hitShape: Shape): SelectableNode {
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

  public handleDoubleClick(event: MouseEvent): void {
    if (this._currentTool !== 'select' && this._currentTool !== 'text') {
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);
    const hitShape = this.hitTest(x, y);
    if (!hitShape) {
      return;
    }

    if (isText(hitShape)) {
      this._currentTool = 'text';
      this.emit('toolChange', 'text');
      this.canvas.style.cursor = 'text';
      const ctx = this.textEditManager.getMeasureContext();
      const charIndex = getTextIndexAtPosition(hitShape, x, y, ctx);
      this.startEditingText(hitShape.id, charIndex);
      this.canvas.style.cursor = 'text';
      return;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isGroup(selectedNodes[0])) {
      const selectedGroup = selectedNodes[0];
      const directChild = this.findDirectChildInGroup(selectedGroup, hitShape);
      if (directChild) {
        this.stateManager.setSelection([directChild.id]);
        this.selectToolHandler.resetDrag();
        this.selectToolHandler.resetResize();
        this.selectToolHandler.resetRotate();
      }
    }
  }

  public finishActivePath(closed: boolean = false): void {
    this.penToolHandler.finishActivePath(closed);
  }

  public handleMouseDown(event: MouseEvent): void {
    const isHandPan = this._currentTool === 'hand' && (event.button === 0 || event.button === undefined);
    const isMiddlePan = event.button === 1;
    const isSpacePan = this._isSpacePressed && (event.button === 0 || event.button === undefined);

    if (isHandPan || isMiddlePan || isSpacePan) {
      this._isPanning = true;
      this._panStartScreen = { x: event.clientX, y: event.clientY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // El clic derecho (button === 2) o botones secundarios no deben iniciar arrastre, redimensionado o creación de figuras
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const coords = this.getLocalCoordinates(event);
    const { x, y } = coords;

    if (this.textEditManager.isEditingText) {
      const hitShape = this.hitTest(x, y);
      if (hitShape && hitShape.id === this.textEditManager.textEditingState?.textId) {
        this.textEditManager.handleMouseDown(hitShape, x, y);
        return;
      }
      this.commitTextEdit();
      return;
    }

    if (
      this._currentTool === 'rectangle' ||
      this._currentTool === 'ellipse' ||
      this._currentTool === 'polygon' ||
      this._currentTool === 'star'
    ) {
      this.creationToolHandler.onMouseDown(event, coords, this._currentTool);
      return;
    }

    if (this._currentTool === 'line') {
      this.lineToolHandler.onMouseDown(event, coords);
      return;
    }

    if (this._currentTool === 'pencil') {
      this.pencilToolHandler.onMouseDown(event, coords);
      return;
    }

    if (this._currentTool === 'eyedropper') {
      this.eyedropperToolHandler.onMouseDown(event, coords);
      return;
    }

    if (this._currentTool === 'pen') {
      this.penToolHandler.onMouseDown(event, coords);
      return;
    }

    if (this._currentTool === 'direct-select') {
      this.directSelectToolHandler.onMouseDown(event, coords);
      return;
    }

    if (this._currentTool === 'text') {
      this.textToolHandler.onMouseDown(event, coords);
      return;
    }

    // Modo 'select'
    this.selectToolHandler.onMouseDown(event, coords);
  }

  public isNodeOrAncestorSelected(nodeId: string): boolean {
    if (this.stateManager.isSelected(nodeId)) {
      return true;
    }
    let currentParent = this.stateManager.findParent(nodeId);
    while (currentParent && !isDocument(currentParent) && !isLayer(currentParent)) {
      if (this.stateManager.isSelected(currentParent.id)) {
        return true;
      }
      currentParent = this.stateManager.findParent(currentParent.id);
    }
    return false;
  }

  public handleContextMenu(event: MouseEvent): void {
    event.preventDefault?.();

    if (this.textEditManager.isEditingText) {
      this.commitTextEdit();
    }

    const coords = this.getLocalCoordinates(event);
    const hitShape = this.hitTest(coords.x, coords.y);
    const targetNode = hitShape ? this.resolveNodeToSelect(hitShape) : null;

    if (targetNode) {
      const isAlreadyInSelection =
        this.stateManager.isSelected(targetNode.id) ||
        (hitShape ? this.isNodeOrAncestorSelected(hitShape.id) : false);

      if (!isAlreadyInSelection) {
        if (event.shiftKey) {
          this.stateManager.toggleInSelection(targetNode.id);
        } else {
          this.stateManager.selectNode(targetNode.id);
        }
      }
    } else {
      if (this.options.deselectOnEmptyClick && !event.shiftKey) {
        this.stateManager.selectNode(null);
      }
    }

    this.emit('canvasContextMenu', {
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: coords.x,
      worldY: coords.y,
      hitShape,
      targetNode,
    });
  }

  public startEditingText(textId: string, initialCursorIndex?: number, selectAll: boolean = false): boolean {
    return this.textEditManager.startEditingText(textId, initialCursorIndex, selectAll);
  }

  public commitTextEdit(): boolean {
    return this.textEditManager.commitTextEdit();
  }

  public cancelTextEdit(): void {
    this.textEditManager.cancelTextEdit();
  }

  public handleMouseMove(event: MouseEvent): void {
    if (this._isPanning && this._panStartScreen) {
      const dx = event.clientX - this._panStartScreen.x;
      const dy = event.clientY - this._panStartScreen.y;
      this._panStartScreen = { x: event.clientX, y: event.clientY };
      this.viewportManager.panBy(dx, dy);
      return;
    }

    if (this._isSpacePressed || this._currentTool === 'hand') {
      this.canvas.style.cursor = 'grab';
      return;
    }

    const coords = this.getLocalCoordinates(event);
    const { x, y } = coords;

    if (this.textEditManager.isMouseSelectingText) {
      this.textEditManager.handleMouseMove(x, y);
      return;
    }

    if (
      this._currentTool === 'rectangle' ||
      this._currentTool === 'ellipse' ||
      this._currentTool === 'polygon' ||
      this._currentTool === 'star'
    ) {
      this.creationToolHandler.onMouseMove(event, coords, this._currentTool);
      return;
    }

    if (this._currentTool === 'line') {
      this.lineToolHandler.onMouseMove(event, coords);
      return;
    }

    if (this._currentTool === 'pencil') {
      this.pencilToolHandler.onMouseMove(event, coords);
      return;
    }

    if (this._currentTool === 'eyedropper') {
      this.eyedropperToolHandler.onMouseMove(event, coords);
      return;
    }

    if (this._currentTool === 'pen') {
      this.penToolHandler.onMouseMove(event, coords);
      return;
    }

    if (this._currentTool === 'direct-select') {
      this.directSelectToolHandler.onMouseMove(event, coords);
      return;
    }

    if (this._currentTool === 'text') {
      this.textToolHandler.onMouseMove(event, coords);
      this.canvas.style.cursor = 'text';
      return;
    }

    // Modo 'select'
    this.selectToolHandler.onMouseMove(event, coords);
  }

  public handleMouseUp(event: MouseEvent): void {
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

    // El clic derecho (button === 2) o botones secundarios no deben disparar acciones de finalización de herramientas
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    const coords = this.getLocalCoordinates(event);

    if (this.textToolHandler.textCreation) {
      this.textToolHandler.onMouseUp(event, coords);
      return;
    }

    if (this.textEditManager.isMouseSelectingText) {
      this.textEditManager.handleMouseUp();
      return;
    }

    if (
      this.creationToolHandler.isCreatingShape &&
      (this._currentTool === 'rectangle' ||
        this._currentTool === 'ellipse' ||
        this._currentTool === 'polygon' ||
        this._currentTool === 'star')
    ) {
      this.creationToolHandler.onMouseUp(event, coords, this._currentTool);
      return;
    }

    if (this._currentTool === 'line') {
      this.lineToolHandler.onMouseUp(event, coords);
      return;
    }

    if (this._currentTool === 'pencil') {
      this.pencilToolHandler.onMouseUp(event, coords);
      return;
    }

    if (this._currentTool === 'eyedropper') {
      this.eyedropperToolHandler.onMouseUp(event, coords);
      return;
    }

    if (this._currentTool === 'pen') {
      this.penToolHandler.onMouseUp(event, coords);
      return;
    }

    if (this._currentTool === 'text') {
      return;
    }

    if (this._currentTool === 'direct-select') {
      this.directSelectToolHandler.onMouseUp(event, coords);
      return;
    }

    // Modo 'select'
    this.selectToolHandler.onMouseUp(event, coords);
  }

  public handleKeyDown(event: KeyboardEvent): void {
    if (this.isInputFocused(event)) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key && event.key.toLowerCase() === 'u') {
      event.preventDefault?.();
      this.setSmartGuidesEnabled(!this.smartGuidesEnabled);
      return;
    }

    if (this.textEditManager.isEditingText) {
      this.textEditManager.handleKeyDown(event);
      return;
    }

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

      if (keyLower === 'x') {
        event.preventDefault?.();
        this.cut();
        return;
      }

      if (keyLower === 'c') {
        event.preventDefault?.();
        this.copy();
        return;
      }

      if (keyLower === 'v') {
        event.preventDefault?.();
        this.paste();
        return;
      }

      if (keyLower === 'd') {
        event.preventDefault?.();
        this.duplicate();
        return;
      }

      if (keyLower === 'a') {
        event.preventDefault?.();
        this.stateManager.selectAll();
        return;
      }

      if (keyLower === 'e') {
        event.preventDefault?.();
        this.emit('exportRequest');
        return;
      }

      if (keyLower === 'g') {
        event.preventDefault?.();
        if (event.shiftKey) {
          this.ungroupSelection();
        } else {
          this.groupSelection();
        }
        return;
      }

      if (key === '7' || event.code === 'Digit7' || event.code === 'Numpad7') {
        event.preventDefault?.();
        if (event.altKey) {
          this.releaseClipMask();
        } else {
          this.makeClipMask();
        }
        return;
      }

      if (keyLower === 'o' && event.shiftKey) {
        event.preventDefault?.();
        this.outlineStroke();
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

      if (key === '+' || key === '=') {
        event.preventDefault?.();
        this.zoomIn();
        return;
      } else if (key === '-') {
        event.preventDefault?.();
        this.zoomOut();
        return;
      } else if (key === '0') {
        event.preventDefault?.();
        this.zoomFit();
        return;
      } else if (key === '1') {
        event.preventDefault?.();
        this.zoomReset();
        return;
      }
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
      this.selectToolHandler.handleShiftToggle(true);
      if (this.creationToolHandler.isCreatingShape) {
        this.creationToolHandler.updateShapePreview(
          this._currentTool as 'rectangle' | 'ellipse' | 'polygon' | 'star',
          true
        );
        this.stateManager.markDirty();
      } else if (this._currentTool === 'line' && this.lineToolHandler.isCreating) {
        this.lineToolHandler.updatePreview(true);
        this.stateManager.markDirty();
      }
    }

    if (event.key === 'Alt') {
      this.selectToolHandler.handleAltToggle(true);
    }

    const key = event.key;
    const isArrowKey =
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'Up' ||
      key === 'Down' ||
      key === 'Left' ||
      key === 'Right';

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
    } else if (keyLower === 'b' || keyLower === 'n') {
      this.setTool('pencil');
    } else if (keyLower === 'i') {
      this.setTool('eyedropper');
    } else if (keyLower === 'v') {
      this.setTool('select');
    } else if (keyLower === 'a') {
      this.setTool('direct-select');
    } else if (keyLower === 'r') {
      this.setTool('rectangle');
    } else if (keyLower === 'e') {
      this.setTool('ellipse');
    } else if (keyLower === 'y') {
      this.setTool('polygon');
    } else if (keyLower === 's') {
      this.setTool('star');
    } else if (keyLower === 'l') {
      this.setTool('line');
    } else if (keyLower === 'h') {
      this.setTool('hand');
    } else if (keyLower === 't') {
      this.setTool('text');
    } else if (keyLower === 'escape') {
      if (this.selectToolHandler.handleEscape()) {
        return;
      } else if (this.creationToolHandler.isCreatingShape) {
        this.creationToolHandler.cancelCreation();
      } else if (this._currentTool === 'line') {
        this.lineToolHandler.cancelCreation();
      } else if (this._currentTool === 'pencil') {
        this.pencilToolHandler.cancelDrawing();
      } else if (this._currentTool === 'pen') {
        this.penToolHandler.finishActivePath();
      } else if (
        !this.selectToolHandler.isDragging &&
        !this.selectToolHandler.isResizing &&
        !this.selectToolHandler.isRotating &&
        !this._isPanning &&
        !this.directSelectToolHandler.isDraggingPoint &&
        this.stateManager.getSelection().length > 0
      ) {
        this.stateManager.selectNode(null);
      }
    } else if (keyLower === 'enter') {
      if (this._currentTool === 'pen') {
        this.penToolHandler.finishActivePath();
      } else {
        const selectedNodes = this.stateManager.getSelectedNodes();
        if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
          event.preventDefault?.();
          this._currentTool = 'text';
          this.emit('toolChange', 'text');
          this.startEditingText(selectedNodes[0].id);
          return;
        }
      }
    }
  }

  public handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this.selectToolHandler.handleShiftToggle(false);
      if (this.creationToolHandler.isCreatingShape) {
        this.creationToolHandler.updateShapePreview(
          this._currentTool as 'rectangle' | 'ellipse' | 'polygon' | 'star',
          false
        );
        this.stateManager.markDirty();
      } else if (this._currentTool === 'line' && this.lineToolHandler.isCreating) {
        this.lineToolHandler.updatePreview(false);
        this.stateManager.markDirty();
      }
    }

    if (event.key === 'Alt') {
      this.selectToolHandler.handleAltToggle(false);
    }

    if (event.code === 'Space' || event.key === ' ') {
      this._isSpacePressed = false;
      if (!this._isPanning) {
        this.restoreToolCursor();
      }
    }
  }

  private isInputFocused(event: KeyboardEvent): boolean {
    const target =
      (event.target as HTMLElement | null) ??
      (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
    if (!target) {
      return false;
    }
    const tagName = target.tagName;
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      (target as any).isContentEditable === true
    );
  }

  public getSelectedShapesGroupedByLayer(
    shapes: readonly Shape[] = this.stateManager.getSelectedNodes().filter(isShape)
  ): Map<string, { shape: Shape; index: number }[]> {
    return this._selectionOperations.getSelectedShapesGroupedByLayer(shapes);
  }

  public bringToFront(shapeId?: string): boolean {
    return this._selectionOperations.bringToFront(shapeId);
  }

  public sendToBack(shapeId?: string): boolean {
    return this._selectionOperations.sendToBack(shapeId);
  }

  public duplicate(): (Shape[] & Shape) | null {
    return this._selectionOperations.duplicate();
  }

  public cut(): boolean {
    return this._selectionOperations.cut();
  }

  public copy(): boolean {
    return this._selectionOperations.copy();
  }

  public paste(targetPoint?: { x: number; y: number }): (Shape[] & Shape) | null {
    return this._selectionOperations.paste(targetPoint);
  }

  public pasteAt(x: number, y: number): (Shape[] & Shape) | null {
    return this._selectionOperations.paste({ x, y });
  }

  public groupSelection(): Group | null {
    return this._selectionOperations.groupSelection();
  }

  public ungroupSelection(): boolean {
    return this._selectionOperations.ungroupSelection();
  }

  public makeClipMask(): Group | null {
    return this._selectionOperations.makeClipMask();
  }

  public releaseClipMask(): boolean {
    return this._selectionOperations.releaseClipMask();
  }

  public outlineStroke(): boolean {
    return this._selectionOperations.outlineStroke();
  }

  public applyStyle(style: Partial<{ fill: string; stroke: string; strokeWidth: number }>): boolean {
    return this._selectionOperations.applyStyle(style);
  }

  public deleteSelected(): boolean {
    if (this._currentTool === 'direct-select' && this.directSelectToolHandler.selectedAnchors.size > 0) {
      const deleted = this.directSelectToolHandler.deleteSelectedAnchors();
      if (deleted) return true;
    }
    return this._selectionOperations.deleteSelected();
  }

  public setSelectedPathPointType(type: PathPointType): boolean {
    return this.directSelectToolHandler.setSelectedAnchorsType(type);
  }

  public setSelectedPathPointCornerRadius(radius?: number): boolean {
    return this.directSelectToolHandler.setSelectedAnchorsCornerRadius(radius);
  }

  public moveSelection(dx: number, dy: number, timestamp?: number): boolean {
    if (this._currentTool !== 'select') {
      return false;
    }
    return this._selectionOperations.moveSelection(dx, dy, timestamp);
  }

  public alignSelection(mode: AlignmentMode): boolean {
    return this._selectionOperations.alignSelection(mode);
  }

  public distributeSelection(axis: DistributionAxis): boolean {
    return this._selectionOperations.distributeSelection(axis);
  }

  public applyBooleanOperation(op: BooleanOp): boolean {
    return this._selectionOperations.applyBooleanOperation(op);
  }

  public cancelCreation(): void {
    const wasCreating =
      this.creationToolHandler.isCreatingShape ||
      this.creationToolHandler.shapePreview !== null ||
      this.textToolHandler.textCreation !== null;
    this.creationToolHandler.cancelCreation();
    this.textToolHandler.cancelCreation();
    if (this.activeGuides.length > 0) {
      this.activeGuides = [];
    }
    if (wasCreating) {
      this.stateManager.markDirty();
    }
  }

  public findPathPointHit(
    path: Path,
    x: number,
    y: number,
    customHandleSize?: number
  ): { index: number; type: DirectSelectTargetType } | null {
    return this.directSelectToolHandler.findPathPointHit(path, x, y, customHandleSize);
  }

  public createHandleAABB(px: number, py: number, size: number = 10): AABB {
    return this.directSelectToolHandler.createHandleAABB(px, py, size);
  }

  public getShapeCentroid(shape: Shape): { x: number; y: number } {
    return this.selectToolHandler.getShapeCentroid(shape);
  }

  public getResizeCursor(handle: HandleType, rotation: number = 0): string {
    return this.selectToolHandler.getResizeCursor(handle, rotation);
  }

  public calculateResizedDimensions(
    initial: ShapeDimensions,
    handle: HandleType,
    dx: number,
    dy: number,
    preserveAspectRatio: boolean = false,
    fromCenter: boolean = false
  ): ShapeDimensions {
    return this.selectToolHandler.calculateResizedDimensions(
      initial,
      handle,
      dx,
      dy,
      preserveAspectRatio,
      fromCenter
    );
  }
}
