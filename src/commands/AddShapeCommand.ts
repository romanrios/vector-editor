import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { SelectableNode } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la adición de una figura o grupo al Scene Graph
 * dentro de una capa o grupo contenedor (parentId), permitiendo ejecutar (execute),
 * deshacer (undo) y rehacer (redo) sin duplicar elementos.
 */
export class AddShapeCommand implements Command {
  public readonly name: string = 'AddShapeCommand';
  private readonly stateManager: StateManager;
  public readonly shape: SelectableNode;
  public readonly parentId: string;
  public readonly layerId: string;
  public readonly index?: number;

  public get shapeId(): string {
    return this.shape.id;
  }

  public get node(): SelectableNode {
    return this.shape;
  }

  constructor(
    stateManager: StateManager,
    shape: SelectableNode,
    parentId: string,
    index?: number
  );
  constructor(
    stateManager: StateManager,
    parentId: string,
    shape: SelectableNode,
    index?: number
  );
  constructor(
    stateManager: StateManager,
    arg2: SelectableNode | string,
    arg3: string | SelectableNode,
    index?: number
  ) {
    this.stateManager = stateManager;
    this.index = index;
    if (typeof arg2 === 'string') {
      this.parentId = arg2;
      this.layerId = arg2;
      this.shape = arg3 as SelectableNode;
    } else {
      this.shape = arg2;
      this.parentId = arg3 as string;
      this.layerId = arg3 as string;
    }
  }

  /**
   * Añade el elemento al contenedor padre indicado si no se encuentra ya en el Scene Graph.
   */
  public execute(): void {
    if (!this.stateManager.findNode(this.shape.id)) {
      this.stateManager.addNode(this.parentId, this.shape, this.index);
    }
  }

  /**
   * Elimina el elemento y, si estaba seleccionado, lo remueve de la selección activa.
   */
  public undo(): void {
    this.stateManager.removeFromSelection([this.shape.id]);
    this.stateManager.removeNode(this.shape.id);
  }
}
