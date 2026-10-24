import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Artboard } from '../types/scene-graph.ts';

/**
 * Comando reversible para actualizar propiedades (posición, dimensiones, nombre, fondo)
 * de una Mesa de Trabajo específica.
 */
export class UpdateArtboardCommand implements Command {
  public readonly name: string = 'UpdateArtboardCommand';
  private readonly stateManager: StateManager;
  public readonly artboardId: string;
  public readonly before: Partial<Omit<Artboard, 'id'>>;
  public readonly after: Partial<Omit<Artboard, 'id'>>;

  constructor(
    stateManager: StateManager,
    artboardId: string,
    before: Partial<Omit<Artboard, 'id'>>,
    after: Partial<Omit<Artboard, 'id'>>
  ) {
    this.stateManager = stateManager;
    this.artboardId = artboardId;
    this.before = Object.freeze({ ...before });
    this.after = Object.freeze({ ...after });
  }

  public execute(): void {
    this.stateManager.updateArtboard(this.artboardId, this.after);
  }

  public undo(): void {
    this.stateManager.updateArtboard(this.artboardId, this.before);
  }
}
