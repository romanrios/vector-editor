import type { Gradient, Shape } from '../types/scene-graph.ts';
import { isGradient } from '../types/scene-graph.ts';

/**
 * Constante estándar para representar la ausencia de relleno o contorno.
 */
export const NONE_PAINT = 'none';

export type PaintState =
  | { kind: 'none' }
  | { kind: 'color'; hex: string }
  | { kind: 'gradient'; gradient: Gradient }
  | { kind: 'mixed' };

/**
 * Determina si un valor de pintura corresponde a "sin pintura" (none / transparente).
 * Retorna true para undefined, null, '', 'none' y 'transparent' (sin distinguir mayúsculas ni espacios).
 * Retorna false si es un objeto degradado (Gradient).
 */
export function isNonePaint(v: unknown): boolean {
  if (v === undefined || v === null) {
    return true;
  }
  if (typeof v === 'object') {
    return false;
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
 * Convierte componentes RGB numéricos (0-255) a cadena hexadecimal '#rrggbb'.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const hexR = clamp(r).toString(16).padStart(2, '0');
  const hexG = clamp(g).toString(16).padStart(2, '0');
  const hexB = clamp(b).toString(16).padStart(2, '0');
  return `#${hexR}${hexG}${hexB}`.toLowerCase();
}

/**
 * Muestrea el color de un píxel específico en un Canvas 2D mediante getImageData.
 * Retorna '#rrggbb' o 'none' si el píxel es totalmente transparente (alpha === 0).
 */
export function sampleCanvasPixel(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number
): string {
  try {
    const x = Math.floor(screenX);
    const y = Math.floor(screenY);
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    if (pixel[3] === 0) {
      return NONE_PAINT;
    }
    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  } catch {
    return NONE_PAINT;
  }
}

const CSS_NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  purple: '#800080',
  teal: '#008080',
  navy: '#000080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  lime: '#00ff00',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
  indigo: '#4b0082',
  violet: '#ee82ee',
  khaki: '#f0e68c',
  coral: '#ff7f50',
  salmon: '#fa8072',
  tomato: '#ff6347',
  crimson: '#dc143c',
  turquoise: '#40e0d0',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  royalblue: '#4169e1',
  midnightblue: '#191970',
  hotpink: '#ff69b4',
  deeppink: '#ff1493',
  plum: '#dda0dd',
  orchid: '#da70d6',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  snow: '#fffafa',
  seashell: '#fff5ee',
  linen: '#faf0e6',
  aliceblue: '#f0f8ff',
  lavender: '#e6e6fa',
  cornflowerblue: '#6495ed',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgreen: '#006400',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deepskyblue: '#00bfff',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  forestgreen: '#228b22',
  goldenrod: '#daa520',
  greenyellow: '#adff2f',
  lawngreen: '#7cfc00',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgreen: '#90ee90',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  limegreen: '#32cd32',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  mintcream: '#f5fffa',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  oldlace: '#fdf5e6',
  olivedrab: '#6b8e23',
  orangered: '#ff4500',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  powderblue: '#b0e0e6',
  rosybrown: '#bc8f8f',
  saddlebrown: '#8b4513',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  sienna: '#a0522d',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  springgreen: '#00ff7f',
  tan: '#d2b48c',
  thistle: '#d8bfd8',
  wheat: '#f5deb3',
  whitesmoke: '#f5f5f5',
  yellowgreen: '#9acd32',
};

/**
 * Normaliza cualquier formato de color compatible (hexadecimal, rgb/rgba, hsl/hsla o nombres CSS estándar)
 * a un código hexadecimal '#rrggbb' de 7 caracteres en minúsculas.
 * Mapea transparent a negro, y retorna null si el valor no se reconoce o es none.
 */
export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'transparent') {
    return '#000000';
  }
  if (isNonePaint(trimmed)) {
    return null;
  }

  if (CSS_NAMED_COLORS[lower]) {
    return CSS_NAMED_COLORS[lower];
  }

  const hex = parseHexColor(trimmed);
  if (hex) {
    return hex;
  }

  // 8 dígitos hexadecimales (#rrggbbaa o rrggbbaa)
  const match8 = trimmed.match(/^#?([0-9a-fA-F]{8})$/);
  if (match8) {
    return `#${match8[1].slice(0, 6).toLowerCase()}`;
  }

  // 4 dígitos hexadecimales (#rgba o rgba)
  const match4 = trimmed.match(/^#?([0-9a-fA-F]{4})$/);
  if (match4) {
    const [r, g, b] = match4[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10))).toString(16).padStart(2, '0');
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10))).toString(16).padStart(2, '0');
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10))).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  const hslMatch = trimmed.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) % 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) { r1 = c; g1 = x; }
    else if (h < 120) { r1 = x; g1 = c; }
    else if (h < 180) { g1 = c; b1 = x; }
    else if (h < 240) { g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    const r = Math.round((r1 + m) * 255).toString(16).padStart(2, '0');
    const g = Math.round((g1 + m) * 255).toString(16).padStart(2, '0');
    const b = Math.round((b1 + m) * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  return null;
}

/**
 * Obtiene el estado consolidado de pintura ('fill' o 'stroke') para un conjunto de figuras:
 * - { kind: 'none' }: Si la lista está vacía o todas las figuras carecen de pintura.
 * - { kind: 'color', hex }: Si todas las figuras comparten exactamente el mismo color tras normalizar.
 * - { kind: 'gradient', gradient }: Si todas las figuras comparten el mismo degradado.
 * - { kind: 'mixed' }: Si coexisten figuras con distintos estilos de pintura.
 */
export function getPaintState(shapes: readonly Shape[], property: 'fill' | 'stroke'): PaintState {
  if (!shapes || shapes.length === 0) {
    return { kind: 'none' };
  }

  const rawPaints = shapes.map((shape) => {
    if (property === 'fill') {
      return shape.type === 'text' ? (shape.fill ?? '#000000') : shape.fill;
    }
    return 'stroke' in shape ? shape.stroke : undefined;
  });

  const allNone = rawPaints.every(isNonePaint);
  if (allNone) {
    return { kind: 'none' };
  }

  const first = rawPaints[0];
  if (isGradient(first)) {
    const firstStr = JSON.stringify(first);
    const allSameGrad = rawPaints.every((p) => isGradient(p) && JSON.stringify(p) === firstStr);
    if (allSameGrad) {
      return { kind: 'gradient', gradient: first };
    }
    return { kind: 'mixed' };
  }

  const normalizedPaints: string[] = [];
  for (const raw of rawPaints) {
    if (isNonePaint(raw)) {
      normalizedPaints.push(NONE_PAINT);
    } else if (typeof raw === 'string') {
      const hex = normalizeColor(raw);
      normalizedPaints.push(hex ?? NONE_PAINT);
    } else {
      return { kind: 'mixed' };
    }
  }

  const firstColor = normalizedPaints[0];
  const allSame = normalizedPaints.every((p) => p === firstColor);

  if (allSame) {
    if (firstColor === NONE_PAINT) {
      return { kind: 'none' };
    }
    return { kind: 'color', hex: firstColor };
  }

  return { kind: 'mixed' };
}
