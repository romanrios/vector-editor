import type { StateManager } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import { isText, type FillType } from '../../types/scene-graph.ts';
import type { StyleSnapshot } from './types.ts';

export class StyleSnapshotManager {
  private snapshots: Map<string, StyleSnapshot> | null = null;

  private readonly stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  public getSnapshots(): Map<string, StyleSnapshot> | null {
    return this.snapshots;
  }

  public hasSnapshots(): boolean {
    return this.snapshots !== null;
  }

  public clear(): void {
    this.snapshots = null;
  }

  public capture(): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length > 0) {
      this.snapshots = new Map();
      for (const shape of leafShapes) {
        this.snapshots.set(shape.id, {
          fill: shape.fill ?? (isText(shape) ? '#000000' : 'none'),
          stroke: ('stroke' in shape ? (shape as { stroke?: FillType }).stroke : undefined) ?? 'none',
          strokeWidth: ('strokeWidth' in shape ? (shape as { strokeWidth?: number }).strokeWidth : undefined) ?? 1,
          opacity: shape.opacity ?? 1,
          blendMode: shape.blendMode ?? 'normal',
          strokeDashArray: shape.strokeDashArray,
          strokeLineCap: shape.strokeLineCap,
          strokeLineJoin: shape.strokeLineJoin,
          dropShadow: shape.dropShadow ? { ...shape.dropShadow } : null,
        });
      }
    }
  }
}
