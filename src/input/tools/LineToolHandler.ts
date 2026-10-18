import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { AddShapeCommand } from '../../commands/AddShapeCommand.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { Path, PathPoint, Vector2D } from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode, ShapePreview } from '../InputController.ts';

/**
 * Manejador especializado para la herramienta interactiva de Línea Recta (`line`).
 * Crea un trazado Path abierto (`closed: false`) de dos puntos con soporte de restricción de ángulo a 45° con Shift.
 */
export class LineToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;
  private readonly setTool: (tool: ToolMode) => void;

  private _isCreating: boolean = false;
  private _startCoords: Vector2D | null = null;
  private _currentCoords: Vector2D | null = null;
  private _shapePreview: ShapePreview | null = null;
  public lineCounter: number = 0;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager,
    setTool: (tool: ToolMode) => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
    this.setTool = setTool;
  }

  public get isCreating(): boolean {
    return this._isCreating;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'crosshair';
  }

  public onDeactivate(_nextTool?: ToolMode): void {
    this.cancelCreation();
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    this._isCreating = true;
    this._startCoords = coords;
    this._currentCoords = coords;
    this.updatePreview(Boolean(event.shiftKey));
    this.stateManager.markDirty();
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D): void {
    if (!this._isCreating || !this._startCoords) return;

    this._currentCoords = coords;
    this.updatePreview(Boolean(event.shiftKey));
    this.stateManager.markDirty();
  }

  public onMouseUp(event: MouseEvent, coords: Vector2D): void {
    if (!this._isCreating || !this._startCoords) {
      this.cancelCreation();
      return;
    }

    const start = this._startCoords;
    const end = this.calculateTargetCoords(start, coords, Boolean(event.shiftKey));
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const zoom = this.getViewportManager().zoom;

    // Umbral mínimo de arrastre para evitar clics accidentales vacíos
    if (distance < 3 / zoom) {
      this.cancelCreation();
      return;
    }

    const currentState = this.stateManager.getState();
    const targetLayer = this.stateManager.getActiveLayer() ?? currentState.children[0];
    if (!targetLayer) {
      this.cancelCreation();
      return;
    }

    const style = this.stateManager.getDrawingStyle();
    this.lineCounter++;

    const p1: PathPoint = {
      x: start.x,
      y: start.y,
      pointType: 'corner',
    };
    const p2: PathPoint = {
      x: end.x,
      y: end.y,
      pointType: 'corner',
    };

    const strokePaint = style.stroke === 'none' ? '#38bdf8' : (style.stroke ?? '#38bdf8');
    const strokeWidth = typeof style.strokeWidth === 'number' && style.strokeWidth > 0 ? style.strokeWidth : 2;

    const linePath: Path = {
      id: `line-${Date.now()}-${this.lineCounter}`,
      type: 'path',
      name: `Línea ${this.lineCounter}`,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      points: [p1, p2],
      closed: false,
      fill: 'none',
      stroke: strokePaint,
      strokeWidth,
      strokeDashArray: style.strokeDashArray,
      strokeLineCap: style.strokeLineCap ?? 'round',
      strokeLineJoin: style.strokeLineJoin ?? 'round',
      opacity: style.opacity ?? 1,
      visible: true,
      locked: false,
      rotation: 0,
    };

    const addCmd = new AddShapeCommand(
      this.stateManager,
      targetLayer.id,
      linePath
    );
    this.commandManager.executeCommand(addCmd);

    this.cancelCreation();
    this.stateManager.setSelection([linePath.id]);
    this.setTool('select');
  }

  public cancelCreation(): void {
    const wasCreating = this._isCreating || this._shapePreview !== null;
    this._isCreating = false;
    this._startCoords = null;
    this._currentCoords = null;
    this._shapePreview = null;
    if (wasCreating) {
      this.stateManager.markDirty();
    }
  }

  /**
   * Calcula las coordenadas de destino proyectando si shiftKey restringe el ángulo a múltiplos de 45°
   */
  public calculateTargetCoords(start: Vector2D, current: Vector2D, shiftKey: boolean): Vector2D {
    if (!shiftKey) {
      return current;
    }

    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return current;

    const angle = Math.atan2(dy, dx);
    const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);

    return {
      x: start.x + distance * Math.cos(snapAngle),
      y: start.y + distance * Math.sin(snapAngle),
    };
  }

  /**
   * Actualiza el preview temporal de la línea en pantalla
   */
  public updatePreview(shiftKey: boolean): void {
    if (!this._startCoords || !this._currentCoords) {
      this._shapePreview = null;
      return;
    }

    const start = this._startCoords;
    const end = this.calculateTargetCoords(start, this._currentCoords, shiftKey);
    const style = this.stateManager.getDrawingStyle();

    const strokePaint = style.stroke === 'none' ? '#38bdf8' : (typeof style.stroke === 'string' ? style.stroke : '#38bdf8');
    const strokeWidth = typeof style.strokeWidth === 'number' && style.strokeWidth > 0 ? style.strokeWidth : 2;

    this._shapePreview = {
      type: 'line',
      x: start.x,
      y: start.y,
      x2: end.x,
      y2: end.y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: 'none',
      stroke: strokePaint,
      strokeWidth,
      strokeDashArray: style.strokeDashArray,
      strokeLineCap: style.strokeLineCap ?? 'round',
      strokeLineJoin: style.strokeLineJoin ?? 'round',
      opacity: style.opacity ?? 1,
    };
  }

  public destroy(): void {
    this.cancelCreation();
  }
}
