import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { AddShapeCommand } from '../../commands/AddShapeCommand.ts';
import type { SnapGuide } from '../../types/engine.ts';
import type { ViewportManager } from '../../utils/viewport.ts';
import {
  calculateAnchoredSnapping,
  calculateSnapping,
  getShapeAABB,
  normalizeShapeBounds,
} from '../../utils/geometry.ts';
import {
  isGroup,
  isShape,
  type AABB,
  type Ellipse,
  type LayerChildNode,
  type Rectangle,
  type Shape,
  type Vector2D,
} from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode, ShapePreview } from '../InputController.ts';

export class CreationToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportManager: () => ViewportManager;
  private readonly setTool: (tool: ToolMode) => void;
  private readonly isSmartGuidesEnabled: () => boolean;
  private readonly setActiveGuides: (guides: SnapGuide[]) => void;

  private _isCreatingShape: boolean = false;
  private _creationStart: Vector2D | null = null;
  private _creationCurrent: Vector2D | null = null;
  private _creationShiftKey: boolean = false;
  private _shapePreview: ShapePreview | null = null;
  public rectangleCounter: number = 0;
  public ellipseCounter: number = 0;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    getViewportManager: () => ViewportManager,
    setTool: (tool: ToolMode) => void,
    isSmartGuidesEnabled: () => boolean,
    setActiveGuides: (guides: SnapGuide[]) => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.getViewportManager = getViewportManager;
    this.setTool = setTool;
    this.isSmartGuidesEnabled = isSmartGuidesEnabled;
    this.setActiveGuides = setActiveGuides;
  }

  public get isCreatingShape(): boolean {
    return this._isCreatingShape;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'crosshair';
  }

  public onDeactivate(nextTool?: ToolMode): void {
    if (nextTool !== 'rectangle' && nextTool !== 'ellipse') {
      this.cancelCreation();
    }
  }

  public onMouseDown(event: MouseEvent, coords: Vector2D, tool: 'rectangle' | 'ellipse' = 'rectangle'): void {
    this._isCreatingShape = true;
    this._creationStart = coords;
    this._creationCurrent = coords;
    this._creationShiftKey = Boolean(event.shiftKey);
    this.updateShapePreview(tool, Boolean(event.shiftKey));
    this.stateManager.markDirty();
  }

  public onMouseMove(event: MouseEvent, coords: Vector2D, tool: 'rectangle' | 'ellipse' = 'rectangle'): void {
    if (!this._isCreatingShape || !this._creationStart) return;

    this._creationCurrent = coords;
    this._creationShiftKey = Boolean(event.shiftKey);
    this.updateShapePreview(tool, Boolean(event.shiftKey));
    this.stateManager.markDirty();
  }

  public onMouseUp(event: MouseEvent, coords: Vector2D, tool: 'rectangle' | 'ellipse' = 'rectangle'): void {
    if (!this._isCreatingShape) return;

    const start = this._creationStart ?? coords;
    const dx = coords.x - start.x;
    const dy = coords.y - start.y;
    const distance = Math.hypot(dx, dy);
    const zoom = this.getViewportManager().zoom;

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

    const lock = Boolean(event.shiftKey) || this._creationShiftKey;
    const snappedCurrent = this.snapCreationPoint(
      start,
      coords,
      tool,
      lock
    );

    const style = this.stateManager.getDrawingStyle();
    let newShape: Shape;

    if (tool === 'rectangle') {
      const bounds = normalizeShapeBounds(
        start,
        snappedCurrent,
        'rectangle',
        lock
      );
      this.rectangleCounter++;
      const rectShape: Rectangle = {
        id: `rect-${Date.now()}-${this.rectangleCounter}`,
        type: 'rectangle',
        name: `Rectángulo ${this.rectangleCounter}`,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
        visible: true,
        locked: false,
        rotation: 0,
      };
      newShape = rectShape;
    } else {
      const bounds = normalizeShapeBounds(
        start,
        snappedCurrent,
        'ellipse',
        lock
      );
      this.ellipseCounter++;
      const ellipseShape: Ellipse = {
        id: `ellipse-${Date.now()}-${this.ellipseCounter}`,
        type: 'ellipse',
        name: `Elipse ${this.ellipseCounter}`,
        x: bounds.x,
        y: bounds.y,
        radiusX: bounds.radiusX,
        radiusY: bounds.radiusY,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
        visible: true,
        locked: false,
        rotation: 0,
      };
      newShape = ellipseShape;
    }

    try {
      const command = new AddShapeCommand(this.stateManager, targetLayer.id, newShape);
      this.commandManager.executeCommand(command);
      this.stateManager.selectNode(newShape.id);
    } finally {
      this.cancelCreation();
      this.setTool('select');
    }
  }

  public cancelCreation(): void {
    const wasCreating = this._isCreatingShape || this._shapePreview !== null;
    this._isCreatingShape = false;
    this._creationStart = null;
    this._creationCurrent = null;
    this._shapePreview = null;
    this.setActiveGuides([]);
    if (wasCreating) {
      this.stateManager.markDirty();
    }
  }

  public updateShapePreview(tool: 'rectangle' | 'ellipse', shiftKey?: boolean): void {
    if (!this._creationStart || !this._creationCurrent) {
      this._shapePreview = null;
      return;
    }

    const lock = shiftKey ?? this._creationShiftKey;
    const snappedCurrent = this.snapCreationPoint(
      this._creationStart,
      this._creationCurrent,
      tool,
      lock
    );
    const bounds = normalizeShapeBounds(
      this._creationStart,
      snappedCurrent,
      tool,
      lock
    );

    const style = this.stateManager.getDrawingStyle();
    this._shapePreview = {
      ...bounds,
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
    };
  }

  public calculateAABBSnap(
    movingAABB: AABB,
    excludedShapeIds: ReadonlySet<string> = new Set(),
    fixedXFeature?: 0 | 2 | 'all',
    fixedYFeature?: 0 | 2 | 'all'
  ): { dx: number; dy: number; guides: SnapGuide[] } {
    if (!this.isSmartGuidesEnabled()) {
      return { dx: 0, dy: 0, guides: [] };
    }

    const targetAABBs: AABB[] = [];
    const document = this.stateManager.getState();
    if (document.width > 0 && document.height > 0) {
      targetAABBs.push({
        minX: 0,
        minY: 0,
        maxX: document.width,
        maxY: document.height,
        width: document.width,
        height: document.height,
      });
    }

    const visit = (nodes: readonly LayerChildNode[]): void => {
      for (const node of nodes) {
        if (!this.stateManager.isEffectivelyVisible(node.id)) continue;
        if (isGroup(node)) {
          visit(node.children);
        } else if (isShape(node) && !excludedShapeIds.has(node.id)) {
          targetAABBs.push(getShapeAABB(node));
        }
      }
    };
    for (const layer of document.children) {
      if (this.stateManager.isEffectivelyVisible(layer.id)) {
        visit(layer.children);
      }
    }

    const tolerance = 5 / this.getViewportManager().zoom;
    if (fixedXFeature !== undefined && fixedYFeature !== undefined) {
      return calculateAnchoredSnapping(
        movingAABB,
        targetAABBs,
        fixedXFeature,
        fixedYFeature,
        tolerance
      );
    }
    return calculateSnapping(movingAABB, targetAABBs, tolerance);
  }

  public snapCreationPoint(
    start: Vector2D,
    point: Vector2D,
    tool: 'rectangle' | 'ellipse',
    shiftKey: boolean
  ): Vector2D {
    const candidateBounds = normalizeShapeBounds(start, point, tool, shiftKey);
    const movingAABB: AABB = {
      minX: candidateBounds.x,
      minY: candidateBounds.y,
      maxX: candidateBounds.x + candidateBounds.width,
      maxY: candidateBounds.y + candidateBounds.height,
      width: candidateBounds.width,
      height: candidateBounds.height,
    };
    const snap = this.calculateAABBSnap(
      movingAABB,
      new Set(),
      point.x >= start.x ? 0 : 2,
      point.y >= start.y ? 0 : 2
    );
    this.setActiveGuides(snap.guides);
    return { x: point.x + snap.dx, y: point.y + snap.dy };
  }

  public destroy(): void {
    this.cancelCreation();
  }
}
