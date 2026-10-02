import type { Document } from '../types/scene-graph.ts';

/**
 * Serializa el estado completo del Scene Graph (Document) en un string JSON puro.
 * Omite propiedades computadas temporales como 'isDirty' para garantizar
 * que la carga y almacenamiento consistan únicamente en el modelo de datos puro.
 *
 * @param state Estado inmutable del Document a serializar
 * @param pretty Si es true, indenta el JSON con 2 espacios para mayor legibilidad
 * @returns Cadena de texto en formato JSON
 */
export function serializeDocument(state: Document, pretty: boolean = true): string {
  return JSON.stringify(
    state,
    (key, value) => {
      // Omitir propiedades computadas temporales de renderizado
      if (key === 'isDirty') {
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

/**
 * Parsea y valida asíncronamente un string JSON para reconstruir un objeto Document tipado.
 * Valida la estructura básica asegurando que sea un objeto con type: 'document' y la propiedad children como array.
 * Si la sintaxis JSON es inválida o la estructura no cumple con el esquema básico, lanza un error tipado DocumentParseError.
 *
 * @param jsonString Cadena de texto en formato JSON a parsear
 * @returns Promesa que resuelve en el objeto Document validado y tipado
 * @throws {DocumentParseError} Si el JSON es inválido o no cumple con el esquema de Document
 */
export async function parseDocument(jsonString: string): Promise<Document> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentParseError(`Sintaxis JSON inválida: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DocumentParseError(
      'El contenido JSON debe ser un objeto raíz que represente un Document.'
    );
  }

  const candidate = parsed as Record<string, unknown>;

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

  return parsed as Document;
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

