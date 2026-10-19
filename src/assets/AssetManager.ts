import type { AssetData } from '../types/scene-graph.ts';

/**
 * Límite máximo sugerido de dimensión en píxeles (ancho o alto) para evitar saturación de VRAM.
 */
export const MAX_ASSET_DIMENSION = 4096;

/**
 * Calcula un identificador único y determinista para un string (Content-Addressable)
 * o un identificador aleatorio seguro.
 */
function generateAssetId(data: string, mimeType: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(data.length, 1024); i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  const prefix = mimeType.split('/')[1] ?? 'img';
  const rand = Math.random().toString(36).substring(2, 8);
  const time = Date.now().toString(36);
  return `asset-${prefix}-${Math.abs(hash).toString(36)}-${time}-${rand}`;
}

export type RenderableImage = HTMLImageElement | ImageBitmap;

/**
 * Gestor centralizado de recursos multimedia (imágenes ráster y vectores externos).
 * Implementa deduplicación de activos, decodificación fuera del hilo principal (createImageBitmap),
 * control de resolución máxima (downsampling preventivo) y caché en memoria para renderizado a 60 FPS.
 */
export class AssetManager {
  private static instance: AssetManager | null = null;

  /**
   * Caché de elementos listos para ser dibujados en Canvas 2D (HTMLImageElement o ImageBitmap).
   */
  private readonly renderableCache = new Map<string, RenderableImage>();

  /**
   * Promesas activas de carga para evitar descodificaciones redundantes simultáneas.
   */
  private readonly pendingLoads = new Map<string, Promise<RenderableImage>>();

  /**
   * Mapa de deduplicación de contenido en memoria (data -> assetId)
   */
  private readonly dataToAssetId = new Map<string, string>();

  /**
   * Registro en memoria de activos conocidos (assetId -> AssetData)
   */
  private readonly assetRegistry = new Map<string, AssetData>();

  public static getInstance(): AssetManager {
    if (!AssetManager.instance) {
      AssetManager.instance = new AssetManager();
    }
    return AssetManager.instance;
  }

  /**
   * Registra un AssetData en el catálogo del AssetManager y lo asocia en la caché de deduplicación.
   */
  public registerAsset(asset: AssetData): void {
    this.assetRegistry.set(asset.id, asset);
    if (asset.data) {
      this.dataToAssetId.set(asset.data, asset.id);
    }
  }

  /**
   * Obtiene la definición de un activo registrado por su ID.
   */
  public getAsset(assetId: string): AssetData | undefined {
    return this.assetRegistry.get(assetId);
  }

  /**
   * Busca si ya existe un activo registrado con exactamente los mismos datos.
   */
  public findAssetIdByData(data: string): string | undefined {
    return this.dataToAssetId.get(data);
  }

  /**
   * Obtiene la imagen decodificada lista para dibujar (RenderableImage) si ya está disponible en caché.
   */
  public getRenderable(assetId: string): RenderableImage | undefined {
    return this.renderableCache.get(assetId);
  }

  /**
   * Almacena directamente un renderable pre-cargado en la caché (útil para pruebas o inyección directa).
   */
  public setRenderable(assetId: string, image: RenderableImage): void {
    this.renderableCache.set(assetId, image);
  }

  /**
   * Pre-carga y decodifica un activo de forma asíncrona.
   * Invoca onLoaded opcional cuando finaliza para disparar el redibujado por dirty-loop.
   */
  public async preloadAsset(
    asset: AssetData,
    onLoaded?: (renderable: RenderableImage) => void
  ): Promise<RenderableImage> {
    this.registerAsset(asset);

    const existing = this.renderableCache.get(asset.id);
    if (existing) {
      if (onLoaded) onLoaded(existing);
      return existing;
    }

    const pending = this.pendingLoads.get(asset.id);
    if (pending) {
      const renderable = await pending;
      if (onLoaded) onLoaded(renderable);
      return renderable;
    }

    const loadPromise = this.decodeAsset(asset);
    this.pendingLoads.set(asset.id, loadPromise);

    try {
      const renderable = await loadPromise;
      this.renderableCache.set(asset.id, renderable);
      this.pendingLoads.delete(asset.id);
      if (onLoaded) onLoaded(renderable);
      return renderable;
    } catch (err) {
      this.pendingLoads.delete(asset.id);
      throw err;
    }
  }

  /**
   * Decodifica un activo utilizando la API más eficiente disponible:
   * 1. createImageBitmap (asíncrono, worker thread de Chromium/Firefox/Safari)
   * 2. HTMLImageElement + decode() o evento onload (fallback estándar)
   */
  private async decodeAsset(asset: AssetData): Promise<RenderableImage> {
    if (typeof window === 'undefined' && typeof Image === 'undefined') {
      // Entorno Node / Tests sin DOM canvas mock
      return {
        width: asset.width,
        height: asset.height,
        close: () => {},
      } as unknown as RenderableImage;
    }

    // Si data es un Data-URL o URL externa
    if (typeof fetch === 'function' && typeof createImageBitmap === 'function' && !asset.data.startsWith('data:image/svg+xml')) {
      try {
        const response = await fetch(asset.data);
        const blob = await response.blob();
        return await createImageBitmap(blob);
      } catch {
        // Fallback a HTMLImageElement si fetch o createImageBitmap falla
      }
    }

    return new Promise<HTMLImageElement>((resolve, reject) => {
      if (typeof Image === 'undefined') {
        resolve({
          width: asset.width,
          height: asset.height,
        } as unknown as HTMLImageElement);
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().then(() => resolve(img)).catch(() => resolve(img));
        } else {
          resolve(img);
        }
      };

      img.onerror = (e) => {
        reject(new Error(`[AssetManager] Error al cargar imagen ${asset.id}: ${String(e)}`));
      };

      img.src = asset.data;
    });
  }

  /**
   * Procesa un archivo subido o arrastrado (File/Blob), aplicando deduplicación,
   * cálculo de dimensiones intrínsecas y downsampling si excede MAX_ASSET_DIMENSION.
   */
  public async createAssetFromFile(file: File): Promise<{ asset: AssetData; width: number; height: number }> {
    const mimeType = file.type || 'image/png';
    const dataUrl = await this.readBlobAsDataUrl(file);
    return this.createAssetFromDataUrl(dataUrl, mimeType);
  }

  /**
   * Procesa una cadena Data-URL, extrayendo dimensiones y generando el AssetData.
   */
  public async createAssetFromDataUrl(
    dataUrl: string,
    mimeType?: string
  ): Promise<{ asset: AssetData; width: number; height: number }> {
    const detectedMime = mimeType || this.extractMimeType(dataUrl);

    // Deduplicación CAS: si ya existe registrado, reutilizar
    const existingId = this.findAssetIdByData(dataUrl);
    if (existingId) {
      const existing = this.getAsset(existingId);
      if (existing) {
        return { asset: existing, width: existing.width, height: existing.height };
      }
    }

    // Cargar temporalmente para medir dimensiones
    const { img, width, height } = await this.measureImage(dataUrl);

    let finalData = dataUrl;
    let finalWidth = width;
    let finalHeight = height;

    // Downsampling de protección si excede 4096px (sólo para imágenes ráster)
    if (
      !detectedMime.includes('svg') &&
      (width > MAX_ASSET_DIMENSION || height > MAX_ASSET_DIMENSION) &&
      typeof document !== 'undefined'
    ) {
      const downsampled = this.downsampleImage(img, width, height, MAX_ASSET_DIMENSION, detectedMime);
      if (downsampled) {
        finalData = downsampled.dataUrl;
        finalWidth = downsampled.width;
        finalHeight = downsampled.height;
      }
    }

    const assetId = generateAssetId(finalData, detectedMime);
    const asset: AssetData = {
      id: assetId,
      mimeType: detectedMime,
      data: finalData,
      width: finalWidth,
      height: finalHeight,
    };

    this.registerAsset(asset);
    return { asset, width: finalWidth, height: finalHeight };
  }

  /**
   * Lee un Blob o File como cadena Data-URL (Base64)
   */
  private readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('[AssetManager] Fallo al leer archivo Blob como DataURL'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Extrae el tipo MIME desde el encabezado de un DataURL
   */
  private extractMimeType(dataUrl: string): string {
    const match = dataUrl.match(/^data:([^;]+);/);
    return match ? match[1] : 'image/png';
  }

  /**
   * Mide las dimensiones intrínsecas de una imagen dada su URL
   */
  private measureImage(url: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' && typeof Image === 'undefined') {
        resolve({ img: {} as HTMLImageElement, width: 800, height: 600 });
        return;
      }

      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width || 800;
        const h = img.naturalHeight || img.height || 600;
        resolve({ img, width: w, height: h });
      };
      img.onerror = (e) => {
        reject(new Error(`[AssetManager] Error al medir imagen: ${String(e)}`));
      };
      img.src = url;
    });
  }

  /**
   * Escala proporcionalmente una imagen que excede la dimensión máxima permitida.
   */
  private downsampleImage(
    img: HTMLImageElement,
    width: number,
    height: number,
    maxDimension: number,
    mimeType: string
  ): { dataUrl: string; width: number; height: number } | null {
    if (typeof document === 'undefined') return null;

    const scale = maxDimension / Math.max(width, height);
    const newW = Math.max(1, Math.round(width * scale));
    const newH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, newW, newH);

    const targetMime = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const dataUrl = canvas.toDataURL(targetMime, 0.92);
    return { dataUrl, width: newW, height: newH };
  }

  /**
   * Limpia toda la caché de memoria y registros.
   */
  public clear(): void {
    this.renderableCache.clear();
    this.pendingLoads.clear();
    this.dataToAssetId.clear();
    this.assetRegistry.clear();
  }
}

/**
 * Instancia compartida por defecto del AssetManager
 */
export const assetManager = AssetManager.getInstance();
