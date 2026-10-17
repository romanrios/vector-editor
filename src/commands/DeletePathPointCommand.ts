import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Path, PathPoint } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la eliminación de uno o varios vértices de un trazado Bézier,
 * reconectando los segmentos adyacentes y permitiendo deshacer y rehacer.
 */
export class DeletePathPointCommand implements Command {
  public readonly name: string = 'DeletePathPointCommand';
  private readonly stateManager: StateManager;
  public readonly pathId: string;
  public readonly initialPoints: readonly PathPoint[];
  public readonly finalPoints: readonly PathPoint[];
  public readonly deletedIndices: readonly number[];

  constructor(
    stateManager: StateManager,
    pathId: string,
    initialPoints: readonly PathPoint[],
    finalPoints: readonly PathPoint[],
    deletedIndices: readonly number[]
  ) {
    this.stateManager = stateManager;
    this.pathId = pathId;
    this.initialPoints = structuredClone(initialPoints);
    this.finalPoints = structuredClone(finalPoints);
    this.deletedIndices = [...deletedIndices];
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
