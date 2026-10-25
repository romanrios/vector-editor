import type { StateManager } from '../../../state/StateManager.ts';
import type { CommandManager } from '../../../commands/CommandManager.ts';
import { isShape, type Shape, type Vector2D } from '../../../types/scene-graph.ts';
import { RotateCommand } from '../../../commands/RotateCommand.ts';
import { getShapeCentroid } from './resizeGeometry.ts';

export class RotateHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;

  private _isRotating: boolean = false;
  private rotatingShapeId: string | null = null;
  private initialRotation: number | null = null;
  private rotationAngleOffset: number = 0;
  private rotationCentroid: { x: number; y: number } | null = null;

  constructor(stateManager: StateManager, commandManager: CommandManager) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
  }

  public get isRotating(): boolean {
    return this._isRotating;
  }

  public get rotatingNodeId(): string | null {
    return this.rotatingShapeId;
  }

  public get initialRotateAngle(): number | null {
    return this.initialRotation;
  }

  public start(coords: Vector2D, selectedNode: Shape): void {
    this._isRotating = true;
    this.rotatingShapeId = selectedNode.id;
    this.initialRotation = selectedNode.rotation ?? 0;

    const centroid = getShapeCentroid(selectedNode);
    this.rotationCentroid = centroid;
    const clickAngle = (Math.atan2(coords.y - centroid.y, coords.x - centroid.x) * 180) / Math.PI;
    const expectedHandleAngle = this.initialRotation - 90;
    let offset = clickAngle - expectedHandleAngle;
    while (offset > 180) offset -= 360;
    while (offset <= -180) offset += 360;
    this.rotationAngleOffset = offset;
  }

  public update(coords: Vector2D, event: MouseEvent): boolean {
    if (!this._isRotating || !this.rotatingShapeId) {
      return false;
    }

    const rawNode = this.stateManager.findNode(this.rotatingShapeId) ?? this.stateManager.getSelectedNode();
    const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
    if (selectedShape) {
      const centroid = this.rotationCentroid ?? getShapeCentroid(selectedShape);
      const deltaX = coords.x - centroid.x;
      const deltaY = coords.y - centroid.y;
      const radians = Math.atan2(deltaY, deltaX);
      const mouseAngle = (radians * 180) / Math.PI;

      let degrees = mouseAngle - this.rotationAngleOffset + 90;
      if (event.shiftKey) {
        degrees = Math.round(degrees / 15) * 15;
      } else {
        degrees = Math.round(degrees);
      }
      while (degrees > 180) degrees -= 360;
      while (degrees <= -180) degrees += 360;

      this.stateManager.updateShape(this.rotatingShapeId, { rotation: degrees });
      return true;
    }

    return false;
  }

  public finish(): boolean {
    if (!this._isRotating) {
      return false;
    }

    if (this.rotatingShapeId && this.initialRotation !== null) {
      const rawNode = this.stateManager.findNode(this.rotatingShapeId) ?? this.stateManager.getSelectedNode();
      const selectedShape = rawNode && isShape(rawNode) ? rawNode : null;
      if (selectedShape) {
        const finalRotation = selectedShape.rotation ?? this.initialRotation;
        if (finalRotation !== this.initialRotation) {
          const command = new RotateCommand(
            this.stateManager,
            this.rotatingShapeId,
            this.initialRotation,
            finalRotation
          );
          this.commandManager.recordCommand(command);
        }
      }
    }

    this.reset();
    return true;
  }

  public handleEscape(): boolean {
    if (this._isRotating && this.rotatingShapeId && this.initialRotation !== null) {
      this.stateManager.updateShape(this.rotatingShapeId, { rotation: this.initialRotation });
      this.reset();
      this.stateManager.markDirty();
      return true;
    }
    return false;
  }

  public reset(): void {
    this._isRotating = false;
    this.rotatingShapeId = null;
    this.initialRotation = null;
    this.rotationAngleOffset = 0;
    this.rotationCentroid = null;
  }
}
