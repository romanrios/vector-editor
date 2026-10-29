import type {
  AABB,
  Gradient,
  Guide,
  Shape,
  Vector2D,
} from '../../../types/scene-graph.ts';
import type { HandleType } from '../../../utils/geometry.ts';
import type { CornerRadiusHandle } from '../../../utils/cornerSmoothing.ts';


export interface MultiTransformState {
  type: 'scale' | 'rotate';
  leafShapes: readonly Shape[];
  initialBounds: AABB;
  anchorOrPivot: Vector2D;
  startMouse: Vector2D;
  lastMouse: Vector2D;
  handle?: HandleType;
}

export interface SelectToolHandlerOptions {
  deselectOnEmptyClick?: boolean;
  isTouch?: () => boolean;
  isRatioLocked?: () => boolean;
}

export interface GradientDragState {
  readonly shapeId: string;
  readonly property: 'fill' | 'stroke';
  readonly initialGradient: Gradient;
  currentGradient: Gradient;
  readonly handleType: 'gradient-start' | 'gradient-end' | 'gradient-center' | 'gradient-radius' | 'gradient-stop';
  readonly stopId?: string;
  readonly startMouse: Vector2D;
}

export interface CornerRadiusDragState {
  readonly handle: CornerRadiusHandle;
  readonly shapeId: string;
  readonly initialRadius: number;
  readonly startMouse: Vector2D;
}

export interface GuideDragState {
  readonly guide: Guide;
  readonly initialPosition: number;
  currentPosition: number;
}
