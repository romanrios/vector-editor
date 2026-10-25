import type {
  Document,
  ParentNode,
  SceneNode,
  BlendMode,
  DropShadow,
  FillType,
  StrokeLineCap,
  StrokeLineJoin,
} from '../../types/scene-graph.ts';
import type { ShapeDimensions } from '../../commands/ResizeCommand.ts';

export type StateListener = (state: Readonly<Document>) => void;

export interface ShapePositionEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ShapeDimensionsEntry {
  readonly id: string;
  readonly dimensions: ShapeDimensions;
}

export interface ShapeStyleUpdate {
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly blendMode?: BlendMode;
  readonly dropShadow?: DropShadow | null;
  readonly strokeDashArray?: readonly number[];
  readonly strokeLineCap?: StrokeLineCap;
  readonly strokeLineJoin?: StrokeLineJoin;
}

export interface ShapeStyleEntry {
  readonly id: string;
  readonly style: ShapeStyleUpdate;
}

export interface DocumentIndex {
  readonly nodeMap: Map<string, SceneNode>;
  readonly parentMap: Map<string, ParentNode>;
}

export interface DrawingStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  blendMode?: BlendMode;
  dropShadow?: DropShadow | null;
  strokeDashArray?: readonly number[];
  strokeLineCap?: StrokeLineCap;
  strokeLineJoin?: StrokeLineJoin;
}
