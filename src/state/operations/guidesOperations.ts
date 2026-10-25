import type { Document, Guide } from '../../types/scene-graph.ts';
import { removeAt } from '../../utils/immutable.ts';

export function addGuideToDocument(doc: Document, guide: Guide): Document {
  const currentGuides = doc.guides ?? [];
  if (currentGuides.some((g) => g.id === guide.id)) {
    return doc;
  }
  const frozenGuide = Object.freeze({ ...guide });
  const nextGuides = Object.freeze([...currentGuides, frozenGuide]);
  return {
    ...doc,
    guides: nextGuides,
  };
}

export function removeGuideFromDocument(
  doc: Document,
  guideId: string
): { nextDoc: Document; removedGuide?: Guide } {
  const currentGuides = doc.guides ?? [];
  const index = currentGuides.findIndex((g) => g.id === guideId);
  if (index === -1) return { nextDoc: doc, removedGuide: undefined };
  const removed = currentGuides[index];
  const nextGuides = Object.freeze(removeAt(currentGuides, index));
  return {
    nextDoc: {
      ...doc,
      guides: nextGuides,
    },
    removedGuide: removed,
  };
}

export function updateGuideInDocument(
  doc: Document,
  guideId: string,
  position: number
): { nextDoc: Document; oldPosition?: number } {
  const currentGuides = doc.guides ?? [];
  const index = currentGuides.findIndex((g) => g.id === guideId);
  if (index === -1) return { nextDoc: doc, oldPosition: undefined };
  const oldGuide = currentGuides[index];
  if (oldGuide.position === position) {
    return { nextDoc: doc, oldPosition: oldGuide.position };
  }
  const updatedGuide = Object.freeze({ ...oldGuide, position });
  const nextGuides = Object.freeze([
    ...currentGuides.slice(0, index),
    updatedGuide,
    ...currentGuides.slice(index + 1),
  ]);
  return {
    nextDoc: {
      ...doc,
      guides: nextGuides,
    },
    oldPosition: oldGuide.position,
  };
}

export function clearGuidesFromDocument(
  doc: Document
): { nextDoc: Document; clearedGuides: readonly Guide[] } {
  const currentGuides = doc.guides ?? [];
  if (currentGuides.length === 0) {
    return { nextDoc: doc, clearedGuides: currentGuides };
  }
  return {
    nextDoc: {
      ...doc,
      guides: Object.freeze([]),
    },
    clearedGuides: currentGuides,
  };
}

export function setGuidesInDocument(doc: Document, guides: readonly Guide[]): Document {
  const frozenGuides = Object.freeze(guides.map((g) => Object.freeze({ ...g })));
  return {
    ...doc,
    guides: frozenGuides,
  };
}
