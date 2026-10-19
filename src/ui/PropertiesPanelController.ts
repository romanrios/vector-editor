import type { StateManager, ShapeStyleEntry } from '../state/StateManager.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import type { InputController } from '../input/InputController.ts';
import { TransformShapesCommand, type ShapeTransformEntry } from '../commands/TransformShapesCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import { StyleShapesCommand, type ShapeStyleChangeEntry } from '../commands/StyleShapesCommand.ts';
import { StyleCommand } from '../commands/StyleCommand.ts';
import { UpdateTextTypographyCommand } from '../commands/UpdateTextTypographyCommand.ts';
import { ResizeArtboardCommand } from '../commands/ResizeArtboardCommand.ts';
import type { ShapeDimensions } from '../commands/ResizeCommand.ts';
import {
  isGroup,
  isText,
  type SelectableNode,
  type Shape,
  type Text,
  type Path,
  type Rectangle,
  type FillType,
  type FontStyle,
  type FontWeight,
  type TextAlign,
  type StrokeLineCap,
  type StrokeLineJoin,
} from '../types/scene-graph.ts';
import {
  getSelectionBounds,
  getTextLineHeight,
  normalizeAngle,
  getPointType,
  type AlignmentMode,
  type DistributionAxis,
} from '../utils/geometry.ts';
import { isClosedShape, type BooleanOp } from '../utils/booleanOperations.ts';
import { getShapeDimensions, rotateShapesAboutPivot } from '../utils/transform.ts';
import { getPresetById, findPresetForSize } from '../utils/artboardPresets.ts';
import { getPaintState, parseHexColor, isNonePaint, normalizeColor, type PaintState } from '../utils/color.ts';
import { colorWithOpacity } from '../utils/gradient.ts';
import { toValidHexColor, dashArrayToSelectValue, selectValueToDashArray } from './uiUtils.ts';
import { setupGradientEditor } from './GradientEditorController.ts';

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

interface StyleSnapshot {
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly strokeDashArray?: readonly number[];
  readonly strokeLineCap?: StrokeLineCap;
  readonly strokeLineJoin?: StrokeLineJoin;
}

interface TextTypographySnapshot {
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

export function setupPropertiesPanelBindings(options: PropertiesPanelControllerOptions): PropertiesPanelController {
  const { stateManager, commandManager, inputController, canvas, onSelectionChanged, onAlign, onDistribute, onPathfinder } = options;

  const panelTitle = document.querySelector<HTMLElement>('#panel-title, .panel-title');
  const noSelectionState = document.querySelector<HTMLElement>('#no-selection-state');
  const selectionState = document.querySelector<HTMLElement>('#selection-state');
  const sectionTransform = document.querySelector<HTMLDetailsElement>('#section-transform');
  const sectionAppearance = document.querySelector<HTMLDetailsElement>('#section-appearance');
  const sectionArtboard = document.querySelector<HTMLDetailsElement>('#section-artboard');
  const inputObjectX = document.querySelector<HTMLInputElement>('#input-object-x');
  const inputObjectY = document.querySelector<HTMLInputElement>('#input-object-y');
  const inputObjectWidth = document.querySelector<HTMLInputElement>('#input-object-width');
  const inputObjectHeight = document.querySelector<HTMLInputElement>('#input-object-height');
  const inputObjectRotation = document.querySelector<HTMLInputElement>('#input-object-rotation');
  const groupCornerRadius = document.querySelector<HTMLElement>('#group-corner-radius');
  const inputCornerRadius = document.querySelector<HTMLInputElement>('#input-corner-radius');

  const inputFill = document.querySelector<HTMLInputElement>('#input-fill');
  const inputFillHex = document.querySelector<HTMLInputElement>('#input-fill-hex');
  const btnFillNone = document.querySelector<HTMLButtonElement>('#btn-fill-none');
  const swatchFillPreview = document.querySelector<HTMLElement>('#swatch-fill-preview');

  const inputStroke = document.querySelector<HTMLInputElement>('#input-stroke');
  const inputStrokeHex = document.querySelector<HTMLInputElement>('#input-stroke-hex');
  const btnStrokeNone = document.querySelector<HTMLButtonElement>('#btn-stroke-none');
  const swatchStrokePreview = document.querySelector<HTMLElement>('#swatch-stroke-preview');
  const inputStrokeWidth = document.querySelector<HTMLInputElement>('#input-stroke-width');
  const selectStrokeDash = document.querySelector<HTMLSelectElement>('#select-stroke-dash');
  const selectStrokeCap = document.querySelector<HTMLSelectElement>('#select-stroke-cap');
  const selectStrokeJoin = document.querySelector<HTMLSelectElement>('#select-stroke-join');

  const inputOpacity = document.querySelector<HTMLInputElement>('#input-opacity');
  const inputOpacityValue = document.querySelector<HTMLInputElement>('#input-opacity-value');

  const selectArtboardPreset = document.querySelector<HTMLSelectElement>('#select-artboard-preset');
  const inputArtboardWidth = document.querySelector<HTMLInputElement>('#input-artboard-width');
  const inputArtboardHeight = document.querySelector<HTMLInputElement>('#input-artboard-height');
  const checkArtboardRatio = document.querySelector<HTMLInputElement>('#check-artboard-ratio');

  const sectionTypography = document.querySelector<HTMLDetailsElement>('#section-typography');
  const inputTextContent = document.querySelector<HTMLInputElement>('#input-text-content');
  const selectFontFamily = document.querySelector<HTMLSelectElement>('#select-font-family');
  const inputFontSize = document.querySelector<HTMLInputElement>('#input-font-size');
  const inputLineHeight = document.querySelector<HTMLInputElement>('#input-line-height');
  const inputLetterSpacing = document.querySelector<HTMLInputElement>('#input-letter-spacing');
  const selectFontWeight = document.querySelector<HTMLSelectElement>('#select-font-weight');
  const selectFontStyle = document.querySelector<HTMLSelectElement>('#select-font-style');
  const selectTextAlign = document.querySelector<HTMLSelectElement>('#select-text-align');
  const btnTextAlignLeft = document.querySelector<HTMLButtonElement>('#btn-text-align-left');
  const btnTextAlignCenter = document.querySelector<HTMLButtonElement>('#btn-text-align-center');
  const btnTextAlignRight = document.querySelector<HTMLButtonElement>('#btn-text-align-right');
  const inputTextNative = document.querySelector<HTMLInputElement>('#input-text-color');
  const inputTextHex = document.querySelector<HTMLInputElement>('#input-text-color-hex');
  const btnTextColorNone = document.querySelector<HTMLButtonElement>('#btn-text-color-none');
  const swatchTextColorPreview = document.querySelector<HTMLElement>('#swatch-text-color-preview');
  const groupTextColor = document.querySelector<HTMLElement>('#group-text-color');

  const sectionPathPoint = document.querySelector<HTMLDetailsElement>('#section-path-point');
  const btnPointCorner = document.querySelector<HTMLButtonElement>('#btn-point-corner');
  const btnPointSmooth = document.querySelector<HTMLButtonElement>('#btn-point-smooth');
  const btnPointSymmetric = document.querySelector<HTMLButtonElement>('#btn-point-symmetric');
  const btnDeleteAnchor = document.querySelector<HTMLButtonElement>('#btn-delete-anchor');

  const sectionAlign = document.querySelector<HTMLDetailsElement>('#section-align');
  const btnAlignLeft = document.querySelector<HTMLButtonElement>('#btn-align-left');
  const btnAlignCenterH = document.querySelector<HTMLButtonElement>('#btn-align-center-h');
  const btnAlignRight = document.querySelector<HTMLButtonElement>('#btn-align-right');
  const btnAlignTop = document.querySelector<HTMLButtonElement>('#btn-align-top');
  const btnAlignCenterV = document.querySelector<HTMLButtonElement>('#btn-align-center-v');
  const btnAlignBottom = document.querySelector<HTMLButtonElement>('#btn-align-bottom');
  const btnDistributeH = document.querySelector<HTMLButtonElement>('#btn-distribute-h');
  const btnDistributeV = document.querySelector<HTMLButtonElement>('#btn-distribute-v');

  const sectionPathfinder = document.querySelector<HTMLDetailsElement>('#section-pathfinder');
  const btnPathfinderUnion = document.querySelector<HTMLButtonElement>('#btn-pathfinder-union');
  const btnPathfinderSubtract = document.querySelector<HTMLButtonElement>('#btn-pathfinder-subtract');
  const btnPathfinderIntersect = document.querySelector<HTMLButtonElement>('#btn-pathfinder-intersect');
  const btnPathfinderExclude = document.querySelector<HTMLButtonElement>('#btn-pathfinder-exclude');

  const btnBringToFront = document.querySelector<HTMLButtonElement>('#btn-bring-to-front');
  const btnSendToBack = document.querySelector<HTMLButtonElement>('#btn-send-to-back');
  const btnDuplicate = document.querySelector<HTMLButtonElement>('#btn-duplicate');
  const btnDeleteSelection = document.querySelector<HTMLButtonElement>('#btn-delete-selection');
  const btnTogglePanel = document.querySelector<HTMLButtonElement>('#btn-toggle-panel');

  let initialStyleSnapshots: Map<string, StyleSnapshot> | null = null;
  let lastRememberedFill = '#38bdf8';
  let lastRememberedStroke = '#0284c7';

  let initialCornerRadiusSnapshots: Map<string, number> | null = null;

  let initialTextTypographySnapshot: TextTypographySnapshot | null = null;
  let lastRememberedTextColor = '#000000';

  const captureInitialCornerRadius = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const rects = leafShapes.filter((s): s is Rectangle => s.type === 'rectangle');
    if (rects.length > 0) {
      initialCornerRadiusSnapshots = new Map(rects.map((r) => [r.id, r.cornerRadius ?? 0]));
    } else {
      initialCornerRadiusSnapshots = null;
    }
  };

  const captureInitialTextTypography = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      initialTextTypographySnapshot = {
        text: textNode.text,
        fontFamily: textNode.fontFamily ?? 'Inter',
        fontSize: textNode.fontSize ?? 32,
        fontWeight: textNode.fontWeight ?? 400,
        fontStyle: textNode.fontStyle ?? 'normal',
        textAlign: textNode.textAlign ?? 'left',
        fill: textNode.fill ?? '#000000',
        lineHeight: textNode.lineHeight,
        letterSpacing: textNode.letterSpacing,
      };
    } else {
      initialTextTypographySnapshot = null;
    }
  };

  const captureInitialStyle = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length > 0) {
      initialStyleSnapshots = new Map();
      for (const shape of leafShapes) {
        initialStyleSnapshots.set(shape.id, {
          fill: shape.fill ?? (isText(shape) ? '#000000' : 'none'),
          stroke: ('stroke' in shape ? (shape as { stroke?: FillType }).stroke : undefined) ?? 'none',
          strokeWidth: ('strokeWidth' in shape ? (shape as { strokeWidth?: number }).strokeWidth : undefined) ?? 1,
          opacity: shape.opacity ?? 1,
          strokeDashArray: shape.strokeDashArray,
          strokeLineCap: shape.strokeLineCap,
          strokeLineJoin: shape.strokeLineJoin,
        });
      }
    }
  };

  const getCurrentPaintState = (property: 'fill' | 'stroke', leafShapes: readonly Shape[]): PaintState => {
    if (leafShapes.length > 0) {
      return getPaintState(leafShapes, property);
    }
    const val = stateManager.getDrawingStyle()[property];
    if (isNonePaint(val)) {
      return { kind: 'none' };
    }
    if (typeof val === 'object' && val !== null && 'type' in val) {
      return { kind: 'gradient', gradient: val as any };
    }
    const hex = normalizeColor(val as string);
    return hex ? { kind: 'color', hex } : { kind: 'none' };
  };

  const roundToFourDecimals = (value: number): number => Number(value.toFixed(4));

  const previewColor = (property: 'fill' | 'stroke', color: FillType) => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length === 0) {
      stateManager.setDrawingStyle({ [property]: color });
      return;
    }
    stateManager.setDrawingStyle({ [property]: color });
    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }
    const entries: ShapeStyleEntry[] = leafShapes.map((shape) => {
      if (property === 'fill') {
        return { id: shape.id, style: { fill: color } };
      } else {
        const shapeStrokeWidth = 'strokeWidth' in shape ? (shape as { strokeWidth?: number }).strokeWidth : undefined;
        const needsStrokeWidth =
          !isNonePaint(color) && (shapeStrokeWidth === undefined || shapeStrokeWidth <= 0);
        return {
          id: shape.id,
          style: {
            stroke: color,
            ...(needsStrokeWidth ? { strokeWidth: 1 } : {}),
          },
        };
      }
    });
    stateManager.updateShapesStyle(entries);
  };

  const commitColor = (property: 'fill' | 'stroke', color: FillType) => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length === 0) {
      const needsStrokeWidth =
        property === 'stroke' &&
        !isNonePaint(color) &&
        stateManager.getDrawingStyle().strokeWidth <= 0;
      stateManager.setDrawingStyle({
        [property]: color,
        ...(needsStrokeWidth ? { strokeWidth: 1 } : {}),
      });
      initialStyleSnapshots = null;
      return;
    }
    const needsStrokeWidthDefault =
      property === 'stroke' &&
      !isNonePaint(color) &&
      stateManager.getDrawingStyle().strokeWidth <= 0;
    stateManager.setDrawingStyle({
      [property]: color,
      ...(needsStrokeWidthDefault ? { strokeWidth: 1 } : {}),
    });

    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }

    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => {
      const snapshot = initialStyleSnapshots?.get(shape.id);
      if (property === 'fill') {
        const beforeFill = snapshot?.fill ?? shape.fill;
        return {
          id: shape.id,
          before: { fill: beforeFill },
          after: { fill: color },
        };
      } else {
        const beforeStroke = snapshot?.stroke ?? ('stroke' in shape ? (shape as { stroke?: FillType }).stroke : undefined) ?? 'none';
        const beforeStrokeWidth = snapshot?.strokeWidth ?? ('strokeWidth' in shape ? (shape as { strokeWidth?: number }).strokeWidth : undefined);
        const needsStrokeWidth =
          !isNonePaint(color) && (beforeStrokeWidth === undefined || beforeStrokeWidth <= 0);
        return {
          id: shape.id,
          before: {
            stroke: beforeStroke,
            ...(needsStrokeWidth ? { strokeWidth: beforeStrokeWidth ?? 0 } : {}),
          },
          after: {
            stroke: color,
            ...(needsStrokeWidth ? { strokeWidth: 1 } : {}),
          },
        };
      }
    });

    stateManager.updateShapesStyle(entries.map((e) => ({ id: e.id, style: e.after })));
    const command = new StyleShapesCommand(stateManager, entries);
    if (!command.isAlreadyAtTarget) {
      commandManager.recordCommand(command);
    }
    initialStyleSnapshots = null;
  };

  const gradientEditor = setupGradientEditor(stateManager, {
    getCurrentPaintState,
    commitColor,
    previewColor,
    captureInitialStyle,
    syncPropertiesPanel: () => syncPropertiesPanel(),
    getLastRememberedFill: () => lastRememberedFill,
  });

  let initialArtboardWidth = stateManager.getState().width;
  let initialArtboardHeight = stateManager.getState().height;
  let artboardAspectRatio = initialArtboardHeight > 0 ? initialArtboardWidth / initialArtboardHeight : 1;

  const syncPropertiesPanel = (selectedNodes: readonly SelectableNode[] = stateManager.getSelectedNodes()) => {
    const leafShapes = getLeafShapes(selectedNodes);
    const hasSelection = selectedNodes.length > 0;
    const selectionBounds = hasSelection ? getSelectionBounds(selectedNodes) : null;
    const firstLeafRotation = leafShapes.length > 0 ? leafShapes[0].rotation ?? 0 : null;
    const isSingleTextSelected = selectedNodes.length === 1 && isText(selectedNodes[0]);
    const singleTextNode = isSingleTextSelected ? (selectedNodes[0] as Text) : null;

    if (sectionTypography) {
      sectionTypography.style.display = isSingleTextSelected ? 'block' : 'none';
    }
    if (sectionAppearance) {
      sectionAppearance.style.display = 'block';
    }
    if (groupTextColor) {
      groupTextColor.style.display = isSingleTextSelected ? 'none' : '';
    }
    if (sectionTransform) {
      sectionTransform.style.display = hasSelection ? 'block' : 'none';
    }
    if (sectionArtboard) {
      sectionArtboard.style.display = hasSelection ? 'none' : 'block';
    }

    const pathEdit = inputController?.pathEditState ?? null;
    const hasSelectedAnchors = Boolean(
      pathEdit && pathEdit.selectedAnchors && pathEdit.selectedAnchors.size > 0
    );

    if (sectionPathPoint) {
      sectionPathPoint.style.display = hasSelectedAnchors ? 'block' : 'none';
      if (hasSelectedAnchors && pathEdit) {
        const pathNode = stateManager.findNode(pathEdit.pathId) as Path | null;
        if (pathNode) {
          const firstIndex = pathEdit.selectedAnchors.values().next().value;
          const pt = firstIndex !== undefined ? pathNode.points[firstIndex] : undefined;
          const ptType = pt ? (pt.pointType ?? getPointType(pt)) : 'corner';

          btnPointCorner?.classList.toggle('active', ptType === 'corner');
          btnPointSmooth?.classList.toggle('active', ptType === 'smooth');
          btnPointSymmetric?.classList.toggle('active', ptType === 'symmetric');
        }
      }
    }

    if (hasSelection) {
      if (selectionState) {
        selectionState.style.display = 'block';
      }
      if (noSelectionState) {
        noSelectionState.style.display = 'none';
      }

      if (panelTitle) {
        if (selectedNodes.length === 1) {
          const single = selectedNodes[0];
          panelTitle.textContent = isGroup(single) ? 'Grupo' : 'PROPIEDADES';
        } else {
          const hasGroup = selectedNodes.some(isGroup);
          panelTitle.textContent = hasGroup
            ? `${selectedNodes.length} elementos seleccionados`
            : `${selectedNodes.length} figuras seleccionadas`;
        }
      }

      if (selectionBounds) {
        if (inputObjectX && (typeof document === 'undefined' || document.activeElement !== inputObjectX)) {
          inputObjectX.value = String(roundToFourDecimals(selectionBounds.minX));
        }
        if (inputObjectY && (typeof document === 'undefined' || document.activeElement !== inputObjectY)) {
          inputObjectY.value = String(roundToFourDecimals(selectionBounds.minY));
        }
        if (inputObjectWidth && (typeof document === 'undefined' || document.activeElement !== inputObjectWidth)) {
          inputObjectWidth.value = String(roundToFourDecimals(selectionBounds.width));
        }
        if (inputObjectHeight && (typeof document === 'undefined' || document.activeElement !== inputObjectHeight)) {
          inputObjectHeight.value = String(roundToFourDecimals(selectionBounds.height));
        }
        if (inputObjectRotation && firstLeafRotation !== null &&
            (typeof document === 'undefined' || document.activeElement !== inputObjectRotation)) {
          inputObjectRotation.value = String(roundToFourDecimals(firstLeafRotation));
        }
      }

      const rectLeafs = leafShapes.filter((s): s is Rectangle => s.type === 'rectangle');
      if (groupCornerRadius) {
        if (rectLeafs.length > 0) {
          groupCornerRadius.style.display = 'flex';
          if (inputCornerRadius && (typeof document === 'undefined' || document.activeElement !== inputCornerRadius)) {
            if (rectLeafs.length === 1) {
              inputCornerRadius.value = String(roundToFourDecimals(rectLeafs[0].cornerRadius ?? 0));
              inputCornerRadius.placeholder = '';
            } else {
              const firstRadius = rectLeafs[0].cornerRadius ?? 0;
              const allSame = rectLeafs.every((r) => (r.cornerRadius ?? 0) === firstRadius);
              if (allSame) {
                inputCornerRadius.value = String(roundToFourDecimals(firstRadius));
                inputCornerRadius.placeholder = '';
              } else {
                inputCornerRadius.value = '';
                inputCornerRadius.placeholder = 'Mixto';
              }
            }
          }
        } else {
          groupCornerRadius.style.display = 'none';
        }
      }
    } else {
      if (groupCornerRadius) {
        groupCornerRadius.style.display = 'none';
      }
      initialCornerRadiusSnapshots = null;
      if (selectionState) {
        selectionState.style.display = 'none';
      }
      if (noSelectionState) {
        noSelectionState.style.display = 'block';
      }
      if (sectionAlign) {
        sectionAlign.style.display = 'none';
      }
      if (sectionTypography) {
        sectionTypography.style.display = 'none';
      }
      if (sectionPathPoint) {
        sectionPathPoint.style.display = 'none';
      }
      if (sectionPathfinder) {
        sectionPathfinder.style.display = 'none';
      }
      if (sectionAppearance) {
        sectionAppearance.style.display = 'block';
      }
      if (panelTitle) {
        panelTitle.textContent = 'ESTILO DE DIBUJO';
      }
      initialStyleSnapshots = null;
      initialTextTypographySnapshot = null;
    }

    if (isSingleTextSelected && singleTextNode) {
      const isTypoEditing = initialTextTypographySnapshot !== null;

      if (inputTextContent && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== inputTextContent))) {
        inputTextContent.value = singleTextNode.text ?? '';
      }

      if (selectFontFamily && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== selectFontFamily))) {
        selectFontFamily.value = singleTextNode.fontFamily ?? 'Inter';
      }

      if (inputFontSize && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== inputFontSize))) {
        inputFontSize.value = String(singleTextNode.fontSize ?? 32);
      }

      if (inputLineHeight && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== inputLineHeight))) {
        if (singleTextNode.lineHeight !== undefined) {
          inputLineHeight.value = String(roundToFourDecimals(singleTextNode.lineHeight));
        } else {
          inputLineHeight.value = '';
          const autoVal = roundToFourDecimals(getTextLineHeight(singleTextNode));
          inputLineHeight.placeholder = `Auto (${autoVal})`;
        }
      }

      if (inputLetterSpacing && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== inputLetterSpacing))) {
        inputLetterSpacing.value = String(roundToFourDecimals(singleTextNode.letterSpacing ?? 0));
      }

      if (selectFontWeight && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== selectFontWeight))) {
        const fw = singleTextNode.fontWeight ?? 400;
        const fwStr = fw === 'normal' ? '400' : fw === 'bold' ? '700' : String(fw);
        selectFontWeight.value = fwStr;
      }

      if (selectFontStyle && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== selectFontStyle))) {
        selectFontStyle.value = singleTextNode.fontStyle ?? 'normal';
      }

      const align = singleTextNode.textAlign ?? 'left';
      if (selectTextAlign && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== selectTextAlign))) {
        selectTextAlign.value = align;
      }
      if (btnTextAlignLeft) btnTextAlignLeft.classList.toggle('active', align === 'left');
      if (btnTextAlignCenter) btnTextAlignCenter.classList.toggle('active', align === 'center');
      if (btnTextAlignRight) btnTextAlignRight.classList.toggle('active', align === 'right');

      const textColor = singleTextNode.fill ?? '#000000';
      const isNone = isNonePaint(textColor);
      const validHex = toValidHexColor(textColor, '#000000');
      if (!isNone) {
        lastRememberedTextColor = validHex;
      }

      if (inputTextNative && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== inputTextNative))) {
        inputTextNative.value = validHex;
      }

      if (inputTextHex && (typeof document === 'undefined' || document.activeElement !== inputTextHex)) {
        if (isNone) {
          inputTextHex.value = '';
          inputTextHex.placeholder = 'ninguno';
        } else {
          inputTextHex.value = validHex;
          inputTextHex.placeholder = validHex;
        }
      }

      if (swatchTextColorPreview) {
        if (isNone) {
          swatchTextColorPreview.className = 'color-swatch-preview state-none';
          swatchTextColorPreview.style.backgroundColor = 'transparent';
        } else {
          swatchTextColorPreview.className = 'color-swatch-preview';
          swatchTextColorPreview.style.backgroundColor = validHex;
        }
      }

      if (btnTextColorNone) {
        btnTextColorNone.setAttribute('aria-pressed', String(isNone));
      }
    }

    const firstShape = leafShapes[0];
    const defaultStyle = hasSelection ? null : stateManager.getDrawingStyle();
    const isEditing = initialStyleSnapshots !== null;

    const fillState = getCurrentPaintState('fill', leafShapes);
    const strokeState = getCurrentPaintState('stroke', leafShapes);

    if (fillState.kind === 'color') {
      lastRememberedFill = fillState.hex;
    }
    if (strokeState.kind === 'color') {
      lastRememberedStroke = strokeState.hex;
    }

    gradientEditor.renderGradientControls(fillState);

    if (swatchFillPreview) {
      if (fillState.kind === 'none') {
        swatchFillPreview.className = 'color-swatch-preview state-none';
        swatchFillPreview.style.backgroundColor = 'transparent';
        swatchFillPreview.style.backgroundImage = 'none';
      } else if (fillState.kind === 'mixed') {
        swatchFillPreview.className = 'color-swatch-preview state-mixed';
        swatchFillPreview.style.backgroundColor = 'transparent';
        swatchFillPreview.style.backgroundImage = 'none';
      } else if (fillState.kind === 'gradient') {
        swatchFillPreview.className = 'color-swatch-preview';
        const sortedStops = [...fillState.gradient.stops].sort((a, b) => a.offset - b.offset);
        const cssStops = sortedStops
          .map((s) => `${colorWithOpacity(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
          .join(', ');
        swatchFillPreview.style.backgroundImage = `linear-gradient(to right, ${cssStops})`;
        swatchFillPreview.style.backgroundColor = 'transparent';
      } else {
        swatchFillPreview.className = 'color-swatch-preview';
        swatchFillPreview.style.backgroundColor = fillState.hex;
        swatchFillPreview.style.backgroundImage = 'none';
      }
    }

    if (inputFill && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputFill))) {
      inputFill.value =
        fillState.kind === 'color'
          ? fillState.hex
          : toValidHexColor(firstShape?.fill ?? defaultStyle?.fill, lastRememberedFill);
    }

    if (inputFillHex && (typeof document === 'undefined' || document.activeElement !== inputFillHex)) {
      if (fillState.kind === 'none') {
        inputFillHex.value = '';
        inputFillHex.placeholder = 'ninguno';
      } else if (fillState.kind === 'mixed') {
        inputFillHex.value = '';
        inputFillHex.placeholder = 'Mixto';
      } else if (fillState.kind === 'gradient') {
        inputFillHex.value = '';
        inputFillHex.placeholder = fillState.gradient.type === 'linear' ? 'Gradiente lineal' : 'Gradiente radial';
      } else {
        inputFillHex.value = fillState.hex;
        inputFillHex.placeholder = fillState.hex;
      }
    }

    if (btnFillNone) {
      btnFillNone.setAttribute('aria-pressed', String(fillState.kind === 'none'));
    }

    if (swatchStrokePreview) {
      if (strokeState.kind === 'none') {
        swatchStrokePreview.className = 'color-swatch-preview state-none';
        swatchStrokePreview.style.backgroundColor = 'transparent';
      } else if (strokeState.kind === 'mixed') {
        swatchStrokePreview.className = 'color-swatch-preview state-mixed';
        swatchStrokePreview.style.backgroundColor = 'transparent';
      } else if (strokeState.kind === 'gradient') {
        swatchStrokePreview.className = 'color-swatch-preview';
        swatchStrokePreview.style.backgroundColor = toValidHexColor(strokeState.gradient);
      } else {
        swatchStrokePreview.className = 'color-swatch-preview';
        swatchStrokePreview.style.backgroundColor = strokeState.hex;
      }
    }

    const firstShapeStroke =
      firstShape && 'stroke' in firstShape ? (firstShape as { stroke?: FillType }).stroke : undefined;

    if (inputStroke && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputStroke))) {
      inputStroke.value =
        strokeState.kind === 'color'
          ? strokeState.hex
          : toValidHexColor(firstShapeStroke ?? defaultStyle?.stroke, lastRememberedStroke);
    }

    if (inputStrokeHex && (typeof document === 'undefined' || document.activeElement !== inputStrokeHex)) {
      if (strokeState.kind === 'none') {
        inputStrokeHex.value = '';
        inputStrokeHex.placeholder = 'ninguno';
      } else if (strokeState.kind === 'mixed') {
        inputStrokeHex.value = '';
        inputStrokeHex.placeholder = 'Mixto';
      } else if (strokeState.kind === 'gradient') {
        inputStrokeHex.value = '';
        inputStrokeHex.placeholder = strokeState.gradient.type === 'linear' ? 'Gradiente lineal' : 'Gradiente radial';
      } else {
        inputStrokeHex.value = strokeState.hex;
        inputStrokeHex.placeholder = strokeState.hex;
      }
    }

    if (btnStrokeNone) {
      btnStrokeNone.setAttribute('aria-pressed', String(strokeState.kind === 'none'));
    }

    if (inputStrokeWidth && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== inputStrokeWidth))) {
      inputStrokeWidth.value = String(firstShape ? (('strokeWidth' in firstShape ? (firstShape as { strokeWidth?: number }).strokeWidth : undefined) ?? 1) : (defaultStyle?.strokeWidth ?? 2));
    }

    if (selectStrokeDash && (typeof document === 'undefined' || document.activeElement !== selectStrokeDash)) {
      const activeDash = firstShape ? firstShape.strokeDashArray : defaultStyle?.strokeDashArray;
      selectStrokeDash.value = dashArrayToSelectValue(activeDash);
    }

    if (selectStrokeCap && (typeof document === 'undefined' || document.activeElement !== selectStrokeCap)) {
      const activeCap = firstShape ? firstShape.strokeLineCap : defaultStyle?.strokeLineCap;
      selectStrokeCap.value = activeCap ?? 'butt';
    }

    if (selectStrokeJoin && (typeof document === 'undefined' || document.activeElement !== selectStrokeJoin)) {
      const activeJoin = firstShape ? firstShape.strokeLineJoin : defaultStyle?.strokeLineJoin;
      selectStrokeJoin.value = activeJoin ?? 'miter';
    }

    const opacities = leafShapes.map((shape) => shape.opacity ?? 1);
    const isOpacityMixed = opacities.some((opacity) => opacity !== opacities[0]);
    const displayedOpacity = opacities.length > 0 ? opacities[0] : (defaultStyle?.opacity ?? 1);
    if (inputOpacity && (typeof document === 'undefined' || document.activeElement !== inputOpacity)) {
      inputOpacity.value = String(Math.round(displayedOpacity * 100));
    }
    if (inputOpacityValue && (typeof document === 'undefined' || document.activeElement !== inputOpacityValue)) {
      inputOpacityValue.value = isOpacityMixed ? '' : String(Math.round(displayedOpacity * 100));
      inputOpacityValue.placeholder = isOpacityMixed ? 'Mixto' : '';
    }

    const currentDoc = stateManager.getState();
    if (selectArtboardPreset && (typeof document === 'undefined' || document.activeElement !== selectArtboardPreset)) {
      const matchingPreset = findPresetForSize(currentDoc.width, currentDoc.height);
      selectArtboardPreset.value = matchingPreset ? matchingPreset.id : 'custom';
    }
    if (inputArtboardWidth && (typeof document === 'undefined' || document.activeElement !== inputArtboardWidth)) {
      inputArtboardWidth.value = String(currentDoc.width);
    }
    if (inputArtboardHeight && (typeof document === 'undefined' || document.activeElement !== inputArtboardHeight)) {
      inputArtboardHeight.value = String(currentDoc.height);
    }
    if (checkArtboardRatio?.checked && currentDoc.height > 0 &&
        (typeof document === 'undefined' || (document.activeElement !== inputArtboardWidth && document.activeElement !== inputArtboardHeight))) {
      artboardAspectRatio = currentDoc.width / currentDoc.height;
    }

    if (hasSelection) {
      const canAlign = selectedNodes.length >= 2;
      const canDistribute = selectedNodes.length >= 3;

      if (sectionAlign) {
        sectionAlign.style.display = canAlign ? 'block' : 'none';
      }

      const closedShapes = leafShapes.filter(isClosedShape);
      const canPathfinder = closedShapes.length >= 2;
      if (sectionPathfinder) {
        sectionPathfinder.style.display = canPathfinder ? 'block' : 'none';
      }

      const pathfinderPanelButtons = [
        btnPathfinderUnion,
        btnPathfinderSubtract,
        btnPathfinderIntersect,
        btnPathfinderExclude,
      ];
      for (let i = 0; i < pathfinderPanelButtons.length; i++) {
        const btn = pathfinderPanelButtons[i];
        if (btn) {
          btn.disabled = !canPathfinder;
          btn.setAttribute('aria-disabled', String(!canPathfinder));
        }
      }

      const alignPanelButtons = [
        btnAlignLeft,
        btnAlignCenterH,
        btnAlignRight,
        btnAlignTop,
        btnAlignCenterV,
        btnAlignBottom,
      ];
      for (let i = 0; i < alignPanelButtons.length; i++) {
        const btn = alignPanelButtons[i];
        if (btn) {
          btn.disabled = !canAlign;
          btn.setAttribute('aria-disabled', String(!canAlign));
        }
      }

      const distributePanelButtons = [btnDistributeH, btnDistributeV];
      for (let i = 0; i < distributePanelButtons.length; i++) {
        const btn = distributePanelButtons[i];
        if (btn) {
          btn.disabled = !canDistribute;
          btn.setAttribute('aria-disabled', String(!canDistribute));
        }
      }
    }

    onSelectionChanged?.();
  };

  const applyObjectGeometry = (property: 'x' | 'y' | 'width' | 'height', input: HTMLInputElement) => {
    const parsedValue = Number(input.value);
    const value = Number.isFinite(parsedValue) ? roundToFourDecimals(parsedValue) : parsedValue;
    if (!Number.isFinite(value) || ((property === 'width' || property === 'height') && value <= 0)) {
      syncPropertiesPanel();
      return;
    }

    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const bounds = getSelectionBounds(selectedNodes);
    if (leafShapes.length === 0 || !bounds) return;

    let targetMinX = bounds.minX;
    let targetMinY = bounds.minY;
    let targetWidth = bounds.width;
    let targetHeight = bounds.height;
    if (property === 'x') targetMinX = value;
    if (property === 'y') targetMinY = value;
    if (property === 'width') targetWidth = value;
    if (property === 'height') targetHeight = value;

    const scaleX = targetWidth / Math.max(bounds.width, 0.1);
    const scaleY = targetHeight / Math.max(bounds.height, 0.1);
    const mapX = (x: number) => roundToFourDecimals(targetMinX + (x - bounds.minX) * scaleX);
    const mapY = (y: number) => roundToFourDecimals(targetMinY + (y - bounds.minY) * scaleY);
    const textScale = scaleX === 1
      ? scaleY
      : scaleY === 1
      ? scaleX
      : Math.sqrt(scaleX * scaleY);

    const entries = leafShapes.map((shape) => {
      const positionBefore: ShapeDimensions = {
        x: shape.x,
        y: shape.y,
        ...(shape.rotation !== undefined ? { rotation: shape.rotation } : {}),
      };
      const positionAfter: ShapeDimensions = {
        x: mapX(shape.x),
        y: mapY(shape.y),
        ...(shape.rotation !== undefined ? { rotation: shape.rotation } : {}),
      };
      let before: ShapeDimensions;
      let after: ShapeDimensions;

      if (shape.type === 'rectangle' || shape.type === 'image') {
        before = { ...positionBefore, width: shape.width, height: shape.height };
        after = {
          ...positionAfter,
          width: roundToFourDecimals(shape.width * scaleX),
          height: roundToFourDecimals(shape.height * scaleY),
        };
      } else if (shape.type === 'ellipse') {
        before = { ...positionBefore, radiusX: shape.radiusX, radiusY: shape.radiusY };
        after = {
          ...positionAfter,
          radiusX: roundToFourDecimals(shape.radiusX * scaleX),
          radiusY: roundToFourDecimals(shape.radiusY * scaleY),
        };
      } else if (shape.type === 'path') {
        before = { ...positionBefore, points: shape.points };
        after = {
          ...positionAfter,
          points: shape.points.map((point) => ({
            x: mapX(point.x),
            y: mapY(point.y),
            ...(point.handleIn ? { handleIn: { x: mapX(point.handleIn.x), y: mapY(point.handleIn.y) } } : {}),
            ...(point.handleOut ? { handleOut: { x: mapX(point.handleOut.x), y: mapY(point.handleOut.y) } } : {}),
          })),
        };
      } else {
        const fontSize = shape.fontSize ?? 16;
        before = {
          ...positionBefore,
          fontSize,
          ...(shape.lineHeight !== undefined ? { lineHeight: shape.lineHeight } : {}),
        };
        after = {
          ...positionAfter,
          fontSize: Math.max(1, roundToFourDecimals(fontSize * textScale)),
          ...(shape.lineHeight !== undefined ? { lineHeight: roundToFourDecimals(shape.lineHeight * scaleY) } : {}),
        };
      }

      return { id: shape.id, before, after };
    });

    const transformCommand = new TransformShapesCommand(stateManager, entries);
    const command = leafShapes.length > 1
      ? new BatchCommand([transformCommand], 'Transform Selection')
      : transformCommand;
    command.execute();
    commandManager.recordCommand(command);
  };

  const onObjectXChange = () => inputObjectX && applyObjectGeometry('x', inputObjectX);
  const onObjectYChange = () => inputObjectY && applyObjectGeometry('y', inputObjectY);
  const onObjectWidthChange = () => inputObjectWidth && applyObjectGeometry('width', inputObjectWidth);
  const onObjectHeightChange = () => inputObjectHeight && applyObjectGeometry('height', inputObjectHeight);
  const onObjectGeometryBlur = () => syncPropertiesPanel();

  const onObjectRotationChange = () => {
    if (!inputObjectRotation) return;
    const parsedRotation = Number(inputObjectRotation.value);
    const targetRotation = Number.isFinite(parsedRotation) ? roundToFourDecimals(parsedRotation) : parsedRotation;
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const bounds = getSelectionBounds(selectedNodes);
    if (!Number.isFinite(targetRotation) || leafShapes.length === 0 || !bounds) {
      syncPropertiesPanel();
      return;
    }

    const delta = normalizeAngle(targetRotation - (leafShapes[0].rotation ?? 0));
    const pivot = {
      x: bounds.minX + bounds.width / 2,
      y: bounds.minY + bounds.height / 2,
    };
    const rotatedEntries = rotateShapesAboutPivot(leafShapes, pivot, delta);
    if (rotatedEntries.length === 0) return;

    const shapesById = new Map(leafShapes.map((shape) => [shape.id, shape]));
    const entries = rotatedEntries.map((entry) => {
      const shape = shapesById.get(entry.id);
      if (!shape) {
        throw new Error(`No se encontró la figura ${entry.id} para registrar la rotación.`);
      }
      return {
        id: entry.id,
        before: getShapeDimensions(shape),
        after: entry.dimensions,
      };
    });
    const transformCommand = new TransformShapesCommand(stateManager, entries);
    const command = leafShapes.length > 1
      ? new BatchCommand([transformCommand], 'Rotate Selection')
      : transformCommand;
    command.execute();
    commandManager.recordCommand(command);
  };

  inputObjectX?.addEventListener('change', onObjectXChange);
  inputObjectY?.addEventListener('change', onObjectYChange);
  inputObjectWidth?.addEventListener('change', onObjectWidthChange);
  inputObjectHeight?.addEventListener('change', onObjectHeightChange);
  inputObjectRotation?.addEventListener('change', onObjectRotationChange);
  inputObjectX?.addEventListener('blur', onObjectGeometryBlur);
  inputObjectY?.addEventListener('blur', onObjectGeometryBlur);
  inputObjectWidth?.addEventListener('blur', onObjectGeometryBlur);
  inputObjectHeight?.addEventListener('blur', onObjectGeometryBlur);
  inputObjectRotation?.addEventListener('blur', onObjectGeometryBlur);

  const onCornerRadiusFocus = () => {
    captureInitialCornerRadius();
  };

  const onCornerRadiusInput = () => {
    if (!inputCornerRadius) return;
    const parsed = parseFloat(inputCornerRadius.value);
    if (isNaN(parsed) || parsed < 0) return;
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const rects = leafShapes.filter((s): s is Rectangle => s.type === 'rectangle');
    if (rects.length === 0) return;

    if (!initialCornerRadiusSnapshots) {
      captureInitialCornerRadius();
    }

    const targetRadius = Math.max(0, parsed);
    stateManager.updateShapesDimensions(
      rects.map((r) => ({
        id: r.id,
        dimensions: { cornerRadius: targetRadius },
      }))
    );
  };

  const onCornerRadiusChange = () => {
    if (!inputCornerRadius) return;
    const parsed = parseFloat(inputCornerRadius.value);
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const rects = leafShapes.filter((s): s is Rectangle => s.type === 'rectangle');
    if (rects.length === 0) {
      initialCornerRadiusSnapshots = null;
      syncPropertiesPanel();
      return;
    }

    const targetRadius = isNaN(parsed) || parsed < 0 ? 0 : roundToFourDecimals(parsed);
    inputCornerRadius.value = String(targetRadius);

    const entries: ShapeTransformEntry[] = rects.map((r) => {
      const initialRadius = initialCornerRadiusSnapshots?.get(r.id) ?? r.cornerRadius ?? 0;
      return {
        id: r.id,
        before: {
          ...getShapeDimensions(r),
          cornerRadius: initialRadius,
        },
        after: {
          ...getShapeDimensions(r),
          cornerRadius: targetRadius,
        },
      };
    });

    const transformCommand = new TransformShapesCommand(stateManager, entries);
    if (!transformCommand.isAlreadyAtTarget) {
      const command = leafShapes.length > 1
        ? new BatchCommand([transformCommand], 'Change Corner Radius')
        : transformCommand;
      command.execute();
      commandManager.recordCommand(command);
    }
    initialCornerRadiusSnapshots = null;
  };

  const onCornerRadiusBlur = () => {
    syncPropertiesPanel();
  };

  inputCornerRadius?.addEventListener('focus', onCornerRadiusFocus);
  inputCornerRadius?.addEventListener('input', onCornerRadiusInput);
  inputCornerRadius?.addEventListener('change', onCornerRadiusChange);
  inputCornerRadius?.addEventListener('blur', onCornerRadiusBlur);

  const onInputStart = () => {
    captureInitialStyle();
  };

  inputFill?.addEventListener('mousedown', onInputStart);
  inputFill?.addEventListener('click', onInputStart);
  inputFill?.addEventListener('focus', onInputStart);

  inputStroke?.addEventListener('mousedown', onInputStart);
  inputStroke?.addEventListener('click', onInputStart);
  inputStroke?.addEventListener('focus', onInputStart);

  inputStrokeWidth?.addEventListener('mousedown', onInputStart);
  inputStrokeWidth?.addEventListener('click', onInputStart);
  inputStrokeWidth?.addEventListener('focus', onInputStart);

  const onFillInput = () => {
    if (!inputFill) return;
    const color = inputFill.value.toLowerCase();
    previewColor('fill', color);
    if (swatchFillPreview) {
      swatchFillPreview.className = 'color-swatch-preview';
      swatchFillPreview.style.backgroundColor = color;
    }
    if (inputFillHex && (typeof document === 'undefined' || document.activeElement !== inputFillHex)) {
      inputFillHex.value = color;
      inputFillHex.placeholder = color;
    }
    btnFillNone?.setAttribute('aria-pressed', 'false');
  };

  const onStrokeInput = () => {
    if (!inputStroke) return;
    const color = inputStroke.value.toLowerCase();
    previewColor('stroke', color);
    if (swatchStrokePreview) {
      swatchStrokePreview.className = 'color-swatch-preview';
      swatchStrokePreview.style.backgroundColor = color;
    }
    if (inputStrokeHex && (typeof document === 'undefined' || document.activeElement !== inputStrokeHex)) {
      inputStrokeHex.value = color;
      inputStrokeHex.placeholder = color;
    }
    btnStrokeNone?.setAttribute('aria-pressed', 'false');
  };

  const onStrokeWidthInput = () => {
    if (!inputStrokeWidth) return;
    const parsed = parseFloat(inputStrokeWidth.value);
    const strokeWidth = isNaN(parsed) ? 1 : Math.max(0, parsed);

    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length === 0) {
      stateManager.setDrawingStyle({ strokeWidth });
      return;
    }
    stateManager.setDrawingStyle({ strokeWidth });
    if (!initialStyleSnapshots) {
      captureInitialStyle();
    }
    for (const shape of leafShapes) {
      stateManager.updateShape(shape.id, { strokeWidth });
    }
  };

  inputFill?.addEventListener('input', onFillInput);
  inputStroke?.addEventListener('input', onStrokeInput);
  inputStrokeWidth?.addEventListener('input', onStrokeWidthInput);

  const onOpacityInput = (source: HTMLInputElement) => {
    const parsed = Number(source.value);
    if (source.value.trim() === '' || !Number.isFinite(parsed)) return;
    const percent = Math.round(Math.max(0, Math.min(100, parsed)));
    const opacity = percent / 100;
    if (inputOpacity) inputOpacity.value = String(percent);
    if (inputOpacityValue && source !== inputOpacityValue) inputOpacityValue.value = String(percent);
    if (!Number.isFinite(opacity)) return;

    const leafShapes = getLeafShapes(stateManager.getSelectedNodes());
    stateManager.setDrawingStyle({ opacity });
    if (leafShapes.length === 0) return;

    if (!initialStyleSnapshots) captureInitialStyle();
    stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { opacity },
    })));
  };

  const onOpacityChange = (source: HTMLInputElement) => {
    const parsed = Number(source.value);
    if (source.value.trim() === '' || !Number.isFinite(parsed)) {
      syncPropertiesPanel();
      return;
    }
    const percent = Math.round(Math.max(0, Math.min(100, parsed)));
    const opacity = percent / 100;
    if (inputOpacity) inputOpacity.value = String(percent);
    if (inputOpacityValue) inputOpacityValue.value = String(percent);
    if (!Number.isFinite(opacity)) return;

    const leafShapes = getLeafShapes(stateManager.getSelectedNodes());
    stateManager.setDrawingStyle({ opacity });
    if (leafShapes.length === 0) {
      initialStyleSnapshots = null;
      return;
    }
    if (!initialStyleSnapshots) captureInitialStyle();

    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { opacity: initialStyleSnapshots?.get(shape.id)?.opacity ?? shape.opacity ?? 1 },
      after: { opacity },
    }));
    stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { opacity },
    })));
    const command = new StyleShapesCommand(stateManager, entries);
    if (!command.isAlreadyAtTarget) commandManager.recordCommand(command);
    initialStyleSnapshots = null;
  };

  const onOpacitySliderInput = () => inputOpacity && onOpacityInput(inputOpacity);
  const onOpacitySliderChange = () => inputOpacity && onOpacityChange(inputOpacity);
  const onOpacityValueInput = () => inputOpacityValue && onOpacityInput(inputOpacityValue);
  const onOpacityValueChange = () => inputOpacityValue && onOpacityChange(inputOpacityValue);

  inputOpacity?.addEventListener('mousedown', onInputStart);
  inputOpacity?.addEventListener('click', onInputStart);
  inputOpacity?.addEventListener('focus', onInputStart);
  inputOpacity?.addEventListener('input', onOpacitySliderInput);
  inputOpacity?.addEventListener('change', onOpacitySliderChange);
  inputOpacityValue?.addEventListener('mousedown', onInputStart);
  inputOpacityValue?.addEventListener('click', onInputStart);
  inputOpacityValue?.addEventListener('focus', onInputStart);
  inputOpacityValue?.addEventListener('input', onOpacityValueInput);
  inputOpacityValue?.addEventListener('change', onOpacityValueChange);

  const onFillChange = () => {
    if (!inputFill) return;
    commitColor('fill', inputFill.value.toLowerCase());
  };

  const onStrokeChange = () => {
    if (!inputStroke) return;
    commitColor('stroke', inputStroke.value.toLowerCase());
  };

  let fillInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  let strokeInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  let isFillHexSubmitting = false;
  let isStrokeHexSubmitting = false;

  const handleHexCommit = (property: 'fill' | 'stroke', inputEl: HTMLInputElement) => {
    const text = inputEl.value;
    const parsed = parseHexColor(text);
    if (parsed !== null) {
      inputEl.removeAttribute('aria-invalid');
      commitColor(property, parsed);
      inputEl.value = parsed;
      syncPropertiesPanel();
    } else {
      if (property === 'fill') {
        if (fillInvalidTimer) clearTimeout(fillInvalidTimer);
        inputEl.setAttribute('aria-invalid', 'true');
        fillInvalidTimer = setTimeout(() => {
          inputEl.removeAttribute('aria-invalid');
          fillInvalidTimer = null;
        }, 1000);
      } else {
        if (strokeInvalidTimer) clearTimeout(strokeInvalidTimer);
        inputEl.setAttribute('aria-invalid', 'true');
        strokeInvalidTimer = setTimeout(() => {
          inputEl.removeAttribute('aria-invalid');
          strokeInvalidTimer = null;
        }, 1000);
      }

      const selectedNodes = stateManager.getSelectedNodes();
      const leafShapes = getLeafShapes(selectedNodes);
      const paintState = getCurrentPaintState(property, leafShapes);
      if (paintState.kind === 'color') {
        inputEl.value = paintState.hex;
        inputEl.placeholder = paintState.hex;
      } else if (paintState.kind === 'none') {
        inputEl.value = '';
        inputEl.placeholder = 'ninguno';
      } else {
        inputEl.value = '';
        inputEl.placeholder = 'Mixto';
      }
      initialStyleSnapshots = null;
    }
  };

  const handleHexRevert = (property: 'fill' | 'stroke', inputEl: HTMLInputElement) => {
    inputEl.removeAttribute('aria-invalid');
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = getCurrentPaintState(property, leafShapes);
    if (paintState.kind === 'color') {
      inputEl.value = paintState.hex;
      inputEl.placeholder = paintState.hex;
    } else if (paintState.kind === 'none') {
      inputEl.value = '';
      inputEl.placeholder = 'ninguno';
    } else {
      inputEl.value = '';
      inputEl.placeholder = 'Mixto';
    }
    initialStyleSnapshots = null;
  };

  const onFillHexFocus = () => captureInitialStyle();
  const onFillHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputFillHex) {
        isFillHexSubmitting = true;
        handleHexCommit('fill', inputFillHex);
        inputFillHex.blur();
        isFillHexSubmitting = false;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputFillHex) {
        isFillHexSubmitting = true;
        handleHexRevert('fill', inputFillHex);
        inputFillHex.blur();
        isFillHexSubmitting = false;
      }
    }
  };
  const onFillHexBlur = () => {
    if (isFillHexSubmitting) return;
    if (inputFillHex) handleHexCommit('fill', inputFillHex);
  };

  const onStrokeHexFocus = () => captureInitialStyle();
  const onStrokeHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputStrokeHex) {
        isStrokeHexSubmitting = true;
        handleHexCommit('stroke', inputStrokeHex);
        inputStrokeHex.blur();
        isStrokeHexSubmitting = false;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputStrokeHex) {
        isStrokeHexSubmitting = true;
        handleHexRevert('stroke', inputStrokeHex);
        inputStrokeHex.blur();
        isStrokeHexSubmitting = false;
      }
    }
  };
  const onStrokeHexBlur = () => {
    if (isStrokeHexSubmitting) return;
    if (inputStrokeHex) handleHexCommit('stroke', inputStrokeHex);
  };

  const onFillNoneClick = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length === 0) {
      const currentFill = stateManager.getDrawingStyle().fill;
      if (!isNonePaint(currentFill)) {
        lastRememberedFill = toValidHexColor(currentFill, lastRememberedFill);
        commitColor('fill', 'none');
      } else {
        commitColor('fill', lastRememberedFill);
      }
      return;
    }
    captureInitialStyle();
    const fillState = getPaintState(leafShapes, 'fill');
    if (fillState.kind === 'color' || fillState.kind === 'mixed') {
      if (fillState.kind === 'color') {
        lastRememberedFill = fillState.hex;
      }
      commitColor('fill', 'none');
    } else {
      commitColor('fill', lastRememberedFill);
    }
  };

  const onStrokeNoneClick = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length === 0) {
      const currentStroke = stateManager.getDrawingStyle().stroke;
      if (!isNonePaint(currentStroke)) {
        lastRememberedStroke = toValidHexColor(currentStroke, lastRememberedStroke);
        commitColor('stroke', 'none');
      } else {
        commitColor('stroke', lastRememberedStroke);
      }
      return;
    }
    captureInitialStyle();
    const strokeState = getPaintState(leafShapes, 'stroke');
    if (strokeState.kind === 'color' || strokeState.kind === 'mixed') {
      if (strokeState.kind === 'color') {
        lastRememberedStroke = strokeState.hex;
      }
      commitColor('stroke', 'none');
    } else {
      commitColor('stroke', lastRememberedStroke);
    }
  };

  inputFillHex?.addEventListener('focus', onFillHexFocus);
  inputFillHex?.addEventListener('keydown', onFillHexKeyDown);
  inputFillHex?.addEventListener('blur', onFillHexBlur);

  inputStrokeHex?.addEventListener('focus', onStrokeHexFocus);
  inputStrokeHex?.addEventListener('keydown', onStrokeHexKeyDown);
  inputStrokeHex?.addEventListener('blur', onStrokeHexBlur);

  btnFillNone?.addEventListener('click', onFillNoneClick);
  btnStrokeNone?.addEventListener('click', onStrokeNoneClick);

  const onStrokeWidthChange = () => {
    if (!inputStrokeWidth) return;
    const parsed = parseFloat(inputStrokeWidth.value);
    const finalVal = isNaN(parsed) ? 1 : Math.max(0, parsed);
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    if (leafShapes.length === 0) {
      stateManager.setDrawingStyle({ strokeWidth: finalVal });
      initialStyleSnapshots = null;
      return;
    }

    stateManager.setDrawingStyle({ strokeWidth: finalVal });
    if (!initialStyleSnapshots) captureInitialStyle();

    const commands: StyleCommand[] = [];
    for (const shape of leafShapes) {
      const shapeStrokeWidth = 'strokeWidth' in shape ? (shape as { strokeWidth?: number }).strokeWidth : undefined;
      const initialVal = initialStyleSnapshots?.get(shape.id)?.strokeWidth ?? shapeStrokeWidth;
      stateManager.updateShape(shape.id, { strokeWidth: finalVal });
      if (initialVal !== finalVal) {
        commands.push(
          new StyleCommand(
            stateManager,
            shape.id,
            { strokeWidth: initialVal },
            { strokeWidth: finalVal }
          )
        );
      }
    }

    if (commands.length === 1) {
      commandManager.recordCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.recordCommand(new BatchCommand(commands, 'Style Stroke Width'));
    }
    initialStyleSnapshots = null;
  };

  const onStrokeDashChange = () => {
    if (!selectStrokeDash) return;
    const val = selectStrokeDash.value;
    const dashArray = selectValueToDashArray(val);
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    stateManager.setDrawingStyle({ strokeDashArray: dashArray });
    if (leafShapes.length === 0) {
      initialStyleSnapshots = null;
      return;
    }
    if (!initialStyleSnapshots) captureInitialStyle();

    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { strokeDashArray: initialStyleSnapshots?.get(shape.id)?.strokeDashArray ?? shape.strokeDashArray },
      after: { strokeDashArray: dashArray },
    }));

    stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { strokeDashArray: dashArray },
    })));

    const command = new StyleShapesCommand(stateManager, entries);
    if (!command.isAlreadyAtTarget) commandManager.recordCommand(command);
    initialStyleSnapshots = null;
  };

  const onStrokeCapChange = () => {
    if (!selectStrokeCap) return;
    const cap = selectStrokeCap.value as StrokeLineCap;
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    stateManager.setDrawingStyle({ strokeLineCap: cap });
    if (leafShapes.length === 0) {
      initialStyleSnapshots = null;
      return;
    }
    if (!initialStyleSnapshots) captureInitialStyle();

    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { strokeLineCap: initialStyleSnapshots?.get(shape.id)?.strokeLineCap ?? shape.strokeLineCap ?? 'butt' },
      after: { strokeLineCap: cap },
    }));

    stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { strokeLineCap: cap },
    })));

    const command = new StyleShapesCommand(stateManager, entries);
    if (!command.isAlreadyAtTarget) commandManager.recordCommand(command);
    initialStyleSnapshots = null;
  };

  const onStrokeJoinChange = () => {
    if (!selectStrokeJoin) return;
    const join = selectStrokeJoin.value as StrokeLineJoin;
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    stateManager.setDrawingStyle({ strokeLineJoin: join });
    if (leafShapes.length === 0) {
      initialStyleSnapshots = null;
      return;
    }
    if (!initialStyleSnapshots) captureInitialStyle();

    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { strokeLineJoin: initialStyleSnapshots?.get(shape.id)?.strokeLineJoin ?? shape.strokeLineJoin ?? 'miter' },
      after: { strokeLineJoin: join },
    }));

    stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { strokeLineJoin: join },
    })));

    const command = new StyleShapesCommand(stateManager, entries);
    if (!command.isAlreadyAtTarget) commandManager.recordCommand(command);
    initialStyleSnapshots = null;
  };

  inputFill?.addEventListener('change', onFillChange);
  inputStroke?.addEventListener('change', onStrokeChange);
  inputStrokeWidth?.addEventListener('change', onStrokeWidthChange);
  selectStrokeDash?.addEventListener('change', onStrokeDashChange);
  selectStrokeCap?.addEventListener('change', onStrokeCapChange);
  selectStrokeJoin?.addEventListener('change', onStrokeJoinChange);

  // Tipografía
  const commitTextColor = (color: string) => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const beforeColor = initialTextTypographySnapshot?.fill ?? textNode.fill ?? '#000000';
      stateManager.setDrawingStyle({ fill: color });
      stateManager.updateShape<Text>(textNode.id, { fill: color });
      const cmd = new UpdateTextTypographyCommand(
        stateManager,
        textNode.id,
        { fill: beforeColor },
        { fill: color }
      );
      if (!cmd.isAlreadyAtTarget) commandManager.recordCommand(cmd);
      initialTextTypographySnapshot = null;
      syncPropertiesPanel();
    }
  };

  const previewTextColor = (color: string) => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!initialTextTypographySnapshot) captureInitialTextTypography();
      stateManager.setDrawingStyle({ fill: color });
      stateManager.updateShape<Text>(textNode.id, { fill: color });
      if (swatchTextColorPreview) {
        swatchTextColorPreview.className = 'color-swatch-preview';
        swatchTextColorPreview.style.backgroundColor = color;
      }
      if (inputTextHex && (typeof document === 'undefined' || document.activeElement !== inputTextHex)) {
        inputTextHex.value = color;
        inputTextHex.placeholder = color;
      }
      btnTextColorNone?.setAttribute('aria-pressed', 'false');
    }
  };

  const onTextContentFocus = () => captureInitialTextTypography();
  const onTextContentInput = () => {
    if (!inputTextContent) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!initialTextTypographySnapshot) captureInitialTextTypography();
      stateManager.updateShape<Text>(textNode.id, { text: inputTextContent.value });
    }
  };

  const onTextContentChange = () => {
    if (!inputTextContent) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = initialTextTypographySnapshot?.text ?? textNode.text ?? 'Texto';
      const after = inputTextContent.value;
      stateManager.updateShape<Text>(textNode.id, { text: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { text: before }, { text: after });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
    }
  };

  const onFontFamilyChange = () => {
    if (!selectFontFamily) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = initialTextTypographySnapshot?.fontFamily ?? textNode.fontFamily ?? 'Inter';
      const after = selectFontFamily.value;
      stateManager.updateShape<Text>(textNode.id, { fontFamily: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { fontFamily: before }, { fontFamily: after });
        commandManager.recordCommand(cmd);
      }
      if (typeof document !== 'undefined' && 'fonts' in document && document.fonts && typeof document.fonts.load === 'function') {
        const fontSpec = `${textNode.fontStyle ?? 'normal'} ${textNode.fontWeight ?? 400} ${textNode.fontSize ?? 16}px "${after}"`;
        document.fonts.load(fontSpec).then(() => {
          stateManager.markDirty();
        }).catch(() => {});
      }
      initialTextTypographySnapshot = null;
    }
  };

  const onFontSizeFocus = () => captureInitialTextTypography();
  const onFontSizeInput = () => {
    if (!inputFontSize) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!initialTextTypographySnapshot) captureInitialTextTypography();
      const parsed = parseFloat(inputFontSize.value);
      if (!isNaN(parsed) && parsed > 0) {
        stateManager.updateShape<Text>(textNode.id, { fontSize: parsed });
      }
    }
  };

  const onFontSizeChange = () => {
    if (!inputFontSize) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const parsed = parseFloat(inputFontSize.value);
      const after = isNaN(parsed) || parsed <= 0 ? 32 : parsed;
      inputFontSize.value = String(after);
      const before = initialTextTypographySnapshot?.fontSize ?? textNode.fontSize ?? 32;
      stateManager.updateShape<Text>(textNode.id, { fontSize: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { fontSize: before }, { fontSize: after });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
    }
  };

  const onLineHeightFocus = () => captureInitialTextTypography();
  const onLineHeightInput = () => {
    if (!inputLineHeight) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!initialTextTypographySnapshot) captureInitialTextTypography();
      const val = inputLineHeight.value.trim();
      if (val === '') {
        stateManager.updateShape<Text>(textNode.id, { lineHeight: undefined });
      } else {
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed > 0) {
          stateManager.updateShape<Text>(textNode.id, { lineHeight: parsed });
        }
      }
    }
  };

  const onLineHeightChange = () => {
    if (!inputLineHeight) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const val = inputLineHeight.value.trim();
      let after: number | undefined;
      if (val === '') {
        after = undefined;
      } else {
        const parsed = parseFloat(val);
        after = isNaN(parsed) || parsed <= 0 ? undefined : roundToFourDecimals(parsed);
      }
      if (after !== undefined) {
        inputLineHeight.value = String(after);
      } else {
        inputLineHeight.value = '';
        const autoVal = roundToFourDecimals(getTextLineHeight({ ...textNode, lineHeight: undefined }));
        inputLineHeight.placeholder = `Auto (${autoVal})`;
      }
      const before = initialTextTypographySnapshot?.lineHeight ?? textNode.lineHeight;
      stateManager.updateShape<Text>(textNode.id, { lineHeight: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { lineHeight: before }, { lineHeight: after });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
    }
  };

  const onLetterSpacingFocus = () => captureInitialTextTypography();
  const onLetterSpacingInput = () => {
    if (!inputLetterSpacing) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!initialTextTypographySnapshot) captureInitialTextTypography();
      const parsed = parseFloat(inputLetterSpacing.value);
      if (!isNaN(parsed)) {
        stateManager.updateShape<Text>(textNode.id, { letterSpacing: parsed });
      }
    }
  };

  const onLetterSpacingChange = () => {
    if (!inputLetterSpacing) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const parsed = parseFloat(inputLetterSpacing.value);
      const after = isNaN(parsed) ? 0 : roundToFourDecimals(parsed);
      inputLetterSpacing.value = String(after);
      const before = initialTextTypographySnapshot?.letterSpacing ?? textNode.letterSpacing ?? 0;
      stateManager.updateShape<Text>(textNode.id, { letterSpacing: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { letterSpacing: before }, { letterSpacing: after });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
    }
  };

  const onFontWeightChange = () => {
    if (!selectFontWeight) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = initialTextTypographySnapshot?.fontWeight ?? textNode.fontWeight ?? 400;
      const parsed = parseInt(selectFontWeight.value, 10);
      const after: FontWeight = isNaN(parsed) ? selectFontWeight.value : parsed;
      stateManager.updateShape<Text>(textNode.id, { fontWeight: after });
      if (String(before) !== String(after)) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { fontWeight: before }, { fontWeight: after });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
    }
  };

  const onFontStyleChange = () => {
    if (!selectFontStyle) return;
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = initialTextTypographySnapshot?.fontStyle ?? textNode.fontStyle ?? 'normal';
      const after = selectFontStyle.value as FontStyle;
      stateManager.updateShape<Text>(textNode.id, { fontStyle: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { fontStyle: before }, { fontStyle: after });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
    }
  };

  const applyTextAlign = (align: TextAlign) => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = initialTextTypographySnapshot?.textAlign ?? textNode.textAlign ?? 'left';
      stateManager.updateShape<Text>(textNode.id, { textAlign: align });
      if (before !== align) {
        const cmd = new UpdateTextTypographyCommand(stateManager, textNode.id, { textAlign: before }, { textAlign: align });
        commandManager.recordCommand(cmd);
      }
      initialTextTypographySnapshot = null;
      if (selectTextAlign) selectTextAlign.value = align;
      btnTextAlignLeft?.classList.toggle('active', align === 'left');
      btnTextAlignCenter?.classList.toggle('active', align === 'center');
      btnTextAlignRight?.classList.toggle('active', align === 'right');
    }
  };

  const onTextAlignChange = () => {
    if (!selectTextAlign) return;
    applyTextAlign(selectTextAlign.value as TextAlign);
  };
  const onTextAlignLeftClick = () => applyTextAlign('left');
  const onTextAlignCenterClick = () => applyTextAlign('center');
  const onTextAlignRightClick = () => applyTextAlign('right');

  const onTextColorInput = () => {
    if (!inputTextNative) return;
    previewTextColor(inputTextNative.value.toLowerCase());
  };
  const onTextColorChange = () => {
    if (!inputTextNative) return;
    commitTextColor(inputTextNative.value.toLowerCase());
  };

  let textColorInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  let isTextColorHexSubmitting = false;

  const handleTextColorHexCommit = () => {
    if (!inputTextHex) return;
    const text = inputTextHex.value;
    const parsed = parseHexColor(text);
    if (parsed !== null) {
      inputTextHex.removeAttribute('aria-invalid');
      commitTextColor(parsed);
      inputTextHex.value = parsed;
      syncPropertiesPanel();
    } else {
      if (textColorInvalidTimer) clearTimeout(textColorInvalidTimer);
      inputTextHex.setAttribute('aria-invalid', 'true');
      textColorInvalidTimer = setTimeout(() => {
        inputTextHex?.removeAttribute('aria-invalid');
        textColorInvalidTimer = null;
      }, 1000);

      const selectedNodes = stateManager.getSelectedNodes();
      if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
        const textNode = selectedNodes[0];
        const val = textNode.fill ?? '#000000';
        if (isNonePaint(val)) {
          inputTextHex.value = '';
          inputTextHex.placeholder = 'ninguno';
        } else {
          const hex = toValidHexColor(val, '#000000');
          inputTextHex.value = hex;
          inputTextHex.placeholder = hex;
        }
      }
      initialTextTypographySnapshot = null;
    }
  };

  const handleTextColorHexRevert = () => {
    if (!inputTextHex) return;
    inputTextHex.removeAttribute('aria-invalid');
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const val = textNode.fill ?? '#000000';
      if (isNonePaint(val)) {
        inputTextHex.value = '';
        inputTextHex.placeholder = 'ninguno';
      } else {
        const hex = toValidHexColor(val, '#000000');
        inputTextHex.value = hex;
        inputTextHex.placeholder = hex;
      }
    }
    initialTextTypographySnapshot = null;
  };

  const onTextColorHexFocus = () => captureInitialTextTypography();
  const onTextColorHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputTextHex) {
        isTextColorHexSubmitting = true;
        handleTextColorHexCommit();
        inputTextHex.blur();
        isTextColorHexSubmitting = false;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputTextHex) {
        isTextColorHexSubmitting = true;
        handleTextColorHexRevert();
        inputTextHex.blur();
        isTextColorHexSubmitting = false;
      }
    }
  };
  const onTextColorHexBlur = () => {
    if (isTextColorHexSubmitting) return;
    handleTextColorHexCommit();
  };

  const onTextColorNoneClick = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const currentFill = textNode.fill ?? '#000000';
      captureInitialTextTypography();
      if (!isNonePaint(currentFill)) {
        lastRememberedTextColor = toValidHexColor(currentFill, lastRememberedTextColor);
        commitTextColor('none');
      } else {
        commitTextColor(lastRememberedTextColor);
      }
    }
  };

  inputTextContent?.addEventListener('focus', onTextContentFocus);
  inputTextContent?.addEventListener('input', onTextContentInput);
  inputTextContent?.addEventListener('change', onTextContentChange);
  inputTextContent?.addEventListener('blur', onTextContentChange);

  selectFontFamily?.addEventListener('change', onFontFamilyChange);
  inputFontSize?.addEventListener('focus', onFontSizeFocus);
  inputFontSize?.addEventListener('input', onFontSizeInput);
  inputFontSize?.addEventListener('change', onFontSizeChange);
  inputFontSize?.addEventListener('blur', onFontSizeChange);

  inputLineHeight?.addEventListener('focus', onLineHeightFocus);
  inputLineHeight?.addEventListener('input', onLineHeightInput);
  inputLineHeight?.addEventListener('change', onLineHeightChange);
  inputLineHeight?.addEventListener('blur', onLineHeightChange);

  inputLetterSpacing?.addEventListener('focus', onLetterSpacingFocus);
  inputLetterSpacing?.addEventListener('input', onLetterSpacingInput);
  inputLetterSpacing?.addEventListener('change', onLetterSpacingChange);
  inputLetterSpacing?.addEventListener('blur', onLetterSpacingChange);

  selectFontWeight?.addEventListener('change', onFontWeightChange);
  selectFontStyle?.addEventListener('change', onFontStyleChange);

  selectTextAlign?.addEventListener('change', onTextAlignChange);
  btnTextAlignLeft?.addEventListener('click', onTextAlignLeftClick);
  btnTextAlignCenter?.addEventListener('click', onTextAlignCenterClick);
  btnTextAlignRight?.addEventListener('click', onTextAlignRightClick);

  inputTextNative?.addEventListener('mousedown', onInputStart);
  inputTextNative?.addEventListener('click', onInputStart);
  inputTextNative?.addEventListener('focus', onInputStart);
  inputTextNative?.addEventListener('input', onTextColorInput);
  inputTextNative?.addEventListener('change', onTextColorChange);

  inputTextHex?.addEventListener('focus', onTextColorHexFocus);
  inputTextHex?.addEventListener('keydown', onTextColorHexKeyDown);
  inputTextHex?.addEventListener('blur', onTextColorHexBlur);

  btnTextColorNone?.addEventListener('click', onTextColorNoneClick);

  // Mesa de trabajo
  const onArtboardRatioChange = () => {
    if (checkArtboardRatio?.checked) {
      const currentDoc = stateManager.getState();
      if (currentDoc.height > 0) {
        artboardAspectRatio = currentDoc.width / currentDoc.height;
      }
    }
  };

  const onArtboardFocus = () => {
    initialArtboardWidth = stateManager.getState().width;
    initialArtboardHeight = stateManager.getState().height;
    if (checkArtboardRatio?.checked && initialArtboardHeight > 0) {
      artboardAspectRatio = initialArtboardWidth / initialArtboardHeight;
    }
  };

  const onArtboardWidthInput = () => {
    if (!inputArtboardWidth) return;
    const parsed = parseFloat(inputArtboardWidth.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      if (checkArtboardRatio?.checked && artboardAspectRatio > 0) {
        const calculatedHeight = Math.max(1, Math.round(parsed / artboardAspectRatio));
        if (inputArtboardHeight) {
          inputArtboardHeight.value = String(calculatedHeight);
        }
        stateManager.setDocumentSize(parsed, calculatedHeight);
      } else {
        stateManager.setDocumentSize(parsed, stateManager.getState().height);
      }
    }
  };

  const onArtboardWidthChange = () => {
    if (!inputArtboardWidth) return;
    const parsed = parseFloat(inputArtboardWidth.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      inputArtboardWidth.value = String(stateManager.getState().width);
      stateManager.setDocumentSize(initialArtboardWidth, initialArtboardHeight);
      syncPropertiesPanel();
      return;
    }
    const targetWidth = parsed;
    inputArtboardWidth.value = String(targetWidth);

    let targetHeight = stateManager.getState().height;
    if (checkArtboardRatio?.checked && artboardAspectRatio > 0) {
      targetHeight = Math.max(1, Math.round(targetWidth / artboardAspectRatio));
      if (inputArtboardHeight) {
        inputArtboardHeight.value = String(targetHeight);
      }
    }

    if (targetWidth === initialArtboardWidth && targetHeight === initialArtboardHeight) {
      syncPropertiesPanel();
      return;
    }

    stateManager.setDocumentSize(initialArtboardWidth, initialArtboardHeight);
    const resizeCommand = new ResizeArtboardCommand(
      stateManager,
      initialArtboardWidth,
      initialArtboardHeight,
      targetWidth,
      targetHeight
    );
    resizeCommand.execute();
    commandManager.recordCommand(resizeCommand);
    initialArtboardWidth = targetWidth;
    initialArtboardHeight = targetHeight;
    syncPropertiesPanel();
  };

  const onArtboardWidthKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      inputArtboardWidth?.blur();
    } else if (e.key === 'Escape') {
      if (inputArtboardWidth) inputArtboardWidth.value = String(initialArtboardWidth);
      stateManager.setDocumentSize(initialArtboardWidth, initialArtboardHeight);
      inputArtboardWidth?.blur();
      syncPropertiesPanel();
    }
  };

  const onArtboardHeightInput = () => {
    if (!inputArtboardHeight) return;
    const parsed = parseFloat(inputArtboardHeight.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      if (checkArtboardRatio?.checked && artboardAspectRatio > 0) {
        const calculatedWidth = Math.max(1, Math.round(parsed * artboardAspectRatio));
        if (inputArtboardWidth) {
          inputArtboardWidth.value = String(calculatedWidth);
        }
        stateManager.setDocumentSize(calculatedWidth, parsed);
      } else {
        stateManager.setDocumentSize(stateManager.getState().width, parsed);
      }
    }
  };

  const onArtboardHeightChange = () => {
    if (!inputArtboardHeight) return;
    const parsed = parseFloat(inputArtboardHeight.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      inputArtboardHeight.value = String(stateManager.getState().height);
      stateManager.setDocumentSize(initialArtboardWidth, initialArtboardHeight);
      syncPropertiesPanel();
      return;
    }
    const targetHeight = parsed;
    inputArtboardHeight.value = String(targetHeight);

    let targetWidth = stateManager.getState().width;
    if (checkArtboardRatio?.checked && artboardAspectRatio > 0) {
      targetWidth = Math.max(1, Math.round(targetHeight * artboardAspectRatio));
      if (inputArtboardWidth) {
        inputArtboardWidth.value = String(targetWidth);
      }
    }

    if (targetWidth === initialArtboardWidth && targetHeight === initialArtboardHeight) {
      syncPropertiesPanel();
      return;
    }

    stateManager.setDocumentSize(initialArtboardWidth, initialArtboardHeight);
    const resizeCommand = new ResizeArtboardCommand(
      stateManager,
      initialArtboardWidth,
      initialArtboardHeight,
      targetWidth,
      targetHeight
    );
    resizeCommand.execute();
    commandManager.recordCommand(resizeCommand);
    initialArtboardWidth = targetWidth;
    initialArtboardHeight = targetHeight;
    syncPropertiesPanel();
  };

  const onArtboardHeightKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      inputArtboardHeight?.blur();
    } else if (e.key === 'Escape') {
      if (inputArtboardHeight) inputArtboardHeight.value = String(initialArtboardHeight);
      stateManager.setDocumentSize(initialArtboardWidth, initialArtboardHeight);
      inputArtboardHeight?.blur();
      syncPropertiesPanel();
    }
  };

  const onArtboardPresetChange = () => {
    if (!selectArtboardPreset) return;
    const presetId = selectArtboardPreset.value;
    if (presetId === 'custom') return;

    const preset = getPresetById(presetId);
    if (!preset) return;

    const doc = stateManager.getState();
    const prevWidth = doc.width;
    const prevHeight = doc.height;

    const resizeCommand = new ResizeArtboardCommand(
      stateManager,
      prevWidth,
      prevHeight,
      preset.width,
      preset.height
    );
    resizeCommand.execute();
    commandManager.recordCommand(resizeCommand);

    initialArtboardWidth = preset.width;
    initialArtboardHeight = preset.height;
    if (checkArtboardRatio?.checked && preset.height > 0) {
      artboardAspectRatio = preset.width / preset.height;
    }
    syncPropertiesPanel();
  };

  selectArtboardPreset?.addEventListener('change', onArtboardPresetChange);
  checkArtboardRatio?.addEventListener('change', onArtboardRatioChange);
  inputArtboardWidth?.addEventListener('focus', onArtboardFocus);
  inputArtboardWidth?.addEventListener('input', onArtboardWidthInput);
  inputArtboardWidth?.addEventListener('change', onArtboardWidthChange);
  inputArtboardWidth?.addEventListener('keydown', onArtboardWidthKeyDown as EventListener);
  inputArtboardHeight?.addEventListener('focus', onArtboardFocus);
  inputArtboardHeight?.addEventListener('input', onArtboardHeightInput);
  inputArtboardHeight?.addEventListener('change', onArtboardHeightChange);
  inputArtboardHeight?.addEventListener('keydown', onArtboardHeightKeyDown as EventListener);

  // Orden, duplicar, eliminar
  const onBringToFrontClick = () => inputController.bringToFront();
  const onSendToBackClick = () => inputController.sendToBack();
  const onDuplicateClick = () => inputController.duplicate();
  const onDeleteSelectionClick = () => {
    if (stateManager.getSelection().length > 0) {
      inputController.deleteSelected();
    }
  };

  btnBringToFront?.addEventListener('click', onBringToFrontClick);
  btnSendToBack?.addEventListener('click', onSendToBackClick);
  btnDuplicate?.addEventListener('click', onDuplicateClick);
  btnDeleteSelection?.addEventListener('click', onDeleteSelectionClick);

  // Puntos de trazado Bézier
  const onPointCornerClick = () => {
    inputController.setSelectedPathPointType('corner');
    syncPropertiesPanel();
  };
  const onPointSmoothClick = () => {
    inputController.setSelectedPathPointType('smooth');
    syncPropertiesPanel();
  };
  const onPointSymmetricClick = () => {
    inputController.setSelectedPathPointType('symmetric');
    syncPropertiesPanel();
  };
  const onDeleteAnchorClick = () => {
    inputController.deleteSelected();
    syncPropertiesPanel();
  };

  btnPointCorner?.addEventListener('click', onPointCornerClick);
  btnPointSmooth?.addEventListener('click', onPointSmoothClick);
  btnPointSymmetric?.addEventListener('click', onPointSymmetricClick);
  btnDeleteAnchor?.addEventListener('click', onDeleteAnchorClick);

  const onCanvasClickOrPointerUp = () => {
    syncPropertiesPanel();
  };
  canvas?.addEventListener('pointerup', onCanvasClickOrPointerUp);

  // Responsive panel toggle
  const onTogglePanelClick = () => {
    if (typeof document !== 'undefined' && document.body) {
      const isPanelOpen = document.body.classList.toggle('panel-open');
      btnTogglePanel?.setAttribute('aria-expanded', String(isPanelOpen));
    }
  };
  btnTogglePanel?.addEventListener('click', onTogglePanelClick);

  // Alineación y Pathfinder en el panel de propiedades
  const handleAlign = (mode: AlignmentMode) => () => {
    if (stateManager.getSelection().length >= 2) {
      inputController.alignSelection(mode);
      syncPropertiesPanel();
      onAlign?.(mode);
    }
  };

  const handleDistribute = (axis: DistributionAxis) => () => {
    if (stateManager.getSelection().length >= 3) {
      inputController.distributeSelection(axis);
      syncPropertiesPanel();
      onDistribute?.(axis);
    }
  };

  const handlePathfinder = (op: BooleanOp) => () => {
    inputController.applyBooleanOperation(op);
    syncPropertiesPanel();
    onPathfinder?.(op);
  };

  const onAlignLeft = handleAlign('left');
  const onAlignCenterH = handleAlign('center-h');
  const onAlignRight = handleAlign('right');
  const onAlignTop = handleAlign('top');
  const onAlignCenterV = handleAlign('center-v');
  const onAlignBottom = handleAlign('bottom');
  const onDistributeH = handleDistribute('horizontal');
  const onDistributeV = handleDistribute('vertical');

  const onPathfinderUnion = handlePathfinder('union');
  const onPathfinderSubtract = handlePathfinder('subtract');
  const onPathfinderIntersect = handlePathfinder('intersect');
  const onPathfinderExclude = handlePathfinder('exclude');

  btnAlignLeft?.addEventListener('click', onAlignLeft);
  btnAlignCenterH?.addEventListener('click', onAlignCenterH);
  btnAlignRight?.addEventListener('click', onAlignRight);
  btnAlignTop?.addEventListener('click', onAlignTop);
  btnAlignCenterV?.addEventListener('click', onAlignCenterV);
  btnAlignBottom?.addEventListener('click', onAlignBottom);
  btnDistributeH?.addEventListener('click', onDistributeH);
  btnDistributeV?.addEventListener('click', onDistributeV);

  btnPathfinderUnion?.addEventListener('click', onPathfinderUnion);
  btnPathfinderSubtract?.addEventListener('click', onPathfinderSubtract);
  btnPathfinderIntersect?.addEventListener('click', onPathfinderIntersect);
  btnPathfinderExclude?.addEventListener('click', onPathfinderExclude);

  // Secciones plegables con persistencia
  const collapsibleSections: HTMLElement[] =
    typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll<HTMLElement>('.collapsible-section'))
      : [];
  const sectionToggleHandlers: Array<{ element: HTMLElement; handler: () => void }> = [];

  collapsibleSections.forEach((section) => {
    if (!section.id) return;
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(`panel-section-${section.id}`);
        if (saved !== null && 'open' in section) {
          (section as HTMLDetailsElement).open = saved === 'true';
        }
      }
    } catch (_) {}

    const onToggle = () => {
      try {
        if (typeof sessionStorage !== 'undefined' && 'open' in section) {
          sessionStorage.setItem(`panel-section-${section.id}`, String((section as HTMLDetailsElement).open));
        }
      } catch (_) {}
    };

    section.addEventListener('toggle', onToggle);
    sectionToggleHandlers.push({ element: section, handler: onToggle });
  });

  return {
    syncPropertiesPanel,
    cleanup: () => {
      gradientEditor.cleanup();

      inputObjectX?.removeEventListener('change', onObjectXChange);
      inputObjectY?.removeEventListener('change', onObjectYChange);
      inputObjectWidth?.removeEventListener('change', onObjectWidthChange);
      inputObjectHeight?.removeEventListener('change', onObjectHeightChange);
      inputObjectRotation?.removeEventListener('change', onObjectRotationChange);
      inputObjectX?.removeEventListener('blur', onObjectGeometryBlur);
      inputObjectY?.removeEventListener('blur', onObjectGeometryBlur);
      inputObjectWidth?.removeEventListener('blur', onObjectGeometryBlur);
      inputObjectHeight?.removeEventListener('blur', onObjectGeometryBlur);
      inputObjectRotation?.removeEventListener('blur', onObjectGeometryBlur);

      inputCornerRadius?.removeEventListener('focus', onCornerRadiusFocus);
      inputCornerRadius?.removeEventListener('input', onCornerRadiusInput);
      inputCornerRadius?.removeEventListener('change', onCornerRadiusChange);
      inputCornerRadius?.removeEventListener('blur', onCornerRadiusBlur);

      inputFill?.removeEventListener('mousedown', onInputStart);
      inputFill?.removeEventListener('click', onInputStart);
      inputFill?.removeEventListener('focus', onInputStart);
      inputFill?.removeEventListener('input', onFillInput);
      inputFill?.removeEventListener('change', onFillChange);

      inputStroke?.removeEventListener('mousedown', onInputStart);
      inputStroke?.removeEventListener('click', onInputStart);
      inputStroke?.removeEventListener('focus', onInputStart);
      inputStroke?.removeEventListener('input', onStrokeInput);
      inputStroke?.removeEventListener('change', onStrokeChange);

      inputFillHex?.removeEventListener('focus', onFillHexFocus);
      inputFillHex?.removeEventListener('keydown', onFillHexKeyDown);
      inputFillHex?.removeEventListener('blur', onFillHexBlur);

      inputStrokeHex?.removeEventListener('focus', onStrokeHexFocus);
      inputStrokeHex?.removeEventListener('keydown', onStrokeHexKeyDown);
      inputStrokeHex?.removeEventListener('blur', onStrokeHexBlur);

      btnFillNone?.removeEventListener('click', onFillNoneClick);
      btnStrokeNone?.removeEventListener('click', onStrokeNoneClick);

      if (fillInvalidTimer) {
        clearTimeout(fillInvalidTimer);
        fillInvalidTimer = null;
      }
      if (strokeInvalidTimer) {
        clearTimeout(strokeInvalidTimer);
        strokeInvalidTimer = null;
      }

      inputStrokeWidth?.removeEventListener('mousedown', onInputStart);
      inputStrokeWidth?.removeEventListener('click', onInputStart);
      inputStrokeWidth?.removeEventListener('focus', onInputStart);
      inputStrokeWidth?.removeEventListener('input', onStrokeWidthInput);
      inputStrokeWidth?.removeEventListener('change', onStrokeWidthChange);
      selectStrokeDash?.removeEventListener('change', onStrokeDashChange);
      selectStrokeCap?.removeEventListener('change', onStrokeCapChange);
      selectStrokeJoin?.removeEventListener('change', onStrokeJoinChange);

      inputOpacity?.removeEventListener('mousedown', onInputStart);
      inputOpacity?.removeEventListener('click', onInputStart);
      inputOpacity?.removeEventListener('focus', onInputStart);
      inputOpacity?.removeEventListener('input', onOpacitySliderInput);
      inputOpacity?.removeEventListener('change', onOpacitySliderChange);
      inputOpacityValue?.removeEventListener('mousedown', onInputStart);
      inputOpacityValue?.removeEventListener('click', onInputStart);
      inputOpacityValue?.removeEventListener('focus', onInputStart);
      inputOpacityValue?.removeEventListener('input', onOpacityValueInput);
      inputOpacityValue?.removeEventListener('change', onOpacityValueChange);

      inputTextContent?.removeEventListener('focus', onTextContentFocus);
      inputTextContent?.removeEventListener('input', onTextContentInput);
      inputTextContent?.removeEventListener('change', onTextContentChange);
      inputTextContent?.removeEventListener('blur', onTextContentChange);

      selectFontFamily?.removeEventListener('change', onFontFamilyChange);

      inputFontSize?.removeEventListener('focus', onFontSizeFocus);
      inputFontSize?.removeEventListener('input', onFontSizeInput);
      inputFontSize?.removeEventListener('change', onFontSizeChange);
      inputFontSize?.removeEventListener('blur', onFontSizeChange);

      inputLineHeight?.removeEventListener('focus', onLineHeightFocus);
      inputLineHeight?.removeEventListener('input', onLineHeightInput);
      inputLineHeight?.removeEventListener('change', onLineHeightChange);
      inputLineHeight?.removeEventListener('blur', onLineHeightChange);

      inputLetterSpacing?.removeEventListener('focus', onLetterSpacingFocus);
      inputLetterSpacing?.removeEventListener('input', onLetterSpacingInput);
      inputLetterSpacing?.removeEventListener('change', onLetterSpacingChange);
      inputLetterSpacing?.removeEventListener('blur', onLetterSpacingChange);

      selectFontWeight?.removeEventListener('change', onFontWeightChange);
      selectFontStyle?.removeEventListener('change', onFontStyleChange);

      selectTextAlign?.removeEventListener('change', onTextAlignChange);
      btnTextAlignLeft?.removeEventListener('click', onTextAlignLeftClick);
      btnTextAlignCenter?.removeEventListener('click', onTextAlignCenterClick);
      btnTextAlignRight?.removeEventListener('click', onTextAlignRightClick);

      inputTextNative?.removeEventListener('mousedown', onInputStart);
      inputTextNative?.removeEventListener('click', onInputStart);
      inputTextNative?.removeEventListener('focus', onInputStart);
      inputTextNative?.removeEventListener('input', onTextColorInput);
      inputTextNative?.removeEventListener('change', onTextColorChange);

      inputTextHex?.removeEventListener('focus', onTextColorHexFocus);
      inputTextHex?.removeEventListener('keydown', onTextColorHexKeyDown);
      inputTextHex?.removeEventListener('blur', onTextColorHexBlur);

      btnTextColorNone?.removeEventListener('click', onTextColorNoneClick);

      if (textColorInvalidTimer) {
        clearTimeout(textColorInvalidTimer);
        textColorInvalidTimer = null;
      }

      selectArtboardPreset?.removeEventListener('change', onArtboardPresetChange);
      checkArtboardRatio?.removeEventListener('change', onArtboardRatioChange);

      inputArtboardWidth?.removeEventListener('focus', onArtboardFocus);
      inputArtboardWidth?.removeEventListener('input', onArtboardWidthInput);
      inputArtboardWidth?.removeEventListener('change', onArtboardWidthChange);
      inputArtboardWidth?.removeEventListener('keydown', onArtboardWidthKeyDown as EventListener);

      inputArtboardHeight?.removeEventListener('focus', onArtboardFocus);
      inputArtboardHeight?.removeEventListener('input', onArtboardHeightInput);
      inputArtboardHeight?.removeEventListener('change', onArtboardHeightChange);
      inputArtboardHeight?.removeEventListener('keydown', onArtboardHeightKeyDown as EventListener);

      btnBringToFront?.removeEventListener('click', onBringToFrontClick);
      btnSendToBack?.removeEventListener('click', onSendToBackClick);
      btnDuplicate?.removeEventListener('click', onDuplicateClick);
      btnDeleteSelection?.removeEventListener('click', onDeleteSelectionClick);
      btnPointCorner?.removeEventListener('click', onPointCornerClick);
      btnPointSmooth?.removeEventListener('click', onPointSmoothClick);
      btnPointSymmetric?.removeEventListener('click', onPointSymmetricClick);
      btnDeleteAnchor?.removeEventListener('click', onDeleteAnchorClick);
      canvas?.removeEventListener('pointerup', onCanvasClickOrPointerUp);
      btnTogglePanel?.removeEventListener('click', onTogglePanelClick);

      btnAlignLeft?.removeEventListener('click', onAlignLeft);
      btnAlignCenterH?.removeEventListener('click', onAlignCenterH);
      btnAlignRight?.removeEventListener('click', onAlignRight);
      btnAlignTop?.removeEventListener('click', onAlignTop);
      btnAlignCenterV?.removeEventListener('click', onAlignCenterV);
      btnAlignBottom?.removeEventListener('click', onAlignBottom);
      btnDistributeH?.removeEventListener('click', onDistributeH);
      btnDistributeV?.removeEventListener('click', onDistributeV);

      btnPathfinderUnion?.removeEventListener('click', onPathfinderUnion);
      btnPathfinderSubtract?.removeEventListener('click', onPathfinderSubtract);
      btnPathfinderIntersect?.removeEventListener('click', onPathfinderIntersect);
      btnPathfinderExclude?.removeEventListener('click', onPathfinderExclude);

      for (const { element, handler } of sectionToggleHandlers) {
        element.removeEventListener('toggle', handler);
      }
    },
  };
}
