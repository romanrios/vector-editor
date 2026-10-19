import type {
  Document,
  Group,
  Layer,
  LayerChildNode,
  Path,
  PathPoint,
  Rectangle,
  Ellipse,
  Text,
  FillType,
  Gradient,
  GradientStop,
} from '../types/scene-graph.ts';

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

function parseGradientStop(stop: unknown, stopPath: string): GradientStop {
  if (!isObject(stop)) {
    throw new DocumentParseError(`${stopPath} debe ser un objeto`);
  }
  if (typeof stop.id !== 'string' || stop.id.trim() === '') {
    throw new DocumentParseError(`${stopPath}.id debe ser un string no vacío`);
  }
  if (!isFiniteNumber(stop.offset) || stop.offset < 0 || stop.offset > 1) {
    throw new DocumentParseError(`${stopPath}.offset debe ser un número finito entre 0 y 1`);
  }
  if (typeof stop.color !== 'string') {
    throw new DocumentParseError(`${stopPath}.color debe ser un string`);
  }
  if (stop.opacity !== undefined && (!isFiniteNumber(stop.opacity) || stop.opacity < 0 || stop.opacity > 1)) {
    throw new DocumentParseError(`${stopPath}.opacity debe ser un número finito entre 0 y 1`);
  }
  return {
    id: stop.id,
    offset: stop.offset,
    color: stop.color,
    ...(stop.opacity !== undefined ? { opacity: stop.opacity } : {}),
  };
}

function parseGradient(grad: unknown, gradPath: string): Gradient {
  if (!isObject(grad)) {
    throw new DocumentParseError(`${gradPath} debe ser un objeto`);
  }
  if (grad.type !== 'linear' && grad.type !== 'radial') {
    throw new DocumentParseError(`${gradPath}.type debe ser 'linear' o 'radial'`);
  }
  if (!Array.isArray(grad.stops) || grad.stops.length === 0) {
    throw new DocumentParseError(`${gradPath}.stops debe ser un array no vacío de paradas de degradado`);
  }

  const cleanStops = grad.stops.map((s, idx) => parseGradientStop(s, `${gradPath}.stops[${idx}]`));

  if (grad.type === 'linear') {
    if (!isFiniteNumber(grad.x1)) throw new DocumentParseError(`${gradPath}.x1 debe ser un número finito`);
    if (!isFiniteNumber(grad.y1)) throw new DocumentParseError(`${gradPath}.y1 debe ser un número finito`);
    if (!isFiniteNumber(grad.x2)) throw new DocumentParseError(`${gradPath}.x2 debe ser un número finito`);
    if (!isFiniteNumber(grad.y2)) throw new DocumentParseError(`${gradPath}.y2 debe ser un número finito`);

    return {
      type: 'linear',
      x1: grad.x1,
      y1: grad.y1,
      x2: grad.x2,
      y2: grad.y2,
      stops: cleanStops,
    };
  } else {
    if (!isFiniteNumber(grad.cx)) throw new DocumentParseError(`${gradPath}.cx debe ser un número finito`);
    if (!isFiniteNumber(grad.cy)) throw new DocumentParseError(`${gradPath}.cy debe ser un número finito`);
    if (!isFiniteNumber(grad.r) || grad.r <= 0) throw new DocumentParseError(`${gradPath}.r debe ser un número finito positivo`);

    return {
      type: 'radial',
      cx: grad.cx,
      cy: grad.cy,
      r: grad.r,
      ...(grad.fx !== undefined && isFiniteNumber(grad.fx) ? { fx: grad.fx } : {}),
      ...(grad.fy !== undefined && isFiniteNumber(grad.fy) ? { fy: grad.fy } : {}),
      stops: cleanStops,
    };
  }
}

function parseFillType(val: unknown, fillPath: string): FillType {
  if (typeof val === 'string') {
    return val;
  }
  if (isObject(val)) {
    return parseGradient(val, fillPath);
  }
  throw new DocumentParseError(`${fillPath} debe ser un string o un objeto Gradient`);
}

function parseLayerChild(
  child: unknown,
  childPath: string,
  seenIds: Set<string>,
  depth: number
): LayerChildNode {
  if (depth > 32) {
    throw new DocumentParseError(
      `Profundidad máxima de anidamiento (32) excedida en ${childPath}`
    );
  }

  if (!isObject(child)) {
    throw new DocumentParseError(`${childPath} debe ser un objeto`);
  }

  if (typeof child.id !== 'string' || child.id.trim() === '') {
    throw new DocumentParseError(`${childPath}.id debe ser un string`);
  }

  if (seenIds.has(child.id)) {
    throw new DocumentParseError(
      `ID duplicado '${child.id}' en ${childPath}. Los ids deben ser únicos en todo el documento.`
    );
  }
  seenIds.add(child.id);

  if (typeof child.name !== 'string') {
    throw new DocumentParseError(`${childPath}.name debe ser un string`);
  }

  if (child.type === 'group') {
    if (!Array.isArray(child.children)) {
      throw new DocumentParseError(`${childPath}.children debe ser un array`);
    }

    if (child.children.length === 0) {
      throw new DocumentParseError(
        `${childPath}.children no puede estar vacío (los grupos deben contener al menos un elemento)`
      );
    }

    if (child.visible !== undefined && typeof child.visible !== 'boolean') {
      throw new DocumentParseError(`${childPath}.visible debe ser un booleano`);
    }

    if (child.locked !== undefined && typeof child.locked !== 'boolean') {
      throw new DocumentParseError(`${childPath}.locked debe ser un booleano`);
    }

    if (child.opacity !== undefined && !isFiniteNumber(child.opacity)) {
      throw new DocumentParseError(`${childPath}.opacity debe ser un número finito`);
    }

    if (child.zIndex !== undefined && !isFiniteNumber(child.zIndex)) {
      throw new DocumentParseError(`${childPath}.zIndex debe ser un número finito`);
    }

    const cleanGroupChildren: LayerChildNode[] = [];
    for (let c = 0; c < child.children.length; c++) {
      const grandChild = child.children[c];
      const grandChildPath = `${childPath}.children[${c}]`;
      cleanGroupChildren.push(
        parseLayerChild(grandChild, grandChildPath, seenIds, depth + 1)
      );
    }

    const { selected: _sel, isDirty: _dirty, children: _ch, ...restGroup } = child;
    return {
      ...(restGroup as unknown as Group),
      children: cleanGroupChildren,
    };
  }

  if (
    child.type !== 'rectangle' &&
    child.type !== 'ellipse' &&
    child.type !== 'path' &&
    child.type !== 'text'
  ) {
    throw new DocumentParseError(
      `${childPath}.type debe ser 'rectangle', 'ellipse', 'path' o 'text' (o 'group')`
    );
  }

  // Validar campos comunes opcionales de figuras
  if (child.rotation !== undefined && !isFiniteNumber(child.rotation)) {
    throw new DocumentParseError(`${childPath}.rotation debe ser un número finito`);
  }
  if (child.opacity !== undefined && !isFiniteNumber(child.opacity)) {
    throw new DocumentParseError(`${childPath}.opacity debe ser un número finito`);
  }
  if (child.strokeWidth !== undefined && !isFiniteNumber(child.strokeWidth)) {
    throw new DocumentParseError(`${childPath}.strokeWidth debe ser un número finito`);
  }
  if (child.fill !== undefined) {
    (child as { fill?: FillType }).fill = parseFillType(child.fill, `${childPath}.fill`);
  }
  if (child.stroke !== undefined) {
    (child as { stroke?: FillType }).stroke = parseFillType(child.stroke, `${childPath}.stroke`);
  }
  if (child.visible !== undefined && typeof child.visible !== 'boolean') {
    throw new DocumentParseError(`${childPath}.visible debe ser un booleano`);
  }
  if (child.locked !== undefined && typeof child.locked !== 'boolean') {
    throw new DocumentParseError(`${childPath}.locked debe ser un booleano`);
  }
  if (child.zIndex !== undefined && !isFiniteNumber(child.zIndex)) {
    throw new DocumentParseError(`${childPath}.zIndex debe ser un número finito`);
  }

  if (child.type === 'rectangle') {
    if (!isFiniteNumber(child.x)) {
      throw new DocumentParseError(`${childPath}.x debe ser un número finito`);
    }
    if (!isFiniteNumber(child.y)) {
      throw new DocumentParseError(`${childPath}.y debe ser un número finito`);
    }
    if (!isFiniteNumber(child.width)) {
      throw new DocumentParseError(`${childPath}.width debe ser un número finito`);
    }
    if (!isFiniteNumber(child.height)) {
      throw new DocumentParseError(`${childPath}.height debe ser un número finito`);
    }
    if (child.cornerRadius !== undefined && !isFiniteNumber(child.cornerRadius)) {
      throw new DocumentParseError(`${childPath}.cornerRadius debe ser un número finito`);
    }

    const { selected: _sel, isDirty: _dirty, ...rest } = child;
    return rest as unknown as Rectangle;
  } else if (child.type === 'ellipse') {
    if (!isFiniteNumber(child.x)) {
      throw new DocumentParseError(`${childPath}.x debe ser un número finito`);
    }
    if (!isFiniteNumber(child.y)) {
      throw new DocumentParseError(`${childPath}.y debe ser un número finito`);
    }
    if (!isFiniteNumber(child.radiusX)) {
      throw new DocumentParseError(`${childPath}.radiusX debe ser un número finito`);
    }
    if (!isFiniteNumber(child.radiusY)) {
      throw new DocumentParseError(`${childPath}.radiusY debe ser un número finito`);
    }

    const { selected: _sel, isDirty: _dirty, ...rest } = child;
    return rest as unknown as Ellipse;
  } else if (child.type === 'text') {
    if (!isFiniteNumber(child.x)) {
      throw new DocumentParseError(`${childPath}.x debe ser un número finito`);
    }
    if (!isFiniteNumber(child.y)) {
      throw new DocumentParseError(`${childPath}.y debe ser un número finito`);
    }
    if (typeof child.text !== 'string') {
      throw new DocumentParseError(`${childPath}.text debe ser un string`);
    }
    if (child.fontFamily !== undefined && typeof child.fontFamily !== 'string') {
      throw new DocumentParseError(`${childPath}.fontFamily debe ser un string`);
    }
    if (child.fontSize !== undefined && (!isFiniteNumber(child.fontSize) || child.fontSize <= 0)) {
      throw new DocumentParseError(`${childPath}.fontSize debe ser un número finito positivo`);
    }
    if (
      child.fontWeight !== undefined &&
      typeof child.fontWeight !== 'string' &&
      !isFiniteNumber(child.fontWeight)
    ) {
      throw new DocumentParseError(`${childPath}.fontWeight debe ser un string o un número finito`);
    }
    if (child.fontStyle !== undefined && typeof child.fontStyle !== 'string') {
      throw new DocumentParseError(`${childPath}.fontStyle debe ser un string`);
    }
    if (
      child.textAlign !== undefined &&
      child.textAlign !== 'left' &&
      child.textAlign !== 'center' &&
      child.textAlign !== 'right'
    ) {
      throw new DocumentParseError(`${childPath}.textAlign debe ser 'left', 'center' o 'right'`);
    }
    if (child.lineHeight !== undefined && (!isFiniteNumber(child.lineHeight) || child.lineHeight <= 0)) {
      throw new DocumentParseError(`${childPath}.lineHeight debe ser un número finito positivo`);
    }
    if (child.letterSpacing !== undefined && !isFiniteNumber(child.letterSpacing)) {
      throw new DocumentParseError(`${childPath}.letterSpacing debe ser un número finito`);
    }
    if (child.boxWidth !== undefined && (!isFiniteNumber(child.boxWidth) || child.boxWidth <= 0)) {
      throw new DocumentParseError(`${childPath}.boxWidth debe ser un número finito positivo`);
    }

    const { selected: _sel, isDirty: _dirty, ...rest } = child;
    return rest as unknown as Text;
  } else {
    // path
    if (!isFiniteNumber(child.x)) {
      throw new DocumentParseError(`${childPath}.x debe ser un número finito`);
    }
    if (!isFiniteNumber(child.y)) {
      throw new DocumentParseError(`${childPath}.y debe ser un número finito`);
    }
    if (!Array.isArray(child.points)) {
      throw new DocumentParseError(`${childPath}.points debe ser un array`);
    }

    const cleanPoints: PathPoint[] = [];

    for (let k = 0; k < child.points.length; k++) {
      const pt = child.points[k];
      const ptPath = `${childPath}.points[${k}]`;

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

    if (child.closed !== undefined && typeof child.closed !== 'boolean') {
      throw new DocumentParseError(`${childPath}.closed debe ser un booleano`);
    }

    const { selected: _sel, isDirty: _dirty, points: _pts, ...rest } = child;
    return {
      ...(rest as unknown as Path),
      points: cleanPoints,
    };
  }
}

/**
 * Parsea y valida exhaustivamente un string JSON para reconstruir un objeto Document tipado.
 * Valida la estructura completa (Document > Layer > Group* > Shape), verifica unicidad de IDs y
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

    const cleanChildren: LayerChildNode[] = [];

    for (let j = 0; j < layer.children.length; j++) {
      const child = layer.children[j];
      const childPath = `children[${i}].children[${j}]`;
      cleanChildren.push(parseLayerChild(child, childPath, seenIds, 2));
    }

    const { selected: _sel, isDirty: _dirty, children: _ch, ...restLayer } = layer;
    cleanLayers.push({
      ...(restLayer as unknown as Layer),
      children: cleanChildren,
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
