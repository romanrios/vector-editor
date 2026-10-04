/**
 * Interfaz fundamental del patrón de diseño Command.
 * Encapsula una acción ejecutable y su reversión correspondiente.
 */
export interface Command {
  /**
   * Nombre identificador o descripción legible del comando.
   */
  readonly name: string;

  /**
   * Identificador de la figura asociada al comando, si corresponde.
   */
  readonly shapeId?: string;

  /**
   * Indica si la figura ya se encuentra en el destino deseado antes de la ejecución.
   * Si es true, CommandManager omite registrar el comando en el historial.
   */
  readonly isAlreadyAtTarget?: boolean;

  /**
   * Aplica o rehace la acción del comando sobre el estado.
   */
  execute(): void;

  /**
   * Revierte la acción del comando restaurando el estado previo.
   */
  undo(): void;

  /**
   * Determina si este comando puede fusionarse con un comando subsiguiente
   * sin ejecutar mutaciones en el comando.
   */
  canMergeWith?(nextCommand: Command): boolean;

  /**
   * Intenta fusionar este comando con un comando subsiguiente.
   * Si retorna true, la fusión fue exitosa y CommandManager no creará una nueva entrada en el historial.
   */
  mergeWith?(nextCommand: Command): boolean;
}
