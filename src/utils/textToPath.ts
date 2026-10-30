import opentype from 'opentype.js';
import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  Path,
  PathPoint,
  Text,
} from '../types/scene-graph.ts';
import { isGroup, isText } from '../types/scene-graph.ts';
import { parseSvgPathD } from './svg/pathParser.ts';
import {
  getTextLineRanges,
  getTextLineHeight,
  getTextMeasureContext,
} from './geometry.ts';
import { splitTextIntoRuns } from './textSpans.ts';

interface OpenTypeVariationManager {
  getTransform(glyph: opentype.Glyph, coords?: Record<string, number>): opentype.Glyph;
}

interface OpenTypeVariableFont extends opentype.Font {
  variation?: OpenTypeVariationManager;
}

export interface TextToPathOptions {
  /**
   * Precisión de coordenadas decimales (por defecto 2).
   */
  readonly precision?: number;

  /**
   * Proveedor personalizado para resolver y descargar buffers de fuentes.
   */
  readonly fontResolver?: (
    fontFamily: string,
    fontWeight?: string | number,
    fontStyle?: string
  ) => Promise<ArrayBuffer | Uint8Array | null>;
}

let glyphIdCounter = 0;

/**
 * Convierte cualquier representación de peso de fuente a un valor numérico estándar (100-900).
 */
export function parseFontWeight(weight?: string | number): number {
  if (typeof weight === 'number') {
    return Math.max(100, Math.min(900, Math.round(weight)));
  }
  if (!weight) return 400;
  const str = String(weight).trim().toLowerCase();
  if (str === 'bold' || str === 'bolder') return 700;
  if (str === 'normal') return 400;
  if (str === 'lighter') return 300;
  const parsed = parseInt(str, 10);
  if (!isNaN(parsed)) {
    return Math.max(100, Math.min(900, Math.round(parsed)));
  }
  return 400;
}

const gvarMasks = {
  SHARED_POINT_NUMBERS: 0x8000,
  COUNT_MASK: 0x0fff,
  EMBEDDED_PEAK_TUPLE: 0x8000,
  INTERMEDIATE_REGION: 0x4000,
  PRIVATE_POINT_NUMBERS: 0x2000,
  TUPLE_INDEX_MASK: 0x0fff,
};

function copyPoint(point: any) {
  return {
    x: point.x,
    y: point.y,
    onCurve: point.onCurve,
    lastPointOfContour: point.lastPointOfContour,
  };
}

/**
 * Corrige el analizador TupleVariationStore de OpenType.js.
 *
 * En la especificación TrueType Font Variations:
 * Cuando una cabecera de variación define PRIVATE_POINT_NUMBERS pero el recuento de puntos
 * privados es 0, los deltas se aplican a TODOS los puntos del glifo (pointsCount = glyph.points.length + 4).
 * El analizador nativo de OpenType.js evaluaba `header.privatePoints.length || sharedPoints.length`.
 * Dado que `0 || sharedPoints.length` resulta en truthy con el recuento de puntos compartidos,
 * leía solo un subconjunto de deltas de X y leía el resto de deltas de X como si fueran de Y,
 * corrompiendo totalmente formas como la 'o' de Montserrat en pesos superiores a 400.
 */
function ensureParserPatched(): void {
  const otAny = opentype as any;
  if (!otAny._parse?.Parser?.prototype) return;
  const proto = otAny._parse.Parser.prototype;
  if (proto._patchedTupleStore) return;

  proto.parseTupleVariationStore = function (
    tableOffset: number,
    axisCount: number,
    flavor: string,
    glyphs: any,
    glyphIndex: number
  ) {
    const relativeOffset = this.relativeOffset;
    this.relativeOffset = tableOffset;
    if (flavor === 'cvar') {
      this.relativeOffset += 4;
    }
    const tupleVariationCount = this.parseUShort();
    const hasSharedPoints = !!(tupleVariationCount & gvarMasks.SHARED_POINT_NUMBERS);
    const count = tupleVariationCount & gvarMasks.COUNT_MASK;
    const dataOffset = this.parseOffset16();
    const headers: any[] = [];
    let sharedPoints: number[] = [];
    for (let h = 0; h < count; h++) {
      const headerData = this.parseTupleVariationHeader(axisCount, flavor);
      headers.push(headerData);
    }
    if (this.relativeOffset !== tableOffset + dataOffset) {
      this.relativeOffset = tableOffset + dataOffset;
    }
    if (hasSharedPoints) {
      sharedPoints = this.parsePackedPointNumbers();
    }
    let serializedDataOffset = this.relativeOffset;
    for (let h = 0; h < count; h++) {
      const header = headers[h];
      header.privatePoints = [];
      this.relativeOffset = serializedDataOffset;
      const hasPrivatePoints = !!(header.flags && header.flags.privatePointNumbers);
      header.hasPrivatePoints = hasPrivatePoints;
      if (hasPrivatePoints) {
        header.privatePoints = this.parsePackedPointNumbers();
      }
      delete header.flags;
      const deltasOffset = this.offset;
      const deltasRelativeOffset = this.relativeOffset;
      const defineDeltas = (propertyName: string) => {
        let _deltas: any = undefined;
        let _deltasY: any = undefined;
        const parseDeltas = () => {
          let pointsCount = 0;
          if (flavor === 'gvar') {
            if (header.hasPrivatePoints) {
              pointsCount = header.privatePoints.length;
              if (!pointsCount) {
                const glyph = glyphs.get(glyphIndex);
                glyph.path;
                const isComposite =
                  (glyph.numberOfContours ?? 0) < 0 ||
                  (glyph.components && glyph.components.length > 0);
                pointsCount = isComposite
                  ? glyph.components.length + 4
                  : glyph.points.length + 4;
              }
            } else {
              pointsCount = sharedPoints.length;
              if (!pointsCount) {
                const glyph = glyphs.get(glyphIndex);
                glyph.path;
                const isComposite =
                  (glyph.numberOfContours ?? 0) < 0 ||
                  (glyph.components && glyph.components.length > 0);
                pointsCount = isComposite
                  ? glyph.components.length + 4
                  : glyph.points.length + 4;
              }
            }
          } else if (flavor === 'cvar') {
            pointsCount = glyphs.length;
          }
          this.offset = deltasOffset;
          this.relativeOffset = deltasRelativeOffset;
          _deltas = this.parsePackedDeltas(pointsCount);
          if (flavor === 'gvar') {
            _deltasY = this.parsePackedDeltas(pointsCount);
          }
        };
        return {
          configurable: true,
          get: function () {
            if (_deltas === undefined) parseDeltas();
            return propertyName === 'deltasY' ? _deltasY : _deltas;
          },
          set: function (deltas: any) {
            if (_deltas === undefined) parseDeltas();
            if (propertyName === 'deltasY') {
              _deltasY = deltas;
            } else {
              _deltas = deltas;
            }
          },
        };
      };
      Object.defineProperty(header, 'deltas', defineDeltas.call(this, 'deltas'));
      if (flavor === 'gvar') {
        Object.defineProperty(header, 'deltasY', defineDeltas.call(this, 'deltasY'));
      }
      serializedDataOffset += header.variationDataSize;
      delete header.variationDataSize;
    }
    this.relativeOffset = relativeOffset;
    const result: any = { headers };
    result.sharedPoints = sharedPoints;
    return result;
  };

  proto._patchedTupleStore = true;
}

ensureParserPatched();

/**
 * Aplica correcciones críticas al procesador de fuentes variables de OpenType.js.
 *
 * 1. Corrige el algoritmo TrueType IUP (Interpolate Unreferenced Points) en deltaInterpolate:
 *    - Cuando dos puntos de referencia comparten la misma coordenada (in1 === in2),
 *      OpenType.js los descartaba por completo si out1 !== out2, deformando glifos como la 'o' de Montserrat.
 *      Aplica el desplazamiento promedio de acuerdo a la especificación OpenType.
 *    - Evita mutar los índices ref1 y ref2 entre las iteraciones de los ejes X e Y.
 *
 * 2. Corrige applyTupleVariationStore para respetar tuplePoints cuando hasPrivatePoints es true
 *    pero privatePoints está vacío (indicando que los deltas aplican directamente a todos los puntos).
 */
export function patchFontInstance(font: opentype.Font): opentype.Font {
  ensureParserPatched();
  const vFont = font as any;
  if (vFont.variation?.process) {
    const process = vFont.variation.process;
    if (!process._patchedAll) {
      process.deltaInterpolate = function (
        p1: number,
        p2: number,
        ref1: number,
        ref2: number,
        glyphPoints: any[],
        points: any[]
      ) {
        if (p1 > p2) return;
        const iterable = ['x', 'y'];
        for (let i = 0; i < iterable.length; i++) {
          const k = iterable[i];
          let r1 = ref1;
          let r2 = ref2;
          if (glyphPoints[r1][k] > glyphPoints[r2][k]) {
            const tmp = r1;
            r1 = r2;
            r2 = tmp;
          }
          const in1 = glyphPoints[r1][k];
          const in2 = glyphPoints[r2][k];
          const out1 = points[r1][k];
          const out2 = points[r2][k];
          if (in1 !== in2) {
            const scale = (out2 - out1) / (in2 - in1);
            for (let p3 = p1; p3 <= p2; p3++) {
              const val = glyphPoints[p3][k];
              if (val <= in1) {
                points[p3][k] = val + (out1 - in1);
              } else if (val >= in2) {
                points[p3][k] = val + (out2 - in2);
              } else {
                points[p3][k] = out1 + (val - in1) * scale;
              }
            }
          } else {
            const shift = (out1 - in1 + (out2 - in2)) / 2;
            for (let p3 = p1; p3 <= p2; p3++) {
              points[p3][k] = glyphPoints[p3][k] + shift;
            }
          }
        }
      };

      process.applyTupleVariationStore = function (
        variationData: any,
        points: any[],
        coords: any,
        flavor = 'gvar',
        args: any = {}
      ) {
        if (!coords) {
          coords = this.font.variation.get();
        }
        const normalizedCoords = this.getNormalizedCoords(coords);
        const { headers, sharedPoints } = variationData;
        const axisCount = this.fvar().axes.length;

        const glyph = args.glyph;
        const isComposite =
          glyph &&
          ((glyph.numberOfContours ?? 0) < 0 ||
            (glyph.components && glyph.components.length > 0));

        if (flavor === 'gvar' && isComposite) {
          const compTransforms = glyph.components.map((c: any) => ({
            glyphIndex: c.glyphIndex,
            xScale: c.xScale ?? 1,
            scale01: c.scale01 ?? 0,
            scale10: c.scale10 ?? 0,
            yScale: c.yScale ?? 1,
            dx: c.dx ?? 0,
            dy: c.dy ?? 0,
          }));

          for (let h = 0; h < headers.length; h++) {
            const header = headers[h];
            let factor = 1;
            for (let a = 0; a < axisCount; a++) {
              let tupleCoords = header.peakTuple
                ? header.peakTuple
                : this.gvar().sharedTuples[header.sharedTupleRecordsIndex];
              if (tupleCoords[a] === 0) continue;
              if (normalizedCoords[a] === 0) {
                factor = 0;
                break;
              }
              if (!header.intermediateStartTuple) {
                if (
                  normalizedCoords[a] < Math.min(0, tupleCoords[a]) ||
                  normalizedCoords[a] > Math.max(0, tupleCoords[a])
                ) {
                  factor = 0;
                  break;
                }
                factor =
                  (factor * normalizedCoords[a] + Number.EPSILON) /
                  (tupleCoords[a] + Number.EPSILON);
              } else {
                if (
                  normalizedCoords[a] < header.intermediateStartTuple[a] ||
                  normalizedCoords[a] > header.intermediateEndTuple[a]
                ) {
                  factor = 0;
                  break;
                } else if (normalizedCoords[a] < tupleCoords[a]) {
                  factor =
                    (factor *
                      (normalizedCoords[a] - header.intermediateStartTuple[a] + Number.EPSILON)) /
                    (tupleCoords[a] - header.intermediateStartTuple[a] + Number.EPSILON);
                } else {
                  factor =
                    (factor *
                      (header.intermediateEndTuple[a] - normalizedCoords[a] + Number.EPSILON)) /
                    (header.intermediateEndTuple[a] - tupleCoords[a] + Number.EPSILON);
                }
              }
            }
            if (factor === 0) continue;

            const tuplePoints = header.hasPrivatePoints
              ? header.privatePoints
              : header.privatePoints && header.privatePoints.length
                ? header.privatePoints
                : sharedPoints;

            for (let c = 0; c < glyph.components.length; c++) {
              const deltaIndex = tuplePoints.length === 0 ? c : tuplePoints.indexOf(c);
              if (deltaIndex > -1 && deltaIndex < header.deltas.length) {
                compTransforms[c].dx += Math.round(header.deltas[deltaIndex] * factor);
                compTransforms[c].dy += Math.round(header.deltasY[deltaIndex] * factor);
              }
            }
          }

          const transformedPoints: any[] = [];
          for (let c = 0; c < glyph.components.length; c++) {
            const component = glyph.components[c];
            const componentGlyph = this.font.glyphs.get(component.glyphIndex);
            const variedComponentGlyph = this.getTransform(componentGlyph, coords);
            const compPoints = variedComponentGlyph.points || [];
            const transform = compTransforms[c];
            for (let i = 0; i < compPoints.length; i++) {
              const pt = compPoints[i];
              transformedPoints.push({
                x: transform.xScale * pt.x + transform.scale10 * pt.y + transform.dx,
                y: transform.scale01 * pt.x + transform.yScale * pt.y + transform.dy,
                onCurve: pt.onCurve,
                lastPointOfContour: pt.lastPointOfContour,
              });
            }
          }
          return transformedPoints;
        }

        let transformedPoints: any[];
        if (flavor === 'gvar') {
          transformedPoints = points.map(copyPoint);
        } else if (flavor === 'cvar') {
          transformedPoints = [...points];
        } else {
          transformedPoints = points;
        }
        for (let h = 0; h < headers.length; h++) {
          const header = headers[h];
          let factor = 1;
          for (let a = 0; a < axisCount; a++) {
            let tupleCoords = [0];
            switch (flavor) {
              case 'gvar':
                tupleCoords = header.peakTuple
                  ? header.peakTuple
                  : this.gvar().sharedTuples[header.sharedTupleRecordsIndex];
                break;
              case 'cvar':
                tupleCoords = header.peakTuple;
                break;
            }
            if (tupleCoords[a] === 0) {
              continue;
            }
            if (normalizedCoords[a] === 0) {
              factor = 0;
              break;
            }
            if (!header.intermediateStartTuple) {
              if (
                normalizedCoords[a] < Math.min(0, tupleCoords[a]) ||
                normalizedCoords[a] > Math.max(0, tupleCoords[a])
              ) {
                factor = 0;
                break;
              }
              factor =
                (factor * normalizedCoords[a] + Number.EPSILON) /
                (tupleCoords[a] + Number.EPSILON);
            } else {
              if (
                normalizedCoords[a] < header.intermediateStartTuple[a] ||
                normalizedCoords[a] > header.intermediateEndTuple[a]
              ) {
                factor = 0;
                break;
              } else if (normalizedCoords[a] < tupleCoords[a]) {
                factor =
                  (factor *
                    (normalizedCoords[a] - header.intermediateStartTuple[a] + Number.EPSILON)) /
                  (tupleCoords[a] - header.intermediateStartTuple[a] + Number.EPSILON);
              } else {
                factor =
                  (factor *
                    (header.intermediateEndTuple[a] - normalizedCoords[a] + Number.EPSILON)) /
                  (header.intermediateEndTuple[a] - tupleCoords[a] + Number.EPSILON);
              }
            }
          }
          if (factor === 0) {
            continue;
          }
          const tuplePoints = header.hasPrivatePoints
            ? header.privatePoints
            : header.privatePoints && header.privatePoints.length
              ? header.privatePoints
              : sharedPoints;
          if (tuplePoints.length === 0) {
            for (let i = 0; i < transformedPoints.length; i++) {
              const point = transformedPoints[i];
              if (flavor === 'gvar') {
                transformedPoints[i] = {
                  x: Math.round(point.x + header.deltas[i] * factor),
                  y: Math.round(point.y + header.deltasY[i] * factor),
                  onCurve: point.onCurve,
                  lastPointOfContour: point.lastPointOfContour,
                };
              } else if (flavor === 'cvar') {
                transformedPoints[i] = Math.round(point + header.deltas[i] * factor);
              }
            }
          } else {
            let interpolatedPoints: any[];
            if (flavor === 'gvar') {
              interpolatedPoints = transformedPoints.map(copyPoint);
            } else {
              interpolatedPoints = transformedPoints;
            }
            const deltaMap = Array(points.length).fill(false);
            for (let i = 0; i < tuplePoints.length; i++) {
              const pointIndex = tuplePoints[i];
              if (pointIndex < points.length) {
                const point = interpolatedPoints[pointIndex];
                if (flavor === 'gvar') {
                  deltaMap[pointIndex] = true;
                  point.x += header.deltas[i] * factor;
                  point.y += header.deltasY[i] * factor;
                } else if (flavor === 'cvar') {
                  transformedPoints[pointIndex] = Math.round(point + header.deltas[i] * factor);
                }
              }
            }
            if (flavor === 'gvar') {
              this.interpolatePoints(interpolatedPoints, transformedPoints, deltaMap);
              for (let i = 0; i < points.length; i++) {
                const deltaX = interpolatedPoints[i].x - transformedPoints[i].x;
                const deltaY = interpolatedPoints[i].y - transformedPoints[i].y;
                transformedPoints[i].x = Math.round(transformedPoints[i].x + deltaX);
                transformedPoints[i].y = Math.round(transformedPoints[i].y + deltaY);
              }
            }
          }
        }
        return transformedPoints;
      };

      process._patchedAll = true;
    }
  }
  return font;
}

/**
 * Obtiene las coordenadas para el eje de variación 'wght' de una fuente OpenType variable,
 * acotando los valores a los límites permitidos por la tabla fvar.
 *
 * NOTA: Omitimos deliberadamente el eje 'opsz' (optical size) porque Canvas 2D en el navegador
 * renderiza por defecto sin variación forzada de opsz, y el motor de OpenType.js presenta
 * artefactos en el cálculo de deltas multieje que distorsionan trazos y acentos (i, j, ñ).
 */
function getVariationCoords(
  font: opentype.Font,
  weight: number
): Record<string, number> | undefined {
  const vFont = font as OpenTypeVariableFont;
  if (!vFont.variation || !font.tables?.fvar?.axes) {
    return undefined;
  }
  const coords: Record<string, number> = {};
  const wghtAxis = font.tables.fvar.axes.find((a: any) => a.tag === 'wght');
  if (wghtAxis) {
    coords.wght = Math.max(wghtAxis.minValue, Math.min(wghtAxis.maxValue, weight));
  }
  return Object.keys(coords).length > 0 ? coords : undefined;
}

/**
 * Calcula la distancia vertical desde el origen superior de la línea ('top' textBaseline)
 * hasta la línea base alfabética ('alphabetic' baseline).
 *
 * Utiliza el contexto 2D compartido del navegador si está disponible para máxima fidelidad subpíxel;
 * en caso contrario (o en entornos Node.js), calcula la proporción tipográfica exacta
 * a partir de las tablas OpenType sTypoAscender / sTypoDescender del archivo de la fuente.
 */
export function getBaselineOffsetFromTop(
  font: opentype.Font,
  fontSize: number,
  fontFamily: string,
  fontWeight?: string | number,
  fontStyle?: string
): number {
  const measureCtx = getTextMeasureContext();
  if (measureCtx && typeof measureCtx.measureText === 'function') {
    const fontParts: string[] = [];
    if (fontStyle && fontStyle !== 'normal') {
      fontParts.push(fontStyle);
    }
    if (fontWeight && fontWeight !== 'normal' && fontWeight !== 400) {
      fontParts.push(String(fontWeight));
    }
    const safeFamily =
      fontFamily.includes(' ') && !fontFamily.startsWith('"') && !fontFamily.startsWith("'")
        ? `"${fontFamily}"`
        : fontFamily;
    fontParts.push(`${fontSize}px`);
    fontParts.push(safeFamily);

    try {
      measureCtx.font = fontParts.join(' ');
      measureCtx.textBaseline = 'top';
      const tm = measureCtx.measureText('M');
      if (typeof tm.alphabeticBaseline === 'number' && !isNaN(tm.alphabeticBaseline)) {
        return Math.abs(tm.alphabeticBaseline);
      }
    } catch (_) { }
  }

  // Fallback analítico basado en las métricas tipográficas nativas de OpenType
  const typoAscender =
    font.tables?.os2?.sTypoAscender ??
    font.tables?.hhea?.ascender ??
    font.ascender ??
    1984;
  const typoDescender = Math.abs(
    font.tables?.os2?.sTypoDescender ??
    font.tables?.hhea?.descender ??
    font.descender ??
    -494
  );
  const totalLineSpan = typoAscender + typoDescender;
  const ratio = totalLineSpan > 0 ? typoAscender / totalLineSpan : 0.8;
  return ratio * fontSize;
}

/**
 * Caché en memoria para fuentes OpenType parseadas (evita lecturas o descargas repetidas).
 */
const fontCache = new Map<string, Promise<opentype.Font>>();

/**
 * Caché en memoria para buffers de fuentes ya descargados o leídos de disco.
 */
const fontBufferCache = new Map<string, Promise<ArrayBuffer>>();

/**
 * Permite registrar una fuente OpenType directamente en la caché (útil para pruebas unitarias o fuentes precargadas).
 */
export function registerFont(cacheKey: string, font: opentype.Font): void {
  patchFontInstance(font);
  fontCache.set(cacheKey.toLowerCase().trim(), Promise.resolve(font));
}

/**
 * Limpia la caché interna de fuentes.
 */
export function clearFontCache(): void {
  fontCache.clear();
  fontBufferCache.clear();
}

/**
 * Determina la ruta relativa o nombre de archivo de la fuente local según familia, peso y estilo.
 */
export function resolveFontPath(
  fontFamily?: string,
  fontWeight?: string | number,
  fontStyle?: string
): string {
  const normFamily = (fontFamily || 'Inter').toLowerCase().trim();
  const isItalic = fontStyle === 'italic';
  const weight = parseFontWeight(fontWeight);

  switch (normFamily) {
    case 'inter':
      return isItalic
        ? 'fonts/inter/InterVariable-Italic.ttf'
        : 'fonts/inter/InterVariable.ttf';
    case 'montserrat':
      return isItalic
        ? 'fonts/montserrat/Montserrat-Italic[wght].ttf'
        : 'fonts/montserrat/Montserrat[wght].ttf';
    case 'roboto':
      return isItalic
        ? 'fonts/roboto/roboto-latin-wght-italic.ttf'
        : 'fonts/roboto/roboto-latin-wght-normal.ttf';
    case 'open sans':
      return isItalic
        ? 'fonts/open-sans/open-sans-latin-wght-italic.ttf'
        : 'fonts/open-sans/open-sans-latin-wght-normal.ttf';
    case 'bebas neue':
      return 'fonts/bebas-neue/bebas-neue-latin-400-normal.ttf';
    case 'fira code':
      return 'fonts/fira-code/fira-code-latin-wght-normal.ttf';
    case 'roboto mono':
      return isItalic
        ? 'fonts/roboto-mono/roboto-mono-latin-wght-italic.ttf'
        : 'fonts/roboto-mono/roboto-mono-latin-wght-normal.ttf';
    case 'google sans':
      return isItalic
        ? 'fonts/google-sans/google-sans-latin-wght-italic.ttf'
        : 'fonts/google-sans/google-sans-latin-wght-normal.ttf';
    case 'lora':
      return isItalic
        ? 'fonts/lora/lora-latin-wght-italic.ttf'
        : 'fonts/lora/lora-latin-wght-normal.ttf';
    case 'merriweather':
      return isItalic
        ? 'fonts/merriweather/merriweather-latin-wght-italic.ttf'
        : 'fonts/merriweather/merriweather-latin-wght-normal.ttf';
    case 'playfair display':
      return isItalic
        ? 'fonts/playfair/playfair-latin-wght-italic.ttf'
        : 'fonts/playfair/playfair-latin-wght-normal.ttf';
    case 'poppins': {
      const roundedWeight = Math.round(weight / 100) * 100;
      const safeWeight = Math.max(100, Math.min(900, roundedWeight || 400));
      const styleStr = isItalic ? 'italic' : 'normal';
      return `fonts/poppins/poppins-latin-${safeWeight}-${styleStr}.woff`;
    }
    // Fuentes del sistema mapeadas a sus equivalentes locales de alta fidelidad
    case 'arial':
    case 'helvetica':
    case 'sans-serif':
      return isItalic
        ? 'fonts/inter/InterVariable-Italic.ttf'
        : 'fonts/inter/InterVariable.ttf';
    case 'georgia':
    case 'times new roman':
    case 'serif':
      return isItalic
        ? 'fonts/merriweather/merriweather-latin-wght-italic.ttf'
        : 'fonts/merriweather/merriweather-latin-wght-normal.ttf';
    case 'courier new':
    case 'monospace':
      return isItalic
        ? 'fonts/roboto-mono/roboto-mono-latin-wght-italic.ttf'
        : 'fonts/roboto-mono/roboto-mono-latin-wght-normal.ttf';
    default:
      return isItalic
        ? 'fonts/inter/InterVariable-Italic.ttf'
        : 'fonts/inter/InterVariable.ttf';
  }
}

/**
 * Carga el buffer binario de una fuente tanto en el navegador como en Node.js.
 */
async function fetchFontBuffer(fontRelativePath: string): Promise<ArrayBuffer> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const base =
      typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
        ? import.meta.env.BASE_URL
        : '/';
    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    const cleanPath = fontRelativePath.replace(/^\/+/, '');
    const url = `${cleanBase}${cleanPath}`;
    const res = await fetch(encodeURI(url));
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al descargar fuente en ${url}`);
    }
    return await res.arrayBuffer();
  }

  // Entorno Node.js
  const fsMod = 'fs';
  const pathMod = 'path';
  const fs = await import(/* @vite-ignore */ fsMod);
  const path = await import(/* @vite-ignore */ pathMod);
  const clean = fontRelativePath.replace(/^\/+/, '');
  const candidatePaths = [
    path.resolve(process.cwd(), clean),
    path.resolve(process.cwd(), clean.startsWith('public') ? clean : `public/${clean}`),
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const buf = fs.readFileSync(candidate);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  }
  throw new Error(`No se pudo encontrar el archivo de fuente local: ${fontRelativePath}`);
}

/**
 * Comprueba si un buffer corresponde al encabezado 'wOF2' (magic number 0x774F4632).
 */
function isWoff2(buffer: ArrayBuffer | Uint8Array): boolean {
  if (buffer.byteLength < 4) return false;
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return (
    view[0] === 0x77 && // 'w'
    view[1] === 0x4f && // 'O'
    view[2] === 0x46 && // 'F'
    view[3] === 0x32    // '2'
  );
}

/**
 * Carga y parsea una fuente OpenType con soporte transparente para descompresión WOFF2.
 */
export async function loadFont(
  fontFamily?: string,
  fontWeight?: string | number,
  fontStyle?: string,
  customResolver?: TextToPathOptions['fontResolver']
): Promise<opentype.Font> {
  const normFamily = (fontFamily || 'Inter').toLowerCase().trim();
  const isItalic = fontStyle === 'italic';
  const weight = parseFontWeight(fontWeight);
  const cacheKey = `${normFamily}-${weight}-${isItalic ? 'italic' : 'normal'}`;

  const cached = fontCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const loadPromise = (async () => {
    let fontBuffer: ArrayBuffer | Uint8Array | null = null;
    if (customResolver) {
      fontBuffer = await customResolver(fontFamily || 'Inter', weight, fontStyle);
    }

    const fontPath = resolveFontPath(fontFamily, weight, fontStyle);
    if (!fontBuffer) {
      try {
        let bufPromise = fontBufferCache.get(fontPath);
        if (!bufPromise) {
          bufPromise = fetchFontBuffer(fontPath);
          fontBufferCache.set(fontPath, bufPromise);
        }
        fontBuffer = await bufPromise;
      } catch (err) {
        fontBufferCache.delete(fontPath);
        // Fallback resiliente a Inter
        if (normFamily !== 'inter') {
          const fallbackPath = resolveFontPath('Inter', 400, 'normal');
          let fallbackPromise = fontBufferCache.get(fallbackPath);
          if (!fallbackPromise) {
            fallbackPromise = fetchFontBuffer(fallbackPath);
            fontBufferCache.set(fallbackPath, fallbackPromise);
          }
          fontBuffer = await fallbackPromise;
        } else {
          throw err;
        }
      }
    }

    let ttfBuffer: ArrayBuffer;
    if (isWoff2(fontBuffer) || fontPath.toLowerCase().endsWith('.woff2')) {
      if (typeof window === 'undefined') {
        const { decompress } = await import(/* @vite-ignore */ 'wawoff2');
        const u8 = await decompress(fontBuffer);
        ttfBuffer = (u8.buffer as ArrayBuffer).slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      } else {
        throw new Error('Las fuentes WOFF2 requieren conversión previa a TTF en el navegador.');
      }
    } else {
      ttfBuffer =
        fontBuffer instanceof ArrayBuffer
          ? fontBuffer
          : (fontBuffer.buffer as ArrayBuffer).slice(
            fontBuffer.byteOffset,
            fontBuffer.byteOffset + fontBuffer.byteLength
          );
    }

    const font = opentype.parse(ttfBuffer);
    return patchFontInstance(font);
  })();

  fontCache.set(cacheKey, loadPromise);
  return await loadPromise;
}

/**
 * Rota un punto bidimensional alrededor de un centro dado.
 */
function rotatePoint(
  pt: { x: number; y: number },
  center: { x: number; y: number },
  cos: number,
  sin: number
): { x: number; y: number } {
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Convierte un elemento Text en una colección de figuras vectoriales Path con sus curvas de Bézier exactas.
 */
export async function convertTextToPaths(
  text: Text,
  options: TextToPathOptions = {}
): Promise<Path[]> {
  const content = text.text ?? '';
  if (!content) {
    return [];
  }

  const { precision = 2, fontResolver } = options;
  const measureCtx = getTextMeasureContext();
  const lineHeight = getTextLineHeight(text);
  const lines = getTextLineRanges(text, measureCtx);
  const paths: Path[] = [];

  const hasRotation = Boolean(text.rotation);
  const rotRad = hasRotation ? ((text.rotation ?? 0) * Math.PI) / 180 : 0;
  const cos = hasRotation ? Math.cos(rotRad) : 1;
  const sin = hasRotation ? Math.sin(rotRad) : 0;
  const rotCenter = { x: text.x, y: text.y };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const { text: lineText, start: lineStart, end: lineEnd } = lines[lineIndex];
    if (!lineText) {
      continue;
    }

    const lineY = text.y + lineIndex * lineHeight;
    const runs = splitTextIntoRuns(text, lineStart, lineEnd);

    // 1. Resolver todas las fuentes y glifos de la línea para calcular el avance métrico exacto
    interface CharLayoutItem {
      readonly ch: string;
      readonly glyph: opentype.Glyph;
      readonly varCoords?: Record<string, number>;
      readonly font: opentype.Font;
      readonly fSize: number;
      readonly lSpacing: number;
      readonly adv: number;
      readonly baselineOffset: number;
      readonly style: any;
    }

    const lineChars: CharLayoutItem[] = [];

    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      if (!run.text) {
        continue;
      }

      const targetWeight = parseFontWeight(run.style.fontWeight);
      const font = await loadFont(
        run.style.fontFamily,
        targetWeight,
        run.style.fontStyle,
        fontResolver
      );
      patchFontInstance(font);

      const fSize = run.style.fontSize;
      const lSpacing = run.style.letterSpacing;
      const unitsPerEm = font.unitsPerEm || 2048;
      const baselineOffset = getBaselineOffsetFromTop(
        font,
        fSize,
        run.style.fontFamily,
        targetWeight,
        run.style.fontStyle
      );
      const varCoords = getVariationCoords(font, targetWeight);
      const vFont = font as OpenTypeVariableFont;

      for (let c = 0; c < run.text.length; c++) {
        const ch = run.text[c];
        const glyph = font.charToGlyph(ch);
        const gAny = glyph as any;
        if ((gAny.numberOfContours ?? 0) < 0 || (gAny.components?.length ?? 0) > 0) {
          gAny.isComposite = true;
        }
        const varGlyph =
          vFont.variation && varCoords ? vFont.variation.getTransform(glyph, varCoords) : glyph;
        const adv =
          typeof varGlyph.advanceWidth === 'number' && varGlyph.advanceWidth > 0
            ? (varGlyph.advanceWidth / unitsPerEm) * fSize
            : fSize * 0.6;

        lineChars.push({
          ch,
          glyph,
          varCoords,
          font,
          fSize,
          lSpacing,
          adv,
          baselineOffset,
          style: run.style,
        });
      }
    }

    if (lineChars.length === 0) {
      continue;
    }

    // 2. Ancho total de la línea calculado exactamente a partir de los avances de los glifos
    let totalLineWidth = 0;
    for (let i = 0; i < lineChars.length; i++) {
      totalLineWidth += lineChars[i].adv;
      if (i < lineChars.length - 1) {
        if (lineChars[i].lSpacing !== 0) {
          totalLineWidth += lineChars[i].lSpacing;
        }
        const curr = lineChars[i];
        const next = lineChars[i + 1];
        if (curr.font === next.font) {
          const kern = curr.font.getKerningValue(curr.glyph, next.glyph);
          if (kern) {
            totalLineWidth += (kern / (curr.font.unitsPerEm || 2048)) * curr.fSize;
          }
        }
      }
    }

    // 3. Inicio horizontal de la línea según alineación tipográfica
    let lineStartX = text.x;
    const hasBoxWidth = typeof text.boxWidth === 'number' && text.boxWidth > 0;
    if (hasBoxWidth) {
      if (text.textAlign === 'center') {
        lineStartX = text.x + (text.boxWidth! - totalLineWidth) / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x + text.boxWidth! - totalLineWidth;
      }
    } else {
      if (text.textAlign === 'center') {
        lineStartX = text.x - totalLineWidth / 2;
      } else if (text.textAlign === 'right') {
        lineStartX = text.x - totalLineWidth;
      }
    }

    // 4. Ubicar y vectorizar cada glifo en su posición milimétrica exacta
    let cursorX = lineStartX;

    for (let i = 0; i < lineChars.length; i++) {
      const item = lineChars[i];
      const { ch, glyph, varCoords, font, fSize, lSpacing, adv, baselineOffset, style } = item;

      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
        const glyphX = cursorX;
        const baselineY = lineY + baselineOffset;

        const glyphPath = glyph.getPath(
          glyphX,
          baselineY,
          fSize,
          (varCoords ? { variation: varCoords } : undefined) as any,
          font
        );

        const svgD = glyphPath.toPathData(precision);
        if (svgD && svgD.trim().length > 0) {
          const parsed = parseSvgPathD(svgD);
          if (parsed.points.length > 0) {
            // Aplicar rotación a los puntos del trazado si corresponde
            const finalPoints: PathPoint[] = parsed.points.map((pt) => {
              let px = pt.x;
              let py = pt.y;
              let hIn = pt.handleIn;
              let hOut = pt.handleOut;

              if (hasRotation) {
                const rot = rotatePoint(pt, rotCenter, cos, sin);
                px = rot.x;
                py = rot.y;
                if (hIn) {
                  const rIn = rotatePoint(hIn, rotCenter, cos, sin);
                  hIn = { x: rIn.x, y: rIn.y };
                }
                if (hOut) {
                  const rOut = rotatePoint(hOut, rotCenter, cos, sin);
                  hOut = { x: rOut.x, y: rOut.y };
                }
              }

              return {
                x: Math.round(px * 100) / 100,
                y: Math.round(py * 100) / 100,
                ...(hIn
                  ? { handleIn: { x: Math.round(hIn.x * 100) / 100, y: Math.round(hIn.y * 100) / 100 } }
                  : {}),
                ...(hOut
                  ? { handleOut: { x: Math.round(hOut.x * 100) / 100, y: Math.round(hOut.y * 100) / 100 } }
                  : {}),
                pointType: pt.pointType,
                ...(pt.moveTo ? { moveTo: true } : {}),
                ...(pt.closeSubpath ? { closeSubpath: true } : {}),
              };
            });

            let minX = finalPoints[0].x;
            let minY = finalPoints[0].y;
            for (let k = 1; k < finalPoints.length; k++) {
              minX = Math.min(minX, finalPoints[k].x);
              minY = Math.min(minY, finalPoints[k].y);
            }

            glyphIdCounter++;
            const pathNode: Path = {
              id: `glyph-${Date.now()}-${glyphIdCounter}`,
              name: `Glifo ${ch}`,
              type: 'path',
              x: minX,
              y: minY,
              points: Object.freeze(finalPoints),
              closed: true,
              fill: style.fill ?? text.fill ?? '#000000',
              stroke: text.stroke,
              strokeWidth: text.strokeWidth,
              strokeLineCap: text.strokeLineCap,
              strokeLineJoin: text.strokeLineJoin,
              strokeDashArray: text.strokeDashArray,
              opacity: text.opacity,
              fillRule: 'nonzero',
              visible: text.visible !== false,
              locked: Boolean(text.locked),
            };

            paths.push(pathNode);
          }
        }
      }

      cursorX += adv;
      if (i < lineChars.length - 1) {
        if (lSpacing !== 0) {
          cursorX += lSpacing;
        }
        const next = lineChars[i + 1];
        if (font === next.font) {
          const kern = font.getKerningValue(glyph, next.glyph);
          if (kern) {
            cursorX += (kern / (font.unitsPerEm || 2048)) * fSize;
          }
        }
      }
    }
  }

  return paths;
}

/**
 * Convierte un elemento Text en un Group de figuras vectoriales Path.
 */
export async function convertTextToGroup(
  text: Text,
  options: TextToPathOptions & { preserveId?: boolean } = {}
): Promise<Group> {
  const paths = await convertTextToPaths(text, options);
  glyphIdCounter++;
  const groupId = options.preserveId ? text.id : `group-text-${Date.now()}-${glyphIdCounter}`;
  const group: Group = {
    id: groupId,
    type: 'group',
    name: text.name ?? text.text ?? 'Texto en curvas',
    children: Object.freeze(paths),
    visible: text.visible !== false,
    locked: Boolean(text.locked),
    opacity: text.opacity,
  };
  return group;
}

/**
 * Clona un Documento y convierte todos sus nodos Text a figuras vectoriales (Group de Paths),
 * preservando inmutabilidad y la jerarquía completa de capas y grupos.
 */
export async function convertDocumentTextToCurves(
  doc: Document,
  options: TextToPathOptions = {}
): Promise<Document> {
  async function transformChild(child: LayerChildNode): Promise<LayerChildNode> {
    if (isText(child)) {
      return await convertTextToGroup(child, { ...options, preserveId: true });
    }
    if (isGroup(child)) {
      const transformedChildren: LayerChildNode[] = [];
      for (const nested of child.children) {
        transformedChildren.push(await transformChild(nested));
      }
      return {
        ...child,
        children: Object.freeze(transformedChildren),
      };
    }
    return child;
  }

  const sourceLayers: readonly Layer[] = doc.children ?? (doc as any).layers ?? [];
  const newLayers: Layer[] = [];
  for (const layer of sourceLayers) {
    const transformedChildren: LayerChildNode[] = [];
    for (const child of layer.children) {
      transformedChildren.push(await transformChild(child));
    }
    newLayers.push({
      ...layer,
      children: Object.freeze(transformedChildren),
    });
  }

  return {
    ...doc,
    children: Object.freeze(newLayers),
    ...((doc as any).layers ? { layers: Object.freeze(newLayers) } : {}),
  };
}
