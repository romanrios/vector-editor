import {
  isGroup,
  type Shape,
  type Rectangle,
  type Ellipse,
  type Path,
  type PathPoint,
  type Text,
  type Group,
  type SelectableNode,
  type LayerChildNode,
} from '../types/scene-graph.ts';
import { deepFreeze } from './immutable.ts';

export interface CloneNodeOptions {
  readonly dx?: number;
  readonly dy?: number;
  readonly newId?: string;
  readonly newName?: string;
}

export type CloneShapeOptions = CloneNodeOptions;

let cloneCounter = 0;

/**
 * Genera un identificador único determinista para un nuevo nodo clonado.
 */
export function generateClonedShapeId(type: string): string {
  cloneCounter++;
  return `${type}-${Date.now()}-${cloneCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Función pura que produce una copia profunda de un nodo seleccionable (Shape o Group)
 * con identificadores únicos, nombres derivados y un desplazamiento configurable (dx, dy).
 * Si el nodo es un Grupo, clona recursivamente todos sus hijos garantizando IDs únicos
 * para cada descendiente y sin referencias compartidas con el original.
 * Respeta la inmutabilidad profunda (deepFreeze).
 *
 * @param node Nodo a clonar (figura o grupo)
 * @param offsetOrOptions Desplazamiento opcional { dx, dy } u opciones completas
 */
export function cloneNode<T extends SelectableNode>(
  node: T,
  offsetOrOptions?: { dx?: number; dy?: number } | CloneNodeOptions
): T {
  const dx = offsetOrOptions?.dx ?? 0;
  const dy = offsetOrOptions?.dy ?? 0;
  const newId = (offsetOrOptions as CloneNodeOptions)?.newId;
  const newName = (offsetOrOptions as CloneNodeOptions)?.newName;

  if (isGroup(node)) {
    const id = newId ?? generateClonedShapeId('group');
    const name = newName ?? `${node.name} copia`;
    const clonedChildren: LayerChildNode[] = node.children.map((child) =>
      cloneNode(child, { dx, dy })
    );

    const clonedGroup: Group = {
      id,
      type: 'group',
      name,
      children: clonedChildren,
      ...(node.visible !== undefined ? { visible: node.visible } : {}),
      ...(node.locked !== undefined ? { locked: node.locked } : {}),
      ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
    };

    return deepFreeze(clonedGroup) as unknown as T;
  }

  // Figura (Rectangle, Ellipse o Path)
  const id = newId ?? generateClonedShapeId(node.type);
  const name = newName ?? `${node.name} copia`;

  if (node.type === 'rectangle') {
    const rect: Rectangle = {
      ...node,
      id,
      name,
      x: node.x + dx,
      y: node.y + dy,
    };
    return deepFreeze(rect) as unknown as T;
  }

  if (node.type === 'ellipse') {
    const ellipse: Ellipse = {
      ...node,
      id,
      name,
      x: node.x + dx,
      y: node.y + dy,
    };
    return deepFreeze(ellipse) as unknown as T;
  }

  if (node.type === 'path') {
    const points: readonly PathPoint[] = (node.points || []).map((pt) => {
      const clonedPt: PathPoint = {
        x: pt.x + dx,
        y: pt.y + dy,
        ...(pt.handleIn
          ? { handleIn: { x: pt.handleIn.x + dx, y: pt.handleIn.y + dy } }
          : {}),
        ...(pt.handleOut
          ? { handleOut: { x: pt.handleOut.x + dx, y: pt.handleOut.y + dy } }
          : {}),
      };
      return clonedPt;
    });

    const path: Path = {
      ...node,
      id,
      name,
      x: node.x + dx,
      y: node.y + dy,
      points,
    };
    return deepFreeze(path) as unknown as T;
  }

  if (node.type === 'text') {
    const text: Text = {
      ...node,
      id,
      name,
      x: node.x + dx,
      y: node.y + dy,
    };
    return deepFreeze(text) as unknown as T;
  }

  throw new Error(`[cloneNode] Tipo de nodo no soportado: ${(node as SelectableNode).type}`);
}

/**
 * Envoltorio de compatibilidad hacia atrás que delega en cloneNode.
 */
export function cloneShape<T extends Shape>(shape: T, options?: CloneShapeOptions): T {
  return cloneNode(shape, options) as T;
}
