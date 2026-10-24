/**
 * RTree.ts - Implementación de Árbol-R 2D de aceleración espacial
 * con soporte para inserción dinámica, eliminación O(1) vía mapa de hojas,
 * actualización incremental en O(log n), carga en lote Sort-Tile-Recursive (STR)
 * y consultas de punto y ventana (bounding box).
 */

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RTreeLeafEntry<T> {
  item: T;
  leaf: RTreeNode<T>;
}

export interface RTreeNode<T> {
  aabb: BoundingBox;
  isLeaf: boolean;
  children: RTreeNode<T>[];
  items: T[];
  parent: RTreeNode<T> | null;
}

/**
 * Determina si dos cajas delimitadoras se intersectan.
 */
export function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Determina si la caja contenedora incluye completamente a la caja objetivo.
 */
export function boxContains(container: BoundingBox, target: BoundingBox): boolean {
  return (
    container.minX <= target.minX &&
    container.maxX >= target.maxX &&
    container.minY <= target.minY &&
    container.maxY >= target.maxY
  );
}

/**
 * Determina si un punto (x, y) está dentro de la caja con tolerancia opcional.
 */
export function boxContainsPoint(
  box: BoundingBox,
  x: number,
  y: number,
  tolerance: number = 0
): boolean {
  return (
    x >= box.minX - tolerance &&
    x <= box.maxX + tolerance &&
    y >= box.minY - tolerance &&
    y <= box.maxY + tolerance
  );
}

/**
 * Calcula la unión envolvente de dos cajas delimitadoras.
 */
export function unionBoxes(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Calcula el área de una caja delimitadora.
 */
export function boxArea(b: BoundingBox): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

/**
 * Calcula el semiperímetro (ancho + alto) de una caja delimitadora.
 */
export function boxMargin(b: BoundingBox): number {
  return Math.max(0, b.maxX - b.minX) + Math.max(0, b.maxY - b.minY);
}

/**
 * Calcula la ampliación de área necesaria para que la caja 'base' contenga a 'addition'.
 */
export function areaEnlargement(base: BoundingBox, addition: BoundingBox): number {
  const uMinX = Math.min(base.minX, addition.minX);
  const uMinY = Math.min(base.minY, addition.minY);
  const uMaxX = Math.max(base.maxX, addition.maxX);
  const uMaxY = Math.max(base.maxY, addition.maxY);
  const unionArea = Math.max(0, uMaxX - uMinX) * Math.max(0, uMaxY - uMinY);
  return unionArea - boxArea(base);
}

export type ItemIdExtractor<T> = (item: T) => string;

/**
 * Árbol-R 2D balanceado para indexación y aceleración espacial.
 */
export class RTree<T extends BoundingBox> {
  public readonly maxEntries: number;
  public readonly minEntries: number;
  private readonly getId: ItemIdExtractor<T>;

  private _root: RTreeNode<T>;
  private readonly _itemMap = new Map<string, RTreeLeafEntry<T>>();

  constructor(
    maxEntries: number = 9,
    minEntries?: number,
    getId?: ItemIdExtractor<T>
  ) {
    this.maxEntries = Math.max(4, maxEntries);
    this.minEntries = minEntries
      ? Math.max(2, Math.min(minEntries, Math.floor(this.maxEntries / 2)))
      : Math.max(2, Math.floor(this.maxEntries * 0.4));
    this.getId = getId ?? ((item: any) => item.id ?? String(item));
    this._root = this.createEmptyLeafNode(null);
  }

  /**
   * Retorna la raíz actual del árbol.
   */
  public get root(): RTreeNode<T> {
    return this._root;
  }

  /**
   * Retorna la cantidad de elementos indexados en el árbol.
   */
  public get size(): number {
    return this._itemMap.size;
  }

  /**
   * Retorna la altura actual del árbol (1 para árbol vacío o solo hojas).
   */
  public get height(): number {
    let h = 1;
    let curr = this._root;
    while (!curr.isLeaf && curr.children.length > 0) {
      h++;
      curr = curr.children[0];
    }
    return h;
  }

  /**
   * Retorna el AABB global que engloba a todos los elementos del árbol,
   * o null si el árbol está vacío.
   */
  public getBounds(): BoundingBox | null {
    if (this._itemMap.size === 0) {
      return null;
    }
    return { ...this._root.aabb };
  }

  /**
   * Retorna todos los elementos almacenados.
   */
  public all(): T[] {
    const results: T[] = [];
    for (const entry of this._itemMap.values()) {
      results.push(entry.item);
    }
    return results;
  }

  /**
   * Limpia y vacía el árbol.
   */
  public clear(): void {
    this._itemMap.clear();
    this._root = this.createEmptyLeafNode(null);
  }

  /**
   * Inserta un nuevo elemento en el árbol.
   */
  public insert(item: T): void {
    const id = this.getId(item);
    if (this._itemMap.has(id)) {
      this.remove(id);
    }

    const leaf = this.chooseLeaf(this._root, item);
    leaf.items.push(item);
    this._itemMap.set(id, { item, leaf });

    this.recomputeNodeBounds(leaf);

    if (leaf.items.length > this.maxEntries) {
      this.split(leaf);
    } else {
      this.propagateBoundsUp(leaf.parent);
    }
  }

  /**
   * Elimina un elemento del árbol a partir de su ID en O(1) de localización + O(log n) de ajuste.
   * Retorna true si fue encontrado y eliminado, false en caso contrario.
   */
  public remove(id: string): boolean {
    const entry = this._itemMap.get(id);
    if (!entry) {
      return false;
    }

    const { leaf } = entry;
    this._itemMap.delete(id);

    const index = leaf.items.findIndex((it) => this.getId(it) === id);
    if (index !== -1) {
      leaf.items.splice(index, 1);
    }

    this.recomputeNodeBounds(leaf);

    if (leaf.items.length === 0 && leaf !== this._root && leaf.parent) {
      this.removeNodeFromParent(leaf);
    } else {
      this.propagateBoundsUp(leaf.parent);
    }

    return true;
  }

  /**
   * Actualización incremental de un elemento al transformar su AABB.
   * Localiza en O(1) y reajusta en O(log n) sin reconstruir el árbol.
   */
  public update(item: T): boolean {
    const id = this.getId(item);
    const entry = this._itemMap.get(id);
    if (!entry) {
      this.insert(item);
      return false;
    }

    const { leaf, item: oldItem } = entry;
    const sameBounds =
      oldItem.minX === item.minX &&
      oldItem.minY === item.minY &&
      oldItem.maxX === item.maxX &&
      oldItem.maxY === item.maxY;

    if (sameBounds) {
      // Solo actualizar la referencia de propiedades
      entry.item = item;
      const idx = leaf.items.findIndex((it) => this.getId(it) === id);
      if (idx !== -1) {
        leaf.items[idx] = item;
      }
      return true;
    }

    // Reubicación de nodo mediante remoción e inserción O(log n)
    this.remove(id);
    this.insert(item);
    return true;
  }

  /**
   * Obtiene un elemento por su identificador único en O(1).
   */
  public get(id: string): T | undefined {
    return this._itemMap.get(id)?.item;
  }

  /**
   * Determina si un elemento está indexado.
   */
  public has(id: string): boolean {
    return this._itemMap.has(id);
  }

  /**
   * Realiza una consulta espacial por ventana (Bounding Box).
   * Retorna todos los elementos cuyo AABB intersecta con la ventana dada en O(log n + k).
   */
  public search(box: BoundingBox): T[] {
    const results: T[] = [];
    if (this._itemMap.size === 0) {
      return results;
    }

    this.searchNode(this._root, box, results);
    return results;
  }

  /**
   * Realiza una consulta espacial de punto (con tolerancia opcional en píxeles de espacio mundo).
   * Retorna todos los candidatos cuyo AABB contiene el punto (x, y) en O(log n).
   */
  public searchPoint(x: number, y: number, tolerance: number = 0): T[] {
    const queryBox: BoundingBox = {
      minX: x - tolerance,
      minY: y - tolerance,
      maxX: x + tolerance,
      maxY: y + tolerance,
    };
    return this.search(queryBox);
  }

  /**
   * Construye un árbol balanceado y óptimo a partir de una colección fija de elementos
   * mediante el algoritmo Sort-Tile-Recursive (STR) en O(n log n).
   */
  public bulkLoad(items: readonly T[]): void {
    this.clear();
    if (!items || items.length === 0) {
      return;
    }

    for (const item of items) {
      this._itemMap.set(this.getId(item), { item, leaf: null as any });
    }

    const leaves = this.createLeavesSTR([...items]);

    if (leaves.length === 1) {
      this._root = leaves[0];
      this._root.parent = null;
      for (const item of this._root.items) {
        const id = this.getId(item);
        const entry = this._itemMap.get(id);
        if (entry) entry.leaf = this._root;
      }
      return;
    }

    this._root = this.buildHierarchySTR(leaves);
    this._root.parent = null;

    // Conectar referencias de hojas a itemMap
    this.bindLeafReferences(this._root);
  }

  // ---------------------------------------------------------------------------
  // Algoritmos Internos de Traversal, Inserción y División (Split)
  // ---------------------------------------------------------------------------

  private createEmptyLeafNode(parent: RTreeNode<T> | null): RTreeNode<T> {
    return {
      aabb: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      isLeaf: true,
      children: [],
      items: [],
      parent,
    };
  }

  private createEmptyInternalNode(parent: RTreeNode<T> | null): RTreeNode<T> {
    return {
      aabb: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      isLeaf: false,
      children: [],
      items: [],
      parent,
    };
  }

  private chooseLeaf(node: RTreeNode<T>, item: BoundingBox): RTreeNode<T> {
    if (node.isLeaf) {
      return node;
    }

    let bestChild = node.children[0];
    let minEnlargement = Infinity;
    let minArea = Infinity;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const enlargement = areaEnlargement(child.aabb, item);
      const area = boxArea(child.aabb);

      if (enlargement < minEnlargement) {
        minEnlargement = enlargement;
        minArea = area;
        bestChild = child;
      } else if (enlargement === minEnlargement && area < minArea) {
        minArea = area;
        bestChild = child;
      }
    }

    return this.chooseLeaf(bestChild, item);
  }

  private split(node: RTreeNode<T>): void {
    if (node.isLeaf) {
      this.splitLeaf(node);
    } else {
      this.splitInternal(node);
    }
  }

  private splitLeaf(node: RTreeNode<T>): void {
    const items = node.items;
    const { group1, group2 } = this.partitionItems(items);

    node.items = group1;
    this.recomputeNodeBounds(node);

    for (const it of group1) {
      const entry = this._itemMap.get(this.getId(it));
      if (entry) entry.leaf = node;
    }

    const newNode = this.createEmptyLeafNode(node.parent);
    newNode.items = group2;
    this.recomputeNodeBounds(newNode);

    for (const it of group2) {
      const entry = this._itemMap.get(this.getId(it));
      if (entry) entry.leaf = newNode;
    }

    this.insertNodeIntoParent(node, newNode);
  }

  private splitInternal(node: RTreeNode<T>): void {
    const children = node.children;
    const { group1, group2 } = this.partitionNodes(children);

    node.children = group1;
    this.recomputeNodeBounds(node);
    for (const child of group1) {
      child.parent = node;
    }

    const newNode = this.createEmptyInternalNode(node.parent);
    newNode.children = group2;
    this.recomputeNodeBounds(newNode);
    for (const child of group2) {
      child.parent = newNode;
    }

    this.insertNodeIntoParent(node, newNode);
  }

  private insertNodeIntoParent(node: RTreeNode<T>, newNode: RTreeNode<T>): void {
    if (node === this._root) {
      const newRoot = this.createEmptyInternalNode(null);
      newRoot.children = [node, newNode];
      node.parent = newRoot;
      newNode.parent = newRoot;
      this.recomputeNodeBounds(newRoot);
      this._root = newRoot;
      return;
    }

    const parent = node.parent!;
    newNode.parent = parent;
    parent.children.push(newNode);
    this.recomputeNodeBounds(parent);

    if (parent.children.length > this.maxEntries) {
      this.split(parent);
    } else {
      this.propagateBoundsUp(parent.parent);
    }
  }

  /**
   * Particiona elementos en dos grupos minimizando la suma de semiperímetros de las envolventes.
   */
  private partitionItems(items: T[]): { group1: T[]; group2: T[] } {
    let bestAxis = 'x';
    let bestSplitIndex = this.minEntries;
    let minMarginSum = Infinity;

    for (const axis of ['x', 'y'] as const) {
      const sorted = [...items].sort((a, b) => {
        const centerA = axis === 'x' ? a.minX + a.maxX : a.minY + a.maxY;
        const centerB = axis === 'x' ? b.minX + b.maxX : b.minY + b.maxY;
        return centerA - centerB;
      });

      for (let i = this.minEntries; i <= items.length - this.minEntries; i++) {
        const b1 = this.calcItemsBounds(sorted.slice(0, i));
        const b2 = this.calcItemsBounds(sorted.slice(i));
        const marginSum = boxMargin(b1) + boxMargin(b2);

        if (marginSum < minMarginSum) {
          minMarginSum = marginSum;
          bestAxis = axis;
          bestSplitIndex = i;
        }
      }
    }

    const finalSorted = [...items].sort((a, b) => {
      const centerA = bestAxis === 'x' ? a.minX + a.maxX : a.minY + a.maxY;
      const centerB = bestAxis === 'x' ? b.minX + b.maxX : b.minY + b.maxY;
      return centerA - centerB;
    });

    return {
      group1: finalSorted.slice(0, bestSplitIndex),
      group2: finalSorted.slice(bestSplitIndex),
    };
  }

  private partitionNodes(nodes: RTreeNode<T>[]): { group1: RTreeNode<T>[]; group2: RTreeNode<T>[] } {
    let bestAxis = 'x';
    let bestSplitIndex = this.minEntries;
    let minMarginSum = Infinity;

    for (const axis of ['x', 'y'] as const) {
      const sorted = [...nodes].sort((a, b) => {
        const centerA = axis === 'x' ? a.aabb.minX + a.aabb.maxX : a.aabb.minY + a.aabb.maxY;
        const centerB = axis === 'x' ? b.aabb.minX + b.aabb.maxX : b.aabb.minY + b.aabb.maxY;
        return centerA - centerB;
      });

      for (let i = this.minEntries; i <= nodes.length - this.minEntries; i++) {
        const b1 = this.calcNodesBounds(sorted.slice(0, i));
        const b2 = this.calcNodesBounds(sorted.slice(i));
        const marginSum = boxMargin(b1) + boxMargin(b2);

        if (marginSum < minMarginSum) {
          minMarginSum = marginSum;
          bestAxis = axis;
          bestSplitIndex = i;
        }
      }
    }

    const finalSorted = [...nodes].sort((a, b) => {
      const centerA = bestAxis === 'x' ? a.aabb.minX + a.aabb.maxX : a.aabb.minY + a.aabb.maxY;
      const centerB = bestAxis === 'x' ? b.aabb.minX + b.aabb.maxX : b.aabb.minY + b.aabb.maxY;
      return centerA - centerB;
    });

    return {
      group1: finalSorted.slice(0, bestSplitIndex),
      group2: finalSorted.slice(bestSplitIndex),
    };
  }

  private recomputeNodeBounds(node: RTreeNode<T>): void {
    if (node.isLeaf) {
      node.aabb = this.calcItemsBounds(node.items);
    } else {
      node.aabb = this.calcNodesBounds(node.children);
    }
  }

  private calcItemsBounds(items: readonly T[]): BoundingBox {
    if (items.length === 0) {
      return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }
    let minX = items[0].minX;
    let minY = items[0].minY;
    let maxX = items[0].maxX;
    let maxY = items[0].maxY;

    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      if (it.minX < minX) minX = it.minX;
      if (it.minY < minY) minY = it.minY;
      if (it.maxX > maxX) maxX = it.maxX;
      if (it.maxY > maxY) maxY = it.maxY;
    }

    return { minX, minY, maxX, maxY };
  }

  private calcNodesBounds(nodes: readonly RTreeNode<T>[]): BoundingBox {
    if (nodes.length === 0) {
      return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }
    let minX = nodes[0].aabb.minX;
    let minY = nodes[0].aabb.minY;
    let maxX = nodes[0].aabb.maxX;
    let maxY = nodes[0].aabb.maxY;

    for (let i = 1; i < nodes.length; i++) {
      const b = nodes[i].aabb;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }

    return { minX, minY, maxX, maxY };
  }

  private propagateBoundsUp(node: RTreeNode<T> | null): void {
    let curr = node;
    while (curr) {
      const oldAABB = curr.aabb;
      this.recomputeNodeBounds(curr);
      if (
        oldAABB.minX === curr.aabb.minX &&
        oldAABB.minY === curr.aabb.minY &&
        oldAABB.maxX === curr.aabb.maxX &&
        oldAABB.maxY === curr.aabb.maxY
      ) {
        break;
      }
      curr = curr.parent;
    }
  }

  private removeNodeFromParent(node: RTreeNode<T>): void {
    const parent = node.parent;
    if (!parent) return;

    const idx = parent.children.indexOf(node);
    if (idx !== -1) {
      parent.children.splice(idx, 1);
    }

    if (parent.children.length === 0) {
      if (parent === this._root) {
        this._root = this.createEmptyLeafNode(null);
      } else {
        this.removeNodeFromParent(parent);
      }
    } else {
      this.recomputeNodeBounds(parent);
      this.propagateBoundsUp(parent.parent);
    }
  }

  private searchNode(node: RTreeNode<T>, box: BoundingBox, results: T[]): void {
    if (!boxesIntersect(node.aabb, box)) {
      return;
    }

    if (node.isLeaf) {
      for (let i = 0; i < node.items.length; i++) {
        const item = node.items[i];
        if (boxesIntersect(item, box)) {
          results.push(item);
        }
      }
      return;
    }

    for (let i = 0; i < node.children.length; i++) {
      this.searchNode(node.children[i], box, results);
    }
  }

  // ---------------------------------------------------------------------------
  // Algoritmo STR (Sort-Tile-Recursive) para Carga en Lote Masiva
  // ---------------------------------------------------------------------------

  private createLeavesSTR(items: T[]): RTreeNode<T>[] {
    const totalItems = items.length;
    const numLeaves = Math.ceil(totalItems / this.maxEntries);
    const numSlices = Math.ceil(Math.sqrt(numLeaves));
    const sliceCapacity = numSlices * this.maxEntries;

    // 1. Ordenar por centroide X
    items.sort((a, b) => (a.minX + a.maxX) / 2 - (b.minX + b.maxX) / 2);

    const leaves: RTreeNode<T>[] = [];

    for (let s = 0; s < numSlices; s++) {
      const sliceStart = s * sliceCapacity;
      const sliceEnd = Math.min(totalItems, sliceStart + sliceCapacity);
      if (sliceStart >= sliceEnd) break;

      const sliceItems = items.slice(sliceStart, sliceEnd);
      // 2. Ordenar por centroide Y dentro de cada rebanada
      sliceItems.sort((a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2);

      for (let i = 0; i < sliceItems.length; i += this.maxEntries) {
        const leafItems = sliceItems.slice(i, i + this.maxEntries);
        const leaf = this.createEmptyLeafNode(null);
        leaf.items = leafItems;
        this.recomputeNodeBounds(leaf);
        leaves.push(leaf);
      }
    }

    return leaves;
  }

  private buildHierarchySTR(nodes: RTreeNode<T>[]): RTreeNode<T> {
    if (nodes.length <= this.maxEntries) {
      const root = this.createEmptyInternalNode(null);
      root.children = nodes;
      for (const child of nodes) {
        child.parent = root;
      }
      this.recomputeNodeBounds(root);
      return root;
    }

    const totalNodes = nodes.length;
    const numParents = Math.ceil(totalNodes / this.maxEntries);
    const numSlices = Math.ceil(Math.sqrt(numParents));
    const sliceCapacity = numSlices * this.maxEntries;

    nodes.sort(
      (a, b) => (a.aabb.minX + a.aabb.maxX) / 2 - (b.aabb.minX + b.aabb.maxX) / 2
    );

    const parentNodes: RTreeNode<T>[] = [];

    for (let s = 0; s < numSlices; s++) {
      const sliceStart = s * sliceCapacity;
      const sliceEnd = Math.min(totalNodes, sliceStart + sliceCapacity);
      if (sliceStart >= sliceEnd) break;

      const sliceNodes = nodes.slice(sliceStart, sliceEnd);
      sliceNodes.sort(
        (a, b) => (a.aabb.minY + a.aabb.maxY) / 2 - (b.aabb.minY + b.aabb.maxY) / 2
      );

      for (let i = 0; i < sliceNodes.length; i += this.maxEntries) {
        const chunk = sliceNodes.slice(i, i + this.maxEntries);
        const parent = this.createEmptyInternalNode(null);
        parent.children = chunk;
        for (const child of chunk) {
          child.parent = parent;
        }
        this.recomputeNodeBounds(parent);
        parentNodes.push(parent);
      }
    }

    return this.buildHierarchySTR(parentNodes);
  }

  private bindLeafReferences(node: RTreeNode<T>): void {
    if (node.isLeaf) {
      for (const it of node.items) {
        const entry = this._itemMap.get(this.getId(it));
        if (entry) {
          entry.leaf = node;
        }
      }
      return;
    }

    for (const child of node.children) {
      this.bindLeafReferences(child);
    }
  }
}
