import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  SceneNode,
} from '../../types/scene-graph.ts';
import { isDocument, isGroup, isLayer, isSelectable } from '../../types/scene-graph.ts';
import { insertAt, moveItem, removeAt } from '../../utils/immutable.ts';
import { getDocumentIndex } from './documentIndex.ts';

export function updateHierarchy(
  doc: Document,
  targetParentId: string,
  action: (children: readonly LayerChildNode[]) => readonly LayerChildNode[]
): Document | null {
  function updateChildren(
    containerId: string,
    children: readonly LayerChildNode[]
  ): { updatedChildren: readonly LayerChildNode[]; changed: boolean } {
    if (containerId === targetParentId) {
      const next = action(children);
      return { updatedChildren: next, changed: next !== children };
    }

    let changed = false;
    const nextChildren: LayerChildNode[] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isGroup(child)) {
        const res = updateChildren(child.id, child.children);
        if (res.changed) {
          changed = true;
          nextChildren.push({ ...child, children: res.updatedChildren });
          continue;
        }
      }
      nextChildren.push(child);
    }

    return { updatedChildren: changed ? nextChildren : children, changed };
  }

  let docChanged = false;
  const nextLayers: Layer[] = [];
  for (let i = 0; i < doc.children.length; i++) {
    const layer = doc.children[i];
    const res = updateChildren(layer.id, layer.children);
    if (res.changed) {
      docChanged = true;
      nextLayers.push({ ...layer, children: res.updatedChildren });
    } else {
      nextLayers.push(layer);
    }
  }

  return docChanged ? { ...doc, children: nextLayers } : null;
}

export function addNodeToDocument(
  doc: Document,
  parentId: string,
  node: Layer | LayerChildNode,
  index?: number
): Document {
  const docIndex = getDocumentIndex(doc);
  const parent = docIndex.nodeMap.get(parentId);

  if (!parent) {
    throw new Error(`[StateManager] Nodo padre con id "${parentId}" no fue encontrado.`);
  }

  if (isDocument(parent)) {
    if (!isLayer(node)) {
      throw new Error(
        `[StateManager] Un nodo de tipo "${node.type}" no puede agregarse directamente al Document. Solo se admiten capas (Layer).`
      );
    }

    const updatedChildren = insertAt(parent.children, node, index);
    return {
      ...parent,
      children: updatedChildren,
    };
  }

  if (isLayer(parent) || isGroup(parent)) {
    if (!isSelectable(node)) {
      throw new Error(
        `[StateManager] Un nodo de tipo "${node.type}" no puede agregarse a un contenedor ${parent.type}. Solo se admiten figuras (Shape) o grupos (Group).`
      );
    }

    const nextState = updateHierarchy(doc, parent.id, (children) => insertAt(children, node, index));
    if (nextState) {
      return nextState;
    }
    return doc;
  }

  throw new Error(
    `[StateManager] El nodo "${parentId}" es de tipo "${parent.type}" y no admite nodos hijos.`
  );
}

export function removeNodeFromDocument(
  doc: Document,
  nodeId: string
): { nextDoc: Document; removed: boolean } {
  if (nodeId === doc.id) {
    throw new Error('[StateManager] No se puede eliminar el nodo raíz Document.');
  }

  const docIndex = getDocumentIndex(doc);
  const parent = docIndex.parentMap.get(nodeId);
  if (!parent) {
    return { nextDoc: doc, removed: false };
  }

  if (isDocument(parent)) {
    const index = parent.children.findIndex((layer) => layer.id === nodeId);
    if (index === -1) return { nextDoc: doc, removed: false };

    const nextLayers = removeAt(parent.children, index);
    const nextState: Document = {
      ...parent,
      children: nextLayers,
    };

    return { nextDoc: nextState, removed: true };
  }

  const nextState = updateHierarchy(doc, parent.id, (children) => {
    const index = children.findIndex((c) => c.id === nodeId);
    if (index === -1) return children;
    return removeAt(children, index);
  });

  if (nextState) {
    return { nextDoc: nextState, removed: true };
  }

  return { nextDoc: doc, removed: false };
}

export function reorderNodesInDocument(
  doc: Document,
  parentId: string,
  fromIndex: number,
  toIndex: number
): Document | null {
  const docIndex = getDocumentIndex(doc);
  const parent = docIndex.nodeMap.get(parentId);

  if (!parent) {
    throw new Error(`[StateManager] Nodo padre con id "${parentId}" no encontrado.`);
  }

  if (isDocument(parent)) {
    const reorderedLayers = moveItem(parent.children, fromIndex, toIndex);
    if (reorderedLayers === parent.children) {
      return null;
    }

    return {
      ...parent,
      children: reorderedLayers,
    };
  }

  return updateHierarchy(doc, parent.id, (children) => moveItem(children, fromIndex, toIndex));
}

export function bringNodeToFront(doc: Document, shapeId: string): Document | null {
  const docIndex = getDocumentIndex(doc);
  const parent = docIndex.parentMap.get(shapeId);
  if (!parent) {
    return null;
  }

  if (isLayer(parent) || isGroup(parent)) {
    const children = parent.children;
    const currentIndex = children.findIndex((s) => s.id === shapeId);
    if (currentIndex === -1) {
      return null;
    }

    const targetChild = children[currentIndex];
    const filtered = children.filter((_, idx) => idx !== currentIndex);
    const reordered = [...filtered, targetChild];

    const updatedChildren = reordered.map((child, index) => ({
      ...child,
      zIndex: index,
    }));

    return updateHierarchy(doc, parent.id, () => updatedChildren);
  }

  if (isDocument(parent)) {
    const layers = parent.children;
    const currentIndex = layers.findIndex((l) => l.id === shapeId);
    if (currentIndex === -1) {
      return null;
    }

    const targetLayer = layers[currentIndex];
    const filtered = layers.filter((_, idx) => idx !== currentIndex);
    const reordered = [...filtered, targetLayer];

    const updatedLayers = reordered.map((layer, index) => ({
      ...layer,
      zIndex: index,
    }));

    return {
      ...doc,
      children: updatedLayers,
    };
  }

  return null;
}

export function sendNodeToBack(doc: Document, shapeId: string): Document | null {
  const docIndex = getDocumentIndex(doc);
  const parent = docIndex.parentMap.get(shapeId);
  if (!parent) {
    return null;
  }

  if (isLayer(parent) || isGroup(parent)) {
    const children = parent.children;
    const currentIndex = children.findIndex((s) => s.id === shapeId);
    if (currentIndex === -1) {
      return null;
    }

    const targetChild = children[currentIndex];
    const filtered = children.filter((_, idx) => idx !== currentIndex);
    const reordered = [targetChild, ...filtered];

    const updatedChildren = reordered.map((child, index) => ({
      ...child,
      zIndex: index,
    }));

    return updateHierarchy(doc, parent.id, () => updatedChildren);
  }

  if (isDocument(parent)) {
    const layers = parent.children;
    const currentIndex = layers.findIndex((l) => l.id === shapeId);
    if (currentIndex === -1) {
      return null;
    }

    const targetLayer = layers[currentIndex];
    const filtered = layers.filter((_, idx) => idx !== currentIndex);
    const reordered = [targetLayer, ...filtered];

    const updatedLayers = reordered.map((layer, index) => ({
      ...layer,
      zIndex: index,
    }));

    return {
      ...doc,
      children: updatedLayers,
    };
  }

  return null;
}

export function reorderNodeStepInDocument(
  doc: Document,
  nodeId: string,
  direction: 'up' | 'down'
): Document | null {
  const docIndex = getDocumentIndex(doc);
  const parent = docIndex.parentMap.get(nodeId);
  if (!parent) {
    return null;
  }

  let children: readonly { id: string }[] = [];
  if (isDocument(parent)) {
    children = parent.children;
  } else if (isLayer(parent) || isGroup(parent)) {
    children = parent.children;
  }

  const fromIndex = children.findIndex((c) => c.id === nodeId);
  if (fromIndex === -1) {
    return null;
  }

  const toIndex = direction === 'up' ? fromIndex + 1 : fromIndex - 1;
  if (toIndex < 0 || toIndex >= children.length) {
    return null;
  }

  return reorderNodesInDocument(doc, parent.id, fromIndex, toIndex);
}

export function getEmptiedAncestors(doc: Document, removedIds: readonly string[]): Group[] {
  const docIndex = getDocumentIndex(doc);
  const removedSet = new Set(removedIds);
  const emptiedGroups: Group[] = [];
  const emptiedSet = new Set<string>();

  let progress = true;
  while (progress) {
    progress = false;
    for (const [id, node] of docIndex.nodeMap.entries()) {
      if (isGroup(node) && !removedSet.has(id) && !emptiedSet.has(id)) {
        const allChildrenRemoved =
          node.children.length > 0 &&
          node.children.every((c) => removedSet.has(c.id) || emptiedSet.has(c.id));
        if (allChildrenRemoved) {
          emptiedGroups.push(node);
          emptiedSet.add(id);
          progress = true;
        }
      }
    }
  }

  return emptiedGroups;
}

export function isEffectivelyVisible(doc: Document, id: string): boolean {
  const docIndex = getDocumentIndex(doc);
  let current: SceneNode | null = docIndex.nodeMap.get(id) ?? null;
  while (current) {
    if (current.visible === false) {
      return false;
    }
    current = docIndex.parentMap.get(current.id) ?? null;
  }
  return true;
}

export function isEffectivelyLocked(doc: Document, id: string): boolean {
  const docIndex = getDocumentIndex(doc);
  let current: SceneNode | null = docIndex.nodeMap.get(id) ?? null;
  while (current) {
    if (current.locked === true) {
      return true;
    }
    current = docIndex.parentMap.get(current.id) ?? null;
  }
  return false;
}
