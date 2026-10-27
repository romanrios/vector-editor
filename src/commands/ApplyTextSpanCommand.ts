import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text, TextSpan } from '../types/scene-graph.ts';
import { applySpanToRange } from '../utils/textSpans.ts';

/**
 * Comando que encapsula la aplicación de estilos tipográficos a un tramo o rango
 * específico de caracteres (Rich Text / Spans) dentro de un nodo Text.
 *
 * Permite deshacer (undo) y rehacer (redo) preservando exactamente los spans previos y posteriores.
 */
export class ApplyTextSpanCommand implements Command {
  public readonly name: string = 'ApplyTextSpanCommand';
  private readonly stateManager: StateManager;
  public readonly textId: string;
  public readonly range: { start: number; end: number };
  public readonly patch: Partial<Omit<TextSpan, 'start' | 'end'>>;
  public readonly beforeSpans?: readonly TextSpan[];
  public readonly afterSpans?: readonly TextSpan[];

  public get shapeId(): string {
    return this.textId;
  }

  public get isAlreadyAtTarget(): boolean {
    return JSON.stringify(this.beforeSpans ?? null) === JSON.stringify(this.afterSpans ?? null);
  }

  constructor(
    stateManager: StateManager,
    textId: string,
    rangeOrStart: { start: number; end: number } | number,
    endOrPatch: number | Partial<Omit<TextSpan, 'start' | 'end'>>,
    maybePatch?: Partial<Omit<TextSpan, 'start' | 'end'>>
  ) {
    this.stateManager = stateManager;
    this.textId = textId;
    if (typeof rangeOrStart === 'number') {
      this.range = { start: rangeOrStart, end: endOrPatch as number };
      this.patch = maybePatch!;
    } else {
      this.range = rangeOrStart;
      this.patch = endOrPatch as Partial<Omit<TextSpan, 'start' | 'end'>>;
    }

    const node = stateManager.findNode(textId) as Text;
    this.beforeSpans = node.spans ? [...node.spans] : undefined;
    const applied = applySpanToRange(this.beforeSpans, this.range, this.patch, node);
    this.afterSpans = applied.length > 0 ? applied : undefined;
  }

  public execute(): void {
    this.stateManager.updateShape<Text>(this.textId, { spans: this.afterSpans });
  }

  public undo(): void {
    this.stateManager.updateShape<Text>(this.textId, { spans: this.beforeSpans });
  }
}
