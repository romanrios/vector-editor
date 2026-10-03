import type { StateManager } from '../state/StateManager.ts';
import type { AABB, Ellipse, Path, PathPoint, Rectangle, Shape, Vector2D } from '../types/scene-graph.ts';
import {
  getPathBaseAABB,
  getSelectionHandles,
  getShapeAABB,
  isPointInAABB,
  isPointInPath,
  normalizeShapeBounds,
  type HandleType,
} from '../utils/geometry.ts';
import { CommandManager } from '../commands/CommandManager.ts';
import { TranslateCommand } from '../commands/TranslateCommand.ts';
import { ResizeCommand, type ShapeDimensions } from '../commands/ResizeCommand.ts';
import { DeleteCommand } from '../commands/DeleteCommand.ts';
import { RotateCommand } from '../commands/RotateCommand.ts';
import { PointCommand } from '../commands/PointCommand.ts';
import { AddShapeCommand } from '../commands/AddShapeCommand.ts';
import { ReorderCommand } from '../commands/ReorderCommand.ts';

export type ToolMode = 'select' | 'pen' | 'direct-select' | 'rectangle' | 'ellipse';
export type InputControllerEvent = 'toolChange';
export type ToolChangeCallback = (tool: ToolMode) => void;

/**
 * Representa el estado y dimensiones de la vista previa de creación de figura por arrastre
 */
export interface ShapePreview {
  readonly type: 'rectangle' | 'ellipse';
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
}

/**
 * Controlador de entrada interactivo para el editor vectorial.
 * Gestiona herramientas de Selección ('select') y Pluma ('pen') con curvas de Bézier cúbicas,
 * hit-testing avanzado con ctx.isPointInPath() / ray-casting, y arrastre con registro en CommandManager.
 */
export class InputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly stateManager: StateManager;
  public readonly commandManager: CommandManager;
  private readonly options: InputControllerOptions;

  private _currentTool: ToolMode = 'select';

  // Listeners de eventos
  private onMouseDownHandler: (e: MouseEvent) => void;
  private onMouseMoveHandler: (e: MouseEvent) => void;
  private onMouseUpHandler: (e: MouseEvent) => void;
  private onKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;

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
  private initialShapePosition: { x: number; y: number } | null = null;
  private draggedShapeId: string | null = null;

  // Estado del redimensionado por manejadores de esquina (modo Selección)
  private _isResizing: boolean = false;
  private resizeOrigin: { x: number; y: number } | null = null;
  private activeResizeHandle: HandleType | null = null;
  private resizingShapeId: string | null = null;
  private initialDimensions: ShapeDimensions | null = null;

  // Estado de rotación (modo Selección)
  private _isRotating: boolean = false;
  private rotatingShapeId: string | null = null;
  private initialRotation: number | null = null;
  private rotationAngleOffset: number = 0;
  private rotationCentroid: { x: number; y: number } | null = null;

  // Estado de la herramienta Selección Directa (modo 'direct-select')
  private _draggedPointIndex: number | null = null;
  private _draggedTargetType: DirectSelectTargetType | null = null;
  private _draggedPointTarget: DirectSelectTarget | null = null;
  private _dragTarget: DirectSelectTarget | null = null;
  private _directSelectTarget: DirectSelectTarget | null = null;
  private _isDraggingPoint: boolean = false;
  private directSelectOrigin: { x: number; y: number } | null = null;
  private initialPathPoints: readonly PathPoint[] | null = null;

  // Estado de la herramienta Pluma (modo Pen)
  private activePathId: string | null = null;
  private isCreatingAnchor: boolean = false;
  private currentAnchorIndex: number = -1;

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
    this.options = {
      deselectOnEmptyClick: true,
      enableKeyboardShortcuts: true,
      ...options,
    };

    (this.canvas as any).__inputController = this;

    this.onMouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e);
    this.onMouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
    this.onMouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);

    this.attachEventListeners();
  }

  public get currentTool(): ToolMode {
    return this._currentTool;
  }

  public setTool(tool: ToolMode): void {
    if (this._currentTool === tool) return;

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

    this._currentTool = tool;
    this.canvas.style.cursor =
      tool === 'pen' || tool === 'rectangle' || tool === 'ellipse'
        ? 'crosshair'
        : 'default';
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

  public get isCreatingShape(): boolean {
    return this._isCreatingShape;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public get isResizing(): boolean {
    return this._isResizing;
  }

  public get isRotating(): boolean {
    return this._isRotating;
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

  /**
   * Conecta los listeners de mouse al canvas y teclado a la ventana.
   */
  private attachEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDownHandler);
    this.canvas.addEventListener('mousemove', this.onMouseMoveHandler);

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
    this.canvas.removeEventListener('mousemove', this.onMouseMoveHandler);

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

    if ((this.canvas as any).__inputController === this) {
      delete (this.canvas as any).__inputController;
    }

    this.cancelCreation();
    this.resetDrag();
    this.resetResize();
    this.resetRotate();
    this.resetDirectSelect();
    this.eventListeners.clear();
  }

  /**
   * Calcula las coordenadas locales del cursor relativas al lienzo (espacio lógico del Scene Graph).
   */
  public getLocalCoordinates(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  /**
   * Realiza hit-testing matemático recorriendo el Scene Graph en orden inverso
   * (desde el elemento superior visualmente con mayor Z-index hacia el fondo).
   *
   * Utiliza ctx.isPointInPath() o ray-casting poligonal para figuras de tipo Path,
   * y colisión AABB para rectángulos y elipses.
   */
  public hitTest(x: number, y: number): Shape | null {
    const documentState = this.stateManager.getState();
    const layers = documentState.children;
    const ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;

    for (let l = layers.length - 1; l >= 0; l--) {
      const layer = layers[l];
      if (layer.visible === false || layer.locked === true) {
        continue;
      }

      const shapes = layer.children;
      for (let s = shapes.length - 1; s >= 0; s--) {
        const shape = shapes[s];
        if (shape.visible === false || shape.locked === true) {
          continue;
        }

        if (shape.type === 'path') {
          // Hit-testing no rectangular para trazados Bézier (isPointInPath / ray-casting)
          if (isPointInPath(x, y, shape, ctx)) {
            return shape;
          }
        } else {
          // Hit-testing AABB para rectángulos y elipses
          const aabb = getShapeAABB(shape);
          if (isPointInAABB(x, y, aabb)) {
            return shape;
          }
        }
      }
    }

    return null;
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
  }

  /**
   * Maneja el evento mousedown según la herramienta activa ('select' o 'pen').
   */
  public handleMouseDown(event: MouseEvent): void {
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
      this.handleDirectSelectMouseDown(x, y);
      return;
    }

    // Modo 'select'
    // 1. Antes de evaluar colisiones con figuras mediante hitTest,
    // verifica si ya existe un nodo seleccionado y si el cursor colisiona con uno de sus manejadores utilizando isPointInAABB
    const selectedNode = this.stateManager.getSelectedNode();
    if (selectedNode) {
      const handles = getSelectionHandles(selectedNode);
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

    // 2. Si no hubo colisión con los manejadores, evaluar colisiones con figuras mediante hitTest
    const hitShape = this.hitTest(x, y);

    if (hitShape) {
      if (!hitShape.selected) {
        this.stateManager.selectNode(hitShape.id);
      }

      this._isDragging = true;
      this._isResizing = false;
      this._isRotating = false;
      this.draggedShapeId = hitShape.id;
      this.dragOrigin = { x, y };
      this.initialShapePosition = { x: hitShape.x, y: hitShape.y };
      this.canvas.style.cursor = 'grabbing';
    } else {
      if (this.options.deselectOnEmptyClick) {
        this.stateManager.selectNode(null);
      }
      this.resetDrag();
      this.resetResize();
      this.resetRotate();
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
        selected: true,
      };

      this.stateManager.addShape(targetLayer.id, newPath);
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
      const closeRadius = 12;
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
      this.handleDirectSelectMouseMove(x, y);
      return;
    }

    // Modo 'select'
    if (this._isRotating && this.rotatingShapeId) {
      const selectedShape =
        (this.stateManager.findNode(this.rotatingShapeId) as Shape | null) ??
        this.stateManager.getSelectedNode();
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

    if (this._isDragging && this.draggedShapeId && this.dragOrigin && this.initialShapePosition) {
      const deltaX = x - this.dragOrigin.x;
      const deltaY = y - this.dragOrigin.y;

      const nextX = this.initialShapePosition.x + deltaX;
      const nextY = this.initialShapePosition.y + deltaY;

      this.stateManager.updateShapePosition(this.draggedShapeId, nextX, nextY);
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (this._isResizing) {
      if (
        this.resizingShapeId &&
        this.resizeOrigin &&
        this.activeResizeHandle &&
        this.initialDimensions
      ) {
        const deltaX = x - this.resizeOrigin.x;
        const deltaY = y - this.resizeOrigin.y;

        const newDimensions = this.calculateResizedDimensions(
          this.initialDimensions,
          this.activeResizeHandle,
          deltaX,
          deltaY
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

    // Verificar si el cursor sobrevuela uno de los manejadores del nodo seleccionado
    const selectedShape = this.stateManager.getSelectedNode();
    if (selectedShape) {
      const handles = getSelectionHandles(selectedShape);
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

    const hitShape = this.hitTest(x, y);
    this._hoveredShapeId = hitShape ? hitShape.id : null;

    if (hitShape) {
      this.canvas.style.cursor = hitShape.selected ? 'move' : 'pointer';
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
    if (
      this._isCreatingShape &&
      (this._currentTool === 'rectangle' || this._currentTool === 'ellipse')
    ) {
      const { x, y } = this.getLocalCoordinates(event);
      const start = this._creationStart ?? { x, y };
      const dx = x - start.x;
      const dy = y - start.y;
      const distance = Math.hypot(dx, dy);

      if (distance < 3) {
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
    if (this._isRotating) {
      if (this.rotatingShapeId && this.initialRotation !== null) {
        const selectedShape =
          (this.stateManager.findNode(this.rotatingShapeId) as Shape | null) ??
          this.stateManager.getSelectedNode();
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
      this.canvas.style.cursor = hitShape ? (hitShape.selected ? 'move' : 'pointer') : 'default';
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
          deltaY
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
      this.canvas.style.cursor = hitShape ? (hitShape.selected ? 'move' : 'pointer') : 'default';
      return;
    }

    if (!this._isDragging || !this.draggedShapeId || !this.dragOrigin || !this.initialShapePosition) {
      this.resetDrag();
      return;
    }

    const { x, y } = this.getLocalCoordinates(event);
    const deltaX = x - this.dragOrigin.x;
    const deltaY = y - this.dragOrigin.y;

    const finalX = this.initialShapePosition.x + deltaX;
    const finalY = this.initialShapePosition.y + deltaY;

    this.stateManager.updateShapePosition(this.draggedShapeId, finalX, finalY);

    if (finalX !== this.initialShapePosition.x || finalY !== this.initialShapePosition.y) {
      const command = new TranslateCommand(
        this.stateManager,
        this.draggedShapeId,
        this.initialShapePosition.x,
        this.initialShapePosition.y,
        finalX,
        finalY
      );

      this.commandManager.recordCommand(command);
    }

    this.resetDrag();

    const hitShape = this.hitTest(x, y);
    this.canvas.style.cursor = hitShape ? (hitShape.selected ? 'move' : 'pointer') : 'default';
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
        const target = (event.target as HTMLElement | null) ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
        const isInputFocused = Boolean(
          target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        );

        const selectedNode = this.stateManager.getSelectedNode();

        if (!isInputFocused && selectedNode) {
          event.preventDefault?.();
          if (isBringToFront) {
            this.bringToFront(selectedNode.id);
          } else {
            this.sendToBack(selectedNode.id);
          }
        }
        return;
      }

      return;
    }

    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (event.key === 'Shift' && this._isCreatingShape) {
      this._creationShiftKey = true;
      this.updateShapePreview(true);
      this.stateManager.markDirty();
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'delete' || key === 'backspace') {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode) {
        event.preventDefault?.();
        const parent = this.stateManager.findParent(selectedNode.id);
        const layerId = parent ? parent.id : this.stateManager.getState().children[0]?.id;
        if (layerId) {
          const deleteCommand = new DeleteCommand(this.stateManager, selectedNode, layerId);
          this.commandManager.executeCommand(deleteCommand);
          this.stateManager.selectNode(null);
        }
      }
      return;
    }

    if (key === 'p') {
      this.setTool('pen');
    } else if (key === 'v') {
      this.setTool('select');
    } else if (key === 'a') {
      this.setTool('direct-select');
    } else if (key === 'r') {
      this.setTool('rectangle');
    } else if (key === 'e') {
      this.setTool('ellipse');
    } else if (key === 'escape') {
      if (this._isRotating && this.rotatingShapeId && this.initialRotation !== null) {
        this.stateManager.updateShape(this.rotatingShapeId, { rotation: this.initialRotation });
        this.resetRotate();
      } else if (this._isCreatingShape) {
        this.cancelCreation();
      } else if (this._currentTool === 'pen') {
        this.finishActivePath();
      }
    } else if (key === 'enter') {
      if (this._currentTool === 'pen') {
        this.finishActivePath();
      }
    }
  }

  public handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift' && this._isCreatingShape) {
      this._creationShiftKey = false;
      this.updateShapePreview(false);
      this.stateManager.markDirty();
    }
  }

  /**
   * Trae una figura (o la figura seleccionada) al frente de su capa contenedora,
   * registrando un ReorderCommand en el CommandManager para soporte de Undo/Redo.
   * Si la figura ya está al frente, no registra nada en el historial y retorna false.
   */
  public bringToFront(shapeId?: string): boolean {
    const targetId = shapeId ?? this.stateManager.getSelectedNode()?.id;
    if (!targetId) {
      return false;
    }

    const command = new ReorderCommand(this.stateManager, targetId, 'bringToFront');
    if (command.isAlreadyAtTarget) {
      return false;
    }

    this.commandManager.executeCommand(command);
    return true;
  }

  /**
   * Envía una figura (o la figura seleccionada) al fondo de su capa contenedora,
   * registrando un ReorderCommand en el CommandManager para soporte de Undo/Redo.
   * Si la figura ya está en el fondo, no registra nada en el historial y retorna false.
   */
  public sendToBack(shapeId?: string): boolean {
    const targetId = shapeId ?? this.stateManager.getSelectedNode()?.id;
    if (!targetId) {
      return false;
    }

    const command = new ReorderCommand(this.stateManager, targetId, 'sendToBack');
    if (command.isAlreadyAtTarget) {
      return false;
    }

    this.commandManager.executeCommand(command);
    return true;
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

  private resetDrag(): void {
    this._isDragging = false;
    this.dragOrigin = null;
    this.initialShapePosition = null;
    this.draggedShapeId = null;
  }

  private resetResize(): void {
    this._isResizing = false;
    this.resizeOrigin = null;
    this.activeResizeHandle = null;
    this.resizingShapeId = null;
    this.initialDimensions = null;
  }

  private resetRotate(): void {
    this._isRotating = false;
    this.rotatingShapeId = null;
    this.initialRotation = null;
    this.rotationAngleOffset = 0;
    this.rotationCentroid = null;
  }

  private resetDirectSelect(): void {
    this._draggedPointIndex = null;
    this._draggedTargetType = null;
    this._draggedPointTarget = null;
    this._dragTarget = null;
    this._directSelectTarget = null;
    this._isDraggingPoint = false;
    this.directSelectOrigin = null;
    this.initialPathPoints = null;
  }

  /**
   * Maneja el evento mousedown en modo 'direct-select' (Herramienta de Selección Directa / Subselección).
   * No selecciona el Shape completo mediante hitTest, sino que itera sobre los points del Path
   * seleccionado previamente. Si el usuario hace clic cerca de un punto de ancla o manejador de
   * control (AABB de 10x10px), marca ese vértice o manejador específico como _draggedPointIndex u objetivo de arrastre.
   */
  private handleDirectSelectMouseDown(x: number, y: number): void {
    const selectedNode = this.stateManager.getSelectedNode();
    if (!selectedNode || selectedNode.type !== 'path') {
      this.resetDirectSelect();
      return;
    }

    const hit = this.findPathPointHit(selectedNode as Path, x, y);
    if (hit) {
      this._draggedPointIndex = hit.index;
      this._draggedTargetType = hit.type;
      const target: DirectSelectTarget = {
        pathId: selectedNode.id,
        pointIndex: hit.index,
        index: hit.index,
        type: hit.type,
        targetType: hit.type,
        handleType: hit.type,
      };
      this._draggedPointTarget = target;
      this._dragTarget = target;
      this._directSelectTarget = target;
      this._isDraggingPoint = true;
      this.directSelectOrigin = { x, y };
      this.dragOrigin = { x, y };
      this.initialPathPoints = structuredClone((selectedNode as Path).points);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.resetDirectSelect();
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Maneja el evento mousemove en modo 'direct-select'.
   * Arrastra exclusivamente el vértice o manejador seleccionado en tiempo real calculando el delta del cursor.
   * Si está en reposo (hover), actualiza el cursor si sobrevuela un punto o manejador.
   */
  private handleDirectSelectMouseMove(x: number, y: number): void {
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

      const nextPoints = this.initialPathPoints.map((pt, idx) => {
        if (idx !== pointIndex) return pt;
        if (type === 'anchor') {
          return {
            ...pt,
            x: pt.x + deltaX,
            y: pt.y + deltaY,
          };
        } else if (type === 'handleIn') {
          const initH = pt.handleIn ?? { x: pt.x, y: pt.y };
          return {
            ...pt,
            handleIn: {
              x: initH.x + deltaX,
              y: initH.y + deltaY,
            },
          };
        } else if (type === 'handleOut') {
          const initH = pt.handleOut ?? { x: pt.x, y: pt.y };
          return {
            ...pt,
            handleOut: {
              x: initH.x + deltaX,
              y: initH.y + deltaY,
            },
          };
        }
        return pt;
      });

      this.stateManager.updateShape<Path>(pathId, { points: nextPoints });
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const selectedNode = this.stateManager.getSelectedNode();
    if (selectedNode && selectedNode.type === 'path') {
      const hit = this.findPathPointHit(selectedNode as Path, x, y);
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
    } else {
      this.canvas.style.cursor = 'default';
    }
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
    y: number
  ): { index: number; type: DirectSelectTargetType } | null {
    if (!path.points || path.points.length === 0) return null;

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

    // 1. Evaluar primero colisiones con manejadores de control Bézier extendidos (handleIn y handleOut)
    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i];
      if (pt.handleIn && (pt.handleIn.x !== pt.x || pt.handleIn.y !== pt.y)) {
        const handleInAABB = this.createHandleAABB(pt.handleIn.x, pt.handleIn.y, 10);
        if (isPointInAABB(testX, testY, handleInAABB)) {
          return { index: i, type: 'handleIn' };
        }
      }

      if (pt.handleOut && (pt.handleOut.x !== pt.x || pt.handleOut.y !== pt.y)) {
        const handleOutAABB = this.createHandleAABB(pt.handleOut.x, pt.handleOut.y, 10);
        if (isPointInAABB(testX, testY, handleOutAABB)) {
          return { index: i, type: 'handleOut' };
        }
      }
    }

    // 2. Evaluar colisiones con los vértices / puntos de ancla principales
    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i];
      const anchorAABB = this.createHandleAABB(pt.x, pt.y, 10);
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
   */
  private calculateResizedDimensions(
    initial: ShapeDimensions,
    handle: HandleType,
    dx: number,
    dy: number
  ): ShapeDimensions {
    const rotation = initial.rotation ?? 0;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Proyectar el desplazamiento del cursor (delta de pantalla) en el sistema de coordenadas local rotado
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;

    if (initial.points !== undefined && initial.points.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const pt of initial.points) {
        const coords = [pt];
        if (pt.handleIn) coords.push(pt.handleIn);
        if (pt.handleOut) coords.push(pt.handleOut);

        for (const { x, y } of coords) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      const initW = Math.max(1, maxX - minX);
      const initH = Math.max(1, maxY - minY);

      let newW = initW;
      let newH = initH;
      let anchorX = minX;
      let anchorY = minY;
      let localShiftX = 0;
      let localShiftY = 0;

      switch (handle) {
        case 'bottom-right':
          newW = Math.max(5, initW + localDx);
          newH = Math.max(5, initH + localDy);
          anchorX = minX;
          anchorY = minY;
          localShiftX = (newW - initW) / 2;
          localShiftY = (newH - initH) / 2;
          break;
        case 'bottom-left':
          newW = Math.max(5, initW - localDx);
          newH = Math.max(5, initH + localDy);
          anchorX = maxX;
          anchorY = minY;
          localShiftX = -(newW - initW) / 2;
          localShiftY = (newH - initH) / 2;
          break;
        case 'top-right':
          newW = Math.max(5, initW + localDx);
          newH = Math.max(5, initH - localDy);
          anchorX = minX;
          anchorY = maxY;
          localShiftX = (newW - initW) / 2;
          localShiftY = -(newH - initH) / 2;
          break;
        case 'top-left':
          newW = Math.max(5, initW - localDx);
          newH = Math.max(5, initH - localDy);
          anchorX = maxX;
          anchorY = maxY;
          localShiftX = -(newW - initW) / 2;
          localShiftY = -(newH - initH) / 2;
          break;
      }

      const scaleX = newW / initW;
      const scaleY = newH / initH;

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

      let newW = initW;
      let newH = initH;
      let localShiftX = 0;
      let localShiftY = 0;

      switch (handle) {
        case 'bottom-right':
          newW = Math.max(5, initW + localDx);
          newH = Math.max(5, initH + localDy);
          localShiftX = (newW - initW) / 2;
          localShiftY = (newH - initH) / 2;
          break;
        case 'bottom-left':
          newW = Math.max(5, initW - localDx);
          newH = Math.max(5, initH + localDy);
          localShiftX = -(newW - initW) / 2;
          localShiftY = (newH - initH) / 2;
          break;
        case 'top-right':
          newW = Math.max(5, initW + localDx);
          newH = Math.max(5, initH - localDy);
          localShiftX = (newW - initW) / 2;
          localShiftY = -(newH - initH) / 2;
          break;
        case 'top-left':
          newW = Math.max(5, initW - localDx);
          newH = Math.max(5, initH - localDy);
          localShiftX = -(newW - initW) / 2;
          localShiftY = -(newH - initH) / 2;
          break;
      }

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

      let newW = initW;
      let newH = initH;
      let localShiftX = 0;
      let localShiftY = 0;

      switch (handle) {
        case 'bottom-right':
          newW = Math.max(5, initW + localDx);
          newH = Math.max(5, initH + localDy);
          localShiftX = (newW - initW) / 2;
          localShiftY = (newH - initH) / 2;
          break;
        case 'bottom-left':
          newW = Math.max(5, initW - localDx);
          newH = Math.max(5, initH + localDy);
          localShiftX = -(newW - initW) / 2;
          localShiftY = (newH - initH) / 2;
          break;
        case 'top-right':
          newW = Math.max(5, initW + localDx);
          newH = Math.max(5, initH - localDy);
          localShiftX = (newW - initW) / 2;
          localShiftY = -(newH - initH) / 2;
          break;
        case 'top-left':
          newW = Math.max(5, initW - localDx);
          newH = Math.max(5, initH - localDy);
          localShiftX = -(newW - initW) / 2;
          localShiftY = -(newH - initH) / 2;
          break;
      }

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

