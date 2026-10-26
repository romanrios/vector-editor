import type { AABB, Text } from '../../types/scene-graph.ts';
import { isNonePaint } from '../color.ts';

let sharedMeasureContext: CanvasRenderingContext2D | null = null;

/**
 * Obtiene o crea un contexto 2D compartido para mediciones de texto en entornos con Canvas.
 */
export function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureContext) {
    return sharedMeasureContext;
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    sharedMeasureContext = canvas.getContext('2d');
  } else if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    sharedMeasureContext = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  }
  return sharedMeasureContext;
}

/**
 * Permite registrar un contexto 2D para mediciones tipográficas (útil para pruebas unitarias o configuración personalizada).
 */
export function setSharedMeasureContext(ctx: CanvasRenderingContext2D | null): void {
  sharedMeasureContext = ctx;
}

/**
 * Obtiene el lineHeight efectivo de un nodo Text.
 * Si no está definido o no es válido, retorna por defecto fontSize * 1.2.
 */
export function getTextLineHeight(text: Text): number {
  const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
  if (typeof text.lineHeight === 'number' && text.lineHeight > 0) {
    return text.lineHeight;
  }
  return fontSize * 1.2;
}

/**
 * Mide el ancho de una única línea de texto usando CanvasRenderingContext2D.measureText cuando está disponible.
 */
export function measureSingleLineTextWidth(
  text: Text,
  line: string,
  ctx?: CanvasRenderingContext2D | null
): number {
  if (!line) {
    return 0;
  }

  const activeCtx = ctx ?? getTextMeasureContext();
  const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
  const fontFamily = text.fontFamily ?? 'sans-serif';
  const letterSpacing = typeof text.letterSpacing === 'number' && Number.isFinite(text.letterSpacing) ? text.letterSpacing : 0;
  const spacingCount = Math.max(0, line.length - 1);

  if (activeCtx && typeof activeCtx.measureText === 'function') {
    const fontParts: string[] = [];
    if (text.fontStyle && text.fontStyle !== 'normal') {
      fontParts.push(text.fontStyle);
    }
    if (text.fontWeight && text.fontWeight !== 'normal' && text.fontWeight !== 400) {
      fontParts.push(String(text.fontWeight));
    }
    const safeFontFamily = fontFamily.includes(' ') && !fontFamily.startsWith('"') && !fontFamily.startsWith("'")
      ? `"${fontFamily}"`
      : fontFamily;
    fontParts.push(`${fontSize}px`);
    fontParts.push(safeFontFamily);
    activeCtx.font = fontParts.join(' ');

    if ('letterSpacing' in activeCtx) {
      try {
        (activeCtx as any).letterSpacing = `${letterSpacing}px`;
      } catch (_) {}
    }

    const metrics = activeCtx.measureText(line);
    if (metrics && typeof metrics.width === 'number' && metrics.width > 0) {
      const isNativeBrowserCanvas =
        typeof (globalThis as any).CanvasRenderingContext2D !== 'undefined' &&
        activeCtx instanceof (globalThis as any).CanvasRenderingContext2D;

      if (!isNativeBrowserCanvas && letterSpacing !== 0) {
        return Math.max(0, metrics.width + spacingCount * letterSpacing);
      }
      return metrics.width;
    }
  }

  // Fallback heurístico determinista para entornos sin motor tipográfico nativo
  const baseWidth = line.length * (fontSize * 0.6);
  const extraSpacing = letterSpacing !== 0 ? spacingCount * letterSpacing : 0;
  return Math.max(0, baseWidth + extraSpacing);
}

/**
 * Divide el contenido de un nodo Text en líneas respetando saltos de línea explícitos
 * y aplicando ajuste de línea automático (word-wrapping) si `boxWidth` está definido.
 */
export function getTextLineRanges(
  text: Text,
  ctx?: CanvasRenderingContext2D | null
): Array<{ text: string; start: number; end: number }> {
  const content = text.text ?? '';
  if (text.boxWidth === undefined) {
    let start = 0;
    return content.split('\n').map((line) => {
      const range = { text: line, start, end: start + line.length };
      start = range.end + 1;
      return range;
    });
  }

  const ranges: Array<{ text: string; start: number; end: number }> = [];
  const paragraphs = content.split('\n');
  let paragraphStart = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      ranges.push({ text: '', start: paragraphStart, end: paragraphStart });
      paragraphStart++;
      continue;
    }

    const words = paragraph.split(' ');
    let wordStart = paragraphStart;
    let currentLine = '';
    let currentStart = wordStart;
    let currentEnd = wordStart;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = measureSingleLineTextWidth(text, testLine, ctx);

      if (width <= text.boxWidth || !currentLine) {
        if (!currentLine) {
          currentStart = wordStart;
        }
        currentLine = testLine;
        currentEnd = wordStart + word.length;
      } else {
        ranges.push({ text: currentLine, start: currentStart, end: currentEnd });
        currentLine = word;
        currentStart = wordStart;
        currentEnd = wordStart + word.length;
      }

      wordStart += word.length + (i < words.length - 1 ? 1 : 0);
    }

    if (currentLine) {
      ranges.push({ text: currentLine, start: currentStart, end: currentEnd });
    }
    paragraphStart += paragraph.length + 1;
  }

  return ranges.length > 0 ? ranges : [{ text: '', start: 0, end: 0 }];
}

export function getWrappedTextLines(text: Text, ctx?: CanvasRenderingContext2D | null): string[] {
  return getTextLineRanges(text, ctx).map((line) => line.text);
}

/**
 * Mide el ancho de un nodo Text.
 * Si boxWidth está definido, retorna boxWidth como ancho.
 * Para texto multilínea sin boxWidth, corresponde al ancho de la línea más ancha.
 */
export function measureTextWidth(text: Text, ctx?: CanvasRenderingContext2D | null): number {
  if (text.boxWidth !== undefined) {
    return text.boxWidth;
  }

  const content = text.text ?? '';
  if (!content) {
    return 0;
  }

  const lines = content.split('\n');
  if (lines.length === 1) {
    return measureSingleLineTextWidth(text, lines[0], ctx);
  }

  let maxWidth = 0;
  for (const line of lines) {
    const w = measureSingleLineTextWidth(text, line, ctx);
    if (w > maxWidth) {
      maxWidth = w;
    }
  }
  return maxWidth;
}

/**
 * Mide el ancho de un prefijo de longitud `length` de un nodo Text.
 */
export function getTextSubstrWidth(text: Text, length: number, ctx?: CanvasRenderingContext2D | null): number {
  const content = text.text ?? '';
  if (length <= 0 || !content) {
    return 0;
  }
  if (length >= content.length) {
    return measureTextWidth(text, ctx);
  }
  const subNode: Text = { ...text, text: content.slice(0, length) };
  return measureTextWidth(subNode, ctx);
}

/**
 * Calcula el índice de carácter más cercano a una posición (worldX, worldY) en coordenadas del mundo,
 * utilizando CanvasRenderingContext2D.measureText para métricas tipográficas reales.
 * Identifica la línea más cercana verticalmente y el carácter más cercano dentro de ella.
 */
export function getTextIndexAtPosition(
  text: Text,
  worldX: number,
  worldY: number,
  ctx?: CanvasRenderingContext2D | null
): number {
  const content = text.text ?? '';
  if (!content) {
    return 0;
  }

  // 1. Des-rotar el punto con respecto al anclaje (text.x, text.y) si hay rotación
  const rotation = text.rotation ?? 0;
  let unrotX = worldX;
  let unrotY = worldY;
  if (rotation !== 0) {
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = worldX - text.x;
    const dy = worldY - text.y;
    unrotX = text.x + (dx * cos - dy * sin);
    unrotY = text.y + (dx * sin + dy * cos);
  }

  // 2. Dividir en líneas y calcular posiciones iniciales
  const lines = getTextLineRanges(text, ctx);

  // 3. Identificar la línea más cercana según coordenada Y y lineHeight
  const lineHeight = getTextLineHeight(text);
  const offsetY = unrotY - text.y;
  let lineIndex = Math.floor(offsetY / lineHeight);
  if (lineIndex < 0) lineIndex = 0;
  if (lineIndex >= lines.length) lineIndex = lines.length - 1;

  // 4. Determinar la posición horizontal de inicio de la línea seleccionada según textAlign
  const { text: currentLine, start: lineStart, end: lineEnd } = lines[lineIndex];
  const lineWidth = measureSingleLineTextWidth(text, currentLine, ctx);
  const hasBoxWidth = typeof text.boxWidth === 'number' && text.boxWidth > 0;
  let startX = text.x;
  if (hasBoxWidth) {
    if (text.textAlign === 'center') {
      startX = text.x + (text.boxWidth! - lineWidth) / 2;
    } else if (text.textAlign === 'right') {
      startX = text.x + text.boxWidth! - lineWidth;
    }
  } else {
    if (text.textAlign === 'center') {
      startX = text.x - lineWidth / 2;
    } else if (text.textAlign === 'right') {
      startX = text.x - lineWidth;
    }
  }

  // 5. Desplazamiento horizontal relativo al inicio de la línea
  const offsetX = unrotX - startX;
  if (offsetX <= 0) {
    return lineStart;
  }
  if (offsetX >= lineWidth) {
    return lineEnd;
  }

  // 6. Buscar el carácter más cercano dentro de esa línea
  let closestCol = 0;
  let minDiff = Infinity;
  for (let i = 0; i <= currentLine.length; i++) {
    const w = measureSingleLineTextWidth(text, currentLine.slice(0, i), ctx);
    const diff = Math.abs(w - offsetX);
    if (diff < minDiff) {
      minDiff = diff;
      closestCol = i;
    }
  }

  return Math.min(lineStart + closestCol, lineEnd);
}

/**
 * Obtiene el Bounding Box base (sin rotación) de un nodo Text en coordenadas del mundo.
 * Para texto con boxWidth, el ancho es boxWidth y la altura se calcula simulando el salto de línea.
 * Para texto multilínea sin boxWidth, el ancho es la línea más ancha y la altura corresponde a lines.length * lineHeight.
 * Para compatibilidad, si es de una sola línea sin lineHeight explícito, la altura es fontSize.
 */
export function getTextBaseAABB(text: Text, ctx?: CanvasRenderingContext2D | null): AABB {
  const isWrapped = text.boxWidth !== undefined;
  const lines = isWrapped ? getWrappedTextLines(text, ctx) : (text.text ?? '').split('\n');
  const width = isWrapped ? text.boxWidth! : measureTextWidth(text, ctx);
  const fontSize = typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16;
  const lineHeight = getTextLineHeight(text);
  const height = lines.length <= 1 && text.lineHeight === undefined ? fontSize : lines.length * lineHeight;

  let minX = text.x;
  if (!isWrapped) {
    if (text.textAlign === 'center') {
      minX = text.x - width / 2;
    } else if (text.textAlign === 'right') {
      minX = text.x - width;
    }
  }

  const strokePadding = !isNonePaint(text.stroke) ? Math.max(0, text.strokeWidth ?? 1) / 2 : 0;
  minX -= strokePadding;
  const minY = text.y - strokePadding;
  const maxX = minX + width + strokePadding * 2;
  const maxY = minY + height + strokePadding * 2;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Obtiene el Axis-Aligned Bounding Box (AABB) de un nodo Text.
 * Si tiene rotación, calcula la envolvente exacta de sus cuatro esquinas rotadas
 * respecto al punto de rotación (text.x, text.y).
 */
export function getTextAABB(text: Text, ctx?: CanvasRenderingContext2D | null): AABB {
  const baseAABB = getTextBaseAABB(text, ctx);

  if (!text.rotation) {
    return baseAABB;
  }

  const rad = (text.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const cx = text.x;
  const cy = text.y;

  const corners = [
    { x: baseAABB.minX, y: baseAABB.minY },
    { x: baseAABB.maxX, y: baseAABB.minY },
    { x: baseAABB.maxX, y: baseAABB.maxY },
    { x: baseAABB.minX, y: baseAABB.maxY },
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const { x, y } of corners) {
    const rx = cx + (x - cx) * cos - (y - cy) * sin;
    const ry = cy + (x - cx) * sin + (y - cy) * cos;

    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Determina si un punto (x, y) en coordenadas del mundo colisiona con el área visible
 * de un nodo Text, considerando su orientación y un margen de tolerancia opcional.
 */
export function isPointInText(
  x: number,
  y: number,
  text: Text,
  tolerance: number = 0,
  ctx?: CanvasRenderingContext2D | null
): boolean {
  const t = Math.max(0, tolerance);

  // 1. Fase rápida: descarte mediante AABB ampliado con tolerancia
  const aabb = getTextAABB(text, ctx);
  if (
    x < aabb.minX - t ||
    x > aabb.maxX + t ||
    y < aabb.minY - t ||
    y > aabb.maxY + t
  ) {
    return false;
  }

  // 2. Transformar el punto al espacio local si hay rotación
  let localX = x;
  let localY = y;

  const rotation = text.rotation ?? 0;
  if (rotation !== 0) {
    const cx = text.x;
    const cy = text.y;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = x - cx;
    const dy = y - cy;
    // Rotación inversa alrededor de (cx, cy): R(-θ)
    localX = cx + dx * cos + dy * sin;
    localY = cy - dx * sin + dy * cos;
  }

  // 3. Evaluar colisión contra el baseAABB no rotado
  const baseAABB = getTextBaseAABB(text, ctx);
  return (
    localX >= baseAABB.minX - t - 1e-9 &&
    localX <= baseAABB.maxX + t + 1e-9 &&
    localY >= baseAABB.minY - t - 1e-9 &&
    localY <= baseAABB.maxY + t + 1e-9
  );
}
