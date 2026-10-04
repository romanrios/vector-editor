import type { Command } from './Command.ts';
import { TranslateCommand } from './TranslateCommand.ts';

/**
 * Comando compuesto que agrupa múltiples instancias de Command en una sola entrada del historial.
 * Ejecuta los comandos hijos en orden secuencial y los revierte en orden inverso.
 * Omite los comandos que ya se encuentren en el estado destino (isAlreadyAtTarget).
 * Si todos los comandos hijos están en destino, el lote completo se marca como isAlreadyAtTarget
 * para que CommandManager no lo registre.
 */
export class BatchCommand implements Command {
  public readonly name: string;
  public readonly commands: readonly Command[];

  constructor(commands: readonly Command[], name: string = 'BatchCommand') {
    this.name = name;
    const active = commands.filter((cmd) => !cmd.isAlreadyAtTarget);
    this.commands = Object.freeze([...active]);
  }

  /**
   * Indica si el lote completo carece de efectos (vacío o todos en destino).
   */
  public get isAlreadyAtTarget(): boolean {
    return this.commands.length === 0;
  }

  /**
   * Ejecuta todos los comandos del lote en orden secuencial.
   */
  public execute(): void {
    for (let i = 0; i < this.commands.length; i++) {
      this.commands[i].execute();
    }
  }

  /**
   * Revierte todos los comandos del lote en orden inverso.
   */
  public undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }

  /**
   * Fusiona este lote con otro lote subsiguiente si ambos contienen los mismos hijos
   * (mismo número, mismos IDs de figura y en el mismo orden), dentro de la ventana
   * de tiempo y condiciones de mergeWith de cada comando hijo (ej. TranslateCommand).
   */
  public mergeWith(nextCommand: Command): boolean {
    if (!(nextCommand instanceof BatchCommand)) {
      return false;
    }

    if (this.commands.length === 0 || nextCommand.commands.length !== this.commands.length) {
      return false;
    }

    // Validación preliminar sin mutaciones
    for (let i = 0; i < this.commands.length; i++) {
      const c1 = this.commands[i];
      const c2 = nextCommand.commands[i];

      if (typeof c1.mergeWith !== 'function') {
        return false;
      }

      // Validar coincidencia de IDs si los comandos exponen shapeId
      const shapeId1 = (c1 as any).shapeId;
      const shapeId2 = (c2 as any).shapeId;
      if (shapeId1 !== undefined || shapeId2 !== undefined) {
        if (shapeId1 !== shapeId2) {
          return false;
        }
      }

      // Si son TranslateCommand, verificar ventana de tiempo y continuidad de coordenadas
      if (c1 instanceof TranslateCommand && c2 instanceof TranslateCommand) {
        if (c1.mergeTimeout <= 0) {
          return false;
        }
        const elapsed = c2.timestamp - c1.timestamp;
        if (elapsed < 0 || elapsed > c1.mergeTimeout) {
          return false;
        }
        if (c2.fromX !== c1.toX || c2.fromY !== c1.toY) {
          return false;
        }
      }
    }

    // Fusión efectiva hijo a hijo
    let allMerged = true;
    for (let i = 0; i < this.commands.length; i++) {
      const merged = this.commands[i].mergeWith!(nextCommand.commands[i]);
      if (!merged) {
        allMerged = false;
        break;
      }
    }

    return allMerged;
  }
}
