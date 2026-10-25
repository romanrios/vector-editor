import type { Document } from '../../types/scene-graph.ts';
import { isSelectable } from '../../types/scene-graph.ts';
import { getDocumentIndex, isDescendantOf } from './documentIndex.ts';

/**
 * Normaliza una lista de IDs de nodos para selección:
 * 1. Filtra duplicados y nodos inválidos o no seleccionables.
 * 2. Descarta descendientes si alguno de sus ancestros está en la selección.
 */
export function normalizeSelection(ids: readonly string[], doc: Document): readonly string[] {
  const seen = new Set<string>();
  const validIds: string[] = [];
  const index = getDocumentIndex(doc);

  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      const node = index.nodeMap.get(id);
      if (node && isSelectable(node)) {
        validIds.push(id);
      }
    }
  }

  // Normalización: descartar descendientes si alguno de sus ancestros está en la selección
  return validIds.filter(
    (id) => !validIds.some((otherId) => otherId !== id && isDescendantOf(id, otherId, index.parentMap))
  );
}

/**
 * Conmuta un nodo en la selección actual:
 * - Si ya está seleccionado, lo remueve.
 * - Si no está seleccionado:
 *   - Si un ancestro ya está seleccionado, se ignora.
 *   - Si es ancestro de seleccionados, descarta esos descendientes y lo añade.
 */
export function toggleSelection(
  id: string,
  currentSelection: readonly string[],
  doc: Document
): readonly string[] {
  const index = getDocumentIndex(doc);
  const node = index.nodeMap.get(id);
  if (!node || !isSelectable(node)) {
    return currentSelection;
  }

  const isSelected = currentSelection.includes(id);
  if (isSelected) {
    return normalizeSelection(
      currentSelection.filter((selId) => selId !== id),
      doc
    );
  }

  const hasSelectedAncestor = currentSelection.some((selId) =>
    isDescendantOf(id, selId, index.parentMap)
  );
  if (hasSelectedAncestor) {
    return currentSelection;
  }

  const remaining = currentSelection.filter(
    (selId) => !isDescendantOf(selId, id, index.parentMap)
  );
  return normalizeSelection([...remaining, id], doc);
}

/**
 * Selecciona los elementos de primer nivel de cada capa (un grupo cuenta como una unidad),
 * excluyendo aquellos efectivamente ocultos o bloqueados.
 */
export function selectAllNodes(
  doc: Document,
  isEffectivelyVisible: (id: string) => boolean,
  isEffectivelyLocked: (id: string) => boolean
): readonly string[] {
  const selectableIds: string[] = [];
  for (const layer of doc.children) {
    if (layer.visible === false || layer.locked === true) {
      continue;
    }
    for (const child of layer.children) {
      if (!isEffectivelyVisible(child.id) || isEffectivelyLocked(child.id)) {
        continue;
      }
      selectableIds.push(child.id);
    }
  }
  return normalizeSelection(selectableIds, doc);
}
