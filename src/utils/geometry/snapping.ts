import type { AABB } from '../../types/scene-graph.ts';
import type { SnapGuide } from '../../types/engine.ts';

/**
 * Calcula el desplazamiento por magnetismo (snapping) a partir de un AABB en movimiento
 * comparado contra una lista de AABBs objetivo.
 */
export function calculateSnapping(
  movingAABB: AABB,
  targetAABBs: readonly AABB[],
  tolerance: number = 5
): { dx: number; dy: number; guides: SnapGuide[] } {
  const movingX = [movingAABB.minX, (movingAABB.minX + movingAABB.maxX) / 2, movingAABB.maxX];
  const movingY = [movingAABB.minY, (movingAABB.minY + movingAABB.maxY) / 2, movingAABB.maxY];
  let dx = 0;
  let dy = 0;
  let bestXDistance = tolerance + Number.EPSILON;
  let bestYDistance = tolerance + Number.EPSILON;
  let xGuidePosition: number | null = null;
  let xGuideTarget: AABB | null = null;
  let yGuidePosition: number | null = null;
  let yGuideTarget: AABB | null = null;

  for (const target of targetAABBs) {
    const targetX = [target.minX, (target.minX + target.maxX) / 2, target.maxX];
    const targetY = [target.minY, (target.minY + target.maxY) / 2, target.maxY];

    for (const movingPosition of movingX) {
      for (const targetPosition of targetX) {
        const correction = targetPosition - movingPosition;
        const distance = Math.abs(correction);
        if (distance <= tolerance && distance < bestXDistance) {
          bestXDistance = distance;
          dx = correction;
          xGuidePosition = targetPosition;
          xGuideTarget = target;
        }
      }
    }

    for (const movingPosition of movingY) {
      for (const targetPosition of targetY) {
        const correction = targetPosition - movingPosition;
        const distance = Math.abs(correction);
        if (distance <= tolerance && distance < bestYDistance) {
          bestYDistance = distance;
          dy = correction;
          yGuidePosition = targetPosition;
          yGuideTarget = target;
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (xGuidePosition !== null && xGuideTarget) {
    guides.push({
      axis: 'x',
      position: xGuidePosition,
      start: Math.min(movingAABB.minY + dy, xGuideTarget.minY),
      end: Math.max(movingAABB.maxY + dy, xGuideTarget.maxY),
    });
  }
  if (yGuidePosition !== null && yGuideTarget) {
    guides.push({
      axis: 'y',
      position: yGuidePosition,
      start: Math.min(movingAABB.minX + dx, yGuideTarget.minX),
      end: Math.max(movingAABB.maxX + dx, yGuideTarget.maxX),
    });
  }
  return { dx, dy, guides };
}

/**
 * Calcula snapping anclado para redimensionado interactivo donde ciertas características quedan fijas.
 */
export function calculateAnchoredSnapping(
  movingAABB: AABB,
  targetAABBs: readonly AABB[],
  fixedXFeature: 0 | 2 | 'all',
  fixedYFeature: 0 | 2 | 'all',
  tolerance: number = 5
): { dx: number; dy: number; guides: SnapGuide[] } {
  const findAxisSnap = (
    axis: 'x' | 'y',
    fixedFeature: 0 | 2 | 'all'
  ): { pointerDelta: number; featureDelta: number; movingFeature: number; position: number; target: AABB } | null => {
    if (fixedFeature === 'all') return null;

    const movingMin = axis === 'x' ? movingAABB.minX : movingAABB.minY;
    const movingMax = axis === 'x' ? movingAABB.maxX : movingAABB.maxY;
    const movingFeatures = [movingMin, (movingMin + movingMax) / 2, movingMax];
    let best: ReturnType<typeof findAxisSnap> = null;
    let bestDistance = tolerance + Number.EPSILON;

    for (const target of targetAABBs) {
      const targetMin = axis === 'x' ? target.minX : target.minY;
      const targetMax = axis === 'x' ? target.maxX : target.maxY;
      const targetFeatures = [targetMin, (targetMin + targetMax) / 2, targetMax];

      for (let movingIndex = 0; movingIndex < movingFeatures.length; movingIndex++) {
        if (movingIndex === fixedFeature) continue;
        for (const targetPosition of targetFeatures) {
          const featureDelta = targetPosition - movingFeatures[movingIndex];
          const distance = Math.abs(featureDelta);
          if (distance <= tolerance && distance < bestDistance) {
            bestDistance = distance;
            best = {
              pointerDelta: movingIndex === 1 ? featureDelta * 2 : featureDelta,
              featureDelta,
              movingFeature: movingIndex,
              position: targetPosition,
              target,
            };
          }
        }
      }
    }

    return best;
  };

  const xSnap = findAxisSnap('x', fixedXFeature);
  const ySnap = findAxisSnap('y', fixedYFeature);
  const correctedMinX = xSnap
    ? fixedXFeature === 0 ? movingAABB.minX : movingAABB.minX + xSnap.pointerDelta
    : movingAABB.minX;
  const correctedMaxX = xSnap
    ? fixedXFeature === 2 ? movingAABB.maxX : movingAABB.maxX + xSnap.pointerDelta
    : movingAABB.maxX;
  const correctedMinY = ySnap
    ? fixedYFeature === 0 ? movingAABB.minY : movingAABB.minY + ySnap.pointerDelta
    : movingAABB.minY;
  const correctedMaxY = ySnap
    ? fixedYFeature === 2 ? movingAABB.maxY : movingAABB.maxY + ySnap.pointerDelta
    : movingAABB.maxY;

  const guides: SnapGuide[] = [];
  if (xSnap) {
    guides.push({
      axis: 'x',
      position: xSnap.position,
      start: Math.min(correctedMinY, xSnap.target.minY),
      end: Math.max(correctedMaxY, xSnap.target.maxY),
    });
  }
  if (ySnap) {
    guides.push({
      axis: 'y',
      position: ySnap.position,
      start: Math.min(correctedMinX, ySnap.target.minX),
      end: Math.max(correctedMaxX, ySnap.target.maxX),
    });
  }

  return {
    dx: xSnap?.pointerDelta ?? 0,
    dy: ySnap?.pointerDelta ?? 0,
    guides,
  };
}
