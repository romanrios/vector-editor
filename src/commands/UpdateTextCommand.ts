import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la edición del contenido de un nodo Text en el Scene Graph,
 * almacenando su contenido previo y posterior para permitir deshacer (undo) y rehacer (redo).
 */
export class UpdateTextCommand implements Command {
  public readonly name: string = 'UpdateTextCommand';
  private readonly stateManager: StateManager;
  public readonly textId: string;
  public readonly previousText: string;
  public readonly newText: string;

  public get shapeId(): string {
    return this.textId;
  }

  public get isAlreadyAtTarget(): boolean {
    return this.previousText === this.newText;
  }

  constructor(
    stateManager: StateManager,
    textId: string,
    previousText: string,
    newText: string
  ) {
    this.stateManager = stateManager;
    this.textId = textId;
    this.previousText = previousText;
    this.newText = newText;
  }

  /**
   * Aplica el nuevo contenido de texto al nodo Text (rehacer/redo).
   */
  public execute(): void {
    this.stateManager.updateShape<Text>(this.textId, { text: this.newText });
  }

  /**
   * Restaura el contenido de texto previo al nodo Text (deshacer/undo).
   */
  public undo(): void {
    this.stateManager.updateShape<Text>(this.textId, { text: this.previousText });
  }
}
