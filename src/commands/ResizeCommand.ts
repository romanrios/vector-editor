import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { PathPoint } from '../types/scene-graph.ts';

/**
 * Representa las dimensiones espaciales, radios y/o puntos de una figura en el Scene Graph.
 */
export interface ShapeDimensions {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly radiusX?: number;
  readonly radiusY?: number;
  readonly points?: readonly PathPoint[];
}

/**
 * Comando que encapsula el redimensionado de una figura, almacenando
 * sus dimensiones iniciales y finales para permitir deshacer (undo) y rehacer (redo).
 */
export class ResizeCommand implements Command {
  public readonly name: string = 'ResizeCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly initialDimensions: ShapeDimensions;
  public readonly finalDimensions: ShapeDimensions;

  constructor(
    stateManager: StateManager,
    shapeId: string,
    initialDimensions: ShapeDimensions,
    finalDimensions: ShapeDimensions
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.initialDimensions = initialDimensions;
    this.finalDimensions = finalDimensions;
  }

  /**
   * Aplica las dimensiones finales (rehacer/redo).
   */
  public execute(): void {
    this.stateManager.updateShapeDimensions(this.shapeId, this.finalDimensions);
  }

  /**
   * Restaura las dimensiones iniciales (deshacer/undo).
   */
  public undo(): void {
    this.stateManager.updateShapeDimensions(this.shapeId, this.initialDimensions);
  }
}
