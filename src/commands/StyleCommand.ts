import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Shape } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la modificación de estilos (fill, stroke, strokeWidth, opacity, etc.)
 * de una figura en el Scene Graph, permitiendo deshacer (undo) y rehacer (redo).
 */
export class StyleCommand implements Command {
  public readonly name: string = 'StyleCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly initialStyles: Partial<Shape>;
  public readonly finalStyles: Partial<Shape>;

  constructor(
    stateManager: StateManager,
    shapeId: string,
    initialStyles: Partial<Shape>,
    finalStyles: Partial<Shape>
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.initialStyles = initialStyles;
    this.finalStyles = finalStyles;
  }

  /**
   * Aplica los estilos finales (rehacer/redo).
   */
  public execute(): void {
    this.stateManager.updateShape(this.shapeId, this.finalStyles);
  }

  /**
   * Restaura los estilos iniciales (deshacer/undo).
   */
  public undo(): void {
    this.stateManager.updateShape(this.shapeId, this.initialStyles);
  }
}
