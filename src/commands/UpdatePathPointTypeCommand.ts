import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Path, PathPoint, PathPointType } from '../types/scene-graph.ts';

/**
 * Comando que encapsula el cambio de tipo de vértice (corner, smooth, symmetric)
 * en uno o varios puntos de un trazado Bézier, permitiendo deshacer y rehacer.
 */
export class UpdatePathPointTypeCommand implements Command {
  public readonly name: string = 'UpdatePathPointTypeCommand';
  private readonly stateManager: StateManager;
  public readonly pathId: string;
  public readonly initialPoints: readonly PathPoint[];
  public readonly finalPoints: readonly PathPoint[];
  public readonly targetIndices: readonly number[];
  public readonly pointType: PathPointType;

  constructor(
    stateManager: StateManager,
    pathId: string,
    initialPoints: readonly PathPoint[],
    finalPoints: readonly PathPoint[],
    targetIndices: readonly number[],
    pointType: PathPointType
  ) {
    this.stateManager = stateManager;
    this.pathId = pathId;
    this.initialPoints = structuredClone(initialPoints);
    this.finalPoints = structuredClone(finalPoints);
    this.targetIndices = [...targetIndices];
    this.pointType = pointType;
  }

  public execute(): void {
    this.stateManager.updateShape<Path>(this.pathId, { points: this.finalPoints });
  }

  public undo(): void {
    this.stateManager.updateShape<Path>(this.pathId, { points: this.initialPoints });
  }

  public redo(): void {
    this.execute();
  }
}
