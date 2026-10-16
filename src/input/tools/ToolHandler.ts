import type { Vector2D } from '../../types/scene-graph.ts';
import type { ToolMode } from '../InputController.ts';

export interface ToolHandler {
  onMouseDown?(event: MouseEvent, coords: Vector2D): void;
  onMouseMove?(event: MouseEvent, coords: Vector2D): void;
  onMouseUp?(event: MouseEvent, coords: Vector2D): void;
  onDoubleClick?(event: MouseEvent, coords: Vector2D): void;
  onKeyDown?(event: KeyboardEvent): boolean;
  onKeyUp?(event: KeyboardEvent): boolean;
  onActivate?(): void;
  onDeactivate?(nextTool: ToolMode): void;
  destroy?(): void;
}
