import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  Path,
  Rectangle,
  Ellipse,
  Text,
  ImageNode,
  Polygon,
  Star,
  SelectableNode,
} from '../types/scene-graph.ts';
import { assetManager } from '../assets/AssetManager.ts';
import { isGroup, isShape, isGradient, type FillType, type Shape } from '../types/scene-graph.ts';
import { isNonePaint } from './color.ts';
import { getPathBaseAABB, getGroupAABB, getTextLineHeight, getTextLineRanges, getPolygonBaseVertices, getStarBaseVertices, traceShapeClip } from './geometry.ts';
import { createCanvasGradient, getShapeBaseAABB } from './gradient.ts';
import { smoothPathPoints, getPolygonPathPoints, getStarPathPoints } from './cornerSmoothing.ts';

function resolveRasterPaint(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  paint: FillType | undefined,
  defaultColor: string = '#000000'
): string | CanvasGradient {
  if (!paint) return defaultColor;
  if (isGradient(paint)) {
    const baseAABB = getShapeBaseAABB(shape, ctx);
    return createCanvasGradient(ctx, paint, baseAABB, 1);
  }
  return paint;
}

export interface RasterExportOptions {
  /**
   * Formato de imagen ráster a generar (por defecto 'png')
   */
  readonly format?: 'png' | 'webp' | 'jpeg';

  /**
   * Factor de escala o multiplicador de resolución (1 = 1x, 2 = 2x Retina, 3 = 3x, etc.)
   */
  readonly scale?: number;

  /**
   * Color de fondo. Si es null o undefined, el fondo permanece transparente (en PNG/WebP).
   * Para JPEG, si no se especifica se utiliza blanco '#ffffff'.
   */
  readonly backgroundColor?: string | null;

  /**
   * Si es true, exporta únicamente las figuras o grupos seleccionados
   * recortando las dimensiones al área delimitadora combinada.
   */
  readonly onlySelected?: boolean;

  /**
   * Lista de IDs de nodos seleccionados (necesario si onlySelected es true).
   */
  readonly selectedIds?: readonly string[];

  /**
   * Calidad de compresión para formatos con pérdida (JPEG o WebP), entre 0.0 y 1.0.
   */
  readonly quality?: number;

  /**
   * Identificador opcional de la Mesa de Trabajo a exportar.
   */
  readonly artboardId?: string;
}

/**
 * Bounds calculados para la exportación
 */
export interface ExportBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function collectLeafShapes(node: LayerChildNode): LayerChildNode[] {
  if (isGroup(node)) {
    const result: LayerChildNode[] = [];
    for (const child of node.children) {
      result.push(...collectLeafShapes(child));
    }
    return result;
  }
  return [node];
}

function findSelectableNodes(doc: Document, ids: readonly string[]): SelectableNode[] {
  const idSet = new Set(ids);
  const found: SelectableNode[] = [];

  function search(node: Layer | Group): void {
    for (const child of node.children) {
      if (idSet.has(child.id)) {
        found.push(child);
      }
      if (isGroup(child)) {
        search(child);
      }
    }
  }

  for (const layer of doc.children) {
    search(layer);
  }

  return found;
}

/**
 * Calcula los límites espaciales (bounds) para la exportación.
 */
export function calculateExportBounds(
  doc: Document,
  onlySelected: boolean,
  selectedIds?: readonly string[],
  artboardId?: string
): ExportBounds {
  if (onlySelected && selectedIds && selectedIds.length > 0) {
    const selectedNodes = findSelectableNodes(doc, selectedIds);
    if (selectedNodes.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const node of selectedNodes) {
        if (node.type === 'rectangle' || node.type === 'image') {
          const r = node as Rectangle | ImageNode;
          minX = Math.min(minX, r.x);
          minY = Math.min(minY, r.y);
          maxX = Math.max(maxX, r.x + r.width);
          maxY = Math.max(maxY, r.y + r.height);
        } else if (node.type === 'ellipse') {
          const e = node as Ellipse;
          minX = Math.min(minX, e.x - e.radiusX);
          minY = Math.min(minY, e.y - e.radiusY);
          maxX = Math.max(maxX, e.x + e.radiusX);
          maxY = Math.max(maxY, e.y + e.radiusY);
        } else if (node.type === 'path') {
          const p = node as Path;
          const aabb = getPathBaseAABB(p);
          minX = Math.min(minX, aabb.minX);
          minY = Math.min(minY, aabb.minY);
          maxX = Math.max(maxX, aabb.maxX);
          maxY = Math.max(maxY, aabb.maxY);
        } else if (node.type === 'text') {
          const t = node as Text;
          minX = Math.min(minX, t.x);
          minY = Math.min(minY, t.y);
          const w = t.boxWidth ?? (t.text ? t.text.length * (t.fontSize ?? 16) * 0.6 : 50);
          const h = (t.fontSize ?? 16) * 1.2;
          maxX = Math.max(maxX, t.x + w);
          maxY = Math.max(maxY, t.y + h);
        } else if (node.type === 'polygon') {
          const p = node as Polygon;
          minX = Math.min(minX, p.x - p.radius);
          minY = Math.min(minY, p.y - p.radius);
          maxX = Math.max(maxX, p.x + p.radius);
          maxY = Math.max(maxY, p.y + p.radius);
        } else if (node.type === 'star') {
          const s = node as Star;
          minX = Math.min(minX, s.x - s.outerRadius);
          minY = Math.min(minY, s.y - s.outerRadius);
          maxX = Math.max(maxX, s.x + s.outerRadius);
          maxY = Math.max(maxY, s.y + s.outerRadius);
        } else if (isGroup(node)) {
          if (node.isClipMask) {
            const maskAABB = getGroupAABB(node);
            minX = Math.min(minX, maskAABB.minX);
            minY = Math.min(minY, maskAABB.minY);
            maxX = Math.max(maxX, maskAABB.maxX);
            maxY = Math.max(maxY, maskAABB.maxY);
            continue;
          }
          const leaves = collectLeafShapes(node);
          for (const leaf of leaves) {
            if (leaf.type === 'rectangle' || leaf.type === 'image') {
              const r = leaf as Rectangle | ImageNode;
              minX = Math.min(minX, r.x);
              minY = Math.min(minY, r.y);
              maxX = Math.max(maxX, r.x + r.width);
              maxY = Math.max(maxY, r.y + r.height);
            } else if (leaf.type === 'ellipse') {
              const e = leaf as Ellipse;
              minX = Math.min(minX, e.x - e.radiusX);
              minY = Math.min(minY, e.y - e.radiusY);
              maxX = Math.max(maxX, e.x + e.radiusX);
              maxY = Math.max(maxY, e.y + e.radiusY);
            } else if (leaf.type === 'path') {
              const aabb = getPathBaseAABB(leaf as Path);
              minX = Math.min(minX, aabb.minX);
              minY = Math.min(minY, aabb.minY);
              maxX = Math.max(maxX, aabb.maxX);
              maxY = Math.max(maxY, aabb.maxY);
            } else if (leaf.type === 'polygon') {
              const p = leaf as Polygon;
              minX = Math.min(minX, p.x - p.radius);
              minY = Math.min(minY, p.y - p.radius);
              maxX = Math.max(maxX, p.x + p.radius);
              maxY = Math.max(maxY, p.y + p.radius);
            } else if (leaf.type === 'star') {
              const s = leaf as Star;
              minX = Math.min(minX, s.x - s.outerRadius);
              minY = Math.min(minY, s.y - s.outerRadius);
              maxX = Math.max(maxX, s.x + s.outerRadius);
              maxY = Math.max(maxY, s.y + s.outerRadius);
            }
          }
        }
      }

      if (Number.isFinite(minX) && Number.isFinite(minY) && maxX > minX && maxY > minY) {
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };
      }
    }
  }

  if (artboardId && doc.artboards && doc.artboards.length > 0) {
    const target = doc.artboards.find((a) => a.id === artboardId);
    if (target) {
      return {
        x: target.x,
        y: target.y,
        width: Math.max(1, target.width),
        height: Math.max(1, target.height),
      };
    }
  }

  return {
    x: 0,
    y: 0,
    width: Math.max(1, doc.width),
    height: Math.max(1, doc.height),
  };
}

/**
 * Renderiza de forma pura una figura sobre un contexto 2D
 */
function renderShapeToContext(ctx: CanvasRenderingContext2D, shape: LayerChildNode): void {
  ctx.save();

  if (typeof shape.opacity === 'number') {
    ctx.globalAlpha *= Math.max(0, Math.min(1, shape.opacity));
  }

  if (shape.type === 'rectangle') {
    const rect = shape as Rectangle;
    if (rect.rotation) {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rect.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    ctx.beginPath();
    if (rect.cornerRadius && typeof ctx.roundRect === 'function') {
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.cornerRadius);
    } else {
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    }

    if (!isNonePaint(rect.fill) && rect.fill) {
      ctx.fillStyle = resolveRasterPaint(ctx, rect, rect.fill);
      ctx.fill();
    }

    if (!isNonePaint(rect.stroke) && rect.strokeWidth && rect.strokeWidth > 0 && rect.stroke) {
      ctx.lineWidth = rect.strokeWidth;
      ctx.strokeStyle = resolveRasterPaint(ctx, rect, rect.stroke);
      ctx.stroke();
    }
  } else if (shape.type === 'ellipse') {
    const ellipse = shape as Ellipse;
    const rotationRad = ellipse.rotation ? (ellipse.rotation * Math.PI) / 180 : 0;

    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(
        ellipse.x,
        ellipse.y,
        ellipse.radiusX,
        ellipse.radiusY,
        rotationRad,
        0,
        Math.PI * 2
      );
    } else {
      // Fallback si ctx.ellipse no está disponible
      ctx.save();
      ctx.translate(ellipse.x, ellipse.y);
      if (rotationRad) ctx.rotate(rotationRad);
      ctx.scale(ellipse.radiusX, ellipse.radiusY);
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.restore();
    }

    if (!isNonePaint(ellipse.fill) && ellipse.fill) {
      ctx.fillStyle = resolveRasterPaint(ctx, ellipse, ellipse.fill);
      ctx.fill();
    }

    if (!isNonePaint(ellipse.stroke) && ellipse.strokeWidth && ellipse.strokeWidth > 0 && ellipse.stroke) {
      ctx.lineWidth = ellipse.strokeWidth;
      ctx.strokeStyle = resolveRasterPaint(ctx, ellipse, ellipse.stroke);
      ctx.stroke();
    }
  } else if (shape.type === 'path') {
    const path = shape as Path;
    if (path.points && path.points.length > 0) {
      if (path.rotation) {
        const baseAABB = getPathBaseAABB(path);
        const cx = (baseAABB.minX + baseAABB.maxX) / 2;
        const cy = (baseAABB.minY + baseAABB.maxY) / 2;
        ctx.translate(cx, cy);
        ctx.rotate((path.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }

      const hasCornerRadius = Boolean(
        (path.cornerRadius && path.cornerRadius > 0) ||
        path.points.some((p) => p.cornerRadius && p.cornerRadius > 0)
      );
      const points = hasCornerRadius
        ? smoothPathPoints(path.points, Boolean(path.closed), path.cornerRadius)
        : path.points;
      ctx.beginPath();
      let subpathStartIdx = 0;

      for (let i = 0; i < points.length; i++) {
        const curr = points[i];
        if (i === 0 || curr.moveTo) {
          if (i > 0) {
            const prevStart = points[subpathStartIdx];
            const last = points[i - 1];
            const shouldClose = last.closeSubpath ?? path.closed;
            if (shouldClose && i - subpathStartIdx > 1) {
              const cp1x = last.handleOut ? last.handleOut.x : last.x;
              const cp1y = last.handleOut ? last.handleOut.y : last.y;
              const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
              const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
              ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, prevStart.x, prevStart.y);
              ctx.closePath();
            }
          }
          subpathStartIdx = i;
          ctx.moveTo(curr.x, curr.y);
        } else {
          const prev = points[i - 1];
          const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
          const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
          const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
          const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
        }
      }

      if (points.length > 0) {
        const prevStart = points[subpathStartIdx];
        const last = points[points.length - 1];
        const shouldClose = last.closeSubpath ?? path.closed;
        if (shouldClose && points.length - subpathStartIdx > 1) {
          const cp1x = last.handleOut ? last.handleOut.x : last.x;
          const cp1y = last.handleOut ? last.handleOut.y : last.y;
          const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
          const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, prevStart.x, prevStart.y);
          ctx.closePath();
        }
      }

      if (!isNonePaint(path.fill) && path.fill) {
        ctx.fillStyle = resolveRasterPaint(ctx, path, path.fill);
        ctx.fill(path.fillRule ?? 'nonzero');
      }

      if (!isNonePaint(path.stroke) && path.strokeWidth && path.strokeWidth > 0 && path.stroke) {
        ctx.lineWidth = path.strokeWidth;
        ctx.strokeStyle = resolveRasterPaint(ctx, path, path.stroke);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
  } else if (shape.type === 'text') {
    const text = shape as Text;
    const hasFill = text.fill === undefined || !isNonePaint(text.fill);
    const hasStroke = !isNonePaint(text.stroke) && (text.strokeWidth ?? 1) > 0;

    if (hasFill || hasStroke) {
      const fontParts: string[] = [];
      if (text.fontStyle && text.fontStyle !== 'normal') {
        fontParts.push(text.fontStyle);
      }
      if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
        fontParts.push(String(text.fontWeight));
      }
      const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
      const fontFamily = text.fontFamily ?? 'sans-serif';
      fontParts.push(`${fontSize}px`);
      fontParts.push(fontFamily);
      ctx.font = fontParts.join(' ');

      ctx.textAlign = text.textAlign ?? 'left';
      ctx.textBaseline = 'top';

      ctx.fillStyle = resolveRasterPaint(ctx, text, text.fill, '#000000');
      if (hasStroke && text.stroke) {
        ctx.strokeStyle = resolveRasterPaint(ctx, text, text.stroke, '#000000');
        ctx.lineWidth = text.strokeWidth ?? 1;
        ctx.lineJoin = 'round';
      }

      if (text.rotation) {
        ctx.translate(text.x, text.y);
        ctx.rotate((text.rotation * Math.PI) / 180);
        ctx.translate(-text.x, -text.y);
      }

      if ('letterSpacing' in ctx) {
        const letterSpacing = typeof text.letterSpacing === 'number' && Number.isFinite(text.letterSpacing) ? text.letterSpacing : 0;
        try {
          (ctx as any).letterSpacing = `${letterSpacing}px`;
        } catch (_) {}
      }

      const lineHeight = getTextLineHeight(text);
      const lines = getTextLineRanges(text, ctx);

      for (let i = 0; i < lines.length; i++) {
        const lineY = text.y + i * lineHeight;
        if (hasFill && typeof ctx.fillText === 'function') {
          ctx.fillText(lines[i].text, text.x, lineY);
        }
        if (hasStroke && typeof ctx.strokeText === 'function') {
          ctx.strokeText(lines[i].text, text.x, lineY);
        }
      }
    }
  } else if (shape.type === 'image') {
    const img = shape as ImageNode;
    if (img.rotation) {
      const cx = img.x + img.width / 2;
      const cy = img.y + img.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((img.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    const renderable = assetManager.getRenderable(img.assetId);
    if (renderable && typeof ctx.drawImage === 'function') {
      try {
        ctx.drawImage(renderable as CanvasImageSource, img.x, img.y, img.width, img.height);
      } catch {
        // Fallback placeholder
      }
    }
  } else if (shape.type === 'polygon') {
    const poly = shape as Polygon;
    if (poly.rotation) {
      ctx.translate(poly.x, poly.y);
      ctx.rotate((poly.rotation * Math.PI) / 180);
      ctx.translate(-poly.x, -poly.y);
    }
    ctx.beginPath();
    if (poly.cornerRadius && poly.cornerRadius > 0) {
      const smoothedPts = getPolygonPathPoints({ ...poly, rotation: 0 });
      drawSmoothedRasterPoints(ctx, smoothedPts);
    } else {
      const verts = getPolygonBaseVertices(poly);
      if (verts.length > 0) {
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) {
          ctx.lineTo(verts[i].x, verts[i].y);
        }
        ctx.closePath();
      }
    }
    if (!isNonePaint(poly.fill) && poly.fill) {
      ctx.fillStyle = resolveRasterPaint(ctx, poly, poly.fill);
      ctx.fill();
    }
    if (!isNonePaint(poly.stroke) && poly.strokeWidth && poly.strokeWidth > 0 && poly.stroke) {
      ctx.lineWidth = poly.strokeWidth;
      ctx.strokeStyle = resolveRasterPaint(ctx, poly, poly.stroke);
      ctx.stroke();
    }
  } else if (shape.type === 'star') {
    const star = shape as Star;
    if (star.rotation) {
      ctx.translate(star.x, star.y);
      ctx.rotate((star.rotation * Math.PI) / 180);
      ctx.translate(-star.x, -star.y);
    }
    ctx.beginPath();
    if ((star.cornerRadius && star.cornerRadius > 0) || (star.innerCornerRadius && star.innerCornerRadius > 0)) {
      const smoothedPts = getStarPathPoints({ ...star, rotation: 0 });
      drawSmoothedRasterPoints(ctx, smoothedPts);
    } else {
      const verts = getStarBaseVertices(star);
      if (verts.length > 0) {
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) {
          ctx.lineTo(verts[i].x, verts[i].y);
        }
        ctx.closePath();
      }
    }
    if (!isNonePaint(star.fill) && star.fill) {
      ctx.fillStyle = resolveRasterPaint(ctx, star, star.fill);
      ctx.fill();
    }
    if (!isNonePaint(star.stroke) && star.strokeWidth && star.strokeWidth > 0 && star.stroke) {
      ctx.lineWidth = star.strokeWidth;
      ctx.strokeStyle = resolveRasterPaint(ctx, star, star.stroke);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Renderiza recursivamente un nodo (grupo o figura)
 */
function renderChildNode(
  ctx: CanvasRenderingContext2D,
  child: LayerChildNode,
  selectedSet: Set<string> | null
): void {
  if (child.visible === false) {
    return;
  }

  if (selectedSet) {
    if (isGroup(child)) {
      const leaves = collectLeafShapes(child);
      const isSelfSelected = selectedSet.has(child.id);
      const hasSelectedLeaf = leaves.some((leaf) => selectedSet.has(leaf.id));
      if (!isSelfSelected && !hasSelectedLeaf) {
        return;
      }
    } else if (!selectedSet.has(child.id)) {
      return;
    }
  }

  if (isGroup(child)) {
    ctx.save();
    if (typeof child.opacity === 'number') {
      ctx.globalAlpha *= Math.max(0, Math.min(1, child.opacity));
    }

    if (child.isClipMask === true && child.children.length > 0) {
      const maskChild = child.clipChildId
        ? child.children.find((c) => c.id === child.clipChildId)
        : child.children[child.children.length - 1];

      if (maskChild && isShape(maskChild)) {
        traceShapeClip(ctx, maskChild);
        for (const nested of child.children) {
          if (nested.id === maskChild.id) {
            continue;
          }
          renderChildNode(ctx, nested, selectedSet);
        }
        ctx.restore();
        return;
      }
    }

    for (const nested of child.children) {
      renderChildNode(ctx, nested, selectedSet);
    }
    ctx.restore();
  } else if (isShape(child)) {
    renderShapeToContext(ctx, child);
  }
}

/**
 * Renderiza el árbol del Scene Graph en un elemento Canvas off-screen
 * aplicando traslación de bounds, escala de resolución y color de fondo.
 */
export function renderDocumentToCanvas(
  doc: Document,
  options: RasterExportOptions = {}
): HTMLCanvasElement {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('[RasterExport] La exportación ráster requiere un entorno DOM con canvas.');
  }

  const scale = Math.max(0.1, options.scale ?? 1);
  const onlySelected = options.onlySelected === true;
  const selectedIds = options.selectedIds ?? [];

  const bounds = calculateExportBounds(doc, onlySelected, selectedIds, options.artboardId);
  const widthPx = Math.max(1, Math.ceil(bounds.width * scale));
  const heightPx = Math.max(1, Math.ceil(bounds.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[RasterExport] No se pudo obtener el contexto 2D del canvas de exportación.');
  }

  // Configuración de fondo
  const format = options.format ?? 'png';
  let bgColor = options.backgroundColor;
  if (format === 'jpeg' && (bgColor === null || bgColor === undefined)) {
    bgColor = '#ffffff'; // JPEG no soporta transparencia
  }

  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, widthPx, heightPx);
  } else {
    ctx.clearRect(0, 0, widthPx, heightPx);
  }

  // Aplicar transformación de escala y centrado respecto a bounds
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  const selectedSet = onlySelected && selectedIds.length > 0 ? new Set(selectedIds) : null;

  for (const layer of doc.children) {
    if (layer.visible === false) {
      continue;
    }

    ctx.save();
    if (typeof layer.opacity === 'number') {
      ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
    }

    for (const child of layer.children) {
      renderChildNode(ctx, child, selectedSet);
    }

    ctx.restore();
  }

  ctx.restore();
  return canvas;
}

/**
 * Exporta el documento como un Blob en formato PNG, WebP o JPEG.
 */
export function exportDocumentToRasterBlob(
  doc: Document,
  options: RasterExportOptions = {}
): Promise<Blob> {
  const canvas = renderDocumentToCanvas(doc, options);
  const format = options.format ?? 'png';
  const mimeType = format === 'webp' ? 'image/webp' : format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = options.quality ?? 0.95;

  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error(`[RasterExport] No se pudo generar el Blob para ${mimeType}`));
          }
        },
        mimeType,
        quality
      );
    } else {
      // Fallback a toDataURL si toBlob no está disponible
      try {
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const byteString = atob(dataUrl.split(',')[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        resolve(new Blob([ab], { type: mimeType }));
      } catch (err) {
        reject(err);
      }
    }
  });
}

/**
 * Dispara la descarga local en el navegador de un archivo Blob de imagen ráster.
 *
 * @param filename Nombre del archivo (ej: 'escena.png')
 * @param blob Objeto Blob de la imagen
 */
export function downloadRaster(filename: string, blob: Blob): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  anchor.setAttribute('aria-hidden', 'true');

  document.body.appendChild(anchor);
  anchor.click();

  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

function drawSmoothedRasterPoints(
  ctx: CanvasRenderingContext2D,
  points: readonly import('../types/scene-graph.ts').PathPoint[]
): void {
  if (points.length === 0) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.handleOut || curr.handleIn) {
      const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
      const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
      const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
      const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
    } else {
      ctx.lineTo(curr.x, curr.y);
    }
  }
  const last = points[points.length - 1];
  const first = points[0];
  if (last.handleOut || first.handleIn) {
    const cp1x = last.handleOut ? last.handleOut.x : last.x;
    const cp1y = last.handleOut ? last.handleOut.y : last.y;
    const cp2x = first.handleIn ? first.handleIn.x : first.x;
    const cp2y = first.handleIn ? first.handleIn.y : first.y;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x, first.y);
  }
  ctx.closePath();
}

