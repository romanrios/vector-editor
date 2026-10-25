import {
  isShape,
  type AABB,
  type DropShadow,
  type Ellipse,
  type Group,
  type LayerChildNode,
  type Path,
  type PathPoint,
  type Rectangle,
  type Text,
} from '../../types/scene-graph.ts';
import type { CssRule, SvgContext, SvgElementLike, SvgRawGradient } from './types.ts';
import { nextId } from './types.ts';
import { applyTransform, decomposeMatrix, multiplyMatrices } from './matrix.ts';
import { parseSvgPathD } from './pathParser.ts';
import { parseInlineStyle, resolveElementStyles } from './styles.ts';
import { materializeGradient } from './gradients.ts';
import { getPathBaseAABB } from '../geometry.ts';

/**
 * Parsea un nodo del DOM SVG recursivamente y devuelve los nodos LayerChildNode correspondientes.
 */
export function parseSvgElement(
  el: SvgElementLike,
  parentContext: SvgContext,
  cssRules: CssRule[],
  gradients: Map<string, SvgRawGradient>,
  filters?: Map<string, DropShadow>
): LayerChildNode | null {
  const tagName = el.tagName.toLowerCase();

  // Ignorar etiquetas de metadatos o no gráficas
  if (
    tagName === 'defs' ||
    tagName === 'style' ||
    tagName === 'title' ||
    tagName === 'desc' ||
    tagName === 'metadata' ||
    tagName === 'clippath'
  ) {
    return null;
  }

  // Comprobar visibilidad
  const inline = parseInlineStyle(el.getAttribute('style'));
  if (inline['display'] === 'none' || inline['visibility'] === 'hidden') {
    return null;
  }
  if (el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden') {
    return null;
  }

  // Resolver estilos heredados y combinados
  const context = resolveElementStyles(el, parentContext, cssRules, gradients, filters);
  const nameAttr = el.getAttribute('id') || el.getAttribute('data-name') || tagName;

  // 1. Grupos (<g>)
  if (tagName === 'g') {
    const children: LayerChildNode[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const childNode = parseSvgElement(el.children[i], context, cssRules, gradients, filters);
      if (childNode) children.push(childNode);
    }
    if (children.length === 0) return null;

    const clipPathAttr = el.getAttribute('clip-path') || el.getAttribute('clipPath') || inline['clip-path'];
    let isClipMask = false;
    let clipChildId: string | undefined;

    if (clipPathAttr && clipPathAttr.includes('url(#')) {
      const match = clipPathAttr.match(/url\(#([^)]+)\)/);
      if (match && match[1]) {
        const clipId = match[1];
        let clipEl = el.ownerDocument?.getElementById ? el.ownerDocument.getElementById(clipId) : null;
        if (!clipEl && (el.ownerDocument as any)?.querySelector) {
          clipEl = (el.ownerDocument as any).querySelector(`#${clipId}`);
        }
        if (clipEl) {
          for (let c = 0; c < clipEl.children.length; c++) {
            const clipShape = parseSvgElement(clipEl.children[c], parentContext, cssRules, gradients, filters);
            if (clipShape && isShape(clipShape)) {
              isClipMask = true;
              clipChildId = clipShape.id;
              children.push(clipShape);
              break;
            }
          }
        }
      }
    }

    const group: Group = {
      id: nextId('group'),
      type: 'group',
      name: nameAttr,
      children,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
      ...(isClipMask ? { isClipMask: true, clipChildId } : {}),
    };
    return group;
  }

  // 2. Uso de símbolos (<use>)
  if (tagName === 'use') {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href');
    if (!href || !href.startsWith('#')) return null;
    const targetId = href.slice(1);
    let targetEl: SvgElementLike | null = null;
    if (el.ownerDocument?.getElementById) {
      targetEl = el.ownerDocument.getElementById(targetId);
    }
    if (!targetEl && (el.ownerDocument as any)?.querySelector) {
      targetEl = (el.ownerDocument as any).querySelector(`#${targetId}`);
    }
    if (!targetEl) return null;

    const useX = parseFloat(el.getAttribute('x') || '0');
    const useY = parseFloat(el.getAttribute('y') || '0');
    let useContext = { ...context };
    if (useX !== 0 || useY !== 0) {
      const tMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, useX, useY];
      useContext.transformMatrix = useContext.transformMatrix
        ? multiplyMatrices(useContext.transformMatrix, tMatrix)
        : tMatrix;
    }

    return parseSvgElement(targetEl, useContext, cssRules, gradients, filters);
  }

  // 3. Rectángulos (<rect>)
  if (tagName === 'rect') {
    const rawX = parseFloat(el.getAttribute('x') || '0');
    const rawY = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    if (w <= 0 || h <= 0) return null;

    const rx = parseFloat(el.getAttribute('rx') || el.getAttribute('ry') || '0');
    const { scaleX, scaleY, rotation } = decomposeMatrix(context.transformMatrix);
    const transformed = applyTransform({ x: rawX, y: rawY }, context.transformMatrix);
    const rectW = w * scaleX;
    const rectH = h * scaleY;
    const rectAABB: AABB = {
      minX: transformed.x,
      minY: transformed.y,
      maxX: transformed.x + rectW,
      maxY: transformed.y + rectH,
      width: rectW,
      height: rectH,
    };

    const rect: Rectangle = {
      id: nextId('rect'),
      type: 'rectangle',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      width: rectW,
      height: rectH,
      cornerRadius: rx > 0 ? rx * Math.min(scaleX, scaleY) : undefined,
      fill: materializeGradient(context.fill, rectAABB) ?? '#000000',
      stroke: materializeGradient(context.stroke, rectAABB) ?? 'none',
      strokeWidth: context.strokeWidth ? context.strokeWidth * Math.min(scaleX, scaleY) : 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      rotation: rotation !== 0 ? rotation : undefined,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return rect;
  }

  // 4. Círculos y Elipses (<circle>, <ellipse>)
  if (tagName === 'circle' || tagName === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = tagName === 'circle' ? parseFloat(el.getAttribute('r') || '0') : parseFloat(el.getAttribute('rx') || '0');
    const ry = tagName === 'circle' ? parseFloat(el.getAttribute('r') || '0') : parseFloat(el.getAttribute('ry') || '0');
    if (rx <= 0 || ry <= 0) return null;

    const { scaleX, scaleY, rotation } = decomposeMatrix(context.transformMatrix);
    const transformed = applyTransform({ x: cx, y: cy }, context.transformMatrix);
    const radX = rx * scaleX;
    const radY = ry * scaleY;
    const ellipseAABB: AABB = {
      minX: transformed.x - radX,
      minY: transformed.y - radY,
      maxX: transformed.x + radX,
      maxY: transformed.y + radY,
      width: radX * 2,
      height: radY * 2,
    };

    const ellipse: Ellipse = {
      id: nextId('ellipse'),
      type: 'ellipse',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      radiusX: radX,
      radiusY: radY,
      fill: materializeGradient(context.fill, ellipseAABB) ?? '#000000',
      stroke: materializeGradient(context.stroke, ellipseAABB) ?? 'none',
      strokeWidth: context.strokeWidth ? context.strokeWidth * Math.min(scaleX, scaleY) : 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      rotation: rotation !== 0 ? rotation : undefined,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return ellipse;
  }

  // 5. Trazados (<path>)
  if (tagName === 'path') {
    const d = el.getAttribute('d');
    if (!d) return null;

    const { points: rawPoints, closed } = parseSvgPathD(d);
    if (rawPoints.length === 0) return null;

    // Aplicar transformación completa a puntos de ancla y manejadores
    const points: PathPoint[] = rawPoints.map((pt) => {
      const transformedPt = applyTransform({ x: pt.x, y: pt.y }, context.transformMatrix);
      const transformedIn = pt.handleIn ? applyTransform(pt.handleIn, context.transformMatrix) : undefined;
      const transformedOut = pt.handleOut ? applyTransform(pt.handleOut, context.transformMatrix) : undefined;
      return {
        x: transformedPt.x,
        y: transformedPt.y,
        ...(transformedIn ? { handleIn: transformedIn } : {}),
        ...(transformedOut ? { handleOut: transformedOut } : {}),
        pointType: pt.pointType,
        ...(pt.moveTo ? { moveTo: true } : {}),
        ...(pt.closeSubpath ? { closeSubpath: true } : {}),
      };
    });

    const pathAABB = getPathBaseAABB({ points } as unknown as Path);
    const resolvedFill = materializeGradient(context.fill, pathAABB);
    const resolvedStroke = materializeGradient(context.stroke, pathAABB);

    let finalFill = resolvedFill;
    let finalStroke = resolvedStroke;

    // Si el trazado es abierto y tiene trazo definido, pero no fill explícito en el elemento, fill es 'none'
    if (finalFill === undefined) {
      if (!closed && finalStroke && finalStroke !== 'none') {
        finalFill = 'none';
      } else {
        finalFill = '#000000';
      }
    }

    if (finalStroke === undefined) {
      finalStroke = 'none';
    }

    const pathNode: Path = {
      id: nextId('path'),
      type: 'path',
      name: nameAttr,
      x: points[0].x,
      y: points[0].y,
      points,
      closed,
      fill: finalFill,
      stroke: finalStroke,
      strokeWidth: context.strokeWidth ?? 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
      fillRule: context.fillRule,
    };
    return pathNode;
  }

  // 6. Líneas (<line>)
  if (tagName === 'line') {
    const x1 = parseFloat(el.getAttribute('x1') || '0');
    const y1 = parseFloat(el.getAttribute('y1') || '0');
    const x2 = parseFloat(el.getAttribute('x2') || '0');
    const y2 = parseFloat(el.getAttribute('y2') || '0');

    const pt1 = applyTransform({ x: x1, y: y1 }, context.transformMatrix);
    const pt2 = applyTransform({ x: x2, y: y2 }, context.transformMatrix);
    const linePoints: PathPoint[] = [
      { x: pt1.x, y: pt1.y, pointType: 'corner' },
      { x: pt2.x, y: pt2.y, pointType: 'corner' },
    ];
    const lineAABB = getPathBaseAABB({ points: linePoints } as unknown as Path);
    const resolvedStroke = materializeGradient(context.stroke, lineAABB);

    const path: Path = {
      id: nextId('line'),
      type: 'path',
      name: nameAttr,
      x: pt1.x,
      y: pt1.y,
      points: linePoints,
      closed: false,
      fill: 'none',
      stroke: resolvedStroke ?? '#000000',
      strokeWidth: context.strokeWidth ?? 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return path;
  }

  // 7. Polilíneas y Polígonos (<polyline>, <polygon>)
  if (tagName === 'polyline' || tagName === 'polygon') {
    const pointsAttr = el.getAttribute('points') || '';
    const coords = pointsAttr
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => !isNaN(n));

    if (coords.length < 4) return null;

    const points: PathPoint[] = [];
    for (let c = 0; c < coords.length; c += 2) {
      const pt = applyTransform({ x: coords[c], y: coords[c + 1] }, context.transformMatrix);
      points.push({ x: pt.x, y: pt.y, pointType: 'corner' });
    }

    const polyAABB = getPathBaseAABB({ points } as unknown as Path);
    const isPolygon = tagName === 'polygon';
    const defaultFill = isPolygon ? '#000000' : 'none';
    const resolvedFill = materializeGradient(context.fill, polyAABB);
    const resolvedStroke = materializeGradient(context.stroke, polyAABB);

    const path: Path = {
      id: nextId(tagName),
      type: 'path',
      name: nameAttr,
      x: points[0].x,
      y: points[0].y,
      points,
      closed: isPolygon,
      fill: resolvedFill ?? defaultFill,
      stroke: resolvedStroke ?? (isPolygon ? 'none' : '#000000'),
      strokeWidth: context.strokeWidth ?? 1,
      strokeLineCap: context.strokeLineCap,
      strokeLineJoin: context.strokeLineJoin,
      strokeDashArray: context.strokeDashArray,
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
      fillRule: context.fillRule,
    };
    return path;
  }

  // 8. Texto (<text>)
  if (tagName === 'text') {
    const rawX = parseFloat(el.getAttribute('x') || '0');
    const rawY = parseFloat(el.getAttribute('y') || '0');
    const content = el.textContent?.trim() || '';
    if (!content) return null;

    const transformed = applyTransform({ x: rawX, y: rawY }, context.transformMatrix);
    const fontSize = parseFloat(el.getAttribute('font-size') || '16') || 16;
    const fontFamily = el.getAttribute('font-family') || 'sans-serif';

    const textW = Math.max(10, content.length * fontSize * 0.6);
    const textH = Math.max(10, fontSize * 1.2);
    const textAABB: AABB = {
      minX: transformed.x,
      minY: transformed.y - fontSize,
      maxX: transformed.x + textW,
      maxY: transformed.y - fontSize + textH,
      width: textW,
      height: textH,
    };

    const textNode: Text = {
      id: nextId('text'),
      type: 'text',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      text: content,
      fontSize,
      fontFamily,
      fill: (materializeGradient(context.fill, textAABB) as any) ?? '#000000',
      opacity: context.opacity,
      ...(context.blendMode ? { blendMode: context.blendMode } : {}),
      ...(context.dropShadow ? { dropShadow: context.dropShadow } : {}),
    };
    return textNode;
  }

  return null;
}
