import type {
  Ellipse,
  FillType,
  Group,
  LayerChildNode,
  Path,
  PathPoint,
  Rectangle,
  Text,
  Vector2D,
} from '../types/scene-graph.ts';

export interface SvgImportResult {
  readonly success: boolean;
  readonly shapes: readonly LayerChildNode[];
  readonly width: number;
  readonly height: number;
  readonly error?: string;
}

interface SvgContext {
  fill?: FillType;
  stroke?: FillType;
  strokeWidth?: number;
  opacity?: number;
  transformMatrix?: [number, number, number, number, number, number];
}

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}

/**
 * Parsea una cadena de comando SVG path 'd' y la convierte en una colección de puntos PathPoint.
 */
export function parseSvgPathD(d: string): { points: PathPoint[]; closed: boolean } {
  const points: PathPoint[] = [];
  let closed = false;

  // Normalizar y separar comandos y números
  const commandRegex = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = commandRegex.exec(d)) !== null) {
    tokens.push(match[0]);
  }

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  let currentCommand = '';

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-df-z]$/i.test(token)) {
      currentCommand = token;
      i++;
    }

    const isRelative = currentCommand === currentCommand.toLowerCase();
    const cmd = currentCommand.toUpperCase();

    if (cmd === 'M') {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      currentX = isRelative ? currentX + x : x;
      currentY = isRelative ? currentY + y : y;
      startX = currentX;
      startY = currentY;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });

      // Comandos M sucesivos implican comando L
      currentCommand = isRelative ? 'l' : 'L';
    } else if (cmd === 'L') {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      currentX = isRelative ? currentX + x : x;
      currentY = isRelative ? currentY + y : y;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });
    } else if (cmd === 'H') {
      const x = parseFloat(tokens[i++]);
      currentX = isRelative ? currentX + x : x;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });
    } else if (cmd === 'V') {
      const y = parseFloat(tokens[i++]);
      currentY = isRelative ? currentY + y : y;

      points.push({
        x: currentX,
        y: currentY,
        pointType: 'corner',
      });
    } else if (cmd === 'C') {
      const cp1xRaw = parseFloat(tokens[i++]);
      const cp1yRaw = parseFloat(tokens[i++]);
      const cp2xRaw = parseFloat(tokens[i++]);
      const cp2yRaw = parseFloat(tokens[i++]);
      const toXRaw = parseFloat(tokens[i++]);
      const toYRaw = parseFloat(tokens[i++]);

      const cp1x = isRelative ? currentX + cp1xRaw : cp1xRaw;
      const cp1y = isRelative ? currentY + cp1yRaw : cp1yRaw;
      const cp2x = isRelative ? currentX + cp2xRaw : cp2xRaw;
      const cp2y = isRelative ? currentY + cp2yRaw : cp2yRaw;
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      // El punto anterior adquiere su handleOut
      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      // El nuevo punto adquiere su handleIn
      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
    } else if (cmd === 'S') {
      // Bézier cúbico suavizado: cp1 se refleja desde el handleIn anterior
      let cp1x = currentX;
      let cp1y = currentY;
      if (points.length > 0) {
        const prev = points[points.length - 1];
        if (prev.handleIn) {
          cp1x = currentX + (currentX - prev.handleIn.x);
          cp1y = currentY + (currentY - prev.handleIn.y);
        }
      }

      const cp2xRaw = parseFloat(tokens[i++]);
      const cp2yRaw = parseFloat(tokens[i++]);
      const toXRaw = parseFloat(tokens[i++]);
      const toYRaw = parseFloat(tokens[i++]);

      const cp2x = isRelative ? currentX + cp2xRaw : cp2xRaw;
      const cp2y = isRelative ? currentY + cp2yRaw : cp2yRaw;
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
    } else if (cmd === 'Q') {
      // Bézier cuadrático: convertir a cúbico
      const qxRaw = parseFloat(tokens[i++]);
      const qyRaw = parseFloat(tokens[i++]);
      const toXRaw = parseFloat(tokens[i++]);
      const toYRaw = parseFloat(tokens[i++]);

      const qx = isRelative ? currentX + qxRaw : qxRaw;
      const qy = isRelative ? currentY + qyRaw : qyRaw;
      const toX = isRelative ? currentX + toXRaw : toXRaw;
      const toY = isRelative ? currentY + toYRaw : toYRaw;

      const cp1x = currentX + (2 / 3) * (qx - currentX);
      const cp1y = currentY + (2 / 3) * (qy - currentY);
      const cp2x = toX + (2 / 3) * (qx - toX);
      const cp2y = toY + (2 / 3) * (qy - toY);

      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const prev = points[lastIdx];
        points[lastIdx] = {
          ...prev,
          handleOut: { x: cp1x, y: cp1y },
          pointType: 'smooth',
        };
      }

      points.push({
        x: toX,
        y: toY,
        handleIn: { x: cp2x, y: cp2y },
        pointType: 'smooth',
      });

      currentX = toX;
      currentY = toY;
    } else if (cmd === 'Z') {
      closed = true;
      currentX = startX;
      currentY = startY;
    } else {
      // Comandos no estándar o no soportados directamente (ej. Arcos 'A'), avanzar token
      i++;
    }
  }

  return { points, closed };
}

/**
 * Multiplica un punto por una matriz de transformación afín 2D [a, b, c, d, e, f].
 */
function applyTransform(p: Vector2D, matrix?: [number, number, number, number, number, number]): Vector2D {
  if (!matrix) return p;
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  };
}

/**
 * Parsea un atributo transform SVG como 'translate(x, y)' o 'matrix(a,b,c,d,e,f)'
 */
function parseTransformAttr(transformStr: string | null): [number, number, number, number, number, number] | undefined {
  if (!transformStr) return undefined;
  const str = transformStr.trim();

  const translateMatch = str.match(/translate\(\s*([-+]?\d*\.?\d+)(?:[,\s]+([-+]?\d*\.?\d+))?\s*\)/i);
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1]);
    const ty = translateMatch[2] ? parseFloat(translateMatch[2]) : 0;
    return [1, 0, 0, 1, tx, ty];
  }

  const matrixMatch = str.match(
    /matrix\(\s*([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)\s*\)/i
  );
  if (matrixMatch) {
    return [
      parseFloat(matrixMatch[1]),
      parseFloat(matrixMatch[2]),
      parseFloat(matrixMatch[3]),
      parseFloat(matrixMatch[4]),
      parseFloat(matrixMatch[5]),
      parseFloat(matrixMatch[6]),
    ];
  }

  return undefined;
}

/**
 * Combina dos matrices afines 2D [a, b, c, d, e, f]
 */
function multiplyMatrices(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Parsea un nodo del DOM SVG recursivamente y devuelve los nodos LayerChildNode correspondientes.
 */
function parseSvgElement(el: Element, parentContext: SvgContext): LayerChildNode | null {
  const tagName = el.tagName.toLowerCase();

  // Contexto y estilos heredados
  const context: SvgContext = { ...parentContext };

  const fillAttr = el.getAttribute('fill');
  if (fillAttr) context.fill = fillAttr === 'none' ? 'none' : fillAttr;

  const strokeAttr = el.getAttribute('stroke');
  if (strokeAttr) context.stroke = strokeAttr === 'none' ? 'none' : strokeAttr;

  const strokeWidthAttr = el.getAttribute('stroke-width');
  if (strokeWidthAttr) {
    const sw = parseFloat(strokeWidthAttr);
    if (!isNaN(sw)) context.strokeWidth = sw;
  }

  const opacityAttr = el.getAttribute('opacity');
  if (opacityAttr) {
    const op = parseFloat(opacityAttr);
    if (!isNaN(op)) context.opacity = (context.opacity ?? 1) * op;
  }

  const localMatrix = parseTransformAttr(el.getAttribute('transform'));
  if (localMatrix) {
    context.transformMatrix = context.transformMatrix
      ? multiplyMatrices(context.transformMatrix, localMatrix)
      : localMatrix;
  }

  const nameAttr = el.getAttribute('id') || el.getAttribute('data-name') || tagName;

  if (tagName === 'g') {
    const children: LayerChildNode[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const childNode = parseSvgElement(el.children[i], context);
      if (childNode) children.push(childNode);
    }
    if (children.length === 0) return null;

    const group: Group = {
      id: nextId('group'),
      type: 'group',
      name: nameAttr,
      children,
      opacity: context.opacity,
    };
    return group;
  }

  if (tagName === 'rect') {
    const rawX = parseFloat(el.getAttribute('x') || '0');
    const rawY = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    if (w <= 0 || h <= 0) return null;

    const rx = parseFloat(el.getAttribute('rx') || el.getAttribute('ry') || '0');
    const transformed = applyTransform({ x: rawX, y: rawY }, context.transformMatrix);

    const rect: Rectangle = {
      id: nextId('rect'),
      type: 'rectangle',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      width: w,
      height: h,
      cornerRadius: rx > 0 ? rx : undefined,
      fill: context.fill ?? '#000000',
      stroke: context.stroke ?? 'none',
      strokeWidth: context.strokeWidth ?? 1,
      opacity: context.opacity,
    };
    return rect;
  }

  if (tagName === 'circle' || tagName === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = tagName === 'circle' ? parseFloat(el.getAttribute('r') || '0') : parseFloat(el.getAttribute('rx') || '0');
    const ry = tagName === 'circle' ? parseFloat(el.getAttribute('r') || '0') : parseFloat(el.getAttribute('ry') || '0');
    if (rx <= 0 || ry <= 0) return null;

    const transformed = applyTransform({ x: cx, y: cy }, context.transformMatrix);

    const ellipse: Ellipse = {
      id: nextId('ellipse'),
      type: 'ellipse',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      radiusX: rx,
      radiusY: ry,
      fill: context.fill ?? '#000000',
      stroke: context.stroke ?? 'none',
      strokeWidth: context.strokeWidth ?? 1,
      opacity: context.opacity,
    };
    return ellipse;
  }

  if (tagName === 'path') {
    const d = el.getAttribute('d');
    if (!d) return null;

    const { points: rawPoints, closed } = parseSvgPathD(d);
    if (rawPoints.length === 0) return null;

    // Aplicar transformación a puntos de ancla y manejadores
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
      };
    });

    const path: Path = {
      id: nextId('path'),
      type: 'path',
      name: nameAttr,
      x: points[0].x,
      y: points[0].y,
      points,
      closed,
      fill: context.fill ?? '#000000',
      stroke: context.stroke ?? 'none',
      strokeWidth: context.strokeWidth ?? 1,
      opacity: context.opacity,
    };
    return path;
  }

  if (tagName === 'line') {
    const x1 = parseFloat(el.getAttribute('x1') || '0');
    const y1 = parseFloat(el.getAttribute('y1') || '0');
    const x2 = parseFloat(el.getAttribute('x2') || '0');
    const y2 = parseFloat(el.getAttribute('y2') || '0');

    const pt1 = applyTransform({ x: x1, y: y1 }, context.transformMatrix);
    const pt2 = applyTransform({ x: x2, y: y2 }, context.transformMatrix);

    const path: Path = {
      id: nextId('line'),
      type: 'path',
      name: nameAttr,
      x: pt1.x,
      y: pt1.y,
      points: [
        { x: pt1.x, y: pt1.y, pointType: 'corner' },
        { x: pt2.x, y: pt2.y, pointType: 'corner' },
      ],
      closed: false,
      fill: 'none',
      stroke: context.stroke ?? '#000000',
      strokeWidth: context.strokeWidth ?? 1,
      opacity: context.opacity,
    };
    return path;
  }

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

    const path: Path = {
      id: nextId(tagName),
      type: 'path',
      name: nameAttr,
      x: points[0].x,
      y: points[0].y,
      points,
      closed: tagName === 'polygon',
      fill: context.fill ?? (tagName === 'polygon' ? '#000000' : 'none'),
      stroke: context.stroke ?? 'none',
      strokeWidth: context.strokeWidth ?? 1,
      opacity: context.opacity,
    };
    return path;
  }

  if (tagName === 'text') {
    const rawX = parseFloat(el.getAttribute('x') || '0');
    const rawY = parseFloat(el.getAttribute('y') || '0');
    const content = el.textContent?.trim() || '';
    if (!content) return null;

    const transformed = applyTransform({ x: rawX, y: rawY }, context.transformMatrix);
    const fontSize = parseFloat(el.getAttribute('font-size') || '16') || 16;
    const fontFamily = el.getAttribute('font-family') || 'sans-serif';

    const textNode: Text = {
      id: nextId('text'),
      type: 'text',
      name: nameAttr,
      x: transformed.x,
      y: transformed.y,
      text: content,
      fontSize,
      fontFamily,
      fill: context.fill ?? '#000000',
      opacity: context.opacity,
    };
    return textNode;
  }

  return null;
}

/**
 * Parsea una cadena XML SVG completa y genera figuras vectoriales nativas para Vectedit.
 */
export function parseSvgString(svgText: string): SvgImportResult {
  if (!svgText || typeof svgText !== 'string') {
    return { success: false, shapes: [], width: 0, height: 0, error: 'Contenido SVG vacío' };
  }

  let doc: Document | globalThis.Document | null = null;

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    doc = parser.parseFromString(svgText, 'image/svg+xml');
  } else {
    // Si no hay DOMParser nativo (entorno Node sin polyfill), simulamos parsing elemental
    return parseSvgFallbackRegex(svgText);
  }

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    return { success: false, shapes: [], width: 0, height: 0, error: parserError.textContent || 'Error de parseo XML' };
  }

  const svgEl = doc.querySelector('svg');
  if (!svgEl) {
    return { success: false, shapes: [], width: 0, height: 0, error: 'No se encontró el elemento <svg> raíz' };
  }

  // Dimensiones del SVG
  let width = parseFloat(svgEl.getAttribute('width') || '0');
  let height = parseFloat(svgEl.getAttribute('height') || '0');

  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const vbParts = viewBox.trim().split(/[\s,]+/).map(parseFloat);
    if (vbParts.length === 4) {
      if (!width || width <= 0) width = vbParts[2];
      if (!height || height <= 0) height = vbParts[3];
    }
  }

  if (!width || width <= 0) width = 800;
  if (!height || height <= 0) height = 600;

  const shapes: LayerChildNode[] = [];
  const baseContext: SvgContext = {};

  for (let i = 0; i < svgEl.children.length; i++) {
    const child = svgEl.children[i];
    // Ignorar defs, metadata, style, title
    const tag = child.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'style' || tag === 'title' || tag === 'desc' || tag === 'metadata') {
      continue;
    }
    const parsed = parseSvgElement(child, baseContext);
    if (parsed) {
      shapes.push(parsed);
    }
  }

  return {
    success: shapes.length > 0,
    shapes,
    width,
    height,
    error: shapes.length === 0 ? 'No se encontraron figuras vectoriales válidas en el SVG' : undefined,
  };
}

/**
 * Parser de respaldo basado en expresiones regulares para pruebas en entorno Node.js
 */
function parseSvgFallbackRegex(svgText: string): SvgImportResult {
  const shapes: LayerChildNode[] = [];
  let width = 800;
  let height = 600;

  const widthMatch = svgText.match(/width=["'](\d+)["']/i);
  if (widthMatch) width = parseFloat(widthMatch[1]);
  const heightMatch = svgText.match(/height=["'](\d+)["']/i);
  if (heightMatch) height = parseFloat(heightMatch[1]);

  // Rectángulos
  const rectRegex = /<rect\b([^>]*)\/?>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rectRegex.exec(svgText)) !== null) {
    const attrs = rm[1];
    const x = parseFloat(attrs.match(/x=["']([^"']+)["']/i)?.[1] || '0');
    const y = parseFloat(attrs.match(/y=["']([^"']+)["']/i)?.[1] || '0');
    const w = parseFloat(attrs.match(/width=["']([^"']+)["']/i)?.[1] || '0');
    const h = parseFloat(attrs.match(/height=["']([^"']+)["']/i)?.[1] || '0');
    const fill = attrs.match(/fill=["']([^"']+)["']/i)?.[1] || '#000000';
    if (w > 0 && h > 0) {
      shapes.push({
        id: nextId('rect'),
        type: 'rectangle',
        name: 'rect',
        x,
        y,
        width: w,
        height: h,
        fill,
      });
    }
  }

  // Círculos y elipses
  const circleRegex = /<circle\b([^>]*)\/?>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = circleRegex.exec(svgText)) !== null) {
    const attrs = cm[1];
    const cx = parseFloat(attrs.match(/cx=["']([^"']+)["']/i)?.[1] || '0');
    const cy = parseFloat(attrs.match(/cy=["']([^"']+)["']/i)?.[1] || '0');
    const r = parseFloat(attrs.match(/r=["']([^"']+)["']/i)?.[1] || '0');
    const fill = attrs.match(/fill=["']([^"']+)["']/i)?.[1] || '#000000';
    if (r > 0) {
      shapes.push({
        id: nextId('ellipse'),
        type: 'ellipse',
        name: 'circle',
        x: cx,
        y: cy,
        radiusX: r,
        radiusY: r,
        fill,
      });
    }
  }

  // Paths
  const pathRegex = /<path\b([^>]*)\/?>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pathRegex.exec(svgText)) !== null) {
    const attrs = pm[1];
    const d = attrs.match(/d=["']([^"']+)["']/i)?.[1];
    const fill = attrs.match(/fill=["']([^"']+)["']/i)?.[1] || '#000000';
    if (d) {
      const { points, closed } = parseSvgPathD(d);
      if (points.length > 0) {
        shapes.push({
          id: nextId('path'),
          type: 'path',
          name: 'path',
          x: points[0].x,
          y: points[0].y,
          points,
          closed,
          fill,
        });
      }
    }
  }

  return {
    success: shapes.length > 0,
    shapes,
    width,
    height,
  };
}
