import type { StateManager } from '../../state/StateManager.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { InsertPathPointCommand } from '../../commands/InsertPathPointCommand.ts';
import { DeletePathPointCommand } from '../../commands/DeletePathPointCommand.ts';
import {
  findNearestPointOnPath,
  splitPathSegment,
  deletePathPointsFromPath,
  getPathBaseAABB,
} from '../../utils/geometry.ts';
import type { Path, PathPoint, Vector2D } from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode } from '../InputController.ts';

export class PenToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;
  private readonly commandManager?: CommandManager;

  private _activePathId: string | null = null;
  public isCreatingAnchor: boolean = false;
  public currentAnchorIndex: number = -1;
  private _hoverInsertPoint: { localPoint: Vector2D; worldPoint: Vector2D; segmentIndex: number; t: number } | null = null;

  constructor(
    stateManager: StateManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager,
    commandManager?: CommandManager
  ) {
    this.stateManager = stateManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
    this.commandManager = commandManager;
  }

  public get activePathId(): string | null {
    return this._activePathId;
  }

  public get hoverInsertPoint(): Vector2D | null {
    return this._hoverInsertPoint ? this._hoverInsertPoint.worldPoint : null;
  }

  public get pathEditState(): {
    pathId: string;
    selectedAnchors: ReadonlySet<number>;
    hoverInsertPoint?: Vector2D | null;
  } | null {
    if (this._activePathId !== null) {
      const pathNode = this.stateManager.findNode(this._activePathId) as Path | null;
      if (pathNode) {
        return {
          pathId: this._activePathId,
          selectedAnchors: new Set(this.currentAnchorIndex >= 0 ? [this.currentAnchorIndex] : []),
        };
      }
    }

    if (this._hoverInsertPoint !== null) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && selectedNode.type === 'path') {
        return {
          pathId: selectedNode.id,
          selectedAnchors: new Set<number>(),
          hoverInsertPoint: this._hoverInsertPoint.localPoint,
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

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    this.handlePenMouseDown(coords.x, coords.y, Boolean(event.altKey));
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D): void {
    this.handlePenMouseMove(coords.x, coords.y, Boolean(event.altKey));
  }

  public onMouseUp(_event: MouseEvent, _coords: Vector2D): void {
    this.isCreatingAnchor = false;
  }

  public handlePenMouseDown(x: number, y: number, altKey: boolean = false): void {
    const currentState = this.stateManager.getState();
    const targetLayer = this.stateManager.getActiveLayer() ?? currentState.children[0];
    if (!targetLayer) return;

    if (this._activePathId === null) {
      // Si hay un trazado seleccionado existente, comprobar operaciones de inserción o eliminación
      const selectedNode = this.stateManager.getSelectedNode();
      const activePath = selectedNode && selectedNode.type === 'path' ? (selectedNode as Path) : null;
      if (activePath) {
        const anchorHit = this.findAnchorHit(activePath, x, y);
        if (anchorHit !== null && altKey) {
          // Alt/Option+clic sobre un vértice existente: eliminarlo
          this.deleteAnchorAt(activePath.id, anchorHit);
          return;
        }

        if (this._hoverInsertPoint) {
          // Clic sobre segmento existente: insertar nuevo vértice subdividiendo con De Casteljau
          const { segmentIndex, t } = this._hoverInsertPoint;
          this.insertAnchorAt(activePath.id, segmentIndex, t);
          return;
        }
      }

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

  public handlePenMouseMove(x: number, y: number, altKey: boolean = false): void {
    if (this.isCreatingAnchor && this._activePathId && this.currentAnchorIndex >= 0) {
      // Al arrastrar durante la creación, se definen los puntos de control tangentes
      this.stateManager.updateShape<Path>(this._activePathId, (path) => {
        const updatedPoints = path.points.map((pt, idx) => {
          if (idx === this.currentAnchorIndex) {
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
      return;
    }

    if (this._activePathId === null) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && selectedNode.type === 'path') {
        const activePath = selectedNode as Path;
        const anchorHit = this.findAnchorHit(activePath, x, y);
        if (anchorHit !== null) {
          if (this._hoverInsertPoint) {
            this._hoverInsertPoint = null;
            this.stateManager.markDirty();
          }
          this.canvas.style.cursor = altKey ? 'pointer' : 'default';
          return;
        }

        const zoom = this.getViewportManager().zoom;
        const proj = findNearestPointOnPath(activePath, x, y);
        if (proj && proj.distance * zoom <= 6) {
          this.canvas.style.cursor = 'copy';
          const prev = this._hoverInsertPoint;
          const changed =
            !prev ||
            prev.segmentIndex !== proj.segmentIndex ||
            Math.abs(prev.t - proj.t) > 0.01;
          this._hoverInsertPoint = {
            localPoint: proj.point,
            worldPoint: proj.worldPoint,
            segmentIndex: proj.segmentIndex,
            t: proj.t,
          };
          if (changed) {
            this.stateManager.markDirty();
          }
          return;
        }

        if (this._hoverInsertPoint) {
          this._hoverInsertPoint = null;
          this.stateManager.markDirty();
        }
      }
    }

    this.canvas.style.cursor = 'crosshair';
  }

  public findAnchorHit(path: Path, x: number, y: number): number | null {
    if (!path.points || path.points.length === 0) return null;
    const zoom = this.getViewportManager().zoom;
    const handleSize = 10 / zoom;
    const half = handleSize / 2;

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

    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i];
      if (
        testX >= pt.x - half &&
        testX <= pt.x + half &&
        testY >= pt.y - half &&
        testY <= pt.y + half
      ) {
        return i;
      }
    }
    return null;
  }

  public insertAnchorAt(pathId: string, segmentIndex: number, t: number): boolean {
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;

    const initialPoints = pathNode.points;
    const finalPoints = splitPathSegment(pathNode, segmentIndex, t);
    if (finalPoints === initialPoints) return false;

    const insertedIndex = segmentIndex < initialPoints.length - 1 ? segmentIndex + 1 : finalPoints.length - 1;
    if (this.commandManager) {
      const command = new InsertPathPointCommand(
        this.stateManager,
        pathId,
        initialPoints,
        finalPoints,
        insertedIndex,
        segmentIndex,
        t
      );
      this.commandManager.executeCommand(command);
    } else {
      this.stateManager.updateShape<Path>(pathId, { points: finalPoints });
    }

    this._hoverInsertPoint = null;
    this.stateManager.markDirty();
    return true;
  }

  public deleteAnchorAt(pathId: string, anchorIndex: number): boolean {
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;

    const initialPoints = pathNode.points;
    const finalPoints = deletePathPointsFromPath(pathNode, [anchorIndex]);
    if (!finalPoints) return false;

    if (this.commandManager) {
      const command = new DeletePathPointCommand(
        this.stateManager,
        pathId,
        initialPoints,
        finalPoints,
        [anchorIndex]
      );
      this.commandManager.executeCommand(command);
    } else {
      this.stateManager.updateShape<Path>(pathId, { points: finalPoints });
    }

    this._hoverInsertPoint = null;
    this.stateManager.markDirty();
    return true;
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
    this._hoverInsertPoint = null;
    this.stateManager.markDirty();
  }

  public destroy(): void {
    this.finishActivePath();
  }
}
