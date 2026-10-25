import type {
  Document,
  ParentNode,
  SceneNode,
  LayerChildNode,
  SelectableNode,
  Shape,
  FillType,
} from '../../types/scene-graph.ts';
import { isGroup, isShape } from '../../types/scene-graph.ts';
import type { DocumentIndex } from './types.ts';

export const documentIndexCache = new WeakMap<Document, DocumentIndex>();

export function isPaintEqual(a: FillType | undefined, b: FillType | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'string') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Helper puro que expande una colección de nodos seleccionables (figuras o grupos),
 * resolviendo recursivamente todos los grupos a sus figuras hoja (Shape),
 * eliminando duplicados y preservando el orden de apilado.
 */
export function getLeafShapes(nodes: readonly SelectableNode[]): Shape[] {
  const result: Shape[] = [];
  const seen = new Set<string>();

  function collect(node: SelectableNode) {
    if (isShape(node)) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    } else if (isGroup(node)) {
      for (let i = 0; i < node.children.length; i++) {
        collect(node.children[i]);
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    collect(nodes[i]);
  }

  return result;
}

/**
 * Determina si un nodo childId es descendiente de potentialAncestorId en el árbol del documento.
 */
export function isDescendantOf(
  childId: string,
  potentialAncestorId: string,
  parentMap: Map<string, ParentNode>
): boolean {
  let current: ParentNode | undefined = parentMap.get(childId);
  while (current && current.type !== 'document') {
    if (current.id === potentialAncestorId) {
      return true;
    }
    current = parentMap.get(current.id);
  }
  return false;
}

/**
 * Construye de forma recursiva el índice de búsqueda plana (id -> nodo e id -> padre)
 * para todo el Scene Graph (Document > Layer > Group* > Shape).
 */
export function buildDocumentIndex(doc: Document): DocumentIndex {
  const nodeMap = new Map<string, SceneNode>();
  const parentMap = new Map<string, ParentNode>();

  nodeMap.set(doc.id, doc);

  function indexChildren(parent: ParentNode, children: readonly LayerChildNode[]) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      nodeMap.set(child.id, child);
      parentMap.set(child.id, parent);
      if (isGroup(child)) {
        indexChildren(child, child.children);
      }
    }
  }

  for (let i = 0; i < doc.children.length; i++) {
    const layer = doc.children[i];
    nodeMap.set(layer.id, layer);
    parentMap.set(layer.id, doc);
    indexChildren(layer, layer.children);
  }

  return { nodeMap, parentMap };
}

export function getDocumentIndex(doc: Document): DocumentIndex {
  let index = documentIndexCache.get(doc);
  if (!index) {
    index = buildDocumentIndex(doc);
    documentIndexCache.set(doc, index);
  }
  return index;
}

export function hasCachedDocumentIndex(doc: Document): boolean {
  return documentIndexCache.has(doc);
}
