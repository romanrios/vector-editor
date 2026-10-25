/**
 * Fachada principal del subsistema de geometría de Vectedit.
 * Re-exporta de forma modular todas las funciones y tipos puros geométricos
 * divididos en submódulos especializados dentro de ./geometry/.
 */

export * from './geometry/bezier.ts';
export * from './geometry/vertices.ts';
export * from './geometry/textMetrics.ts';
export * from './geometry/aabb.ts';
export * from './geometry/snapping.ts';
export * from './geometry/handles.ts';
export * from './geometry/transformBox.ts';
export * from './geometry/alignment.ts';
export * from './geometry/pathTopology.ts';
export * from './geometry/hitTest.ts';
