import type { Shape } from '../types/scene-graph.ts';

/**
 * Constante estándar para representar la ausencia de relleno o contorno.
 */
export const NONE_PAINT = 'none';

export type PaintState =
  | { kind: 'none' }
  | { kind: 'color'; hex: string }
  | { kind: 'mixed' };

/**
 * Determina si un valor de pintura corresponde a "sin pintura" (none / transparente).
 * Retorna true para undefined, null, '', 'none' y 'transparent' (sin distinguir mayúsculas ni espacios).
 */
export function isNonePaint(v: unknown): boolean {
  if (v === undefined || v === null) {
    return true;
  }
  if (typeof v !== 'string') {
    return false;
  }
  const trimmed = v.trim().toLowerCase();
  return trimmed === '' || trimmed === 'none' || trimmed === 'transparent';
}

/**
 * Analiza y valida una cadena de color hexadecimal (#abc, abc, #aabbcc, aabbcc).
 * Acepta espacios alrededor y mayúsculas/minúsculas.
 * Retorna '#rrggbb' en minúsculas de 7 caracteres.
 * Retorna null en cualquier otro caso (incluyendo 8 dígitos hex, caracteres no válidos, longitudes incorrectas).
 */
export function parseHexColor(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();

  // 3 dígitos hexadecimales (con o sin '#')
  const match3 = trimmed.match(/^#?([0-9a-fA-F]{3})$/);
  if (match3) {
    const [r, g, b] = match3[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // 6 dígitos hexadecimales (con o sin '#')
  const match6 = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (match6) {
    return `#${match6[1].toLowerCase()}`;
  }

  return null;
}

/**
 * Normaliza cualquier formato de color compatible (hexadecimal o rgb/rgba)
 * a un código hexadecimal '#rrggbb' de 7 caracteres en minúsculas.
 * Retorna null si el valor no se reconoce o es none/transparente.
 */
export function normalizeColor(value: string | null | undefined): string | null {
  if (!value || isNonePaint(value)) {
    return null;
  }

  const hex = parseHexColor(value);
  if (hex) {
    return hex;
  }

  const trimmed = value.trim();
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10))).toString(16).padStart(2, '0');
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10))).toString(16).padStart(2, '0');
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10))).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  return null;
}

/**
 * Obtiene el estado consolidado de pintura ('fill' o 'stroke') para un conjunto de figuras:
 * - { kind: 'none' }: Si la lista está vacía o todas las figuras carecen de pintura.
 * - { kind: 'color', hex }: Si todas las figuras comparten exactamente el mismo color tras normalizar.
 * - { kind: 'mixed' }: Si coexisten figuras con y sin pintura, o con distintos colores.
 */
export function getPaintState(shapes: readonly Shape[], property: 'fill' | 'stroke'): PaintState {
  if (!shapes || shapes.length === 0) {
    return { kind: 'none' };
  }

  const normalizedPaints: string[] = [];

  for (const shape of shapes) {
    const raw = property === 'fill' ? shape.fill : ('stroke' in shape ? shape.stroke : undefined);
    if (isNonePaint(raw)) {
      normalizedPaints.push(NONE_PAINT);
    } else {
      const hex = normalizeColor(raw);
      if (hex) {
        normalizedPaints.push(hex);
      } else {
        normalizedPaints.push(NONE_PAINT);
      }
    }
  }

  const first = normalizedPaints[0];
  const allSame = normalizedPaints.every((p) => p === first);

  if (allSame) {
    if (first === NONE_PAINT) {
      return { kind: 'none' };
    }
    return { kind: 'color', hex: first };
  }

  return { kind: 'mixed' };
}
