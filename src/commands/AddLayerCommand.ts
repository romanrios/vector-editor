import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Layer } from '../types/scene-graph.ts';

/**
 * Contador global de capas para generar nombres amigables secuenciales.
 */
let globalLayerCounter = 1;

/**
 * Comando para añadir una nueva capa al Documento.
 * Es completamente reversible con Undo y Redo.
 */
export class AddLayerCommand implements Command {
  public readonly name: string = 'AddLayerCommand';
  private readonly stateManager: StateManager;
  public readonly layer: Layer;
  public readonly index?: number;
  private readonly previousActiveLayerId: string;

  constructor(stateManager: StateManager, layerOrName?: Layer | string, index?: number) {
    this.stateManager = stateManager;
    this.index = index;
    this.previousActiveLayerId = stateManager.getActiveLayerId();

    if (typeof layerOrName === 'object' && layerOrName !== null && layerOrName.type === 'layer') {
      this.layer = layerOrName;
    } else {
      const doc = stateManager.getState();
      globalLayerCounter++;
      const name = typeof layerOrName === 'string' && layerOrName.trim()
        ? layerOrName.trim()
        : `Capa ${Math.max(doc.children.length + 1, globalLayerCounter)}`;

      this.layer = {
        id: `layer-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        type: 'layer',
        name,
        visible: true,
        locked: false,
        children: [],
      };
    }
  }

  public execute(): void {
    this.stateManager.addLayer(this.layer, this.index);
    this.stateManager.setActiveLayerId(this.layer.id);
  }

  public undo(): void {
    this.stateManager.removeLayer(this.layer.id);
    if (this.previousActiveLayerId) {
      this.stateManager.setActiveLayerId(this.previousActiveLayerId);
    }
  }

  public redo(): void {
    this.stateManager.addLayer(this.layer, this.index);
    this.stateManager.setActiveLayerId(this.layer.id);
  }
}
