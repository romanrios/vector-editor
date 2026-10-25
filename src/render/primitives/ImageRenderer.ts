import type { ImageNode } from '../../types/scene-graph.ts';
import { assetManager } from '../../assets/AssetManager.ts';
import type { StateManager } from '../../state/StateManager.ts';

/**
 * Dibuja un marco provisional sutil mientras la imagen se decodifica en segundo plano.
 */
export function renderImagePlaceholder(ctx: CanvasRenderingContext2D, img: ImageNode): void {
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(img.x, img.y, img.width, img.height);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(img.x, img.y, img.width, img.height);
}

/**
 * Dibuja un nodo Image aplicando rotación centrada y opacidad.
 * Si la imagen aún no está decodificada en memoria, inicia su pre-carga
 * y dibuja un placeholder sutil; al completarse notifica markDirty()
 * para disparar el redibujado en el siguiente frame del dirty-loop.
 */
export function renderImage(
  ctx: CanvasRenderingContext2D,
  img: ImageNode,
  stateManager: StateManager
): void {
  ctx.save();

  if (img.rotation) {
    const cx = img.x + img.width / 2;
    const cy = img.y + img.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((img.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  if (img.opacity !== undefined && img.opacity < 1) {
    ctx.globalAlpha = Math.max(0, Math.min(1, (ctx.globalAlpha ?? 1) * img.opacity));
  }

  const renderable = assetManager.getRenderable(img.assetId);

  if (renderable && typeof ctx.drawImage === 'function') {
    try {
      ctx.drawImage(
        renderable as CanvasImageSource,
        img.x,
        img.y,
        img.width,
        img.height
      );
    } catch {
      renderImagePlaceholder(ctx, img);
    }
  } else {
    const asset = stateManager.getAsset(img.assetId) ?? assetManager.getAsset(img.assetId);
    if (asset) {
      void assetManager.preloadAsset(asset, () => {
        stateManager.markDirty();
      });
    }
    renderImagePlaceholder(ctx, img);
  }

  if (img.stroke && img.stroke !== 'none' && img.strokeWidth && img.strokeWidth > 0) {
    ctx.strokeStyle = img.stroke as string;
    ctx.lineWidth = img.strokeWidth;
    ctx.strokeRect(img.x, img.y, img.width, img.height);
  }

  ctx.restore();
}
