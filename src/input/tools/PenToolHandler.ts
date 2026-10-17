import type { StateManager } from '../../state/StateManager.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { Path, PathPoint, Vector2D } from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode } from '../InputController.ts';

export class PenToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;

  private _activePathId: string | null = null;
  public isCreatingAnchor: boolean = false;
  public currentAnchorIndex: number = -1;

  constructor(
    stateManager: StateManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager
  ) {
    this.stateManager = stateManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
  }

  public get activePathId(): string | null {
    return this._activePathId;
  }

  public get pathEditState(): { pathId: string; selectedAnchors: ReadonlySet<number> } | null {
    if (this._activePathId !== null) {
      const pathNode = this.stateManager.findNode(this._activePathId) as Path | null;
      if (pathNode) {
        return {
          pathId: this._activePathId,
          selectedAnchors: new Set(this.currentAnchorIndex >= 0 ? [this.currentAnchorIndex] : []),
        };
      }
    }
    return null;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'crosshair';
  }

  public onDeactivate(nextTool?: ToolMode): void {
    if (nextTool !== 'pen') {
      this.finishActivePath();
    }
  }

  public onMouseDown(_event: MouseEvent, coords: Vector2D): void {
    this.handlePenMouseDown(coords.x, coords.y);
  }

  public onMouseMove(_event: MouseEvent, coords: Vector2D): void {
    this.handlePenMouseMove(coords.x, coords.y);
  }

  public onMouseUp(_event: MouseEvent, _coords: Vector2D): void {
    this.isCreatingAnchor = false;
  }

  public handlePenMouseDown(x: number, y: number): void {
    const currentState = this.stateManager.getState();
    const targetLayer = this.stateManager.getActiveLayer() ?? currentState.children[0];
    if (!targetLayer) return;

    if (this._activePathId === null) {
      // Iniciar un nuevo trazado con el primer punto de ancla
      const newPathId = `path-${Date.now()}`;
      const initialPoint: PathPoint = {
        x,
        y,
        handleIn: { x, y },
        handleOut: { x, y },
      };

      const style = this.stateManager.getDrawingStyle();
      const newPath: Path = {
        id: newPathId,
        type: 'path',
        name: `Trazado Bézier ${newPathId.slice(-4)}`,
        x,
        y,
        points: [initialPoint],
        closed: false,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: 'transparent',
      };

      this.stateManager.addShape(targetLayer.id, newPath);
      this.stateManager.selectNode(newPathId);
      this._activePathId = newPathId;
      this.isCreatingAnchor = true;
      this.currentAnchorIndex = 0;
    } else {
      const activePath = this.stateManager.findNode(this._activePathId) as Path | null;
      if (!activePath || activePath.type !== 'path') {
        this.finishActivePath();
        return;
      }

      // Comprobar si el clic está muy cerca del primer punto para cerrar el trazado
      const firstPoint = activePath.points[0];
      const zoom = this.getViewportManager().zoom;
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

      this.stateManager.updateShape<Path>(this._activePathId, (path) => ({
        ...path,
        points: [...path.points, newPoint],
      }));

      const updated = this.stateManager.findNode(this._activePathId) as Path;
      this.currentAnchorIndex = updated.points.length - 1;
      this.isCreatingAnchor = true;
    }
  }

  public handlePenMouseMove(x: number, y: number): void {
    if (!this.isCreatingAnchor || !this._activePathId || this.currentAnchorIndex < 0) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Al arrastrar, se definen los puntos de control tangentes
    this.stateManager.updateShape<Path>(this._activePathId, (path) => {
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

  public finishActivePath(closed: boolean = false): void {
    if (!this._activePathId) return;

    if (closed) {
      this.stateManager.updateShape<Path>(this._activePathId, (p) => ({
        ...p,
        closed: true,
      }));
    }

    this._activePathId = null;
    this.isCreatingAnchor = false;
    this.currentAnchorIndex = -1;
    this.stateManager.markDirty();
  }

  public destroy(): void {
    this.finishActivePath();
  }
}
