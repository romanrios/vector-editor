import type { AABB, Group, Layer } from '../types/scene-graph.ts';
import { isGroup, isShape } from '../types/scene-graph.ts';
import { getNodeAABB } from '../utils/geometry.ts';

export interface CachedRenderEntry {
  readonly id: string;
  readonly nodeRef: Layer | Group;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly bounds: AABB; // Límites en el espacio del mundo con margen incluido
  readonly zoom: number;
  readonly dpr: number;
  lastUsedFrame: number;
}

export interface LayerCacheManagerOptions {
  /**
   * Cantidad mínima de figuras en una capa o grupo para que califique para caché.
   * Por defecto 2 figuras.
   */
  readonly minShapeCount?: number;
  /**
   * Dimensión máxima en píxeles (ancho o alto) para un lienzo fuera de pantalla.
   * Previene desbordamientos de memoria de GPU. Por defecto 4096.
   */
  readonly maxDimension?: number;
  /**
   * Margen de seguridad en unidades del mundo alrededor del AABB para evitar recortes de contorno o antialiasing.
   * Por defecto 6 px.
   */
  readonly paddingMargin?: number;
  /**
   * Tolerancia relativa de zoom para reutilizar caché durante navegación continua.
   * Por defecto 0.02 (2%).
   */
  readonly zoomTolerance?: number;
  /**
   * Fábrica opcional para instanciar lienzos fuera de pantalla (útil para pruebas unitarias o renderizado headless).
   */
  readonly canvasFactory?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null;
}

export interface LayerCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly entriesCount: number;
  readonly totalMemoryBytes: number;
}

/**
 * Crea un lienzo fuera de pantalla compatible con el entorno actual (OffscreenCanvas o HTMLCanvasElement).
 * Si el entorno no soporta Canvas, devuelve null de forma segura.
 */
export function createOffscreenCanvas(
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas | null {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(w, h);
    } catch {
      // Entorno donde OffscreenCanvas existe pero no puede instanciarse
    }
  }

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas;
    } catch {
      // Fallback
    }
  }

  return null;
}

/**
 * Gestor de caché de capas y grupos estáticos en lienzos fuera de pantalla (OffscreenCanvas).
 * Utiliza structural sharing e inmutabilidad (referencia `===`) para invalidación en tiempo O(1).
 */
export class LayerCacheManager {
  private readonly entries: Map<string, CachedRenderEntry> = new Map();
  public readonly minShapeCount: number;
  public readonly maxDimension: number;
  public readonly paddingMargin: number;
  public readonly zoomTolerance: number;

  private readonly _canvasFactory: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null;

  private _hits: number = 0;
  private _misses: number = 0;

  constructor(options: LayerCacheManagerOptions = {}) {
    this.minShapeCount = Math.max(1, options.minShapeCount ?? 2);
    this.maxDimension = Math.max(256, options.maxDimension ?? 4096);
    this.paddingMargin = Math.max(0, options.paddingMargin ?? 6);
    this.zoomTolerance = Math.max(0, options.zoomTolerance ?? 0.02);
    this._canvasFactory = options.canvasFactory ?? createOffscreenCanvas;
  }

  /**
   * Crea un lienzo fuera de pantalla utilizando la fábrica configurada.
   */
  public createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
    return this._canvasFactory(width, height);
  }

  /**
   * Cuenta recursivamente las figuras hoja dentro de un nodo (capa o grupo).
   */
  public countLeafShapes(node: Layer | Group): number {
    let count = 0;
    for (const child of node.children) {
      if (child.visible === false) {
        continue;
      }
      if (isGroup(child)) {
        count += this.countLeafShapes(child);
      } else if (isShape(child)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Determina si el nodo o alguno de sus descendientes se encuentra activo/seleccionado.
   */
  public hasActiveDescendant(node: Layer | Group, activeIds: ReadonlySet<string>): boolean {
    if (activeIds.size === 0) {
      return false;
    }
    if (activeIds.has(node.id)) {
      return true;
    }

    for (const child of node.children) {
      if (activeIds.has(child.id)) {
        return true;
      }
      if (isGroup(child) && this.hasActiveDescendant(child, activeIds)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determina si una capa o grupo es elegible para rasterizarse en caché:
   * 1. No tiene descendientes seleccionados ni en edición activa.
   * 2. Posee al menos `minShapeCount` figuras.
   * 3. Está visible.
   */
  public isEligible(node: Layer | Group, activeIds: ReadonlySet<string>): boolean {
    if (node.visible === false) {
      return false;
    }
    if (this.hasActiveDescendant(node, activeIds)) {
      return false;
    }
    const shapeCount = this.countLeafShapes(node);
    return shapeCount >= this.minShapeCount;
  }

  /**
   * Calcula los límites AABB del nodo en coordenadas del mundo sumando el margen de seguridad.
   */
  public calculatePaddedBounds(node: Layer | Group, zoom: number): AABB | null {
    if (!node.children || node.children.length === 0) {
      return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const child of node.children) {
      if (child.visible === false) {
        continue;
      }
      const aabb = getNodeAABB(child);
      if (Number.isFinite(aabb.minX) && Number.isFinite(aabb.maxX)) {
        minX = Math.min(minX, aabb.minX);
        minY = Math.min(minY, aabb.minY);
        maxX = Math.max(maxX, aabb.maxX);
        maxY = Math.max(maxY, aabb.maxY);
      }
    }

    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
      return null;
    }

    const margin = Math.max(2, this.paddingMargin / Math.max(0.01, zoom));
    const padMinX = minX - margin;
    const padMinY = minY - margin;
    const padMaxX = maxX + margin;
    const padMaxY = maxY + margin;

    return {
      minX: padMinX,
      minY: padMinY,
      maxX: padMaxX,
      maxY: padMaxY,
      width: padMaxX - padMinX,
      height: padMaxY - padMinY,
    };
  }

  /**
   * Obtiene la entrada de caché válida para una capa o grupo si no ha mutado (mismo objeto inmutable)
   * y si el factor de zoom y DPI son compatibles.
   */
  public get(node: Layer | Group, zoom: number, dpr: number): CachedRenderEntry | null {
    const entry = this.entries.get(node.id);
    if (!entry) {
      return null;
    }

    // 1. Verificación estructural instantánea en O(1)
    if (entry.nodeRef !== node) {
      this.entries.delete(node.id);
      this._misses++;
      return null;
    }

    // 2. Verificación de DPI
    if (entry.dpr !== dpr) {
      this.entries.delete(node.id);
      this._misses++;
      return null;
    }

    // 3. Verificación de zoom (exacto o dentro de tolerancia de paneo/zoom continuo)
    const zoomDiff = Math.abs(entry.zoom - zoom) / entry.zoom;
    if (zoomDiff > this.zoomTolerance) {
      this._misses++;
      return null;
    }

    this._hits++;
    return entry;
  }

  /**
   * Guarda o actualiza una entrada en el caché.
   */
  public set(entry: CachedRenderEntry): void {
    this.entries.set(entry.id, entry);
  }

  /**
   * Invalida la entrada para un identificador específico.
   */
  public invalidate(id: string): void {
    this.entries.delete(id);
  }

  /**
   * Elimina entradas huérfanas cuyos IDs ya no existen en el documento actual.
   */
  public prune(activeNodeIds: Iterable<string>): void {
    const activeSet = new Set(activeNodeIds);
    for (const id of this.entries.keys()) {
      if (!activeSet.has(id)) {
        this.entries.delete(id);
      }
    }
  }

  /**
   * Limpia todo el caché y restablece estadísticas.
   */
  public clear(): void {
    this.entries.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Retorna estadísticas de uso y rendimiento del caché.
   */
  public getStats(): LayerCacheStats {
    let totalMemoryBytes = 0;
    for (const entry of this.entries.values()) {
      const w = entry.canvas.width || 0;
      const h = entry.canvas.height || 0;
      totalMemoryBytes += w * h * 4; // 4 bytes por píxel RGBA
    }

    return {
      hits: this._hits,
      misses: this._misses,
      entriesCount: this.entries.size,
      totalMemoryBytes,
    };
  }
}
