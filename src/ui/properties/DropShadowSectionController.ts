import type { StateManager } from '../../state/StateManager.ts';
import { getLeafShapes } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { StyleShapesCommand, type ShapeStyleChangeEntry } from '../../commands/StyleShapesCommand.ts';
import type { DropShadow, Shape } from '../../types/scene-graph.ts';
import { parseHexColor } from '../../utils/color.ts';
import type { PropertiesPanelElements } from './types.ts';
import { markInputTarget, isInputTargetValid, clearInputTarget } from './types.ts';
import type { StyleSnapshotManager } from './StyleSnapshotManager.ts';

export class DropShadowSectionController {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly elements: PropertiesPanelElements;
  private readonly styleSnapshotManager: StyleSnapshotManager;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    elements: PropertiesPanelElements,
    styleSnapshotManager: StyleSnapshotManager
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.elements = elements;
    this.styleSnapshotManager = styleSnapshotManager;
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

  private onInputStart = (e?: Event) => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (e?.currentTarget) {
      markInputTarget(e.currentTarget, leafShapes);
    }
    this.styleSnapshotManager.capture();
  };

  private getCurrentInputShadow = (): DropShadow => {
    const color = this.elements.inputShadowHex?.value
      ? (parseHexColor(this.elements.inputShadowHex.value) ?? '#000000')
      : '#000000';
    const percent = this.elements.inputShadowOpacity
      ? Math.max(0, Math.min(100, Number(this.elements.inputShadowOpacity.value) || 50))
      : 50;
    const offsetX = this.elements.inputShadowOffsetX ? (Number(this.elements.inputShadowOffsetX.value) || 0) : 0;
    const offsetY = this.elements.inputShadowOffsetY ? (Number(this.elements.inputShadowOffsetY.value) || 4) : 4;
    const blur = this.elements.inputShadowBlur ? Math.max(0, Number(this.elements.inputShadowBlur.value) || 0) : 8;
    return {
      color,
      opacity: percent / 100,
      offsetX,
      offsetY,
      blur,
    };
  };

  private applyDropShadowLive = (shadow: DropShadow | null, targetEl?: EventTarget | null) => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    this.stateManager.setDrawingStyle({ dropShadow: shadow });
    if (leafShapes.length === 0) return;

    if (!this.isTargetValid(leafShapes, targetEl)) {
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      return;
    }

    if (!this.styleSnapshotManager.hasSnapshots()) {
      this.styleSnapshotManager.capture();
    }
    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { dropShadow: shadow },
    })));
  };

  private commitDropShadow = (shadow: DropShadow | null, targetEl?: EventTarget | null) => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    this.stateManager.setDrawingStyle({ dropShadow: shadow });
    if (leafShapes.length === 0) {
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      return;
    }

    if (!this.isTargetValid(leafShapes, targetEl)) {
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      return;
    }

    if (!this.styleSnapshotManager.hasSnapshots()) {
      this.styleSnapshotManager.capture();
    }

    const initialStyleSnapshots = this.styleSnapshotManager.getSnapshots();
    if (initialStyleSnapshots && !leafShapes.every((s) => initialStyleSnapshots.has(s.id))) {
      if (targetEl) clearInputTarget(targetEl);
      this.clearSnapshot();
      return;
    }

    const entries: ShapeStyleChangeEntry[] = leafShapes.map((shape) => ({
      id: shape.id,
      before: { dropShadow: initialStyleSnapshots?.get(shape.id)?.dropShadow ?? shape.dropShadow ?? null },
      after: { dropShadow: shadow },
    }));

    this.stateManager.updateShapesStyle(leafShapes.map((shape) => ({
      id: shape.id,
      style: { dropShadow: shadow },
    })));

    const command = new StyleShapesCommand(this.stateManager, entries);
    if (!command.isAlreadyAtTarget) this.commandManager.recordCommand(command);
    if (targetEl) clearInputTarget(targetEl);
    this.clearSnapshot();
  };

  private onDropShadowCheckChange = (e?: Event) => {
    if (!this.elements.checkDropShadow) return;
    const enabled = this.elements.checkDropShadow.checked;
    if (this.elements.groupDropShadowControls) {
      this.elements.groupDropShadowControls.style.display = enabled ? 'flex' : 'none';
    }
    if (enabled) {
      const sh = this.getCurrentInputShadow();
      this.commitDropShadow(sh, e?.currentTarget);
    } else {
      this.commitDropShadow(null, e?.currentTarget);
    }
  };

  private onShadowColorChange = (e?: Event) => {
    if (!this.elements.inputShadowColor) return;
    const color = this.elements.inputShadowColor.value.toLowerCase();
    if (this.elements.inputShadowHex) this.elements.inputShadowHex.value = color;
    if (this.elements.swatchShadowPreview) this.elements.swatchShadowPreview.style.backgroundColor = color;
    this.commitDropShadow(this.getCurrentInputShadow(), e?.currentTarget);
  };

  private onShadowHexInput = (e?: Event) => {
    if (!this.elements.inputShadowHex) return;
    const parsed = parseHexColor(this.elements.inputShadowHex.value);
    if (parsed) {
      if (this.elements.inputShadowColor) this.elements.inputShadowColor.value = parsed;
      if (this.elements.swatchShadowPreview) this.elements.swatchShadowPreview.style.backgroundColor = parsed;
      this.applyDropShadowLive(this.getCurrentInputShadow(), e?.currentTarget);
    }
  };

  private onShadowHexChange = (e?: Event) => {
    if (!this.elements.inputShadowHex) return;
    const parsed = parseHexColor(this.elements.inputShadowHex.value);
    if (parsed) {
      this.elements.inputShadowHex.value = parsed;
      if (this.elements.inputShadowColor) this.elements.inputShadowColor.value = parsed;
      if (this.elements.swatchShadowPreview) this.elements.swatchShadowPreview.style.backgroundColor = parsed;
      this.commitDropShadow(this.getCurrentInputShadow(), e?.currentTarget);
    } else {
      const sh = this.getCurrentInputShadow();
      this.elements.inputShadowHex.value = sh.color;
    }
  };

  private onShadowOpacitySliderInput = (e?: Event) => {
    if (!this.elements.inputShadowOpacity) return;
    const val = this.elements.inputShadowOpacity.value;
    if (this.elements.inputShadowOpacityValue) this.elements.inputShadowOpacityValue.value = val;
    this.applyDropShadowLive(this.getCurrentInputShadow(), e?.currentTarget);
  };

  private onShadowOpacitySliderChange = (e?: Event) => {
    if (!this.elements.inputShadowOpacity) return;
    const val = this.elements.inputShadowOpacity.value;
    if (this.elements.inputShadowOpacityValue) this.elements.inputShadowOpacityValue.value = val;
    this.commitDropShadow(this.getCurrentInputShadow(), e?.currentTarget);
  };

  private onShadowOpacityValueInput = (e?: Event) => {
    if (!this.elements.inputShadowOpacityValue) return;
    const val = this.elements.inputShadowOpacityValue.value;
    if (this.elements.inputShadowOpacity) this.elements.inputShadowOpacity.value = val;
    this.applyDropShadowLive(this.getCurrentInputShadow(), e?.currentTarget);
  };

  private onShadowOpacityValueChange = (e?: Event) => {
    if (!this.elements.inputShadowOpacityValue) return;
    const val = this.elements.inputShadowOpacityValue.value;
    if (this.elements.inputShadowOpacity) this.elements.inputShadowOpacity.value = val;
    this.commitDropShadow(this.getCurrentInputShadow(), e?.currentTarget);
  };

  private onShadowOffsetOrBlurInput = (e?: Event) => {
    this.applyDropShadowLive(this.getCurrentInputShadow(), e?.currentTarget);
  };

  private onShadowOffsetOrBlurChange = (e?: Event) => {
    this.commitDropShadow(this.getCurrentInputShadow(), e?.currentTarget);
  };

  public sync(leafShapes: readonly Shape[]): void {
    const shadows = leafShapes.map((shape) => shape.dropShadow ?? null);
    const hasAnyShadow = shadows.some((s) => s !== null);
    const allHaveShadow = shadows.length > 0 && shadows.every((s) => s !== null);
    const isShadowMixed = hasAnyShadow && !allHaveShadow;

    if (this.elements.checkDropShadow) {
      this.elements.checkDropShadow.checked = allHaveShadow;
      this.elements.checkDropShadow.indeterminate = isShadowMixed;
    }

    if (this.elements.groupDropShadowControls) {
      this.elements.groupDropShadowControls.style.display = hasAnyShadow ? 'flex' : 'none';
    }

    if (hasAnyShadow) {
      const activeShadow = shadows.find((s) => s !== null);
      if (activeShadow) {
        if (this.elements.inputShadowColor && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowColor)) {
          this.elements.inputShadowColor.value = activeShadow.color;
        }
        if (this.elements.inputShadowHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowHex)) {
          this.elements.inputShadowHex.value = activeShadow.color;
        }
        if (this.elements.swatchShadowPreview) {
          this.elements.swatchShadowPreview.style.backgroundColor = activeShadow.color;
        }
        const opVal = Math.round((activeShadow.opacity ?? 1) * 100);
        if (this.elements.inputShadowOpacity && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowOpacity)) {
          this.elements.inputShadowOpacity.value = String(opVal);
        }
        if (this.elements.inputShadowOpacityValue && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowOpacityValue)) {
          this.elements.inputShadowOpacityValue.value = String(opVal);
        }
        if (this.elements.inputShadowOffsetX && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowOffsetX)) {
          this.elements.inputShadowOffsetX.value = String(activeShadow.offsetX);
        }
        if (this.elements.inputShadowOffsetY && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowOffsetY)) {
          this.elements.inputShadowOffsetY.value = String(activeShadow.offsetY);
        }
        if (this.elements.inputShadowBlur && (typeof document === 'undefined' || document.activeElement !== this.elements.inputShadowBlur)) {
          this.elements.inputShadowBlur.value = String(activeShadow.blur);
        }
      }
    }
  }

  public bind(): void {
    this.elements.checkDropShadow?.addEventListener('click', this.onInputStart);
    this.elements.checkDropShadow?.addEventListener('change', this.onDropShadowCheckChange);

    this.elements.inputShadowColor?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputShadowColor?.addEventListener('change', this.onShadowColorChange);

    this.elements.inputShadowHex?.addEventListener('focus', this.onInputStart);
    this.elements.inputShadowHex?.addEventListener('input', this.onShadowHexInput);
    this.elements.inputShadowHex?.addEventListener('change', this.onShadowHexChange);

    this.elements.inputShadowOpacity?.addEventListener('mousedown', this.onInputStart);
    this.elements.inputShadowOpacity?.addEventListener('input', this.onShadowOpacitySliderInput);
    this.elements.inputShadowOpacity?.addEventListener('change', this.onShadowOpacitySliderChange);

    this.elements.inputShadowOpacityValue?.addEventListener('focus', this.onInputStart);
    this.elements.inputShadowOpacityValue?.addEventListener('input', this.onShadowOpacityValueInput);
    this.elements.inputShadowOpacityValue?.addEventListener('change', this.onShadowOpacityValueChange);

    this.elements.inputShadowOffsetX?.addEventListener('focus', this.onInputStart);
    this.elements.inputShadowOffsetX?.addEventListener('input', this.onShadowOffsetOrBlurInput);
    this.elements.inputShadowOffsetX?.addEventListener('change', this.onShadowOffsetOrBlurChange);

    this.elements.inputShadowOffsetY?.addEventListener('focus', this.onInputStart);
    this.elements.inputShadowOffsetY?.addEventListener('input', this.onShadowOffsetOrBlurInput);
    this.elements.inputShadowOffsetY?.addEventListener('change', this.onShadowOffsetOrBlurChange);

    this.elements.inputShadowBlur?.addEventListener('focus', this.onInputStart);
    this.elements.inputShadowBlur?.addEventListener('input', this.onShadowOffsetOrBlurInput);
    this.elements.inputShadowBlur?.addEventListener('change', this.onShadowOffsetOrBlurChange);
  }

  public cleanup(): void {
    this.elements.checkDropShadow?.removeEventListener('click', this.onInputStart);
    this.elements.checkDropShadow?.removeEventListener('change', this.onDropShadowCheckChange);

    this.elements.inputShadowColor?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputShadowColor?.removeEventListener('change', this.onShadowColorChange);

    this.elements.inputShadowHex?.removeEventListener('focus', this.onInputStart);
    this.elements.inputShadowHex?.removeEventListener('input', this.onShadowHexInput);
    this.elements.inputShadowHex?.removeEventListener('change', this.onShadowHexChange);

    this.elements.inputShadowOpacity?.removeEventListener('mousedown', this.onInputStart);
    this.elements.inputShadowOpacity?.removeEventListener('input', this.onShadowOpacitySliderInput);
    this.elements.inputShadowOpacity?.removeEventListener('change', this.onShadowOpacitySliderChange);

    this.elements.inputShadowOpacityValue?.removeEventListener('focus', this.onInputStart);
    this.elements.inputShadowOpacityValue?.removeEventListener('input', this.onShadowOpacityValueInput);
    this.elements.inputShadowOpacityValue?.removeEventListener('change', this.onShadowOpacityValueChange);

    this.elements.inputShadowOffsetX?.removeEventListener('focus', this.onInputStart);
    this.elements.inputShadowOffsetX?.removeEventListener('input', this.onShadowOffsetOrBlurInput);
    this.elements.inputShadowOffsetX?.removeEventListener('change', this.onShadowOffsetOrBlurChange);

    this.elements.inputShadowOffsetY?.removeEventListener('focus', this.onInputStart);
    this.elements.inputShadowOffsetY?.removeEventListener('input', this.onShadowOffsetOrBlurInput);
    this.elements.inputShadowOffsetY?.removeEventListener('change', this.onShadowOffsetOrBlurChange);

    this.elements.inputShadowBlur?.removeEventListener('focus', this.onInputStart);
    this.elements.inputShadowBlur?.removeEventListener('input', this.onShadowOffsetOrBlurInput);
    this.elements.inputShadowBlur?.removeEventListener('change', this.onShadowOffsetOrBlurChange);
  }
}
