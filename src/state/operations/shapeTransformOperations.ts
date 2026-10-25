import type {
  Document,
  Layer,
  LayerChildNode,
  ParentNode,
  SceneNode,
  Shape,
  Rectangle,
  Polygon,
  Star,
  Text,
  Path,
  FillType,
} from '../../types/scene-graph.ts';
import {
  isDocument,
  isDropShadowEqual,
  isGroup,
  isLayer,
  isShape,
} from '../../types/scene-graph.ts';
import type { ShapeDimensions } from '../../commands/ResizeCommand.ts';
import type {
  ShapeDimensionsEntry,
  ShapePositionEntry,
  ShapeStyleEntry,
  ShapeStyleUpdate,
} from './types.ts';
import { getDocumentIndex, isPaintEqual } from './documentIndex.ts';

export function applyShapesPosition(
  doc: Document,
  entries: readonly ShapePositionEntry[]
): { nextDoc: Document; changed: boolean } {
  if (!entries || entries.length === 0) {
    return { nextDoc: doc, changed: false };
  }

  const posMap = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    posMap.set(entry.id, { x: entry.x, y: entry.y });
  }

  const docIndex = getDocumentIndex(doc);
  const affectedLayerIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let current: ParentNode | undefined = docIndex.parentMap.get(entry.id);
    while (current && current.type !== 'layer') {
      current = docIndex.parentMap.get(current.id);
    }
    if (current && isLayer(current)) {
      affectedLayerIds.add(current.id);
    }
  }

  if (affectedLayerIds.size === 0) {
    return { nextDoc: doc, changed: false };
  }

  let anyMoved = false;

  function updateTree(
    children: readonly LayerChildNode[]
  ): { updated: readonly LayerChildNode[]; changed: boolean } {
    let changed = false;
    const nextChildren: LayerChildNode[] = new Array(children.length);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isGroup(child)) {
        const res = updateTree(child.children);
        if (res.changed) {
          changed = true;
          nextChildren[i] = {
            ...child,
            children: res.updated,
          };
        } else {
          nextChildren[i] = child;
        }
      } else if (isShape(child)) {
        const targetPos = posMap.get(child.id);
        if (!targetPos || (child.x === targetPos.x && child.y === targetPos.y)) {
          nextChildren[i] = child;
          continue;
        }

        changed = true;
        anyMoved = true;

        if (child.type === 'path') {
          const dx = targetPos.x - child.x;
          const dy = targetPos.y - child.y;
          const pts = child.points;
          const pLen = pts.length;
          const updatedPoints = new Array(pLen);
          for (let p = 0; p < pLen; p++) {
            const pt = pts[p];
            updatedPoints[p] = {
              ...pt,
              x: pt.x + dx,
              y: pt.y + dy,
              handleIn: pt.handleIn ? { x: pt.handleIn.x + dx, y: pt.handleIn.y + dy } : undefined,
              handleOut: pt.handleOut ? { x: pt.handleOut.x + dx, y: pt.handleOut.y + dy } : undefined,
            };
          }
          nextChildren[i] = {
            ...child,
            x: targetPos.x,
            y: targetPos.y,
            points: updatedPoints,
          };
        } else {
          nextChildren[i] = {
            ...child,
            x: targetPos.x,
            y: targetPos.y,
          };
        }
      } else {
        nextChildren[i] = child;
      }
    }

    return { updated: changed ? nextChildren : children, changed };
  }

  const layers = doc.children;
  const nextLayers: Layer[] = new Array(layers.length);

  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l];
    if (!affectedLayerIds.has(layer.id)) {
      nextLayers[l] = layer;
      continue;
    }

    const res = updateTree(layer.children);
    if (res.changed) {
      nextLayers[l] = {
        ...layer,
        children: res.updated,
      };
    } else {
      nextLayers[l] = layer;
    }
  }

  if (!anyMoved) {
    return { nextDoc: doc, changed: false };
  }

  return {
    nextDoc: {
      ...doc,
      children: nextLayers,
    },
    changed: true,
  };
}

export function applyShapesDimensions(
  doc: Document,
  entries: readonly ShapeDimensionsEntry[]
): { nextDoc: Document; changed: boolean } {
  if (!entries || entries.length === 0) {
    return { nextDoc: doc, changed: false };
  }

  const dimMap = new Map<string, ShapeDimensions>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    dimMap.set(entry.id, entry.dimensions);
  }

  const docIndex = getDocumentIndex(doc);
  const affectedLayerIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let current: ParentNode | undefined = docIndex.parentMap.get(entry.id);
    while (current && current.type !== 'layer') {
      current = docIndex.parentMap.get(current.id);
    }
    if (current && isLayer(current)) {
      affectedLayerIds.add(current.id);
    }
  }

  if (affectedLayerIds.size === 0) {
    return { nextDoc: doc, changed: false };
  }

  let anyChanged = false;

  function updateTree(
    children: readonly LayerChildNode[]
  ): { updated: readonly LayerChildNode[]; changed: boolean } {
    let changed = false;
    const nextChildren: LayerChildNode[] = new Array(children.length);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isGroup(child)) {
        const res = updateTree(child.children);
        if (res.changed) {
          changed = true;
          nextChildren[i] = { ...child, children: res.updated };
        } else {
          nextChildren[i] = child;
        }
      } else if (isShape(child)) {
        const dimensions = dimMap.get(child.id);
        if (!dimensions) {
          nextChildren[i] = child;
          continue;
        }

        let shapeChanged = false;
        let newShape: Shape = child;

        if (child.type === 'rectangle') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextW =
            dimensions.width !== undefined
              ? dimensions.width
              : dimensions.radiusX !== undefined
              ? dimensions.radiusX * 2
              : child.width;
          const nextH =
            dimensions.height !== undefined
              ? dimensions.height
              : dimensions.radiusY !== undefined
              ? dimensions.radiusY * 2
              : child.height;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
          const hasCornerRadius = 'cornerRadius' in dimensions;
          const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextW !== child.width ||
            nextH !== child.height ||
            nextRot !== child.rotation ||
            (hasCornerRadius && nextCornerRadius !== child.cornerRadius)
          ) {
            shapeChanged = true;
            const rectBase: Rectangle = {
              ...child,
              x: nextX,
              y: nextY,
              width: nextW,
              height: nextH,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
            };
            if (hasCornerRadius) {
              if (nextCornerRadius !== undefined) {
                newShape = { ...rectBase, cornerRadius: nextCornerRadius };
              } else {
                const { cornerRadius: _, ...rest } = rectBase;
                newShape = rest as Rectangle;
              }
            } else {
              newShape = rectBase;
            }
          }
        } else if (child.type === 'ellipse') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextRx =
            dimensions.radiusX !== undefined
              ? dimensions.radiusX
              : dimensions.width !== undefined
              ? dimensions.width / 2
              : child.radiusX;
          const nextRy =
            dimensions.radiusY !== undefined
              ? dimensions.radiusY
              : dimensions.height !== undefined
              ? dimensions.height / 2
              : child.radiusY;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextRx !== child.radiusX ||
            nextRy !== child.radiusY ||
            nextRot !== child.rotation
          ) {
            shapeChanged = true;
            newShape = {
              ...child,
              x: nextX,
              y: nextY,
              radiusX: nextRx,
              radiusY: nextRy,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
            };
          }
        } else if (child.type === 'path') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextPoints = dimensions.points !== undefined ? dimensions.points : child.points;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
          const hasCornerRadius = 'cornerRadius' in dimensions;
          const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;

          const pointsDiffer = dimensions.points !== undefined && dimensions.points !== child.points;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextRot !== child.rotation ||
            pointsDiffer ||
            (hasCornerRadius && nextCornerRadius !== child.cornerRadius)
          ) {
            shapeChanged = true;
            const pathBase: Path = {
              ...child,
              x: nextX,
              y: nextY,
              points: nextPoints,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
            };
            if (hasCornerRadius) {
              if (nextCornerRadius !== undefined) {
                newShape = { ...pathBase, cornerRadius: nextCornerRadius };
              } else {
                const { cornerRadius: _, ...rest } = pathBase;
                newShape = rest as Path;
              }
            } else {
              newShape = pathBase;
            }
          }
        } else if (child.type === 'text') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
          const nextFontSize = dimensions.fontSize !== undefined ? dimensions.fontSize : child.fontSize;
          const nextLineHeight = dimensions.lineHeight !== undefined ? dimensions.lineHeight : child.lineHeight;
          const nextLetterSpacing = dimensions.letterSpacing !== undefined ? dimensions.letterSpacing : child.letterSpacing;
          const hasBoxWidth = 'boxWidth' in dimensions;
          const nextBoxWidth = hasBoxWidth ? dimensions.boxWidth : child.boxWidth;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextRot !== child.rotation ||
            (dimensions.fontSize !== undefined && nextFontSize !== child.fontSize) ||
            (dimensions.lineHeight !== undefined && nextLineHeight !== child.lineHeight) ||
            (dimensions.letterSpacing !== undefined && nextLetterSpacing !== child.letterSpacing) ||
            (hasBoxWidth && nextBoxWidth !== child.boxWidth)
          ) {
            shapeChanged = true;
            const textBase = {
              ...child,
              x: nextX,
              y: nextY,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
              ...(nextFontSize !== undefined ? { fontSize: nextFontSize } : {}),
              ...(nextLineHeight !== undefined ? { lineHeight: nextLineHeight } : {}),
              ...(nextLetterSpacing !== undefined ? { letterSpacing: nextLetterSpacing } : {}),
            };
            if (hasBoxWidth) {
              if (nextBoxWidth !== undefined) {
                newShape = { ...textBase, boxWidth: nextBoxWidth };
              } else {
                const { boxWidth: _, ...withoutBoxWidth } = textBase;
                newShape = withoutBoxWidth as Text;
              }
            } else {
              newShape = textBase;
            }
          }
        } else if (child.type === 'image') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextW = dimensions.width !== undefined ? dimensions.width : child.width;
          const nextH = dimensions.height !== undefined ? dimensions.height : child.height;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextW !== child.width ||
            nextH !== child.height ||
            nextRot !== child.rotation
          ) {
            shapeChanged = true;
            newShape = {
              ...child,
              x: nextX,
              y: nextY,
              width: nextW,
              height: nextH,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
            };
          }
        } else if (child.type === 'polygon') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextRadius =
            dimensions.radius !== undefined
              ? dimensions.radius
              : dimensions.width !== undefined
              ? dimensions.width / 2
              : dimensions.radiusX !== undefined
              ? dimensions.radiusX
              : child.radius;
          const nextSides = dimensions.sides !== undefined ? dimensions.sides : child.sides;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
          const hasCornerRadius = 'cornerRadius' in dimensions;
          const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextRadius !== child.radius ||
            nextSides !== child.sides ||
            nextRot !== child.rotation ||
            (hasCornerRadius && nextCornerRadius !== child.cornerRadius)
          ) {
            shapeChanged = true;
            const polyBase: Polygon = {
              ...child,
              x: nextX,
              y: nextY,
              radius: nextRadius,
              sides: nextSides,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
            };
            if (hasCornerRadius) {
              if (nextCornerRadius !== undefined) {
                newShape = { ...polyBase, cornerRadius: nextCornerRadius };
              } else {
                const { cornerRadius: _, ...rest } = polyBase;
                newShape = rest as Polygon;
              }
            } else {
              newShape = polyBase;
            }
          }
        } else if (child.type === 'star') {
          const nextX = dimensions.x !== undefined ? dimensions.x : child.x;
          const nextY = dimensions.y !== undefined ? dimensions.y : child.y;
          const nextOuter =
            dimensions.outerRadius !== undefined
              ? dimensions.outerRadius
              : dimensions.width !== undefined
              ? dimensions.width / 2
              : dimensions.radiusX !== undefined
              ? dimensions.radiusX
              : child.outerRadius;
          const ratio = child.outerRadius > 0 ? child.innerRadius / child.outerRadius : 0.5;
          const nextInner =
            dimensions.innerRadius !== undefined
              ? dimensions.innerRadius
              : dimensions.outerRadius !== undefined ||
                dimensions.width !== undefined ||
                dimensions.radiusX !== undefined
              ? nextOuter * ratio
              : child.innerRadius;
          const nextPoints = dimensions.starPoints !== undefined ? dimensions.starPoints : child.points;
          const nextRot = dimensions.rotation !== undefined ? dimensions.rotation : child.rotation;
          const hasCornerRadius = 'cornerRadius' in dimensions;
          const nextCornerRadius = hasCornerRadius ? dimensions.cornerRadius : child.cornerRadius;
          const hasInnerCornerRadius = 'innerCornerRadius' in dimensions;
          const nextInnerCornerRadius = hasInnerCornerRadius
            ? dimensions.innerCornerRadius
            : child.innerCornerRadius;

          if (
            nextX !== child.x ||
            nextY !== child.y ||
            nextOuter !== child.outerRadius ||
            nextInner !== child.innerRadius ||
            nextPoints !== child.points ||
            nextRot !== child.rotation ||
            (hasCornerRadius && nextCornerRadius !== child.cornerRadius) ||
            (hasInnerCornerRadius && nextInnerCornerRadius !== child.innerCornerRadius)
          ) {
            shapeChanged = true;
            const starBase: Star = {
              ...child,
              x: nextX,
              y: nextY,
              outerRadius: nextOuter,
              innerRadius: nextInner,
              points: nextPoints,
              ...(nextRot !== undefined ? { rotation: nextRot } : {}),
            };
            let sTemp = starBase;
            if (hasCornerRadius) {
              if (nextCornerRadius !== undefined) {
                sTemp = { ...sTemp, cornerRadius: nextCornerRadius };
              } else {
                const { cornerRadius: _, ...rest } = sTemp;
                sTemp = rest as Star;
              }
            }
            if (hasInnerCornerRadius) {
              if (nextInnerCornerRadius !== undefined) {
                sTemp = { ...sTemp, innerCornerRadius: nextInnerCornerRadius };
              } else {
                const { innerCornerRadius: _, ...rest } = sTemp;
                sTemp = rest as Star;
              }
            }
            newShape = sTemp;
          }
        }

        if (shapeChanged) {
          changed = true;
          anyChanged = true;
          nextChildren[i] = newShape;
        } else {
          nextChildren[i] = child;
        }
      } else {
        nextChildren[i] = child;
      }
    }

    return { updated: changed ? nextChildren : children, changed };
  }

  const layers = doc.children;
  const nextLayers: Layer[] = new Array(layers.length);

  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l];
    if (!affectedLayerIds.has(layer.id)) {
      nextLayers[l] = layer;
      continue;
    }

    const res = updateTree(layer.children);
    if (res.changed) {
      nextLayers[l] = {
        ...layer,
        children: res.updated,
      };
    } else {
      nextLayers[l] = layer;
    }
  }

  if (!anyChanged) {
    return { nextDoc: doc, changed: false };
  }

  return {
    nextDoc: {
      ...doc,
      children: nextLayers,
    },
    changed: true,
  };
}

export function applyShapesStyle(
  doc: Document,
  entries: readonly ShapeStyleEntry[]
): { nextDoc: Document; changed: boolean } {
  if (!entries || entries.length === 0) {
    return { nextDoc: doc, changed: false };
  }

  const styleMap = new Map<string, ShapeStyleUpdate>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    styleMap.set(entry.id, entry.style);
  }

  const docIndex = getDocumentIndex(doc);
  const affectedLayerIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let current: ParentNode | undefined = docIndex.parentMap.get(entry.id);
    while (current && current.type !== 'layer') {
      current = docIndex.parentMap.get(current.id);
    }
    if (current && isLayer(current)) {
      affectedLayerIds.add(current.id);
    }
  }

  if (affectedLayerIds.size === 0) {
    return { nextDoc: doc, changed: false };
  }

  let anyChanged = false;

  function updateTree(
    children: readonly LayerChildNode[]
  ): { updated: readonly LayerChildNode[]; changed: boolean } {
    let changed = false;
    const nextChildren: LayerChildNode[] = new Array(children.length);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isGroup(child)) {
        const res = updateTree(child.children);
        if (res.changed) {
          changed = true;
          nextChildren[i] = { ...child, children: res.updated };
        } else {
          nextChildren[i] = child;
        }
      } else if (isShape(child)) {
        const targetStyle = styleMap.get(child.id);
        if (!targetStyle) {
          nextChildren[i] = child;
          continue;
        }

        const isDashEqual = (a?: readonly number[], b?: readonly number[]) => {
          if (!a && !b) return true;
          if (!a || !b) return false;
          if (a.length !== b.length) return false;
          return a.every((v, idx) => v === b[idx]);
        };

        const hasFillChange = targetStyle.fill !== undefined && !isPaintEqual(targetStyle.fill, child.fill);
        const childStroke = 'stroke' in child ? (child as { stroke?: FillType }).stroke : undefined;
        const childStrokeWidth = 'strokeWidth' in child ? (child as { strokeWidth?: number }).strokeWidth : undefined;
        const hasStrokeChange = targetStyle.stroke !== undefined && !isPaintEqual(targetStyle.stroke, childStroke);
        const hasStrokeWidthChange =
          targetStyle.strokeWidth !== undefined && targetStyle.strokeWidth !== childStrokeWidth;
        const hasOpacityChange = targetStyle.opacity !== undefined && targetStyle.opacity !== child.opacity;
        const hasDashChange = 'strokeDashArray' in targetStyle && !isDashEqual(targetStyle.strokeDashArray, child.strokeDashArray);
        const hasCapChange = 'strokeLineCap' in targetStyle && targetStyle.strokeLineCap !== child.strokeLineCap;
        const hasJoinChange = 'strokeLineJoin' in targetStyle && targetStyle.strokeLineJoin !== child.strokeLineJoin;
        const hasBlendModeChange = 'blendMode' in targetStyle && targetStyle.blendMode !== child.blendMode;
        const hasShadowChange = 'dropShadow' in targetStyle && !isDropShadowEqual(targetStyle.dropShadow, child.dropShadow);

        if (
          !hasFillChange &&
          !hasStrokeChange &&
          !hasStrokeWidthChange &&
          !hasOpacityChange &&
          !hasDashChange &&
          !hasCapChange &&
          !hasJoinChange &&
          !hasBlendModeChange &&
          !hasShadowChange
        ) {
          nextChildren[i] = child;
          continue;
        }

        changed = true;
        anyChanged = true;
        let styledChild: Shape = {
          ...child,
          ...(targetStyle.fill !== undefined ? { fill: targetStyle.fill } : {}),
          ...(targetStyle.stroke !== undefined ? { stroke: targetStyle.stroke } : {}),
          ...(targetStyle.strokeWidth !== undefined ? { strokeWidth: targetStyle.strokeWidth } : {}),
          ...(targetStyle.opacity !== undefined ? { opacity: targetStyle.opacity } : {}),
          ...('blendMode' in targetStyle ? { blendMode: targetStyle.blendMode } : {}),
          ...('strokeDashArray' in targetStyle ? { strokeDashArray: targetStyle.strokeDashArray } : {}),
          ...('strokeLineCap' in targetStyle ? { strokeLineCap: targetStyle.strokeLineCap } : {}),
          ...('strokeLineJoin' in targetStyle ? { strokeLineJoin: targetStyle.strokeLineJoin } : {}),
        };

        if ('dropShadow' in targetStyle) {
          if (targetStyle.dropShadow === null) {
            const { dropShadow: _, ...withoutShadow } = styledChild;
            styledChild = withoutShadow as Shape;
          } else if (targetStyle.dropShadow !== undefined) {
            styledChild = { ...styledChild, dropShadow: targetStyle.dropShadow };
          }
        }

        nextChildren[i] = styledChild;
      } else {
        nextChildren[i] = child;
      }
    }

    return { updated: changed ? nextChildren : children, changed };
  }

  const layers = doc.children;
  const nextLayers: Layer[] = new Array(layers.length);

  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l];
    if (!affectedLayerIds.has(layer.id)) {
      nextLayers[l] = layer;
      continue;
    }

    const res = updateTree(layer.children);
    if (res.changed) {
      nextLayers[l] = {
        ...layer,
        children: res.updated,
      };
    } else {
      nextLayers[l] = layer;
    }
  }

  if (!anyChanged) {
    return { nextDoc: doc, changed: false };
  }

  return {
    nextDoc: {
      ...doc,
      children: nextLayers,
    },
    changed: true,
  };
}

export function applyShapeUpdate<T extends Shape>(
  doc: Document,
  shapeId: string,
  updater: Partial<Shape> | Partial<T> | ((current: T) => T)
): { nextDoc: Document; changed: boolean } {
  let updated = false;

  function updateTree(
    children: readonly LayerChildNode[]
  ): { updated: readonly LayerChildNode[]; changed: boolean } {
    let changed = false;
    const nextChildren: LayerChildNode[] = new Array(children.length);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isGroup(child)) {
        const res = updateTree(child.children);
        if (res.changed) {
          changed = true;
          nextChildren[i] = { ...child, children: res.updated };
        } else {
          nextChildren[i] = child;
        }
      } else if (isShape(child) && child.id === shapeId) {
        changed = true;
        updated = true;
        const nextVal = (typeof updater === 'function' ? updater(child as T) : { ...child, ...updater }) as Shape;
        nextChildren[i] = nextVal;
      } else {
        nextChildren[i] = child;
      }
    }

    return { updated: changed ? nextChildren : children, changed };
  }

  const nextLayers = doc.children.map((layer) => {
    const res = updateTree(layer.children);
    if (res.changed) {
      return {
        ...layer,
        children: res.updated,
      };
    }
    return layer;
  });

  if (!updated) {
    return { nextDoc: doc, changed: false };
  }

  return {
    nextDoc: {
      ...doc,
      children: nextLayers,
    },
    changed: true,
  };
}

export function applyNodeUpdate(
  doc: Document,
  nodeId: string,
  updater: Partial<SceneNode> | Record<string, unknown>
): { nextDoc: Document; changed: boolean } {
  const docIndex = getDocumentIndex(doc);
  const target = docIndex.nodeMap.get(nodeId);
  if (!target) {
    return { nextDoc: doc, changed: false };
  }

  if (isDocument(target)) {
    return {
      nextDoc: { ...doc, ...updater } as Document,
      changed: true,
    };
  }

  if (isLayer(target)) {
    const nextLayers = doc.children.map((layer) => {
      if (layer.id === nodeId) {
        return { ...layer, ...updater } as Layer;
      }
      return layer;
    });
    return {
      nextDoc: { ...doc, children: nextLayers },
      changed: true,
    };
  }

  let updated = false;

  function updateTree(
    children: readonly LayerChildNode[]
  ): { updated: readonly LayerChildNode[]; changed: boolean } {
    let changed = false;
    const nextChildren: LayerChildNode[] = new Array(children.length);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.id === nodeId) {
        changed = true;
        updated = true;
        nextChildren[i] = { ...child, ...updater } as LayerChildNode;
      } else if (isGroup(child)) {
        const res = updateTree(child.children);
        if (res.changed) {
          changed = true;
          nextChildren[i] = { ...child, children: res.updated };
        } else {
          nextChildren[i] = child;
        }
      } else {
        nextChildren[i] = child;
      }
    }

    return { updated: changed ? nextChildren : children, changed };
  }

  const nextLayers = doc.children.map((layer) => {
    const res = updateTree(layer.children);
    if (res.changed) {
      return {
        ...layer,
        children: res.updated,
      };
    }
    return layer;
  });

  if (!updated) {
    return { nextDoc: doc, changed: false };
  }

  return {
    nextDoc: {
      ...doc,
      children: nextLayers,
    },
    changed: true,
  };
}
