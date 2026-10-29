import { type StateManager, getLeafShapes } from '../state/StateManager.ts';
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
  type Guide,
  type Text,
  type TextKind,
} from '../types/scene-graph.ts';
import { ConvertTextTypeCommand } from '../commands/ConvertTextTypeCommand.ts';
import { ChangeTextCaseCommand, type TextCaseMode } from '../commands/ChangeTextCaseCommand.ts';
import { UpdateTextCommand } from '../commands/UpdateTextCommand.ts';
import {
  UpdateTextTypographyCommand,
  type TextPropertyUpdate,
} from '../commands/UpdateTextTypographyCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import {
  getShapeAABB,
  getTextIndexAtPosition,
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
import { TouchGestureController } from './TouchGestureController.ts';
import { ArtboardToolHandler, type ArtboardBounds } from './tools/ArtboardToolHandler.ts';
import { KEYBOARD_SHORTCUTS, type KeyboardShortcut } from './keyboardShortcuts.ts';
import { KeyboardShortcutsHandler } from './KeyboardShortcutsHandler.ts';
import { HitTestManager } from './HitTestManager.ts';

export type ToolMode = 'select' | 'pen' | 'direct-select' | 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'hand' | 'text' | 'pencil' | 'eyedropper' | 'artboard';
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

export { KEYBOARD_SHORTCUTS, type KeyboardShortcut };

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
  private onWindowWheelHandler: ((e: WheelEvent) => void) | null = null;
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
  public readonly artboardToolHandler: ArtboardToolHandler;
  public readonly hitTestManager: HitTestManager;
  public readonly keyboardShortcutsHandler: KeyboardShortcutsHandler;

  // Controlador táctil y gestual desacoplado
  public readonly touchGestureController: TouchGestureController;
  private _lastPointerDownTimestamp: number = 0;
  private _lastPointerMoveTimestamp: number = 0;
  private _lastPointerUpTimestamp: number = 0;

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
        worldToScreen: (point) => this.viewportManager.worldToScreen(point),
        screenToWorld: (point) => this.viewportManager.screenToWorld(point),
        getZoom: () => this.viewportManager.zoom,
        onWheel: (event) => this.handleWheel(event),
      }
    );

    this.viewportManager.subscribe(() => {
      if (this.textEditManager.isEditingText) {
        this.textEditManager.updateMobileInputProxyPosition();
      }
    });

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
      {
        deselectOnEmptyClick: this.options.deselectOnEmptyClick,
        isTouch: () => this.isTouch,
      }
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
      (x, y) => this.hitTest(x, y),
      () => this.isTouch
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

    // 10. Inicializar ArtboardToolHandler
    this.artboardToolHandler = new ArtboardToolHandler(
      this.stateManager,
      this.commandManager,
      this.canvas,
      () => this.viewportManager,
      () => this._smartGuidesEnabled,
      (guides) => {
        this.activeGuides = guides;
      }
    );

    this.onMouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e);
    this.onDoubleClickHandler = (e: MouseEvent) => this.handleDoubleClick(e);
    this.onMouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
    this.onMouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);
    this.onWheelHandler = (e: WheelEvent) => this.handleWheel(e);
    this.onContextMenuHandler = (e: MouseEvent) => this.handleContextMenu(e);

    // Inicializar TouchGestureController para soporte multitáctil (Pinch & Pan), Long-press y Double-tap
    this.touchGestureController = new TouchGestureController(
      this.canvas,
      {
        onSinglePointerDown: (e) => {
          this._lastPointerDownTimestamp = Date.now();
          this.handleMouseDown(e as MouseEvent);
        },
        onSinglePointerMove: (e) => {
          this._lastPointerMoveTimestamp = Date.now();
          this.handleMouseMove(e as MouseEvent);
        },
        onSinglePointerUp: (e) => {
          this._lastPointerUpTimestamp = Date.now();
          this.handleMouseUp(e as MouseEvent);
        },
        onCancelSinglePointer: () => {
          this.cancelCurrentAction();
        },
        onPinchPan: (midpointScreen, zoomFactor, panDelta) => {
          this.handlePinchPan(midpointScreen, zoomFactor, panDelta);
        },
        onLongPress: (e) => {
          this.handleContextMenu(e as MouseEvent);
        },
        onDoubleTap: (e) => {
          this._lastPointerDownTimestamp = Date.now();
          this.handleDoubleClick(e as MouseEvent);
        },
      }
    );

    this.hitTestManager = new HitTestManager(this.stateManager, () => this.isTouch);
    this.keyboardShortcutsHandler = new KeyboardShortcutsHandler(this);

    this.attachEventListeners();
  }

  public set isSpacePressed(val: boolean) {
    this._isSpacePressed = val;
  }

  public get isPanning(): boolean {
    return this._isPanning;
  }

  public get isTouch(): boolean {
    return this.touchGestureController?.isTouchActive() ?? false;
  }

  public get isPinching(): boolean {
    return this.touchGestureController?.isPinchActive ?? false;
  }

  public cancelCurrentAction(): void {
    this.creationToolHandler?.cancelCreation();
    this.pencilToolHandler?.cancelDrawing();
    this.lineToolHandler?.cancelCreation();
    this.textToolHandler?.cancelCreation();
    this.selectToolHandler?.cancelMarquee();
    this.selectToolHandler?.resetDrag();
    this.selectToolHandler?.resetResize();
    this.selectToolHandler?.resetRotate();
    this.directSelectToolHandler?.resetDrag();
    this._isPanning = false;
    this._panStartScreen = null;
    this.stateManager.markDirty();
  }

  public handlePinchPan(midpointScreen: Vector2D, zoomFactor: number, panDelta: Vector2D): void {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : { left: 0, top: 0 };
    const screenX = midpointScreen.x - rect.left;
    const screenY = midpointScreen.y - rect.top;

    if (Math.abs(zoomFactor - 1.0) > 0.0005) {
      this.viewportManager.zoomAt({ x: screenX, y: screenY }, zoomFactor);
    }
    if (Math.abs(panDelta.x) > 0.001 || Math.abs(panDelta.y) > 0.001) {
      this.viewportManager.panBy(panDelta.x, panDelta.y);
    }
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
    if (this._currentTool === 'artboard' && tool !== 'artboard') {
      this.artboardToolHandler.onDeactivate(tool);
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
    } else if (tool === 'artboard') {
      this.artboardToolHandler.onActivate();
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

  public get activeGuideDrag(): Guide | null {
    return this.selectToolHandler.activeGuideDrag;
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

  public get artboardOverlayState(): { readonly isArtboardToolActive: boolean; readonly creationBox?: ArtboardBounds | null } | null {
    if (this._currentTool !== 'artboard') return null;
    return {
      isArtboardToolActive: true,
      creationBox: this.artboardToolHandler.creationBox,
    };
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
      this.onWindowWheelHandler = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const target = e.target as HTMLElement | null;
          if (
            target === this.canvas ||
            target?.id === 'mobile-text-proxy' ||
            (target && this.canvas.contains(target))
          ) {
            this.handleWheel(e);
          }
        }
      };
      window.addEventListener('wheel', this.onWindowWheelHandler, { passive: false });
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
    this.touchGestureController.destroy();
    this.textEditManager.destroy();
    this.selectToolHandler.destroy();
    this.penToolHandler.destroy();
    this.directSelectToolHandler.destroy();
    this.creationToolHandler.destroy();
    this.lineToolHandler.destroy();
    this.textToolHandler.destroy();
    this.artboardToolHandler.destroy();

    this.canvas.removeEventListener('mousedown', this.onMouseDownHandler);
    this.canvas.removeEventListener('dblclick', this.onDoubleClickHandler);
    this.canvas.removeEventListener('mousemove', this.onMouseMoveHandler);
    this.canvas.removeEventListener('wheel', this.onWheelHandler);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuHandler);

    if (typeof window !== 'undefined') {
      window.removeEventListener('mouseup', this.onMouseUpHandler);
      if (this.onWindowWheelHandler) {
        window.removeEventListener('wheel', this.onWindowWheelHandler);
        this.onWindowWheelHandler = null;
      }
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

    if (event.ctrlKey || event.metaKey || event.altKey) {
      const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
      this.viewportManager.zoomAt({ x: screenX, y: screenY }, zoomFactor);
    } else {
      this.viewportManager.panBy(-event.deltaX, -event.deltaY);
    }
  }

  public restoreToolCursor(): void {
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
      this._currentTool === 'line' ||
      this._currentTool === 'artboard'
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

  /**
   * Centra la mesa de trabajo (Artboard) en el espacio visible del canvas.
   * Si `fit` es true, ajusta el nivel de zoom para que toda la mesa de trabajo sea visible con un margen.
   */
  public centerArtboard(fit: boolean = true, margin: number = 40): void {
    const doc = this.stateManager.getState();
    const canvasSize = this.getCanvasSize();
    const docWidth = doc?.width ?? 1920;
    const docHeight = doc?.height ?? 1080;
    const artboardBounds: AABB = {
      minX: 0,
      minY: 0,
      maxX: docWidth,
      maxY: docHeight,
      width: docWidth,
      height: docHeight,
    };

    if (fit) {
      this.viewportManager.fitToBounds(canvasSize, artboardBounds, margin);
    } else {
      const zoom = this.viewportManager.zoom;
      const canvasCenterX = canvasSize.width / 2;
      const canvasCenterY = canvasSize.height / 2;
      const boxCenterX = docWidth / 2;
      const boxCenterY = docHeight / 2;
      this.viewportManager.setViewport({
        zoom,
        panX: Math.round(canvasCenterX - boxCenterX * zoom),
        panY: Math.round(canvasCenterY - boxCenterY * zoom),
      });
    }
  }

  public hitTestNode(
    node: LayerChildNode,
    x: number,
    y: number,
    ctx: CanvasRenderingContext2D | null,
    zoom: number
  ): Shape | null {
    return this.hitTestManager.hitTestNode(
      node,
      x,
      y,
      ctx,
      zoom,
      this.textEditManager.isEditingText && this.textEditManager.textEditingState
        ? {
            textId: this.textEditManager.textEditingState.textId,
            currentText: this.textEditManager.textEditingState.currentText,
          }
        : null
    );
  }

  public hitTest(x: number, y: number): Shape | null {
    const state = this.stateManager.getState();
    const ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    const zoom = this.viewportManager.zoom;

    return this.stateManager.getSpatialIndex().hitTest(x, y, {
      zoom,
      isTouch: this.isTouch,
      ctx,
      activeTextEdit:
        this.textEditManager.isEditingText && this.textEditManager.textEditingState
          ? {
              textId: this.textEditManager.textEditingState.textId,
              currentText: this.textEditManager.textEditingState.currentText,
            }
          : null,
      document: state,
    });
  }

  public resolveNodeToSelect(hitShape: Shape): SelectableNode {
    return this.hitTestManager.resolveNodeToSelect(hitShape);
  }

  public handleDoubleClick(event: MouseEvent): void {
    const isSyntheticMouse =
      !('pointerType' in event) || (event as any).sourceCapabilities?.firesTouchEvents;
    if (
      isSyntheticMouse &&
      (Date.now() - this._lastPointerDownTimestamp < 800 ||
        Date.now() - this._lastPointerUpTimestamp < 800)
    ) {
      return;
    }

    if (this._currentTool !== 'select' && this._currentTool !== 'text') {
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);
    const hitShape = this.hitTest(x, y);
    if (!hitShape) {
      return;
    }

    if (isText(hitShape)) {
      event.preventDefault?.();
      this._currentTool = 'text';
      this.emit('toolChange', 'text');
      this.canvas.style.cursor = 'text';
      const ctx = this.textEditManager.getMeasureContext();
      const charIndex = getTextIndexAtPosition(hitShape, x, y, ctx);
      this.startEditingText(hitShape.id, charIndex);
      if (event.detail >= 3) {
        this.textEditManager.selectLineAt(charIndex);
      } else {
        this.textEditManager.selectWordAt(charIndex);
      }
      this.canvas.style.cursor = 'text';
      return;
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isGroup(selectedNodes[0])) {
      const selectedGroup = selectedNodes[0];
      const directChild = this.hitTestManager.findDirectChildInGroup(selectedGroup, hitShape);
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
    // Si fue precedido inmediatamente por un evento Pointer/Touch y el evento es un MouseEvent sintético, ignorarlo
    const isSyntheticMouse =
      !('pointerType' in event) || (event as any).sourceCapabilities?.firesTouchEvents;
    if (
      isSyntheticMouse &&
      (Date.now() - this._lastPointerDownTimestamp < 800 ||
        Date.now() - this._lastPointerUpTimestamp < 800)
    ) {
      return;
    }

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

    const hitArtboard = this.stateManager.getArtboardAt(x, y);
    if (hitArtboard && hitArtboard.id !== this.stateManager.getActiveArtboardId()) {
      this.stateManager.setActiveArtboard(hitArtboard.id);
    }

    if (this.textEditManager.isEditingText) {
      const hitShape = this.hitTest(x, y);
      if (hitShape && hitShape.id === this.textEditManager.textEditingState?.textId) {
        event.preventDefault?.();
        this.textEditManager.handleMouseDown(hitShape, x, y, event.detail);
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

    if (this._currentTool === 'artboard') {
      this.artboardToolHandler.onMouseDown(event, coords);
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
    if (this.isTouch && this._currentTool === 'select') {
      const selectedNodes = this.stateManager.getSelectedNodes();
      if (
        selectedNodes.length === 1 &&
        isText(selectedNodes[0]) &&
        !this.selectToolHandler.isPointOnHandle(coords)
      ) {
        const hitShape = this.hitTest(x, y);
        if (hitShape && isText(hitShape) && hitShape.id === selectedNodes[0].id) {
          event.preventDefault?.();
          this._currentTool = 'text';
          this.emit('toolChange', 'text');
          this.canvas.style.cursor = 'text';
          const ctx = this.textEditManager.getMeasureContext();
          const charIndex = getTextIndexAtPosition(hitShape, x, y, ctx);
          this.startEditingText(hitShape.id, charIndex);
          return;
        }
      }
    }

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
    const isSyntheticMouse =
      !('pointerType' in event) || (event as any).sourceCapabilities?.firesTouchEvents;
    if (
      isSyntheticMouse &&
      (Date.now() - this._lastPointerMoveTimestamp < 400 ||
        Date.now() - this._lastPointerDownTimestamp < 400)
    ) {
      return;
    }

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

    if (this._currentTool === 'artboard') {
      this.artboardToolHandler.onMouseMove(event, coords);
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
    if (!('pointerType' in event) && Date.now() - this._lastPointerUpTimestamp < 250) {
      return;
    }

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

    // Ignorar eventos mouseup sintéticos tras interacción táctil
    const isSyntheticMouse =
      !('pointerType' in event) || (event as any).sourceCapabilities?.firesTouchEvents;
    if (
      isSyntheticMouse &&
      (Date.now() - this._lastPointerDownTimestamp < 800 ||
        Date.now() - this._lastPointerUpTimestamp < 800)
    ) {
      return;
    }

    if (this.textEditManager.isEditingText && this.isTouch) {
      this.textEditManager.ensureProxyFocused();
    }

    const coords = this.getLocalCoordinates(event);

    if (this.textToolHandler.textCreation) {
      this.textToolHandler.onMouseUp(event, coords);
      return;
    }

    if (this.textEditManager.isEditingText) {
      if (this.textEditManager.isMouseSelectingText) {
        this.textEditManager.handleMouseUp();
      }
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

    if (this._currentTool === 'artboard') {
      this.artboardToolHandler.onMouseUp(event, coords);
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
    this.keyboardShortcutsHandler.handleKeyDown(event);
  }

  public handleKeyUp(event: KeyboardEvent): void {
    this.keyboardShortcutsHandler.handleKeyUp(event);
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

  public toggleTextKind(nodeId?: string): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const target = nodeId
      ? (this.stateManager.findNode(nodeId) as Text | null)
      : selectedNodes.length === 1 && isText(selectedNodes[0])
      ? (selectedNodes[0] as Text)
      : null;
    if (!target || !isText(target)) {
      return false;
    }
    const isArea =
      target.textKind === 'area' || (target.boxWidth !== undefined && target.textKind !== 'point');
    const nextKind: TextKind = isArea ? 'point' : 'area';
    const cmd = new ConvertTextTypeCommand(
      this.stateManager,
      target.id,
      nextKind,
      this.textEditManager.getMeasureContext()
    );
    this.commandManager.executeCommand(cmd);
    return true;
  }

  public changeTextCase(mode: TextCaseMode, nodeId?: string): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const textNodes: Text[] = nodeId
      ? (() => {
          const n = this.stateManager.findNode(nodeId);
          return n && isText(n) ? [n as Text] : [];
        })()
      : getLeafShapes(selectedNodes).filter(isText);
    if (textNodes.length === 0) {
      return false;
    }
    if (textNodes.length === 1) {
      const cmd = new ChangeTextCaseCommand(this.stateManager, textNodes[0].id, mode);
      this.commandManager.executeCommand(cmd);
      return true;
    }
    const cmds = textNodes.map(
      (t) => new ChangeTextCaseCommand(this.stateManager, t.id, mode)
    );
    this.commandManager.executeCommand(new BatchCommand(cmds, 'Change Text Case'));
    return true;
  }

  public fillLoremIpsum(nodeId?: string): boolean {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const textNodes: Text[] = nodeId
      ? (() => {
          const n = this.stateManager.findNode(nodeId);
          return n && isText(n) ? [n as Text] : [];
        })()
      : getLeafShapes(selectedNodes).filter(isText);
    if (textNodes.length === 0) {
      return false;
    }
    const lorem =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
    if (textNodes.length === 1) {
      const target = textNodes[0];
      const cmd = new UpdateTextCommand(this.stateManager, target.id, target.text ?? '', lorem);
      this.commandManager.executeCommand(cmd);
      return true;
    }
    const cmds = textNodes.map(
      (t) => new UpdateTextCommand(this.stateManager, t.id, t.text ?? '', lorem)
    );
    this.commandManager.executeCommand(new BatchCommand(cmds, 'Fill Lorem Ipsum'));
    return true;
  }

  public applyTextTypography(patch: TextPropertyUpdate, nodeId?: string): boolean {
    if (this.textEditManager.isEditingText && this.textEditManager.hasTextSelection) {
      const spanPatch: {
        fontFamily?: string;
        fontSize?: number;
        fontWeight?: Text['fontWeight'];
        fontStyle?: Text['fontStyle'];
        fill?: Text['fill'];
        letterSpacing?: number;
      } = {};
      if (patch.fontFamily !== undefined) spanPatch.fontFamily = patch.fontFamily;
      if (patch.fontSize !== undefined) spanPatch.fontSize = patch.fontSize;
      if (patch.fontWeight !== undefined) spanPatch.fontWeight = patch.fontWeight;
      if (patch.fontStyle !== undefined) spanPatch.fontStyle = patch.fontStyle;
      if (patch.fill !== undefined) spanPatch.fill = patch.fill;
      if (Object.keys(spanPatch).length > 0) {
        return this.textEditManager.applySpanToSelection(spanPatch);
      }
    }

    const selectedNodes = this.stateManager.getSelectedNodes();
    const textNodes: Text[] = nodeId
      ? (() => {
          const n = this.stateManager.findNode(nodeId);
          return n && isText(n) ? [n as Text] : [];
        })()
      : getLeafShapes(selectedNodes).filter(isText);
    if (textNodes.length === 0) {
      return false;
    }

    if (textNodes.length === 1) {
      const t = textNodes[0];
      const before: TextPropertyUpdate = {};
      for (const k of Object.keys(patch) as (keyof TextPropertyUpdate)[]) {
        (before as any)[k] = t[k];
      }
      const cmd = new UpdateTextTypographyCommand(this.stateManager, t.id, before, patch);
      if (!cmd.isAlreadyAtTarget) {
        this.commandManager.executeCommand(cmd);
      }
      return true;
    }

    const cmds: UpdateTextTypographyCommand[] = [];
    for (const t of textNodes) {
      const before: TextPropertyUpdate = {};
      for (const k of Object.keys(patch) as (keyof TextPropertyUpdate)[]) {
        (before as any)[k] = t[k];
      }
      const cmd = new UpdateTextTypographyCommand(this.stateManager, t.id, before, patch);
      if (!cmd.isAlreadyAtTarget) {
        cmds.push(cmd);
      }
    }
    if (cmds.length > 0) {
      this.commandManager.executeCommand(new BatchCommand(cmds, 'Apply Typography'));
    }
    return true;
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
