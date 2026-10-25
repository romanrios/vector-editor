import type { StateManager, ShapePositionEntry } from '../../../state/StateManager.ts';
import { getLeafShapes } from '../../../state/StateManager.ts';
import type { CommandManager } from '../../../commands/CommandManager.ts';
import type { SnapGuide } from '../../../types/engine.ts';
import {
  isGroup,
  isSelectable,
  type AABB,
  type SelectableNode,
  type Shape,
  type Vector2D,
} from '../../../types/scene-graph.ts';
import { getShapeAABB } from '../../../utils/geometry.ts';
import { TranslateCommand } from '../../../commands/TranslateCommand.ts';
import { BatchCommand } from '../../../commands/BatchCommand.ts';
import { AddShapeCommand } from '../../../commands/AddShapeCommand.ts';
import type { SelectionOperations, PreparedClone } from '../../SelectionOperations.ts';
import { calculateDragSnap } from './snapGuides.ts';


export class DragMoveHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly selectionOperations: SelectionOperations;
  private readonly getScreenCoordinates: (event: MouseEvent) => { x: number; y: number };
  private readonly getViewportZoom: () => number;
  private readonly isSmartGuidesEnabled: () => boolean;
  private readonly setActiveGuides: (guides: SnapGuide[]) => void;

  private _isDragging: boolean = false;
  private _isCopyDragging: boolean = false;
  private dragOrigin: { x: number; y: number } | null = null;
  private dragStartScreen: { x: number; y: number } | null = null;
  private hasMovedPastThreshold: boolean = false;
  private pendingSingleSelectionId: string | null = null;

  private initialShapesPositions: Map<string, { x: number; y: number }> | null = null;
  private initialShapesBounds: Map<string, AABB> | null = null;
  private originalSelectionIds: readonly string[] = [];
  private originalLeafPositions: Map<string, { x: number; y: number }> | null = null;
  private originalLeafBounds: Map<string, AABB> | null = null;
  private activeClonePlacements: PreparedClone[] | null = null;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    selectionOperations: SelectionOperations,
    getScreenCoordinates: (event: MouseEvent) => { x: number; y: number },
    getViewportZoom: () => number,
    isSmartGuidesEnabled: () => boolean,
    setActiveGuides: (guides: SnapGuide[]) => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.selectionOperations = selectionOperations;
    this.getScreenCoordinates = getScreenCoordinates;
    this.getViewportZoom = getViewportZoom;
    this.isSmartGuidesEnabled = isSmartGuidesEnabled;
    this.setActiveGuides = setActiveGuides;
  }

  public get isDragging(): boolean {
    return this._isDragging;
  }

  public get isCopyDragging(): boolean {
    return this._isCopyDragging;
  }

  public get initialBoundsMap(): ReadonlyMap<string, AABB> | null {
    return this.initialShapesBounds;
  }

  public get initialPositionsMap(): ReadonlyMap<string, { x: number; y: number }> | null {
    return this.initialShapesPositions;
  }

  public start(
    coords: Vector2D,
    event: MouseEvent,
    hitShape: Shape,
    resolveNodeToSelect: (hitShape: Shape) => SelectableNode
  ): void {
    const targetNode = resolveNodeToSelect(hitShape);
    const targetId = targetNode.id;

    if (event.shiftKey) {
      this.stateManager.toggleInSelection(targetId);
      this.reset();
      return;
    }

    const isAlreadySelected = this.stateManager.isSelected(targetId);
    const isMultiSelection = this.stateManager.getSelection().length > 1;

    if (isAlreadySelected && isMultiSelection) {
      this.pendingSingleSelectionId = targetId;
    } else if (!isAlreadySelected) {
      this.stateManager.selectNode(targetId);
      this.pendingSingleSelectionId = null;
    } else {
      this.pendingSingleSelectionId = null;
    }

    this._isDragging = true;
    this._isCopyDragging = false;
    this.originalSelectionIds = this.stateManager.getSelection();
    this.activeClonePlacements = null;
    this.dragOrigin = { x: coords.x, y: coords.y };
    this.dragStartScreen = this.getScreenCoordinates(event);
    this.hasMovedPastThreshold = false;

    const selectedNodesAfter = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodesAfter);
    this.initialShapesPositions = new Map<string, { x: number; y: number }>();
    this.initialShapesBounds = new Map<string, AABB>();
    this.originalLeafPositions = new Map<string, { x: number; y: number }>();
    this.originalLeafBounds = new Map<string, AABB>();

    for (const node of leafShapes) {
      this.initialShapesPositions.set(node.id, { x: node.x, y: node.y });
      this.initialShapesBounds.set(node.id, getShapeAABB(node));
      this.originalLeafPositions.set(node.id, { x: node.x, y: node.y });
      this.originalLeafBounds.set(node.id, getShapeAABB(node));
    }
  }

  public update(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._isDragging || !this.initialShapesPositions || !this.dragOrigin || !this.dragStartScreen) {
      return false;
    }

    const screenPos = this.getScreenCoordinates(event);
    const screenDist = Math.hypot(
      screenPos.x - this.dragStartScreen.x,
      screenPos.y - this.dragStartScreen.y
    );

    const shouldMove = screenDist > 3 || this.hasMovedPastThreshold;
    if (!shouldMove) {
      return true;
    }

    if (screenDist > 3) {
      this.hasMovedPastThreshold = true;
      this.pendingSingleSelectionId = null;
    }

    this.syncCopyDragMode(Boolean(event.altKey));

    const rawDeltaX = coords.x - this.dragOrigin.x;
    const rawDeltaY = coords.y - this.dragOrigin.y;
    const snap = this.calculateDragSnap(rawDeltaX, rawDeltaY);
    this.setActiveGuides(snap.guides);
    const deltaX = rawDeltaX + snap.dx;
    const deltaY = rawDeltaY + snap.dy;

    const entries: ShapePositionEntry[] = [];
    for (const [id, initialPos] of this.initialShapesPositions.entries()) {
      entries.push({
        id,
        x: initialPos.x + deltaX,
        y: initialPos.y + deltaY,
      });
    }

    this.stateManager.updateShapesPosition(entries);
    return true;
  }

  public finish(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._isDragging) {
      this.reset();
      return false;
    }

    if (event.button !== 0 && event.button !== undefined) {
      this.reset();
      return false;
    }

    const screenPos = this.getScreenCoordinates(event);
    const screenDist = this.dragStartScreen
      ? Math.hypot(screenPos.x - this.dragStartScreen.x, screenPos.y - this.dragStartScreen.y)
      : 0;

    if (this.pendingSingleSelectionId && screenDist <= 3 && !this.hasMovedPastThreshold) {
      if (this.initialShapesPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.initialShapesPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }
      this.stateManager.selectNode(this.pendingSingleSelectionId);
      this.reset();
      return true;
    }

    if (this.hasMovedPastThreshold && this.initialShapesPositions && this.dragOrigin) {
      this.syncCopyDragMode(Boolean(event.altKey));

      const rawDeltaX = coords.x - this.dragOrigin.x;
      const rawDeltaY = coords.y - this.dragOrigin.y;

      if (this._isCopyDragging && this.activeClonePlacements) {
        const entries: ShapePositionEntry[] = [];
        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          entries.push({ id, x: initialPos.x + rawDeltaX, y: initialPos.y + rawDeltaY });
        }
        this.stateManager.updateShapesPosition(entries);

        const commands: AddShapeCommand[] = [];
        for (const p of this.activeClonePlacements) {
          const finalClone = this.stateManager.findNode(p.clonedNode.id) as SelectableNode;
          if (finalClone) {
            commands.push(new AddShapeCommand(this.stateManager, p.parentId, finalClone, p.targetIndex));
          }
        }

        if (commands.length > 0) {
          const batch = new BatchCommand(commands, 'Copiar y mover');
          this.commandManager.recordCommand(batch);
        }

        this.activeClonePlacements = null;
        this._isCopyDragging = false;
        this.reset();
        return true;
      }

      const snap = this.calculateDragSnap(rawDeltaX, rawDeltaY);
      this.setActiveGuides(snap.guides);
      const deltaX = rawDeltaX + snap.dx;
      const deltaY = rawDeltaY + snap.dy;
      const selectedNodes = this.stateManager.getSelectedNodes();
      const isGroupSelected = selectedNodes.some(isGroup);

      if (this.initialShapesPositions.size > 1 || isGroupSelected) {
        const commands: TranslateCommand[] = [];
        const entries: ShapePositionEntry[] = [];

        for (const [id, initialPos] of this.initialShapesPositions.entries()) {
          const finalX = initialPos.x + deltaX;
          const finalY = initialPos.y + deltaY;
          entries.push({ id, x: finalX, y: finalY });

          if (finalX !== initialPos.x || finalY !== initialPos.y) {
            commands.push(
              new TranslateCommand(
                this.stateManager,
                id,
                initialPos.x,
                initialPos.y,
                finalX,
                finalY,
                { mergeTimeout: 0 }
              )
            );
          }
        }

        this.stateManager.updateShapesPosition(entries);

        if (commands.length > 0) {
          const batch = new BatchCommand(commands, 'Mover figuras');
          this.commandManager.recordCommand(batch);
        }
      } else if (this.initialShapesPositions.size === 1) {
        const [singleId, initialPos] = Array.from(this.initialShapesPositions.entries())[0];
        const finalX = initialPos.x + deltaX;
        const finalY = initialPos.y + deltaY;

        this.stateManager.updateShapePosition(singleId, finalX, finalY);

        if (finalX !== initialPos.x || finalY !== initialPos.y) {
          const command = new TranslateCommand(
            this.stateManager,
            singleId,
            initialPos.x,
            initialPos.y,
            finalX,
            finalY,
            { mergeTimeout: 0 }
          );
          this.commandManager.recordCommand(command);
        }
      }
    } else if (!this.hasMovedPastThreshold && this.initialShapesPositions) {
      const restoreEntries: ShapePositionEntry[] = [];
      for (const [id, pos] of this.initialShapesPositions.entries()) {
        restoreEntries.push({ id, x: pos.x, y: pos.y });
      }
      this.stateManager.updateShapesPosition(restoreEntries);
    }

    this.reset();
    return true;
  }

  public syncCopyDragMode(altKey: boolean): void {
    if (altKey && !this._isCopyDragging) {
      if (this.originalLeafPositions) {
        const restoreEntries: ShapePositionEntry[] = [];
        for (const [id, pos] of this.originalLeafPositions.entries()) {
          restoreEntries.push({ id, x: pos.x, y: pos.y });
        }
        this.stateManager.updateShapesPosition(restoreEntries);
      }

      const originalNodes: SelectableNode[] = [];
      for (const id of this.originalSelectionIds) {
        const node = this.stateManager.findNode(id);
        if (node && isSelectable(node)) {
          originalNodes.push(node);
        }
      }

      const prepared = this.selectionOperations.prepareClones(originalNodes, { dx: 0, dy: 0 });
      for (const p of prepared) {
        this.stateManager.addNode(p.parentId, p.clonedNode, p.targetIndex);
      }
      this.activeClonePlacements = prepared;

      const cloneIds = prepared.map((p) => p.clonedNode.id);
      this.stateManager.setSelection(cloneIds);

      const clonedSelectedNodes = this.stateManager.getSelectedNodes();
      const clonedLeafShapes = getLeafShapes(clonedSelectedNodes);
      this.initialShapesPositions = new Map<string, { x: number; y: number }>();
      this.initialShapesBounds = new Map<string, AABB>();
      for (const leaf of clonedLeafShapes) {
        this.initialShapesPositions.set(leaf.id, { x: leaf.x, y: leaf.y });
        this.initialShapesBounds.set(leaf.id, getShapeAABB(leaf));
      }

      this._isCopyDragging = true;
    } else if (!altKey && this._isCopyDragging) {
      if (this.activeClonePlacements) {
        for (const p of this.activeClonePlacements) {
          this.stateManager.removeFromSelection([p.clonedNode.id]);
          this.stateManager.removeNode(p.clonedNode.id);
        }
        this.activeClonePlacements = null;
      }

      this.stateManager.setSelection(this.originalSelectionIds);

      if (this.originalLeafPositions) {
        this.initialShapesPositions = new Map(this.originalLeafPositions);
      }
      if (this.originalLeafBounds) {
        this.initialShapesBounds = new Map(this.originalLeafBounds);
      }

      this._isCopyDragging = false;
    }
  }

  public calculateDragSnap(deltaX: number, deltaY: number): { dx: number; dy: number; guides: SnapGuide[] } {
    return calculateDragSnap(
      this.stateManager,
      this.getViewportZoom(),
      this.isSmartGuidesEnabled(),
      this.initialShapesBounds,
      this.initialShapesPositions,
      this._isCopyDragging,
      deltaX,
      deltaY
    );
  }

  public handleEscape(): boolean {
    if (!this._isDragging) {
      return false;
    }

    if (this._isCopyDragging && this.activeClonePlacements) {
      for (const p of this.activeClonePlacements) {
        this.stateManager.removeFromSelection([p.clonedNode.id]);
        this.stateManager.removeNode(p.clonedNode.id);
      }
      this.activeClonePlacements = null;
      this.stateManager.setSelection(this.originalSelectionIds);
    }

    if (this.originalLeafPositions) {
      const restoreEntries: ShapePositionEntry[] = [];
      for (const [id, pos] of this.originalLeafPositions.entries()) {
        restoreEntries.push({ id, x: pos.x, y: pos.y });
      }
      this.stateManager.updateShapesPosition(restoreEntries);
    }

    this.reset();
    this.stateManager.markDirty();
    return true;
  }

  public reset(): void {
    if (this._isCopyDragging && this.activeClonePlacements) {
      for (const p of this.activeClonePlacements) {
        this.stateManager.removeFromSelection([p.clonedNode.id]);
        this.stateManager.removeNode(p.clonedNode.id);
      }
      this.activeClonePlacements = null;
      this.stateManager.setSelection(this.originalSelectionIds);
    }
    this._isDragging = false;
    this._isCopyDragging = false;
    this.dragOrigin = null;
    this.dragStartScreen = null;
    this.initialShapesPositions = null;
    this.initialShapesBounds = null;
    this.originalLeafPositions = null;
    this.originalLeafBounds = null;
    this.pendingSingleSelectionId = null;
    this.hasMovedPastThreshold = false;
    this.originalSelectionIds = [];
    this.setActiveGuides([]);
  }
}
