import type { Artboard, Document } from '../../types/scene-graph.ts';

export function getArtboardsFromDocument(doc: Document): readonly Artboard[] {
  if (doc.artboards && doc.artboards.length > 0) {
    return doc.artboards;
  }

  return Object.freeze([
    Object.freeze({
      id: 'artboard-default',
      name: doc.name || 'Mesa 1',
      x: 0,
      y: 0,
      width: doc.width || 1920,
      height: doc.height || 1080,
      backgroundColor: '#ffffff',
    }),
  ]);
}

export function getActiveArtboardIdFromDocument(doc: Document): string {
  const list = getArtboardsFromDocument(doc);
  if (doc.activeArtboardId && list.some((a) => a.id === doc.activeArtboardId)) {
    return doc.activeArtboardId;
  }
  return list[0]?.id ?? 'artboard-default';
}

export function getActiveArtboardFromDocument(doc: Document): Artboard {
  const activeId = getActiveArtboardIdFromDocument(doc);
  const list = getArtboardsFromDocument(doc);
  return list.find((a) => a.id === activeId) ?? list[0];
}

export function addArtboardToDocument(doc: Document, artboard: Artboard): Document {
  if (!artboard || typeof artboard !== 'object') {
    throw new Error('[StateManager] addArtboard requiere un objeto Artboard válido.');
  }
  if (!artboard.id || typeof artboard.id !== 'string') {
    throw new Error('[StateManager] El Artboard debe tener un id de tipo string no vacío.');
  }
  if (!Number.isFinite(artboard.width) || artboard.width <= 0) {
    throw new Error(`[StateManager] Artboard width debe ser positivo: ${artboard.width}`);
  }
  if (!Number.isFinite(artboard.height) || artboard.height <= 0) {
    throw new Error(`[StateManager] Artboard height debe ser positivo: ${artboard.height}`);
  }

  const currentArtboards = getArtboardsFromDocument(doc);
  const nextArtboards = [...currentArtboards, Object.freeze({ ...artboard })];

  return {
    ...doc,
    artboards: nextArtboards,
    activeArtboardId: artboard.id,
  };
}

export function updateArtboardInDocument(
  doc: Document,
  id: string,
  updates: Partial<Omit<Artboard, 'id'>>
): Document {
  const currentArtboards = getArtboardsFromDocument(doc);
  const index = currentArtboards.findIndex((a) => a.id === id);
  if (index === -1) {
    return doc;
  }

  if (updates.width !== undefined && (!Number.isFinite(updates.width) || updates.width <= 0)) {
    throw new Error(`[StateManager] Artboard width debe ser positivo: ${updates.width}`);
  }
  if (updates.height !== undefined && (!Number.isFinite(updates.height) || updates.height <= 0)) {
    throw new Error(`[StateManager] Artboard height debe ser positivo: ${updates.height}`);
  }

  const updatedArtboard: Artboard = Object.freeze({
    ...currentArtboards[index],
    ...updates,
  });

  const nextArtboards = [
    ...currentArtboards.slice(0, index),
    updatedArtboard,
    ...currentArtboards.slice(index + 1),
  ];

  const isPrimary = index === 0;
  const docWidth = isPrimary && updates.width ? updates.width : doc.width;
  const docHeight = isPrimary && updates.height ? updates.height : doc.height;

  return {
    ...doc,
    width: docWidth,
    height: docHeight,
    artboards: nextArtboards,
  };
}

export function removeArtboardFromDocument(doc: Document, id: string): Document {
  const currentArtboards = getArtboardsFromDocument(doc);
  if (currentArtboards.length <= 1) {
    throw new Error('[StateManager] No se puede eliminar la única Mesa de Trabajo existente.');
  }

  const index = currentArtboards.findIndex((a) => a.id === id);
  if (index === -1) {
    return doc;
  }

  const nextArtboards = [
    ...currentArtboards.slice(0, index),
    ...currentArtboards.slice(index + 1),
  ];

  const nextActiveId =
    doc.activeArtboardId === id ? nextArtboards[0]?.id : doc.activeArtboardId;

  return {
    ...doc,
    artboards: nextArtboards,
    activeArtboardId: nextActiveId,
  };
}

export function getArtboardAtCoordinates(
  doc: Document,
  worldX: number,
  worldY: number
): Artboard | null {
  const artboards = getArtboardsFromDocument(doc);
  for (let i = artboards.length - 1; i >= 0; i--) {
    const ab = artboards[i];
    if (
      worldX >= ab.x &&
      worldX <= ab.x + ab.width &&
      worldY >= ab.y &&
      worldY <= ab.y + ab.height
    ) {
      return ab;
    }
  }
  return null;
}

export function setDocumentSizeInDocument(
  doc: Document,
  width: number,
  height: number
): Document {
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`[StateManager] El ancho del documento debe ser un número finito mayor a 0: ${width}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`[StateManager] El alto del documento debe ser un número finito mayor a 0: ${height}`);
  }

  if (doc.width === width && doc.height === height) {
    return doc;
  }

  const nextState: Document = {
    ...doc,
    width,
    height,
  };

  if (doc.artboards && doc.artboards.length > 0) {
    const first = doc.artboards[0];
    if (first.x === 0 && first.y === 0) {
      const updatedArtboards = [
        {
          ...first,
          width,
          height,
        },
        ...doc.artboards.slice(1),
      ];
      return {
        ...nextState,
        artboards: updatedArtboards,
      };
    }
  }

  return nextState;
}
