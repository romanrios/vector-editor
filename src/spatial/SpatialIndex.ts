/**
 * SpatialIndex.ts - Índice espacial acelerado basado en R-Tree (BVH) para el Scene Graph de Vectedit.
 * Proporciona hit-testing en O(log n), búsqueda de selección por ventana (marquee selection),
 * y actualización incremental de AABBs al transformar nodos.
 */

import type {
  AABB,
  Document,
  Group,
  LayerChildNode,
  Path,
  SelectableNode,
  Shape,
  Text,
} from '../types/scene-graph.ts';
import type { ShapePositionEntry, ShapeDimensionsEntry } from '../state/StateManager.ts';
import { isGroup, isShape } from '../types/scene-graph.ts';
import {
  getShapeAABB,
  isPointInPath,
  isPointInShape,
  isPointInText,
  type RectLike,
} from '../utils/geometry.ts';
import { RTree, type BoundingBox } from './RTree.ts';

export interface SpatialItem extends BoundingBox {
  readonly id: string;
  readonly aabb: AABB;
  readonly zIndex: number;
  readonly layerId: string;
  readonly isVisible: boolean;
  readonly isLocked: boolean;
  readonly shape: Shape;
  readonly rootSelectableId: string;
  readonly clipGroupId?: string;
}

export interface HitTestSpatialOptions {
  readonly zoom: number;
  readonly isTouch?: boolean;
  readonly ctx?: CanvasRenderingContext2D | null;
  readonly activeTextEdit?: {
    readonly textId: string;
    readonly currentText: string;
  } | null;
  readonly document?: Document;
}

/**
 * Normaliza cualquier RectLike o AABB a una BoundingBox con min/max ordenados.
 */
export function normalizeBoundingBox(rect: RectLike | AABB): BoundingBox {
  if ('x' in rect && 'y' in rect) {
    const x = rect.x;
    const y = rect.y;
    const w = rect.width;
    const h = rect.height;
    return {
      minX: Math.min(x, x + w),
      maxX: Math.max(x, x + w),
      minY: Math.min(y, y + h),
      maxY: Math.max(y, y + h),
    };
  }
  return {
    minX: Math.min(rect.minX, rect.maxX),
    maxX: Math.max(rect.minX, rect.maxX),
    minY: Math.min(rect.minY, rect.maxY),
    maxY: Math.max(rect.minY, rect.maxY),
  };
}

/**
 * Índice espacial que mantiene sincronizadas las figuras del Scene Graph en un Árbol-R.
 */
export class SpatialIndex {
  private readonly _tree: RTree<SpatialItem>;
  private _nextZIndex: number = 0;
  private _lastDocument: Document | null = null;

  constructor() {
    this._tree = new RTree<SpatialItem>(9, 4, (item) => item.id);
  }

  /**
   * Retorna el número de figuras indexadas.
   */
  public get size(): number {
    return this._tree.size;
  }

  /**
   * Retorna la altura del árbol de aceleración espacial.
   */
  public get height(): number {
    return this._tree.height;
  }

  /**
   * Retorna el Árbol-R subyacente para inspección o pruebas avanzadas.
   */
  public get tree(): RTree<SpatialItem> {
    return this._tree;
  }

  /**
   * Retorna el último documento indexado, o null si no se ha construido desde un documento.
   */
  public get lastDocument(): Document | null {
    return this._lastDocument;
  }

  /**
   * Limpia el índice por completo.
   */
  public clear(): void {
    this._tree.clear();
    this._nextZIndex = 0;
    this._lastDocument = null;
  }

  /**
   * Reconstruye el índice espacial a partir del documento inmutable completo mediante carga STR en O(n log n).
   */
  public buildFromDocument(doc: Document): void {
    this._lastDocument = doc;
    this._nextZIndex = 0;
    const items: SpatialItem[] = [];

    const traverse = (
      node: LayerChildNode,
      layerId: string,
      rootSelectableId: string,
      inheritedVisible: boolean,
      inheritedLocked: boolean,
      clipGroupId?: string
    ) => {
      const isVisible = inheritedVisible && node.visible !== false;
      const isLocked = inheritedLocked || node.locked === true;

      if (isGroup(node)) {
        const nextClipGroupId = node.isClipMask ? node.id : clipGroupId;
        const maskId = node.isClipMask
          ? (node.clipChildId ?? node.children[node.children.length - 1]?.id)
          : undefined;

        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (node.isClipMask && child.id === maskId) {
            continue;
          }
          traverse(
            child,
            layerId,
            rootSelectableId,
            isVisible,
            isLocked,
            nextClipGroupId
          );
        }
      } else if (isShape(node)) {
        const aabb = getShapeAABB(node);
        const zIndex = this._nextZIndex++;
        items.push({
          id: node.id,
          minX: aabb.minX,
          minY: aabb.minY,
          maxX: aabb.maxX,
          maxY: aabb.maxY,
          aabb,
          zIndex,
          layerId,
          isVisible,
          isLocked,
          shape: node,
          rootSelectableId,
          clipGroupId,
        });
      }
    };

    for (let l = 0; l < doc.children.length; l++) {
      const layer = doc.children[l];
      const layerVisible = layer.visible !== false;
      const layerLocked = layer.locked === true;

      for (let c = 0; c < layer.children.length; c++) {
        const child = layer.children[c];
        traverse(
          child,
          layer.id,
          child.id,
          layerVisible,
          layerLocked,
          undefined
        );
      }
    }

    this._tree.bulkLoad(items);
  }

  /**
   * Obtiene un SpatialItem por su ID en O(1).
   */
  public getItem(id: string): SpatialItem | undefined {
    return this._tree.get(id);
  }

  /**
   * Consulta candidatos espaciales para un punto dado (x, y) con tolerancia opcional en O(log n).
   * Retorna los candidatos ordenados por zIndex descendente (la figura superior primero).
   */
  public queryPoint(x: number, y: number, tolerance: number = 0): SpatialItem[] {
    const candidates = this._tree.searchPoint(x, y, tolerance);
    if (candidates.length <= 1) {
      return candidates;
    }
    // Ordenar de mayor a menor zIndex (arriba hacia abajo visualmente)
    return candidates.sort((a, b) => b.zIndex - a.zIndex);
  }

  /**
   * Consulta figuras cuyo AABB intersecta con la ventana dada en O(log n + k).
   */
  public queryBox(box: RectLike | AABB): SpatialItem[] {
    const norm = normalizeBoundingBox(box);
    return this._tree.search(norm);
  }

  /**
   * Consulta los nodos seleccionables (figuras de nivel superior o grupos)
   * cuyo AABB intersecta con la ventana de selección rectangular (marquee selection).
   */
  public querySelectableNodesInBox(
    doc: Document,
    box: RectLike | AABB
  ): SelectableNode[] {
    const norm = normalizeBoundingBox(box);
    const hitItems = this._tree.search(norm);
    if (hitItems.length === 0) {
      return [];
    }

    const hitRootIds = new Set<string>();
    for (let i = 0; i < hitItems.length; i++) {
      hitRootIds.add(hitItems[i].rootSelectableId);
    }

    // Preservar el orden natural del Scene Graph en el documento
    const result: SelectableNode[] = [];
    for (const layer of doc.children) {
      if (layer.visible === false || layer.locked === true) {
        continue;
      }
      for (const child of layer.children) {
        if (child.visible === false || child.locked === true) {
          continue;
        }
        if (hitRootIds.has(child.id)) {
          result.push(child);
        }
      }
    }

    return result;
  }

  /**
   * Hit-testing espacial acelerado en O(log n).
   * Evalúa primero el Árbol-R para descartar el 99% de las figuras que no intersectan el punto,
   * y sobre los pocos candidatos solapados ejecuta la verificación geométrica precisa
   * en orden descendente de apilamiento (topmost first).
   */
  public hitTest(
    x: number,
    y: number,
    options: HitTestSpatialOptions
  ): Shape | null {
    const { zoom, isTouch = false, ctx = null, activeTextEdit = null, document: doc } = options;

    const maxTolerance = (isTouch ? 20 : 8) / zoom;
    const candidates = this.queryPoint(x, y, maxTolerance);
    if (candidates.length === 0) {
      return null;
    }

    // Mapeo rápido de grupos de máscara si hay figuras enmascaradas
    const maskClipCache = new Map<string, boolean>();

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      if (!item.isVisible || item.isLocked) {
        continue;
      }

      // Si pertenece a un grupo de recorte (clipping mask), verificar si cae dentro de la máscara
      if (item.clipGroupId && doc) {
        let insideClip = maskClipCache.get(item.clipGroupId);
        if (insideClip === undefined) {
          insideClip = this.isPointInsideClipGroup(x, y, item.clipGroupId, doc, ctx, zoom);
          maskClipCache.set(item.clipGroupId, insideClip);
        }
        if (!insideClip) {
          continue;
        }
      }

      const shape = item.shape;

      if (shape.type === 'path') {
        const tolerance = (isTouch ? 20 : 8) / zoom;
        if (isPointInPath(x, y, shape as Path, ctx, tolerance)) {
          return shape;
        }
      } else if (shape.type === 'text') {
        const tolerance = (isTouch ? 16 : 4) / zoom;
        const currentText =
          activeTextEdit && activeTextEdit.textId === shape.id
            ? activeTextEdit.currentText
            : (shape as Text).text;
        const effectiveText = {
          ...(shape as Text),
          text: currentText.length > 0 ? currentText : ' ',
        };
        if (isPointInText(x, y, effectiveText, tolerance, ctx)) {
          return shape;
        }
      } else {
        const tolerance = (isTouch ? 16 : 4) / zoom;
        if (isPointInShape(x, y, shape, tolerance)) {
          return shape;
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Actualización Incremental de AABBs al Transformar Nodos (Hito 4.1)
  // ---------------------------------------------------------------------------

  /**
   * Actualiza de forma incremental el AABB y/o definición geométrica de una figura individual en O(log n).
   */
  public updateShapeAABB(
    shapeId: string,
    newAABB: AABB,
    newShape?: Shape
  ): boolean {
    const existing = this._tree.get(shapeId);
    if (!existing) {
      return false;
    }

    const updatedItem: SpatialItem = {
      ...existing,
      minX: newAABB.minX,
      minY: newAABB.minY,
      maxX: newAABB.maxX,
      maxY: newAABB.maxY,
      aabb: newAABB,
      shape: newShape ?? existing.shape,
    };

    return this._tree.update(updatedItem);
  }

  /**
   * Actualiza incrementalmente la posición de múltiples figuras (traslación) en O(k log n).
   */
  public updateShapesPositions(
    entries: readonly ShapePositionEntry[],
    doc?: Document
  ): void {
    if (doc) {
      this._lastDocument = doc;
    }
    if (!entries || entries.length === 0) {
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const existing = this._tree.get(entry.id);
      if (!existing) {
        continue;
      }

      // Si el nodo en el nuevo documento está provisto, recalculamos con su definición
      let updatedShape: Shape;
      if (doc) {
        const found = this.findShapeInDoc(doc, entry.id);
        updatedShape = found ?? {
          ...existing.shape,
          x: entry.x,
          y: entry.y,
        } as Shape;
      } else {
        const oldX = (existing.shape as any).x ?? existing.aabb.minX;
        const oldY = (existing.shape as any).y ?? existing.aabb.minY;
        const dx = entry.x - oldX;
        const dy = entry.y - oldY;

        if (existing.shape.type === 'path') {
          const path = existing.shape as Path;
          const updatedPoints = path.points.map((p) => ({
            ...p,
            x: p.x + dx,
            y: p.y + dy,
            handleIn: p.handleIn ? { x: p.handleIn.x + dx, y: p.handleIn.y + dy } : undefined,
            handleOut: p.handleOut ? { x: p.handleOut.x + dx, y: p.handleOut.y + dy } : undefined,
          }));
          updatedShape = { ...path, points: updatedPoints };
        } else {
          updatedShape = { ...existing.shape, x: entry.x, y: entry.y } as Shape;
        }
      }

      const newAABB = getShapeAABB(updatedShape);
      this.updateShapeAABB(entry.id, newAABB, updatedShape);
    }
  }

  /**
   * Actualiza incrementalmente las dimensiones de múltiples figuras (escalado/redimensionado) en O(k log n).
   */
  public updateShapesDimensions(
    entries: readonly ShapeDimensionsEntry[],
    doc?: Document
  ): void {
    if (doc) {
      this._lastDocument = doc;
    }
    if (!entries || entries.length === 0) {
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const existing = this._tree.get(entry.id);
      if (!existing) {
        continue;
      }

      let updatedShape: Shape | null = null;
      if (doc) {
        updatedShape = this.findShapeInDoc(doc, entry.id);
      }

      if (!updatedShape) {
        const dims = entry.dimensions;
        updatedShape = {
          ...existing.shape,
          x: dims.x ?? (existing.shape as any).x,
          y: dims.y ?? (existing.shape as any).y,
          ...(dims.width !== undefined ? { width: dims.width } : {}),
          ...(dims.height !== undefined ? { height: dims.height } : {}),
          ...(dims.rotation !== undefined ? { rotation: dims.rotation } : {}),
        } as Shape;
      }

      const newAABB = getShapeAABB(updatedShape);
      this.updateShapeAABB(entry.id, newAABB, updatedShape);
    }
  }

  /**
   * Actualiza las propiedades geométricas o de visibilidad de una figura individual en O(log n).
   */
  public updateShapeProperties(
    shapeId: string,
    updatedShape: Shape,
    isVisible?: boolean,
    isLocked?: boolean
  ): boolean {
    const existing = this._tree.get(shapeId);
    if (!existing) {
      return false;
    }

    const newAABB = getShapeAABB(updatedShape);
    const updatedItem: SpatialItem = {
      ...existing,
      minX: newAABB.minX,
      minY: newAABB.minY,
      maxX: newAABB.maxX,
      maxY: newAABB.maxY,
      aabb: newAABB,
      shape: updatedShape,
      isVisible: isVisible !== undefined ? isVisible : existing.isVisible,
      isLocked: isLocked !== undefined ? isLocked : existing.isLocked,
    };

    return this._tree.update(updatedItem);
  }

  /**
   * Inserta una nueva figura individual en el índice espacial en O(log n).
   */
  public insertShape(
    shape: Shape,
    layerId: string,
    rootSelectableId?: string,
    isVisible: boolean = true,
    isLocked: boolean = false,
    clipGroupId?: string
  ): void {
    const aabb = getShapeAABB(shape);
    const zIndex = this._nextZIndex++;
    const item: SpatialItem = {
      id: shape.id,
      minX: aabb.minX,
      minY: aabb.minY,
      maxX: aabb.maxX,
      maxY: aabb.maxY,
      aabb,
      zIndex,
      layerId,
      isVisible,
      isLocked,
      shape,
      rootSelectableId: rootSelectableId ?? shape.id,
      clipGroupId,
    };
    this._tree.insert(item);
  }

  /**
   * Inserta un nodo (figura o grupo) y todos sus descendientes en O(k log n).
   */
  public insertNode(
    node: SelectableNode,
    layerId: string,
    rootSelectableId?: string,
    isVisible: boolean = true,
    isLocked: boolean = false
  ): void {
    const rootId = rootSelectableId ?? node.id;

    const traverse = (
      curr: LayerChildNode,
      inheritedVis: boolean,
      inheritedLock: boolean,
      clipGroupId?: string
    ) => {
      const vis = inheritedVis && curr.visible !== false;
      const lock = inheritedLock || curr.locked === true;

      if (isGroup(curr)) {
        const nextClip = curr.isClipMask ? curr.id : clipGroupId;
        const maskId = curr.isClipMask
          ? (curr.clipChildId ?? curr.children[curr.children.length - 1]?.id)
          : undefined;

        for (let i = 0; i < curr.children.length; i++) {
          const child = curr.children[i];
          if (curr.isClipMask && child.id === maskId) {
            continue;
          }
          traverse(child, vis, lock, nextClip);
        }
      } else if (isShape(curr)) {
        this.insertShape(curr, layerId, rootId, vis, lock, clipGroupId);
      }
    };

    traverse(node, isVisible, isLocked, undefined);
  }

  /**
   * Actualiza la referencia del último documento indexado tras mutaciones incrementales.
   */
  public setLastDocument(doc: Document): void {
    this._lastDocument = doc;
  }

  /**
   * Elimina una figura por su ID en O(1) de localización + O(log n) de ajuste.
   */
  public removeShape(shapeId: string): boolean {
    return this._tree.remove(shapeId);
  }

  /**
   * Elimina un nodo (figura o grupo con todos sus descendientes) del índice espacial.
   */
  public removeNode(nodeId: string, doc?: Document): boolean {
    if (doc) {
      this._lastDocument = doc;
    }

    // Si la figura directa existe en el árbol
    if (this._tree.has(nodeId)) {
      return this._tree.remove(nodeId);
    }

    // Si es un grupo, buscar sus descendientes para eliminarlos
    let removedAny = false;
    for (const item of this._tree.all()) {
      if (item.rootSelectableId === nodeId) {
        this._tree.remove(item.id);
        removedAny = true;
      }
    }

    return removedAny;
  }

  // ---------------------------------------------------------------------------
  // Métodos Auxiliares
  // ---------------------------------------------------------------------------

  private isPointInsideClipGroup(
    x: number,
    y: number,
    clipGroupId: string,
    doc: Document,
    ctx: CanvasRenderingContext2D | null,
    zoom: number
  ): boolean {
    const group = this.findGroupInDoc(doc, clipGroupId);
    if (!group || !group.isClipMask) {
      return true;
    }

    const maskShape = group.clipChildId
      ? group.children.find((c) => c.id === group.clipChildId)
      : group.children[group.children.length - 1];

    if (!maskShape || !isShape(maskShape)) {
      return true;
    }

    if (maskShape.type === 'path') {
      return isPointInPath(x, y, maskShape as Path, ctx, 8 / zoom);
    }
    return isPointInShape(x, y, maskShape, 4 / zoom);
  }

  private findShapeInDoc(doc: Document, id: string): Shape | null {
    const search = (children: readonly LayerChildNode[]): Shape | null => {
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c.id === id && isShape(c)) return c;
        if (isGroup(c)) {
          const found = search(c.children);
          if (found) return found;
        }
      }
      return null;
    };

    for (let l = 0; l < doc.children.length; l++) {
      const found = search(doc.children[l].children);
      if (found) return found;
    }
    return null;
  }

  private findGroupInDoc(doc: Document, id: string): Group | null {
    const search = (children: readonly LayerChildNode[]): Group | null => {
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c.id === id && isGroup(c)) return c;
        if (isGroup(c)) {
          const found = search(c.children);
          if (found) return found;
        }
      }
      return null;
    };

    for (let l = 0; l < doc.children.length; l++) {
      const found = search(doc.children[l].children);
      if (found) return found;
    }
    return null;
  }
}
