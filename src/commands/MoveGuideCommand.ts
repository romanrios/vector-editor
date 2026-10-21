import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando que encapsula el desplazamiento o cambio de posición de una guía de usuario.
 */
export class MoveGuideCommand implements Command {
  public readonly name: string = 'MoveGuideCommand';
  private readonly stateManager: StateManager;
  public readonly guideId: string;
  public readonly oldPosition: number;
  public readonly newPosition: number;

  constructor(stateManager: StateManager, guideId: string, oldPosition: number, newPosition: number) {
    this.stateManager = stateManager;
    this.guideId = guideId;
    this.oldPosition = oldPosition;
    this.newPosition = newPosition;
  }

  public execute(): void {
    this.stateManager.updateGuide(this.guideId, this.newPosition);
  }

  public undo(): void {
    this.stateManager.updateGuide(this.guideId, this.oldPosition);
  }
}
