import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Path, PathPoint } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la inserción de un nuevo punto de ancla en un segmento de un trazado Bézier,
 * preservando la geometría de la curva mediante subdivisión y permitiendo deshacer y rehacer.
 */
export class InsertPathPointCommand implements Command {
  public readonly name: string = 'InsertPathPointCommand';
  private readonly stateManager: StateManager;
  public readonly pathId: string;
  public readonly initialPoints: readonly PathPoint[];
  public readonly finalPoints: readonly PathPoint[];
  public readonly insertedIndex: number;
  public readonly segmentIndex: number;
  public readonly t: number;

  constructor(
    stateManager: StateManager,
    pathId: string,
    initialPoints: readonly PathPoint[],
    finalPoints: readonly PathPoint[],
    insertedIndex: number,
    segmentIndex: number = 0,
    t: number = 0.5
  ) {
    this.stateManager = stateManager;
    this.pathId = pathId;
    this.initialPoints = structuredClone(initialPoints);
    this.finalPoints = structuredClone(finalPoints);
    this.insertedIndex = insertedIndex;
    this.segmentIndex = segmentIndex;
    this.t = t;
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
