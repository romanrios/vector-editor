import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Artboard } from '../types/scene-graph.ts';

/**
 * Comando reversible para eliminar una Mesa de Trabajo (Artboard) del Scene Graph.
 */
export class DeleteArtboardCommand implements Command {
  public readonly name: string = 'DeleteArtboardCommand';
  private readonly stateManager: StateManager;
  public readonly artboard: Artboard;

  constructor(stateManager: StateManager, artboard: Artboard) {
    this.stateManager = stateManager;
    this.artboard = Object.freeze({ ...artboard });
  }

  public execute(): void {
    this.stateManager.removeArtboard(this.artboard.id);
  }

  public undo(): void {
    this.stateManager.addArtboard(this.artboard);
  }
}
