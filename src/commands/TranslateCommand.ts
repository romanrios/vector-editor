import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';

export interface TranslateCommandOptions {
  timestamp?: number;
  mergeTimeout?: number;
}

/**
 * Comando que traslada (mueve) una figura en el Scene Graph entre dos coordenadas.
 * Soporta ejecución (redo), reversión (undo) y fusión consecutiva en un intervalo temporal corto.
 */
export class TranslateCommand implements Command {
  public readonly name: string = 'TranslateCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly fromX: number;
  public readonly fromY: number;
  public toX: number;
  public toY: number;
  public timestamp: number;
  public readonly mergeTimeout: number;

  constructor(
    stateManager: StateManager,
    shapeId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    timestampOrOptions?: number | TranslateCommandOptions,
    mergeTimeout?: number
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;

    if (typeof timestampOrOptions === 'object' && timestampOrOptions !== null) {
      this.timestamp = timestampOrOptions.timestamp ?? Date.now();
      this.mergeTimeout = timestampOrOptions.mergeTimeout ?? 400;
    } else {
      this.timestamp = typeof timestampOrOptions === 'number' ? timestampOrOptions : Date.now();
      this.mergeTimeout = typeof mergeTimeout === 'number' ? mergeTimeout : 400;
    }
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

  /**
   * Fusiona un comando de traslación subsiguiente si es para la misma figura,
   * parte de la posición actual de destino, y ocurrió dentro del intervalo mergeTimeout.
   */
  public mergeWith(nextCommand: Command): boolean {
    if (!(nextCommand instanceof TranslateCommand)) {
      return false;
    }

    if (nextCommand.shapeId !== this.shapeId) {
      return false;
    }

    if (this.mergeTimeout <= 0) {
      return false;
    }

    const elapsed = nextCommand.timestamp - this.timestamp;
    if (elapsed < 0 || elapsed > this.mergeTimeout) {
      return false;
    }

    if (nextCommand.fromX !== this.toX || nextCommand.fromY !== this.toY) {
      return false;
    }

    this.toX = nextCommand.toX;
    this.toY = nextCommand.toY;
    this.timestamp = nextCommand.timestamp;
    return true;
  }
}
