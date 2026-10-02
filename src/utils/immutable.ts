import type { Document, ParentNode, SceneNode } from '../types/scene-graph.ts';

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

  for (const layer of root.children) {
    if (layer.id === id) {
      return layer;
    }
    for (const shape of layer.children) {
      if (shape.id === id) {
        return shape;
      }
    }
  }

  return null;
}

/**
 * Encuentra el nodo padre que contiene al nodo hijo con el id especificado.
 */
export function findParentOfNode(root: Document, childId: string): ParentNode | null {
  // Las capas tienen como padre al Document
  for (const layer of root.children) {
    if (layer.id === childId) {
      return root;
    }
    // Las figuras tienen como padre a su Layer
    for (const shape of layer.children) {
      if (shape.id === childId) {
        return layer;
      }
    }
  }

  return null;
}
