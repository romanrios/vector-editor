import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { ResizeArtboardCommand } from '../../commands/ResizeArtboardCommand.ts';
import { getPresetById, findPresetForSize } from '../../utils/artboardPresets.ts';
import type { PropertiesPanelElements } from './types.ts';

export class ArtboardSectionController {
  private initialArtboardWidth: number;
  private initialArtboardHeight: number;
  private artboardAspectRatio: number;
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly elements: PropertiesPanelElements;
  private readonly syncPropertiesPanel: () => void;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    elements: PropertiesPanelElements,
    syncPropertiesPanel: () => void
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.elements = elements;
    this.syncPropertiesPanel = syncPropertiesPanel;

    this.initialArtboardWidth = this.stateManager.getState().width;
    this.initialArtboardHeight = this.stateManager.getState().height;
    this.artboardAspectRatio =
      this.initialArtboardHeight > 0 ? this.initialArtboardWidth / this.initialArtboardHeight : 1;
  }


  private readonly onArtboardRatioChange = (): void => {
    if (this.elements.checkArtboardRatio?.checked) {
      const currentDoc = this.stateManager.getState();
      if (currentDoc.height > 0) {
        this.artboardAspectRatio = currentDoc.width / currentDoc.height;
      }
    }
  };

  private readonly onArtboardFocus = (): void => {
    this.initialArtboardWidth = this.stateManager.getState().width;
    this.initialArtboardHeight = this.stateManager.getState().height;
    if (this.elements.checkArtboardRatio?.checked && this.initialArtboardHeight > 0) {
      this.artboardAspectRatio = this.initialArtboardWidth / this.initialArtboardHeight;
    }
  };

  private readonly onArtboardWidthInput = (): void => {
    const input = this.elements.inputArtboardWidth;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      if (this.elements.checkArtboardRatio?.checked && this.artboardAspectRatio > 0) {
        const calculatedHeight = Math.max(1, Math.round(parsed / this.artboardAspectRatio));
        if (this.elements.inputArtboardHeight) {
          this.elements.inputArtboardHeight.value = String(calculatedHeight);
        }
        this.stateManager.setDocumentSize(parsed, calculatedHeight);
      } else {
        this.stateManager.setDocumentSize(parsed, this.stateManager.getState().height);
      }
    }
  };

  private readonly onArtboardWidthChange = (): void => {
    const input = this.elements.inputArtboardWidth;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      input.value = String(this.stateManager.getState().width);
      this.stateManager.setDocumentSize(this.initialArtboardWidth, this.initialArtboardHeight);
      this.syncPropertiesPanel();
      return;
    }
    const targetWidth = parsed;
    input.value = String(targetWidth);

    let targetHeight = this.stateManager.getState().height;
    if (this.elements.checkArtboardRatio?.checked && this.artboardAspectRatio > 0) {
      targetHeight = Math.max(1, Math.round(targetWidth / this.artboardAspectRatio));
      if (this.elements.inputArtboardHeight) {
        this.elements.inputArtboardHeight.value = String(targetHeight);
      }
    }

    if (targetWidth === this.initialArtboardWidth && targetHeight === this.initialArtboardHeight) {
      this.syncPropertiesPanel();
      return;
    }

    this.stateManager.setDocumentSize(this.initialArtboardWidth, this.initialArtboardHeight);
    const resizeCommand = new ResizeArtboardCommand(
      this.stateManager,
      this.initialArtboardWidth,
      this.initialArtboardHeight,
      targetWidth,
      targetHeight
    );
    resizeCommand.execute();
    this.commandManager.recordCommand(resizeCommand);
    this.initialArtboardWidth = targetWidth;
    this.initialArtboardHeight = targetHeight;
    this.syncPropertiesPanel();
  };

  private readonly onArtboardWidthKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      this.elements.inputArtboardWidth?.blur();
    } else if (e.key === 'Escape') {
      if (this.elements.inputArtboardWidth) {
        this.elements.inputArtboardWidth.value = String(this.initialArtboardWidth);
      }
      this.stateManager.setDocumentSize(this.initialArtboardWidth, this.initialArtboardHeight);
      this.elements.inputArtboardWidth?.blur();
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardHeightInput = (): void => {
    const input = this.elements.inputArtboardHeight;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      if (this.elements.checkArtboardRatio?.checked && this.artboardAspectRatio > 0) {
        const calculatedWidth = Math.max(1, Math.round(parsed * this.artboardAspectRatio));
        if (this.elements.inputArtboardWidth) {
          this.elements.inputArtboardWidth.value = String(calculatedWidth);
        }
        this.stateManager.setDocumentSize(calculatedWidth, parsed);
      } else {
        this.stateManager.setDocumentSize(this.stateManager.getState().width, parsed);
      }
    }
  };

  private readonly onArtboardHeightChange = (): void => {
    const input = this.elements.inputArtboardHeight;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      input.value = String(this.stateManager.getState().height);
      this.stateManager.setDocumentSize(this.initialArtboardWidth, this.initialArtboardHeight);
      this.syncPropertiesPanel();
      return;
    }
    const targetHeight = parsed;
    input.value = String(targetHeight);

    let targetWidth = this.stateManager.getState().width;
    if (this.elements.checkArtboardRatio?.checked && this.artboardAspectRatio > 0) {
      targetWidth = Math.max(1, Math.round(targetHeight * this.artboardAspectRatio));
      if (this.elements.inputArtboardWidth) {
        this.elements.inputArtboardWidth.value = String(targetWidth);
      }
    }

    if (targetWidth === this.initialArtboardWidth && targetHeight === this.initialArtboardHeight) {
      this.syncPropertiesPanel();
      return;
    }

    this.stateManager.setDocumentSize(this.initialArtboardWidth, this.initialArtboardHeight);
    const resizeCommand = new ResizeArtboardCommand(
      this.stateManager,
      this.initialArtboardWidth,
      this.initialArtboardHeight,
      targetWidth,
      targetHeight
    );
    resizeCommand.execute();
    this.commandManager.recordCommand(resizeCommand);
    this.initialArtboardWidth = targetWidth;
    this.initialArtboardHeight = targetHeight;
    this.syncPropertiesPanel();
  };

  private readonly onArtboardHeightKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      this.elements.inputArtboardHeight?.blur();
    } else if (e.key === 'Escape') {
      if (this.elements.inputArtboardHeight) {
        this.elements.inputArtboardHeight.value = String(this.initialArtboardHeight);
      }
      this.stateManager.setDocumentSize(this.initialArtboardWidth, this.initialArtboardHeight);
      this.elements.inputArtboardHeight?.blur();
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardPresetChange = (): void => {
    const select = this.elements.selectArtboardPreset;
    if (!select) return;
    const presetId = select.value;
    if (presetId === 'custom') return;

    const preset = getPresetById(presetId);
    if (!preset) return;

    const doc = this.stateManager.getState();
    const prevWidth = doc.width;
    const prevHeight = doc.height;

    const resizeCommand = new ResizeArtboardCommand(
      this.stateManager,
      prevWidth,
      prevHeight,
      preset.width,
      preset.height
    );
    resizeCommand.execute();
    this.commandManager.recordCommand(resizeCommand);

    this.initialArtboardWidth = preset.width;
    this.initialArtboardHeight = preset.height;
    if (this.elements.checkArtboardRatio?.checked && preset.height > 0) {
      this.artboardAspectRatio = preset.width / preset.height;
    }
    this.syncPropertiesPanel();
  };

  public sync(hasSelection: boolean): void {
    if (this.elements.sectionArtboard) {
      this.elements.sectionArtboard.style.display = hasSelection ? 'none' : 'block';
    }

    const activeArtboard = this.stateManager.getActiveArtboard();
    if (
      this.elements.selectArtboardPreset &&
      (typeof document === 'undefined' || document.activeElement !== this.elements.selectArtboardPreset)
    ) {
      const matchingPreset = findPresetForSize(activeArtboard.width, activeArtboard.height);
      this.elements.selectArtboardPreset.value = matchingPreset ? matchingPreset.id : 'custom';
    }
    if (
      this.elements.inputArtboardWidth &&
      (typeof document === 'undefined' || document.activeElement !== this.elements.inputArtboardWidth)
    ) {
      this.elements.inputArtboardWidth.value = String(activeArtboard.width);
    }
    if (
      this.elements.inputArtboardHeight &&
      (typeof document === 'undefined' || document.activeElement !== this.elements.inputArtboardHeight)
    ) {
      this.elements.inputArtboardHeight.value = String(activeArtboard.height);
    }
    if (
      this.elements.checkArtboardRatio?.checked &&
      activeArtboard.height > 0 &&
      (typeof document === 'undefined' ||
        (document.activeElement !== this.elements.inputArtboardWidth &&
          document.activeElement !== this.elements.inputArtboardHeight))
    ) {
      this.artboardAspectRatio = activeArtboard.width / activeArtboard.height;
    }
  }

  public bind(): void {
    this.elements.selectArtboardPreset?.addEventListener('change', this.onArtboardPresetChange);
    this.elements.checkArtboardRatio?.addEventListener('change', this.onArtboardRatioChange);
    this.elements.inputArtboardWidth?.addEventListener('focus', this.onArtboardFocus);
    this.elements.inputArtboardWidth?.addEventListener('input', this.onArtboardWidthInput);
    this.elements.inputArtboardWidth?.addEventListener('change', this.onArtboardWidthChange);
    this.elements.inputArtboardWidth?.addEventListener('keydown', this.onArtboardWidthKeyDown as EventListener);
    this.elements.inputArtboardHeight?.addEventListener('focus', this.onArtboardFocus);
    this.elements.inputArtboardHeight?.addEventListener('input', this.onArtboardHeightInput);
    this.elements.inputArtboardHeight?.addEventListener('change', this.onArtboardHeightChange);
    this.elements.inputArtboardHeight?.addEventListener('keydown', this.onArtboardHeightKeyDown as EventListener);
  }

  public cleanup(): void {
    this.elements.selectArtboardPreset?.removeEventListener('change', this.onArtboardPresetChange);
    this.elements.checkArtboardRatio?.removeEventListener('change', this.onArtboardRatioChange);
    this.elements.inputArtboardWidth?.removeEventListener('focus', this.onArtboardFocus);
    this.elements.inputArtboardWidth?.removeEventListener('input', this.onArtboardWidthInput);
    this.elements.inputArtboardWidth?.removeEventListener('change', this.onArtboardWidthChange);
    this.elements.inputArtboardWidth?.removeEventListener('keydown', this.onArtboardWidthKeyDown as EventListener);
    this.elements.inputArtboardHeight?.removeEventListener('focus', this.onArtboardFocus);
    this.elements.inputArtboardHeight?.removeEventListener('input', this.onArtboardHeightInput);
    this.elements.inputArtboardHeight?.removeEventListener('change', this.onArtboardHeightChange);
    this.elements.inputArtboardHeight?.removeEventListener('keydown', this.onArtboardHeightKeyDown as EventListener);
  }
}
