import type { AABB, Shape } from '../../types/scene-graph.ts';
import { getShapeAABB, getPathBaseAABB } from './aabb.ts';
import { getTextBaseAABB } from './textMetrics.ts';

/**
 * Tipos de manejadores de esquina y rotación
 */
export type HandleType =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'right-center'
  | 'bottom-right'
  | 'bottom-center'
  | 'bottom-left'
  | 'left-center'
  | 'rotation-handle';

/**
 * Representación de un manejador de selección como AABB pequeño
 */
export interface SelectionHandle extends AABB {
  readonly type: HandleType;
}

/**
 * Calcula el AABB de un Shape y devuelve un array con objetos geométricos
 * (AABBs pequeños de 8x8px) correspondientes a las esquinas, laterales y manejador de rotación flotante.
 *
 * @param shape Figura seleccionada
 * @param handleSize Tamaño en píxeles del manejador (por defecto 8px)
 * @param rotationDistance Distancia del tirador de rotación (por defecto 30px)
 * @param includeSideHandles Si es true, incluye los 4 manejadores laterales (top-center, bottom-center, left-center, right-center)
 * @returns Array con los manejadores de la figura
 */
export function getSelectionHandles(
  shape: Shape,
  handleSize: number = 8,
  rotationDistance: number = 30,
  includeSideHandles: boolean = false
): SelectionHandle[] {
  const half = handleSize / 2;
  const rotation = shape.rotation ?? 0;

  if (!rotation) {
    const aabb = getShapeAABB(shape);
    const midX = (aabb.minX + aabb.maxX) / 2;
    const midY = (aabb.minY + aabb.maxY) / 2;
    const rotY = aabb.minY - rotationDistance;

    const createH = (x: number, y: number, type: HandleType): SelectionHandle => ({
      type,
      minX: x - half,
      minY: y - half,
      maxX: x + half,
      maxY: y + half,
      width: handleSize,
      height: handleSize,
    });

    if (!includeSideHandles) {
      const handles: SelectionHandle[] = [
        createH(aabb.minX, aabb.minY, 'top-left'),
        createH(aabb.maxX, aabb.minY, 'top-right'),
        createH(aabb.maxX, aabb.maxY, 'bottom-right'),
        createH(aabb.minX, aabb.maxY, 'bottom-left'),
        createH(midX, rotY, 'rotation-handle'),
      ];

      if (shape.type === 'text') {
        handles.push(createH(aabb.maxX, midY, 'right-center'));
      }

      return handles;
    }

    return [
      createH(aabb.minX, aabb.minY, 'top-left'),
      createH(midX, aabb.minY, 'top-center'),
      createH(aabb.maxX, aabb.minY, 'top-right'),
      createH(aabb.maxX, midY, 'right-center'),
      createH(aabb.maxX, aabb.maxY, 'bottom-right'),
      createH(midX, aabb.maxY, 'bottom-center'),
      createH(aabb.minX, aabb.maxY, 'bottom-left'),
      createH(aabb.minX, midY, 'left-center'),
      createH(midX, rotY, 'rotation-handle'),
    ];
  }

  // Figura con rotación: calcular esquinas y manejadores en espacio rotado (OBB)
  let cx = 0;
  let cy = 0;
  let hw = 0;
  let hh = 0;

  if (shape.type === 'rectangle' || shape.type === 'image') {
    hw = shape.width / 2;
    hh = shape.height / 2;
    cx = shape.x + hw;
    cy = shape.y + hh;
  } else if (shape.type === 'ellipse') {
    hw = shape.radiusX;
    hh = shape.radiusY;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'polygon') {
    hw = shape.radius;
    hh = shape.radius;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'star') {
    hw = shape.outerRadius;
    hh = shape.outerRadius;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'path') {
    const baseAABB = getPathBaseAABB(shape);
    hw = baseAABB.width / 2;
    hh = baseAABB.height / 2;
    cx = (baseAABB.minX + baseAABB.maxX) / 2;
    cy = (baseAABB.minY + baseAABB.maxY) / 2;
  } else if (shape.type === 'text') {
    const baseAABB = getTextBaseAABB(shape);
    cx = shape.x;
    cy = shape.y;

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatePoint = (dx: number, dy: number): { x: number; y: number } => ({
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    });

    const midX = (baseAABB.minX + baseAABB.maxX) / 2;
    const midY = (baseAABB.minY + baseAABB.maxY) / 2;

    const tl = rotatePoint(baseAABB.minX - cx, baseAABB.minY - cy);
    const tc = rotatePoint(midX - cx, baseAABB.minY - cy);
    const tr = rotatePoint(baseAABB.maxX - cx, baseAABB.minY - cy);
    const rc = rotatePoint(baseAABB.maxX - cx, midY - cy);
    const br = rotatePoint(baseAABB.maxX - cx, baseAABB.maxY - cy);
    const bc = rotatePoint(midX - cx, baseAABB.maxY - cy);
    const bl = rotatePoint(baseAABB.minX - cx, baseAABB.maxY - cy);
    const lc = rotatePoint(baseAABB.minX - cx, midY - cy);
    const rot = rotatePoint(midX - cx, baseAABB.minY - cy - rotationDistance);

    const createHandle = (pt: { x: number; y: number }, type: HandleType): SelectionHandle => ({
      type,
      minX: pt.x - half,
      minY: pt.y - half,
      maxX: pt.x + half,
      maxY: pt.y + half,
      width: handleSize,
      height: handleSize,
    });

    if (!includeSideHandles) {
      return [
        createHandle(tl, 'top-left'),
        createHandle(tr, 'top-right'),
        createHandle(br, 'bottom-right'),
        createHandle(bl, 'bottom-left'),
        createHandle(rot, 'rotation-handle'),
        createHandle(rc, 'right-center'),
      ];
    }

    return [
      createHandle(tl, 'top-left'),
      createHandle(tc, 'top-center'),
      createHandle(tr, 'top-right'),
      createHandle(rc, 'right-center'),
      createHandle(br, 'bottom-right'),
      createHandle(bc, 'bottom-center'),
      createHandle(bl, 'bottom-left'),
      createHandle(lc, 'left-center'),
      createHandle(rot, 'rotation-handle'),
    ];
  }

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotatePoint = (dx: number, dy: number): { x: number; y: number } => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  });

  const tl = rotatePoint(-hw, -hh);
  const tc = rotatePoint(0, -hh);
  const tr = rotatePoint(hw, -hh);
  const rc = rotatePoint(hw, 0);
  const br = rotatePoint(hw, hh);
  const bc = rotatePoint(0, hh);
  const bl = rotatePoint(-hw, hh);
  const lc = rotatePoint(-hw, 0);
  const rot = rotatePoint(0, -hh - rotationDistance);

  const createHandle = (pt: { x: number; y: number }, type: HandleType): SelectionHandle => ({
    type,
    minX: pt.x - half,
    minY: pt.y - half,
    maxX: pt.x + half,
    maxY: pt.y + half,
    width: handleSize,
    height: handleSize,
  });

  if (!includeSideHandles) {
    return [
      createHandle(tl, 'top-left'),
      createHandle(tr, 'top-right'),
      createHandle(br, 'bottom-right'),
      createHandle(bl, 'bottom-left'),
      createHandle(rot, 'rotation-handle'),
    ];
  }

  return [
    createHandle(tl, 'top-left'),
    createHandle(tc, 'top-center'),
    createHandle(tr, 'top-right'),
    createHandle(rc, 'right-center'),
    createHandle(br, 'bottom-right'),
    createHandle(bc, 'bottom-center'),
    createHandle(bl, 'bottom-left'),
    createHandle(lc, 'left-center'),
    createHandle(rot, 'rotation-handle'),
  ];
}

/**
 * Devuelve todos los manejadores de selección (4 esquinas, 4 laterales y rotación) para una figura.
 */
export function getAllSelectionHandles(
  shape: Shape,
  handleSize: number = 8,
  rotationDistance: number = 30
): SelectionHandle[] {
  return getSelectionHandles(shape, handleSize, rotationDistance, true);
}

/**
 * Genera los manejadores de selección (esquinas, laterales y rotación) para un AABB envolvente.
 * Utiliza los mismos tipos que getSelectionHandles.
 *
 * @param bounds Caja delimitadora (AABB) de la selección
 * @param handleSize Tamaño en píxeles del manejador (por defecto 8px)
 * @param rotationDistance Distancia del tirador de rotación (por defecto 30px)
 * @param includeSideHandles Si es true, incluye los 4 manejadores laterales (top-center, bottom-center, left-center, right-center)
 * @returns Array con los manejadores
 */
export function getSelectionBoxHandles(
  bounds: AABB,
  handleSize: number = 8,
  rotationDistance: number = 30,
  includeSideHandles: boolean = false
): SelectionHandle[] {
  const half = handleSize / 2;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const rotY = bounds.minY - rotationDistance;

  const createH = (x: number, y: number, type: HandleType): SelectionHandle => ({
    type,
    minX: x - half,
    minY: y - half,
    maxX: x + half,
    maxY: y + half,
    width: handleSize,
    height: handleSize,
  });

  if (!includeSideHandles) {
    return [
      createH(bounds.minX, bounds.minY, 'top-left'),
      createH(bounds.maxX, bounds.minY, 'top-right'),
      createH(bounds.maxX, bounds.maxY, 'bottom-right'),
      createH(bounds.minX, bounds.maxY, 'bottom-left'),
      createH(midX, rotY, 'rotation-handle'),
    ];
  }

  return [
    createH(bounds.minX, bounds.minY, 'top-left'),
    createH(midX, bounds.minY, 'top-center'),
    createH(bounds.maxX, bounds.minY, 'top-right'),
    createH(bounds.maxX, midY, 'right-center'),
    createH(bounds.maxX, bounds.maxY, 'bottom-right'),
    createH(midX, bounds.maxY, 'bottom-center'),
    createH(bounds.minX, bounds.maxY, 'bottom-left'),
    createH(bounds.minX, midY, 'left-center'),
    createH(midX, rotY, 'rotation-handle'),
  ];
}

/**
 * Devuelve todos los manejadores de selección (4 esquinas, 4 laterales y rotación) para un AABB envolvente.
 */
export function getAllSelectionBoxHandles(
  bounds: AABB,
  handleSize: number = 8,
  rotationDistance: number = 30
): SelectionHandle[] {
  return getSelectionBoxHandles(bounds, handleSize, rotationDistance, true);
}
