import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import type { InputController } from '../../input/InputController.ts';
import type {
  SelectableNode,
  FillType,
  FontStyle,
  FontWeight,
  TextAlign,
  StrokeLineCap,
  StrokeLineJoin,
  BlendMode,
  DropShadow,
} from '../../types/scene-graph.ts';
import type { AlignmentMode, DistributionAxis } from '../../utils/geometry.ts';
import type { BooleanOp } from '../../utils/booleanOperations.ts';

export interface PropertiesPanelControllerOptions {
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly inputController: InputController;
  readonly canvas: HTMLCanvasElement | null;
  readonly onSelectionChanged?: () => void;
  readonly onAlign?: (mode: AlignmentMode) => void;
  readonly onDistribute?: (axis: DistributionAxis) => void;
  readonly onPathfinder?: (op: BooleanOp) => void;
}

export interface PropertiesPanelController {
  readonly syncPropertiesPanel: (selectedNodes?: readonly SelectableNode[]) => void;
  readonly cleanup: () => void;
}

export interface StyleSnapshot {
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly blendMode?: BlendMode;
  readonly strokeDashArray?: readonly number[];
  readonly strokeLineCap?: StrokeLineCap;
  readonly strokeLineJoin?: StrokeLineJoin;
  readonly dropShadow?: DropShadow | null;
}

export interface TextTypographySnapshot {
  readonly text?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: FontWeight;
  readonly fontStyle?: FontStyle;
  readonly textAlign?: TextAlign;
  readonly fill?: FillType;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
}

export interface ParametricShapeSnapshot {
  readonly sides?: number;
  readonly radius?: number;
  readonly points?: number;
  readonly outerRadius?: number;
  readonly innerRadius?: number;
}

export interface PropertiesPanelElements {
  readonly panelTitle: HTMLElement | null;
  readonly noSelectionState: HTMLElement | null;
  readonly selectionState: HTMLElement | null;
  readonly sectionTransform: HTMLDetailsElement | null;
  readonly sectionAppearance: HTMLDetailsElement | null;
  readonly sectionArtboard: HTMLDetailsElement | null;
  readonly inputObjectX: HTMLInputElement | null;
  readonly inputObjectY: HTMLInputElement | null;
  readonly inputObjectWidth: HTMLInputElement | null;
  readonly inputObjectHeight: HTMLInputElement | null;
  readonly inputObjectRotation: HTMLInputElement | null;
  readonly groupCornerRadius: HTMLElement | null;
  readonly inputCornerRadius: HTMLInputElement | null;

  readonly inputFill: HTMLInputElement | null;
  readonly inputFillHex: HTMLInputElement | null;
  readonly btnFillNone: HTMLButtonElement | null;
  readonly swatchFillPreview: HTMLElement | null;

  readonly inputStroke: HTMLInputElement | null;
  readonly inputStrokeHex: HTMLInputElement | null;
  readonly btnStrokeNone: HTMLButtonElement | null;
  readonly swatchStrokePreview: HTMLElement | null;
  readonly inputStrokeWidth: HTMLInputElement | null;
  readonly selectStrokeDash: HTMLSelectElement | null;
  readonly selectStrokeCap: HTMLSelectElement | null;
  readonly selectStrokeJoin: HTMLSelectElement | null;
  readonly btnOutlineStroke: HTMLButtonElement | null;

  readonly inputOpacity: HTMLInputElement | null;
  readonly inputOpacityValue: HTMLInputElement | null;
  readonly selectBlendMode: HTMLSelectElement | null;

  readonly checkDropShadow: HTMLInputElement | null;
  readonly groupDropShadowControls: HTMLElement | null;
  readonly inputShadowColor: HTMLInputElement | null;
  readonly inputShadowHex: HTMLInputElement | null;
  readonly swatchShadowPreview: HTMLElement | null;
  readonly inputShadowOpacity: HTMLInputElement | null;
  readonly inputShadowOpacityValue: HTMLInputElement | null;
  readonly inputShadowOffsetX: HTMLInputElement | null;
  readonly inputShadowOffsetY: HTMLInputElement | null;
  readonly inputShadowBlur: HTMLInputElement | null;

  readonly selectArtboardPreset: HTMLSelectElement | null;
  readonly inputArtboardWidth: HTMLInputElement | null;
  readonly inputArtboardHeight: HTMLInputElement | null;
  readonly checkArtboardRatio: HTMLInputElement | null;

  readonly sectionTypography: HTMLDetailsElement | null;
  readonly sectionPolygon: HTMLDetailsElement | null;
  readonly inputPolygonSides: HTMLInputElement | null;
  readonly inputPolygonRadius: HTMLInputElement | null;

  readonly sectionStar: HTMLDetailsElement | null;
  readonly inputStarPoints: HTMLInputElement | null;
  readonly inputStarOuterRadius: HTMLInputElement | null;
  readonly inputStarInnerRadius: HTMLInputElement | null;

  readonly inputTextContent: HTMLInputElement | null;
  readonly selectFontFamily: HTMLSelectElement | null;
  readonly inputFontSize: HTMLInputElement | null;
  readonly inputLineHeight: HTMLInputElement | null;
  readonly inputLetterSpacing: HTMLInputElement | null;
  readonly selectFontWeight: HTMLSelectElement | null;
  readonly selectFontStyle: HTMLSelectElement | null;
  readonly selectTextAlign: HTMLSelectElement | null;
  readonly btnTextAlignLeft: HTMLButtonElement | null;
  readonly btnTextAlignCenter: HTMLButtonElement | null;
  readonly btnTextAlignRight: HTMLButtonElement | null;
  readonly inputTextNative: HTMLInputElement | null;
  readonly inputTextHex: HTMLInputElement | null;
  readonly btnTextColorNone: HTMLButtonElement | null;
  readonly swatchTextColorPreview: HTMLElement | null;
  readonly groupTextColor: HTMLElement | null;

  readonly sectionPathPoint: HTMLDetailsElement | null;
  readonly btnPointCorner: HTMLButtonElement | null;
  readonly btnPointSmooth: HTMLButtonElement | null;
  readonly btnPointSymmetric: HTMLButtonElement | null;
  readonly btnDeleteAnchor: HTMLButtonElement | null;

  readonly sectionAlign: HTMLDetailsElement | null;
  readonly btnAlignLeft: HTMLButtonElement | null;
  readonly btnAlignCenterH: HTMLButtonElement | null;
  readonly btnAlignRight: HTMLButtonElement | null;
  readonly btnAlignTop: HTMLButtonElement | null;
  readonly btnAlignCenterV: HTMLButtonElement | null;
  readonly btnAlignBottom: HTMLButtonElement | null;
  readonly btnDistributeH: HTMLButtonElement | null;
  readonly btnDistributeV: HTMLButtonElement | null;

  readonly sectionPathfinder: HTMLDetailsElement | null;
  readonly btnPathfinderUnion: HTMLButtonElement | null;
  readonly btnPathfinderSubtract: HTMLButtonElement | null;
  readonly btnPathfinderIntersect: HTMLButtonElement | null;
  readonly btnPathfinderExclude: HTMLButtonElement | null;

  readonly btnBringToFront: HTMLButtonElement | null;
  readonly btnSendToBack: HTMLButtonElement | null;
  readonly btnDuplicate: HTMLButtonElement | null;
  readonly btnDeleteSelection: HTMLButtonElement | null;
  readonly btnTogglePanel: HTMLButtonElement | null;
}
