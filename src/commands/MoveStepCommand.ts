import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import { isDocument, isGroup, isLayer } from '../types/scene-graph.ts';

export type StepDirection = 'up' | 'down';

/**
 * Comando para subir o bajar un paso el orden de apilado (z-order) de un nodo
 * (capa, grupo o figura) dentro de su contenedor padre.
 * 'up' = hacia el frente (incrementa índice de apilamiento).
 * 'down' = hacia el fondo (decrementa índice de apilamiento).
 */
export class MoveStepCommand implements Command {
  public readonly name: string = 'MoveStepCommand';
  private readonly stateManager: StateManager;
  public readonly nodeId: string;
  public readonly shapeId?: string;
  public readonly direction: StepDirection;
  public readonly parentId: string;
  public readonly fromIndex: number;
  public readonly toIndex: number;
  public readonly isAlreadyAtTarget: boolean;

  constructor(stateManager: StateManager, nodeId: string, direction: StepDirection) {
    this.stateManager = stateManager;
    this.nodeId = nodeId;
    this.shapeId = nodeId;
    this.direction = direction;

    const parent = this.stateManager.findParent(nodeId);
    if (!parent) {
      this.parentId = '';
      this.fromIndex = -1;
      this.toIndex = -1;
      this.isAlreadyAtTarget = true;
      return;
    }

    this.parentId = parent.id;
    let children: readonly { id: string }[] = [];
    if (isDocument(parent)) {
      children = parent.children;
    } else if (isLayer(parent) || isGroup(parent)) {
      children = parent.children;
    }

    const currentIndex = children.findIndex((c) => c.id === nodeId);
    if (currentIndex === -1) {
      this.fromIndex = -1;
      this.toIndex = -1;
      this.isAlreadyAtTarget = true;
      return;
    }

    this.fromIndex = currentIndex;
    const target = direction === 'up' ? currentIndex + 1 : currentIndex - 1;

    if (target < 0 || target >= children.length) {
      this.toIndex = currentIndex;
      this.isAlreadyAtTarget = true;
    } else {
      this.toIndex = target;
      this.isAlreadyAtTarget = false;
    }
  }

  public execute(): void {
    if (this.isAlreadyAtTarget || !this.parentId) {
      return;
    }
    this.stateManager.reorderNodes(this.parentId, this.fromIndex, this.toIndex);
  }

  public undo(): void {
    if (this.isAlreadyAtTarget || !this.parentId) {
      return;
    }
    this.stateManager.reorderNodes(this.parentId, this.toIndex, this.fromIndex);
  }
}
