import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text } from '../types/scene-graph.ts';

/**
 * Propiedades tipográficas y de contenido modificables en un nodo Text
 */
export type TextPropertyUpdate = Partial<
  Pick<Text, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'textAlign' | 'fill'>
>;

/**
 * Comando que encapsula la modificación de propiedades tipográficas
 * (familia, tamaño, peso, estilo, alineación, color, contenido) de un nodo Text
 * en el Scene Graph, permitiendo deshacer (undo) y rehacer (redo).
 */
export class UpdateTextTypographyCommand implements Command {
  public readonly name: string = 'UpdateTextTypographyCommand';
  private readonly stateManager: StateManager;
  public readonly textId: string;
  public readonly before: TextPropertyUpdate;
  public readonly after: TextPropertyUpdate;

  public get shapeId(): string {
    return this.textId;
  }

  public get isAlreadyAtTarget(): boolean {
    const keys = Object.keys(this.after) as (keyof TextPropertyUpdate)[];
    return (
      keys.length === 0 ||
      keys.every((k) => {
        const b = this.before[k];
        const a = this.after[k];
        if (k === 'fontWeight') {
          return String(b) === String(a);
        }
        return b === a;
      })
    );
  }

  constructor(
    stateManager: StateManager,
    textId: string,
    before: TextPropertyUpdate,
    after: TextPropertyUpdate
  ) {
    this.stateManager = stateManager;
    this.textId = textId;
    this.before = before;
    this.after = after;
  }

  /**
   * Aplica las nuevas propiedades tipográficas al nodo Text (rehacer/redo).
   */
  public execute(): void {
    this.stateManager.updateShape<Text>(this.textId, this.after);
  }

  /**
   * Restaura las propiedades tipográficas previas al nodo Text (deshacer/undo).
   */
  public undo(): void {
    this.stateManager.updateShape<Text>(this.textId, this.before);
  }
}
