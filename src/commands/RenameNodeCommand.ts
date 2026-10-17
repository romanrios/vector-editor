import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando para renombrar un nodo (Layer, Group o Shape) en el Scene Graph.
 * Totalmente reversible con Undo y Redo.
 */
export class RenameNodeCommand implements Command {
  public readonly name: string = 'RenameNodeCommand';
  private readonly stateManager: StateManager;
  public readonly nodeId: string;
  public readonly oldName: string;
  public readonly newName: string;
  public readonly isAlreadyAtTarget: boolean;

  constructor(stateManager: StateManager, nodeId: string, newName: string) {
    this.stateManager = stateManager;
    this.nodeId = nodeId;
    this.newName = newName.trim();

    const node = stateManager.findNode(nodeId);
    this.oldName = node?.name ?? '';

    this.isAlreadyAtTarget = !node || !this.newName || this.oldName === this.newName;
  }

  public execute(): void {
    if (this.isAlreadyAtTarget) {
      return;
    }
    this.stateManager.setNodeName(this.nodeId, this.newName);
  }

  public undo(): void {
    if (this.isAlreadyAtTarget) {
      return;
    }
    this.stateManager.setNodeName(this.nodeId, this.oldName);
  }

  public redo(): void {
    this.execute();
  }
}
