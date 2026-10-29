import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text, Group, Layer } from '../types/scene-graph.ts';

/**
 * Comando para convertir un nodo tipográfico Text en un Group de figuras vectoriales Path
 * con soporte completo para historial Undo/Redo.
 */
export class ConvertTextToCurvesCommand implements Command {
  public readonly name = 'ConvertTextToCurvesCommand';
  private readonly stateManager: StateManager;
  private readonly textNode: Text;
  private readonly groupNode: Group;
  private readonly parentId: string;
  private readonly index: number;

  constructor(
    stateManager: StateManager,
    textNode: Text,
    groupNode: Group,
    parentId?: string,
    index?: number
  ) {
    this.stateManager = stateManager;
    this.textNode = textNode;
    this.groupNode = groupNode;

    if (parentId !== undefined && index !== undefined) {
      this.parentId = parentId;
      this.index = index;
    } else {
      const parent = stateManager.findParent(textNode.id);
      if (!parent) {
        throw new Error(`[ConvertTextToCurvesCommand] Nodo ${textNode.id} no tiene contenedor padre.`);
      }
      this.parentId = parent.id;
      const childList = (parent as Layer | Group).children;
      const idx = childList.findIndex((c) => c.id === textNode.id);
      this.index = idx !== -1 ? idx : childList.length;
    }
  }

  public execute(): void {
    this.stateManager.removeNode(this.textNode.id);
    this.stateManager.addNode(this.parentId, this.groupNode, this.index);
    this.stateManager.setSelection([this.groupNode.id]);
  }

  public undo(): void {
    this.stateManager.removeNode(this.groupNode.id);
    this.stateManager.addNode(this.parentId, this.textNode, this.index);
    this.stateManager.setSelection([this.textNode.id]);
  }
}

