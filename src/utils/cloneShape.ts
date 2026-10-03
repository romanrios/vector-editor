import type { Shape, Rectangle, Ellipse, Path, PathPoint } from '../types/scene-graph.ts';
import { deepFreeze } from './immutable.ts';

export interface CloneShapeOptions {
  readonly dx?: number;
  readonly dy?: number;
  readonly newId?: string;
  readonly newName?: string;
}

let cloneCounter = 0;

/**
 * Genera un identificador único determinista para una nueva figura clonada.
 */
export function generateClonedShapeId(type: string): string {
  cloneCounter++;
  return `${type}-${Date.now()}-${cloneCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Función pura que produce una copia profunda de una figura (Rectangle, Ellipse o Path)
 * con un identificador único, un nombre derivado y un desplazamiento configurable (dx, dy).
 * Para Path, clona todos los puntos de ancla y vectores de control (handleIn/handleOut)
 * garantizando que no existan referencias compartidas con la figura original.
 * Respeta la inmutabilidad profunda (deepFreeze).
 */
export function cloneShape<T extends Shape>(shape: T, options?: CloneShapeOptions): T {
  const dx = options?.dx ?? 0;
  const dy = options?.dy ?? 0;
  const id = options?.newId ?? generateClonedShapeId(shape.type);
  const name = options?.newName ?? `${shape.name} copia`;

  if (shape.type === 'rectangle') {
    const rect: Rectangle = {
      ...shape,
      id,
      name,
      x: shape.x + dx,
      y: shape.y + dy,
      selected: false,
    };
    return deepFreeze(rect) as unknown as T;
  }

  if (shape.type === 'ellipse') {
    const ellipse: Ellipse = {
      ...shape,
      id,
      name,
      x: shape.x + dx,
      y: shape.y + dy,
      selected: false,
    };
    return deepFreeze(ellipse) as unknown as T;
  }

  if (shape.type === 'path') {
    const points: readonly PathPoint[] = (shape.points || []).map((pt) => {
      const clonedPt: PathPoint = {
        x: pt.x + dx,
        y: pt.y + dy,
        ...(pt.handleIn
          ? { handleIn: { x: pt.handleIn.x + dx, y: pt.handleIn.y + dy } }
          : {}),
        ...(pt.handleOut
          ? { handleOut: { x: pt.handleOut.x + dx, y: pt.handleOut.y + dy } }
          : {}),
      };
      return clonedPt;
    });

    const path: Path = {
      ...shape,
      id,
      name,
      x: shape.x + dx,
      y: shape.y + dy,
      points,
      selected: false,
    };
    return deepFreeze(path) as unknown as T;
  }

  throw new Error(`[cloneShape] Tipo de figura no soportado: ${(shape as any)?.type}`);
}
