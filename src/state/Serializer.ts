import type { Document, Layer, Path, PathPoint, Rectangle, Ellipse, Shape } from '../types/scene-graph.ts';

/**
 * Serializa el estado completo del Scene Graph (Document) en un string JSON puro.
 * Omite propiedades computadas o transitorias de UI como 'isDirty' y 'selected'
 * para garantizar que la carga y almacenamiento consistan únicamente en el modelo de datos puro.
 *
 * @param state Estado inmutable del Document a serializar
 * @param pretty Si es true, indenta el JSON con 2 espacios para mayor legibilidad
 * @returns Cadena de texto en formato JSON
 */
export function serializeDocument(state: Document, pretty: boolean = true): string {
  return JSON.stringify(
    state,
    (key, value) => {
      // Omitir propiedades de renderizado o selección transitoria de UI
      if (key === 'isDirty' || key === 'selected') {
        return undefined;
      }
      return value;
    },
    pretty ? 2 : undefined
  );
}

/**
 * Crea un Blob a partir de un string de contenido y fuerza su descarga local en el navegador
 * mediante la creación y disparo programático de un elemento <a> temporal y oculto.
 *
 * @param filename Nombre del archivo para la descarga (ej: 'vector-scene.json')
 * @param content Contenido de texto a guardar (típicamente JSON serializado)
 */
export function downloadJson(filename: string, content: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const normalizedFilename = filename.toLowerCase().endsWith('.json')
    ? filename
    : `${filename}.json`;

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = normalizedFilename;
  anchor.style.display = 'none';
  anchor.setAttribute('aria-hidden', 'true');

  document.body.appendChild(anchor);
  anchor.click();

  // Limpieza inmediata del DOM y liberación de memoria del ObjectURL
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

/**
 * Error tipado que se lanza cuando la deserialización o validación estructural
 * de un Document en formato JSON falla.
 */
export class DocumentParseError extends Error {
  public override readonly name: string = 'DocumentParseError';

  constructor(message: string) {
    super(`[DocumentParseError] ${message}`);
  }
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

/**
 * Parsea y valida exhaustivamente un string JSON para reconstruir un objeto Document tipado.
 * Valida la estructura completa (Document > Layer > Shape), verifica unicidad de IDs y
 * elimina cualquier propiedad transitoria de UI ('selected' e 'isDirty').
 * Si algo es inválido, lanza DocumentParseError con la ruta exacta del problema.
 *
 * @param jsonString Cadena de texto en formato JSON a parsear
 * @returns Promesa que resuelve en el objeto Document validado y limpio
 * @throws {DocumentParseError} Si el JSON es inválido o no cumple con el esquema estructural
 */
export async function parseDocument(jsonString: string): Promise<Document> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentParseError(`Sintaxis JSON inválida: ${message}`);
  }

  if (!isObject(parsed)) {
    throw new DocumentParseError(
      'El contenido JSON debe ser un objeto raíz que represente un Document.'
    );
  }

  const candidate = parsed;

  if (candidate.type !== 'document') {
    throw new DocumentParseError(
      `El tipo de nodo raíz debe ser 'document', pero se recibió '${String(candidate.type)}'.`
    );
  }

  if (!Array.isArray(candidate.children)) {
    throw new DocumentParseError(
      "La propiedad 'children' del Document debe ser un array que contenga las capas (Layer[])."
    );
  }

  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
    throw new DocumentParseError('id debe ser un string');
  }

  if (typeof candidate.name !== 'string') {
    throw new DocumentParseError('name debe ser un string');
  }

  if (!isFiniteNumber(candidate.width) || candidate.width <= 0) {
    throw new DocumentParseError('width debe ser un número finito > 0');
  }

  if (!isFiniteNumber(candidate.height) || candidate.height <= 0) {
    throw new DocumentParseError('height debe ser un número finito > 0');
  }

  const seenIds = new Set<string>();
  seenIds.add(candidate.id);

  const cleanLayers: Layer[] = [];

  for (let i = 0; i < candidate.children.length; i++) {
    const layer = candidate.children[i];
    const layerPath = `children[${i}]`;

    if (!isObject(layer)) {
      throw new DocumentParseError(`${layerPath} debe ser un objeto`);
    }

    if (layer.type !== 'layer') {
      throw new DocumentParseError(`${layerPath}.type debe ser 'layer'`);
    }

    if (typeof layer.id !== 'string' || layer.id.trim() === '') {
      throw new DocumentParseError(`${layerPath}.id debe ser un string`);
    }

    if (seenIds.has(layer.id)) {
      throw new DocumentParseError(
        `ID duplicado '${layer.id}' en ${layerPath}. Los ids deben ser únicos en todo el documento.`
      );
    }
    seenIds.add(layer.id);

    if (typeof layer.name !== 'string') {
      throw new DocumentParseError(`${layerPath}.name debe ser un string`);
    }

    if (!Array.isArray(layer.children)) {
      throw new DocumentParseError(`${layerPath}.children debe ser un array`);
    }

    if (layer.visible !== undefined && typeof layer.visible !== 'boolean') {
      throw new DocumentParseError(`${layerPath}.visible debe ser un booleano`);
    }

    if (layer.locked !== undefined && typeof layer.locked !== 'boolean') {
      throw new DocumentParseError(`${layerPath}.locked debe ser un booleano`);
    }

    if (layer.opacity !== undefined && !isFiniteNumber(layer.opacity)) {
      throw new DocumentParseError(`${layerPath}.opacity debe ser un número finito`);
    }

    const cleanShapes: Shape[] = [];

    for (let j = 0; j < layer.children.length; j++) {
      const shape = layer.children[j];
      const shapePath = `children[${i}].children[${j}]`;

      if (!isObject(shape)) {
        throw new DocumentParseError(`${shapePath} debe ser un objeto`);
      }

      if (typeof shape.id !== 'string' || shape.id.trim() === '') {
        throw new DocumentParseError(`${shapePath}.id debe ser un string`);
      }

      if (seenIds.has(shape.id)) {
        throw new DocumentParseError(
          `ID duplicado '${shape.id}' en ${shapePath}. Los ids deben ser únicos en todo el documento.`
        );
      }
      seenIds.add(shape.id);

      if (typeof shape.name !== 'string') {
        throw new DocumentParseError(`${shapePath}.name debe ser un string`);
      }

      if (shape.type !== 'rectangle' && shape.type !== 'ellipse' && shape.type !== 'path') {
        throw new DocumentParseError(
          `${shapePath}.type debe ser 'rectangle', 'ellipse' o 'path'`
        );
      }

      // Validar campos comunes opcionales
      if (shape.rotation !== undefined && !isFiniteNumber(shape.rotation)) {
        throw new DocumentParseError(`${shapePath}.rotation debe ser un número finito`);
      }
      if (shape.opacity !== undefined && !isFiniteNumber(shape.opacity)) {
        throw new DocumentParseError(`${shapePath}.opacity debe ser un número finito`);
      }
      if (shape.strokeWidth !== undefined && !isFiniteNumber(shape.strokeWidth)) {
        throw new DocumentParseError(`${shapePath}.strokeWidth debe ser un número finito`);
      }
      if (shape.fill !== undefined && typeof shape.fill !== 'string') {
        throw new DocumentParseError(`${shapePath}.fill debe ser un string`);
      }
      if (shape.stroke !== undefined && typeof shape.stroke !== 'string') {
        throw new DocumentParseError(`${shapePath}.stroke debe ser un string`);
      }
      if (shape.visible !== undefined && typeof shape.visible !== 'boolean') {
        throw new DocumentParseError(`${shapePath}.visible debe ser un booleano`);
      }
      if (shape.locked !== undefined && typeof shape.locked !== 'boolean') {
        throw new DocumentParseError(`${shapePath}.locked debe ser un booleano`);
      }
      if (shape.zIndex !== undefined && !isFiniteNumber(shape.zIndex)) {
        throw new DocumentParseError(`${shapePath}.zIndex debe ser un número finito`);
      }

      if (shape.type === 'rectangle') {
        if (!isFiniteNumber(shape.x)) {
          throw new DocumentParseError(`${shapePath}.x debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.y)) {
          throw new DocumentParseError(`${shapePath}.y debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.width)) {
          throw new DocumentParseError(`${shapePath}.width debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.height)) {
          throw new DocumentParseError(`${shapePath}.height debe ser un número finito`);
        }
        if (shape.cornerRadius !== undefined && !isFiniteNumber(shape.cornerRadius)) {
          throw new DocumentParseError(`${shapePath}.cornerRadius debe ser un número finito`);
        }

        const { selected: _sel, isDirty: _dirty, ...rest } = shape;
        cleanShapes.push(rest as unknown as Rectangle);
      } else if (shape.type === 'ellipse') {
        if (!isFiniteNumber(shape.x)) {
          throw new DocumentParseError(`${shapePath}.x debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.y)) {
          throw new DocumentParseError(`${shapePath}.y debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.radiusX)) {
          throw new DocumentParseError(`${shapePath}.radiusX debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.radiusY)) {
          throw new DocumentParseError(`${shapePath}.radiusY debe ser un número finito`);
        }

        const { selected: _sel, isDirty: _dirty, ...rest } = shape;
        cleanShapes.push(rest as unknown as Ellipse);
      } else if (shape.type === 'path') {
        if (!isFiniteNumber(shape.x)) {
          throw new DocumentParseError(`${shapePath}.x debe ser un número finito`);
        }
        if (!isFiniteNumber(shape.y)) {
          throw new DocumentParseError(`${shapePath}.y debe ser un número finito`);
        }
        if (!Array.isArray(shape.points)) {
          throw new DocumentParseError(`${shapePath}.points debe ser un array`);
        }

        const cleanPoints: PathPoint[] = [];

        for (let k = 0; k < shape.points.length; k++) {
          const pt = shape.points[k];
          const ptPath = `${shapePath}.points[${k}]`;

          if (!isObject(pt)) {
            throw new DocumentParseError(`${ptPath} debe ser un objeto`);
          }
          if (!isFiniteNumber(pt.x)) {
            throw new DocumentParseError(`${ptPath}.x debe ser un número finito`);
          }
          if (!isFiniteNumber(pt.y)) {
            throw new DocumentParseError(`${ptPath}.y debe ser un número finito`);
          }

          let cleanHandleIn: { x: number; y: number } | undefined;
          if (pt.handleIn !== undefined) {
            if (!isObject(pt.handleIn)) {
              throw new DocumentParseError(`${ptPath}.handleIn debe ser un objeto`);
            }
            if (!isFiniteNumber(pt.handleIn.x)) {
              throw new DocumentParseError(`${ptPath}.handleIn.x debe ser un número finito`);
            }
            if (!isFiniteNumber(pt.handleIn.y)) {
              throw new DocumentParseError(`${ptPath}.handleIn.y debe ser un número finito`);
            }
            cleanHandleIn = { x: pt.handleIn.x, y: pt.handleIn.y };
          }

          let cleanHandleOut: { x: number; y: number } | undefined;
          if (pt.handleOut !== undefined) {
            if (!isObject(pt.handleOut)) {
              throw new DocumentParseError(`${ptPath}.handleOut debe ser un objeto`);
            }
            if (!isFiniteNumber(pt.handleOut.x)) {
              throw new DocumentParseError(`${ptPath}.handleOut.x debe ser un número finito`);
            }
            if (!isFiniteNumber(pt.handleOut.y)) {
              throw new DocumentParseError(`${ptPath}.handleOut.y debe ser un número finito`);
            }
            cleanHandleOut = { x: pt.handleOut.x, y: pt.handleOut.y };
          }

          cleanPoints.push({
            x: pt.x,
            y: pt.y,
            ...(cleanHandleIn ? { handleIn: cleanHandleIn } : {}),
            ...(cleanHandleOut ? { handleOut: cleanHandleOut } : {}),
          });
        }

        if (shape.closed !== undefined && typeof shape.closed !== 'boolean') {
          throw new DocumentParseError(`${shapePath}.closed debe ser un booleano`);
        }

        const { selected: _sel, isDirty: _dirty, points: _pts, ...rest } = shape;
        cleanShapes.push({
          ...(rest as unknown as Path),
          points: cleanPoints,
        });
      }
    }

    const { selected: _sel, isDirty: _dirty, children: _ch, ...restLayer } = layer;
    cleanLayers.push({
      ...(restLayer as unknown as Layer),
      children: cleanShapes,
    });
  }

  const { selected: _sel, isDirty: _dirty, children: _ch, ...restDoc } = candidate;
  return {
    ...(restDoc as unknown as Document),
    children: cleanLayers,
  };
}

/**
 * Namespace Serializer que agrupa las utilidades de serialización, deserialización y descarga.
 */
export const Serializer = {
  serializeDocument,
  downloadJson,
  parseDocument,
  DocumentParseError,
};
