import type {
  Document,
  Path,
  PathPoint,
  PathPointType,
} from '../../types/scene-graph.ts';
import {
  splitPathSegment,
  deletePathPointsFromPath,
  applyPointType,
} from '../../utils/geometry.ts';
import { getDocumentIndex } from './documentIndex.ts';
import { applyShapeUpdate } from './shapeTransformOperations.ts';

export function insertPathPointInDocument(
  doc: Document,
  pathId: string,
  segmentIndex: number,
  t: number
): { nextDoc: Document; result: { pointIndex: number; newPoint: PathPoint } | null } {
  const docIndex = getDocumentIndex(doc);
  const target = docIndex.nodeMap.get(pathId);
  if (!target || target.type !== 'path') {
    return { nextDoc: doc, result: null };
  }
  const path = target as Path;
  const nextPoints = splitPathSegment(path, segmentIndex, t);
  if (nextPoints === path.points) {
    return { nextDoc: doc, result: null };
  }
  const insertedIndex = segmentIndex < path.points.length - 1 ? segmentIndex + 1 : nextPoints.length - 1;
  const { nextDoc, changed } = applyShapeUpdate<Path>(doc, pathId, { points: nextPoints });
  if (!changed) {
    return { nextDoc: doc, result: null };
  }
  return {
    nextDoc,
    result: {
      pointIndex: insertedIndex,
      newPoint: nextPoints[insertedIndex],
    },
  };
}

export function deletePathPointsInDocument(
  doc: Document,
  pathId: string,
  indices: readonly number[]
): { nextDoc: Document; changed: boolean } {
  const docIndex = getDocumentIndex(doc);
  const target = docIndex.nodeMap.get(pathId);
  if (!target || target.type !== 'path') {
    return { nextDoc: doc, changed: false };
  }
  const path = target as Path;
  const nextPoints = deletePathPointsFromPath(path, indices);
  if (!nextPoints) {
    return { nextDoc: doc, changed: false };
  }
  return applyShapeUpdate<Path>(doc, pathId, { points: nextPoints });
}

export function setPathPointTypeInDocument(
  doc: Document,
  pathId: string,
  indices: readonly number[],
  pointType: PathPointType
): { nextDoc: Document; changed: boolean } {
  const docIndex = getDocumentIndex(doc);
  const target = docIndex.nodeMap.get(pathId);
  if (!target || target.type !== 'path') {
    return { nextDoc: doc, changed: false };
  }
  const path = target as Path;
  const indicesSet = new Set(indices);
  const n = path.points.length;
  const nextPoints = path.points.map((pt, i) => {
    if (!indicesSet.has(i)) {
      return pt;
    }
    const prev = path.closed ? path.points[(i - 1 + n) % n] : (i > 0 ? path.points[i - 1] : undefined);
    const next = path.closed ? path.points[(i + 1) % n] : (i < n - 1 ? path.points[i + 1] : undefined);
    return applyPointType(pt, pointType, prev, next);
  });
  return applyShapeUpdate<Path>(doc, pathId, { points: nextPoints });
}

export function setPathPointCornerRadiusInDocument(
  doc: Document,
  pathId: string,
  indices: readonly number[],
  cornerRadius?: number
): { nextDoc: Document; changed: boolean } {
  const docIndex = getDocumentIndex(doc);
  const target = docIndex.nodeMap.get(pathId);
  if (!target || target.type !== 'path') {
    return { nextDoc: doc, changed: false };
  }
  const path = target as Path;
  const indicesSet = new Set(indices);
  const radiusVal = cornerRadius !== undefined && cornerRadius > 0 ? cornerRadius : undefined;
  let anyChanged = false;
  const nextPoints = path.points.map((pt, i) => {
    if (!indicesSet.has(i)) {
      return pt;
    }
    if (pt.cornerRadius === radiusVal) {
      return pt;
    }
    anyChanged = true;
    const updated: PathPoint = { ...pt };
    if (radiusVal !== undefined) {
      return { ...updated, cornerRadius: radiusVal };
    } else {
      const { cornerRadius: _, ...withoutCR } = updated;
      return withoutCR as PathPoint;
    }
  });
  if (!anyChanged) {
    return { nextDoc: doc, changed: false };
  }
  return applyShapeUpdate<Path>(doc, pathId, { points: nextPoints });
}
