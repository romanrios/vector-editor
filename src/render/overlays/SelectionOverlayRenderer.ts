import {
  type AABB,
  type Group,
  type Shape,
  type Path,
  type SelectableNode,
  isGroup,
  isShape,
  isText,
  isGradient,
} from '../../types/scene-graph.ts';
import type { StateManager } from '../../state/StateManager.ts';
import {
  getGroupAABB,
  getPathBaseAABB,
  getTextBaseAABB,
  getSelectionBounds,
  getShapeAABB,
} from '../../utils/geometry.ts';
import type { RenderEngineOptions } from '../types.ts';
import { renderGradientOverlay } from './GradientOverlayRenderer.ts';
import { renderTextEditOverlay } from './TextEditOverlayRenderer.ts';
import { renderPathEditOverlay } from './PathEditOverlayRenderer.ts';
import { renderCornerRadiusHandlesOverlay } from './CornerRadiusOverlayRenderer.ts';

/**
 * Dibuja la caja delimitadora combinada (AABB), conector vertical, los 4 manejadores cuadrados
 * de esquina y el manejador flotante de rotación para un conjunto (grupo o multiselección).
 */
export function renderBoxWithHandles(
  ctx: CanvasRenderingContext2D,
  bounds: AABB,
  zoom: number
): void {
  const handleSize = 8 / zoom;
  const halfHandle = handleSize / 2;
  const rotationDistance = 30 / zoom;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const rotY = bounds.minY - rotationDistance;

  ctx.save();

  // 1. Recuadro delimitador combinado
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

  // 2. Conector vertical sutil hacia el manejador de rotación
  ctx.beginPath();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1 / zoom;
  ctx.moveTo(midX, bounds.minY);
  ctx.lineTo(midX, rotY);
  ctx.stroke();

  const midY = (bounds.minY + bounds.maxY) / 2;

  // 3. Manejadores en las 4 esquinas y los 4 laterales
  const handles = [
    { x: bounds.minX, y: bounds.minY }, // Superior Izquierda
    { x: midX, y: bounds.minY },        // Superior Centro
    { x: bounds.maxX, y: bounds.minY }, // Superior Derecha
    { x: bounds.maxX, y: midY },        // Centro Derecha
    { x: bounds.maxX, y: bounds.maxY }, // Inferior Derecha
    { x: midX, y: bounds.maxY },        // Inferior Centro
    { x: bounds.minX, y: bounds.maxY }, // Inferior Izquierda
    { x: bounds.minX, y: midY },        // Centro Izquierda
  ];

  for (const h of handles) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      h.x - halfHandle,
      h.y - halfHandle,
      handleSize,
      handleSize
    );

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(
      h.x - halfHandle,
      h.y - halfHandle,
      handleSize,
      handleSize
    );
  }

  // 4. Manejador de rotación flotante (círculo verde)
  ctx.beginPath();
  if (typeof ctx.arc === 'function') {
    ctx.arc(midX, rotY, halfHandle, 0, Math.PI * 2);
  } else if (typeof ctx.ellipse === 'function') {
    ctx.ellipse(midX, rotY, halfHandle, halfHandle, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = '#10b981';
  ctx.fill();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();

  ctx.restore();
}

/**
 * Dibuja el recuadro delimitador de un grupo seleccionado con sus 4 tiradores de esquina y de rotación.
 */
export function renderSingleGroupSelection(
  ctx: CanvasRenderingContext2D,
  group: Group,
  zoom: number
): void {
  const aabb = getSelectionBounds([group]) ?? getGroupAABB(group);
  if (!aabb) return;
  renderBoxWithHandles(ctx, aabb, zoom);
}

/**
 * Dibuja un contorno fino de 1px constante sobre un grupo perteneciente a una selección múltiple.
 */
export function renderGroupOutline(
  ctx: CanvasRenderingContext2D,
  group: Group,
  zoom: number
): void {
  const aabb = getGroupAABB(group);
  if (!aabb) return;

  ctx.save();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(aabb.minX, aabb.minY, aabb.width, aabb.height);
  ctx.restore();
}

/**
 * Dibuja un contorno fino de 1px constante sobre una figura individual perteneciente
 * a una selección múltiple.
 */
export function renderShapeOutline(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  zoom: number
): void {
  const rotation = shape.rotation ?? 0;

  let baseX = 0;
  let baseY = 0;
  let baseWidth = 0;
  let baseHeight = 0;
  let cx = 0;
  let cy = 0;

  if (!rotation) {
    const aabb = getShapeAABB(shape);
    baseX = aabb.minX;
    baseY = aabb.minY;
    baseWidth = aabb.width;
    baseHeight = aabb.height;
  } else if (shape.type === 'rectangle' || shape.type === 'image') {
    baseX = shape.x;
    baseY = shape.y;
    baseWidth = shape.width;
    baseHeight = shape.height;
    cx = shape.x + shape.width / 2;
    cy = shape.y + shape.height / 2;
  } else if (shape.type === 'ellipse') {
    baseX = shape.x - shape.radiusX;
    baseY = shape.y - shape.radiusY;
    baseWidth = shape.radiusX * 2;
    baseHeight = shape.radiusY * 2;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'path') {
    const baseAABB = getPathBaseAABB(shape);
    baseX = baseAABB.minX;
    baseY = baseAABB.minY;
    baseWidth = baseAABB.width;
    baseHeight = baseAABB.height;
    cx = (baseAABB.minX + baseAABB.maxX) / 2;
    cy = (baseAABB.minY + baseAABB.maxY) / 2;
  } else if (shape.type === 'polygon') {
    baseX = shape.x - shape.radius;
    baseY = shape.y - shape.radius;
    baseWidth = shape.radius * 2;
    baseHeight = shape.radius * 2;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'star') {
    baseX = shape.x - shape.outerRadius;
    baseY = shape.y - shape.outerRadius;
    baseWidth = shape.outerRadius * 2;
    baseHeight = shape.outerRadius * 2;
    cx = shape.x;
    cy = shape.y;
  }

  ctx.save();
  if (rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(baseX, baseY, baseWidth, baseHeight);
  ctx.restore();
}

/**
 * Dibuja la caja delimitadora (Bounding Box) azul orientada y los 4 manejadores cuadrados
 * de redimensionado más el manejador flotante de rotación para una única figura seleccionada.
 */
export function renderSingleShapeSelection(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  zoom: number
): void {
  const handleSize = 8 / zoom;
  const halfHandle = handleSize / 2;
  const rotationDistance = 30 / zoom;
  const rotation = shape.rotation ?? 0;

  let baseX = 0;
  let baseY = 0;
  let baseWidth = 0;
  let baseHeight = 0;
  let cx = 0;
  let cy = 0;

  if (!rotation) {
    const aabb = getShapeAABB(shape);
    baseX = aabb.minX;
    baseY = aabb.minY;
    baseWidth = aabb.width;
    baseHeight = aabb.height;
    cx = (baseX + baseWidth) / 2;
    cy = (baseY + baseHeight) / 2;
  } else if (shape.type === 'rectangle' || shape.type === 'image') {
    baseX = shape.x;
    baseY = shape.y;
    baseWidth = shape.width;
    baseHeight = shape.height;
    cx = shape.x + shape.width / 2;
    cy = shape.y + shape.height / 2;
  } else if (shape.type === 'ellipse') {
    baseX = shape.x - shape.radiusX;
    baseY = shape.y - shape.radiusY;
    baseWidth = shape.radiusX * 2;
    baseHeight = shape.radiusY * 2;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'path') {
    const baseAABB = getPathBaseAABB(shape);
    baseX = baseAABB.minX;
    baseY = baseAABB.minY;
    baseWidth = baseAABB.width;
    baseHeight = baseAABB.height;
    cx = (baseAABB.minX + baseAABB.maxX) / 2;
    cy = (baseAABB.minY + baseAABB.maxY) / 2;
  } else if (shape.type === 'text') {
    const baseAABB = getTextBaseAABB(shape, ctx);
    baseX = baseAABB.minX;
    baseY = baseAABB.minY;
    baseWidth = baseAABB.width;
    baseHeight = baseAABB.height;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'polygon') {
    baseX = shape.x - shape.radius;
    baseY = shape.y - shape.radius;
    baseWidth = shape.radius * 2;
    baseHeight = shape.radius * 2;
    cx = shape.x;
    cy = shape.y;
  } else if (shape.type === 'star') {
    baseX = shape.x - shape.outerRadius;
    baseY = shape.y - shape.outerRadius;
    baseWidth = shape.outerRadius * 2;
    baseHeight = shape.outerRadius * 2;
    cx = shape.x;
    cy = shape.y;
  }

  const midX = baseX + baseWidth / 2;
  const rotY = baseY - rotationDistance;

  ctx.save();

  if (rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // 1. Caja delimitadora (Bounding Box) azul
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(baseX, baseY, baseWidth, baseHeight);

  // 2. Conector vertical sutil que une el bounding box principal con el manejador flotante
  ctx.beginPath();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1 / zoom;
  ctx.moveTo(midX, baseY);
  ctx.lineTo(midX, rotY);
  ctx.stroke();

  const midY = baseY + baseHeight / 2;

  // 3. Manejadores (cuadrados en las 4 esquinas y en los 4 laterales)
  const handles = [
    { x: baseX, y: baseY },                          // Superior Izquierda
    { x: midX, y: baseY },                           // Superior Centro
    { x: baseX + baseWidth, y: baseY },              // Superior Derecha
    { x: baseX + baseWidth, y: midY },               // Centro Derecha
    { x: baseX + baseWidth, y: baseY + baseHeight }, // Inferior Derecha
    { x: midX, y: baseY + baseHeight },              // Inferior Centro
    { x: baseX, y: baseY + baseHeight },             // Inferior Izquierda
    { x: baseX, y: midY },                           // Centro Izquierda
  ];

  for (const h of handles) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      h.x - halfHandle,
      h.y - halfHandle,
      handleSize,
      handleSize
    );

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(
      h.x - halfHandle,
      h.y - halfHandle,
      handleSize,
      handleSize
    );
  }

  // 4. Manejador de rotación flotante (círculo verde)
  ctx.beginPath();
  if (typeof ctx.arc === 'function') {
    ctx.arc(midX, rotY, halfHandle, 0, Math.PI * 2);
  } else if (typeof ctx.ellipse === 'function') {
    ctx.ellipse(midX, rotY, halfHandle, halfHandle, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = '#10b981';
  ctx.fill();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();

  ctx.restore();

  // 5. Tiradores de radio de esquina para figuras compatibles (Rectangle, Polygon, Star, Path)
  renderCornerRadiusHandlesOverlay(ctx, shape, zoom);
}

/**
 * Dibuja la caja delimitadora (bounding box) y los manejadores de selección.
 * - Con una sola figura: dibuja la caja OBB con manejadores de esquina y rotación.
 * - Con un solo grupo: dibuja la caja delimitadora AABB de grosor constante, SIN tiradores.
 * - Con varias figuras/grupos: dibuja un contorno fino sobre cada elemento y una única caja AABB
 *   combinada (getSelectionBounds) sin tiradores.
 * Mantiene un tamaño constante en pantalla dividiendo las medidas entre el factor de zoom.
 */
export function renderSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  stateManager: StateManager,
  options: RenderEngineOptions,
  zoom: number
): void {
  const selectedNodes: SelectableNode[] = [];
  for (const node of stateManager.getSelectedNodes()) {
    if (
      stateManager.isEffectivelyVisible(node.id) &&
      !stateManager.isEffectivelyLocked(node.id)
    ) {
      selectedNodes.push(node);
    }
  }

  const pathEdit = options.pathEditProvider?.() ?? null;

  if (selectedNodes.length === 0 && !pathEdit) {
    return;
  }

  if (selectedNodes.length === 1) {
    const node = selectedNodes[0];
    if (isGroup(node)) {
      renderSingleGroupSelection(ctx, node, zoom);
    } else if (isShape(node)) {
      const textEdit = options.textEditProvider?.() ?? null;
      if (textEdit && textEdit.textId === node.id && isText(node)) {
        renderTextEditOverlay(ctx, node, textEdit, zoom);
      } else if (!pathEdit || pathEdit.pathId !== node.id) {
        renderSingleShapeSelection(ctx, node, zoom);
        if (isGradient(node.fill)) {
          renderGradientOverlay(ctx, node, node.fill, zoom);
        } else if (isGradient(node.stroke)) {
          renderGradientOverlay(ctx, node, node.stroke, zoom);
        }
      }
    }
  } else if (selectedNodes.length > 1) {
    // Múltiples elementos seleccionados:
    // 1. Contorno fino sobre cada elemento seleccionado
    for (const node of selectedNodes) {
      if (isGroup(node)) {
        renderGroupOutline(ctx, node, zoom);
      } else if (isShape(node)) {
        renderShapeOutline(ctx, node, zoom);
      }
    }

    // 2. Un recuadro delimitador combinado (getSelectionBounds) con tiradores
    const combinedBounds = getSelectionBounds(selectedNodes);
    if (combinedBounds) {
      renderBoxWithHandles(ctx, combinedBounds, zoom);
    }
  }

  // Dibujar overlay de edición de trazado DESPUÉS de dibujar todo, para que quede por encima
  if (pathEdit) {
    const pathNode = stateManager.findNode(pathEdit.pathId);
    if (pathNode && pathNode.type === 'path' && stateManager.isEffectivelyVisible(pathNode.id)) {
      renderPathEditOverlay(ctx, pathNode as Path, pathEdit, zoom);
    }
  }
}
