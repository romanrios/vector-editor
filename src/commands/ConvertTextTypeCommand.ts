import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text, TextKind } from '../types/scene-graph.ts';
import { measureTextWidth, getWrappedTextLines } from '../utils/geometry.ts';

/**
 * Comando que encapsula la conversión bidireccional entre Texto de Punto (Point Type)
 * y Texto de Área (Area Type) al estilo de Adobe Illustrator.
 *
 * - Punto a Área: fija boxWidth al ancho actual medido del texto y establece textKind = 'area'.
 * - Área a Punto: consolida las líneas envueltas automáticas en saltos de línea duros ('\n')
 *   para preservar con precisión el aspecto visual, elimina boxWidth y establece textKind = 'point'.
 */
export class ConvertTextTypeCommand implements Command {
  public readonly name: string = 'ConvertTextTypeCommand';
  private readonly stateManager: StateManager;
  public readonly textId: string;
  public readonly targetKind: TextKind;

  public readonly beforeTextKind: TextKind;
  public readonly beforeBoxWidth: number | undefined;
  public readonly beforeText: string;

  public readonly afterTextKind: TextKind;
  public readonly afterBoxWidth: number | undefined;
  public readonly afterText: string;

  constructor(
    stateManager: StateManager,
    textId: string,
    targetKind: TextKind,
    ctx?: CanvasRenderingContext2D | null
  ) {
    this.stateManager = stateManager;
    this.textId = textId;
    this.targetKind = targetKind;

    const node = stateManager.findNode(textId) as Text;
    this.beforeTextKind =
      node.textKind ?? (typeof node.boxWidth === 'number' && node.boxWidth > 0 ? 'area' : 'point');
    this.beforeBoxWidth = node.boxWidth;
    this.beforeText = node.text ?? '';

    this.afterTextKind = targetKind;

    if (targetKind === 'area') {
      const measured = Math.ceil(measureTextWidth(node, ctx));
      this.afterBoxWidth = Math.max(20, measured);
      this.afterText = node.text;
    } else {
      const lines = getWrappedTextLines(node, ctx);
      this.afterBoxWidth = undefined;
      this.afterText = lines.join('\n');
    }
  }

  public execute(): void {
    this.stateManager.updateShape<Text>(this.textId, (current) => {
      if (this.afterTextKind === 'area') {
        return {
          ...current,
          textKind: 'area',
          boxWidth: this.afterBoxWidth,
          text: this.afterText,
        };
      } else {
        const { boxWidth, boxHeight, ...rest } = current;
        return {
          ...rest,
          textKind: 'point',
          text: this.afterText,
        };
      }
    });
  }

  public undo(): void {
    this.stateManager.updateShape<Text>(this.textId, (current) => {
      if (this.beforeTextKind === 'area') {
        return {
          ...current,
          textKind: 'area',
          boxWidth: this.beforeBoxWidth,
          text: this.beforeText,
        };
      } else {
        const { boxWidth, boxHeight, ...rest } = current;
        return {
          ...rest,
          textKind: 'point',
          text: this.beforeText,
        };
      }
    });
  }
}
