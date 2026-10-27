import type {
  Text,
  TextSpan,
  FontStyle,
  FontWeight,
  FillType,
} from '../types/scene-graph.ts';

/**
 * Estilo tipográfico y visual resuelto de forma completa para un carácter o fragmento de texto
 */
export interface ResolvedTextStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  readonly fontStyle: FontStyle;
  readonly fill: FillType;
  readonly letterSpacing: number;
}

/**
 * Fragmento de texto contiguo con un estilo tipográfico homogéneo dentro de una línea
 */
export interface TextRun {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly style: ResolvedTextStyle;
}

/**
 * Obtiene el estilo tipográfico base por defecto de un nodo Text
 */
export function getBaseTextStyle(text: Text): ResolvedTextStyle {
  return {
    fontFamily: text.fontFamily ?? 'Inter',
    fontSize: typeof text.fontSize === 'number' && text.fontSize > 0 ? text.fontSize : 16,
    fontWeight: text.fontWeight ?? 400,
    fontStyle: text.fontStyle ?? 'normal',
    fill: text.fill ?? '#000000',
    letterSpacing: typeof text.letterSpacing === 'number' ? text.letterSpacing : 0,
  };
}

/**
 * Resuelve el estilo final de un carácter en la posición `charIndex`,
 * heredando del nodo base y sobreescribiendo con el span que cubra dicha posición.
 */
export function resolveCharacterStyle(
  textOrSpans: Text | readonly TextSpan[] | undefined,
  charIndex: number,
  fallbackBase?: ResolvedTextStyle | Text
): ResolvedTextStyle {
  let base: ResolvedTextStyle;
  let spans: readonly TextSpan[] | undefined;

  if (textOrSpans && !Array.isArray(textOrSpans) && 'type' in textOrSpans && (textOrSpans as any).type === 'text') {
    const textNode = textOrSpans as Text;
    base = getBaseTextStyle(textNode);
    spans = textNode.spans;
  } else {
    spans = textOrSpans as readonly TextSpan[] | undefined;
    if (fallbackBase && 'type' in (fallbackBase as any) && (fallbackBase as any).type === 'text') {
      base = getBaseTextStyle(fallbackBase as Text);
    } else if (fallbackBase) {
      base = fallbackBase as ResolvedTextStyle;
    } else {
      base = {
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        fill: '#000000',
        letterSpacing: 0,
      };
    }
  }

  if (!spans || spans.length === 0) {
    return base;
  }

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (charIndex >= span.start && charIndex < span.end) {
      return {
        fontFamily: span.fontFamily ?? base.fontFamily,
        fontSize: typeof span.fontSize === 'number' && span.fontSize > 0 ? span.fontSize : base.fontSize,
        fontWeight: span.fontWeight ?? base.fontWeight,
        fontStyle: span.fontStyle ?? base.fontStyle,
        fill: span.fill ?? base.fill,
        letterSpacing: typeof span.letterSpacing === 'number' ? span.letterSpacing : base.letterSpacing,
      };
    }
  }

  return base;
}

/**
 * Normaliza cualquier representación de peso de fuente ('bold', 'normal', 700, 400, '400')
 * a un valor numérico estándar (400 o 700, etc.).
 */
export function normalizeFontWeight(w: any): number {
  if (w === 'bold') return 700;
  if (w === 'normal' || w === undefined || w === null) return 400;
  const num = parseInt(w, 10);
  return isNaN(num) ? 400 : num;
}

/**
 * Compara dos estilos resueltos para determinar si son estrictamente equivalentes
 */
export function areTextStylesEqual(a: ResolvedTextStyle, b: ResolvedTextStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    normalizeFontWeight(a.fontWeight) === normalizeFontWeight(b.fontWeight) &&
    a.fontStyle === b.fontStyle &&
    JSON.stringify(a.fill) === JSON.stringify(b.fill) &&
    a.letterSpacing === b.letterSpacing
  );
}

/**
 * Normaliza una lista de spans:
 * 1. Clampa los índices a los límites del texto [0, textLength].
 * 2. Filtra tramos vacíos o inválidos (start >= end).
 * 3. Ordena por posición de inicio.
 * 4. Fusiona tramos contiguos con estilos idénticos.
 */
export function normalizeSpans(
  spans: readonly TextSpan[] | undefined,
  textLength: number,
  baseText?: Text
): readonly TextSpan[] {
  if (!spans || spans.length === 0 || textLength <= 0) {
    return [];
  }

  // 1. Filtrar y clampear
  const valid: TextSpan[] = [];
  for (const s of spans) {
    const start = Math.max(0, Math.min(textLength, s.start));
    const end = Math.max(start, Math.min(textLength, s.end));
    if (start < end) {
      valid.push({ ...s, start, end });
    }
  }

  if (valid.length === 0) {
    return [];
  }

  // 2. Ordenar por start ascendente
  valid.sort((a, b) => a.start - b.start || a.end - b.end);

  // 3. Fusionar tramos contiguos o idénticos
  const merged: TextSpan[] = [];
  let current = valid[0];

  for (let i = 1; i < valid.length; i++) {
    const next = valid[i];
    if (
      current.end === next.start &&
      current.fontFamily === next.fontFamily &&
      current.fontSize === next.fontSize &&
      normalizeFontWeight(current.fontWeight) === normalizeFontWeight(next.fontWeight) &&
      current.fontStyle === next.fontStyle &&
      JSON.stringify(current.fill) === JSON.stringify(next.fill) &&
      current.letterSpacing === next.letterSpacing
    ) {
      current = { ...current, end: next.end };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  // 4. Si se provee baseText, eliminar spans que sean idénticos al estilo base
  if (baseText) {
    const base = getBaseTextStyle(baseText);
    return merged.filter((s) => {
      const isRedundant =
        (s.fontFamily === undefined || s.fontFamily === base.fontFamily) &&
        (s.fontSize === undefined || s.fontSize === base.fontSize) &&
        (s.fontWeight === undefined || normalizeFontWeight(s.fontWeight) === normalizeFontWeight(base.fontWeight)) &&
        (s.fontStyle === undefined || s.fontStyle === base.fontStyle) &&
        (s.fill === undefined || JSON.stringify(s.fill) === JSON.stringify(base.fill)) &&
        (s.letterSpacing === undefined || s.letterSpacing === base.letterSpacing);
      return !isRedundant;
    });
  }

  return merged;
}

/**
 * Aplica un nuevo parche de estilo tipográfico a un rango [start, end] sobre la lista actual de spans,
 * dividiendo los spans existentes que se intersecten y asegurando no solapamientos.
 */
export function applySpanToRange(
  currentSpans: readonly TextSpan[] | undefined,
  rangeOrStart: { start: number; end: number } | number,
  endOrPatch: number | Partial<Omit<TextSpan, 'start' | 'end'>>,
  maybePatchOrText?: Partial<Omit<TextSpan, 'start' | 'end'>> | Text,
  maybeText?: Text
): readonly TextSpan[] {
  let rangeStart: number;
  let rangeEnd: number;
  let patch: Partial<Omit<TextSpan, 'start' | 'end'>>;
  let textNode: Text | undefined;

  if (typeof rangeOrStart === 'number') {
    rangeStart = rangeOrStart;
    rangeEnd = endOrPatch as number;
    patch = maybePatchOrText as Partial<Omit<TextSpan, 'start' | 'end'>>;
    textNode = maybeText;
  } else {
    rangeStart = rangeOrStart.start;
    rangeEnd = rangeOrStart.end;
    patch = endOrPatch as Partial<Omit<TextSpan, 'start' | 'end'>>;
    textNode = maybePatchOrText as Text | undefined;
  }

  const textLength = textNode ? (textNode.text ?? '').length : Math.max(rangeEnd, ...(currentSpans?.map((s) => s.end) ?? [0]));
  const start = Math.max(0, Math.min(textLength, Math.min(rangeStart, rangeEnd)));
  const end = Math.max(0, Math.min(textLength, Math.max(rangeStart, rangeEnd)));
  if (start >= end) {
    return currentSpans ?? [];
  }

  const existing = currentSpans ?? [];
  const result: TextSpan[] = [];

  for (const span of existing) {
    // 1. Totalmente antes del rango
    if (span.end <= start) {
      result.push(span);
      continue;
    }
    // 2. Totalmente después del rango
    if (span.start >= end) {
      result.push(span);
      continue;
    }

    // 3. Hay intersección: conservar parte previa al rango si existe
    if (span.start < start) {
      result.push({ ...span, end: start });
    }

    // 4. Parte contenida dentro del rango: combinar propiedades existentes con el parche
    const overlapStart = Math.max(span.start, start);
    const overlapEnd = Math.min(span.end, end);
    if (overlapStart < overlapEnd) {
      result.push({
        ...span,
        ...patch,
        start: overlapStart,
        end: overlapEnd,
      });
    }

    // 5. Conservar parte posterior al rango si existe
    if (span.end > end) {
      result.push({ ...span, start: end });
    }
  }

  // Si hubo regiones del rango [start, end] no cubiertas por spans existentes,
  // rellenarlas con el parche de estilo
  let cursor = start;
  const overlapSpans = result
    .filter((s) => s.start >= start && s.end <= end)
    .sort((a, b) => a.start - b.start);

  for (const span of overlapSpans) {
    if (span.start > cursor) {
      result.push({
        ...patch,
        start: cursor,
        end: span.start,
      });
    }
    cursor = Math.max(cursor, span.end);
  }

  if (cursor < end) {
    result.push({
      ...patch,
      start: cursor,
      end,
    });
  }

  return normalizeSpans(result, textLength, textNode);
}

/**
 * Ajusta los límites de los spans al modificarse el texto (al tipear, pegar, borrar o presionar enter).
 *
 * @param spans Spans actuales
 * @param changeStart Posición donde ocurrió el cambio
 * @param deletedCount Cantidad de caracteres eliminados
 * @param insertedCount Cantidad de caracteres insertados
 */
export function adjustSpansOnTextChange(
  spans: readonly TextSpan[] | undefined,
  changeStart: number,
  deletedCount: number,
  insertedCount: number
): readonly TextSpan[] {
  if (!spans || spans.length === 0) {
    return [];
  }

  const delta = insertedCount - deletedCount;
  const changeEnd = changeStart + deletedCount;
  const adjusted: TextSpan[] = [];

  for (const span of spans) {
    // Caso 1: El span está completamente antes del punto de cambio
    if (span.end <= changeStart) {
      adjusted.push(span);
      continue;
    }

    // Caso 2: El span está completamente después del rango eliminado
    if (span.start >= changeEnd) {
      adjusted.push({
        ...span,
        start: span.start + delta,
        end: span.end + delta,
      });
      continue;
    }

    // Caso 3: El span se solapa con el rango modificado
    // Si se inserta texto dentro o en el borde del span, expandir el span
    let newStart = span.start;
    let newEnd = span.end;

    if (span.start >= changeStart && span.start < changeEnd) {
      newStart = changeStart + insertedCount;
    }

    if (span.end > changeStart && span.end <= changeEnd) {
      newEnd = changeStart;
    } else if (span.end > changeEnd) {
      newEnd = span.end + delta;
    }

    // Si fue una inserción pura dentro del span (sin borrado): expandir
    if (deletedCount === 0 && changeStart >= span.start && changeStart <= span.end) {
      newEnd = span.end + insertedCount;
    }

    if (newStart < newEnd) {
      adjusted.push({
        ...span,
        start: Math.max(0, newStart),
        end: Math.max(0, newEnd),
      });
    }
  }

  return adjusted;
}

/**
 * Divide un tramo de texto [rangeStart, rangeEnd] en segmentos homogéneos (TextRun),
 * donde cada segmento tiene un único estilo tipográfico constante.
 */
export function splitTextIntoRuns(
  text: Text,
  rangeStart: number,
  rangeEnd: number
): TextRun[] {
  const content = text.text ?? '';
  const start = Math.max(0, Math.min(content.length, rangeStart));
  const end = Math.max(start, Math.min(content.length, rangeEnd));
  if (start >= end) {
    return [];
  }

  const baseStyle = getBaseTextStyle(text);
  if (!text.spans || text.spans.length === 0) {
    return [
      {
        text: content.slice(start, end),
        start,
        end,
        style: baseStyle,
      },
    ];
  }

  // Obtener todos los puntos de quiebre relevantes dentro de [start, end]
  const breakPoints = new Set<number>([start, end]);
  for (const span of text.spans) {
    if (span.start > start && span.start < end) {
      breakPoints.add(span.start);
    }
    if (span.end > start && span.end < end) {
      breakPoints.add(span.end);
    }
  }

  const sortedPoints = Array.from(breakPoints).sort((a, b) => a - b);
  const runs: TextRun[] = [];

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const runStart = sortedPoints[i];
    const runEnd = sortedPoints[i + 1];
    if (runStart < runEnd) {
      const runText = content.slice(runStart, runEnd);
      const style = resolveCharacterStyle(text, runStart);
      runs.push({
        text: runText,
        start: runStart,
        end: runEnd,
        style,
      });
    }
  }

  return runs;
}
