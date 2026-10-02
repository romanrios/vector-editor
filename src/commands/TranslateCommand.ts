import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

/**
 * Comando que traslada (mueve) una figura en el Scene Graph entre dos coordenadas.
 * Soporta ejecución (redo) y reversión (undo).
 */
export class TranslateCommand implements Command {
  public readonly name: string = 'TranslateCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly fromX: number;
  public readonly fromY: number;
  public readonly toX: number;
  public readonly toY: number;

  constructor(
    stateManager: StateManager,
    shapeId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
  }

  /**
   * Mueve la figura a la nueva posición destino (toX, toY).
   */
  public execute(): void {
    this.stateManager.updateShapePosition(this.shapeId, this.toX, this.toY);
  }

  /**
   * Revierte el movimiento devolviendo la figura a su posición inicial (fromX, fromY).
   */
  public undo(): void {
    this.stateManager.updateShapePosition(this.shapeId, this.fromX, this.fromY);
  }
}
