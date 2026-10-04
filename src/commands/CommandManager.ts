import type { Command } from './Command.ts';

export type HistoryListener = (undoCount: number, redoCount: number) => void;

/**
 * Gestor del historial de operaciones (Deshacer / Rehacer) mediante el patrón Command.
 */
export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxHistorySize: number;
  private listeners: Set<HistoryListener> = new Set();

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Ejecuta un comando y lo añade a la pila de deshacer, invalidando la pila de rehacer.
   *
   * @param command Comando a ejecutar
   * @param applyNow Si es true, invoca command.execute(). Si es false, asume que ya fue aplicado (ej: durante arrastre en vivo).
   */
  public executeCommand(command: Command, applyNow: boolean = true): void {
    if (command.isAlreadyAtTarget) {
      return;
    }

    if (applyNow) {
      command.execute();
    }

    if (this.undoStack.length > 0) {
      const lastCommand = this.undoStack[this.undoStack.length - 1];
      if (typeof lastCommand.mergeWith === 'function' && lastCommand.mergeWith(command)) {
        this.redoStack = [];
        this.notify();
        return;
      }
    }

    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    // Al registrar una nueva acción directa, se vacía la pila de rehacer
    this.redoStack = [];
    this.notify();
  }

  /**
   * Registra un comando en el historial sin volver a invocar execute()
   * (usado al finalizar transformaciones en tiempo real como arrastre).
   */
  public recordCommand(command: Command): void {
    this.executeCommand(command, false);
  }

  /**
   * Deshace el último comando ejecutado y lo coloca en la pila de rehacer.
   * Retorna true si se pudo deshacer, o false si la pila estaba vacía.
   */
  public undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }

    const command = this.undoStack.pop()!;
    command.undo();
    this.redoStack.push(command);

    this.notify();
    return true;
  }

  /**
   * Rehace el comando previamente deshecho y lo reinserta en la pila de deshacer.
   * Retorna true si se pudo rehacer, o false si la pila estaba vacía.
   */
  public redo(): boolean {
    if (!this.canRedo()) {
      return false;
    }

    const command = this.redoStack.pop()!;
    command.execute();
    this.undoStack.push(command);

    this.notify();
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get undoCount(): number {
    return this.undoStack.length;
  }

  public get redoCount(): number {
    return this.redoStack.length;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  public subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Alias de suscripción estilo Event Emitter para consistencia en la observabilidad de la UI.
   */
  public on(_event: 'change', listener: HistoryListener): () => void {
    return this.subscribe(listener);
  }

  /**
   * Remueve un listener registrado con on o subscribe.
   */
  public off(_event: 'change', listener: HistoryListener): void {
    this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.undoStack.length, this.redoStack.length);
    }
  }
}
