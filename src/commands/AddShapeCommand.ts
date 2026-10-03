import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Shape } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la adición de una figura al Scene Graph,
 * permitiendo ejecutar (execute), deshacer (undo) y rehacer (redo)
 * sin duplicar figuras.
 */
export class AddShapeCommand implements Command {
  public readonly name: string = 'AddShapeCommand';
  private readonly stateManager: StateManager;
  public readonly shape: Shape;
  public readonly layerId: string;
  public readonly index?: number;

  constructor(stateManager: StateManager, shape: Shape, layerId: string, index?: number);
  constructor(stateManager: StateManager, layerId: string, shape: Shape, index?: number);
  constructor(
    stateManager: StateManager,
    arg2: Shape | string,
    arg3: string | Shape,
    index?: number
  ) {
    this.stateManager = stateManager;
    this.index = index;
    if (typeof arg2 === 'string') {
      this.layerId = arg2;
      this.shape = arg3 as Shape;
    } else {
      this.shape = arg2;
      this.layerId = arg3 as string;
    }
  }

  /**
   * Añade la figura a la capa indicada si no se encuentra ya en el Scene Graph.
   */
  public execute(): void {
    if (!this.stateManager.findNode(this.shape.id)) {
      this.stateManager.addShape(this.layerId, this.shape, this.index);
    }
  }

  /**
   * Elimina la figura y, si estaba seleccionada, la deselecciona.
   */
  public undo(): void {
    const selected = this.stateManager.getSelectedNode();
    if (selected && selected.id === this.shape.id) {
      this.stateManager.selectNode(null);
    }
    this.stateManager.removeShape(this.shape.id);
  }
}
