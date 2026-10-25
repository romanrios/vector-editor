import type { AABB, SelectableNode, Shape } from '../../types/scene-graph.ts';
import type { ShapePositionEntry } from '../../state/StateManager.ts';
import { getSelectionBounds, getShapeAABB, getNodeAABB } from './aabb.ts';

export { getLeafShapes } from '../../state/StateManager.ts';

export type AlignmentMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type DistributionAxis = 'horizontal' | 'vertical';

/**
 * Calcula las nuevas posiciones (x, y) para alinear una lista de figuras
 * con respecto a su caja combinada (getSelectionBounds), considerando la geometría
 * exacta y rotación de cada figura mediante getShapeAABB.
 *
 * Retorna únicamente las entradas de aquellas figuras que realmente cambian de posición.
 * Si hay menos de 2 figuras, no es posible calcular la caja unificada, o ninguna figura
 * cambia de posición, retorna un array vacío.
 *
 * @param shapes Lista de figuras a alinear
 * @param mode Modo de alineación ('left', 'center-h', 'right', 'top', 'center-v', 'bottom')
 * @returns Array de entradas { id, x, y } para updateShapesPosition
 */
export function computeAlignment(
  shapes: readonly Shape[],
  mode: AlignmentMode
): ShapePositionEntry[] {
  if (!shapes || shapes.length < 2) {
    return [];
  }

  const bounds = getSelectionBounds(shapes);
  if (!bounds) {
    return [];
  }

  const EPSILON = 1e-5;
  const centerH = (bounds.minX + bounds.maxX) / 2;
  const centerV = (bounds.minY + bounds.maxY) / 2;

  const entries: ShapePositionEntry[] = [];

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const aabb = getShapeAABB(shape);

    let dx = 0;
    let dy = 0;

    switch (mode) {
      case 'left':
        dx = bounds.minX - aabb.minX;
        break;
      case 'center-h': {
        const shapeCenterH = (aabb.minX + aabb.maxX) / 2;
        dx = centerH - shapeCenterH;
        break;
      }
      case 'right':
        dx = bounds.maxX - aabb.maxX;
        break;
      case 'top':
        dy = bounds.minY - aabb.minY;
        break;
      case 'center-v': {
        const shapeCenterV = (aabb.minY + aabb.maxY) / 2;
        dy = centerV - shapeCenterV;
        break;
      }
      case 'bottom':
        dy = bounds.maxY - aabb.maxY;
        break;
    }

    const finalX = Math.abs(dx) > EPSILON ? shape.x + dx : shape.x;
    const finalY = Math.abs(dy) > EPSILON ? shape.y + dy : shape.y;

    if (finalX !== shape.x || finalY !== shape.y) {
      entries.push({
        id: shape.id,
        x: finalX,
        y: finalY,
      });
    }
  }

  return entries;
}

/**
 * Distribuye uniformemente una lista de figuras a lo largo de un eje ('horizontal' o 'vertical'),
 * haciendo que los espacios libres (gaps) entre los bordes de figuras contiguas sean exactamente iguales.
 *
 * Reglas:
 * 1. Requiere 3 o más figuras. Si recibe menos de 3 figuras, retorna un array vacío.
 * 2. Ordena las figuras según su posición espacial a lo largo del eje elegido (minX para horizontal,
 *    minY para vertical), NO por su orden en el array o de selección.
 * 3. Mantiene completamente fijas la primera y la última figura de la secuencia ordenada.
 * 4. Calcula el espacio total disponible entre el borde posterior de la primera figura y el borde anterior
 *    de la última, resta la suma de anchos/alturas de las figuras intermedias, y divide el espacio restante
 *    en (n - 1) espacios iguales.
 * 5. Retorna únicamente las entradas { id, x, y } de las figuras intermedias que realmente cambian de posición.
 *
 * @param shapes Lista de figuras a distribuir
 * @param axis Eje de distribución ('horizontal' o 'vertical')
 * @returns Array de entradas { id, x, y } para updateShapesPosition
 */
export function computeDistribution(
  shapes: readonly Shape[],
  axis: DistributionAxis
): ShapePositionEntry[] {
  if (!shapes || shapes.length < 3) {
    return [];
  }

  interface ShapeWithAABB {
    readonly shape: Shape;
    readonly aabb: AABB;
  }

  const items: ShapeWithAABB[] = shapes.map((shape) => ({
    shape,
    aabb: getShapeAABB(shape),
  }));

  const EPSILON = 1e-5;
  const entries: ShapePositionEntry[] = [];
  const n = items.length;

  if (axis === 'horizontal') {
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minX - b.aabb.minX) > EPSILON) {
        return a.aabb.minX - b.aabb.minX;
      }
      return a.aabb.maxX - b.aabb.maxX;
    });

    const firstEdge = items[0].aabb.maxX;
    const lastEdge = items[n - 1].aabb.minX;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateWidth = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateWidth += items[i].aabb.width;
    }

    const remainingSpace = totalSpan - totalIntermediateWidth;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinX = currentPos + gap;
      const dx = targetMinX - item.aabb.minX;
      const finalX = Math.abs(dx) > EPSILON ? item.shape.x + dx : item.shape.x;
      const finalY = item.shape.y;

      if (finalX !== item.shape.x || finalY !== item.shape.y) {
        entries.push({
          id: item.shape.id,
          x: finalX,
          y: finalY,
        });
      }

      currentPos = targetMinX + item.aabb.width;
    }
  } else {
    // vertical
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minY - b.aabb.minY) > EPSILON) {
        return a.aabb.minY - b.aabb.minY;
      }
      return a.aabb.maxY - b.aabb.maxY;
    });

    const firstEdge = items[0].aabb.maxY;
    const lastEdge = items[n - 1].aabb.minY;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateHeight = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateHeight += items[i].aabb.height;
    }

    const remainingSpace = totalSpan - totalIntermediateHeight;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinY = currentPos + gap;
      const dy = targetMinY - item.aabb.minY;
      const finalX = item.shape.x;
      const finalY = Math.abs(dy) > EPSILON ? item.shape.y + dy : item.shape.y;

      if (finalX !== item.shape.x || finalY !== item.shape.y) {
        entries.push({
          id: item.shape.id,
          x: finalX,
          y: finalY,
        });
      }

      currentPos = targetMinY + item.aabb.height;
    }
  }

  return entries;
}

export interface NodeDeltaEntry {
  readonly node: SelectableNode;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Calcula el desplazamiento relativo (dx, dy) necesario para alinear una colección
 * de nodos seleccionables (figuras o grupos) según el modo indicado.
 * Cada grupo es tratado como una unidad indivisible utilizando su getNodeAABB.
 */
export function computeNodesAlignment(
  nodes: readonly SelectableNode[],
  mode: AlignmentMode
): NodeDeltaEntry[] {
  if (!nodes || nodes.length < 2) {
    return [];
  }

  const bounds = getSelectionBounds(nodes);
  if (!bounds) {
    return [];
  }

  const EPSILON = 1e-5;
  const entries: NodeDeltaEntry[] = [];
  const centerH = bounds.minX + bounds.width / 2;
  const centerV = bounds.minY + bounds.height / 2;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const aabb = getNodeAABB(node);
    let dx = 0;
    let dy = 0;

    switch (mode) {
      case 'left':
        dx = bounds.minX - aabb.minX;
        break;
      case 'center-h': {
        const nodeCenterH = (aabb.minX + aabb.maxX) / 2;
        dx = centerH - nodeCenterH;
        break;
      }
      case 'right':
        dx = bounds.maxX - aabb.maxX;
        break;
      case 'top':
        dy = bounds.minY - aabb.minY;
        break;
      case 'center-v': {
        const nodeCenterV = (aabb.minY + aabb.maxY) / 2;
        dy = centerV - nodeCenterV;
        break;
      }
      case 'bottom':
        dy = bounds.maxY - aabb.maxY;
        break;
    }

    if (Math.abs(dx) > EPSILON || Math.abs(dy) > EPSILON) {
      entries.push({
        node,
        dx: Math.abs(dx) > EPSILON ? dx : 0,
        dy: Math.abs(dy) > EPSILON ? dy : 0,
      });
    }
  }

  return entries;
}

/**
 * Distribuye uniformemente una lista de nodos seleccionables (figuras o grupos)
 * a lo largo de un eje ('horizontal' o 'vertical'), dejando espacios libres iguales entre bordes.
 * Cada grupo es evaluado como una unidad indivisible con su getNodeAABB.
 */
export function computeNodesDistribution(
  nodes: readonly SelectableNode[],
  axis: DistributionAxis
): NodeDeltaEntry[] {
  if (!nodes || nodes.length < 3) {
    return [];
  }

  interface NodeWithAABB {
    readonly node: SelectableNode;
    readonly aabb: AABB;
  }

  const items: NodeWithAABB[] = nodes.map((node) => ({
    node,
    aabb: getNodeAABB(node),
  }));

  const EPSILON = 1e-5;
  const entries: NodeDeltaEntry[] = [];
  const n = items.length;

  if (axis === 'horizontal') {
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minX - b.aabb.minX) > EPSILON) {
        return a.aabb.minX - b.aabb.minX;
      }
      return a.aabb.maxX - b.aabb.maxX;
    });

    const firstEdge = items[0].aabb.maxX;
    const lastEdge = items[n - 1].aabb.minX;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateWidth = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateWidth += items[i].aabb.width;
    }

    const remainingSpace = totalSpan - totalIntermediateWidth;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinX = currentPos + gap;
      const dx = targetMinX - item.aabb.minX;

      if (Math.abs(dx) > EPSILON) {
        entries.push({
          node: item.node,
          dx,
          dy: 0,
        });
      }

      currentPos = targetMinX + item.aabb.width;
    }
  } else {
    // vertical
    items.sort((a, b) => {
      if (Math.abs(a.aabb.minY - b.aabb.minY) > EPSILON) {
        return a.aabb.minY - b.aabb.minY;
      }
      return a.aabb.maxY - b.aabb.maxY;
    });

    const firstEdge = items[0].aabb.maxY;
    const lastEdge = items[n - 1].aabb.minY;
    const totalSpan = lastEdge - firstEdge;

    let totalIntermediateHeight = 0;
    for (let i = 1; i < n - 1; i++) {
      totalIntermediateHeight += items[i].aabb.height;
    }

    const remainingSpace = totalSpan - totalIntermediateHeight;
    const gap = remainingSpace / (n - 1);

    let currentPos = firstEdge;

    for (let i = 1; i < n - 1; i++) {
      const item = items[i];
      const targetMinY = currentPos + gap;
      const dy = targetMinY - item.aabb.minY;

      if (Math.abs(dy) > EPSILON) {
        entries.push({
          node: item.node,
          dx: 0,
          dy,
        });
      }

      currentPos = targetMinY + item.aabb.height;
    }
  }

  return entries;
}
