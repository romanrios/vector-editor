import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Shape } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la eliminación de una figura del Scene Graph,
 * permitiendo deshacer (undo) y restaurarla en su capa contenedora original.
 */
export class DeleteCommand implements Command {
  public readonly name: string = 'DeleteCommand';
  private readonly stateManager: StateManager;
  public readonly shape: Shape;
  public readonly layerId: string;

  constructor(stateManager: StateManager, shape: Shape, layerId: string);
  constructor(stateManager: StateManager, layerId: string, shape: Shape);
  constructor(
    stateManager: StateManager,
    arg2: Shape | string,
    arg3: string | Shape
  ) {
    this.stateManager = stateManager;
    if (typeof arg2 === 'string') {
      this.layerId = arg2;
      this.shape = arg3 as Shape;
    } else {
      this.shape = arg2;
      this.layerId = arg3 as string;
    }
  }

  /**
   * Elimina la figura del Scene Graph.
   */
  public execute(): void {
    this.stateManager.removeShape(this.shape.id);
  }

  /**
   * Restaura la figura en su capa contenedora original.
   */
  public undo(): void {
    this.stateManager.addShape(this.layerId, this.shape);
  }
}
