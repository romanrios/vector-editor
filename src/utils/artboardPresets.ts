/**
 * Definición de un preset de tamaño para la Mesa de Trabajo (Artboard).
 */
export interface ArtboardPreset {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Lista inmutable de presets de tamaño disponibles para la Mesa de Trabajo.
 * Diseñada para permitir la incorporación de nuevos presets en el futuro sin modificar la lógica del editor.
 */
export const ARTBOARD_PRESETS: readonly ArtboardPreset[] = Object.freeze([
  {
    id: 'a4-portrait',
    name: 'A4 vertical',
    label: 'A4 vertical (794 × 1123)',
    width: 794,
    height: 1123,
  },
  {
    id: 'a4-landscape',
    name: 'A4 horizontal',
    label: 'A4 horizontal (1123 × 794)',
    width: 1123,
    height: 794,
  },
  {
    id: 'hd',
    name: 'HD',
    label: 'HD (1280 × 720)',
    width: 1280,
    height: 720,
  },
  {
    id: 'full-hd',
    name: 'Full HD',
    label: 'Full HD (1920 × 1080)',
    width: 1920,
    height: 1080,
  },
  {
    id: 'square',
    name: 'Cuadrado',
    label: 'Cuadrado (1080 × 1080)',
    width: 1080,
    height: 1080,
  },
]);

/**
 * Busca un preset que coincida exactamente con las dimensiones (width, height) dadas.
 * Retorna el preset encontrado o null si no coincide con ninguno (dimensión personalizada).
 */
export function findPresetForSize(width: number, height: number): ArtboardPreset | null {
  for (let i = 0; i < ARTBOARD_PRESETS.length; i++) {
    const preset = ARTBOARD_PRESETS[i];
    if (preset.width === width && preset.height === height) {
      return preset;
    }
  }
  return null;
}

/**
 * Obtiene un preset a partir de su identificador id.
 */
export function getPresetById(id: string): ArtboardPreset | undefined {
  for (let i = 0; i < ARTBOARD_PRESETS.length; i++) {
    const preset = ARTBOARD_PRESETS[i];
    if (preset.id === id) {
      return preset;
    }
  }
  return undefined;
}
