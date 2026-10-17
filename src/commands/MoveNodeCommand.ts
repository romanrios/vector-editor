import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import {
  isDocument,
  isGroup,
  isLayer,
  isSelectable,
  type Layer,
  type LayerChildNode,
  type ParentNode,
  type SceneNode,
  type SelectableNode,
} from '../types/scene-graph.ts';

/**
 * Comando reversible para mover un nodo (Capa, Grupo o Figura) a una nueva posición
 * y opcionalmente a un nuevo contenedor padre.
 */
export class MoveNodeCommand implements Command {
  public readonly name: string = 'MoveNodeCommand';
  private readonly stateManager: StateManager;
  public readonly nodeId: string;
  public readonly sourceParentId: string;
  public readonly targetParentId: string;
  public readonly sourceIndex: number;
  public readonly targetIndex: number;
  public readonly isAlreadyAtTarget: boolean;
  private readonly node: Layer | LayerChildNode;

  constructor(
    stateManager: StateManager,
    nodeId: string,
    targetParentId: string,
    targetIndex: number
  ) {
    this.stateManager = stateManager;
    this.nodeId = nodeId;

    const node = this.stateManager.findNode(nodeId);
    const sourceParent = this.stateManager.findParent(nodeId);

    if (!node || !sourceParent || !('children' in sourceParent)) {
      this.node = {} as any;
      this.sourceParentId = '';
      this.targetParentId = '';
      this.sourceIndex = -1;
      this.targetIndex = -1;
      this.isAlreadyAtTarget = true;
      return;
    }

    this.node = node as Layer | LayerChildNode;
    this.sourceParentId = sourceParent.id;
    this.targetParentId = targetParentId;

    const sourceChildren = sourceParent.children as readonly SceneNode[];
    this.sourceIndex = sourceChildren.findIndex((c) => c.id === nodeId);

    const targetParent = this.stateManager.findNode(targetParentId);
    if (!targetParent || !('children' in targetParent)) {
      this.targetIndex = -1;
      this.isAlreadyAtTarget = true;
      return;
    }

    // Validación 1: Un Layer solo puede pertenecer al Document raíz
    if (isLayer(this.node)) {
      if (!isDocument(targetParent)) {
        this.targetIndex = -1;
        this.isAlreadyAtTarget = true;
        return;
      }
    }

    // Validación 2: Un Shape o Group solo puede pertenecer a un Layer o Group (no al Document directamente)
    if (isSelectable(this.node)) {
      if (isDocument(targetParent)) {
        this.targetIndex = -1;
        this.isAlreadyAtTarget = true;
        return;
      }
    }

    // Validación 3: No se puede mover un nodo dentro de sí mismo o dentro de sus descendientes
    if (this.nodeId === targetParentId) {
      this.targetIndex = -1;
      this.isAlreadyAtTarget = true;
      return;
    }

    if (isGroup(this.node)) {
      const isDescendant = (parent: SceneNode, searchId: string): boolean => {
        if ('children' in parent && Array.isArray((parent as any).children)) {
          for (const child of (parent as any).children) {
            if (child.id === searchId || isDescendant(child, searchId)) {
              return true;
            }
          }
        }
        return false;
      };
      if (isDescendant(this.node, targetParentId)) {
        this.targetIndex = -1;
        this.isAlreadyAtTarget = true;
        return;
      }
    }

    // Validación 4: Profundidad máxima de 32 niveles
    if (isGroup(targetParent)) {
      function getNodeSubtreeDepth(n: SelectableNode): number {
        if (!isGroup(n)) return 1;
        let maxChild = 0;
        for (const child of n.children) {
          maxChild = Math.max(maxChild, getNodeSubtreeDepth(child));
        }
        return 1 + maxChild;
      }

      let parentDepth = 0;
      let curr: ParentNode | null = targetParent;
      while (curr) {
        if (isGroup(curr)) {
          parentDepth++;
        }
        curr = this.stateManager.findParent(curr.id);
      }

      const subtreeDepth = getNodeSubtreeDepth(this.node as SelectableNode);
      if (parentDepth + subtreeDepth > 32) {
        this.targetIndex = -1;
        this.isAlreadyAtTarget = true;
        return;
      }
    }

    const targetChildren = targetParent.children as readonly SceneNode[];
    if (this.sourceParentId === this.targetParentId) {
      const clamped = Math.max(0, Math.min(targetChildren.length - 1, targetIndex));
      this.targetIndex = clamped;
      this.isAlreadyAtTarget = clamped === this.sourceIndex;
    } else {
      const clamped = Math.max(0, Math.min(targetChildren.length, targetIndex));
      this.targetIndex = clamped;
      this.isAlreadyAtTarget = false;
    }
  }

  public execute(): void {
    if (this.isAlreadyAtTarget || !this.targetParentId || !this.sourceParentId) {
      return;
    }
    this.stateManager.moveNode(this.nodeId, this.targetParentId, this.targetIndex);
  }

  public undo(): void {
    if (this.isAlreadyAtTarget || !this.targetParentId || !this.sourceParentId) {
      return;
    }
    this.stateManager.moveNode(this.nodeId, this.sourceParentId, this.sourceIndex);
  }
}
