import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando que encapsula la conmutación de visibilidad (visible: true/false) de cualquier nodo
 * (Layer, Group o Shape) en el Scene Graph, permitiendo revertir la acción con Undo y Redo.
 */
export class SetVisibilityCommand implements Command {
  public readonly name: string = 'SetVisibilityCommand';
  private readonly stateManager: StateManager;
  public readonly nodeId: string;
  public readonly shapeId?: string;
  public readonly previousVisible: boolean;
  public readonly nextVisible: boolean;
  public readonly isAlreadyAtTarget: boolean;

  constructor(stateManager: StateManager, nodeId: string, visible: boolean) {
    this.stateManager = stateManager;
    this.nodeId = nodeId;
    this.shapeId = nodeId;
    this.nextVisible = visible;

    const node = stateManager.findNode(nodeId);
    if (!node) {
      this.previousVisible = true;
      this.isAlreadyAtTarget = true;
      return;
    }

    this.previousVisible = node.visible ?? true;
    this.isAlreadyAtTarget = this.previousVisible === this.nextVisible;
  }

  public execute(): void {
    if (this.isAlreadyAtTarget) {
      return;
    }
    this.stateManager.setNodeVisibility(this.nodeId, this.nextVisible);
  }

  public undo(): void {
    if (this.isAlreadyAtTarget) {
      return;
    }
    this.stateManager.setNodeVisibility(this.nodeId, this.previousVisible);
  }
}
