import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { AddShapeCommand } from '../../commands/AddShapeCommand.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { Path, Vector2D } from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode, ShapePreview } from '../InputController.ts';
import {
  simplifyPointsRDP,
  fitCurveCatmullRom,
  getPointsAABB,
} from '../../utils/geometry.ts';

/**
 * Manejador interactivo para la herramienta de Lápiz / Trazo libre (`pencil`).
 * Permite capturar trazos continuos a mano alzada con el ratón o stylus/touch,
 * simplificando la geometría con el algoritmo Ramer-Douglas-Peucker (RDP) y
 * ajustando curvas suaves de Bézier cúbica con interpolación Catmull-Rom.
 * Genera un nodo `Path` estándar con historial reversible en `AddShapeCommand`.
 */
export class PencilToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;

  private _isDrawing: boolean = false;
  private _rawPoints: Vector2D[] = [];
  private _shapePreview: ShapePreview | null = null;
  public pencilCounter: number = 0;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
  }

  public get isDrawing(): boolean {
    return this._isDrawing;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public get rawPoints(): readonly Vector2D[] {
    return this._rawPoints;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'crosshair';
  }

  public onDeactivate(_nextTool?: ToolMode): void {
    this.cancelDrawing();
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    this._isDrawing = true;
    this._rawPoints = [{ x: coords.x, y: coords.y }];
    this.updatePreview();
    this.stateManager.markDirty();
  }

  public onMouseMove(_event: MouseEvent, coords: Vector2D): void {
    if (!this._isDrawing || this._rawPoints.length === 0) {
      return;
    }

    const last = this._rawPoints[this._rawPoints.length - 1];
    const zoom = this.getViewportManager().zoom;
    const dist = Math.hypot(coords.x - last.x, coords.y - last.y);

    // Filtrar micro-movimientos redundantes menores a 2px en espacio de pantalla
    if (dist >= 2 / zoom) {
      this._rawPoints.push({ x: coords.x, y: coords.y });
      this.updatePreview();
      this.stateManager.markDirty();
    }
  }

  public onMouseUp(_event: MouseEvent, coords: Vector2D): void {
    if (!this._isDrawing || this._rawPoints.length === 0) {
      this.cancelDrawing();
      return;
    }

    const last = this._rawPoints[this._rawPoints.length - 1];
    const dist = Math.hypot(coords.x - last.x, coords.y - last.y);
    if (dist > 0.5) {
      this._rawPoints.push({ x: coords.x, y: coords.y });
    }

    // Si el usuario realizó solo un clic rápido sin arrastrar, añadir un punto adyacente para generar un punto visible
    if (this._rawPoints.length === 1) {
      this._rawPoints.push({ x: coords.x + 0.1, y: coords.y + 0.1 });
    }

    const zoom = this.getViewportManager().zoom;
    // Tolerancia RDP proporcional al zoom: en pantalla equivale a ~1.5 - 2px
    const epsilon = Math.max(0.5, 1.5 / zoom);
    const simplified = simplifyPointsRDP(this._rawPoints, epsilon);
    const pathPoints = fitCurveCatmullRom(simplified, 0.5);

    const currentState = this.stateManager.getState();
    const targetLayer = this.stateManager.getActiveLayer() ?? currentState.children[0];
    if (!targetLayer) {
      this.cancelDrawing();
      return;
    }

    const style = this.stateManager.getDrawingStyle();
    this.pencilCounter++;

    const strokePaint = style.stroke === 'none' ? '#38bdf8' : (style.stroke ?? '#38bdf8');
    const strokeWidth = typeof style.strokeWidth === 'number' && style.strokeWidth > 0 ? style.strokeWidth : 2;

    const bounds = getPointsAABB(this._rawPoints);

    const strokeLineCap = style.strokeLineCap && style.strokeLineCap !== 'butt' ? style.strokeLineCap : 'round';
    const strokeLineJoin = style.strokeLineJoin && style.strokeLineJoin !== 'miter' ? style.strokeLineJoin : 'round';

    const pencilPath: Path = {
      id: `pencil-${Date.now()}-${this.pencilCounter}`,
      type: 'path',
      name: `Trazo ${this.pencilCounter}`,
      x: bounds.minX,
      y: bounds.minY,
      points: pathPoints,
      closed: false,
      fill: 'none',
      stroke: strokePaint,
      strokeWidth,
      strokeDashArray: style.strokeDashArray,
      strokeLineCap,
      strokeLineJoin,
      opacity: style.opacity ?? 1,
      visible: true,
      locked: false,
      rotation: 0,
    };

    const addCmd = new AddShapeCommand(
      this.stateManager,
      targetLayer.id,
      pencilPath
    );
    this.commandManager.executeCommand(addCmd);

    this.cancelDrawing();
    this.stateManager.setSelection([pencilPath.id]);
  }

  public updatePreview(): void {
    if (this._rawPoints.length === 0) {
      this._shapePreview = null;
      return;
    }

    const style = this.stateManager.getDrawingStyle();
    const bounds = getPointsAABB(this._rawPoints);
    const strokePaint = style.stroke === 'none' ? '#38bdf8' : (style.stroke ?? '#38bdf8');
    const strokeWidth = typeof style.strokeWidth === 'number' && style.strokeWidth > 0 ? style.strokeWidth : 2;

    this._shapePreview = {
      type: 'pencil',
      x: bounds.minX,
      y: bounds.minY,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      points: [...this._rawPoints],
      stroke: strokePaint,
      strokeWidth,
      strokeLineCap: style.strokeLineCap ?? 'round',
      strokeLineJoin: style.strokeLineJoin ?? 'round',
      strokeDashArray: style.strokeDashArray,
      opacity: style.opacity ?? 1,
    };
  }

  public cancelDrawing(): void {
    const wasDrawing = this._isDrawing || this._shapePreview !== null;
    this._isDrawing = false;
    this._rawPoints = [];
    this._shapePreview = null;
    if (wasDrawing) {
      this.stateManager.markDirty();
    }
  }
}
