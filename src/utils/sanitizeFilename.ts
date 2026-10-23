/**
 * Sanitiza un nombre de archivo para exportación o guardado local.
 * Elimina caracteres no permitidos en sistemas de archivos (/ \ : * ? " < > |),
 * caracteres de control y recorta extensiones comunes duplicadas al final.
 *
 * @param name Nombre propuesto por el usuario o extraído del documento
 * @param fallback Nombre por defecto a retornar si el resultado queda vacío
 * @returns Nombre de archivo limpio sin extensión
 */
export function sanitizeFilename(name?: string | null, fallback: string = ''): string {
  if (!name || typeof name !== 'string') {
    return fallback;
  }

  const cleaned = name
    .trim()
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\.(json|svg|png|webp|jpe?g)$/i, '')
    .trim();

  return cleaned || fallback;
}
