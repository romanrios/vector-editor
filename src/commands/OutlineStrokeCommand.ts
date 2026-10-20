import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type {
  Group,
  SceneNode,
  SelectableNode,
  Shape,
} from '../types/scene-graph.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import { canOutlineStroke, expandShapeStroke } from '../utils/strokeToPath.ts';
import { generateClonedShapeId } from '../utils/cloneShape.ts';

export interface SavedOriginalNodeEntry {
  readonly shape: Shape;
  readonly parentId: string;
  readonly originalIndex: number;
}

export interface ReplacementNodeEntry {
  readonly node: SelectableNode;
  readonly parentId: string;
  readonly index: number;
}

/**
 * Comando reversible del patrón Command que encapsula la operación de "Contornear trazado"
 * (Stroke to Path / Outline Stroke) para una o múltiples figuras vectoriales seleccionadas.
 */
export class OutlineStrokeCommand implements Command {
  public readonly name: string = 'OutlineStrokeCommand';
  private readonly stateManager: StateManager;
  public readonly selectedNodes: readonly SelectableNode[];
  public readonly replacementEntries: readonly ReplacementNodeEntry[];
  private readonly savedOriginals: readonly SavedOriginalNodeEntry[];
  private readonly previousSelection: readonly string[];
  private readonly newSelection: readonly string[];

  constructor(
    stateManager: StateManager,
    selectedNodes: readonly SelectableNode[]
  ) {
    this.stateManager = stateManager;
    this.selectedNodes = selectedNodes;
    this.previousSelection = [...this.stateManager.getSelection()];

    const leafShapes = getLeafShapes(selectedNodes);
    const targetShapes = leafShapes.filter(canOutlineStroke);

    if (targetShapes.length === 0) {
      throw new Error('[OutlineStrokeCommand] No hay figuras seleccionadas con borde susceptible de contornear.');
    }

    const saved: SavedOriginalNodeEntry[] = [];
    const replacements: ReplacementNodeEntry[] = [];
    const newSelectedIds: string[] = [];

    for (const shape of targetShapes) {
      const parent = this.stateManager.findParent(shape.id);
      if (!parent || !('children' in parent)) {
        continue;
      }

      const idx = (parent.children as readonly SceneNode[]).findIndex((c) => c.id === shape.id);
      const safeIndex = idx >= 0 ? idx : 0;

      saved.push({
        shape,
        parentId: parent.id,
        originalIndex: safeIndex,
      });

      const expanded = expandShapeStroke(shape);
      if (!expanded) continue;

      if (expanded.fillShape) {
        // La figura original tenía relleno: agrupar la figura de relleno (sin borde) con el trazado contorneado
        const groupId = generateClonedShapeId('group');
        const group: Group = {
          id: groupId,
          type: 'group',
          name: `Grupo (${shape.name})`,
          children: [expanded.fillShape, ...expanded.strokeShapes],
        };
        replacements.push({
          node: group,
          parentId: parent.id,
          index: safeIndex,
        });
        newSelectedIds.push(groupId);
      } else {
        // La figura original solo tenía borde
        if (expanded.strokeShapes.length === 1) {
          const singlePath = expanded.strokeShapes[0];
          replacements.push({
            node: singlePath,
            parentId: parent.id,
            index: safeIndex,
          });
          newSelectedIds.push(singlePath.id);
        } else {
          // Múltiples figuras (ej. trazo discontinuo / punteado): agruparlas para mantener orden
          const groupId = generateClonedShapeId('group');
          const group: Group = {
            id: groupId,
            type: 'group',
            name: `Grupo (${shape.name} contorneado)`,
            children: expanded.strokeShapes,
          };
          replacements.push({
            node: group,
            parentId: parent.id,
            index: safeIndex,
          });
          newSelectedIds.push(groupId);
        }
      }
    }

    this.savedOriginals = Object.freeze(saved);
    this.replacementEntries = Object.freeze(replacements);
    this.newSelection = Object.freeze(newSelectedIds);
  }

  public execute(): void {
    // 1. Limpiar selección
    this.stateManager.setSelection([]);

    // 2. Eliminar figuras originales
    for (const entry of this.savedOriginals) {
      this.stateManager.removeNode(entry.shape.id);
    }

    // 3. Insertar figuras de reemplazo en sus respectivos padres
    for (const rep of this.replacementEntries) {
      this.stateManager.addNode(rep.parentId, rep.node, rep.index);
    }

    // 4. Seleccionar las nuevas figuras creadas
    this.stateManager.setSelection(this.newSelection);
    this.stateManager.markDirty();
  }

  public undo(): void {
    // 1. Eliminar figuras de reemplazo
    for (const rep of this.replacementEntries) {
      this.stateManager.removeNode(rep.node.id);
    }

    // 2. Restaurar figuras originales en orden ascendente por padre
    const byParent = new Map<string, SavedOriginalNodeEntry[]>();
    for (const item of this.savedOriginals) {
      if (!byParent.has(item.parentId)) {
        byParent.set(item.parentId, []);
      }
      byParent.get(item.parentId)!.push(item);
    }

    for (const [, items] of byParent) {
      items.sort((a, b) => a.originalIndex - b.originalIndex);
      for (const item of items) {
        this.stateManager.addNode(item.parentId, item.shape, item.originalIndex);
      }
    }

    // 3. Restaurar selección previa
    this.stateManager.setSelection(this.previousSelection);
    this.stateManager.markDirty();
  }

  public redo(): void {
    this.execute();
  }
}
