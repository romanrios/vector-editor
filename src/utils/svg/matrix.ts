import type { Vector2D } from '../../types/scene-graph.ts';

/**
 * Multiplica un punto por una matriz de transformación afín 2D [a, b, c, d, e, f].
 */
export function applyTransform(p: Vector2D, matrix?: [number, number, number, number, number, number]): Vector2D {
  if (!matrix) return p;
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  };
}

/**
 * Combina dos matrices afines 2D [a, b, c, d, e, f]
 */
export function multiplyMatrices(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Descompone una matriz de transformación afín en factores de escala y ángulo de rotación.
 */
export function decomposeMatrix(matrix?: [number, number, number, number, number, number]): {
  scaleX: number;
  scaleY: number;
  rotation: number;
} {
  if (!matrix) return { scaleX: 1, scaleY: 1, rotation: 0 };
  const [a, b, c, d] = matrix;
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  return { scaleX: scaleX || 1, scaleY: scaleY || 1, rotation };
}

/**
 * Parsea un atributo transform SVG soportando matrix, translate, scale, rotate, skewX, skewY encadenados.
 */
export function parseTransformAttr(transformStr: string | null): [number, number, number, number, number, number] | undefined {
  if (!transformStr) return undefined;
  const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let resultMatrix: [number, number, number, number, number, number] | undefined = undefined;

  while ((match = regex.exec(transformStr)) !== null) {
    const fn = match[1].toLowerCase();
    const args = match[2].trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
    let m: [number, number, number, number, number, number] | undefined;

    if (fn === 'matrix' && args.length >= 6) {
      m = [args[0], args[1], args[2], args[3], args[4], args[5]];
    } else if (fn === 'translate' && args.length >= 1) {
      m = [1, 0, 0, 1, args[0], args[1] ?? 0];
    } else if (fn === 'scale' && args.length >= 1) {
      m = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    } else if (fn === 'rotate' && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (args.length >= 3) {
        const cx = args[1];
        const cy = args[2];
        const t1: [number, number, number, number, number, number] = [1, 0, 0, 1, cx, cy];
        const r: [number, number, number, number, number, number] = [cos, sin, -sin, cos, 0, 0];
        const t2: [number, number, number, number, number, number] = [1, 0, 0, 1, -cx, -cy];
        m = multiplyMatrices(multiplyMatrices(t1, r), t2);
      } else {
        m = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === 'skewx' && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      m = [1, 0, Math.tan(rad), 1, 0, 0];
    } else if (fn === 'skewy' && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      m = [1, Math.tan(rad), 0, 1, 0, 0];
    }

    if (m) {
      resultMatrix = resultMatrix ? multiplyMatrices(resultMatrix, m) : m;
    }
  }

  return resultMatrix;
}
