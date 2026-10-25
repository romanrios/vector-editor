import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { UpdateTextTypographyCommand } from '../../commands/UpdateTextTypographyCommand.ts';
import {
  isText,
  type Text,
  type FontStyle,
  type FontWeight,
  type TextAlign,
} from '../../types/scene-graph.ts';
import { getTextLineHeight } from '../../utils/geometry.ts';
import { parseHexColor, isNonePaint } from '../../utils/color.ts';
import { toValidHexColor } from '../uiUtils.ts';
import type { PropertiesPanelElements, TextTypographySnapshot } from './types.ts';

export class TypographySectionController {
  private initialTextTypographySnapshot: TextTypographySnapshot | null = null;
  private lastRememberedTextColor = '#000000';
  private textColorInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  private isTextColorHexSubmitting = false;

  private readonly roundToFourDecimals = (value: number): number => Number(value.toFixed(4));

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
  }


  public captureInitialTextTypography(): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      this.initialTextTypographySnapshot = {
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
      this.initialTextTypographySnapshot = null;
    }
  }

  public clearSnapshot(): void {
    this.initialTextTypographySnapshot = null;
  }


  public commitTextColor(color: string): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const beforeColor = this.initialTextTypographySnapshot?.fill ?? textNode.fill ?? '#000000';
      this.stateManager.setDrawingStyle({ fill: color });
      this.stateManager.updateShape<Text>(textNode.id, { fill: color });
      const cmd = new UpdateTextTypographyCommand(
        this.stateManager,
        textNode.id,
        { fill: beforeColor },
        { fill: color }
      );
      if (!cmd.isAlreadyAtTarget) this.commandManager.recordCommand(cmd);
      this.initialTextTypographySnapshot = null;
      this.syncPropertiesPanel();
    }
  }

  public previewTextColor(color: string): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!this.initialTextTypographySnapshot) this.captureInitialTextTypography();
      this.stateManager.setDrawingStyle({ fill: color });
      this.stateManager.updateShape<Text>(textNode.id, { fill: color });
      if (this.elements.swatchTextColorPreview) {
        this.elements.swatchTextColorPreview.className = 'color-swatch-preview';
        this.elements.swatchTextColorPreview.style.backgroundColor = color;
      }
      if (this.elements.inputTextHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputTextHex)) {
        this.elements.inputTextHex.value = color;
        this.elements.inputTextHex.placeholder = color;
      }
      this.elements.btnTextColorNone?.setAttribute('aria-pressed', 'false');
    }
  }

  private onTextContentFocus = () => this.captureInitialTextTypography();
  private onTextContentInput = () => {
    if (!this.elements.inputTextContent) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!this.initialTextTypographySnapshot) this.captureInitialTextTypography();
      this.stateManager.updateShape<Text>(textNode.id, { text: this.elements.inputTextContent.value });
    }
  };

  private onTextContentChange = () => {
    if (!this.elements.inputTextContent) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = this.initialTextTypographySnapshot?.text ?? textNode.text ?? 'Texto';
      const after = this.elements.inputTextContent.value;
      this.stateManager.updateShape<Text>(textNode.id, { text: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { text: before }, { text: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private onFontFamilyChange = () => {
    if (!this.elements.selectFontFamily) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = this.initialTextTypographySnapshot?.fontFamily ?? textNode.fontFamily ?? 'Inter';
      const after = this.elements.selectFontFamily.value;
      this.stateManager.updateShape<Text>(textNode.id, { fontFamily: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { fontFamily: before }, { fontFamily: after });
        this.commandManager.recordCommand(cmd);
      }
      if (typeof document !== 'undefined' && 'fonts' in document && document.fonts && typeof document.fonts.load === 'function') {
        const fontSpec = `${textNode.fontStyle ?? 'normal'} ${textNode.fontWeight ?? 400} ${textNode.fontSize ?? 16}px "${after}"`;
        document.fonts.load(fontSpec).then(() => {
          this.stateManager.markDirty();
        }).catch(() => {});
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private onFontSizeFocus = () => this.captureInitialTextTypography();
  private onFontSizeInput = () => {
    if (!this.elements.inputFontSize) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!this.initialTextTypographySnapshot) this.captureInitialTextTypography();
      const parsed = parseFloat(this.elements.inputFontSize.value);
      if (!isNaN(parsed) && parsed > 0) {
        this.stateManager.updateShape<Text>(textNode.id, { fontSize: parsed });
      }
    }
  };

  private onFontSizeChange = () => {
    if (!this.elements.inputFontSize) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const parsed = parseFloat(this.elements.inputFontSize.value);
      const after = isNaN(parsed) || parsed <= 0 ? 32 : parsed;
      this.elements.inputFontSize.value = String(after);
      const before = this.initialTextTypographySnapshot?.fontSize ?? textNode.fontSize ?? 32;
      this.stateManager.updateShape<Text>(textNode.id, { fontSize: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { fontSize: before }, { fontSize: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private onLineHeightFocus = () => this.captureInitialTextTypography();
  private onLineHeightInput = () => {
    if (!this.elements.inputLineHeight) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!this.initialTextTypographySnapshot) this.captureInitialTextTypography();
      const val = this.elements.inputLineHeight.value.trim();
      if (val === '') {
        this.stateManager.updateShape<Text>(textNode.id, { lineHeight: undefined });
      } else {
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed > 0) {
          this.stateManager.updateShape<Text>(textNode.id, { lineHeight: parsed });
        }
      }
    }
  };

  private onLineHeightChange = () => {
    if (!this.elements.inputLineHeight) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const val = this.elements.inputLineHeight.value.trim();
      let after: number | undefined;
      if (val === '') {
        after = undefined;
      } else {
        const parsed = parseFloat(val);
        after = isNaN(parsed) || parsed <= 0 ? undefined : this.roundToFourDecimals(parsed);
      }
      if (after !== undefined) {
        this.elements.inputLineHeight.value = String(after);
      } else {
        this.elements.inputLineHeight.value = '';
        const autoVal = this.roundToFourDecimals(getTextLineHeight({ ...textNode, lineHeight: undefined }));
        this.elements.inputLineHeight.placeholder = `Auto (${autoVal})`;
      }
      const before = this.initialTextTypographySnapshot?.lineHeight ?? textNode.lineHeight;
      this.stateManager.updateShape<Text>(textNode.id, { lineHeight: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { lineHeight: before }, { lineHeight: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private onLetterSpacingFocus = () => this.captureInitialTextTypography();
  private onLetterSpacingInput = () => {
    if (!this.elements.inputLetterSpacing) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      if (!this.initialTextTypographySnapshot) this.captureInitialTextTypography();
      const parsed = parseFloat(this.elements.inputLetterSpacing.value);
      if (!isNaN(parsed)) {
        this.stateManager.updateShape<Text>(textNode.id, { letterSpacing: parsed });
      }
    }
  };

  private onLetterSpacingChange = () => {
    if (!this.elements.inputLetterSpacing) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const parsed = parseFloat(this.elements.inputLetterSpacing.value);
      const after = isNaN(parsed) ? 0 : this.roundToFourDecimals(parsed);
      this.elements.inputLetterSpacing.value = String(after);
      const before = this.initialTextTypographySnapshot?.letterSpacing ?? textNode.letterSpacing ?? 0;
      this.stateManager.updateShape<Text>(textNode.id, { letterSpacing: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { letterSpacing: before }, { letterSpacing: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private onFontWeightChange = () => {
    if (!this.elements.selectFontWeight) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = this.initialTextTypographySnapshot?.fontWeight ?? textNode.fontWeight ?? 400;
      const parsed = parseInt(this.elements.selectFontWeight.value, 10);
      const after: FontWeight = isNaN(parsed) ? this.elements.selectFontWeight.value : parsed;
      this.stateManager.updateShape<Text>(textNode.id, { fontWeight: after });
      if (String(before) !== String(after)) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { fontWeight: before }, { fontWeight: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private onFontStyleChange = () => {
    if (!this.elements.selectFontStyle) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = this.initialTextTypographySnapshot?.fontStyle ?? textNode.fontStyle ?? 'normal';
      const after = this.elements.selectFontStyle.value as FontStyle;
      this.stateManager.updateShape<Text>(textNode.id, { fontStyle: after });
      if (before !== after) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { fontStyle: before }, { fontStyle: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  public applyTextAlign(align: TextAlign): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const before = this.initialTextTypographySnapshot?.textAlign ?? textNode.textAlign ?? 'left';
      this.stateManager.updateShape<Text>(textNode.id, { textAlign: align });
      if (before !== align) {
        const cmd = new UpdateTextTypographyCommand(this.stateManager, textNode.id, { textAlign: before }, { textAlign: align });
        this.commandManager.recordCommand(cmd);
      }
      this.initialTextTypographySnapshot = null;
      if (this.elements.selectTextAlign) this.elements.selectTextAlign.value = align;
      this.elements.btnTextAlignLeft?.classList.toggle('active', align === 'left');
      this.elements.btnTextAlignCenter?.classList.toggle('active', align === 'center');
      this.elements.btnTextAlignRight?.classList.toggle('active', align === 'right');
    }
  }

  private onTextAlignChange = () => {
    if (!this.elements.selectTextAlign) return;
    this.applyTextAlign(this.elements.selectTextAlign.value as TextAlign);
  };
  private onTextAlignLeftClick = () => this.applyTextAlign('left');
  private onTextAlignCenterClick = () => this.applyTextAlign('center');
  private onTextAlignRightClick = () => this.applyTextAlign('right');

  private onTextColorInput = () => {
    if (!this.elements.inputTextNative) return;
    this.previewTextColor(this.elements.inputTextNative.value.toLowerCase());
  };
  private onTextColorChange = () => {
    if (!this.elements.inputTextNative) return;
    this.commitTextColor(this.elements.inputTextNative.value.toLowerCase());
  };

  private handleTextColorHexCommit = () => {
    if (!this.elements.inputTextHex) return;
    const text = this.elements.inputTextHex.value;
    const parsed = parseHexColor(text);
    if (parsed !== null) {
      this.elements.inputTextHex.removeAttribute('aria-invalid');
      this.commitTextColor(parsed);
      this.elements.inputTextHex.value = parsed;
      this.syncPropertiesPanel();
    } else {
      if (this.textColorInvalidTimer) clearTimeout(this.textColorInvalidTimer);
      this.elements.inputTextHex.setAttribute('aria-invalid', 'true');
      this.textColorInvalidTimer = setTimeout(() => {
        this.elements.inputTextHex?.removeAttribute('aria-invalid');
        this.textColorInvalidTimer = null;
      }, 1000);

      const selectedNodes = this.stateManager.getSelectedNodes();
      if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
        const textNode = selectedNodes[0];
        const val = textNode.fill ?? '#000000';
        if (isNonePaint(val)) {
          this.elements.inputTextHex.value = '';
          this.elements.inputTextHex.placeholder = 'ninguno';
        } else {
          const hex = toValidHexColor(val, '#000000');
          this.elements.inputTextHex.value = hex;
          this.elements.inputTextHex.placeholder = hex;
        }
      }
      this.initialTextTypographySnapshot = null;
    }
  };

  private handleTextColorHexRevert = () => {
    if (!this.elements.inputTextHex) return;
    this.elements.inputTextHex.removeAttribute('aria-invalid');
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const val = textNode.fill ?? '#000000';
      if (isNonePaint(val)) {
        this.elements.inputTextHex.value = '';
        this.elements.inputTextHex.placeholder = 'ninguno';
      } else {
        const hex = toValidHexColor(val, '#000000');
        this.elements.inputTextHex.value = hex;
        this.elements.inputTextHex.placeholder = hex;
      }
    }
    this.initialTextTypographySnapshot = null;
  };

  private onTextColorHexFocus = () => this.captureInitialTextTypography();
  private onTextColorHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.elements.inputTextHex) {
        this.isTextColorHexSubmitting = true;
        this.handleTextColorHexCommit();
        this.elements.inputTextHex.blur();
        this.isTextColorHexSubmitting = false;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.elements.inputTextHex) {
        this.isTextColorHexSubmitting = true;
        this.handleTextColorHexRevert();
        this.elements.inputTextHex.blur();
        this.isTextColorHexSubmitting = false;
      }
    }
  };
  private onTextColorHexBlur = () => {
    if (this.isTextColorHexSubmitting) return;
    this.handleTextColorHexCommit();
  };

  private onTextColorNoneClick = () => {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
      const textNode = selectedNodes[0];
      const currentFill = textNode.fill ?? '#000000';
      this.captureInitialTextTypography();
      if (!isNonePaint(currentFill)) {
        this.lastRememberedTextColor = toValidHexColor(currentFill, this.lastRememberedTextColor);
        this.commitTextColor('none');
      } else {
        this.commitTextColor(this.lastRememberedTextColor);
      }
    }
  };

  public sync(singleTextNode: Text | null): void {
    const isSingleTextSelected = singleTextNode !== null;
    if (this.elements.sectionTypography) {
      this.elements.sectionTypography.style.display = isSingleTextSelected ? 'block' : 'none';
    }
    if (this.elements.groupTextColor) {
      this.elements.groupTextColor.style.display = isSingleTextSelected ? 'none' : '';
    }

    if (!isSingleTextSelected || !singleTextNode) return;

    const isTypoEditing = this.initialTextTypographySnapshot !== null;

    if (this.elements.inputTextContent && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputTextContent))) {
      this.elements.inputTextContent.value = singleTextNode.text ?? '';
    }

    if (this.elements.selectFontFamily && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.selectFontFamily))) {
      this.elements.selectFontFamily.value = singleTextNode.fontFamily ?? 'Inter';
    }

    if (this.elements.inputFontSize && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputFontSize))) {
      this.elements.inputFontSize.value = String(singleTextNode.fontSize ?? 32);
    }

    if (this.elements.inputLineHeight && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputLineHeight))) {
      if (singleTextNode.lineHeight !== undefined) {
        this.elements.inputLineHeight.value = String(this.roundToFourDecimals(singleTextNode.lineHeight));
      } else {
        this.elements.inputLineHeight.value = '';
        const autoVal = this.roundToFourDecimals(getTextLineHeight(singleTextNode));
        this.elements.inputLineHeight.placeholder = `Auto (${autoVal})`;
      }
    }

    if (this.elements.inputLetterSpacing && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputLetterSpacing))) {
      this.elements.inputLetterSpacing.value = String(this.roundToFourDecimals(singleTextNode.letterSpacing ?? 0));
    }

    if (this.elements.selectFontWeight && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.selectFontWeight))) {
      const fw = singleTextNode.fontWeight ?? 400;
      const fwStr = fw === 'normal' ? '400' : fw === 'bold' ? '700' : String(fw);
      this.elements.selectFontWeight.value = fwStr;
    }

    if (this.elements.selectFontStyle && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.selectFontStyle))) {
      this.elements.selectFontStyle.value = singleTextNode.fontStyle ?? 'normal';
    }

    const align = singleTextNode.textAlign ?? 'left';
    if (this.elements.selectTextAlign && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.selectTextAlign))) {
      this.elements.selectTextAlign.value = align;
    }
    if (this.elements.btnTextAlignLeft) this.elements.btnTextAlignLeft.classList.toggle('active', align === 'left');
    if (this.elements.btnTextAlignCenter) this.elements.btnTextAlignCenter.classList.toggle('active', align === 'center');
    if (this.elements.btnTextAlignRight) this.elements.btnTextAlignRight.classList.toggle('active', align === 'right');

    const textColor = singleTextNode.fill ?? '#000000';
    const isNone = isNonePaint(textColor);
    const validHex = toValidHexColor(textColor, '#000000');
    if (!isNone) {
      this.lastRememberedTextColor = validHex;
    }

    if (this.elements.inputTextNative && (!isTypoEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputTextNative))) {
      this.elements.inputTextNative.value = validHex;
    }

    if (this.elements.inputTextHex && (typeof document === 'undefined' || document.activeElement !== this.elements.inputTextHex)) {
      if (isNone) {
        this.elements.inputTextHex.value = '';
        this.elements.inputTextHex.placeholder = 'ninguno';
      } else {
        this.elements.inputTextHex.value = validHex;
        this.elements.inputTextHex.placeholder = validHex;
      }
    }

    if (this.elements.swatchTextColorPreview) {
      if (isNone) {
        this.elements.swatchTextColorPreview.className = 'color-swatch-preview state-none';
        this.elements.swatchTextColorPreview.style.backgroundColor = 'transparent';
      } else {
        this.elements.swatchTextColorPreview.className = 'color-swatch-preview';
        this.elements.swatchTextColorPreview.style.backgroundColor = validHex;
      }
    }

    if (this.elements.btnTextColorNone) {
      this.elements.btnTextColorNone.setAttribute('aria-pressed', String(isNone));
    }
  }

  public bind(): void {
    this.elements.inputTextContent?.addEventListener('focus', this.onTextContentFocus);
    this.elements.inputTextContent?.addEventListener('input', this.onTextContentInput);
    this.elements.inputTextContent?.addEventListener('change', this.onTextContentChange);
    this.elements.inputTextContent?.addEventListener('blur', this.onTextContentChange);

    this.elements.selectFontFamily?.addEventListener('change', this.onFontFamilyChange);

    this.elements.inputFontSize?.addEventListener('focus', this.onFontSizeFocus);
    this.elements.inputFontSize?.addEventListener('input', this.onFontSizeInput);
    this.elements.inputFontSize?.addEventListener('change', this.onFontSizeChange);
    this.elements.inputFontSize?.addEventListener('blur', this.onFontSizeChange);

    this.elements.inputLineHeight?.addEventListener('focus', this.onLineHeightFocus);
    this.elements.inputLineHeight?.addEventListener('input', this.onLineHeightInput);
    this.elements.inputLineHeight?.addEventListener('change', this.onLineHeightChange);
    this.elements.inputLineHeight?.addEventListener('blur', this.onLineHeightChange);

    this.elements.inputLetterSpacing?.addEventListener('focus', this.onLetterSpacingFocus);
    this.elements.inputLetterSpacing?.addEventListener('input', this.onLetterSpacingInput);
    this.elements.inputLetterSpacing?.addEventListener('change', this.onLetterSpacingChange);
    this.elements.inputLetterSpacing?.addEventListener('blur', this.onLetterSpacingChange);

    this.elements.selectFontWeight?.addEventListener('change', this.onFontWeightChange);
    this.elements.selectFontStyle?.addEventListener('change', this.onFontStyleChange);

    this.elements.selectTextAlign?.addEventListener('change', this.onTextAlignChange);
    this.elements.btnTextAlignLeft?.addEventListener('click', this.onTextAlignLeftClick);
    this.elements.btnTextAlignCenter?.addEventListener('click', this.onTextAlignCenterClick);
    this.elements.btnTextAlignRight?.addEventListener('click', this.onTextAlignRightClick);

    this.elements.inputTextNative?.addEventListener('input', this.onTextColorInput);
    this.elements.inputTextNative?.addEventListener('change', this.onTextColorChange);

    this.elements.inputTextHex?.addEventListener('focus', this.onTextColorHexFocus);
    this.elements.inputTextHex?.addEventListener('keydown', this.onTextColorHexKeyDown);
    this.elements.inputTextHex?.addEventListener('blur', this.onTextColorHexBlur);

    this.elements.btnTextColorNone?.addEventListener('click', this.onTextColorNoneClick);
  }

  public cleanup(): void {
    this.elements.inputTextContent?.removeEventListener('focus', this.onTextContentFocus);
    this.elements.inputTextContent?.removeEventListener('input', this.onTextContentInput);
    this.elements.inputTextContent?.removeEventListener('change', this.onTextContentChange);
    this.elements.inputTextContent?.removeEventListener('blur', this.onTextContentChange);

    this.elements.selectFontFamily?.removeEventListener('change', this.onFontFamilyChange);

    this.elements.inputFontSize?.removeEventListener('focus', this.onFontSizeFocus);
    this.elements.inputFontSize?.removeEventListener('input', this.onFontSizeInput);
    this.elements.inputFontSize?.removeEventListener('change', this.onFontSizeChange);
    this.elements.inputFontSize?.removeEventListener('blur', this.onFontSizeChange);

    this.elements.inputLineHeight?.removeEventListener('focus', this.onLineHeightFocus);
    this.elements.inputLineHeight?.removeEventListener('input', this.onLineHeightInput);
    this.elements.inputLineHeight?.removeEventListener('change', this.onLineHeightChange);
    this.elements.inputLineHeight?.removeEventListener('blur', this.onLineHeightChange);

    this.elements.inputLetterSpacing?.removeEventListener('focus', this.onLetterSpacingFocus);
    this.elements.inputLetterSpacing?.removeEventListener('input', this.onLetterSpacingInput);
    this.elements.inputLetterSpacing?.removeEventListener('change', this.onLetterSpacingChange);
    this.elements.inputLetterSpacing?.removeEventListener('blur', this.onLetterSpacingChange);

    this.elements.selectFontWeight?.removeEventListener('change', this.onFontWeightChange);
    this.elements.selectFontStyle?.removeEventListener('change', this.onFontStyleChange);

    this.elements.selectTextAlign?.removeEventListener('change', this.onTextAlignChange);
    this.elements.btnTextAlignLeft?.removeEventListener('click', this.onTextAlignLeftClick);
    this.elements.btnTextAlignCenter?.removeEventListener('click', this.onTextAlignCenterClick);
    this.elements.btnTextAlignRight?.removeEventListener('click', this.onTextAlignRightClick);

    this.elements.inputTextNative?.removeEventListener('input', this.onTextColorInput);
    this.elements.inputTextNative?.removeEventListener('change', this.onTextColorChange);

    this.elements.inputTextHex?.removeEventListener('focus', this.onTextColorHexFocus);
    this.elements.inputTextHex?.removeEventListener('keydown', this.onTextColorHexKeyDown);
    this.elements.inputTextHex?.removeEventListener('blur', this.onTextColorHexBlur);

    this.elements.btnTextColorNone?.removeEventListener('click', this.onTextColorNoneClick);

    if (this.textColorInvalidTimer) {
      clearTimeout(this.textColorInvalidTimer);
      this.textColorInvalidTimer = null;
    }
  }
}
