import type { StateManager } from '../../../state/StateManager.ts';
import type { CommandManager } from '../../../commands/CommandManager.ts';
import {
  isGradient,
  isShape,
  type Gradient,
  type Guide,
  type Rectangle,
  type Polygon,
  type Star,
  type Path,
  type Shape,
  type Vector2D,
} from '../../../types/scene-graph.ts';
import {
  hitTestGradientHandles,
  worldToGradientCoord,
  gradientToWorldPoint,
  projectPointOnSegment,
} from '../../../utils/gradient.ts';
import {
  getShapeCornerRadiusHandles,
  hitTestCornerRadiusHandle,
  calculateRadiusFromHandleDrag,
} from '../../../utils/cornerSmoothing.ts';
import { StyleCommand } from '../../../commands/StyleCommand.ts';
import { ResizeCommand } from '../../../commands/ResizeCommand.ts';
import { MoveGuideCommand } from '../../../commands/MoveGuideCommand.ts';
import { RemoveGuideCommand } from '../../../commands/RemoveGuideCommand.ts';
import type {
  GradientDragState,
  CornerRadiusDragState,
  GuideDragState,
} from './types.ts';

export class OverlayInteractionsHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly getViewportZoom: () => number;
  private readonly isTouch: () => boolean;
  private readonly getScreenCoordinates: (event: MouseEvent) => { x: number; y: number };

  private _activeGradientDrag: GradientDragState | null = null;
  private _activeCornerRadiusDrag: CornerRadiusDragState | null = null;
  private _activeGuideDrag: GuideDragState | null = null;
  private _hoveredGuide: Guide | null = null;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    getViewportZoom: () => number,
    isTouch: () => boolean,
    getScreenCoordinates: (event: MouseEvent) => { x: number; y: number }
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.getViewportZoom = getViewportZoom;
    this.isTouch = isTouch;
    this.getScreenCoordinates = getScreenCoordinates;
  }

  public get activeGuideDrag(): Guide | null {
    if (!this._activeGuideDrag) return null;
    return {
      id: this._activeGuideDrag.guide.id,
      axis: this._activeGuideDrag.guide.axis,
      position: this._activeGuideDrag.currentPosition,
    };
  }

  public get hoveredGuide(): Guide | null {
    return this._hoveredGuide;
  }

  public set hoveredGuide(guide: Guide | null) {
    this._hoveredGuide = guide;
  }

  public get isDraggingGradient(): boolean {
    return this._activeGradientDrag !== null;
  }

  public get isDraggingCornerRadius(): boolean {
    return this._activeCornerRadiusDrag !== null;
  }

  public get isDraggingGuide(): boolean {
    return this._activeGuideDrag !== null;
  }

  public tryStartGradient(coords: Vector2D, selectedNode: Shape): boolean {
    const zoom = this.getViewportZoom();
    const grad = isGradient(selectedNode.fill)
      ? selectedNode.fill
      : isGradient(selectedNode.stroke)
      ? selectedNode.stroke
      : null;
    const gradProp: 'fill' | 'stroke' = isGradient(selectedNode.fill) ? 'fill' : 'stroke';

    if (grad) {
      const gradTolerance = (this.isTouch() ? 20 : 10) / zoom;
      const hitGrad = hitTestGradientHandles(selectedNode, grad, coords.x, coords.y, gradTolerance);
      if (hitGrad) {
        this._activeGradientDrag = {
          shapeId: selectedNode.id,
          property: gradProp,
          initialGradient: grad,
          currentGradient: grad,
          handleType: hitGrad.type,
          stopId: hitGrad.stopId,
          startMouse: { x: coords.x, y: coords.y },
        };
        return true;
      }
    }
    return false;
  }

  public tryStartCornerRadius(coords: Vector2D, selectedNode: Shape): boolean {
    const zoom = this.getViewportZoom();
    const crHandles = getShapeCornerRadiusHandles(selectedNode, zoom);
    const crTolerance = (this.isTouch() ? 18 : 8) / zoom;
    const hitCRHandle = hitTestCornerRadiusHandle(crHandles, coords.x, coords.y, crTolerance);
    if (hitCRHandle) {
      this._activeCornerRadiusDrag = {
        handle: hitCRHandle,
        shapeId: selectedNode.id,
        initialRadius: hitCRHandle.currentRadius,
        startMouse: { x: coords.x, y: coords.y },
      };
      return true;
    }
    return false;
  }

  public tryStartGuide(coords: Vector2D, event: MouseEvent): Guide | null {
    const zoom = this.getViewportZoom();
    const hitGuide = this.hitTestGuide(coords.x, coords.y, 6 / zoom);
    if (hitGuide && !event.shiftKey) {
      this._activeGuideDrag = {
        guide: hitGuide,
        initialPosition: hitGuide.position,
        currentPosition: hitGuide.position,
      };
      return hitGuide;
    }
    return null;
  }

  public update(coords: Vector2D): boolean {
    if (this._activeGuideDrag) {
      const newPos = Math.round(this._activeGuideDrag.guide.axis === 'x' ? coords.x : coords.y);
      this._activeGuideDrag.currentPosition = newPos;
      this.stateManager.updateGuide(this._activeGuideDrag.guide.id, newPos);
      return true;
    }

    if (this._activeCornerRadiusDrag) {
      const { handle, shapeId } = this._activeCornerRadiusDrag;
      const newRadius = calculateRadiusFromHandleDrag(handle, coords.x, coords.y);
      const node = this.stateManager.findNode(shapeId);
      if (node && isShape(node)) {
        if (node.type === 'star' && handle.isInner) {
          this.stateManager.updateShapeDimensions(shapeId, { innerCornerRadius: newRadius });
        } else {
          this.stateManager.updateShapeDimensions(shapeId, { cornerRadius: newRadius });
        }
      }
      return true;
    }

    if (this._activeGradientDrag) {
      const { shapeId, property, currentGradient, handleType, stopId } = this._activeGradientDrag;
      const currentShape = this.stateManager.findNode(shapeId);
      if (!currentShape || !isShape(currentShape)) return true;

      const norm = worldToGradientCoord(currentShape, coords.x, coords.y);
      let nextGrad: Gradient = currentGradient;

      if (handleType === 'gradient-start' && currentGradient.type === 'linear') {
        nextGrad = { ...currentGradient, x1: norm.x, y1: norm.y };
      } else if (handleType === 'gradient-end' && currentGradient.type === 'linear') {
        nextGrad = { ...currentGradient, x2: norm.x, y2: norm.y };
      } else if (handleType === 'gradient-center' && currentGradient.type === 'radial') {
        nextGrad = { ...currentGradient, cx: norm.x, cy: norm.y };
      } else if (handleType === 'gradient-radius' && currentGradient.type === 'radial') {
        const dx = norm.x - currentGradient.cx;
        const dy = norm.y - currentGradient.cy;
        const r = Math.max(0.01, Math.hypot(dx, dy));
        nextGrad = { ...currentGradient, r };
      } else if (handleType === 'gradient-stop' && stopId) {
        let t = 0;
        if (currentGradient.type === 'linear') {
          const p1 = gradientToWorldPoint(currentShape, currentGradient.x1, currentGradient.y1);
          const p2 = gradientToWorldPoint(currentShape, currentGradient.x2, currentGradient.y2);
          t = projectPointOnSegment(coords, p1, p2);
        } else {
          const c = gradientToWorldPoint(currentShape, currentGradient.cx, currentGradient.cy);
          const rPt = gradientToWorldPoint(currentShape, currentGradient.cx + currentGradient.r, currentGradient.cy);
          t = projectPointOnSegment(coords, c, rPt);
        }
        const updatedStops = currentGradient.stops.map((s) => (s.id === stopId ? { ...s, offset: t } : s));
        nextGrad = { ...currentGradient, stops: updatedStops };
      }

      this._activeGradientDrag.currentGradient = nextGrad;
      this.stateManager.updateShape(shapeId, { [property]: nextGrad });
      return true;
    }

    return false;
  }

  public finish(_coords: Vector2D, event: MouseEvent): boolean {
    if (this._activeGuideDrag) {
      const { guide, initialPosition, currentPosition } = this._activeGuideDrag;
      this._activeGuideDrag = null;
      const screenCoords = this.getScreenCoordinates(event);
      const draggedToRuler =
        this.stateManager.isRulersVisible() &&
        ((guide.axis === 'x' && screenCoords.x <= 20) || (guide.axis === 'y' && screenCoords.y <= 20));

      if (draggedToRuler) {
        const cmd = new RemoveGuideCommand(this.stateManager, guide);
        this.commandManager.executeCommand(cmd);
      } else if (currentPosition !== initialPosition) {
        const cmd = new MoveGuideCommand(this.stateManager, guide.id, initialPosition, currentPosition);
        this.commandManager.recordCommand(cmd);
      }
      return true;
    }

    if (this._activeCornerRadiusDrag) {
      const { handle, shapeId, initialRadius } = this._activeCornerRadiusDrag;
      this._activeCornerRadiusDrag = null;
      const node = this.stateManager.findNode(shapeId);
      const finalRadius = node && isShape(node)
        ? (node.type === 'star' && handle.isInner
          ? (node as Star).innerCornerRadius ?? 0
          : (node as Rectangle | Polygon | Star | Path).cornerRadius ?? 0)
        : initialRadius;

      if (finalRadius !== initialRadius) {
        const cmd = new ResizeCommand(
          this.stateManager,
          shapeId,
          handle.isInner ? { innerCornerRadius: initialRadius } : { cornerRadius: initialRadius },
          handle.isInner ? { innerCornerRadius: finalRadius } : { cornerRadius: finalRadius }
        );
        this.commandManager.recordCommand(cmd);
      }
      return true;
    }

    if (this._activeGradientDrag) {
      const { shapeId, property, initialGradient, currentGradient } = this._activeGradientDrag;
      this._activeGradientDrag = null;

      if (JSON.stringify(initialGradient) !== JSON.stringify(currentGradient)) {
        const cmd = new StyleCommand(
          this.stateManager,
          shapeId,
          { [property]: initialGradient },
          { [property]: currentGradient }
        );
        this.commandManager.recordCommand(cmd);
      }
      return true;
    }

    return false;
  }

  public hitTestGuide(x: number, y: number, tolerance: number): Guide | null {
    if (!this.stateManager.isGuidesVisible() || this.stateManager.isGuidesLocked()) {
      return null;
    }
    const guides = this.stateManager.getGuides();
    for (let i = guides.length - 1; i >= 0; i--) {
      const g = guides[i];
      const dist = g.axis === 'x' ? Math.abs(g.position - x) : Math.abs(g.position - y);
      if (dist <= tolerance) {
        return g;
      }
    }
    return null;
  }

  public deleteHoveredGuide(): boolean {
    if (this._hoveredGuide && !this.stateManager.isGuidesLocked()) {
      const cmd = new RemoveGuideCommand(this.stateManager, this._hoveredGuide);
      this.commandManager.executeCommand(cmd);
      this._hoveredGuide = null;
      return true;
    }
    return false;
  }

  public reset(): void {
    this._activeGradientDrag = null;
    this._activeCornerRadiusDrag = null;
    this._activeGuideDrag = null;
  }
}
