import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Guide } from '../types/scene-graph.ts';

/**
 * Comando que encapsula el borrado de todas las guías de usuario del documento.
 */
export class ClearGuidesCommand implements Command {
  public readonly name: string = 'ClearGuidesCommand';
  private readonly stateManager: StateManager;
  public readonly previousGuides: readonly Guide[];

  constructor(stateManager: StateManager, previousGuides: readonly Guide[]) {
    this.stateManager = stateManager;
    this.previousGuides = Object.freeze([...previousGuides]);
  }

  public execute(): void {
    this.stateManager.clearGuides();
  }

  public undo(): void {
    this.stateManager.setGuides(this.previousGuides);
  }
}
