import type { Document, LayerChildNode, ParentNode, SceneNode } from '../types/scene-graph.ts';
import { isGroup } from '../types/scene-graph.ts';

/**
 * Congela profundamente un objeto o array para garantizar inmutabilidad en tiempo de ejecución.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }

  Object.freeze(obj);

  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object') {
      deepFreeze(value);
    }
  }

  return obj;
}

/**
 * Inserta un elemento en una posición específica de un array sin mutarlo.
 * Si el índice se omite o es mayor que la longitud, se añade al final.
 */
export function insertAt<T>(array: readonly T[], item: T, index?: number): readonly T[] {
  if (index === undefined || index >= array.length) {
    return [...array, item];
  }
  const targetIndex = Math.max(0, index);
  return [...array.slice(0, targetIndex), item, ...array.slice(targetIndex)];
}

/**
 * Elimina un elemento de un array por su índice sin mutarlo.
 */
export function removeAt<T>(array: readonly T[], index: number): readonly T[] {
  if (index < 0 || index >= array.length) {
    return array;
  }
  return [...array.slice(0, index), ...array.slice(index + 1)];
}

/**
 * Reordena un elemento en un array desde `fromIndex` hasta `toIndex` sin mutar el array original.
 */
export function moveItem<T>(array: readonly T[], fromIndex: number, toIndex: number): readonly T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= array.length ||
    toIndex < 0 ||
    toIndex >= array.length ||
    fromIndex === toIndex
  ) {
    return array;
  }

  const result = [...array];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

/**
 * Busca un nodo por su ID en el Scene Graph de forma recursiva.
 */
export function findNodeById(root: Document, id: string): SceneNode | null {
  if (root.id === id) {
    return root;
  }

  function searchChildren(children: readonly LayerChildNode[]): SceneNode | null {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.id === id) {
        return child;
      }
      if (isGroup(child)) {
        const found = searchChildren(child.children);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  for (let i = 0; i < root.children.length; i++) {
    const layer = root.children[i];
    if (layer.id === id) {
      return layer;
    }
    const found = searchChildren(layer.children);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Encuentra el nodo padre que contiene al nodo hijo con el id especificado de forma recursiva.
 */
export function findParentOfNode(root: Document, childId: string): ParentNode | null {
  for (let i = 0; i < root.children.length; i++) {
    const layer = root.children[i];
    if (layer.id === childId) {
      return root;
    }
  }

  function searchInParent(parent: ParentNode, children: readonly LayerChildNode[]): ParentNode | null {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.id === childId) {
        return parent;
      }
      if (isGroup(child)) {
        const found = searchInParent(child, child.children);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  for (let i = 0; i < root.children.length; i++) {
    const layer = root.children[i];
    const found = searchInParent(layer, layer.children);
    if (found) {
      return found;
    }
  }

  return null;
}
