import type { StateManager, ShapeStyleEntry } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { StyleShapesCommand, type ShapeStyleChangeEntry } from '../../commands/StyleShapesCommand.ts';
import { StyleCommand } from '../../commands/StyleCommand.ts';
import { BatchCommand } from '../../commands/BatchCommand.ts';
import type {
  FillType,
  Shape,
  BlendMode,
  StrokeLineCap,
  StrokeLineJoin,
} from '../../types/scene-graph.ts';
import {
  getPaintState,
  parseHexColor,
  isNonePaint,
  normalizeColor,
  type PaintState,
} from '../../utils/color.ts';
import { colorWithOpacity } from '../../utils/gradient.ts';
import {
  toValidHexColor,
  dashArrayToSelectValue,
  selectValueToDashArray,
} from '../uiUtils.ts';
import { canOutlineStroke } from '../../utils/strokeToPath.ts';
import { setupGradientEditor } from '../GradientEditorController.ts';
import type { PropertiesPanelElements } from './types.ts';
import { markInputTarget, isInputTargetValid, clearInputTarget } from './types.ts';
import type { StyleSnapshotManager } from './StyleSnapshotManager.ts';

export class AppearanceSectionController {
  private lastRememberedFill = '#38bdf8';
  private lastRememberedStroke = '#0284c7';
  private fillInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  private strokeInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  private isFillHexSubmitting = false;
  private isStrokeHexSubmitting = false;
  private readonly gradientEditor: ReturnType<typeof setupGradientEditor>;
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly elements: PropertiesPanelElements;
  private readonly styleSnapshotManager: StyleSnapshotManager;
  private readonly syncPropertiesPanel: () => void;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    elements: PropertiesPanelElements,
    styleSnapshotManager: StyleSnapshotManager,
    syncPropertiesPanel: () => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.elements = elements;
    this.styleSnapshotManager = styleSnapshotManager;
    this.syncPropertiesPanel = syncPropertiesPanel;

    this.gradientEditor = setupGradientEditor(this.stateManager, {
      getCurrentPaintState: (property, leafShapes) => this.getCurrentPaintState(property, leafShapes),
      commitColor: (property, color) => this.commitColor(property, color),
      previewColor: (property, color) => this.previewColor(property, color),
      captureInitialStyle: () => {
        this.styleSnapshotManager.capture();
      },
      syncPropertiesPanel: () => this.syncPropertiesPanel(),
      getLastRememberedFill: () => this.lastRememberedFill,
    });
  }


  public getCurrentPaintState(property: 'fill' | 'stroke', leafShapes: readonly Shape[]): PaintState {
    if (leafShapes.length > 0) {
      return getPaintState(leafShapes, property);
    }
    const val = this.stateManager.getDrawingStyle()[property];
    if (isNonePaint(val)) {
      return { kind: 'none' };
    }
    if (typeof val === 'object' && val !== null && 'type' in val) {
      return { kind: 'gradient', gradient: val as any };
    }
    const hex = normalizeColor(val as string);
    return hex ? { kind: 'color', hex } : { kind: 'none' };
  }

  public clearSnapshot(): void {
    this.styleSnapshotManager.clear();
  }

  private isTargetValid(leafShapes: readonly Shape[], targetEl?: EventTarget | null): boolean {
    if (targetEl && !isInputTargetValid(targetEl, leafShapes)) {
      return false;
    }
    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    if (initialStyleSnapshots) {
      if (
        leafShapes.length !== initialStyleSnapshots.size ||
        !leafShapes.every((s) => initialStyleSnapshots.has(s.id))
      ) {
        return false;
      }
    }
    return true;
  }

  public previewColor(property: 'fill' | 'stroke', color: FillType, targetEl?: EventTarget | null): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (!this.isTargetValid(leafShapes, targetEl)) {
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }
    if (leafShapes.length === 0) {
      this.stateManager.setDrawingStyle({ [property]: color });
      return;
    }
    this.stateManager.setDrawingStyle({ [property]: color });
    if (!this.styleSnapshotManager.hasSnapshots()) {
      this.styleSnapshotManager.capture();
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
    this.stateManager.updateShapesStyle(entries);
    if (property === 'fill' && this.elements.swatchTextColorPreview && this.elements.inputTextHex) {
      const hex = typeof color === 'string' && !isNonePaint(color) ? toValidHexColor(color, '#000000') : '';
      if (hex) {
        this.elements.swatchTextColorPreview.className = 'color-swatch-preview';
        this.elements.swatchTextColorPreview.style.backgroundColor = hex;
        if (typeof document === 'undefined' || document.activeElement !== this.elements.inputTextHex) {
          this.elements.inputTextHex.value = hex;
          this.elements.inputTextHex.placeholder = hex;
        }
      }
    }
  }

  public commitColor(property: 'fill' | 'stroke', color: FillType, targetEl?: EventTarget | null): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (leafShapes.length === 0) {
      const needsStrokeWidth =
        property === 'stroke' &&
        !isNonePaint(color) &&
        this.stateManager.getDrawingStyle().strokeWidth <= 0;
      this.stateManager.setDrawingStyle({
        [property]: color,
        ...(needsStrokeWidth ? { strokeWidth: 1 } : {}),
      });
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      return;
    }
    if (!this.isTargetValid(leafShapes, targetEl)) {
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }
    const needsStrokeWidthDefault =
      property === 'stroke' &&
      !isNonePaint(color) &&
      this.stateManager.getDrawingStyle().strokeWidth <= 0;
    this.stateManager.setDrawingStyle({
      [property]: color,
      ...(needsStrokeWidthDefault ? { strokeWidth: 1 } : {}),
    });

    if (!this.styleSnapshotManager.hasSnapshots()) {
      this.styleSnapshotManager.capture();
    }

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
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

    this.stateManager.updateShapesStyle(entries.map((e) => ({ id: e.id, style: e.after })));
    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) {
      this.commandManager.recordCommand(command);
    }
    this.clearSnapshot();
    this.syncPropertiesPanel();
  }

  private onInputStart = (e?: Event) => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (e?.currentTarget) {
      markInputTarget(e.currentTarget, leafShapes);
    }
    this.styleSnapshotManager.capture();
  };

  private onFillInput = (e?: Event) => {
    if (!this.elements.inputFill) return;
    const color = this.elements.inputFill.value.toLowerCase();
    this.previewColor('fill', color, e?.currentTarget);
    if (this.elements.swatchFillPreview) {
      this.elements.swatchFillPreview.className = 'color-swatch-preview';
      this.elements.swatchFillPreview.style.backgroundColor = color;
    }
    if (this.elements.inputFillHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputFillHex)) {
      this.elements.inputFillHex.value = color;
      this.elements.inputFillHex.placeholder = color;
    }
    this.elements.btnFillNone?.setAttribute('aria-pressed', 'false');
  };

  private onStrokeInput = (e?: Event) => {
    if (!this.elements.inputStroke) return;
    const color = this.elements.inputStroke.value.toLowerCase();
    this.previewColor('stroke', color, e?.currentTarget);
    if (this.elements.swatchStrokePreview) {
      this.elements.swatchStrokePreview.className = 'color-swatch-preview';
      this.elements.swatchStrokePreview.style.backgroundColor = color;
    }
    if (this.elements.inputStrokeHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputStrokeHex)) {
      this.elements.inputStrokeHex.value = color;
      this.elements.inputStrokeHex.placeholder = color;
    }
    this.elements.btnStrokeNone?.setAttribute('aria-pressed', 'false');
  };

  private onStrokeWidthInput = (e?: Event) => {
    if (!this.elements.inputStrokeWidth) return;
    const parsed = parseFloat(this.elements.inputStrokeWidth.value);
    const strokeWidth = isNaN(parsed) ? 1 : Math.max(0, parsed);

    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (!this.isTargetValid(leafShapes, e?.currentTarget)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      return;
    }
    if (leafShapes.length === 0) {
      this.stateManager.setDrawingStyle({ strokeWidth });
      return;
    }
    this.stateManager.setDrawingStyle({ strokeWidth });
    if (!this.styleSnapshotManager.hasSnapshots()) {
      this.styleSnapshotManager.capture();
    }
    for (const shape of leafShapes) {
      this.stateManager.updateShape(shape.id, { strokeWidth });
    }
  };

  private onOpacityInput = (source: HTMLInputElement, e?: Event) => {
    const parsed = Number(source.value);
    if (source.value.trim() === '' || !Number.isFinite(parsed)) return;
    const percent = Math.round(Math.max(0, Math.min(100, parsed)));
    const opacity = percent / 100;
    if (this.elements.inputOpacity) this.elements.inputOpacity.value = String(percent);
    if (this.elements.inputOpacityValue && source !== this.elements.inputOpacityValue) this.elements.inputOpacityValue.value = String(percent);
    if (!Number.isFinite(opacity)) return;

    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (!this.isTargetValid(leafShapes, e?.currentTarget ?? source)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      clearInputTarget(source);
      this.clearSnapshot();
      return;
    }
    this.stateManager.setDrawingStyle({ opacity });
    if (leafShapes.length === 0) return;

    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();
    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { opacity },
    })));
  };

  private onOpacityChange = (source: HTMLInputElement, e?: Event) => {
    const parsed = Number(source.value);
    if (source.value.trim() === '' || !Number.isFinite(parsed)) {
      this.syncPropertiesPanel();
      return;
    }
    const percent = Math.round(Math.max(0, Math.min(100, parsed)));
    const opacity = percent / 100;
    if (this.elements.inputOpacity) this.elements.inputOpacity.value = String(percent);
    if (this.elements.inputOpacityValue) this.elements.inputOpacityValue.value = String(percent);
    if (!Number.isFinite(opacity)) return;

    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (!this.isTargetValid(leafShapes, e?.currentTarget ?? source)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      clearInputTarget(source);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }
    this.stateManager.setDrawingStyle({ opacity });
    if (leafShapes.length === 0) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      clearInputTarget(source);
      this.clearSnapshot();
      return;
    }
    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { opacity: initialStyleSnapshots?.get(shape.id)?.opacity ?? shape.opacity ?? 1 },
      after: { opacity },
    }));
    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { opacity },
    })));
    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) this.commandManager.recordCommand(command);
    if (e?.currentTarget) clearInputTarget(e.currentTarget);
    clearInputTarget(source);
    this.clearSnapshot();
  };

  private onOpacitySliderInput = (e?: Event) => this.elements.inputOpacity && this.onOpacityInput(this.elements.inputOpacity, e);
  private onOpacitySliderChange = (e?: Event) => this.elements.inputOpacity && this.onOpacityChange(this.elements.inputOpacity, e);
  private onOpacityValueInput = (e?: Event) => this.elements.inputOpacityValue && this.onOpacityInput(this.elements.inputOpacityValue, e);
  private onOpacityValueChange = (e?: Event) => this.elements.inputOpacityValue && this.onOpacityChange(this.elements.inputOpacityValue, e);

  private onBlendModeChange = (e?: Event) => {
    if (!this.elements.selectBlendMode) return;
    const mode = this.elements.selectBlendMode.value as BlendMode;
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (!this.isTargetValid(leafShapes, e?.currentTarget)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }

    this.stateManager.setDrawingStyle({ blendMode: mode });
    if (leafShapes.length === 0) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      return;
    }
    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { blendMode: initialStyleSnapshots?.get(shape.id)?.blendMode ?? shape.blendMode ?? 'normal' },
      after: { blendMode: mode },
    }));

    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { blendMode: mode },
    })));

    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) this.commandManager.recordCommand(command);
    if (e?.currentTarget) clearInputTarget(e.currentTarget);
    this.clearSnapshot();
  };

  private handleHexCommit = (property: 'fill' | 'stroke', inputEl: HTMLInputElement) => {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (!this.isTargetValid(leafShapes, inputEl)) {
      clearInputTarget(inputEl);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }
    const text = inputEl.value;
    const parsed = parseHexColor(text);
    if (parsed !== null) {
      inputEl.removeAttribute('aria-invalid');
      this.commitColor(property, parsed, inputEl);
      inputEl.value = parsed;
      this.syncPropertiesPanel();
    } else {
      if (property === 'fill') {
        if (this.fillInvalidTimer) clearTimeout(this.fillInvalidTimer);
        inputEl.setAttribute('aria-invalid', 'true');
        this.fillInvalidTimer = setTimeout(() => {
          inputEl.removeAttribute('aria-invalid');
          this.fillInvalidTimer = null;
        }, 1000);
      } else {
        if (this.strokeInvalidTimer) clearTimeout(this.strokeInvalidTimer);
        inputEl.setAttribute('aria-invalid', 'true');
        this.strokeInvalidTimer = setTimeout(() => {
          inputEl.removeAttribute('aria-invalid');
          this.strokeInvalidTimer = null;
        }, 1000);
      }

      const paintState = this.getCurrentPaintState(property, leafShapes);
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
      clearInputTarget(inputEl);
      this.clearSnapshot();
    }
  };

  private handleHexRevert = (property: 'fill' | 'stroke', inputEl: HTMLInputElement) => {
    inputEl.removeAttribute('aria-invalid');
    clearInputTarget(inputEl);
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = this.getCurrentPaintState(property, leafShapes);
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
    this.clearSnapshot();
  };

  private onFillHexFocus = (e?: Event) => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (e?.currentTarget) {
      markInputTarget(e.currentTarget, leafShapes);
    }
    this.styleSnapshotManager.capture();
  };
  private onFillHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.elements.inputFillHex) {
        this.isFillHexSubmitting = true;
        this.handleHexCommit('fill', this.elements.inputFillHex);
        this.elements.inputFillHex.blur();
        this.isFillHexSubmitting = false;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.elements.inputFillHex) {
        this.isFillHexSubmitting = true;
        this.handleHexRevert('fill', this.elements.inputFillHex);
        this.elements.inputFillHex.blur();
        this.isFillHexSubmitting = false;
      }
    }
  };
  private onFillHexBlur = () => {
    if (this.isFillHexSubmitting) return;
    if (this.elements.inputFillHex) this.handleHexCommit('fill', this.elements.inputFillHex);
  };

  private onStrokeHexFocus = (e?: Event) => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (e?.currentTarget) {
      markInputTarget(e.currentTarget, leafShapes);
    }
    this.styleSnapshotManager.capture();
  };
  private onStrokeHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.elements.inputStrokeHex) {
        this.isStrokeHexSubmitting = true;
        this.handleHexCommit('stroke', this.elements.inputStrokeHex);
        this.elements.inputStrokeHex.blur();
        this.isStrokeHexSubmitting = false;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.elements.inputStrokeHex) {
        this.isStrokeHexSubmitting = true;
        this.handleHexRevert('stroke', this.elements.inputStrokeHex);
        this.elements.inputStrokeHex.blur();
        this.isStrokeHexSubmitting = false;
      }
    }
  };
  private onStrokeHexBlur = () => {
    if (this.isStrokeHexSubmitting) return;
    if (this.elements.inputStrokeHex) this.handleHexCommit('stroke', this.elements.inputStrokeHex);
  };

  private onFillNoneClick = (e?: Event) => {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (e?.currentTarget) {
      markInputTarget(e.currentTarget, leafShapes);
    }
    if (leafShapes.length === 0) {
      const currentFill = this.stateManager.getDrawingStyle().fill;
      if (!isNonePaint(currentFill)) {
        this.lastRememberedFill = toValidHexColor(currentFill, this.lastRememberedFill);
        this.commitColor('fill', 'none', e?.currentTarget);
      } else {
        this.commitColor('fill', this.lastRememberedFill, e?.currentTarget);
      }
      return;
    }
    this.styleSnapshotManager.capture();
    const fillState = getPaintState(leafShapes, 'fill');
    if (fillState.kind === 'color' || fillState.kind === 'mixed') {
      if (fillState.kind === 'color') {
        this.lastRememberedFill = fillState.hex;
      }
      this.commitColor('fill', 'none', e?.currentTarget);
    } else {
      this.commitColor('fill', this.lastRememberedFill, e?.currentTarget);
    }
  };

  private onStrokeNoneClick = (e?: Event) => {
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    if (e?.currentTarget) {
      markInputTarget(e.currentTarget, leafShapes);
    }
    if (leafShapes.length === 0) {
      const currentStroke = this.stateManager.getDrawingStyle().stroke;
      if (!isNonePaint(currentStroke)) {
        this.lastRememberedStroke = toValidHexColor(currentStroke, this.lastRememberedStroke);
        this.commitColor('stroke', 'none', e?.currentTarget);
      } else {
        this.commitColor('stroke', this.lastRememberedStroke, e?.currentTarget);
      }
      return;
    }
    this.styleSnapshotManager.capture();
    const strokeState = getPaintState(leafShapes, 'stroke');
    if (strokeState.kind === 'color' || strokeState.kind === 'mixed') {
      if (strokeState.kind === 'color') {
        this.lastRememberedStroke = strokeState.hex;
      }
      this.commitColor('stroke', 'none', e?.currentTarget);
    } else {
      this.commitColor('stroke', this.lastRememberedStroke, e?.currentTarget);
    }
  };

  private onFillChange = (e?: Event) => {
    if (!this.elements.inputFill) return;
    this.commitColor('fill', this.elements.inputFill.value.toLowerCase(), e?.currentTarget);
  };

  private onStrokeChange = (e?: Event) => {
    if (!this.elements.inputStroke) return;
    this.commitColor('stroke', this.elements.inputStroke.value.toLowerCase(), e?.currentTarget);
  };

  private onStrokeWidthChange = (e?: Event) => {
    if (!this.elements.inputStrokeWidth) return;
    const parsed = parseFloat(this.elements.inputStrokeWidth.value);
    const finalVal = isNaN(parsed) ? 1 : Math.max(0, parsed);
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    if (leafShapes.length === 0) {
      this.stateManager.setDrawingStyle({ strokeWidth: finalVal });
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      return;
    }

    if (!this.isTargetValid(leafShapes, e?.currentTarget)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }

    this.stateManager.setDrawingStyle({ strokeWidth: finalVal });
    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    const commands: StyleCommand[] = [];
    for (const shape of leafShapes) {
      const shapeStrokeWidth = 'strokeWidth' in shape ? (shape as { strokeWidth?: number }).strokeWidth : undefined;
      const initialVal = initialStyleSnapshots?.get(shape.id)?.strokeWidth ?? shapeStrokeWidth;
      this.stateManager.updateShape(shape.id, { strokeWidth: finalVal });
      if (initialVal !== finalVal) {
        commands.push(
          new StyleCommand(
            this.stateManager,
            shape.id,
            { strokeWidth: initialVal },
            { strokeWidth: finalVal }
          )
        );
      }
    }

    if (commands.length === 1) {
      this.commandManager.recordCommand(commands[0]);
    } else if (commands.length > 1) {
      this.commandManager.recordCommand(new BatchCommand(commands, 'Style Stroke Width'));
    }
    if (e?.currentTarget) clearInputTarget(e.currentTarget);
    this.clearSnapshot();
  };

  private onStrokeDashChange = (e?: Event) => {
    if (!this.elements.selectStrokeDash) return;
    const val = this.elements.selectStrokeDash.value;
    const dashArray = selectValueToDashArray(val);
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    this.stateManager.setDrawingStyle({ strokeDashArray: dashArray });
    if (leafShapes.length === 0) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      return;
    }

    if (!this.isTargetValid(leafShapes, e?.currentTarget)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }
    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { strokeDashArray: initialStyleSnapshots?.get(shape.id)?.strokeDashArray ?? shape.strokeDashArray },
      after: { strokeDashArray: dashArray },
    }));

    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { strokeDashArray: dashArray },
    })));

    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) this.commandManager.recordCommand(command);
    if (e?.currentTarget) clearInputTarget(e.currentTarget);
    this.clearSnapshot();
  };

  private onStrokeCapChange = (e?: Event) => {
    if (!this.elements.selectStrokeCap) return;
    const cap = this.elements.selectStrokeCap.value as StrokeLineCap;
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    this.stateManager.setDrawingStyle({ strokeLineCap: cap });
    if (leafShapes.length === 0) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      return;
    }

    if (!this.isTargetValid(leafShapes, e?.currentTarget)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }

    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { strokeLineCap: initialStyleSnapshots?.get(shape.id)?.strokeLineCap ?? shape.strokeLineCap ?? 'butt' },
      after: { strokeLineCap: cap },
    }));

    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { strokeLineCap: cap },
    })));

    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) this.commandManager.recordCommand(command);
    if (e?.currentTarget) clearInputTarget(e.currentTarget);
    this.clearSnapshot();
  };

  private onStrokeJoinChange = (e?: Event) => {
    if (!this.elements.selectStrokeJoin) return;
    const join = this.elements.selectStrokeJoin.value as StrokeLineJoin;
    const selectedNodes = this.stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);

    this.stateManager.setDrawingStyle({ strokeLineJoin: join });
    if (leafShapes.length === 0) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      return;
    }

    if (!this.isTargetValid(leafShapes, e?.currentTarget)) {
      if (e?.currentTarget) clearInputTarget(e.currentTarget);
      this.clearSnapshot();
      this.syncPropertiesPanel();
      return;
    }

    if (!this.styleSnapshotManager.hasSnapshots()) this.styleSnapshotManager.capture();

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { strokeLineJoin: initialStyleSnapshots?.get(shape.id)?.strokeLineJoin ?? shape.strokeLineJoin ?? 'miter' },
      after: { strokeLineJoin: join },
    }));

    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { strokeLineJoin: join },
    })));

    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) this.commandManager.recordCommand(command);
    if (e?.currentTarget) clearInputTarget(e.currentTarget);
    this.clearSnapshot();
  };

  public sync(leafShapes: readonly Shape[], hasSelection: boolean): void {
    const firstShape = leafShapes[0];
    const defaultStyle = hasSelection ? null : this.stateManager.getDrawingStyle();
    const isEditing = this.styleSnapshotManager.hasSnapshots();

    const fillState = this.getCurrentPaintState('fill', leafShapes);
    const strokeState = this.getCurrentPaintState('stroke', leafShapes);

    if (fillState.kind === 'color') {
      this.lastRememberedFill = fillState.hex;
    }
    if (strokeState.kind === 'color') {
      this.lastRememberedStroke = strokeState.hex;
    }

    this.gradientEditor.renderGradientControls(fillState);

    if (this.elements.swatchFillPreview) {
      if (fillState.kind === 'none') {
        this.elements.swatchFillPreview.className = 'color-swatch-preview state-none';
        this.elements.swatchFillPreview.style.backgroundColor = 'transparent';
        this.elements.swatchFillPreview.style.backgroundImage = 'none';
      } else if (fillState.kind === 'mixed') {
        this.elements.swatchFillPreview.className = 'color-swatch-preview state-mixed';
        this.elements.swatchFillPreview.style.backgroundColor = 'transparent';
        this.elements.swatchFillPreview.style.backgroundImage = 'none';
      } else if (fillState.kind === 'gradient') {
        this.elements.swatchFillPreview.className = 'color-swatch-preview';
        const sortedStops = [...fillState.gradient.stops].sort((a, b) => a.offset - b.offset);
        const cssStops = sortedStops
          .map((s) => `${colorWithOpacity(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
          .join(', ');
        this.elements.swatchFillPreview.style.backgroundImage = `linear-gradient(to right, ${cssStops})`;
        this.elements.swatchFillPreview.style.backgroundColor = 'transparent';
      } else {
        this.elements.swatchFillPreview.className = 'color-swatch-preview';
        this.elements.swatchFillPreview.style.backgroundColor = fillState.hex;
        this.elements.swatchFillPreview.style.backgroundImage = 'none';
      }
    }

    if (this.elements.inputFill && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputFill))) {
      this.elements.inputFill.value =
        fillState.kind === 'color'
          ? fillState.hex
          : toValidHexColor(firstShape?.fill ?? defaultStyle?.fill, this.lastRememberedFill);
    }

    if (this.elements.inputFillHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputFillHex)) {
      if (fillState.kind === 'none') {
        this.elements.inputFillHex.value = '';
        this.elements.inputFillHex.placeholder = 'ninguno';
      } else if (fillState.kind === 'mixed') {
        this.elements.inputFillHex.value = '';
        this.elements.inputFillHex.placeholder = 'Mixto';
      } else if (fillState.kind === 'gradient') {
        this.elements.inputFillHex.value = '';
        this.elements.inputFillHex.placeholder = fillState.gradient.type === 'linear' ? 'Gradiente lineal' : 'Gradiente radial';
      } else {
        this.elements.inputFillHex.value = fillState.hex;
        this.elements.inputFillHex.placeholder = fillState.hex;
      }
    }

    if (this.elements.btnFillNone) {
      this.elements.btnFillNone.setAttribute('aria-pressed', String(fillState.kind === 'none'));
    }

    if (this.elements.swatchStrokePreview) {
      if (strokeState.kind === 'none') {
        this.elements.swatchStrokePreview.className = 'color-swatch-preview state-none';
        this.elements.swatchStrokePreview.style.backgroundColor = 'transparent';
      } else if (strokeState.kind === 'mixed') {
        this.elements.swatchStrokePreview.className = 'color-swatch-preview state-mixed';
        this.elements.swatchStrokePreview.style.backgroundColor = 'transparent';
      } else if (strokeState.kind === 'gradient') {
        this.elements.swatchStrokePreview.className = 'color-swatch-preview';
        this.elements.swatchStrokePreview.style.backgroundColor = toValidHexColor(strokeState.gradient);
      } else {
        this.elements.swatchStrokePreview.className = 'color-swatch-preview';
        this.elements.swatchStrokePreview.style.backgroundColor = strokeState.hex;
      }
    }

    const firstShapeStroke =
      firstShape && 'stroke' in firstShape ? (firstShape as { stroke?: FillType }).stroke : undefined;

    if (this.elements.inputStroke && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputStroke))) {
      this.elements.inputStroke.value =
        strokeState.kind === 'color'
          ? strokeState.hex
          : toValidHexColor(firstShapeStroke ?? defaultStyle?.stroke, this.lastRememberedStroke);
    }

    if (this.elements.inputStrokeHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputStrokeHex)) {
      if (strokeState.kind === 'none') {
        this.elements.inputStrokeHex.value = '';
        this.elements.inputStrokeHex.placeholder = 'ninguno';
      } else if (strokeState.kind === 'mixed') {
        this.elements.inputStrokeHex.value = '';
        this.elements.inputStrokeHex.placeholder = 'Mixto';
      } else if (strokeState.kind === 'gradient') {
        this.elements.inputStrokeHex.value = '';
        this.elements.inputStrokeHex.placeholder = strokeState.gradient.type === 'linear' ? 'Gradiente lineal' : 'Gradiente radial';
      } else {
        this.elements.inputStrokeHex.value = strokeState.hex;
        this.elements.inputStrokeHex.placeholder = strokeState.hex;
      }
    }

    if (this.elements.btnStrokeNone) {
      this.elements.btnStrokeNone.setAttribute('aria-pressed', String(strokeState.kind === 'none'));
    }

    if (this.elements.inputStrokeWidth && (!isEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputStrokeWidth))) {
      this.elements.inputStrokeWidth.value = String(firstShape ? (('strokeWidth' in firstShape ? (firstShape as { strokeWidth?: number }).strokeWidth : undefined) ?? 1) : (defaultStyle?.strokeWidth ?? 2));
    }

    if (this.elements.selectStrokeDash && (typeof document === 'undefined' || document.activeElement !== this.elements.selectStrokeDash)) {
      const activeDash = firstShape ? firstShape.strokeDashArray : defaultStyle?.strokeDashArray;
      this.elements.selectStrokeDash.value = dashArrayToSelectValue(activeDash);
    }

    if (this.elements.selectStrokeCap && (typeof document === 'undefined' || document.activeElement !== this.elements.selectStrokeCap)) {
      const activeCap = firstShape ? firstShape.strokeLineCap : defaultStyle?.strokeLineCap;
      this.elements.selectStrokeCap.value = activeCap ?? 'butt';
    }

    if (this.elements.selectStrokeJoin && (typeof document === 'undefined' || document.activeElement !== this.elements.selectStrokeJoin)) {
      const activeJoin = firstShape ? firstShape.strokeLineJoin : defaultStyle?.strokeLineJoin;
      this.elements.selectStrokeJoin.value = activeJoin ?? 'miter';
    }

    if (this.elements.btnOutlineStroke) {
      const canOutline = leafShapes.some(canOutlineStroke);
      this.elements.btnOutlineStroke.disabled = !canOutline;
      this.elements.btnOutlineStroke.setAttribute('aria-disabled', String(!canOutline));
      this.elements.btnOutlineStroke.style.opacity = canOutline ? '1' : '0.45';
      this.elements.btnOutlineStroke.style.pointerEvents = canOutline ? 'auto' : 'none';
    }

    const opacities = leafShapes.map((shape) => shape.opacity ?? 1);
    const isOpacityMixed = opacities.some((opacity) => opacity !== opacities[0]);
    const displayedOpacity = opacities.length > 0 ? opacities[0] : (defaultStyle?.opacity ?? 1);
    if (this.elements.inputOpacity && (typeof document === 'undefined' || document.activeElement !== this.elements.inputOpacity)) {
      this.elements.inputOpacity.value = String(Math.round(displayedOpacity * 100));
    }
    if (this.elements.inputOpacityValue && (typeof document === 'undefined' || document.activeElement !== this.elements.inputOpacityValue)) {
      this.elements.inputOpacityValue.value = isOpacityMixed ? '' : String(Math.round(displayedOpacity * 100));
      this.elements.inputOpacityValue.placeholder = isOpacityMixed ? 'Mixto' : '';
    }

    const blendModes = leafShapes.map((shape) => shape.blendMode ?? 'normal');
    const isBlendModeMixed = blendModes.some((mode) => mode !== blendModes[0]);
    const displayedBlendMode = blendModes.length > 0 ? blendModes[0] : (defaultStyle?.blendMode ?? 'normal');
    if (this.elements.selectBlendMode && (typeof document === 'undefined' || document.activeElement !== this.elements.selectBlendMode)) {
      this.elements.selectBlendMode.value = isBlendModeMixed ? 'normal' : displayedBlendMode;
    }
  }

  public bind(): void {
    this.elements.inputFill?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputFill?.addEventListener('click', this.onInputStart);
    this.elements.inputFill?.addEventListener('focus', this.onInputStart);
    this.elements.inputFill?.addEventListener('input', this.onFillInput);
    this.elements.inputFill?.addEventListener('change', this.onFillChange);

    this.elements.inputStroke?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputStroke?.addEventListener('click', this.onInputStart);
    this.elements.inputStroke?.addEventListener('focus', this.onInputStart);
    this.elements.inputStroke?.addEventListener('input', this.onStrokeInput);
    this.elements.inputStroke?.addEventListener('change', this.onStrokeChange);

    this.elements.inputStrokeWidth?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputStrokeWidth?.addEventListener('click', this.onInputStart);
    this.elements.inputStrokeWidth?.addEventListener('focus', this.onInputStart);
    this.elements.inputStrokeWidth?.addEventListener('input', this.onStrokeWidthInput);
    this.elements.inputStrokeWidth?.addEventListener('change', this.onStrokeWidthChange);

    this.elements.inputOpacity?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputOpacity?.addEventListener('click', this.onInputStart);
    this.elements.inputOpacity?.addEventListener('focus', this.onInputStart);
    this.elements.inputOpacity?.addEventListener('input', this.onOpacitySliderInput);
    this.elements.inputOpacity?.addEventListener('change', this.onOpacitySliderChange);

    this.elements.inputOpacityValue?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputOpacityValue?.addEventListener('click', this.onInputStart);
    this.elements.inputOpacityValue?.addEventListener('focus', this.onInputStart);
    this.elements.inputOpacityValue?.addEventListener('input', this.onOpacityValueInput);
    this.elements.inputOpacityValue?.addEventListener('change', this.onOpacityValueChange);

    this.elements.selectBlendMode?.addEventListener('focus', this.onInputStart);
    this.elements.selectBlendMode?.addEventListener('mousedown', this.onInputStart);
    this.elements.selectBlendMode?.addEventListener('change', this.onBlendModeChange);

    this.elements.inputFillHex?.addEventListener('focus', this.onFillHexFocus);
    this.elements.inputFillHex?.addEventListener('keydown', this.onFillHexKeyDown);
    this.elements.inputFillHex?.addEventListener('blur', this.onFillHexBlur);

    this.elements.inputStrokeHex?.addEventListener('focus', this.onStrokeHexFocus);
    this.elements.inputStrokeHex?.addEventListener('keydown', this.onStrokeHexKeyDown);
    this.elements.inputStrokeHex?.addEventListener('blur', this.onStrokeHexBlur);

    this.elements.btnFillNone?.addEventListener('click', this.onFillNoneClick);
    this.elements.btnStrokeNone?.addEventListener('click', this.onStrokeNoneClick);

    this.elements.selectStrokeDash?.addEventListener('focus', this.onInputStart);
    this.elements.selectStrokeDash?.addEventListener('mousedown', this.onInputStart);
    this.elements.selectStrokeDash?.addEventListener('change', this.onStrokeDashChange);

    this.elements.selectStrokeCap?.addEventListener('focus', this.onInputStart);
    this.elements.selectStrokeCap?.addEventListener('mousedown', this.onInputStart);
    this.elements.selectStrokeCap?.addEventListener('change', this.onStrokeCapChange);

    this.elements.selectStrokeJoin?.addEventListener('focus', this.onInputStart);
    this.elements.selectStrokeJoin?.addEventListener('mousedown', this.onInputStart);
    this.elements.selectStrokeJoin?.addEventListener('change', this.onStrokeJoinChange);
  }

  public cleanup(): void {
    this.gradientEditor.cleanup();

    this.elements.inputFill?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputFill?.removeEventListener('click', this.onInputStart);
    this.elements.inputFill?.removeEventListener('focus', this.onInputStart);
    this.elements.inputFill?.removeEventListener('input', this.onFillInput);
    this.elements.inputFill?.removeEventListener('change', this.onFillChange);

    this.elements.inputStroke?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputStroke?.removeEventListener('click', this.onInputStart);
    this.elements.inputStroke?.removeEventListener('focus', this.onInputStart);
    this.elements.inputStroke?.removeEventListener('input', this.onStrokeInput);
    this.elements.inputStroke?.removeEventListener('change', this.onStrokeChange);

    this.elements.inputFillHex?.removeEventListener('focus', this.onFillHexFocus);
    this.elements.inputFillHex?.removeEventListener('keydown', this.onFillHexKeyDown);
    this.elements.inputFillHex?.removeEventListener('blur', this.onFillHexBlur);

    this.elements.inputStrokeHex?.removeEventListener('focus', this.onStrokeHexFocus);
    this.elements.inputStrokeHex?.removeEventListener('keydown', this.onStrokeHexKeyDown);
    this.elements.inputStrokeHex?.removeEventListener('blur', this.onStrokeHexBlur);

    this.elements.btnFillNone?.removeEventListener('click', this.onFillNoneClick);
    this.elements.btnStrokeNone?.removeEventListener('click', this.onStrokeNoneClick);

    if (this.fillInvalidTimer) {
      clearTimeout(this.fillInvalidTimer);
      this.fillInvalidTimer = null;
    }
    if (this.strokeInvalidTimer) {
      clearTimeout(this.strokeInvalidTimer);
      this.strokeInvalidTimer = null;
    }

    this.elements.inputStrokeWidth?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputStrokeWidth?.removeEventListener('click', this.onInputStart);
    this.elements.inputStrokeWidth?.removeEventListener('focus', this.onInputStart);
    this.elements.inputStrokeWidth?.removeEventListener('input', this.onStrokeWidthInput);
    this.elements.inputStrokeWidth?.removeEventListener('change', this.onStrokeWidthChange);

    this.elements.selectStrokeDash?.removeEventListener('focus', this.onInputStart);
    this.elements.selectStrokeDash?.removeEventListener('mousedown', this.onInputStart);
    this.elements.selectStrokeDash?.removeEventListener('change', this.onStrokeDashChange);

    this.elements.selectStrokeCap?.removeEventListener('focus', this.onInputStart);
    this.elements.selectStrokeCap?.removeEventListener('mousedown', this.onInputStart);
    this.elements.selectStrokeCap?.removeEventListener('change', this.onStrokeCapChange);

    this.elements.selectStrokeJoin?.removeEventListener('focus', this.onInputStart);
    this.elements.selectStrokeJoin?.removeEventListener('mousedown', this.onInputStart);
    this.elements.selectStrokeJoin?.removeEventListener('change', this.onStrokeJoinChange);

    this.elements.inputOpacity?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputOpacity?.removeEventListener('click', this.onInputStart);
    this.elements.inputOpacity?.removeEventListener('focus', this.onInputStart);
    this.elements.inputOpacity?.removeEventListener('input', this.onOpacitySliderInput);
    this.elements.inputOpacity?.removeEventListener('change', this.onOpacitySliderChange);

    this.elements.inputOpacityValue?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputOpacityValue?.removeEventListener('click', this.onInputStart);
    this.elements.inputOpacityValue?.removeEventListener('focus', this.onInputStart);
    this.elements.inputOpacityValue?.removeEventListener('input', this.onOpacityValueInput);
    this.elements.inputOpacityValue?.removeEventListener('change', this.onOpacityValueChange);

    this.elements.selectBlendMode?.removeEventListener('focus', this.onInputStart);
    this.elements.selectBlendMode?.removeEventListener('mousedown', this.onInputStart);
    this.elements.selectBlendMode?.removeEventListener('change', this.onBlendModeChange);
  }
}
