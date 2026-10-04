import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import {
  isGroup,
  type Document,
  type Group,
  type Layer,
  type ParentNode,
  type SceneNode,
  type SelectableNode,
} from '../types/scene-graph.ts';
import { deepFreeze } from '../utils/immutable.ts';
import { generateClonedShapeId } from '../utils/cloneShape.ts';

let groupCounter = 0;

/**
 * Genera el siguiente nombre secuencial para un nuevo grupo.
 */
export function getNextGroupName(): string {
  groupCounter++;
  return `Grupo ${groupCounter}`;
}

/**
 * Restablece el contador interno de nombres de grupo (útil para pruebas unitarias).
 */
export function resetGroupCounter(): void {
  groupCounter = 0;
}

export interface SavedGroupNode {
  readonly node: SelectableNode;
  readonly parentId: string;
  readonly originalIndex: number;
}

export interface SavedEmptiedGroupData {
  readonly group: Group;
  readonly parentId: string;
  readonly originalIndex: number;
}

/**
 * Recorre recursivamente el Documento para construir un mapa del orden global de apilado (z-stacking).
 * Los nodos visitados más tarde tienen un índice mayor y se renderizan por encima.
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
 * Comando que encapsula la agrupación de 2 o más elementos seleccionables en un nuevo Grupo.
 *
 * Reglas:
 * 1. Crea el grupo en el contenedor padre del elemento más alto del conjunto (el último en orden
 *    de apilado), en su posición exacta, con los hijos ordenados relativamente según su z-order.
 * 2. Si el contenedor del elemento más alto queda completamente vaciado por la agrupación,
 *    asciende hasta el primer ancestro que permanezca en el Scene Graph.
 * 3. Guarda el padre e índice de cada nodo original y la cadena de grupos que quedan vacíos.
 * 4. execute: retira los nodos, inserta el grupo, elimina los grupos vaciados y selecciona el nuevo grupo.
 * 5. undo: restaura los grupos vaciados (de arriba a abajo), reinserta los nodos en orden
 *    ascendente por padre y restaura la selección previa.
 */
export class GroupCommand implements Command {
  public readonly name: string = 'GroupCommand';
  private readonly stateManager: StateManager;
  public readonly nodes: readonly SelectableNode[];
  public readonly newGroup: Group;
  public readonly targetParentId: string;
  public readonly targetIndex: number;
  private readonly savedNodes: readonly SavedGroupNode[];
  private readonly savedEmptied: readonly SavedEmptiedGroupData[];
  private readonly previousSelection: readonly string[];

  constructor(stateManager: StateManager, nodes: readonly SelectableNode[]) {
    if (!nodes || nodes.length < 2) {
      throw new Error('[GroupCommand] Se requieren al menos 2 nodos para agrupar.');
    }

    this.stateManager = stateManager;
    this.nodes = nodes;
    this.previousSelection = [...this.stateManager.getSelection()];

    const docState = this.stateManager.getState();
    const traversalOrder = getDocumentTraversalOrder(docState);

    // Ordenar los hijos en su orden relativo según el orden de apilado global del Scene Graph
    const sortedNodes = [...nodes].sort(
      (a, b) => (traversalOrder.get(a.id) ?? 0) - (traversalOrder.get(b.id) ?? 0)
    );

    // El nodo más alto es el último en orden de apilado
    const highestNode = sortedNodes[sortedNodes.length - 1];
    let targetParent = this.stateManager.findParent(highestNode.id);

    if (!targetParent) {
      throw new Error(`[GroupCommand] No se encontró el nodo contenedor de "${highestNode.id}".`);
    }

    const nodeIds = nodes.map((n) => n.id);
    const nodesSet = new Set(nodeIds);

    // Calcular la cadena de grupos que quedarían vacíos
    const emptiedGroups = this.stateManager.getEmptiedAncestors(nodeIds);
    const emptiedSet = new Set(emptiedGroups.map((g) => g.id));

    // Si el contenedor padre del elemento más alto va a quedar vaciado,
    // ascendemos por la jerarquía hasta encontrar un contenedor que no se elimine.
    let referenceNodeId = highestNode.id;
    while (emptiedSet.has(targetParent.id)) {
      const ancestorParent = this.stateManager.findParent(targetParent.id);
      if (!ancestorParent) {
        break;
      }
      referenceNodeId = targetParent.id;
      targetParent = ancestorParent;
    }

    this.targetParentId = targetParent.id;

    // Calcular la posición exacta de inserción en el contenedor padre:
    // Cantidad de elementos previos al nodo de referencia que NO forman parte de la agrupación ni de grupos vaciados
    const targetChildren =
      'children' in targetParent ? (targetParent.children as readonly SceneNode[]) : [];
    const refIdx = targetChildren.findIndex((c) => c.id === referenceNodeId);
    let calculatedTargetIndex = 0;
    for (let i = 0; i < refIdx; i++) {
      const childId = targetChildren[i].id;
      if (!nodesSet.has(childId) && !emptiedSet.has(childId)) {
        calculatedTargetIndex++;
      }
    }
    this.targetIndex = calculatedTargetIndex;

    // Validar profundidad máxima de anidamiento (límite 32)
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

    let maxSubtree = 0;
    for (const node of sortedNodes) {
      maxSubtree = Math.max(maxSubtree, getNodeSubtreeDepth(node));
    }

    if (parentDepth + 1 + maxSubtree > 32) {
      throw new Error('[GroupCommand] Se excedió el límite máximo de profundidad de anidamiento (32).');
    }

    // Crear el nuevo grupo con los hijos ordenados relativamente
    this.newGroup = deepFreeze({
      id: generateClonedShapeId('group'),
      type: 'group',
      name: getNextGroupName(),
      children: sortedNodes,
    });

    // Guardar para cada nodo original su padre y su índice exacto
    const savedNodesList: SavedGroupNode[] = [];
    for (const node of nodes) {
      const parent = this.stateManager.findParent(node.id);
      const originalIndex =
        parent && 'children' in parent
          ? (parent.children as readonly SceneNode[]).findIndex((c) => c.id === node.id)
          : 0;
      savedNodesList.push({
        node,
        parentId: parent ? parent.id : '',
        originalIndex,
      });
    }
    this.savedNodes = Object.freeze(savedNodesList);

    // Guardar información de los grupos que quedarán vaciados
    const savedEmptiedList: SavedEmptiedGroupData[] = [];
    for (const group of emptiedGroups) {
      const gParent = this.stateManager.findParent(group.id);
      const originalIndex =
        gParent && 'children' in gParent
          ? (gParent.children as readonly SceneNode[]).findIndex((c) => c.id === group.id)
          : 0;
      savedEmptiedList.push({
        group,
        parentId: gParent ? gParent.id : '',
        originalIndex,
      });
    }
    this.savedEmptied = Object.freeze(savedEmptiedList);
  }

  /**
   * Ejecuta la agrupación: retira los nodos originales, elimina los grupos vaciados,
   * inserta el nuevo grupo en el destino y deja el grupo seleccionado.
   */
  public execute(): void {
    // 1. Retirar los nodos originales del Scene Graph
    for (let i = 0; i < this.nodes.length; i++) {
      this.stateManager.removeNode(this.nodes[i].id);
    }

    // 2. Eliminar los grupos que hayan quedado vacíos
    for (let i = 0; i < this.savedEmptied.length; i++) {
      this.stateManager.removeNode(this.savedEmptied[i].group.id);
    }

    // 3. Insertar el nuevo grupo en el contenedor padre en su posición
    this.stateManager.addNode(this.targetParentId, this.newGroup, this.targetIndex);

    // 4. Dejar el nuevo grupo seleccionado
    this.stateManager.setSelection([this.newGroup.id]);
  }

  /**
   * Deshace la agrupación: retira el grupo, restaura los grupos vaciados de arriba a abajo,
   * reinserta los nodos originales en orden ascendente por padre y restaura la selección previa.
   */
  public undo(): void {
    // 1. Retirar el nuevo grupo y deseleccionarlo
    this.stateManager.removeFromSelection([this.newGroup.id]);
    this.stateManager.removeNode(this.newGroup.id);

    // 2. Restaurar los grupos vaciados desde el ancestro más exterior hacia el más profundo
    for (let i = this.savedEmptied.length - 1; i >= 0; i--) {
      const item = this.savedEmptied[i];
      const emptyGroup: Group = {
        ...item.group,
        children: [],
      };
      this.stateManager.addNode(item.parentId, emptyGroup, item.originalIndex);
    }

    // 3. Reinsertar los nodos originales en orden ascendente por padre
    const byParent = new Map<string, SavedGroupNode[]>();
    for (const item of this.savedNodes) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    }

    for (const [parentId, items] of byParent.entries()) {
      items.sort((a, b) => a.originalIndex - b.originalIndex);
      for (let i = 0; i < items.length; i++) {
        this.stateManager.addNode(parentId, items[i].node, items[i].originalIndex);
      }
    }

    // 4. Restaurar la selección previa
    this.stateManager.setSelection(this.previousSelection);
  }
}
