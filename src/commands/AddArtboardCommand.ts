import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Artboard } from '../types/scene-graph.ts';

/**
 * Comando reversible para agregar una nueva Mesa de Trabajo (Artboard) al Scene Graph.
 */
export class AddArtboardCommand implements Command {
  public readonly name: string = 'AddArtboardCommand';
  private readonly stateManager: StateManager;
  public readonly artboard: Artboard;

  constructor(stateManager: StateManager, artboard: Artboard) {
    this.stateManager = stateManager;
    this.artboard = Object.freeze({ ...artboard });
  }

  public execute(): void {
    this.stateManager.addArtboard(this.artboard);
  }

  public undo(): void {
    this.stateManager.removeArtboard(this.artboard.id);
  }
}
