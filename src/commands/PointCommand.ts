import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Path, PathPoint } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la modificación de la matriz de puntos (vértices y manejadores)
 * de un Path en el Scene Graph, permitiendo deshacer (undo) y rehacer (redo).
 */
export class PointCommand implements Command {
  public readonly name: string = 'PointCommand';
  private readonly stateManager: StateManager;
  public readonly pathId: string;
  public readonly initialPoints: readonly PathPoint[];
  public readonly finalPoints: readonly PathPoint[];

  public get shapeId(): string {
    return this.pathId;
  }

  public get fromPoints(): readonly PathPoint[] {
    return this.initialPoints;
  }

  public get toPoints(): readonly PathPoint[] {
    return this.finalPoints;
  }

  constructor(
    stateManager: StateManager,
    pathId: string,
    initialPoints: readonly PathPoint[],
    finalPoints: readonly PathPoint[]
  ) {
    this.stateManager = stateManager;
    this.pathId = pathId;
    this.initialPoints = structuredClone(initialPoints);
    this.finalPoints = structuredClone(finalPoints);
  }

  /**
   * Aplica la nueva matriz de puntos (rehacer/redo).
   */
  public execute(): void {
    this.stateManager.updateShape<Path>(this.pathId, { points: this.finalPoints });
  }

  /**
   * Restaura la matriz de puntos original (deshacer/undo).
   */
  public undo(): void {
    this.stateManager.updateShape<Path>(this.pathId, { points: this.initialPoints });
  }
}
