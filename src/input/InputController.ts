import type { StateManager } from '../state/StateManager.ts';
import type { Path, PathPoint, Shape } from '../types/scene-graph.ts';
import { getShapeAABB, isPointInAABB, isPointInPath } from '../utils/geometry.ts';
import { CommandManager } from '../commands/CommandManager.ts';
import { TranslateCommand } from '../commands/TranslateCommand.ts';

export type ToolMode = 'select' | 'pen';

export interface InputControllerOptions {
  /**
   * Permite deseleccionar al hacer clic en un área vacía del lienzo (en modo select).
   * Por defecto true.
   */
  deselectOnEmptyClick?: boolean;
  /**
   * Habilita los atajos de teclado globales (Ctrl+Z, Ctrl+Y, 'P' para pluma, 'V' para selección).
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

  // Estado del arrastre (modo Selección)
  private _isDragging: boolean = false;
  private dragOrigin: { x: number; y: number } | null = null;
  private initialShapePosition: { x: number; y: number } | null = null;
  private draggedShapeId: string | null = null;

  // Estado de la herramienta Pluma (modo Pen)
  private activePathId: string | null = null;
  private isCreatingAnchor: boolean = false;
  private currentAnchorIndex: number = -1;

  private _hoveredShapeId: string | null = null;

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

    this._currentTool = tool;
    this.canvas.style.cursor = tool === 'pen' ? 'crosshair' : 'default';
  }

  public get isDragging(): boolean {
    return this._isDragging;
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

    if (this.options.enableKeyboardShortcuts && typeof window !== 'undefined') {
      this.onKeyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
      window.addEventListener('keydown', this.onKeyDownHandler);
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
    } else {
      this.canvas.removeEventListener('mouseup', this.onMouseUpHandler);
    }
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

    if (this._currentTool === 'pen') {
      this.handlePenMouseDown(x, y);
      return;
    }

    // Modo 'select'
    const hitShape = this.hitTest(x, y);

    if (hitShape) {
      if (!hitShape.selected) {
        this.stateManager.selectNode(hitShape.id);
      }

      this._isDragging = true;
      this.draggedShapeId = hitShape.id;
      this.dragOrigin = { x, y };
      this.initialShapePosition = { x: hitShape.x, y: hitShape.y };
      this.canvas.style.cursor = 'grabbing';
    } else {
      if (this.options.deselectOnEmptyClick) {
        this.stateManager.selectNode(null);
      }
      this.resetDrag();
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

    if (this._currentTool === 'pen') {
      this.handlePenMouseMove(x, y);
      return;
    }

    // Modo 'select'
    if (this._isDragging && this.draggedShapeId && this.dragOrigin && this.initialShapePosition) {
      const deltaX = x - this.dragOrigin.x;
      const deltaY = y - this.dragOrigin.y;

      const nextX = this.initialShapePosition.x + deltaX;
      const nextY = this.initialShapePosition.y + deltaY;

      this.stateManager.updateShapePosition(this.draggedShapeId, nextX, nextY);
      this.canvas.style.cursor = 'grabbing';
      return;
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
    if (this._currentTool === 'pen') {
      this.isCreatingAnchor = false;
      return;
    }

    // Modo 'select'
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
   * - Escape / Enter para finalizar trazado activo
   */
  private handleKeyDown(event: KeyboardEvent): void {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isCtrlOrCmd) {
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.commandManager.redo();
        } else {
          this.commandManager.undo();
        }
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.commandManager.redo();
      }
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'p') {
      this.setTool('pen');
    } else if (key === 'v') {
      this.setTool('select');
    } else if (key === 'escape' || key === 'enter') {
      if (this._currentTool === 'pen') {
        this.finishActivePath();
      }
    }
  }

  private resetDrag(): void {
    this._isDragging = false;
    this.dragOrigin = null;
    this.initialShapePosition = null;
    this.draggedShapeId = null;
  }
}
