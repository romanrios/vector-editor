import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando que encapsula la conmutación de bloqueo (locked: true/false) de cualquier nodo
 * (Layer, Group o Shape) en el Scene Graph, permitiendo revertir la acción con Undo y Redo.
 */
export class SetLockedCommand implements Command {
  public readonly name: string = 'SetLockedCommand';
  private readonly stateManager: StateManager;
  public readonly nodeId: string;
  public readonly shapeId?: string;
  public readonly previousLocked: boolean;
  public readonly nextLocked: boolean;
  public readonly isAlreadyAtTarget: boolean;

  constructor(stateManager: StateManager, nodeId: string, locked: boolean) {
    this.stateManager = stateManager;
    this.nodeId = nodeId;
    this.shapeId = nodeId;
    this.nextLocked = locked;

    const node = stateManager.findNode(nodeId);
    if (!node) {
      this.previousLocked = false;
      this.isAlreadyAtTarget = true;
      return;
    }

    this.previousLocked = node.locked ?? false;
    this.isAlreadyAtTarget = this.previousLocked === this.nextLocked;
  }

  public execute(): void {
    if (this.isAlreadyAtTarget) {
      return;
    }
    this.stateManager.setNodeLocked(this.nodeId, this.nextLocked);
  }

  public undo(): void {
    if (this.isAlreadyAtTarget) {
      return;
    }
    this.stateManager.setNodeLocked(this.nodeId, this.previousLocked);
  }
}
