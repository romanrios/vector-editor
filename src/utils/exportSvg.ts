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
  AssetData,
  SelectableNode,
  Gradient,
  Shape,
} from '../types/scene-graph.ts';
import { isGroup, isShape, isGradient, isLinearGradient } from '../types/scene-graph.ts';
import { isNonePaint } from './color.ts';
import { getPathBaseAABB, getGroupAABB, getTextLineHeight, getWrappedTextLines, getPolygonBaseVertices, getStarBaseVertices } from './geometry.ts';
import { getShapeBaseAABB } from './gradient.ts';
import { smoothPathPoints, getPolygonPathPoints, getStarPathPoints } from './cornerSmoothing.ts';

interface ExportGradientEntry {
  readonly id: string;
  readonly gradient: Gradient;
  readonly shape: Shape;
}

function collectGradientsFromChild(
  child: LayerChildNode,
  selectedSet: Set<string> | null
): ExportGradientEntry[] {
  if (child.visible === false) {
    return [];
  }

  if (selectedSet) {
    if (isGroup(child)) {
      const leaves = collectLeafShapes(child);
      const anySelected = leaves.some((l) => selectedSet.has(l.id)) || selectedSet.has(child.id);
      if (!anySelected) {
        return [];
      }
    } else if (!selectedSet.has(child.id)) {
      return [];
    }
  }

  const entries: ExportGradientEntry[] = [];
  if (isGroup(child)) {
    for (const nested of child.children) {
      entries.push(...collectGradientsFromChild(nested, selectedSet));
    }
  } else if (isShape(child)) {
    if (isGradient(child.fill)) {
      entries.push({ id: `gradient-${child.id}-fill`, gradient: child.fill, shape: child });
    }
    if (isGradient(child.stroke)) {
      entries.push({ id: `gradient-${child.id}-stroke`, gradient: child.stroke, shape: child });
    }
  }
  return entries;
}

interface ExportClipMaskEntry {
  readonly groupId: string;
  readonly maskShape: Shape;
}

function collectClipMasksFromChild(
  child: LayerChildNode,
  selectedSet: Set<string> | null
): ExportClipMaskEntry[] {
  if (child.visible === false) {
    return [];
  }

  if (selectedSet) {
    if (isGroup(child)) {
      const leaves = collectLeafShapes(child);
      const anySelected = leaves.some((l) => selectedSet.has(l.id)) || selectedSet.has(child.id);
      if (!anySelected) {
        return [];
      }
    } else if (!selectedSet.has(child.id)) {
      return [];
    }
  }

  const entries: ExportClipMaskEntry[] = [];
  if (isGroup(child)) {
    if (child.isClipMask && child.children.length > 0) {
      const maskChild = child.clipChildId
        ? child.children.find((c) => c.id === child.clipChildId)
        : child.children[child.children.length - 1];
      if (maskChild && isShape(maskChild)) {
        entries.push({
          groupId: child.id,
          maskShape: maskChild,
        });
      }
    }
    for (const nested of child.children) {
      entries.push(...collectClipMasksFromChild(nested, selectedSet));
    }
  }
  return entries;
}

/**
 * Opciones para la exportación de documentos a SVG
 */
export interface SvgExportOptions {
  /**
   * Si es true, exporta únicamente los elementos actualmente seleccionados
   * recortando el viewBox a su caja delimitadora combinada.
   */
  readonly onlySelected?: boolean;

  /**
   * Lista de IDs de nodos seleccionados (necesario si onlySelected es true).
   */
  readonly selectedIds?: readonly string[];

  /**
   * Si es true, incluye un rectángulo de fondo opaco.
   */
  readonly includeBackground?: boolean;

  /**
   * Color de fondo si includeBackground es true (por defecto '#ffffff').
   */
  readonly backgroundColor?: string;

  /**
   * Número de decimales para coordenadas y dimensiones (por defecto 2).
   */
  readonly precision?: number;

  /**
   * Identificador opcional de la Mesa de Trabajo a exportar.
   */
  readonly artboardId?: string;
}

/**
 * Escapa caracteres reservados en XML / SVG
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatNum(num: number, precision: number = 2): string {
  if (Number.isInteger(num)) {
    return String(num);
  }
  const factor = Math.pow(10, precision);
  const rounded = Math.round(num * factor) / factor;
  return String(rounded);
}

/**
 * Obtiene todas las figuras hoja contenidas en un nodo
 */
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

/**
 * Genera el string del atributo 'd' para un trazado Bézier en SVG
 */
function buildPathData(path: Path, precision: number): string {
  const hasCornerRadius = Boolean(
    (path.cornerRadius && path.cornerRadius > 0) ||
    path.points.some((p) => p.cornerRadius && p.cornerRadius > 0)
  );
  const rawPoints = hasCornerRadius
    ? smoothPathPoints(path.points, Boolean(path.closed), path.cornerRadius)
    : path.points;
  return buildPathDataFromPoints(rawPoints, Boolean(path.closed), precision);
}

function buildPathDataFromPoints(points: readonly import('../types/scene-graph.ts').PathPoint[], closed: boolean, precision: number): string {
  if (!points || points.length === 0) {
    return '';
  }

  const parts: string[] = [];
  let subpathStartIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (i === 0 || curr.moveTo) {
      if (i > 0) {
        const prevStart = points[subpathStartIdx];
        const last = points[i - 1];
        const shouldClose = last.closeSubpath ?? closed;
        if (shouldClose && i - subpathStartIdx > 1) {
          const cp1x = last.handleOut ? last.handleOut.x : last.x;
          const cp1y = last.handleOut ? last.handleOut.y : last.y;
          const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
          const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
          parts.push(
            `C ${formatNum(cp1x, precision)} ${formatNum(cp1y, precision)}, ${formatNum(cp2x, precision)} ${formatNum(cp2y, precision)}, ${formatNum(prevStart.x, precision)} ${formatNum(prevStart.y, precision)} Z`
          );
        }
      }
      subpathStartIdx = i;
      parts.push(`M ${formatNum(curr.x, precision)} ${formatNum(curr.y, precision)}`);
    } else {
      const prev = points[i - 1];
      const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
      const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
      const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
      const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;

      parts.push(
        `C ${formatNum(cp1x, precision)} ${formatNum(cp1y, precision)}, ${formatNum(cp2x, precision)} ${formatNum(cp2y, precision)}, ${formatNum(curr.x, precision)} ${formatNum(curr.y, precision)}`
      );
    }
  }

  if (points.length > 0) {
    const prevStart = points[subpathStartIdx];
    const last = points[points.length - 1];
    const shouldClose = last.closeSubpath ?? closed;
    if (shouldClose && points.length - subpathStartIdx > 1) {
      const cp1x = last.handleOut ? last.handleOut.x : last.x;
      const cp1y = last.handleOut ? last.handleOut.y : last.y;
      const cp2x = prevStart.handleIn ? prevStart.handleIn.x : prevStart.x;
      const cp2y = prevStart.handleIn ? prevStart.handleIn.y : prevStart.y;
      parts.push(
        `C ${formatNum(cp1x, precision)} ${formatNum(cp1y, precision)}, ${formatNum(cp2x, precision)} ${formatNum(cp2y, precision)}, ${formatNum(prevStart.x, precision)} ${formatNum(prevStart.y, precision)} Z`
      );
    }
  }

  return parts.join(' ');
}

/**
 * Renderiza un nodo individual o grupo a SVG XML
 */
function renderChildToSvg(
  child: LayerChildNode,
  selectedSet: Set<string> | null,
  precision: number,
  indent: string,
  assets?: Readonly<Record<string, AssetData>>
): string[] {
  if (child.visible === false) {
    return [];
  }

  // Si se filtra por selección, verificar si este nodo o algún descendiente está seleccionado
  if (selectedSet) {
    if (isGroup(child)) {
      const leaves = collectLeafShapes(child);
      const isSelfSelected = selectedSet.has(child.id);
      const hasSelectedLeaf = leaves.some((leaf) => selectedSet.has(leaf.id));
      if (!isSelfSelected && !hasSelectedLeaf) {
        return [];
      }
    } else if (!selectedSet.has(child.id)) {
      return [];
    }
  }

  const lines: string[] = [];

  if (isGroup(child)) {
    const groupAttrs: string[] = [`id="${escapeXml(child.id)}"`];
    if (child.name) {
      groupAttrs.push(`data-name="${escapeXml(child.name)}"`);
    }
    if (typeof child.opacity === 'number' && child.opacity < 1 && child.opacity >= 0) {
      groupAttrs.push(`opacity="${formatNum(child.opacity, 3)}"`);
    }

    let maskChildId: string | null = null;
    if (child.isClipMask && child.children.length > 0) {
      groupAttrs.push(`clip-path="url(#clip-${escapeXml(child.id)})"`);
      const maskChild = child.clipChildId
        ? child.children.find((c) => c.id === child.clipChildId)
        : child.children[child.children.length - 1];
      if (maskChild) {
        maskChildId = maskChild.id;
      }
    }

    lines.push(`${indent}<g ${groupAttrs.join(' ')}>`);
    for (const nested of child.children) {
      if (nested.id === maskChildId) {
        continue;
      }
      lines.push(...renderChildToSvg(nested, selectedSet, precision, `${indent}  `, assets));
    }
    lines.push(`${indent}</g>`);
    return lines;
  }

  // Atributos comunes de figura
  const commonAttrs: string[] = [`id="${escapeXml(child.id)}"`];
  if (child.name) {
    commonAttrs.push(`data-name="${escapeXml(child.name)}"`);
  }
  if (typeof child.opacity === 'number' && child.opacity < 1 && child.opacity >= 0) {
    commonAttrs.push(`opacity="${formatNum(child.opacity, 3)}"`);
  }

  // Relleno
  if (isNonePaint(child.fill)) {
    commonAttrs.push('fill="none"');
  } else if (child.fill) {
    if (isGradient(child.fill)) {
      commonAttrs.push(`fill="url(#gradient-${child.id}-fill)"`);
    } else {
      commonAttrs.push(`fill="${escapeXml(child.fill)}"`);
    }
  } else {
    // Por especificación SVG, si fill se omite el valor predeterminado es negro.
    // En Vectedit, si no se define fill en figuras geométricas, no se dibuja relleno.
    commonAttrs.push(child.type === 'text' ? 'fill="#000000"' : 'fill="none"');
  }

  // Trazo
  if (!isNonePaint(child.stroke) && child.stroke && child.strokeWidth && child.strokeWidth > 0) {
    if (isGradient(child.stroke)) {
      commonAttrs.push(`stroke="url(#gradient-${child.id}-stroke)"`);
    } else {
      commonAttrs.push(`stroke="${escapeXml(child.stroke)}"`);
    }
    commonAttrs.push(`stroke-width="${formatNum(child.strokeWidth, precision)}"`);
    if (child.strokeDashArray && child.strokeDashArray.length > 0) {
      commonAttrs.push(`stroke-dasharray="${child.strokeDashArray.map((v) => formatNum(v, precision)).join(' ')}"`);
    }
    const lineCap = child.strokeLineCap ?? (child.type === 'path' ? 'round' : undefined);
    if (lineCap) {
      commonAttrs.push(`stroke-linecap="${escapeXml(lineCap)}"`);
    }
    const lineJoin = child.strokeLineJoin ?? (child.type === 'path' ? 'round' : undefined);
    if (lineJoin) {
      commonAttrs.push(`stroke-linejoin="${escapeXml(lineJoin)}"`);
    }
  } else {
    commonAttrs.push('stroke="none"');
  }

  if (child.type === 'rectangle') {
    const rect = child as Rectangle;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    const attrs = [
      ...commonAttrs,
      `x="${formatNum(rect.x, precision)}"`,
      `y="${formatNum(rect.y, precision)}"`,
      `width="${formatNum(rect.width, precision)}"`,
      `height="${formatNum(rect.height, precision)}"`,
    ];

    if (rect.cornerRadius && rect.cornerRadius > 0) {
      attrs.push(`rx="${formatNum(rect.cornerRadius, precision)}"`);
      attrs.push(`ry="${formatNum(rect.cornerRadius, precision)}"`);
    }

    if (rect.rotation) {
      attrs.push(
        `transform="rotate(${formatNum(rect.rotation, precision)} ${formatNum(cx, precision)} ${formatNum(cy, precision)})"`
      );
    }

    lines.push(`${indent}<rect ${attrs.join(' ')} />`);
  } else if (child.type === 'ellipse') {
    const ellipse = child as Ellipse;
    const attrs = [
      ...commonAttrs,
      `cx="${formatNum(ellipse.x, precision)}"`,
      `cy="${formatNum(ellipse.y, precision)}"`,
      `rx="${formatNum(ellipse.radiusX, precision)}"`,
      `ry="${formatNum(ellipse.radiusY, precision)}"`,
    ];

    if (ellipse.rotation) {
      attrs.push(
        `transform="rotate(${formatNum(ellipse.rotation, precision)} ${formatNum(ellipse.x, precision)} ${formatNum(ellipse.y, precision)})"`
      );
    }

    lines.push(`${indent}<ellipse ${attrs.join(' ')} />`);
  } else if (child.type === 'path') {
    const path = child as Path;
    const d = buildPathData(path, precision);
    if (!d) {
      return [];
    }

    const attrs = [
      ...commonAttrs,
      `d="${d}"`,
    ];

    if (path.fillRule && path.fillRule !== 'nonzero') {
      attrs.push(`fill-rule="${escapeXml(path.fillRule)}"`);
    }

    if (path.rotation) {
      const baseAABB = getPathBaseAABB(path);
      const cx = (baseAABB.minX + baseAABB.maxX) / 2;
      const cy = (baseAABB.minY + baseAABB.maxY) / 2;
      attrs.push(
        `transform="rotate(${formatNum(path.rotation, precision)} ${formatNum(cx, precision)} ${formatNum(cy, precision)})"`
      );
    }

    lines.push(`${indent}<path ${attrs.join(' ')} />`);
  } else if (child.type === 'text') {
    const text = child as Text;
    const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
    const fontFamily = text.fontFamily ?? 'sans-serif';
    const lineHeight = getTextLineHeight(text);

    // Mapeo de alineación a text-anchor
    let textAnchor = 'start';
    if (text.textAlign === 'center') {
      textAnchor = 'middle';
    } else if (text.textAlign === 'right') {
      textAnchor = 'end';
    }

    const attrs = [
      ...commonAttrs,
      `x="${formatNum(text.x, precision)}"`,
      `y="${formatNum(text.y, precision)}"`,
      `font-family="${escapeXml(fontFamily)}"`,
      `font-size="${formatNum(fontSize, precision)}"`,
      `text-anchor="${textAnchor}"`,
      'dominant-baseline="hanging"',
    ];

    if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
      attrs.push(`font-weight="${escapeXml(String(text.fontWeight))}"`);
    }
    if (text.fontStyle && text.fontStyle !== 'normal') {
      attrs.push(`font-style="${escapeXml(text.fontStyle)}"`);
    }
    if (text.letterSpacing !== undefined && text.letterSpacing !== 0) {
      attrs.push(`letter-spacing="${formatNum(text.letterSpacing, precision)}px"`);
    }

    if (text.rotation) {
      attrs.push(
        `transform="rotate(${formatNum(text.rotation, precision)} ${formatNum(text.x, precision)} ${formatNum(text.y, precision)})"`
      );
    }

    const wrappedLines = getWrappedTextLines(text);
    if (wrappedLines.length <= 1) {
      const content = wrappedLines[0] !== undefined ? escapeXml(wrappedLines[0]) : escapeXml(text.text ?? '');
      lines.push(`${indent}<text ${attrs.join(' ')}>${content}</text>`);
    } else {
      lines.push(`${indent}<text ${attrs.join(' ')}>`);
      for (let i = 0; i < wrappedLines.length; i++) {
        const lineY = text.y + i * lineHeight;
        lines.push(
          `${indent}  <tspan x="${formatNum(text.x, precision)}" y="${formatNum(lineY, precision)}">${escapeXml(wrappedLines[i])}</tspan>`
        );
      }
      lines.push(`${indent}</text>`);
    }
  } else if (child.type === 'image') {
    const img = child as ImageNode;
    const asset = assets?.[img.assetId];
    const href = asset ? asset.data : '';
    const attrs = [
      `id="${escapeXml(img.id)}"`,
      `x="${formatNum(img.x, precision)}"`,
      `y="${formatNum(img.y, precision)}"`,
      `width="${formatNum(img.width, precision)}"`,
      `height="${formatNum(img.height, precision)}"`,
      `href="${escapeXml(href)}"`,
    ];

    if (img.name) {
      attrs.push(`data-name="${escapeXml(img.name)}"`);
    }
    if (typeof img.opacity === 'number' && img.opacity < 1 && img.opacity >= 0) {
      attrs.push(`opacity="${formatNum(img.opacity, 3)}"`);
    }
    if (img.rotation) {
      const cx = img.x + img.width / 2;
      const cy = img.y + img.height / 2;
      attrs.push(
        `transform="rotate(${formatNum(img.rotation, precision)} ${formatNum(cx, precision)} ${formatNum(cy, precision)})"`
      );
    }

    lines.push(`${indent}<image ${attrs.join(' ')} preserveAspectRatio="none" />`);
  } else if (child.type === 'polygon') {
    const poly = child as Polygon;
    if (poly.cornerRadius && poly.cornerRadius > 0) {
      const smoothedPts = getPolygonPathPoints({ ...poly, rotation: 0 });
      const d = buildPathDataFromPoints(smoothedPts, true, precision);
      const attrs = [
        ...commonAttrs,
        `d="${d}"`,
      ];
      if (poly.rotation) {
        attrs.push(
          `transform="rotate(${formatNum(poly.rotation, precision)} ${formatNum(poly.x, precision)} ${formatNum(poly.y, precision)})"`
        );
      }
      lines.push(`${indent}<path ${attrs.join(' ')} />`);
    } else {
      const verts = getPolygonBaseVertices(poly);
      const ptsStr = verts.map((v) => `${formatNum(v.x, precision)},${formatNum(v.y, precision)}`).join(' ');
      const attrs = [
        ...commonAttrs,
        `points="${ptsStr}"`,
      ];
      if (poly.rotation) {
        attrs.push(
          `transform="rotate(${formatNum(poly.rotation, precision)} ${formatNum(poly.x, precision)} ${formatNum(poly.y, precision)})"`
        );
      }
      lines.push(`${indent}<polygon ${attrs.join(' ')} />`);
    }
  } else if (child.type === 'star') {
    const star = child as Star;
    if ((star.cornerRadius && star.cornerRadius > 0) || (star.innerCornerRadius && star.innerCornerRadius > 0)) {
      const smoothedPts = getStarPathPoints({ ...star, rotation: 0 });
      const d = buildPathDataFromPoints(smoothedPts, true, precision);
      const attrs = [
        ...commonAttrs,
        `d="${d}"`,
      ];
      if (star.rotation) {
        attrs.push(
          `transform="rotate(${formatNum(star.rotation, precision)} ${formatNum(star.x, precision)} ${formatNum(star.y, precision)})"`
        );
      }
      lines.push(`${indent}<path ${attrs.join(' ')} />`);
    } else {
      const verts = getStarBaseVertices(star);
      const ptsStr = verts.map((v) => `${formatNum(v.x, precision)},${formatNum(v.y, precision)}`).join(' ');
      const attrs = [
        ...commonAttrs,
        `points="${ptsStr}"`,
      ];
      if (star.rotation) {
        attrs.push(
          `transform="rotate(${formatNum(star.rotation, precision)} ${formatNum(star.x, precision)} ${formatNum(star.y, precision)})"`
        );
      }
      lines.push(`${indent}<polygon ${attrs.join(' ')} />`);
    }
  }

  return lines;
}

/**
 * Busca todos los nodos seleccionables que coinciden con los IDs dados
 */
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
 * Exporta un documento Vectedit completo o una selección a una cadena de texto en formato SVG estándar.
 *
 * @param doc Documento raíz del Scene Graph
 * @param options Opciones de configuración (selección, fondo, precisión numérica)
 * @returns Cadena con código XML SVG completo y válido
 */
export function exportDocumentToSvg(doc: Document, options: SvgExportOptions = {}): string {
  const precision = options.precision ?? 2;
  const onlySelected = options.onlySelected === true;
  const selectedIds = options.selectedIds ?? [];

  let vx = 0;
  let vy = 0;
  let vw = Math.max(1, doc.width);
  let vh = Math.max(1, doc.height);

  const targetArtboard = options.artboardId && doc.artboards
    ? doc.artboards.find((a) => a.id === options.artboardId)
    : null;

  if (targetArtboard && !onlySelected) {
    vx = targetArtboard.x;
    vy = targetArtboard.y;
    vw = Math.max(1, targetArtboard.width);
    vh = Math.max(1, targetArtboard.height);
  } else if (!onlySelected && doc.artboards && doc.artboards.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ab of doc.artboards) {
      minX = Math.min(minX, ab.x);
      minY = Math.min(minY, ab.y);
      maxX = Math.max(maxX, ab.x + ab.width);
      maxY = Math.max(maxY, ab.y + ab.height);
    }
    if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
      vx = minX;
      vy = minY;
      vw = Math.max(1, maxX - minX);
      vh = Math.max(1, maxY - minY);
    }
  }

  let selectedSet: Set<string> | null = null;

  if (onlySelected && selectedIds.length > 0) {
    selectedSet = new Set(selectedIds);
    const selectedNodes = findSelectableNodes(doc, selectedIds);
    if (selectedNodes.length > 0) {
      // Importación diferida o cálculo de bounds de selección
      // Para evitar dependencia circular con geometry, calculamos bounds aquí o usamos getSelectionBounds
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
            if (leaf.type === 'rectangle') {
              const r = leaf as Rectangle;
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
        vx = minX;
        vy = minY;
        vw = maxX - minX;
        vh = maxY - minY;
      }
    }
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNum(vx, precision)} ${formatNum(vy, precision)} ${formatNum(vw, precision)} ${formatNum(vh, precision)}" width="${formatNum(vw, precision)}" height="${formatNum(vh, precision)}">`
  );

  // Recopilar y emitir definiciones de degradados (<defs>) y máscaras de recorte (<clipPath>)
  const allGradients: ExportGradientEntry[] = [];
  const allClipMasks: ExportClipMaskEntry[] = [];
  for (const layer of doc.children) {
    if (layer.visible === false) {
      continue;
    }
    for (const child of layer.children) {
      allGradients.push(...collectGradientsFromChild(child, selectedSet));
      allClipMasks.push(...collectClipMasksFromChild(child, selectedSet));
    }
  }

  if (allGradients.length > 0 || allClipMasks.length > 0) {
    lines.push('  <defs>');
    for (const entry of allGradients) {
      const grad = entry.gradient;
      const baseAABB = getShapeBaseAABB(entry.shape);
      if (isLinearGradient(grad)) {
        const x1 = baseAABB.minX + grad.x1 * baseAABB.width;
        const y1 = baseAABB.minY + grad.y1 * baseAABB.height;
        const x2 = baseAABB.minX + grad.x2 * baseAABB.width;
        const y2 = baseAABB.minY + grad.y2 * baseAABB.height;
        lines.push(
          `    <linearGradient id="${entry.id}" gradientUnits="userSpaceOnUse" x1="${formatNum(x1, precision)}" y1="${formatNum(y1, precision)}" x2="${formatNum(x2, precision)}" y2="${formatNum(y2, precision)}">`
        );
        for (const stop of grad.stops) {
          const stopOpacity = stop.opacity !== undefined ? ` stop-opacity="${formatNum(stop.opacity, 3)}"` : '';
          lines.push(
            `      <stop offset="${formatNum(stop.offset * 100, precision)}%" stop-color="${escapeXml(stop.color)}"${stopOpacity} />`
          );
        }
        lines.push('    </linearGradient>');
      } else {
        const cx = baseAABB.minX + grad.cx * baseAABB.width;
        const cy = baseAABB.minY + grad.cy * baseAABB.height;
        const maxDim = Math.max(baseAABB.width, baseAABB.height);
        const r = Math.max(0.1, grad.r * maxDim);
        const fx = grad.fx !== undefined ? baseAABB.minX + grad.fx * baseAABB.width : cx;
        const fy = grad.fy !== undefined ? baseAABB.minY + grad.fy * baseAABB.height : cy;

        const fxAttr = grad.fx !== undefined ? ` fx="${formatNum(fx, precision)}"` : '';
        const fyAttr = grad.fy !== undefined ? ` fy="${formatNum(fy, precision)}"` : '';
        lines.push(
          `    <radialGradient id="${entry.id}" gradientUnits="userSpaceOnUse" cx="${formatNum(cx, precision)}" cy="${formatNum(cy, precision)}" r="${formatNum(r, precision)}"${fxAttr}${fyAttr}>`
        );
        for (const stop of grad.stops) {
          const stopOpacity = stop.opacity !== undefined ? ` stop-opacity="${formatNum(stop.opacity, 3)}"` : '';
          lines.push(
            `      <stop offset="${formatNum(stop.offset * 100, precision)}%" stop-color="${escapeXml(stop.color)}"${stopOpacity} />`
          );
        }
        lines.push('    </radialGradient>');
      }
    }

    for (const clipEntry of allClipMasks) {
      lines.push(`    <clipPath id="clip-${escapeXml(clipEntry.groupId)}">`);
      const maskSvgLines = renderChildToSvg(clipEntry.maskShape, null, precision, '      ', doc.assets);
      lines.push(...maskSvgLines);
      lines.push('    </clipPath>');
    }

    lines.push('  </defs>');
  }

  // Fondo opcional
  if (options.includeBackground) {
    const bgColor = options.backgroundColor || targetArtboard?.backgroundColor || '#ffffff';
    lines.push(
      `  <rect x="${formatNum(vx, precision)}" y="${formatNum(vy, precision)}" width="${formatNum(vw, precision)}" height="${formatNum(vh, precision)}" fill="${escapeXml(bgColor)}" />`
    );
  }

  // Iterar capas
  for (const layer of doc.children) {
    if (layer.visible === false) {
      continue;
    }

    const layerAttrs: string[] = [`id="${escapeXml(layer.id)}"`];
    if (layer.name) {
      layerAttrs.push(`data-name="${escapeXml(layer.name)}"`);
    }
    if (typeof layer.opacity === 'number' && layer.opacity < 1 && layer.opacity >= 0) {
      layerAttrs.push(`opacity="${formatNum(layer.opacity, 3)}"`);
    }

    const layerContent: string[] = [];
    for (const child of layer.children) {
      layerContent.push(...renderChildToSvg(child, selectedSet, precision, '    ', doc.assets));
    }

    if (layerContent.length > 0) {
      lines.push(`  <g ${layerAttrs.join(' ')}>`);
      lines.push(...layerContent);
      lines.push('  </g>');
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

/**
 * Dispara la descarga local en el navegador de un archivo SVG.
 *
 * @param filename Nombre del archivo (ej: 'escena.svg')
 * @param svgContent Contenido del archivo SVG
 */
export function downloadSvg(filename: string, svgContent: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const normalizedFilename = filename.toLowerCase().endsWith('.svg')
    ? filename
    : `${filename}.svg`;

  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = normalizedFilename;
  anchor.style.display = 'none';
  anchor.setAttribute('aria-hidden', 'true');

  document.body.appendChild(anchor);
  anchor.click();

  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}
