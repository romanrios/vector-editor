import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { ResizeArtboardCommand } from '../../commands/ResizeArtboardCommand.ts';
import { UpdateArtboardCommand } from '../../commands/UpdateArtboardCommand.ts';
import { getPresetById, findPresetForSize } from '../../utils/artboardPresets.ts';
import type { PropertiesPanelElements } from './types.ts';

export class ArtboardSectionController {
  private initialArtboardName: string;
  private initialArtboardX: number;
  private initialArtboardY: number;
  private initialArtboardWidth: number;
  private initialArtboardHeight: number;
  private currentActiveArtboardId: string;
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

    const activeArtboard = this.stateManager.getActiveArtboard();
    this.currentActiveArtboardId = activeArtboard.id;
    this.initialArtboardName = activeArtboard.name || 'Mesa 1';
    this.initialArtboardX = activeArtboard.x;
    this.initialArtboardY = activeArtboard.y;
    this.initialArtboardWidth = activeArtboard.width;
    this.initialArtboardHeight = activeArtboard.height;
    this.artboardAspectRatio =
      this.initialArtboardHeight > 0 ? this.initialArtboardWidth / this.initialArtboardHeight : 1;
  }

  private readonly onActiveArtboardChange = (): void => {
    const select = this.elements.selectActiveArtboard;
    if (!select || !select.value) return;
    if (this.stateManager.getActiveArtboardId() !== select.value) {
      this.stateManager.setActiveArtboard(select.value);
      const activeArtboard = this.stateManager.getActiveArtboard();
      this.currentActiveArtboardId = activeArtboard.id;
      this.initialArtboardName = activeArtboard.name || '';
      this.initialArtboardX = activeArtboard.x;
      this.initialArtboardY = activeArtboard.y;
      this.initialArtboardWidth = activeArtboard.width;
      this.initialArtboardHeight = activeArtboard.height;
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardNameFocus = (): void => {
    const activeArtboard = this.stateManager.getActiveArtboard();
    this.initialArtboardName = activeArtboard.name || '';
  };

  private readonly onArtboardNameChange = (): void => {
    const input = this.elements.inputArtboardName;
    if (!input) return;
    const activeArtboard = this.stateManager.getActiveArtboard();
    const newName = input.value.trim();
    if (!newName) {
      input.value = this.initialArtboardName;
      return;
    }
    if (newName === this.initialArtboardName) {
      return;
    }

    const cmd = new UpdateArtboardCommand(
      this.stateManager,
      activeArtboard.id,
      { name: this.initialArtboardName },
      { name: newName }
    );
    this.commandManager.executeCommand(cmd);
    this.initialArtboardName = newName;
    this.syncPropertiesPanel();
  };

  private readonly onArtboardNameKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      this.elements.inputArtboardName?.blur();
    } else if (e.key === 'Escape') {
      if (this.elements.inputArtboardName) {
        this.elements.inputArtboardName.value = this.initialArtboardName;
      }
      this.elements.inputArtboardName?.blur();
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardXFocus = (): void => {
    const activeArtboard = this.stateManager.getActiveArtboard();
    this.initialArtboardX = activeArtboard.x;
  };

  private readonly onArtboardXInput = (): void => {
    const input = this.elements.inputArtboardX;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed)) {
      const activeArtboard = this.stateManager.getActiveArtboard();
      this.stateManager.updateArtboard(activeArtboard.id, { x: parsed });
    }
  };

  private readonly onArtboardXChange = (): void => {
    const input = this.elements.inputArtboardX;
    if (!input) return;
    const activeArtboard = this.stateManager.getActiveArtboard();
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = String(activeArtboard.x);
      this.stateManager.updateArtboard(activeArtboard.id, { x: this.initialArtboardX });
      this.syncPropertiesPanel();
      return;
    }
    const targetX = parsed;
    input.value = String(targetX);
    if (targetX === this.initialArtboardX) {
      this.syncPropertiesPanel();
      return;
    }

    this.stateManager.updateArtboard(activeArtboard.id, { x: this.initialArtboardX });
    const cmd = new UpdateArtboardCommand(
      this.stateManager,
      activeArtboard.id,
      { x: this.initialArtboardX },
      { x: targetX }
    );
    this.commandManager.executeCommand(cmd);
    this.initialArtboardX = targetX;
    this.syncPropertiesPanel();
  };

  private readonly onArtboardXKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      this.elements.inputArtboardX?.blur();
    } else if (e.key === 'Escape') {
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (this.elements.inputArtboardX) {
        this.elements.inputArtboardX.value = String(this.initialArtboardX);
      }
      this.stateManager.updateArtboard(activeArtboard.id, { x: this.initialArtboardX });
      this.elements.inputArtboardX?.blur();
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardYFocus = (): void => {
    const activeArtboard = this.stateManager.getActiveArtboard();
    this.initialArtboardY = activeArtboard.y;
  };

  private readonly onArtboardYInput = (): void => {
    const input = this.elements.inputArtboardY;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed)) {
      const activeArtboard = this.stateManager.getActiveArtboard();
      this.stateManager.updateArtboard(activeArtboard.id, { y: parsed });
    }
  };

  private readonly onArtboardYChange = (): void => {
    const input = this.elements.inputArtboardY;
    if (!input) return;
    const activeArtboard = this.stateManager.getActiveArtboard();
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = String(activeArtboard.y);
      this.stateManager.updateArtboard(activeArtboard.id, { y: this.initialArtboardY });
      this.syncPropertiesPanel();
      return;
    }
    const targetY = parsed;
    input.value = String(targetY);
    if (targetY === this.initialArtboardY) {
      this.syncPropertiesPanel();
      return;
    }

    this.stateManager.updateArtboard(activeArtboard.id, { y: this.initialArtboardY });
    const cmd = new UpdateArtboardCommand(
      this.stateManager,
      activeArtboard.id,
      { y: this.initialArtboardY },
      { y: targetY }
    );
    this.commandManager.executeCommand(cmd);
    this.initialArtboardY = targetY;
    this.syncPropertiesPanel();
  };

  private readonly onArtboardYKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      this.elements.inputArtboardY?.blur();
    } else if (e.key === 'Escape') {
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (this.elements.inputArtboardY) {
        this.elements.inputArtboardY.value = String(this.initialArtboardY);
      }
      this.stateManager.updateArtboard(activeArtboard.id, { y: this.initialArtboardY });
      this.elements.inputArtboardY?.blur();
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardRatioChange = (): void => {
    if (this.elements.checkArtboardRatio?.checked) {
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (activeArtboard.height > 0) {
        this.artboardAspectRatio = activeArtboard.width / activeArtboard.height;
      }
    }
  };

  private readonly onArtboardFocus = (): void => {
    const activeArtboard = this.stateManager.getActiveArtboard();
    this.currentActiveArtboardId = activeArtboard.id;
    this.initialArtboardWidth = activeArtboard.width;
    this.initialArtboardHeight = activeArtboard.height;
    if (this.elements.checkArtboardRatio?.checked && this.initialArtboardHeight > 0) {
      this.artboardAspectRatio = this.initialArtboardWidth / this.initialArtboardHeight;
    }
  };

  private readonly onArtboardWidthInput = (): void => {
    const input = this.elements.inputArtboardWidth;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (this.elements.checkArtboardRatio?.checked && this.artboardAspectRatio > 0) {
        const calculatedHeight = Math.max(1, Math.round(parsed / this.artboardAspectRatio));
        if (this.elements.inputArtboardHeight) {
          this.elements.inputArtboardHeight.value = String(calculatedHeight);
        }
        this.stateManager.updateArtboard(activeArtboard.id, {
          width: parsed,
          height: calculatedHeight,
        });
      } else {
        this.stateManager.updateArtboard(activeArtboard.id, { width: parsed });
      }
    }
  };

  private readonly onArtboardWidthChange = (): void => {
    const input = this.elements.inputArtboardWidth;
    if (!input) return;
    const activeArtboard = this.stateManager.getActiveArtboard();
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      input.value = String(activeArtboard.width);
      this.stateManager.updateArtboard(activeArtboard.id, {
        width: this.initialArtboardWidth,
        height: this.initialArtboardHeight,
      });
      this.syncPropertiesPanel();
      return;
    }
    const targetWidth = parsed;
    input.value = String(targetWidth);

    let targetHeight = activeArtboard.height;
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

    this.stateManager.updateArtboard(activeArtboard.id, {
      width: this.initialArtboardWidth,
      height: this.initialArtboardHeight,
    });
    const resizeCommand = new ResizeArtboardCommand(
      this.stateManager,
      this.initialArtboardWidth,
      this.initialArtboardHeight,
      targetWidth,
      targetHeight,
      activeArtboard.id
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
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (this.elements.inputArtboardWidth) {
        this.elements.inputArtboardWidth.value = String(this.initialArtboardWidth);
      }
      this.stateManager.updateArtboard(activeArtboard.id, {
        width: this.initialArtboardWidth,
        height: this.initialArtboardHeight,
      });
      this.elements.inputArtboardWidth?.blur();
      this.syncPropertiesPanel();
    }
  };

  private readonly onArtboardHeightInput = (): void => {
    const input = this.elements.inputArtboardHeight;
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (this.elements.checkArtboardRatio?.checked && this.artboardAspectRatio > 0) {
        const calculatedWidth = Math.max(1, Math.round(parsed * this.artboardAspectRatio));
        if (this.elements.inputArtboardWidth) {
          this.elements.inputArtboardWidth.value = String(calculatedWidth);
        }
        this.stateManager.updateArtboard(activeArtboard.id, {
          width: calculatedWidth,
          height: parsed,
        });
      } else {
        this.stateManager.updateArtboard(activeArtboard.id, { height: parsed });
      }
    }
  };

  private readonly onArtboardHeightChange = (): void => {
    const input = this.elements.inputArtboardHeight;
    if (!input) return;
    const activeArtboard = this.stateManager.getActiveArtboard();
    const parsed = parseFloat(input.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      input.value = String(activeArtboard.height);
      this.stateManager.updateArtboard(activeArtboard.id, {
        width: this.initialArtboardWidth,
        height: this.initialArtboardHeight,
      });
      this.syncPropertiesPanel();
      return;
    }
    const targetHeight = parsed;
    input.value = String(targetHeight);

    let targetWidth = activeArtboard.width;
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

    this.stateManager.updateArtboard(activeArtboard.id, {
      width: this.initialArtboardWidth,
      height: this.initialArtboardHeight,
    });
    const resizeCommand = new ResizeArtboardCommand(
      this.stateManager,
      this.initialArtboardWidth,
      this.initialArtboardHeight,
      targetWidth,
      targetHeight,
      activeArtboard.id
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
      const activeArtboard = this.stateManager.getActiveArtboard();
      if (this.elements.inputArtboardHeight) {
        this.elements.inputArtboardHeight.value = String(this.initialArtboardHeight);
      }
      this.stateManager.updateArtboard(activeArtboard.id, {
        width: this.initialArtboardWidth,
        height: this.initialArtboardHeight,
      });
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

    const activeArtboard = this.stateManager.getActiveArtboard();
    const prevWidth = activeArtboard.width;
    const prevHeight = activeArtboard.height;

    const resizeCommand = new ResizeArtboardCommand(
      this.stateManager,
      prevWidth,
      prevHeight,
      preset.width,
      preset.height,
      activeArtboard.id
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

    const artboards = this.stateManager.getArtboards();
    const activeArtboard = this.stateManager.getActiveArtboard();

    if (this.currentActiveArtboardId !== activeArtboard.id) {
      this.currentActiveArtboardId = activeArtboard.id;
      this.initialArtboardName = activeArtboard.name || '';
      this.initialArtboardX = activeArtboard.x;
      this.initialArtboardY = activeArtboard.y;
      this.initialArtboardWidth = activeArtboard.width;
      this.initialArtboardHeight = activeArtboard.height;
    }

    if (this.elements.groupActiveArtboard) {
      this.elements.groupActiveArtboard.style.display = artboards.length > 1 ? 'flex' : 'none';
    }

    if (this.elements.selectActiveArtboard && typeof document !== 'undefined') {
      const select = this.elements.selectActiveArtboard;
      const currentOptions = Array.from(select.options || []).map((o: any) => o.value);
      const artboardIds = artboards.map((a) => a.id);
      const optionsMatch =
        currentOptions.length === artboardIds.length &&
        currentOptions.every((id, idx) => id === artboardIds[idx]);

      if (!optionsMatch && typeof document.createElement === 'function') {
        select.innerHTML = '';
        artboards.forEach((ab, idx) => {
          const opt = document.createElement('option');
          opt.value = ab.id;
          opt.textContent = `${idx + 1}: ${ab.name || 'Mesa ' + (idx + 1)} (${ab.width} × ${ab.height})`;
          select.appendChild(opt);
        });
      } else if (select.options) {
        artboards.forEach((ab, idx) => {
          const opt = select.options[idx];
          if (opt) {
            opt.textContent = `${idx + 1}: ${ab.name || 'Mesa ' + (idx + 1)} (${ab.width} × ${ab.height})`;
          }
        });
      }
      select.value = activeArtboard.id;
    }

    if (
      this.elements.inputArtboardName &&
      (typeof document === 'undefined' || document.activeElement !== this.elements.inputArtboardName)
    ) {
      this.elements.inputArtboardName.value = activeArtboard.name || '';
    }
    if (
      this.elements.inputArtboardX &&
      (typeof document === 'undefined' || document.activeElement !== this.elements.inputArtboardX)
    ) {
      this.elements.inputArtboardX.value = String(activeArtboard.x);
    }
    if (
      this.elements.inputArtboardY &&
      (typeof document === 'undefined' || document.activeElement !== this.elements.inputArtboardY)
    ) {
      this.elements.inputArtboardY.value = String(activeArtboard.y);
    }
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
    this.elements.selectActiveArtboard?.addEventListener('change', this.onActiveArtboardChange);
    this.elements.inputArtboardName?.addEventListener('focus', this.onArtboardNameFocus);
    this.elements.inputArtboardName?.addEventListener('change', this.onArtboardNameChange);
    this.elements.inputArtboardName?.addEventListener('keydown', this.onArtboardNameKeyDown as EventListener);
    this.elements.inputArtboardX?.addEventListener('focus', this.onArtboardXFocus);
    this.elements.inputArtboardX?.addEventListener('input', this.onArtboardXInput);
    this.elements.inputArtboardX?.addEventListener('change', this.onArtboardXChange);
    this.elements.inputArtboardX?.addEventListener('keydown', this.onArtboardXKeyDown as EventListener);
    this.elements.inputArtboardY?.addEventListener('focus', this.onArtboardYFocus);
    this.elements.inputArtboardY?.addEventListener('input', this.onArtboardYInput);
    this.elements.inputArtboardY?.addEventListener('change', this.onArtboardYChange);
    this.elements.inputArtboardY?.addEventListener('keydown', this.onArtboardYKeyDown as EventListener);
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
    this.elements.selectActiveArtboard?.removeEventListener('change', this.onActiveArtboardChange);
    this.elements.inputArtboardName?.removeEventListener('focus', this.onArtboardNameFocus);
    this.elements.inputArtboardName?.removeEventListener('change', this.onArtboardNameChange);
    this.elements.inputArtboardName?.removeEventListener('keydown', this.onArtboardNameKeyDown as EventListener);
    this.elements.inputArtboardX?.removeEventListener('focus', this.onArtboardXFocus);
    this.elements.inputArtboardX?.removeEventListener('input', this.onArtboardXInput);
    this.elements.inputArtboardX?.removeEventListener('change', this.onArtboardXChange);
    this.elements.inputArtboardX?.removeEventListener('keydown', this.onArtboardWidthKeyDown as EventListener);
    this.elements.inputArtboardY?.removeEventListener('focus', this.onArtboardYFocus);
    this.elements.inputArtboardY?.removeEventListener('input', this.onArtboardYInput);
    this.elements.inputArtboardY?.removeEventListener('change', this.onArtboardYChange);
    this.elements.inputArtboardY?.removeEventListener('keydown', this.onArtboardYKeyDown as EventListener);
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
