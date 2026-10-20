import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { PointCommand } from '../../commands/PointCommand.ts';
import { InsertPathPointCommand } from '../../commands/InsertPathPointCommand.ts';
import { DeletePathPointCommand } from '../../commands/DeletePathPointCommand.ts';
import { UpdatePathPointTypeCommand } from '../../commands/UpdatePathPointTypeCommand.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import {
  isPointInAABB,
  getPathBaseAABB,
  getVisiblePathHandles,
  isSmoothPoint,
  translatePathAnchors,
  findNearestPointOnPath,
  splitPathSegment,
  deletePathPointsFromPath,
  getPointType,
  applyPointType,
  syncOppositeHandle,
} from '../../utils/geometry.ts';
import {
  type AABB,
  type Path,
  type PathPoint,
  type PathPointType,
  type Shape,
  type Vector2D,
} from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode } from '../InputController.ts';
import {
  getShapeCornerRadiusHandles,
  calculateRadiusFromHandleDrag,
} from '../../utils/cornerSmoothing.ts';

export type DirectSelectTargetType = 'anchor' | 'handleIn' | 'handleOut' | 'cornerRadius';

export interface DirectSelectTarget {
  readonly pathId: string;
  readonly pointIndex: number;
  readonly index: number;
  readonly type: DirectSelectTargetType;
  readonly targetType: DirectSelectTargetType;
  readonly handleType: DirectSelectTargetType;
}

export class DirectSelectToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;
  private readonly hitTest: (x: number, y: number) => Shape | null;

  private _draggedPointIndex: number | null = null;
  private _draggedTargetType: DirectSelectTargetType | null = null;
  private _draggedPointTarget: DirectSelectTarget | null = null;
  private _dragTarget: DirectSelectTarget | null = null;
  private _directSelectTarget: DirectSelectTarget | null = null;
  private _isDraggingPoint: boolean = false;
  private _directSelectOrigin: { x: number; y: number } | null = null;
  private _initialPathPoints: readonly PathPoint[] | null = null;
  private _selectedAnchors: Set<number> = new Set();
  private _anchorsPathId: string | null = null;
  private _isDraggedPointSmooth: boolean = false;
  private _hoverInsertPoint: { localPoint: Vector2D; worldPoint: Vector2D; segmentIndex: number; t: number } | null = null;
  private _lastAnchorClickTime: number = 0;
  private _lastAnchorClickIndex: number = -1;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager,
    hitTest: (x: number, y: number) => Shape | null
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
    this.hitTest = hitTest;
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

  public get selectedAnchors(): ReadonlySet<number> {
    return this._selectedAnchors;
  }

  public get anchorsPathId(): string | null {
    return this._anchorsPathId;
  }

  public get hoverInsertPoint(): Vector2D | null {
    return this._hoverInsertPoint ? this._hoverInsertPoint.worldPoint : null;
  }

  public get pathEditState(): {
    pathId: string;
    selectedAnchors: ReadonlySet<number>;
    hoverInsertPoint?: Vector2D | null;
  } | null {
    const selection = this.stateManager.getSelection();
    if (selection.length === 1) {
      const selectedNode = this.stateManager.getSelectedNode();
      if (selectedNode && selectedNode.type === 'path') {
        if (this._anchorsPathId !== selectedNode.id) {
          this._anchorsPathId = selectedNode.id;
          this._selectedAnchors.clear();
        }
        return {
          pathId: selectedNode.id,
          selectedAnchors: this._selectedAnchors,
          hoverInsertPoint: this._hoverInsertPoint ? this._hoverInsertPoint.localPoint : null,
        };
      }
    }
    if (this._anchorsPathId !== null || this._selectedAnchors.size > 0) {
      this._selectedAnchors.clear();
      this._anchorsPathId = null;
    }
    return null;
  }

  public onActivate(): void {
    const selection = this.stateManager.getSelection();
    if (selection.length > 1) {
      // Priorizar el primer trazado seleccionado si existe
      const selectedNodes = this.stateManager.getSelectedNodes();
      const firstPath = selectedNodes.find((n) => n.type === 'path');
      if (firstPath) {
        this.stateManager.setSelection([firstPath.id]);
      } else {
        this.stateManager.setSelection([selection[0]]);
      }
    }
    this.ensureAnchorsPathSync();
  }

  public onDeactivate(nextTool?: ToolMode): void {
    if (nextTool !== 'direct-select') {
      this.resetDirectSelect();
    }
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D): void {
    this.handleDirectSelectMouseDown(coords.x, coords.y, Boolean(event.shiftKey), Boolean(event.altKey));
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D): void {
    this.handleDirectSelectMouseMove(coords.x, coords.y, Boolean(event.altKey));
  }

  public onMouseUp(_event: MouseEvent, coords: Vector2D): void {
    this.handleDirectSelectMouseUp(coords);
  }

  public clearSelectedAnchors(): void {
    if (this._selectedAnchors.size > 0 || this._anchorsPathId !== null) {
      this._selectedAnchors.clear();
      this._anchorsPathId = null;
      this.stateManager.markDirty();
    }
  }

  public ensureAnchorsPathSync(): void {
    const selection = this.stateManager.getSelection();
    if (
      this._anchorsPathId !== null &&
      (selection.length !== 1 || selection[0] !== this._anchorsPathId)
    ) {
      this.clearSelectedAnchors();
    }
  }

  public resetDirectSelect(): void {
    this._draggedPointIndex = null;
    this._draggedTargetType = null;
    this._draggedPointTarget = null;
    this._dragTarget = null;
    this._directSelectTarget = null;
    this._isDraggingPoint = false;
    this._isDraggedPointSmooth = false;
    this._directSelectOrigin = null;
    this._initialPathPoints = null;
    this._hoverInsertPoint = null;
    this.clearSelectedAnchors();
  }

  public handleDirectSelectMouseDown(
    x: number,
    y: number,
    shiftKey: boolean = false,
    altKey: boolean = false
  ): void {
    this.ensureAnchorsPathSync();
    const selectedNode = this.stateManager.getSelectedNode();
    let activePath: Path | null =
      selectedNode && selectedNode.type === 'path' ? (selectedNode as Path) : null;
    let hitPoint = activePath ? this.findPathPointHit(activePath, x, y) : null;

    if (!hitPoint) {
      // Si el cursor está sobre un segmento válido y se hace clic, subdividir e insertar punto
      if (activePath && this._hoverInsertPoint) {
        const { segmentIndex, t } = this._hoverInsertPoint;
        this.insertAnchorAt(activePath.id, segmentIndex, t);
        return;
      }

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
        // Alt/Option+clic sobre un vértice existente: eliminarlo reconectando el trazado
        if (altKey) {
          this.deleteAnchorAt(activePath.id, hitPoint.index);
          return;
        }

        // Doble clic sobre el vértice: conmutar tipo de vértice (corner -> smooth -> symmetric)
        const now = Date.now();
        if (
          now - this._lastAnchorClickTime < 350 &&
          this._lastAnchorClickIndex === hitPoint.index
        ) {
          this._lastAnchorClickTime = 0;
          this._lastAnchorClickIndex = -1;
          this.toggleAnchorType(activePath.id, hitPoint.index);
          return;
        }
        this._lastAnchorClickTime = now;
        this._lastAnchorClickIndex = hitPoint.index;

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
      this._directSelectOrigin = { x, y };
      this._initialPathPoints = structuredClone(activePath.points);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.clearSelectedAnchors();
      this.resetDirectSelect();
      this.canvas.style.cursor = 'default';
    }
  }

  public handleDirectSelectMouseMove(x: number, y: number, altKey: boolean = false): void {
    if (
      this._isDraggingPoint &&
      this._draggedPointTarget &&
      this._directSelectOrigin &&
      this._initialPathPoints
    ) {
      let deltaX = x - this._directSelectOrigin.x;
      let deltaY = y - this._directSelectOrigin.y;
      const { pathId, pointIndex, type } = this._draggedPointTarget;

      const pathNode = this.stateManager.findNode(pathId) as Path | null;

      if (type === 'cornerRadius') {
        const activeNode = pathNode ?? (this.stateManager.findNode(pathId) as Path | null);
        if (activeNode) {
          const crHandles = getShapeCornerRadiusHandles(activeNode, this.getViewportManager().zoom);
          const crHandle = crHandles.find((h) => h.vertexIndex === pointIndex);
          if (crHandle) {
            const newRadius = calculateRadiusFromHandleDrag(crHandle, x, y);
            const nextPoints = this._initialPathPoints.map((pt, idx) => {
              if (idx !== pointIndex) return pt;
              if (newRadius > 0) {
                return { ...pt, cornerRadius: newRadius };
              } else {
                const { cornerRadius: _, ...rest } = pt;
                return rest as PathPoint;
              }
            });
            this.stateManager.updateShape<Path>(pathId, { points: nextPoints });
            this.canvas.style.cursor = 'crosshair';
            return;
          }
        }
      }

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
              this._initialPathPoints,
              this._selectedAnchors.size > 0 ? this._selectedAnchors : new Set([pointIndex]),
              deltaX,
              deltaY
            )
          : this._initialPathPoints.map((pt, idx) => {
              if (idx !== pointIndex) return pt;
              const ptType = pt.pointType ?? (this._isDraggedPointSmooth ? 'smooth' : 'corner');
              if (type === 'handleIn') {
                const initH = pt.handleIn ?? { x: pt.x, y: pt.y };
                const newHandleIn = {
                  x: initH.x + deltaX,
                  y: initH.y + deltaY,
                };
                let newHandleOut = pt.handleOut;
                if (!altKey && pt.handleOut) {
                  newHandleOut = syncOppositeHandle(
                    { x: pt.x, y: pt.y },
                    newHandleIn,
                    pt.handleOut,
                    ptType
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
                if (!altKey && pt.handleIn) {
                  newHandleIn = syncOppositeHandle(
                    { x: pt.x, y: pt.y },
                    newHandleOut,
                    pt.handleIn,
                    ptType
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
        const activePath = selectedNode as Path;
        const hit = this.findPathPointHit(activePath, x, y);
        if (hit) {
          if (this._hoverInsertPoint) {
            this._hoverInsertPoint = null;
            this.stateManager.markDirty();
          }
          this.canvas.style.cursor = 'pointer';
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
        this.canvas.style.cursor = 'default';
        return;
      }
    }

    if (this._hoverInsertPoint) {
      this._hoverInsertPoint = null;
      this.stateManager.markDirty();
    }
    this.canvas.style.cursor = 'default';
  }

  public handleDirectSelectMouseUp(coords: Vector2D): void {
    if (
      this._isDraggingPoint &&
      this._draggedPointTarget &&
      this._initialPathPoints
    ) {
      const path = this.stateManager.findNode(this._draggedPointTarget.pathId) as Path | null;
      if (path && this.havePointsChanged(this._initialPathPoints, path.points)) {
        const command = new PointCommand(
          this.stateManager,
          this._draggedPointTarget.pathId,
          this._initialPathPoints,
          path.points
        );
        this.commandManager.recordCommand(command);
      }
    }

    this._isDraggingPoint = false;
    this._isDraggedPointSmooth = false;
    this._directSelectOrigin = null;
    this._initialPathPoints = null;

    const selectedNode = this.stateManager.getSelectedNode();
    if (selectedNode && selectedNode.type === 'path') {
      const hit = this.findPathPointHit(selectedNode as Path, coords.x, coords.y);
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  public havePointsChanged(
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

  public findPathPointHit(
    path: Path,
    x: number,
    y: number,
    customHandleSize?: number
  ): { index: number; type: DirectSelectTargetType } | null {
    if (!path.points || path.points.length === 0) return null;

    const zoom = this.getViewportManager().zoom;
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

    // 1b. Evaluar tiradores de radio de esquina (Corner Radius Handles)
    const crHandles = getShapeCornerRadiusHandles(path, zoom);
    for (const h of crHandles) {
      const crAABB = this.createHandleAABB(h.x, h.y, handleSize);
      if (isPointInAABB(testX, testY, crAABB)) {
        return { index: h.vertexIndex, type: 'cornerRadius' };
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
   * Inserta un nuevo punto de ancla sobre un segmento en el parámetro t usando De Casteljau.
   */
  public insertAnchorAt(pathId: string, segmentIndex: number, t: number): boolean {
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;

    const initialPoints = pathNode.points;
    const finalPoints = splitPathSegment(pathNode, segmentIndex, t);
    if (finalPoints === initialPoints) return false;

    const insertedIndex = segmentIndex < initialPoints.length - 1 ? segmentIndex + 1 : finalPoints.length - 1;
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

    this._selectedAnchors.clear();
    this._selectedAnchors.add(insertedIndex);
    this._anchorsPathId = pathId;
    this._hoverInsertPoint = null;
    this.stateManager.markDirty();
    return true;
  }

  /**
   * Elimina un ancla por índice en un trazado reconectando los puntos adyacentes.
   */
  public deleteAnchorAt(pathId: string, anchorIndex: number): boolean {
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;

    const initialPoints = pathNode.points;
    const finalPoints = deletePathPointsFromPath(pathNode, [anchorIndex]);
    if (!finalPoints) return false;

    const command = new DeletePathPointCommand(
      this.stateManager,
      pathId,
      initialPoints,
      finalPoints,
      [anchorIndex]
    );
    this.commandManager.executeCommand(command);

    this._selectedAnchors.delete(anchorIndex);
    if (this._selectedAnchors.size === 0) {
      this._anchorsPathId = null;
    }
    this._hoverInsertPoint = null;
    this.stateManager.markDirty();
    return true;
  }

  /**
   * Elimina todos los anclas seleccionadas actualmente del trazado activo.
   */
  public deleteSelectedAnchors(): boolean {
    if (this._selectedAnchors.size === 0 || !this._anchorsPathId) {
      return false;
    }
    const pathNode = this.stateManager.findNode(this._anchorsPathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') {
      return false;
    }
    const initialPoints = pathNode.points;
    const deletedIndices = Array.from(this._selectedAnchors);
    const finalPoints = deletePathPointsFromPath(pathNode, this._selectedAnchors);
    if (!finalPoints) {
      return false;
    }

    const command = new DeletePathPointCommand(
      this.stateManager,
      this._anchorsPathId,
      initialPoints,
      finalPoints,
      deletedIndices
    );
    this.commandManager.executeCommand(command);

    this._selectedAnchors.clear();
    this._anchorsPathId = null;
    this._hoverInsertPoint = null;
    this.stateManager.markDirty();
    return true;
  }

  /**
   * Conmuta el tipo de vértice del ancla dada (corner -> smooth -> symmetric -> corner).
   */
  public toggleAnchorType(pathId: string, anchorIndex: number): boolean {
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;
    const pt = pathNode.points[anchorIndex];
    if (!pt) return false;

    const currentType = pt.pointType ?? getPointType(pt);
    let nextType: PathPointType = 'corner';
    if (currentType === 'corner') {
      nextType = 'smooth';
    } else if (currentType === 'smooth') {
      nextType = 'symmetric';
    } else {
      nextType = 'corner';
    }

    if (this._anchorsPathId !== pathId) {
      this._selectedAnchors.clear();
      this._anchorsPathId = pathId;
    }
    this._selectedAnchors.clear();
    this._selectedAnchors.add(anchorIndex);

    return this.setSelectedAnchorsType(nextType);
  }

  /**
   * Establece el tipo de vértice (corner, smooth, symmetric) para los anclas seleccionadas (o todas si no hay ninguna seleccionada).
   */
  public setSelectedAnchorsType(targetType: PathPointType): boolean {
    const selection = this.stateManager.getSelection();
    const pathId = this._anchorsPathId ?? (selection.length === 1 ? selection[0] : null);
    if (!pathId) return false;
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;

    const targetIndices = this._selectedAnchors.size > 0
      ? Array.from(this._selectedAnchors)
      : pathNode.points.map((_, i) => i);

    const initialPoints = pathNode.points;
    const indicesSet = new Set(targetIndices);
    const n = pathNode.points.length;
    const finalPoints = pathNode.points.map((pt, i) => {
      if (!indicesSet.has(i)) return pt;
      const prev = pathNode.closed ? pathNode.points[(i - 1 + n) % n] : (i > 0 ? pathNode.points[i - 1] : undefined);
      const next = pathNode.closed ? pathNode.points[(i + 1) % n] : (i < n - 1 ? pathNode.points[i + 1] : undefined);
      return applyPointType(pt, targetType, prev, next);
    });

    const command = new UpdatePathPointTypeCommand(
      this.stateManager,
      pathId,
      initialPoints,
      finalPoints,
      targetIndices,
      targetType
    );
    this.commandManager.executeCommand(command);
    this.stateManager.markDirty();
    return true;
  }

  /**
   * Establece el radio de esquina (cornerRadius) para las anclas seleccionadas (o todas si ninguna está seleccionada).
   */
  public setSelectedAnchorsCornerRadius(radius?: number): boolean {
    const selection = this.stateManager.getSelection();
    const pathId = this._anchorsPathId ?? (selection.length === 1 ? selection[0] : null);
    if (!pathId) return false;
    const pathNode = this.stateManager.findNode(pathId) as Path | null;
    if (!pathNode || pathNode.type !== 'path') return false;

    const targetIndices = this._selectedAnchors.size > 0
      ? Array.from(this._selectedAnchors)
      : pathNode.points.map((_, i) => i);

    const initialPoints = pathNode.points;
    const ok = this.stateManager.setPathPointCornerRadius(pathId, targetIndices, radius);
    if (!ok) return false;

    const updatedNode = this.stateManager.findNode(pathId) as Path;
    const command = new PointCommand(
      this.stateManager,
      pathId,
      initialPoints,
      updatedNode.points
    );
    this.commandManager.recordCommand(command);
    this.stateManager.markDirty();
    return true;
  }

  public destroy(): void {
    this.resetDirectSelect();
  }
}

