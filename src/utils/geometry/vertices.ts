import type { Polygon, Star, Vector2D } from '../../types/scene-graph.ts';

/**
 * Calcula los vértices base de un Polígono regular sin rotación (con el vértice superior a 12 en punto / -90°).
 */
export function getPolygonBaseVertices(polygon: Polygon): Vector2D[] {
  const n = Math.max(3, Math.round(polygon.sides || 3));
  const r = Math.max(0, polygon.radius);
  const cx = polygon.x;
  const cy = polygon.y;
  const vertices: Vector2D[] = new Array(n);
  const startAngle = -Math.PI / 2;
  const step = (Math.PI * 2) / n;

  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula los vértices finales de un Polígono regular aplicando su rotación.
 */
export function getPolygonVertices(polygon: Polygon): Vector2D[] {
  const n = Math.max(3, Math.round(polygon.sides || 3));
  const r = Math.max(0, polygon.radius);
  const cx = polygon.x;
  const cy = polygon.y;
  const rotRad = ((polygon.rotation ?? 0) * Math.PI) / 180;
  const startAngle = -Math.PI / 2 + rotRad;
  const step = (Math.PI * 2) / n;
  const vertices: Vector2D[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula los vértices base de una Estrella regular sin rotación (con la primera punta exterior a 12 en punto / -90°).
 */
export function getStarBaseVertices(star: Star): Vector2D[] {
  const p = Math.max(3, Math.round(star.points || 3));
  const rOut = Math.max(0, star.outerRadius);
  const rIn = Math.max(0, star.innerRadius);
  const cx = star.x;
  const cy = star.y;
  const totalVertices = p * 2;
  const vertices: Vector2D[] = new Array(totalVertices);
  const startAngle = -Math.PI / 2;
  const step = Math.PI / p;

  for (let i = 0; i < totalVertices; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}

/**
 * Calcula los vértices finales de una Estrella regular aplicando su rotación.
 */
export function getStarVertices(star: Star): Vector2D[] {
  const p = Math.max(3, Math.round(star.points || 3));
  const rOut = Math.max(0, star.outerRadius);
  const rIn = Math.max(0, star.innerRadius);
  const cx = star.x;
  const cy = star.y;
  const rotRad = ((star.rotation ?? 0) * Math.PI) / 180;
  const startAngle = -Math.PI / 2 + rotRad;
  const step = Math.PI / p;
  const totalVertices = p * 2;
  const vertices: Vector2D[] = new Array(totalVertices);

  for (let i = 0; i < totalVertices; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const angle = startAngle + i * step;
    vertices[i] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  return vertices;
}
