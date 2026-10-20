import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import { isGroup, type Group, type SceneNode } from '../types/scene-graph.ts';

export interface SavedReleaseClipData {
  readonly group: Group;
  readonly parentId: string;
  readonly groupIndex: number;
}

/**
 * Comando que libera (suelta) una o varias máscaras de recorte seleccionadas.
 *
 * En diseño vectorial (Illustrator):
 * - Los elementos contenidos dentro de la máscara y la figura que actuaba como máscara
 *   son desarmados del grupo y reinsertados en el contenedor padre conservando su orden.
 * - Al deshacer (undo), se reconstituye el grupo de máscara de recorte original.
 */
export class ReleaseClipMaskCommand implements Command {
  public readonly name: string = 'ReleaseClipMaskCommand';
  private readonly stateManager: StateManager;
  public readonly groups: readonly Group[];
  private readonly savedGroups: readonly SavedReleaseClipData[];
  private readonly childIdsToSelect: readonly string[];
  private readonly previousSelection: readonly string[];

  constructor(stateManager: StateManager, groups?: Group | readonly Group[]) {
    this.stateManager = stateManager;

    let targetGroups: readonly Group[];
    if (groups) {
      targetGroups = Array.isArray(groups) ? groups : [groups as Group];
    } else {
      targetGroups = this.stateManager.getSelectedNodes().filter(isGroup).filter((g) => g.isClipMask === true);
    }

    if (!targetGroups || targetGroups.length === 0) {
      throw new Error('[ReleaseClipMaskCommand] No se especificaron máscaras de recorte válidas para soltar.');
    }

    this.groups = targetGroups;
    this.previousSelection = [...this.stateManager.getSelection()];

    const savedList: SavedReleaseClipData[] = [];
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

  public execute(): void {
    // Ordenar de mayor a menor índice para no alterar los índices durante la eliminación
    const sorted = [...this.savedGroups].sort((a, b) => b.groupIndex - a.groupIndex);

    for (const item of sorted) {
      // 1. Retirar el grupo de máscara de recorte
      this.stateManager.removeNode(item.group.id);

      // 2. Insertar cada hijo en el padre comenzando desde groupIndex
      for (let i = 0; i < item.group.children.length; i++) {
        this.stateManager.addNode(item.parentId, item.group.children[i], item.groupIndex + i);
      }
    }

    // 3. Dejar los elementos liberados seleccionados
    this.stateManager.setSelection(this.childIdsToSelect);
  }

  public undo(): void {
    // 1. Retirar todos los hijos liberados
    for (const id of this.childIdsToSelect) {
      this.stateManager.removeNode(id);
    }

    // 2. Reinsertar los grupos de máscara de recorte en orden ascendente
    const sortedAsc = [...this.savedGroups].sort((a, b) => a.groupIndex - b.groupIndex);
    for (const item of sortedAsc) {
      this.stateManager.addNode(item.parentId, item.group, item.groupIndex);
    }

    // 3. Restaurar la selección previa
    this.stateManager.setSelection(this.previousSelection);
  }
}
