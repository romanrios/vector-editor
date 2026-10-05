import type { Command } from './Command.ts';
import type { StateManager, ShapeDimensionsEntry } from '../state/StateManager.ts';
import type { ShapeDimensions } from './ResizeCommand.ts';

/**
 * Entrada que contiene las dimensiones previas y posteriores a una transformación
 * para una figura identificada por su ID.
 */
export interface ShapeTransformEntry {
  readonly id: string;
  readonly before: ShapeDimensions;
  readonly after: ShapeDimensions;
}

/**
 * Compara dos objetos ShapeDimensions para verificar si son geométricamente idénticos.
 */
function areDimensionsEqual(a: ShapeDimensions, b: ShapeDimensions): boolean {
  if (a === b) return true;
  if (a.x !== b.x) return false;
  if (a.y !== b.y) return false;
  if (a.width !== b.width) return false;
  if (a.height !== b.height) return false;
  if (a.radiusX !== b.radiusX) return false;
  if (a.radiusY !== b.radiusY) return false;
  if (a.rotation !== b.rotation) return false;

  if (a.points !== b.points) {
    if (!a.points || !b.points) return false;
    if (a.points.length !== b.points.length) return false;
    for (let i = 0; i < a.points.length; i++) {
      const p1 = a.points[i];
      const p2 = b.points[i];
      if (p1.x !== p2.x || p1.y !== p2.y) return false;
      if (p1.handleIn?.x !== p2.handleIn?.x || p1.handleIn?.y !== p2.handleIn?.y) return false;
      if (p1.handleOut?.x !== p2.handleOut?.x || p1.handleOut?.y !== p2.handleOut?.y) return false;
    }
  }

  return true;
}

/**
 * Comando que encapsula la transformación (escalado y/o rotación) de un conjunto de figuras
 * (grupo o múltiples figuras seleccionadas). Guarda { id, before, after } por figura.
 * execute() y undo() realizan una sola llamada atómica a StateManager.updateShapesDimensions().
 */
export class TransformShapesCommand implements Command {
  public readonly name: string = 'TransformShapesCommand';
  private readonly stateManager: StateManager;
  public readonly entries: readonly ShapeTransformEntry[];

  constructor(
    stateManager: StateManager,
    entries: readonly ShapeTransformEntry[]
  ) {
    this.stateManager = stateManager;
    this.entries = entries;
  }

  /**
   * Indica si las figuras ya están en las dimensiones destino (no hubo cambio geométrico).
   * Si es true, CommandManager omite registrar el comando en el historial.
   */
  public get isAlreadyAtTarget(): boolean {
    if (!this.entries || this.entries.length === 0) {
      return true;
    }
    return this.entries.every((entry) => areDimensionsEqual(entry.before, entry.after));
  }

  /**
   * Aplica las dimensiones posteriores (after) a todas las figuras en una sola llamada.
   */
  public execute(): void {
    const afterEntries: ShapeDimensionsEntry[] = this.entries.map((e) => ({
      id: e.id,
      dimensions: e.after,
    }));
    this.stateManager.updateShapesDimensions(afterEntries);
  }

  /**
   * Restaura las dimensiones anteriores (before) a todas las figuras en una sola llamada.
   */
  public undo(): void {
    const beforeEntries: ShapeDimensionsEntry[] = this.entries.map((e) => ({
      id: e.id,
      dimensions: e.before,
    }));
    this.stateManager.updateShapesDimensions(beforeEntries);
  }
}
