import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Layer } from '../types/scene-graph.ts';
import { isLayer } from '../types/scene-graph.ts';

/**
 * Comando para eliminar una capa del Documento.
 * Garantiza que nunca se elimine la última capa restante del documento.
 * Es completamente reversible con Undo y Redo, restaurando sus figuras hijas y estado previo.
 */
export class DeleteLayerCommand implements Command {
  public readonly name: string = 'DeleteLayerCommand';
  private readonly stateManager: StateManager;
  public readonly layerId: string;
  public readonly isAllowed: boolean;
  public readonly layerSnapshot: Layer | null;
  public readonly layerIndex: number;
  private readonly previousActiveLayerId: string;

  constructor(stateManager: StateManager, layerId: string) {
    this.stateManager = stateManager;
    this.layerId = layerId;

    const doc = stateManager.getState();
    const node = stateManager.findNode(layerId);

    // No se permite borrar si no existe, si no es Layer, o si es la única capa restante
    if (!node || !isLayer(node) || doc.children.length <= 1) {
      this.isAllowed = false;
      this.layerSnapshot = null;
      this.layerIndex = -1;
      this.previousActiveLayerId = '';
      return;
    }

    this.isAllowed = true;
    this.layerSnapshot = node;
    this.layerIndex = doc.children.findIndex((l) => l.id === layerId);
    this.previousActiveLayerId = stateManager.getActiveLayerId();
  }

  public execute(): void {
    if (!this.isAllowed || !this.layerSnapshot) {
      return;
    }

    const doc = this.stateManager.getState();
    const remainingLayers = doc.children.filter((l) => l.id !== this.layerId);
    this.stateManager.removeLayer(this.layerId);

    // Si la capa eliminada era la activa, asignar otra capa como activa
    if (this.stateManager.getActiveLayerId() === this.layerId && remainingLayers.length > 0) {
      const nextIndex = Math.min(this.layerIndex, remainingLayers.length - 1);
      this.stateManager.setActiveLayerId(remainingLayers[nextIndex].id);
    }
  }

  public undo(): void {
    if (!this.isAllowed || !this.layerSnapshot) {
      return;
    }

    this.stateManager.addLayer(this.layerSnapshot, this.layerIndex);
    if (this.previousActiveLayerId) {
      this.stateManager.setActiveLayerId(this.previousActiveLayerId);
    }
  }

  public redo(): void {
    this.execute();
  }
}
