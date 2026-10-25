import type { StateManager } from '../../../state/StateManager.ts';
import type { CommandManager } from '../../../commands/CommandManager.ts';
import type { SnapGuide } from '../../../types/engine.ts';
import {
  isShape,
  type AABB,
  type Shape,
  type Vector2D,
} from '../../../types/scene-graph.ts';
import {
  computeBoxScale,
  computeRotationDelta,
  getShapeAABB,
  type HandleType,
} from '../../../utils/geometry.ts';

import {
  rotateShapesAboutPivot,
  scaleShapesAboutAnchor,
  getShapeDimensions,
} from '../../../utils/transform.ts';
import {
  TransformShapesCommand,
  type ShapeTransformEntry,
} from '../../../commands/TransformShapesCommand.ts';
import type { MultiTransformState } from './types.ts';
import { calculateAABBSnap } from './snapGuides.ts';

export class MultiTransformHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly getViewportZoom: () => number;
  private readonly isSmartGuidesEnabled: () => boolean;
  private readonly setActiveGuides: (guides: SnapGuide[]) => void;

  private _multiTransformState: MultiTransformState | null = null;
  private _lastShiftKey: boolean = false;
  private _lastAltKey: boolean = false;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    getViewportZoom: () => number,
    isSmartGuidesEnabled: () => boolean,
    setActiveGuides: (guides: SnapGuide[]) => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.getViewportZoom = getViewportZoom;
    this.isSmartGuidesEnabled = isSmartGuidesEnabled;
    this.setActiveGuides = setActiveGuides;
  }

  public get isMultiTransforming(): boolean {
    return this._multiTransformState !== null;
  }

  public get multiTransformState(): MultiTransformState | null {
    return this._multiTransformState ? { ...this._multiTransformState } : null;
  }

  public startRotate(coords: Vector2D, bounds: AABB, leafShapes: readonly Shape[]): void {
    const pivot: Vector2D = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    this._multiTransformState = {
      type: 'rotate',
      leafShapes,
      initialBounds: bounds,
      anchorOrPivot: pivot,
      startMouse: { x: coords.x, y: coords.y },
      lastMouse: { x: coords.x, y: coords.y },
    };
  }

  public startScale(
    coords: Vector2D,
    bounds: AABB,
    leafShapes: readonly Shape[],
    handle: HandleType,
    anchor: Vector2D
  ): void {
    this._multiTransformState = {
      type: 'scale',
      leafShapes,
      initialBounds: bounds,
      anchorOrPivot: anchor,
      startMouse: { x: coords.x, y: coords.y },
      lastMouse: { x: coords.x, y: coords.y },
      handle,
    };
  }

  public update(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._multiTransformState) {
      return false;
    }
    this._lastShiftKey = Boolean(event.shiftKey);
    this._lastAltKey = Boolean(event.altKey);
    this.apply(coords.x, coords.y, Boolean(event.shiftKey), Boolean(event.altKey));
    return true;
  }

  public apply(x: number, y: number, shiftKey: boolean, altKey: boolean = false): void {
    if (!this._multiTransformState) {
      return;
    }
    const transformState = this._multiTransformState;
    transformState.lastMouse = { x, y };

    if (transformState.type === 'rotate') {
      this.setActiveGuides([]);
      const pivot = transformState.anchorOrPivot;
      const startMouse = transformState.startMouse;
      const currentMouse = { x, y };
      const deltaDeg = computeRotationDelta(pivot, startMouse, currentMouse, shiftKey);
      const changes = rotateShapesAboutPivot(transformState.leafShapes, pivot, deltaDeg);
      if (changes.length === 0) {
        const restoreEntries = transformState.leafShapes.map((shape) => ({
          id: shape.id,
          dimensions: getShapeDimensions(shape),
        }));
        this.stateManager.updateShapesDimensions(restoreEntries);
      } else {
        this.stateManager.updateShapesDimensions(changes);
      }
    } else if (transformState.type === 'scale') {
      const handle = transformState.handle!;
      const bounds = transformState.initialBounds;
      const hasTextOrImage = transformState.leafShapes.some((s) => s.type === 'text' || s.type === 'image');
      const shouldPreserveAspect = hasTextOrImage ? true : shiftKey;

      const applyScale = (mouseX: number, mouseY: number): void => {
        const dx = mouseX - transformState.startMouse.x;
        const dy = mouseY - transformState.startMouse.y;
        const { anchor, sx, sy } = computeBoxScale(bounds, handle, dx, dy, shouldPreserveAspect, altKey);
        const changes = scaleShapesAboutAnchor(transformState.leafShapes, anchor, sx, sy);
        if (changes.length === 0) {
          const restoreEntries = transformState.leafShapes.map((shape) => ({
            id: shape.id,
            dimensions: getShapeDimensions(shape),
          }));
          this.stateManager.updateShapesDimensions(restoreEntries);
        } else {
          this.stateManager.updateShapesDimensions(changes);
        }
      };

      applyScale(x, y);

      if (altKey) {
        this.setActiveGuides([]);
        return;
      }

      const scaledShapes = transformState.leafShapes
        .map((shape) => this.stateManager.findNode(shape.id))
        .filter((shape): shape is Shape => Boolean(shape && isShape(shape)));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const shape of scaledShapes) {
        const shapeBounds = getShapeAABB(shape);
        minX = Math.min(minX, shapeBounds.minX);
        minY = Math.min(minY, shapeBounds.minY);
        maxX = Math.max(maxX, shapeBounds.maxX);
        maxY = Math.max(maxY, shapeBounds.maxY);
      }
      if (Number.isFinite(minX) && Number.isFinite(minY)) {
        const scaledBounds: AABB = {
          minX,
          minY,
          maxX,
          maxY,
          width: maxX - minX,
          height: maxY - minY,
        };
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
          scaledBounds,
          new Set(transformState.leafShapes.map((shape) => shape.id)),
          fixedXFeature,
          fixedYFeature
        );
        this.setActiveGuides(snap.guides);
        if (snap.dx !== 0 || snap.dy !== 0) {
          applyScale(x + snap.dx, y + snap.dy);
        }
      } else {
        this.setActiveGuides([]);
      }
    }
  }

  public finish(): boolean {
    if (!this._multiTransformState) {
      return false;
    }

    const entries: ShapeTransformEntry[] = this._multiTransformState.leafShapes.map((initialShape) => {
      const currentShape = (this.stateManager.findNode(initialShape.id) as Shape | null) ?? initialShape;
      return {
        id: initialShape.id,
        before: getShapeDimensions(initialShape),
        after: getShapeDimensions(currentShape),
      };
    });

    const command = new TransformShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) {
      this.commandManager.recordCommand(command);
    }

    this.reset();
    return true;
  }

  public handleEscape(): boolean {
    if (this._multiTransformState) {
      const restoreEntries = this._multiTransformState.leafShapes.map((shape) => ({
        id: shape.id,
        dimensions: getShapeDimensions(shape),
      }));
      this.stateManager.updateShapesDimensions(restoreEntries);
      this.reset();
      this.stateManager.markDirty();
      return true;
    }
    return false;
  }

  public handleShiftToggle(shiftKey: boolean): boolean {
    if (this._multiTransformState && this._multiTransformState.lastMouse) {
      this._lastShiftKey = shiftKey;
      this.apply(
        this._multiTransformState.lastMouse.x,
        this._multiTransformState.lastMouse.y,
        shiftKey,
        this._lastAltKey
      );
      return true;
    }
    return false;
  }

  public handleAltToggle(altKey: boolean): boolean {
    if (this._multiTransformState && this._multiTransformState.lastMouse) {
      this._lastAltKey = altKey;
      this.apply(
        this._multiTransformState.lastMouse.x,
        this._multiTransformState.lastMouse.y,
        this._lastShiftKey,
        altKey
      );
      return true;
    }
    return false;
  }

  public reset(): void {
    this._multiTransformState = null;
    this.setActiveGuides([]);
  }
}
