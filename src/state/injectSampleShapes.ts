import type { Ellipse, Layer, Rectangle, Shape } from '../types/scene-graph.ts';
import type { StateManager } from './StateManager.ts';

/**
 * 3 figuras de prueba predefinidas (hardcodeadas) para verificar y poblar el Scene Graph.
 */
export const SAMPLE_SHAPES: readonly [Rectangle, Ellipse, Ellipse] = [
  {
    id: 'shape-rect-1',
    type: 'rectangle',
    name: 'Rectángulo Primario',
    x: 80,
    y: 100,
    width: 260,
    height: 140,
    fill: '#4F46E5', // Indigo
    stroke: '#312E81',
    strokeWidth: 3,
    cornerRadius: 12,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  },
  {
    id: 'shape-ellipse-1',
    type: 'ellipse',
    name: 'Círculo de Acento',
    x: 450,
    y: 170,
    radiusX: 70,
    radiusY: 70,
    fill: '#EC4899', // Pink
    stroke: '#9D174D',
    strokeWidth: 2,
    rotation: 0,
    opacity: 0.95,
    visible: true,
    locked: false,
  },
  {
    id: 'shape-ellipse-2',
    type: 'ellipse',
    name: 'Elipse Inclinada',
    x: 280,
    y: 320,
    radiusX: 130,
    radiusY: 55,
    fill: '#10B981', // Emerald
    stroke: '#047857',
    strokeWidth: 2,
    rotation: 25,
    opacity: 0.85,
    visible: true,
    locked: false,
  },
];

/**
 * Inyecta 3 figuras de prueba hardcodeadas en el estado inmutable del StateManager.
 * Si no se especifica una capa de destino, se utiliza la primera capa disponible
 * o se crea una automáticamente.
 *
 * @param stateManager Instancia del StateManager donde se inyectarán las figuras
 * @param targetLayerId ID de la capa de destino (opcional)
 * @returns Array con las 3 figuras agregadas
 */
export function injectSampleShapes(
  stateManager: StateManager,
  targetLayerId?: string
): readonly Shape[] {
  let layerId = targetLayerId;

  // Si no se proveyó una capa, seleccionamos la primera o creamos una por defecto
  if (!layerId) {
    const currentState = stateManager.getState();
    if (currentState.children.length > 0) {
      layerId = currentState.children[0].id;
    } else {
      layerId = 'layer-default';
      const defaultLayer: Layer = {
        id: layerId,
        type: 'layer',
        name: 'Capa Inicial',
        visible: true,
        locked: false,
        children: [],
      };
      stateManager.addLayer(defaultLayer);
    }
  }

  // Inyectamos las 3 figuras hardcodeadas de forma secuencial en el estado inmutable
  for (const shape of SAMPLE_SHAPES) {
    stateManager.addShape(layerId, shape);
  }

  return SAMPLE_SHAPES;
}
