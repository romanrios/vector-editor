import type { StateManager } from '../../../state/StateManager.ts';
import type { CommandManager } from '../../../commands/CommandManager.ts';
import type { SnapGuide } from '../../../types/engine.ts';
import {
  isShape,
  type Shape,
  type Vector2D,
} from '../../../types/scene-graph.ts';
import {
  getPathBaseAABB,
  getShapeAABB,
  getTextBaseAABB,
  type HandleType,
} from '../../../utils/geometry.ts';
import { ResizeCommand, type ShapeDimensions } from '../../../commands/ResizeCommand.ts';
import { calculateResizedDimensions, hasDimensionsChanged } from './resizeGeometry.ts';
import { calculateAABBSnap } from './snapGuides.ts';

export class ResizeHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly getViewportZoom: () => number;
  private readonly isSmartGuidesEnabled: () => boolean;
  private readonly setActiveGuides: (guides: SnapGuide[]) => void;
  private readonly getCanvasContext: () => CanvasRenderingContext2D | null;

  private _isResizing: boolean = false;
  private resizeOrigin: { x: number; y: number } | null = null;
  private _lastResizeMousePos: { x: number; y: number } | null = null;
  private activeResizeHandle: HandleType | null = null;
  private resizingShapeId: string | null = null;
  private initialDimensions: ShapeDimensions | null = null;


  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    getViewportZoom: () => number,
    isSmartGuidesEnabled: () => boolean,
    setActiveGuides: (guides: SnapGuide[]) => void,
    getCanvasContext: () => CanvasRenderingContext2D | null
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.getViewportZoom = getViewportZoom;
    this.isSmartGuidesEnabled = isSmartGuidesEnabled;
    this.setActiveGuides = setActiveGuides;
    this.getCanvasContext = getCanvasContext;
  }

  public get isResizing(): boolean {
    return this._isResizing;
  }

  public get resizeOriginPoint(): { x: number; y: number } | null {
    return this.resizeOrigin ? { ...this.resizeOrigin } : null;
  }

  public get currentResizeHandle(): HandleType | null {
    return this.activeResizeHandle;
  }

  public get resizingNodeId(): string | null {
    return this.resizingShapeId;
  }

  public get initialResizeDimensions(): ShapeDimensions | null {
    return this.initialDimensions ? { ...this.initialDimensions } : null;
  }

  public get lastResizeMousePos(): { x: number; y: number } | null {
    return this._lastResizeMousePos ? { ...this._lastResizeMousePos } : null;
  }

  public start(
    coords: Vector2D,
    _event: MouseEvent,
    selectedNode: Shape,
    handleType: HandleType
  ): void {
    this._isResizing = true;
    this.resizeOrigin = { x: coords.x, y: coords.y };
    this._lastResizeMousePos = { x: coords.x, y: coords.y };
    this.activeResizeHandle = handleType;
    this.resizingShapeId = selectedNode.id;


    if (selectedNode.type === 'rectangle' || selectedNode.type === 'image') {
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
    } else if (selectedNode.type === 'polygon') {
      this.initialDimensions = {
        x: selectedNode.x,
        y: selectedNode.y,
        radius: selectedNode.radius,
        sides: selectedNode.sides,
        rotation: selectedNode.rotation ?? 0,
        ...(selectedNode.cornerRadius !== undefined ? { cornerRadius: selectedNode.cornerRadius } : {}),
      };
    } else if (selectedNode.type === 'star') {
      this.initialDimensions = {
        x: selectedNode.x,
        y: selectedNode.y,
        outerRadius: selectedNode.outerRadius,
        innerRadius: selectedNode.innerRadius,
        starPoints: selectedNode.points,
        rotation: selectedNode.rotation ?? 0,
        ...(selectedNode.cornerRadius !== undefined ? { cornerRadius: selectedNode.cornerRadius } : {}),
        ...(selectedNode.innerCornerRadius !== undefined ? { innerCornerRadius: selectedNode.innerCornerRadius } : {}),
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
    } else if (selectedNode.type === 'text') {
      const ctx = this.getCanvasContext();
      const aabb = getTextBaseAABB(selectedNode, ctx);
      this.initialDimensions = {
        x: selectedNode.x,
        y: selectedNode.y,
        baseX: aabb.minX,
        baseY: aabb.minY,
        width: aabb.width,
        height: aabb.height,
        fontSize: selectedNode.fontSize ?? 16,
        lineHeight: selectedNode.lineHeight,
        letterSpacing: selectedNode.letterSpacing,
        rotation: selectedNode.rotation ?? 0,
        boxWidth: selectedNode.boxWidth,
      };
    } else {
      this.initialDimensions = null;
    }
  }

  public update(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._isResizing || !this.resizingShapeId || !this.resizeOrigin || !this.activeResizeHandle || !this.initialDimensions) {
      return false;
    }

    this._lastResizeMousePos = { x: coords.x, y: coords.y };
    this.calculateSnappedResizeDimensions(coords.x, coords.y, Boolean(event.shiftKey), Boolean(event.altKey));
    return true;

  }

  public finish(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._isResizing) {
      return false;
    }

    if (
      this.resizingShapeId &&
      this.resizeOrigin &&
      this.activeResizeHandle &&
      this.initialDimensions
    ) {
      const finalDimensions = this.calculateSnappedResizeDimensions(
        coords.x,
        coords.y,
        Boolean(event.shiftKey),
        Boolean(event.altKey)
      );

      if (finalDimensions && hasDimensionsChanged(this.initialDimensions, finalDimensions)) {
        const command = new ResizeCommand(
          this.stateManager,
          this.resizingShapeId,
          this.initialDimensions,
          finalDimensions
        );
        this.commandManager.recordCommand(command);
      }
    }

    this.reset();
    return true;
  }

  public calculateSnappedResizeDimensions(
    mouseX: number,
    mouseY: number,
    shiftKey: boolean,
    altKey: boolean = false
  ): ShapeDimensions | null {
    if (
      !this.resizingShapeId ||
      !this.resizeOrigin ||
      !this.activeResizeHandle ||
      !this.initialDimensions
    ) {
      return null;
    }

    const currentShape = this.stateManager.findNode(this.resizingShapeId);
    const isImageNode = currentShape?.type === 'image';
    const isTextNode = currentShape?.type === 'text';
    const isParametricRegular = currentShape?.type === 'polygon' || currentShape?.type === 'star';
    const preserveRatio = isImageNode || isTextNode || isParametricRegular ? true : shiftKey;

    const deltaX = mouseX - this.resizeOrigin.x;
    const deltaY = mouseY - this.resizeOrigin.y;
    const candidateDimensions = calculateResizedDimensions(
      this.initialDimensions,
      this.activeResizeHandle,
      deltaX,
      deltaY,
      preserveRatio,
      altKey
    );
    this.stateManager.updateShapeDimensions(this.resizingShapeId, candidateDimensions);

    if (altKey) {
      this.setActiveGuides([]);
      return candidateDimensions;
    }

    const candidateShape = this.stateManager.findNode(this.resizingShapeId);
    if (!candidateShape || !isShape(candidateShape)) {
      this.setActiveGuides([]);
      return candidateDimensions;
    }

    const handle = this.activeResizeHandle;
    const fixedXFeature: 0 | 2 | 'all' = handle.includes('right')
      ? 0
      : handle.includes('left') ? 2 : 'all';
    const fixedYFeature: 0 | 2 | 'all' = handle.includes('bottom')
      ? 0
      : handle.includes('top') ? 2 : 'all';
    const snap = calculateAABBSnap(
      this.stateManager,
      this.getViewportZoom(),
      this.isSmartGuidesEnabled(),
      getShapeAABB(candidateShape),
      new Set([this.resizingShapeId]),
      fixedXFeature,
      fixedYFeature
    );
    this.setActiveGuides(snap.guides);
    const finalDimensions = calculateResizedDimensions(
      this.initialDimensions,
      this.activeResizeHandle,
      deltaX + snap.dx,
      deltaY + snap.dy,
      preserveRatio,
      altKey
    );
    this.stateManager.updateShapeDimensions(this.resizingShapeId, finalDimensions);
    return finalDimensions;
  }

  public handleEscape(): boolean {
    if (this._isResizing && this.resizingShapeId && this.initialDimensions) {
      this.stateManager.updateShapeDimensions(this.resizingShapeId, this.initialDimensions);
      this.reset();
      this.stateManager.markDirty();
      return true;
    }
    return false;
  }

  public reset(): void {
    this._isResizing = false;
    this.resizeOrigin = null;
    this._lastResizeMousePos = null;
    this.activeResizeHandle = null;
    this.resizingShapeId = null;
    this.initialDimensions = null;
    this.setActiveGuides([]);
  }
}
