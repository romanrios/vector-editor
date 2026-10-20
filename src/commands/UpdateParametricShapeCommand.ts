import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Polygon, Star } from '../types/scene-graph.ts';

/**
 * Propiedades paramétricas modificables en un Polígono regular o Estrella
 */
export type ParametricShapeUpdate = Partial<
  Pick<Polygon, 'radius' | 'sides' | 'cornerRadius'> &
  Pick<Star, 'points' | 'outerRadius' | 'innerRadius' | 'cornerRadius' | 'innerCornerRadius'>
>;

/**
 * Comando reversible para modificar propiedades paramétricas de un Polígono o Estrella
 * (lados/radio de polígono, o puntas/radios exterior e interior de estrella)
 * en el Scene Graph, con soporte completo para Deshacer (undo) y Rehacer (redo).
 */
export class UpdateParametricShapeCommand implements Command {
  public readonly name: string = 'UpdateParametricShapeCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly before: ParametricShapeUpdate;
  public readonly after: ParametricShapeUpdate;

  public get isAlreadyAtTarget(): boolean {
    const keys = Object.keys(this.after) as (keyof ParametricShapeUpdate)[];
    return (
      keys.length === 0 ||
      keys.every((k) => this.before[k] === this.after[k])
    );
  }

  constructor(
    stateManager: StateManager,
    shapeId: string,
    before: ParametricShapeUpdate,
    after: ParametricShapeUpdate
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.before = before;
    this.after = after;
  }

  /**
   * Aplica las nuevas propiedades paramétricas (rehacer / redo).
   */
  public execute(): void {
    this.stateManager.updateShape(this.shapeId, this.after);
  }

  /**
   * Restaura las propiedades paramétricas previas (deshacer / undo).
   */
  public undo(): void {
    this.stateManager.updateShape(this.shapeId, this.before);
  }
}
