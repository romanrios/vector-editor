import type { Command } from './Command.ts';
import type { StateManager, ShapeStyleEntry, ShapeStyleUpdate } from '../state/StateManager.ts';

/**
 * Entrada que contiene los estilos previos y posteriores para una figura identificada por su ID.
 */
export interface ShapeStyleChangeEntry {
  readonly id: string;
  readonly before: ShapeStyleUpdate;
  readonly after: ShapeStyleUpdate;
}

import { isPaintEqual } from '../state/StateManager.ts';

/**
 * Compara dos objetos ShapeStyleUpdate para verificar si son idénticos.
 */
function areStylesEqual(a: ShapeStyleUpdate, b: ShapeStyleUpdate): boolean {
  if (a === b) return true;
  if (!isPaintEqual(a.fill, b.fill)) return false;
  if (a.stroke !== b.stroke) return false;
  if (a.strokeWidth !== b.strokeWidth) return false;
  if (a.opacity !== b.opacity) return false;
  if (a.blendMode !== b.blendMode) return false;
  if (a.strokeLineCap !== b.strokeLineCap) return false;
  if (a.strokeLineJoin !== b.strokeLineJoin) return false;
  const dashA = a.strokeDashArray ?? [];
  const dashB = b.strokeDashArray ?? [];
  if (dashA.length !== dashB.length) return false;
  for (let i = 0; i < dashA.length; i++) {
    if (dashA[i] !== dashB[i]) return false;
  }
  return true;
}

/**
 * Comando que encapsula la modificación de estilos (fill, stroke, strokeWidth, opacity)
 * sobre múltiples figuras o una sola figura, permitiendo deshacer y rehacer.
 * execute() y undo() realizan una sola llamada a StateManager.updateShapesStyle().
 */
export class StyleShapesCommand implements Command {
  public readonly name: string = 'StyleShapesCommand';
  private readonly stateManager: StateManager;
  public readonly entries: readonly ShapeStyleChangeEntry[];

  constructor(
    stateManager: StateManager,
    entries: readonly ShapeStyleChangeEntry[]
  ) {
    this.stateManager = stateManager;
    this.entries = entries;
  }

  /**
   * Indica si las figuras ya están en los estilos destino (no hubo cambio).
   * Si es true, CommandManager omite registrar el comando en el historial.
   */
  public get isAlreadyAtTarget(): boolean {
    if (!this.entries || this.entries.length === 0) {
      return true;
    }
    return this.entries.every((entry) => areStylesEqual(entry.before, entry.after));
  }

  /**
   * Aplica los estilos posteriores (after) a todas las figuras en una sola llamada.
   */
  public execute(): void {
    const afterEntries: ShapeStyleEntry[] = this.entries.map((e) => ({
      id: e.id,
      style: e.after,
    }));
    this.stateManager.updateShapesStyle(afterEntries);
  }

  /**
   * Restaura los estilos anteriores (before) a todas las figuras en una sola llamada.
   */
  public undo(): void {
    const beforeEntries: ShapeStyleEntry[] = this.entries.map((e) => ({
      id: e.id,
      style: e.before,
    }));
    this.stateManager.updateShapesStyle(beforeEntries);
  }
}
