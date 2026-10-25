import type {
  FillType,
  StrokeLineCap,
  StrokeLineJoin,
  BlendMode,
  DropShadow,
  GradientStop,
  PathPoint,
  Vector2D,
  LayerChildNode,
} from '../../types/scene-graph.ts';

export interface SvgRawGradient {
  id: string;
  type: 'linear' | 'radial';
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox';
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  r?: number;
  fx?: number;
  fy?: number;
  transformMatrix?: [number, number, number, number, number, number];
  stops: GradientStop[];
  href?: string;
}

export interface SvgImportResult {
  readonly success: boolean;
  readonly shapes: readonly LayerChildNode[];
  readonly width: number;
  readonly height: number;
  readonly error?: string;
}

export interface SvgSubpath {
  readonly points: PathPoint[];
  readonly closed: boolean;
}

export interface SvgPathParseResult {
  readonly points: PathPoint[];
  readonly closed: boolean;
  readonly subpaths: readonly SvgSubpath[];
}

export interface BezierSegment {
  readonly cp1: Vector2D;
  readonly cp2: Vector2D;
  readonly to: Vector2D;
}

export interface SvgContext {
  fill?: FillType | SvgRawGradient;
  stroke?: FillType | SvgRawGradient;
  strokeWidth?: number;
  strokeLineCap?: StrokeLineCap;
  strokeLineJoin?: StrokeLineJoin;
  strokeDashArray?: readonly number[];
  opacity?: number;
  blendMode?: BlendMode;
  dropShadow?: DropShadow;
  fillRule?: 'nonzero' | 'evenodd';
  transformMatrix?: [number, number, number, number, number, number];
}

export interface CssRule {
  readonly selector: string;
  readonly styles: Record<string, string>;
}

export interface SvgElementLike {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly children: ArrayLike<SvgElementLike>;
  readonly textContent?: string | null;
  ownerDocument?: {
    getElementById(id: string): SvgElementLike | null;
  };
  querySelectorAll?(selector: string): SvgElementLike[];
  querySelector?(selector: string): SvgElementLike | null;
}

let idCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}
