import type { PathPoint, Shape, Vector2D } from '../types/scene-graph.ts';
import type { ShapeDimensions } from '../commands/ResizeCommand.ts';
import type { ShapeDimensionsEntry } from '../state/StateManager.ts';
import { getPathBaseAABB, normalizeAngle } from './geometry.ts';

/**
 * Obtiene el centro geométrico (cx, cy) de una figura en coordenadas del mundo.
 * - Rectángulo: (x + width / 2, y + height / 2)
 * - Elipse: (x, y)
 * - Trazado: centro de su caja base (getPathBaseAABB)
 */
export function getShapeCenter(shape: Shape): Vector2D {
  if (shape.type === 'rectangle') {
    return {
      x: shape.x + shape.width / 2,
      y: shape.y + shape.height / 2,
    };
  }
  if (shape.type === 'ellipse') {
    return {
      x: shape.x,
      y: shape.y,
    };
  }
  if (shape.type === 'text') {
    return {
      x: shape.x,
      y: shape.y,
    };
  }
  const baseAABB = getPathBaseAABB(shape);
  return {
    x: (baseAABB.minX + baseAABB.maxX) / 2,
    y: (baseAABB.minY + baseAABB.maxY) / 2,
  };
}

/**
 * Extrae las dimensiones completas actuales de una figura como ShapeDimensions.
 */
export function getShapeDimensions(shape: Shape): ShapeDimensions {
  if (shape.type === 'rectangle') {
    return {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation ?? 0,
    };
  }
  if (shape.type === 'ellipse') {
    return {
      x: shape.x,
      y: shape.y,
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotation: shape.rotation ?? 0,
    };
  }
  if (shape.type === 'text') {
    return {
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation ?? 0,
      fontSize: shape.fontSize ?? 16,
      ...(shape.lineHeight !== undefined ? { lineHeight: shape.lineHeight } : {}),
    };
  }
  return {
    x: shape.x,
    y: shape.y,
    points: shape.points,
    rotation: shape.rotation ?? 0,
  };
}

/**
 * Rota un conjunto de figuras hoja alrededor de un punto pivote.
 * El centro c de cada figura pasa a P + R(Δθ)(c - P) y su rotación suma Δθ (normalizada en (-180, 180]).
 * - Rectángulo: recalcula x,y desde el nuevo centro.
 * - Elipse: x,y es el centro.
 * - Trazado: traslada puntos y manejadores por (centro nuevo - centro viejo), con rotation += Δθ.
 *
 * @param shapes Figuras hoja originales (sin estado interno)
 * @param pivot Punto pivote de rotación (P)
 * @param deltaDeg Ángulo de rotación en grados (Δθ)
 * @returns Array con las entradas { id, dimensions } exclusivamente de las figuras que cambian.
 */
export function rotateShapesAboutPivot(
  shapes: readonly Shape[],
  pivot: Vector2D,
  deltaDeg: number
): ShapeDimensionsEntry[] {
  if (!shapes || shapes.length === 0) {
    return [];
  }

  const rad = (deltaDeg * Math.PI) / 180;
  const rawCos = Math.cos(rad);
  const rawSin = Math.sin(rad);
  const cos = Math.abs(rawCos) < 1e-15 ? 0 : rawCos;
  const sin = Math.abs(rawSin) < 1e-15 ? 0 : rawSin;

  const results: ShapeDimensionsEntry[] = [];

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const c = getShapeCenter(shape);

    const dx = c.x - pivot.x;
    const dy = c.y - pivot.y;
    const newCx = pivot.x + dx * cos - dy * sin;
    const newCy = pivot.y + dx * sin + dy * cos;

    const oldRot = shape.rotation ?? 0;
    const newRot = normalizeAngle(oldRot + deltaDeg);

    if (shape.type === 'rectangle') {
      const newX = newCx - shape.width / 2;
      const newY = newCy - shape.height / 2;

      const changed =
        Math.abs(newX - shape.x) > 1e-10 ||
        Math.abs(newY - shape.y) > 1e-10 ||
        Math.abs(newRot - oldRot) > 1e-10;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newX,
            y: newY,
            width: shape.width,
            height: shape.height,
            rotation: newRot,
          },
        });
      }
    } else if (shape.type === 'ellipse') {
      const newX = newCx;
      const newY = newCy;

      const changed =
        Math.abs(newX - shape.x) > 1e-10 ||
        Math.abs(newY - shape.y) > 1e-10 ||
        Math.abs(newRot - oldRot) > 1e-10;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newX,
            y: newY,
            radiusX: shape.radiusX,
            radiusY: shape.radiusY,
            rotation: newRot,
          },
        });
      }
    } else if (shape.type === 'path') {
      const shiftX = newCx - c.x;
      const shiftY = newCy - c.y;

      const newPoints: PathPoint[] = new Array(shape.points.length);
      let pointsChanged = false;

      for (let p = 0; p < shape.points.length; p++) {
        const pt = shape.points[p];
        const nx = pt.x + shiftX;
        const ny = pt.y + shiftY;
        if (Math.abs(nx - pt.x) > 1e-10 || Math.abs(ny - pt.y) > 1e-10) {
          pointsChanged = true;
        }

        const handleIn = pt.handleIn
          ? { x: pt.handleIn.x + shiftX, y: pt.handleIn.y + shiftY }
          : undefined;
        const handleOut = pt.handleOut
          ? { x: pt.handleOut.x + shiftX, y: pt.handleOut.y + shiftY }
          : undefined;

        newPoints[p] = {
          x: nx,
          y: ny,
          ...(handleIn ? { handleIn } : {}),
          ...(handleOut ? { handleOut } : {}),
        };
      }

      const newPathX = shape.x + shiftX;
      const newPathY = shape.y + shiftY;

      const changed =
        Math.abs(newPathX - shape.x) > 1e-10 ||
        Math.abs(newPathY - shape.y) > 1e-10 ||
        Math.abs(newRot - oldRot) > 1e-10 ||
        pointsChanged;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newPathX,
            y: newPathY,
            points: newPoints,
            rotation: newRot,
          },
        });
      }
    } else if (shape.type === 'text') {
      const newX = newCx;
      const newY = newCy;

      const changed =
        Math.abs(newX - shape.x) > 1e-10 ||
        Math.abs(newY - shape.y) > 1e-10 ||
        Math.abs(newRot - oldRot) > 1e-10;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newX,
            y: newY,
            rotation: newRot,
          },
        });
      }
    }
  }

  return results;
}

/**
 * Escala un conjunto de figuras hoja alrededor de un punto de anclaje (anchor).
 * El centro pasa a A + S(c - A). Con θ = rotation de la figura:
 * lx = hypot(sx·cosθ, sy·sinθ), ly = hypot(sx·sinθ, sy·cosθ).
 * Rectángulo: width·lx, height·ly.
 * Elipse: radiusX·lx, radiusY·ly.
 * Trazado: puntos y manejadores escalados por (lx, ly) alrededor del centro de su caja base
 * y trasladados al centro nuevo.
 * La rotación y el grosor del trazo no cambian.
 *
 * NOTA: Es exacto con θ = 0° o 90° o con sx = sy; con otros ángulos y escala no uniforme
 * es una aproximación.
 *
 * @param shapes Figuras hoja originales (sin estado interno)
 * @param anchor Punto de anclaje fijo (A)
 * @param sx Factor de escala horizontal
 * @param sy Factor de escala vertical
 * @returns Array con las entradas { id, dimensions } exclusivamente de las figuras que cambian.
 */
export function scaleShapesAboutAnchor(
  shapes: readonly Shape[],
  anchor: Vector2D,
  sx: number,
  sy: number
): ShapeDimensionsEntry[] {
  if (!shapes || shapes.length === 0) {
    return [];
  }

  const results: ShapeDimensionsEntry[] = [];

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const c = getShapeCenter(shape);

    const newCx = anchor.x + (c.x - anchor.x) * sx;
    const newCy = anchor.y + (c.y - anchor.y) * sy;

    const rotDeg = shape.rotation ?? 0;
    const theta = (rotDeg * Math.PI) / 180;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);

    const lx = Math.hypot(sx * cosTheta, sy * sinTheta);
    const ly = Math.hypot(sx * sinTheta, sy * cosTheta);

    if (shape.type === 'rectangle') {
      const newWidth = shape.width * lx;
      const newHeight = shape.height * ly;
      const newX = newCx - newWidth / 2;
      const newY = newCy - newHeight / 2;

      const changed =
        Math.abs(newX - shape.x) > 1e-10 ||
        Math.abs(newY - shape.y) > 1e-10 ||
        Math.abs(newWidth - shape.width) > 1e-10 ||
        Math.abs(newHeight - shape.height) > 1e-10;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
            rotation: rotDeg,
          },
        });
      }
    } else if (shape.type === 'ellipse') {
      const newRadiusX = shape.radiusX * lx;
      const newRadiusY = shape.radiusY * ly;
      const newX = newCx;
      const newY = newCy;

      const changed =
        Math.abs(newX - shape.x) > 1e-10 ||
        Math.abs(newY - shape.y) > 1e-10 ||
        Math.abs(newRadiusX - shape.radiusX) > 1e-10 ||
        Math.abs(newRadiusY - shape.radiusY) > 1e-10;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newX,
            y: newY,
            radiusX: newRadiusX,
            radiusY: newRadiusY,
            rotation: rotDeg,
          },
        });
      }
    } else if (shape.type === 'path') {
      // Puntos y manejadores escalados por (lx, ly) alrededor del centro c de su caja base
      // y luego trasladados a newCx, newCy: P_final = newC + (P - c) * (lx, ly)
      const newPoints: PathPoint[] = new Array(shape.points.length);
      let pointsChanged = false;

      for (let p = 0; p < shape.points.length; p++) {
        const pt = shape.points[p];
        const nx = newCx + (pt.x - c.x) * lx;
        const ny = newCy + (pt.y - c.y) * ly;
        if (Math.abs(nx - pt.x) > 1e-10 || Math.abs(ny - pt.y) > 1e-10) {
          pointsChanged = true;
        }

        const handleIn = pt.handleIn
          ? {
              x: newCx + (pt.handleIn.x - c.x) * lx,
              y: newCy + (pt.handleIn.y - c.y) * ly,
            }
          : undefined;

        const handleOut = pt.handleOut
          ? {
              x: newCx + (pt.handleOut.x - c.x) * lx,
              y: newCy + (pt.handleOut.y - c.y) * ly,
            }
          : undefined;

        newPoints[p] = {
          x: nx,
          y: ny,
          ...(handleIn ? { handleIn } : {}),
          ...(handleOut ? { handleOut } : {}),
        };
      }

      const newPathX = newCx + (shape.x - c.x) * lx;
      const newPathY = newCy + (shape.y - c.y) * ly;

      const changed =
        Math.abs(newPathX - shape.x) > 1e-10 ||
        Math.abs(newPathY - shape.y) > 1e-10 ||
        pointsChanged;

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newPathX,
            y: newPathY,
            points: newPoints,
            rotation: rotDeg,
          },
        });
      }
    } else if (shape.type === 'text') {
      const oldFontSize = shape.fontSize ?? 16;
      const scaleFactor = Math.hypot(sx * cosTheta, sy * sinTheta);
      const newFontSize = Math.max(1, Math.round(oldFontSize * scaleFactor));
      const oldLineHeight = shape.lineHeight;
      const newLineHeight = oldLineHeight !== undefined ? Math.max(1, Math.round(oldLineHeight * scaleFactor)) : undefined;
      const newX = newCx;
      const newY = newCy;

      const changed =
        Math.abs(newX - shape.x) > 1e-10 ||
        Math.abs(newY - shape.y) > 1e-10 ||
        newFontSize !== oldFontSize ||
        (oldLineHeight !== undefined && newLineHeight !== oldLineHeight);

      if (changed) {
        results.push({
          id: shape.id,
          dimensions: {
            x: newX,
            y: newY,
            fontSize: newFontSize,
            ...(newLineHeight !== undefined ? { lineHeight: newLineHeight } : {}),
            rotation: rotDeg,
          },
        });
      }
    }
  }

  return results;
}
