import type { StateManager } from '../../../state/StateManager.ts';
import type { SnapGuide } from '../../../types/engine.ts';
import {
  isGroup,
  isShape,
  type AABB,
  type LayerChildNode,
} from '../../../types/scene-graph.ts';
import {
  calculateAnchoredSnapping,
  calculateSnapping,
  getShapeAABB,
} from '../../../utils/geometry.ts';

export function calculateAABBSnap(
  stateManager: StateManager,
  viewportZoom: number,
  isSmartGuidesEnabled: boolean,
  movingAABB: AABB,
  excludedShapeIds: ReadonlySet<string> = new Set(),
  fixedXFeature?: 0 | 2 | 'all',
  fixedYFeature?: 0 | 2 | 'all'
): { dx: number; dy: number; guides: SnapGuide[] } {
  if (!isSmartGuidesEnabled) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const targetAABBs: AABB[] = [];
  const document = stateManager.getState();
  if (document.width > 0 && document.height > 0) {
    targetAABBs.push({
      minX: 0,
      minY: 0,
      maxX: document.width,
      maxY: document.height,
      width: document.width,
      height: document.height,
    });
  }

  const artboards = stateManager.getArtboards();
  for (const ab of artboards) {
    targetAABBs.push({
      minX: ab.x,
      minY: ab.y,
      maxX: ab.x + ab.width,
      maxY: ab.y + ab.height,
      width: ab.width,
      height: ab.height,
    });
  }

  const visit = (nodes: readonly LayerChildNode[]): void => {
    for (const node of nodes) {
      if (!stateManager.isEffectivelyVisible(node.id)) continue;
      if (isGroup(node)) {
        visit(node.children);
      } else if (isShape(node) && !excludedShapeIds.has(node.id)) {
        targetAABBs.push(getShapeAABB(node));
      }
    }
  };

  for (const layer of document.children) {
    if (stateManager.isEffectivelyVisible(layer.id)) {
      visit(layer.children);
    }
  }

  if (stateManager.isGuidesVisible() && stateManager.isGuideSnappingEnabled()) {
    const userGuides = stateManager.getGuides();
    for (const g of userGuides) {
      if (g.axis === 'x') {
        targetAABBs.push({
          minX: g.position,
          maxX: g.position,
          minY: -100000,
          maxY: 100000,
          width: 0,
          height: 200000,
        });
      } else {
        targetAABBs.push({
          minX: -100000,
          maxX: 100000,
          minY: g.position,
          maxY: g.position,
          width: 200000,
          height: 0,
        });
      }
    }
  }

  const tolerance = 5 / viewportZoom;
  if (fixedXFeature !== undefined && fixedYFeature !== undefined) {
    return calculateAnchoredSnapping(
      movingAABB,
      targetAABBs,
      fixedXFeature,
      fixedYFeature,
      tolerance
    );
  }
  return calculateSnapping(movingAABB, targetAABBs, tolerance);
}

export function calculateDragSnap(
  stateManager: StateManager,
  viewportZoom: number,
  isSmartGuidesEnabled: boolean,
  initialShapesBounds: ReadonlyMap<string, AABB> | null,
  initialShapesPositions: ReadonlyMap<string, { x: number; y: number }> | null,
  isCopyDragging: boolean,
  deltaX: number,
  deltaY: number
): { dx: number; dy: number; guides: SnapGuide[] } {
  if (!isSmartGuidesEnabled) {
    return { dx: 0, dy: 0, guides: [] };
  }
  if (!initialShapesBounds || !initialShapesPositions || isCopyDragging) {
    return { dx: 0, dy: 0, guides: [] };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const bounds of initialShapesBounds.values()) {
    minX = Math.min(minX, bounds.minX + deltaX);
    minY = Math.min(minY, bounds.minY + deltaY);
    maxX = Math.max(maxX, bounds.maxX + deltaX);
    maxY = Math.max(maxY, bounds.maxY + deltaY);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const movingAABB: AABB = {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
  return calculateAABBSnap(
    stateManager,
    viewportZoom,
    isSmartGuidesEnabled,
    movingAABB,
    new Set(initialShapesPositions.keys())
  );
}
