import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Group, SceneNode, SelectableNode } from '../types/scene-graph.ts';

export interface SavedEmptiedGroup {
  readonly group: Group;
  readonly parentId: string;
  readonly originalIndex: number;
}

/**
 * Comando que encapsula la eliminación de una figura o grupo del Scene Graph.
 * Antes de ejecutar, calcula y guarda la cadena de grupos que quedarían vacíos
 * (getEmptiedAncestors). Al deshacer (undo), restaura exactamente los grupos
 * vaciados en su posición original de arriba a abajo y luego el nodo eliminado.
 */
export class DeleteCommand implements Command {
  public readonly name: string = 'DeleteCommand';
  private readonly stateManager: StateManager;
  public readonly shape: SelectableNode;
  public readonly parentId: string;
  public readonly originalIndex: number;
  private readonly savedEmptied: readonly SavedEmptiedGroup[];

  public get shapeId(): string {
    return this.shape.id;
  }

  public get node(): SelectableNode {
    return this.shape;
  }

  public get layerId(): string {
    return this.parentId;
  }

  constructor(
    stateManager: StateManager,
    node: SelectableNode,
    parentId?: string,
    originalIndex?: number
  );
  constructor(
    stateManager: StateManager,
    parentId: string,
    node: SelectableNode,
    originalIndex?: number
  );
  constructor(
    stateManager: StateManager,
    arg2: SelectableNode | string,
    arg3?: string | SelectableNode,
    arg4?: number
  ) {
    this.stateManager = stateManager;

    let targetNode: SelectableNode;
    let targetParentId = '';
    let targetIndex = arg4;

    if (typeof arg2 === 'string') {
      targetParentId = arg2;
      targetNode = arg3 as SelectableNode;
    } else {
      targetNode = arg2;
      targetParentId = typeof arg3 === 'string' ? arg3 : '';
    }

    this.shape = targetNode;

    const parent = this.stateManager.findParent(targetNode.id);
    if (parent && 'children' in parent) {
      if (!targetParentId) {
        targetParentId = parent.id;
      }
      if (targetIndex === undefined || targetIndex === -1) {
        targetIndex = (parent.children as readonly SceneNode[]).findIndex(
          (c) => c.id === targetNode.id
        );
      }
    }

    this.parentId = targetParentId;
    this.originalIndex = targetIndex ?? 0;

    // Calcular y guardar la cadena de grupos que quedarían vacíos al eliminar este nodo
    const emptied = this.stateManager.getEmptiedAncestors([this.shape.id]);
    const saved: SavedEmptiedGroup[] = [];

    for (const group of emptied) {
      const gParent = this.stateManager.findParent(group.id);
      if (gParent && 'children' in gParent) {
        const idx = (gParent.children as readonly SceneNode[]).findIndex((c) => c.id === group.id);
        saved.push({
          group,
          parentId: gParent.id,
          originalIndex: idx,
        });
      }
    }

    this.savedEmptied = Object.freeze(saved);
  }

  /**
   * Elimina el elemento y los grupos que hayan quedado vacíos del Scene Graph.
   */
  public execute(): void {
    this.stateManager.removeFromSelection([this.shape.id]);
    this.stateManager.removeNode(this.shape.id);

    for (let i = 0; i < this.savedEmptied.length; i++) {
      this.stateManager.removeNode(this.savedEmptied[i].group.id);
    }
  }

  /**
   * Restaura los grupos vaciados en su posición original (de arriba a abajo)
   * y reinserta el nodo en su posición exacta, restaurando la selección activa.
   */
  public undo(): void {
    // 1. Restaurar los grupos vaciados desde el ancestro más exterior hacia el más profundo
    for (let i = this.savedEmptied.length - 1; i >= 0; i--) {
      const item = this.savedEmptied[i];
      const emptyGroup: Group = {
        ...item.group,
        children: [],
      };
      this.stateManager.addNode(item.parentId, emptyGroup, item.originalIndex);
    }

    // 2. Restaurar el nodo en su contenedor padre original
    this.stateManager.addNode(this.parentId, this.shape, this.originalIndex);

    // 3. Restaurar la selección sobre el nodo
    this.stateManager.setSelection([this.shape.id]);
  }
}
