import type { StateManager } from '../../../state/StateManager.ts';
import type { Vector2D } from '../../../types/scene-graph.ts';
import type { ShapePreview } from '../../InputController.ts';
import type { SelectToolHandlerOptions } from './types.ts';

export class MarqueeSelectionHandler {
  private readonly stateManager: StateManager;
  private readonly getScreenCoordinates: (event: MouseEvent) => { x: number; y: number };
  private readonly options: SelectToolHandlerOptions;

  private _isMarqueeSelecting: boolean = false;
  private _marqueeStartWorld: { x: number; y: number } | null = null;
  private _marqueeStartScreen: { x: number; y: number } | null = null;
  private _marqueeShiftKey: boolean = false;
  private _marqueeInitialSelection: readonly string[] = [];
  private _hasMarqueeDragged: boolean = false;
  private _shapePreview: ShapePreview | null = null;

  constructor(
    stateManager: StateManager,
    getScreenCoordinates: (event: MouseEvent) => { x: number; y: number },
    options: SelectToolHandlerOptions = {}
  ) {
    this.stateManager = stateManager;
    this.getScreenCoordinates = getScreenCoordinates;
    this.options = options;
  }

  public get isMarqueeSelecting(): boolean {
    return this._isMarqueeSelecting;
  }

  public get shapePreview(): ShapePreview | null {
    return this._shapePreview;
  }

  public start(coords: Vector2D, event: MouseEvent): void {
    this._isMarqueeSelecting = true;
    this._marqueeStartWorld = { x: coords.x, y: coords.y };
    this._marqueeStartScreen = this.getScreenCoordinates(event);
    this._marqueeShiftKey = Boolean(event.shiftKey);
    this._marqueeInitialSelection = [...this.stateManager.getSelection()];
    this._hasMarqueeDragged = false;
    this._shapePreview = null;

    if (!event.shiftKey && this.options.deselectOnEmptyClick) {
      this.stateManager.selectNode(null);
    }
  }

  public update(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._isMarqueeSelecting || !this._marqueeStartWorld || !this._marqueeStartScreen) {
      return false;
    }

    const screenPos = this.getScreenCoordinates(event);
    const screenDist = Math.hypot(
      screenPos.x - this._marqueeStartScreen.x,
      screenPos.y - this._marqueeStartScreen.y
    );

    if (screenDist > 3 || this._hasMarqueeDragged) {
      this._hasMarqueeDragged = true;

      const minX = Math.min(this._marqueeStartWorld.x, coords.x);
      const minY = Math.min(this._marqueeStartWorld.y, coords.y);
      const width = Math.abs(coords.x - this._marqueeStartWorld.x);
      const height = Math.abs(coords.y - this._marqueeStartWorld.y);

      this._shapePreview = {
        type: 'marquee',
        x: minX,
        y: minY,
        width,
        height,
      };

      const docState = this.stateManager.getState();
      const intersecting = this.stateManager
        .getSpatialIndex()
        .querySelectableNodesInBox(docState, {
          x: minX,
          y: minY,
          width,
          height,
        });

      const hitIds = intersecting.map((s) => s.id);

      if (this._marqueeShiftKey) {
        const combined = new Set([...this._marqueeInitialSelection, ...hitIds]);
        this.stateManager.setSelection(Array.from(combined));
      } else {
        this.stateManager.setSelection(hitIds);
      }

      this.stateManager.markDirty();
    }

    return true;
  }

  public finish(_event?: MouseEvent): boolean {
    if (!this._isMarqueeSelecting) {
      return false;
    }

    if (!this._hasMarqueeDragged) {
      if (!this._marqueeShiftKey && this.options.deselectOnEmptyClick) {
        this.stateManager.selectNode(null);
      } else if (this._marqueeShiftKey) {
        this.stateManager.setSelection(this._marqueeInitialSelection);
      }
    }

    this.reset();
    this.stateManager.markDirty();
    return true;
  }

  public cancel(): void {
    if (this._isMarqueeSelecting) {
      this.stateManager.setSelection(this._marqueeInitialSelection);
      this.reset();
      this.stateManager.markDirty();
    }
  }

  public reset(): void {
    this._isMarqueeSelecting = false;
    this._marqueeStartWorld = null;
    this._marqueeStartScreen = null;
    this._marqueeShiftKey = false;
    this._marqueeInitialSelection = [];
    this._hasMarqueeDragged = false;
    this._shapePreview = null;
  }
}
