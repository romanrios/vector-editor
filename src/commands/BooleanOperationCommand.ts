import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import {
  isGroup,
  type Document,
  type Group,
  type Layer,
  type Path,
  type SceneNode,
  type SelectableNode,
} from '../types/scene-graph.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import {
  executeBooleanOperation,
  isClosedShape,
  type BooleanOp,
} from '../utils/booleanOperations.ts';

export interface SavedNodeEntry {
  readonly node: SelectableNode;
  readonly parentId: string;
  readonly originalIndex: number;
}

export interface SavedEmptiedGroupEntry {
  readonly group: Group;
  readonly parentId: string;
  readonly originalIndex: number;
}

/**
 * Recorre recursivamente el Documento para construir un mapa del orden global de apilado (z-stacking).
 * Los nodos visitados antes tienen menor índice (están más al fondo).
 */
function getDocumentTraversalOrder(doc: Document): Map<string, number> {
  const order = new Map<string, number>();
  let index = 0;

  function traverse(container: Document | Layer | Group): void {
    for (const child of container.children) {
      order.set(child.id, index++);
      if (isGroup(child)) {
        traverse(child);
      }
    }
  }

  traverse(doc);
  return order;
}

/**
 * Comando reversible que encapsula la ejecución de una Operación Booleana (Pathfinder)
 * entre dos o más figuras cerradas seleccionadas en el Scene Graph.
 */
export class BooleanOperationCommand implements Command {
  public readonly name: string = 'BooleanOperationCommand';
  private readonly stateManager: StateManager;
  public readonly op: BooleanOp;
  public readonly selectedNodes: readonly SelectableNode[];
  public readonly createdShapes: readonly Path[];
  public readonly targetParentId: string;
  public readonly targetIndex: number;
  private readonly savedNodes: readonly SavedNodeEntry[];
  private readonly savedEmptied: readonly SavedEmptiedGroupEntry[];
  private readonly previousSelection: readonly string[];

  constructor(
    stateManager: StateManager,
    op: BooleanOp,
    selectedNodes: readonly SelectableNode[]
  ) {
    this.stateManager = stateManager;
    this.op = op;
    this.selectedNodes = selectedNodes;
    this.previousSelection = [...this.stateManager.getSelection()];

    const docState = this.stateManager.getState();
    const traversalOrder = getDocumentTraversalOrder(docState);

    // Obtener las figuras hoja cerradas ordenadas por z-order global
    const leafShapes = getLeafShapes(selectedNodes);
    const closedLeafShapes = leafShapes
      .filter(isClosedShape)
      .sort((a, b) => (traversalOrder.get(a.id) ?? 0) - (traversalOrder.get(b.id) ?? 0));

    if (closedLeafShapes.length < 2) {
      throw new Error('[BooleanOperationCommand] Se requieren al menos 2 figuras cerradas para operar.');
    }

    // La figura base es la que tiene menor z-order (la más al fondo)
    const baseShape = closedLeafShapes[0];

    // Computar las nuevas figuras resultantes
    this.createdShapes = Object.freeze(executeBooleanOperation(op, closedLeafShapes));

    // Determinar la ubicación de inserción en el contenedor de la figura base
    let targetParent = this.stateManager.findParent(baseShape.id);
    if (!targetParent) {
      throw new Error(`[BooleanOperationCommand] No se encontró el padre de la figura base "${baseShape.id}".`);
    }

    const selectedIds = selectedNodes.map((n) => n.id);
    const selectedIdSet = new Set(selectedIds);
    const emptiedGroups = this.stateManager.getEmptiedAncestors(selectedIds);
    const emptiedSet = new Set(emptiedGroups.map((g) => g.id));
    const isRemovingContainer = (id: string) => selectedIdSet.has(id) || emptiedSet.has(id);

    let referenceNodeId = baseShape.id;
    while (isRemovingContainer(targetParent.id)) {
      const ancestorParent = this.stateManager.findParent(targetParent.id);
      if (!ancestorParent) break;
      referenceNodeId = targetParent.id;
      targetParent = ancestorParent;
    }

    this.targetParentId = targetParent.id;

    const targetChildren = 'children' in targetParent ? (targetParent.children as readonly SceneNode[]) : [];
    const refIdx = targetChildren.findIndex((c) => c.id === referenceNodeId);
    let calculatedIndex = 0;
    for (let i = 0; i < refIdx; i++) {
      const childId = targetChildren[i].id;
      if (!selectedIdSet.has(childId) && !emptiedSet.has(childId)) {
        calculatedIndex++;
      }
    }
    this.targetIndex = calculatedIndex;

    // Guardar estado original de todos los nodos seleccionados
    const saved: SavedNodeEntry[] = [];
    for (const node of selectedNodes) {
      const parent = this.stateManager.findParent(node.id);
      if (parent && 'children' in parent) {
        const idx = (parent.children as readonly SceneNode[]).findIndex((c) => c.id === node.id);
        saved.push({
          node,
          parentId: parent.id,
          originalIndex: idx >= 0 ? idx : 0,
        });
      }
    }
    this.savedNodes = Object.freeze(saved);

    // Guardar grupos vaciados
    const savedEmptiedList: SavedEmptiedGroupEntry[] = [];
    for (const group of emptiedGroups) {
      const gParent = this.stateManager.findParent(group.id);
      if (gParent && 'children' in gParent) {
        const idx = (gParent.children as readonly SceneNode[]).findIndex((c) => c.id === group.id);
        savedEmptiedList.push({
          group,
          parentId: gParent.id,
          originalIndex: idx >= 0 ? idx : 0,
        });
      }
    }
    this.savedEmptied = Object.freeze(savedEmptiedList);
  }

  public execute(): void {
    // 1. Quitar selección previa
    this.stateManager.setSelection([]);

    // 2. Eliminar nodos seleccionados originales
    for (const node of this.selectedNodes) {
      this.stateManager.removeNode(node.id);
    }

    // 3. Eliminar grupos que hayan quedado vacíos
    for (const item of this.savedEmptied) {
      this.stateManager.removeNode(item.group.id);
    }

    // 4. Insertar las nuevas figuras resultantes en la posición de la figura base
    for (let i = 0; i < this.createdShapes.length; i++) {
      this.stateManager.addNode(this.targetParentId, this.createdShapes[i], this.targetIndex + i);
    }

    // 5. Seleccionar automáticamente las nuevas figuras generadas
    const newIds = this.createdShapes.map((s) => s.id);
    this.stateManager.setSelection(newIds);
    this.stateManager.markDirty();
  }

  public undo(): void {
    // 1. Eliminar figuras resultantes
    for (const shape of this.createdShapes) {
      this.stateManager.removeNode(shape.id);
    }

    // 2. Restaurar grupos vaciados de exterior a interior
    for (let i = this.savedEmptied.length - 1; i >= 0; i--) {
      const item = this.savedEmptied[i];
      const emptyGroup: Group = {
        ...item.group,
        children: [],
      };
      this.stateManager.addNode(item.parentId, emptyGroup, item.originalIndex);
    }

    // 3. Restaurar nodos originales en orden ascendente por padre
    const byParent = new Map<string, SavedNodeEntry[]>();
    for (const item of this.savedNodes) {
      if (!byParent.has(item.parentId)) {
        byParent.set(item.parentId, []);
      }
      byParent.get(item.parentId)!.push(item);
    }

    for (const [, items] of byParent) {
      items.sort((a, b) => a.originalIndex - b.originalIndex);
      for (const item of items) {
        this.stateManager.addNode(item.parentId, item.node, item.originalIndex);
      }
    }

    // 4. Restaurar selección previa
    this.stateManager.setSelection(this.previousSelection);
    this.stateManager.markDirty();
  }

  public redo(): void {
    this.execute();
  }
}
