import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import { isGroup, type Group, type SceneNode } from '../types/scene-graph.ts';

export interface SavedUngroupData {
  readonly group: Group;
  readonly parentId: string;
  readonly groupIndex: number;
}

/**
 * Comando que disuelve uno o varios grupos (únicamente a un nivel de profundidad).
 * Los hijos de cada grupo pasan a su respectivo contenedor padre, en la posición exacta
 * del grupo disuelto y conservando su orden relativo, quedando seleccionados.
 * Al deshacer (undo), reconstruye los grupos con sus propiedades e índices originales.
 */
export class UngroupCommand implements Command {
  public readonly name: string = 'UngroupCommand';
  private readonly stateManager: StateManager;
  public readonly groups: readonly Group[];
  private readonly savedGroups: readonly SavedUngroupData[];
  private readonly childIdsToSelect: readonly string[];
  private readonly previousSelection: readonly string[];

  constructor(stateManager: StateManager, groups?: Group | readonly Group[]) {
    this.stateManager = stateManager;

    let targetGroups: readonly Group[];
    if (groups) {
      targetGroups = Array.isArray(groups) ? groups : [groups as Group];
    } else {
      targetGroups = this.stateManager.getSelectedNodes().filter(isGroup);
    }

    if (!targetGroups || targetGroups.length === 0) {
      throw new Error('[UngroupCommand] No se especificaron grupos válidos para desagrupar.');
    }

    this.groups = targetGroups;
    this.previousSelection = [...this.stateManager.getSelection()];

    const savedList: SavedUngroupData[] = [];
    const childIds: string[] = [];

    for (const group of targetGroups) {
      const parent = this.stateManager.findParent(group.id);
      if (!parent || !('children' in parent)) {
        continue;
      }

      const parentChildren = parent.children as readonly SceneNode[];
      const groupIndex = parentChildren.findIndex((c) => c.id === group.id);
      if (groupIndex === -1) {
        continue;
      }

      savedList.push({
        group,
        parentId: parent.id,
        groupIndex,
      });

      for (const child of group.children) {
        childIds.push(child.id);
      }
    }

    this.savedGroups = Object.freeze(savedList);
    this.childIdsToSelect = Object.freeze(childIds);
  }

  /**
   * Disuelve los grupos seleccionados: remueve cada grupo e inserta sus hijos
   * en la posición que ocupaba en su contenedor padre, dejando los hijos seleccionados.
   */
  public execute(): void {
    // Agrupar por parentId y ordenar de mayor a menor índice para no alterar los índices pendientes
    const byParent = new Map<string, SavedUngroupData[]>();
    for (const item of this.savedGroups) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    }

    for (const [parentId, items] of byParent.entries()) {
      // Orden descendente por groupIndex
      items.sort((a, b) => b.groupIndex - a.groupIndex);

      for (const item of items) {
        this.stateManager.removeNode(item.group.id);
        for (let i = 0; i < item.group.children.length; i++) {
          this.stateManager.addNode(parentId, item.group.children[i], item.groupIndex + i);
        }
      }
    }

    // Seleccionar todos los hijos directos de los grupos disueltos
    this.stateManager.setSelection(this.childIdsToSelect);
  }

  /**
   * Deshace la operación: retira los hijos y reinserta los grupos reconstruidos
   * en sus posiciones originales, restaurando la selección previa.
   */
  public undo(): void {
    // 1. Retirar todos los hijos del Scene Graph
    for (const item of this.savedGroups) {
      for (const child of item.group.children) {
        this.stateManager.removeNode(child.id);
      }
    }

    // 2. Reinsertar los grupos en orden ascendente por groupIndex dentro de cada padre
    const byParent = new Map<string, SavedUngroupData[]>();
    for (const item of this.savedGroups) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    }

    for (const [parentId, items] of byParent.entries()) {
      items.sort((a, b) => a.groupIndex - b.groupIndex);

      for (const item of items) {
        this.stateManager.addNode(parentId, item.group, item.groupIndex);
      }
    }

    // 3. Restaurar la selección anterior
    this.stateManager.setSelection(this.previousSelection);
  }
}
