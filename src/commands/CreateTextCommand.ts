import type { Command } from './Command.ts';
import type { StateManager } from '../state/StateManager.ts';
import type { Text } from '../types/scene-graph.ts';

export class CreateTextCommand implements Command {
  public readonly name = 'CreateTextCommand';
  public readonly shapeId: string;
  private readonly stateManager: StateManager;
  private readonly parentId: string;
  private shape: Text;

  constructor(
    stateManager: StateManager,
    parentId: string,
    text: Text
  ) {
    this.stateManager = stateManager;
    this.parentId = parentId;
    this.shape = text;
    this.shapeId = text.id;
  }

  public execute(): void {
    if (!this.stateManager.findNode(this.shape.id)) {
      this.stateManager.addNode(this.parentId, this.shape);
    }
  }

  public undo(): void {
    this.stateManager.removeFromSelection([this.shape.id]);
    this.stateManager.removeNode(this.shape.id);
  }

  public updateGeometry(x: number, boxWidth: number | undefined): void {
    const { boxWidth: _previousWidth, ...shapeWithoutWidth } = this.shape;
    this.shape = {
      ...shapeWithoutWidth,
      x,
      textKind: boxWidth === undefined ? 'point' : 'area',
      ...(boxWidth === undefined ? {} : { boxWidth }),
    };
    if (!this.stateManager.updateShape<Text>(this.shape.id, () => this.shape)) {
      throw new Error(`No se pudo actualizar la geometría del texto ${this.shape.id}.`);
    }
  }
}
