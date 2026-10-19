import { isGradient, type FillType } from '../types/scene-graph.ts';
import { normalizeColor } from '../utils/color.ts';

/**
 * Convierte un array de discontinuidad de trazo (dash array) al valor correspondiente del selector <select>.
 */
export function dashArrayToSelectValue(dash?: readonly number[]): string {
  if (!dash || dash.length === 0) return 'solid';
  const key = dash.join(',');
  if (key === '6,6') return 'dashed';
  if (key === '2,4') return 'dotted';
  if (key === '8,4,2,4') return 'dash-dot';
  return 'dashed';
}

/**
 * Convierte el valor seleccionado en el <select> de estilo de trazo a un array numérico de dash array.
 */
export function selectValueToDashArray(val: string): number[] | undefined {
  switch (val) {
    case 'dashed':
      return [6, 6];
    case 'dotted':
      return [2, 4];
    case 'dash-dot':
      return [8, 4, 2, 4];
    case 'solid':
    default:
      return undefined;
  }
}

/**
 * Convierte cualquier formato de color (hexadecimal corto/largo, rgb/rgba o nombres/nulos/transparentes)
 * en un código hexadecimal válido de 7 caracteres (#rrggbb) aceptado por <input type="color">.
 */
export function toValidHexColor(color: FillType | undefined | null, fallback: string = '#000000'): string {
  if (isGradient(color)) {
    return normalizeColor(color.stops[0]?.color) ?? fallback;
  }
  return normalizeColor(color) ?? fallback;
}
