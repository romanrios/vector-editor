import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import {
  isGroup,
  isShape,
  type Document,
  type Group,
  type Layer,
  type ParentNode,
  type SceneNode,
  type SelectableNode,
  type Shape,
} from '../types/scene-graph.ts';
import { deepFreeze } from '../utils/immutable.ts';
import { generateClonedShapeId } from '../utils/cloneShape.ts';
import type { SavedGroupNode, SavedEmptiedGroupData } from './GroupCommand.ts';

let clipMaskCounter = 0;

export function getNextClipMaskName(): string {
  clipMaskCounter++;
  return `Máscara de recorte ${clipMaskCounter}`;
}

export function resetClipMaskCounter(): void {
  clipMaskCounter = 0;
}

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
 * Comando que crea una máscara de recorte a partir de los elementos seleccionados.
 *
 * En diseño vectorial (Illustrator, SVG):
 * - La figura situada más arriba en el orden de apilamiento (z-order) se convierte en la máscara delimitadora.
 * - Los elementos restantes se contienen dentro del grupo de recorte y quedan limitados por el contorno de la máscara.
 * - Soporta tanto una selección múltiple de 2 o más figuras como un Grupo preexistente de 2 o más figuras.
 */
export class MakeClipMaskCommand implements Command {
  public readonly name: string = 'MakeClipMaskCommand';
  private readonly stateManager: StateManager;
  public readonly nodes: readonly SelectableNode[];
  public readonly newGroup?: Group;
  public readonly maskShape: Shape;
  public readonly targetParentId?: string;
  public readonly targetIndex?: number;
  private readonly savedNodes?: readonly SavedGroupNode[];
  private readonly savedEmptied?: readonly SavedEmptiedGroupData[];
  private readonly previousSelection: readonly string[];

  // Modo conversión sobre grupo preexistente
  private readonly isExistingGroupConversion: boolean;
  private readonly existingGroupId?: string;
  private readonly prevGroupIsClipMask?: boolean;
  private readonly prevGroupClipChildId?: string;

  constructor(stateManager: StateManager, nodes?: readonly SelectableNode[]) {
    this.stateManager = stateManager;
    const targetNodes = nodes ?? this.stateManager.getSelectedNodes();

    if (!targetNodes || targetNodes.length === 0) {
      throw new Error('[MakeClipMaskCommand] Se requiere una selección para crear una máscara de recorte.');
    }

    this.previousSelection = [...this.stateManager.getSelection()];
    this.nodes = targetNodes;

    // Caso A: Un único Grupo preexistente seleccionado
    if (targetNodes.length === 1 && isGroup(targetNodes[0])) {
      const group = targetNodes[0];
      if (!group.children || group.children.length < 2) {
        throw new Error('[MakeClipMaskCommand] El grupo debe contener al menos 2 elementos para crear una máscara.');
      }

      // La figura superior del grupo es el último hijo en el orden de renderizado
      const topChild = group.children[group.children.length - 1];
      if (!isShape(topChild)) {
        throw new Error('[MakeClipMaskCommand] El elemento superior debe ser una figura (Shape) para actuar como máscara.');
      }

      this.isExistingGroupConversion = true;
      this.existingGroupId = group.id;
      this.prevGroupIsClipMask = group.isClipMask;
      this.prevGroupClipChildId = group.clipChildId;
      this.maskShape = topChild;
      return;
    }

    // Caso B: 2 o más nodos seleccionados
    if (targetNodes.length < 2) {
      throw new Error('[MakeClipMaskCommand] Se requieren al menos 2 elementos o un grupo para crear una máscara de recorte.');
    }

    this.isExistingGroupConversion = false;
    const docState = this.stateManager.getState();
    const traversalOrder = getDocumentTraversalOrder(docState);

    // Ordenar de inferior a superior (z-order)
    const sortedNodes = [...targetNodes].sort((a, b) => {
      const orderA = traversalOrder.get(a.id) ?? -1;
      const orderB = traversalOrder.get(b.id) ?? -1;
      return orderA - orderB;
    });

    const topNode = sortedNodes[sortedNodes.length - 1];
    if (!isShape(topNode)) {
      throw new Error('[MakeClipMaskCommand] La figura superior debe ser una figura (Shape) para actuar como máscara delimitadora.');
    }
    this.maskShape = topNode;

    // Determinar contenedor padre donde se insertará el nuevo grupo de recorte
    const nodesSet = new Set(targetNodes.map((n) => n.id));
    const emptiedGroups = this.stateManager.getEmptiedAncestors(Array.from(nodesSet));
    const emptiedSet = new Set(emptiedGroups.map((g) => g.id));

    let targetParent: ParentNode | null = this.stateManager.findParent(topNode.id);
    let refChildId = topNode.id;

    while (targetParent && emptiedSet.has(targetParent.id)) {
      refChildId = targetParent.id;
      targetParent = this.stateManager.findParent(targetParent.id);
    }

    if (!targetParent || !('children' in targetParent)) {
      throw new Error(`[MakeClipMaskCommand] No se encontró el contenedor padre de "${topNode.id}".`);
    }

    this.targetParentId = targetParent.id;
    const targetChildren = targetParent.children as readonly SceneNode[];
    const refIdx = targetChildren.findIndex((c) => c.id === refChildId);

    let calculatedTargetIndex = 0;
    for (let i = 0; i < refIdx; i++) {
      const childId = targetChildren[i].id;
      if (!nodesSet.has(childId) && !emptiedSet.has(childId)) {
        calculatedTargetIndex++;
      }
    }
    this.targetIndex = calculatedTargetIndex;

    // Validar límite máximo de profundidad (32)
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
      throw new Error('[MakeClipMaskCommand] Se excedió el límite máximo de profundidad de anidamiento (32).');
    }

    // Crear el nuevo grupo con bandera isClipMask y clipChildId
    this.newGroup = deepFreeze({
      id: generateClonedShapeId('group'),
      type: 'group',
      name: getNextClipMaskName(),
      isClipMask: true,
      clipChildId: topNode.id,
      children: sortedNodes,
    });

    const savedNodesList: SavedGroupNode[] = [];
    for (const node of targetNodes) {
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

  public execute(): void {
    if (this.isExistingGroupConversion && this.existingGroupId) {
      this.stateManager.updateNode(this.existingGroupId, {
        isClipMask: true,
        clipChildId: this.maskShape.id,
      });
      this.stateManager.setSelection([this.existingGroupId]);
      return;
    }

    if (!this.newGroup || !this.targetParentId || this.targetIndex === undefined) {
      return;
    }

    // 1. Retirar nodos originales
    for (let i = 0; i < this.nodes.length; i++) {
      this.stateManager.removeNode(this.nodes[i].id);
    }

    // 2. Eliminar grupos vacíos
    if (this.savedEmptied) {
      for (let i = 0; i < this.savedEmptied.length; i++) {
        this.stateManager.removeNode(this.savedEmptied[i].group.id);
      }
    }

    // 3. Insertar nuevo grupo de máscara de recorte
    this.stateManager.addNode(this.targetParentId, this.newGroup, this.targetIndex);

    // 4. Seleccionar el grupo
    this.stateManager.setSelection([this.newGroup.id]);
  }

  public undo(): void {
    if (this.isExistingGroupConversion && this.existingGroupId) {
      this.stateManager.updateNode(this.existingGroupId, {
        isClipMask: this.prevGroupIsClipMask,
        clipChildId: this.prevGroupClipChildId,
      });
      this.stateManager.setSelection(this.previousSelection);
      return;
    }

    if (!this.newGroup || !this.savedNodes) {
      return;
    }

    // 1. Retirar grupo y deseleccionar
    this.stateManager.removeFromSelection([this.newGroup.id]);
    this.stateManager.removeNode(this.newGroup.id);

    // 2. Restaurar grupos vaciados
    if (this.savedEmptied) {
      for (let i = this.savedEmptied.length - 1; i >= 0; i--) {
        const item = this.savedEmptied[i];
        const emptyGroup: Group = {
          ...item.group,
          children: [],
        };
        this.stateManager.addNode(item.parentId, emptyGroup, item.originalIndex);
      }
    }

    // 3. Reinsertar nodos originales
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

    // 4. Restaurar selección previa
    this.stateManager.setSelection(this.previousSelection);
  }
}
