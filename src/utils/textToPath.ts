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
import { getWrappedTextLines, getTextLineHeight } from './geometry.ts';
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

/**
 * Obtiene las coordenadas para los ejes de variación ('wght', 'opsz') de una fuente OpenType variable,
 * acotando los valores a los límites permitidos por la tabla fvar.
 */
function getVariationCoords(
  font: opentype.Font,
  weight: number,
  fontSize?: number
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
  const opszAxis = font.tables.fvar.axes.find((a: any) => a.tag === 'opsz');
  if (opszAxis && typeof fontSize === 'number') {
    coords.opsz = Math.max(opszAxis.minValue, Math.min(opszAxis.maxValue, fontSize));
  }
  return Object.keys(coords).length > 0 ? coords : undefined;
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

  const cached = fontCache.get(cacheKey) || fontCache.get(normFamily);
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

    return opentype.parse(ttfBuffer);
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
  const lines = getWrappedTextLines(text);
  const lineHeight = getTextLineHeight(text);
  const paths: Path[] = [];

  const hasRotation = Boolean(text.rotation);
  const rotRad = hasRotation ? ((text.rotation ?? 0) * Math.PI) / 180 : 0;
  const cos = hasRotation ? Math.cos(rotRad) : 1;
  const sin = hasRotation ? Math.sin(rotRad) : 0;
  const rotCenter = { x: text.x, y: text.y };

  let charIndexOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    const lineStart = charIndexOffset;
    const lineEnd = lineStart + lineText.length;
    charIndexOffset += lineText.length + 1; // +1 por el separador o salto

    const lineY = text.y + lineIndex * lineHeight;

    // Desglosar la línea en tramos homogéneos de estilo (spans)
    const runs = splitTextIntoRuns(text, lineStart, lineEnd);

    // Calcular ancho total de la línea
    let totalLineWidth = 0;
    const runFonts: opentype.Font[] = [];
    const runWeights: number[] = [];

    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const targetWeight = parseFontWeight(run.style.fontWeight);
      runWeights.push(targetWeight);

      const font = await loadFont(
        run.style.fontFamily,
        targetWeight,
        run.style.fontStyle,
        fontResolver
      );
      runFonts.push(font);

      const fSize = run.style.fontSize;
      const lSpacing = run.style.letterSpacing;
      const unitsPerEm = font.unitsPerEm || 2048;
      const varCoords = getVariationCoords(font, targetWeight, fSize);
      const vFont = font as OpenTypeVariableFont;

      for (let c = 0; c < run.text.length; c++) {
        const ch = run.text[c];
        const glyph = font.charToGlyph(ch);
        const varGlyph = vFont.variation && varCoords ? vFont.variation.getTransform(glyph, varCoords) : glyph;
        const adv = varGlyph.advanceWidth
          ? (varGlyph.advanceWidth / unitsPerEm) * fSize
          : fSize * 0.6;
        totalLineWidth += adv + (c < run.text.length - 1 ? lSpacing : 0);
      }
    }

    // Calcular origen horizontal de la línea según alineación
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

    let cursorX = lineStartX;

    // Renderizar cada glifo en la línea
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const font = runFonts[r];
      const targetWeight = runWeights[r];
      const fSize = run.style.fontSize;
      const lSpacing = run.style.letterSpacing;
      const ascender = font.ascender || font.tables?.os2?.sTypoAscender || 1984;
      const unitsPerEm = font.unitsPerEm || 2048;
      const baselineY = lineY + (ascender / unitsPerEm) * fSize;
      const varCoords = getVariationCoords(font, targetWeight, fSize);
      const vFont = font as OpenTypeVariableFont;

      for (let c = 0; c < run.text.length; c++) {
        const ch = run.text[c];
        const glyph = font.charToGlyph(ch);
        const varGlyph = vFont.variation && varCoords ? vFont.variation.getTransform(glyph, varCoords) : glyph;
        const adv = varGlyph.advanceWidth
          ? (varGlyph.advanceWidth / unitsPerEm) * fSize
          : fSize * 0.6;

        // Omitir espacios en blanco y caracteres de control
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          cursorX += adv + lSpacing;
          continue;
        }

        const glyphPath = glyph.getPath(
          cursorX,
          baselineY,
          fSize,
          (varCoords ? { variation: varCoords } : undefined) as any,
          font
        );
        cursorX += adv + lSpacing;

        const svgD = glyphPath.toPathData(precision);
        if (!svgD || svgD.trim().length === 0) {
          continue;
        }

        const parsed = parseSvgPathD(svgD);
        if (parsed.points.length === 0) {
          continue;
        }

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
            ...(hIn ? { handleIn: { x: Math.round(hIn.x * 100) / 100, y: Math.round(hIn.y * 100) / 100 } } : {}),
            ...(hOut ? { handleOut: { x: Math.round(hOut.x * 100) / 100, y: Math.round(hOut.y * 100) / 100 } } : {}),
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
          fill: run.style.fill ?? text.fill ?? '#000000',
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
