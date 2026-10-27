import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text, TextSpan } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la edición del contenido de un nodo Text en el Scene Graph,
 * almacenando su contenido y spans previos y posteriores para permitir deshacer (undo) y rehacer (redo).
 */
export class UpdateTextCommand implements Command {
  public readonly name: string = 'UpdateTextCommand';
  private readonly stateManager: StateManager;
  public readonly textId: string;
  public readonly previousText: string;
  public readonly newText: string;
  public readonly previousSpans?: readonly TextSpan[];
  public readonly newSpans?: readonly TextSpan[];

  public get shapeId(): string {
    return this.textId;
  }

  public get isAlreadyAtTarget(): boolean {
    const textSame = this.previousText === this.newText;
    const spansSame =
      this.previousSpans === this.newSpans ||
      JSON.stringify(this.previousSpans ?? []) === JSON.stringify(this.newSpans ?? []);
    return textSame && spansSame;
  }

  constructor(
    stateManager: StateManager,
    textId: string,
    previousText: string,
    newText: string,
    previousSpans?: readonly TextSpan[],
    newSpans?: readonly TextSpan[]
  ) {
    this.stateManager = stateManager;
    this.textId = textId;
    this.previousText = previousText;
    this.newText = newText;
    this.previousSpans = previousSpans;
    this.newSpans = newSpans;
  }

  /**
   * Aplica el nuevo contenido de texto y spans al nodo Text (rehacer/redo).
   */
  public execute(): void {
    const patch: Partial<Text> = this.newSpans !== undefined
      ? { text: this.newText, spans: this.newSpans }
      : { text: this.newText };
    this.stateManager.updateShape<Text>(this.textId, patch);
  }

  /**
   * Restaura el contenido de texto y spans previos al nodo Text (deshacer/undo).
   */
  public undo(): void {
    const patch: Partial<Text> = this.previousSpans !== undefined
      ? { text: this.previousText, spans: this.previousSpans }
      : { text: this.previousText };
    this.stateManager.updateShape<Text>(this.textId, patch);
  }
}
