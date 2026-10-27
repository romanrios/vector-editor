import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text } from '../types/scene-graph.ts';

export type TextCaseMode = 'uppercase' | 'lowercase' | 'titlecase';

/**
 * Transforma un texto a mayúsculas, minúsculas o tipo título
 */
export function applyTextCasing(str: string, mode: TextCaseMode): string {
  if (mode === 'uppercase') {
    return str.toUpperCase();
  }
  if (mode === 'lowercase') {
    return str.toLowerCase();
  }
  // Title case (primera letra de cada palabra en mayúscula)
  return str.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Comando para cambiar mayúsculas y minúsculas de un nodo Text con soporte Undo/Redo.
 */
export class ChangeTextCaseCommand implements Command {
  public readonly name: string = 'ChangeTextCaseCommand';
  private readonly stateManager: StateManager;
  public readonly textId: string;
  public readonly mode: TextCaseMode;
  public readonly beforeText: string;
  public readonly afterText: string;

  constructor(
    stateManager: StateManager,
    textId: string,
    mode: TextCaseMode
  ) {
    this.stateManager = stateManager;
    this.textId = textId;
    this.mode = mode;
    const node = stateManager.findNode(textId) as Text;
    this.beforeText = node.text ?? '';
    this.afterText = applyTextCasing(this.beforeText, mode);
  }

  public execute(): void {
    this.stateManager.updateShape<Text>(this.textId, { text: this.afterText });
  }

  public undo(): void {
    this.stateManager.updateShape<Text>(this.textId, { text: this.beforeText });
  }
}
