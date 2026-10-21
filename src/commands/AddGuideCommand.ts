import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Guide } from '../types/scene-graph.ts';

/**
 * Comando que encapsula la adición de una guía de usuario al documento.
 */
export class AddGuideCommand implements Command {
  public readonly name: string = 'AddGuideCommand';
  private readonly stateManager: StateManager;
  public readonly guide: Guide;

  constructor(stateManager: StateManager, guide: Guide) {
    this.stateManager = stateManager;
    this.guide = Object.freeze({ ...guide });
  }

  public execute(): void {
    this.stateManager.addGuide(this.guide);
  }

  public undo(): void {
    this.stateManager.removeGuide(this.guide.id);
  }
}
