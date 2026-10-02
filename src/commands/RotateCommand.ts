import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando que encapsula la rotación de una figura en el Scene Graph,
 * almacenando sus ángulos inicial y final para permitir deshacer (undo) y rehacer (redo).
 */
export class RotateCommand implements Command {
  public readonly name: string = 'RotateCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly initialAngle: number;
  public readonly finalAngle: number;

  public get fromAngle(): number {
    return this.initialAngle;
  }

  public get toAngle(): number {
    return this.finalAngle;
  }

  constructor(
    stateManager: StateManager,
    shapeId: string,
    initialAngle: number,
    finalAngle: number
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.initialAngle = initialAngle;
    this.finalAngle = finalAngle;
  }

  /**
   * Aplica el ángulo de rotación final (rehacer/redo).
   */
  public execute(): void {
    this.stateManager.updateShape(this.shapeId, { rotation: this.finalAngle });
  }

  /**
   * Restaura el ángulo de rotación inicial (deshacer/undo).
   */
  public undo(): void {
    this.stateManager.updateShape(this.shapeId, { rotation: this.initialAngle });
  }
}
