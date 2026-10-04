import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import { isGroup, isLayer } from '../types/scene-graph.ts';

export type ReorderOperation = 'bringToFront' | 'sendToBack' | 'front' | 'back';

/**
 * Comando que encapsula el cambio en el orden de apilado (z-order) de una figura o grupo
 * dentro de su capa o grupo contenedor, permitiendo traer al frente o enviar al fondo,
 * y restaurar con precisión absoluta su posición previa al deshacer (undo).
 */
export class ReorderCommand implements Command {
  public readonly name: string = 'ReorderCommand';
  private readonly stateManager: StateManager;
  public readonly shapeId: string;
  public readonly operation: 'bringToFront' | 'sendToBack';
  public readonly parentId: string;
  public readonly layerId: string;
  public readonly originalIndex: number;
  public readonly isAlreadyAtTarget: boolean;

  /**
   * Alias de conveniencia para determinar si la acción es inocua (ya está en el extremo).
   */
  public get isNoop(): boolean {
    return this.isAlreadyAtTarget;
  }

  constructor(
    stateManager: StateManager,
    shapeId: string,
    operation: ReorderOperation,
    originalIndex?: number
  ) {
    this.stateManager = stateManager;
    this.shapeId = shapeId;
    this.operation =
      operation === 'front' || operation === 'bringToFront' ? 'bringToFront' : 'sendToBack';

    const parent = this.stateManager.findParent(this.shapeId);
    if (parent && (isLayer(parent) || isGroup(parent))) {
      this.parentId = parent.id;
      this.layerId = parent.id;
      const foundIndex = parent.children.findIndex((s) => s.id === this.shapeId);
      this.originalIndex = originalIndex !== undefined ? originalIndex : foundIndex;
      const count = parent.children.length;

      if (this.originalIndex === -1) {
        this.isAlreadyAtTarget = true;
      } else if (this.operation === 'bringToFront') {
        this.isAlreadyAtTarget = this.originalIndex === count - 1;
      } else {
        this.isAlreadyAtTarget = this.originalIndex === 0;
      }
    } else {
      this.parentId = '';
      this.layerId = '';
      this.originalIndex = originalIndex !== undefined ? originalIndex : -1;
      this.isAlreadyAtTarget = true;
    }
  }

  /**
   * Aplica traer al frente o enviar al fondo sobre el elemento indicado.
   */
  public execute(): void {
    if (this.isAlreadyAtTarget || !this.parentId) {
      return;
    }

    if (this.operation === 'bringToFront') {
      this.stateManager.bringToFront(this.shapeId);
    } else {
      this.stateManager.sendToBack(this.shapeId);
    }
  }

  /**
   * Restaura exactamente la posición anterior del elemento en su contenedor
   * utilizando el índice original capturado en el momento de creación.
   */
  public undo(): void {
    if (this.isAlreadyAtTarget || !this.parentId || this.originalIndex === -1) {
      return;
    }

    const parent = this.stateManager.findParent(this.shapeId);
    if (!parent || (!isLayer(parent) && !isGroup(parent))) {
      return;
    }

    const currentIndex = parent.children.findIndex((s) => s.id === this.shapeId);
    if (currentIndex === -1 || currentIndex === this.originalIndex) {
      return;
    }

    this.stateManager.reorderNodes(this.parentId, currentIndex, this.originalIndex);
  }
}
