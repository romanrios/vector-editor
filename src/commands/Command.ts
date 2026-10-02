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
   * Aplica o rehace la acción del comando sobre el estado.
   */
  execute(): void;

  /**
   * Revierte la acción del comando restaurando el estado previo.
   */
  undo(): void;
}
