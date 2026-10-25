import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando que encapsula el redimensionado de la Mesa de Trabajo / Documento,
 * almacenando sus dimensiones iniciales y finales para permitir deshacer (undo) y rehacer (redo).
 */
export class ResizeArtboardCommand implements Command {
  public readonly name: string = 'ResizeArtboardCommand';
  private readonly stateManager: StateManager;
  public readonly initialWidth: number;
  public readonly initialHeight: number;
  public readonly finalWidth: number;
  public readonly finalHeight: number;
  public readonly artboardId?: string;

  constructor(
    stateManager: StateManager,
    initialWidth: number,
    initialHeight: number,
    finalWidth: number,
    finalHeight: number,
    artboardId?: string
  ) {
    this.stateManager = stateManager;
    this.initialWidth = initialWidth;
    this.initialHeight = initialHeight;
    this.finalWidth = finalWidth;
    this.finalHeight = finalHeight;
    this.artboardId = artboardId;
  }

  /**
   * Aplica las dimensiones finales (rehacer/redo).
   */
  public execute(): void {
    if (this.artboardId) {
      this.stateManager.updateArtboard(this.artboardId, {
        width: this.finalWidth,
        height: this.finalHeight,
      });
    } else {
      this.stateManager.setDocumentSize(this.finalWidth, this.finalHeight);
    }
  }

  /**
   * Restaura las dimensiones iniciales (deshacer/undo).
   */
  public undo(): void {
    if (this.artboardId) {
      this.stateManager.updateArtboard(this.artboardId, {
        width: this.initialWidth,
        height: this.initialHeight,
      });
    } else {
      this.stateManager.setDocumentSize(this.initialWidth, this.initialHeight);
    }
  }
}
