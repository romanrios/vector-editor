import type { Command } from './Command.ts';

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
   * Determina si este lote puede fusionarse con otro comando subsiguiente.
   * Verifica que el comando siguiente sea un BatchCommand con igual cantidad de comandos,
   * que los shapeId coincidan, y que cada comando hijo acepte la fusión mediante canMergeWith.
   */
  public canMergeWith(nextCommand: Command): boolean {
    if (!(nextCommand instanceof BatchCommand)) {
      return false;
    }

    if (this.commands.length === 0 || nextCommand.commands.length !== this.commands.length) {
      return false;
    }

    for (let i = 0; i < this.commands.length; i++) {
      const c1 = this.commands[i];
      const c2 = nextCommand.commands[i];

      if (typeof c1.mergeWith !== 'function') {
        return false;
      }

      // Validar coincidencia de IDs si los comandos exponen shapeId
      const shapeId1 = c1.shapeId;
      const shapeId2 = c2.shapeId;
      if (shapeId1 !== undefined || shapeId2 !== undefined) {
        if (shapeId1 !== shapeId2) {
          return false;
        }
      }

      // Delegar la validación al comando hijo si provee canMergeWith
      if (typeof c1.canMergeWith === 'function') {
        if (!c1.canMergeWith(c2)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Fusiona este lote con otro lote subsiguiente si ambos contienen los mismos hijos
   * y todos los hijos aceptan la fusión.
   * La validación completa se realiza previamente en canMergeWith para garantizar
   * que no quede ninguna fusión parcial si algún hijo rechaza.
   */
  public mergeWith(nextCommand: Command): boolean {
    if (!this.canMergeWith(nextCommand)) {
      return false;
    }

    const nextBatch = nextCommand as BatchCommand;

    // Fusión efectiva hijo a hijo
    for (let i = 0; i < this.commands.length; i++) {
      const merged = this.commands[i].mergeWith!(nextBatch.commands[i]);
      if (!merged) {
        return false;
      }
    }

    return true;
  }
}
