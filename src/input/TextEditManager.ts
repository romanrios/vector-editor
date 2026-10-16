import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { UpdateTextCommand } from '../commands/UpdateTextCommand.ts';
import {
  isText,
  type Shape,
  type Text,
} from '../types/scene-graph.ts';
import {
  getTextIndexAtPosition,
  measureSingleLineTextWidth,
} from '../utils/geometry.ts';

export interface TextEditingState {
  readonly textId: string;
  readonly originalText: string;
  currentText: string;
  cursorIndex: number;
  selectionStart: number;
  selectionEnd: number;
  readonly hasSelection: boolean;
}

export interface TextEditStateView {
  readonly textId: string;
  readonly text: string;
  readonly cursorIndex: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly cursorVisible: boolean;
}

export interface TextEditManagerHooks {
  onStartEditing?: () => void;
}

/**
 * Gestor dedicado al ciclo de vida, estado interactivo, cálculo de cursor,
 * selección multilínea y temporizador de parpadeo de la edición de texto.
 */
export class TextEditManager {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks?: TextEditManagerHooks;

  private _textEditingState: TextEditingState | null = null;
  private _cursorVisible: boolean = true;
  private _cursorBlinkTimer: ReturnType<typeof setInterval> | null = null;
  private _isMouseSelectingText: boolean = false;
  private _textDragAnchorIndex: number = 0;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    hooks?: TextEditManagerHooks
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.hooks = hooks;
  }

  public get isEditingText(): boolean {
    return this._textEditingState !== null;
  }

  public get textEditingState(): TextEditingState | null {
    return this._textEditingState;
  }

  public get hasTextSelection(): boolean {
    if (!this._textEditingState) return false;
    return this._textEditingState.selectionStart !== this._textEditingState.selectionEnd;
  }

  public get textCursorPosition(): number {
    return this._textEditingState?.cursorIndex ?? 0;
  }

  public get textSelectionRange(): { start: number; end: number } | null {
    if (!this._textEditingState) return null;
    const start = Math.min(this._textEditingState.selectionStart, this._textEditingState.selectionEnd);
    const end = Math.max(this._textEditingState.selectionStart, this._textEditingState.selectionEnd);
    return { start, end };
  }

  public get textEditState(): TextEditStateView | null {
    if (!this._textEditingState) return null;
    return {
      textId: this._textEditingState.textId,
      text: this._textEditingState.currentText,
      cursorIndex: this._textEditingState.cursorIndex,
      selectionStart: Math.min(
        this._textEditingState.selectionStart,
        this._textEditingState.selectionEnd
      ),
      selectionEnd: Math.max(
        this._textEditingState.selectionStart,
        this._textEditingState.selectionEnd
      ),
      cursorVisible: this._cursorVisible,
    };
  }

  public get cursorVisible(): boolean {
    return this._cursorVisible;
  }

  public get isMouseSelectingText(): boolean {
    return this._isMouseSelectingText;
  }

  public get textDragAnchorIndex(): number {
    return this._textDragAnchorIndex;
  }

  /**
   * Obtiene el contexto 2D del canvas para mediciones de texto si está disponible.
   */
  public getMeasureContext(): CanvasRenderingContext2D | null {
    try {
      return this.canvas.getContext('2d') as CanvasRenderingContext2D | null;
    } catch {
      return null;
    }
  }

  /**
   * Inicia el temporizador de parpadeo del cursor (~500ms) provocando repintado sólo en dirty-loop.
   */
  public startCursorBlink(): void {
    this.stopCursorBlink();
    this._cursorVisible = true;
    if (typeof setInterval !== 'undefined') {
      this._cursorBlinkTimer = setInterval(() => {
        if (!this._textEditingState) {
          this.stopCursorBlink();
          return;
        }
        this._cursorVisible = !this._cursorVisible;
        this.stateManager.markDirty();
      }, 500);
      if (this._cursorBlinkTimer && typeof (this._cursorBlinkTimer as any).unref === 'function') {
        (this._cursorBlinkTimer as any).unref();
      }
    }
  }

  /**
   * Restablece la visibilidad activa del cursor y reinicia el intervalo de 500ms (al teclear o mover).
   */
  public resetCursorBlink(): void {
    this._cursorVisible = true;
    if (this._cursorBlinkTimer !== null && typeof setInterval !== 'undefined') {
      clearInterval(this._cursorBlinkTimer);
      this._cursorBlinkTimer = setInterval(() => {
        if (!this._textEditingState) {
          this.stopCursorBlink();
          return;
        }
        this._cursorVisible = !this._cursorVisible;
        this.stateManager.markDirty();
      }, 500);
      if (this._cursorBlinkTimer && typeof (this._cursorBlinkTimer as any).unref === 'function') {
        (this._cursorBlinkTimer as any).unref();
      }
    }
  }

  /**
   * Detiene el intervalo de parpadeo del cursor cuando la edición cesa.
   */
  public stopCursorBlink(): void {
    if (this._cursorBlinkTimer !== null) {
      clearInterval(this._cursorBlinkTimer);
      this._cursorBlinkTimer = null;
    }
    this._cursorVisible = true;
  }

  /**
   * Inicia la edición de contenido en un nodo Text existente.
   * @param textId ID del nodo Text
   * @param initialCursorIndex Posición inicial del cursor
   * @param selectAll Si es true, selecciona inicialmente todo el contenido del texto
   */
  public startEditingText(textId: string, initialCursorIndex?: number, selectAll: boolean = false): boolean {
    if (this._textEditingState?.textId === textId) {
      const len = this._textEditingState.currentText.length;
      if (selectAll) {
        this._textEditingState.selectionStart = 0;
        this._textEditingState.selectionEnd = len;
        this._textEditingState.cursorIndex = len;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      } else if (initialCursorIndex !== undefined) {
        const pos = Math.max(0, Math.min(len, initialCursorIndex));
        this._textEditingState.cursorIndex = pos;
        this._textEditingState.selectionStart = pos;
        this._textEditingState.selectionEnd = pos;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      }
      this.canvas.style.cursor = 'text';
      return true;
    }
    if (this._textEditingState) {
      this.commitTextEdit();
    }

    const node = this.stateManager.findNode(textId);
    if (!node || !isText(node) || node.locked) {
      return false;
    }

    this.hooks?.onStartEditing?.();

    if (!this.stateManager.isSelected(textId) || this.stateManager.getSelection().length !== 1) {
      this.stateManager.selectNode(textId);
    }

    const initialStr = node.text ?? '';
    const len = initialStr.length;
    let start = len;
    let end = len;
    let cursor = len;

    if (selectAll) {
      start = 0;
      end = len;
      cursor = len;
    } else if (initialCursorIndex !== undefined) {
      const pos = Math.max(0, Math.min(len, initialCursorIndex));
      start = pos;
      end = pos;
      cursor = pos;
    }

    this._textEditingState = {
      textId: node.id,
      originalText: initialStr,
      currentText: initialStr,
      cursorIndex: cursor,
      selectionStart: start,
      selectionEnd: end,
      get hasSelection(): boolean {
        return this.selectionStart !== this.selectionEnd;
      },
    };

    this.canvas.style.cursor = 'text';

    this.startCursorBlink();
    this.stateManager.markDirty();
    return true;
  }

  /**
   * Confirma la edición de texto actual, persistiendo el cambio mediante StateManager
   * y registrando un UpdateTextCommand en CommandManager si el contenido fue modificado.
   */
  public commitTextEdit(): boolean {
    if (!this._textEditingState) {
      return false;
    }

    this.stopCursorBlink();
    this._isMouseSelectingText = false;
    const { textId, originalText, currentText } = this._textEditingState;
    this._textEditingState = null;

    const node = this.stateManager.findNode(textId);
    if (!node || !isText(node)) {
      this.stateManager.markDirty();
      return false;
    }

    if (currentText !== originalText) {
      const command = new UpdateTextCommand(this.stateManager, textId, originalText, currentText);
      this.commandManager.executeCommand(command);
    } else {
      this.stateManager.markDirty();
    }

    return true;
  }

  /**
   * Cancela la edición de texto activa restaurando el contenido anterior
   * sin registrar ningún comando.
   */
  public cancelTextEdit(): void {
    if (!this._textEditingState) {
      return;
    }

    this.stopCursorBlink();
    this._isMouseSelectingText = false;
    this._textEditingState = null;
    this.stateManager.markDirty();
  }

  /**
   * Maneja el clic en mousedown cuando la edición de texto está activa.
   * Retorna true si el evento fue consumido por el texto en edición.
   */
  public handleMouseDown(hitShape: Shape | null, x: number, y: number): boolean {
    if (!this._textEditingState) {
      return false;
    }

    if (hitShape && hitShape.id === this._textEditingState.textId) {
      const textNode = this.stateManager.findNode(this._textEditingState.textId) as Text;
      const charIndex = getTextIndexAtPosition(
        { ...textNode, text: this._textEditingState.currentText },
        x,
        y,
        this.getMeasureContext()
      );
      this._textEditingState.cursorIndex = charIndex;
      this._textEditingState.selectionStart = charIndex;
      this._textEditingState.selectionEnd = charIndex;
      this._isMouseSelectingText = true;
      this._textDragAnchorIndex = charIndex;
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    } else {
      this.commitTextEdit();
      return false;
    }
  }

  /**
   * Maneja el arrastre para selección de texto en mousemove.
   * Retorna true si fue consumido por la selección de texto.
   */
  public handleMouseMove(x: number, y: number): boolean {
    if (this._isMouseSelectingText && this._textEditingState) {
      const node = this.stateManager.findNode(this._textEditingState.textId);
      if (node && isText(node)) {
        const charIndex = getTextIndexAtPosition(
          {
            ...node,
            text: this._textEditingState.currentText,
          },
          x,
          y,
          this.getMeasureContext()
        );
        this._textEditingState.cursorIndex = charIndex;
        this._textEditingState.selectionStart = this._textDragAnchorIndex;
        this._textEditingState.selectionEnd = charIndex;
        this.resetCursorBlink();
        this.stateManager.markDirty();
        return true;
      }
    }
    return false;
  }

  /**
   * Finaliza la selección por arrastre de texto en mouseup.
   * Retorna true si estaba seleccionando texto con el ratón.
   */
  public handleMouseUp(): boolean {
    if (this._isMouseSelectingText) {
      this._isMouseSelectingText = false;
      this.stateManager.markDirty();
      return true;
    }
    return false;
  }

  /**
   * Calcula el nuevo índice de cursor al desplazarse verticalmente (arriba o abajo)
   * entre líneas, intentando preservar la posición horizontal en píxeles.
   */
  public computeVerticalNavIndex(text: string, cursor: number, dir: -1 | 1): number {
    const lines = text.split('\n');
    const lineStarts: number[] = [];
    let currStart = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStarts.push(currStart);
      currStart += lines[i].length + 1;
    }

    let lineIdx = lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
      const start = lineStarts[i];
      const end = start + lines[i].length;
      if (cursor <= end) {
        lineIdx = i;
        break;
      }
    }

    const targetLineIdx = lineIdx + dir;
    if (targetLineIdx < 0) {
      return 0;
    }
    if (targetLineIdx >= lines.length) {
      return text.length;
    }

    const currentLine = lines[lineIdx];
    const targetLine = lines[targetLineIdx];
    const currentCol = Math.max(0, Math.min(currentLine.length, cursor - lineStarts[lineIdx]));

    const textNode = this._textEditingState
      ? (this.stateManager.findNode(this._textEditingState.textId) as Text | null)
      : null;
    const nodeForMetrics: Text = textNode ?? {
      id: 'metric-dummy',
      type: 'text',
      name: 'metric-dummy',
      x: 0,
      y: 0,
      text: '',
    };
    const ctx = this.getMeasureContext();
    const currentXOffset = measureSingleLineTextWidth(nodeForMetrics, currentLine.slice(0, currentCol), ctx);

    let targetCol = 0;
    let minDiff = Infinity;
    for (let i = 0; i <= targetLine.length; i++) {
      const w = measureSingleLineTextWidth(nodeForMetrics, targetLine.slice(0, i), ctx);
      const diff = Math.abs(w - currentXOffset);
      if (diff < minDiff) {
        minDiff = diff;
        targetCol = i;
      }
    }

    return lineStarts[targetLineIdx] + targetCol;
  }

  /**
   * Maneja los eventos de teclado durante la edición de texto activa.
   * Retorna true si el evento fue procesado por el modo de edición de texto.
   */
  public handleKeyDown(event: KeyboardEvent): boolean {
    if (!this._textEditingState) {
      return false;
    }

    const key = event.key;
    const keyLower = key ? key.toLowerCase() : '';
    const text = this._textEditingState.currentText;
    const cursor = this._textEditingState.cursorIndex;
    const selAnchor = this._textEditingState.selectionStart;
    const selFocus = this._textEditingState.selectionEnd;
    const hasSelection = selAnchor !== selFocus;
    const selMin = Math.min(selAnchor, selFocus);
    const selMax = Math.max(selAnchor, selFocus);

    if (keyLower === 'escape') {
      event.preventDefault?.();
      this.cancelTextEdit();
      return true;
    }

    if (keyLower === 'enter') {
      event.preventDefault?.();
      if (hasSelection) {
        this._textEditingState.currentText = text.slice(0, selMin) + '\n' + text.slice(selMax);
        const newCursor = selMin + 1;
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      } else {
        this._textEditingState.currentText = text.slice(0, cursor) + '\n' + text.slice(cursor);
        const newCursor = cursor + 1;
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Ctrl/Cmd + A: Seleccionar todo el contenido
    if ((event.ctrlKey || event.metaKey) && keyLower === 'a') {
      event.preventDefault?.();
      this._textEditingState.selectionStart = 0;
      this._textEditingState.selectionEnd = text.length;
      this._textEditingState.cursorIndex = text.length;
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Flecha izquierda: mover cursor o extender selección con Shift
    if (key === 'ArrowLeft') {
      event.preventDefault?.();
      if (event.shiftKey) {
        const newCursor = Math.max(0, cursor - 1);
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      } else {
        const newCursor = hasSelection ? selMin : Math.max(0, cursor - 1);
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Flecha derecha: mover cursor o extender selección con Shift
    if (key === 'ArrowRight') {
      event.preventDefault?.();
      if (event.shiftKey) {
        const newCursor = Math.min(text.length, cursor + 1);
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      } else {
        const newCursor = hasSelection ? selMax : Math.min(text.length, cursor + 1);
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Flecha arriba: mover a línea anterior conservando posición horizontal relativa
    if (key === 'ArrowUp' || key === 'Up') {
      event.preventDefault?.();
      const newCursor = this.computeVerticalNavIndex(text, cursor, -1);
      this._textEditingState.cursorIndex = newCursor;
      if (event.shiftKey) {
        this._textEditingState.selectionEnd = newCursor;
      } else {
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Flecha abajo: mover a línea siguiente conservando posición horizontal relativa
    if (key === 'ArrowDown' || key === 'Down') {
      event.preventDefault?.();
      const newCursor = this.computeVerticalNavIndex(text, cursor, 1);
      this._textEditingState.cursorIndex = newCursor;
      if (event.shiftKey) {
        this._textEditingState.selectionEnd = newCursor;
      } else {
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Home: inicio de línea (o inicio de todo el texto con Ctrl/Cmd)
    if (key === 'Home') {
      event.preventDefault?.();
      let newPos = 0;
      if (event.ctrlKey || event.metaKey) {
        newPos = 0;
      } else {
        const lastNewline = text.lastIndexOf('\n', cursor - 1);
        newPos = lastNewline === -1 ? 0 : lastNewline + 1;
      }
      this._textEditingState.cursorIndex = newPos;
      if (event.shiftKey) {
        this._textEditingState.selectionEnd = newPos;
      } else {
        this._textEditingState.selectionStart = newPos;
        this._textEditingState.selectionEnd = newPos;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // End: fin de línea (o fin de todo el texto con Ctrl/Cmd)
    if (key === 'End') {
      event.preventDefault?.();
      let newPos = text.length;
      if (event.ctrlKey || event.metaKey) {
        newPos = text.length;
      } else {
        const nextNewline = text.indexOf('\n', cursor);
        newPos = nextNewline === -1 ? text.length : nextNewline;
      }
      this._textEditingState.cursorIndex = newPos;
      if (event.shiftKey) {
        this._textEditingState.selectionEnd = newPos;
      } else {
        this._textEditingState.selectionStart = newPos;
        this._textEditingState.selectionEnd = newPos;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    // Backspace: elimina carácter anterior o reemplaza selección
    if (keyLower === 'backspace') {
      event.preventDefault?.();
      if (hasSelection) {
        this._textEditingState.currentText = text.slice(0, selMin) + text.slice(selMax);
        this._textEditingState.cursorIndex = selMin;
        this._textEditingState.selectionStart = selMin;
        this._textEditingState.selectionEnd = selMin;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      } else if (cursor > 0) {
        this._textEditingState.currentText = text.slice(0, cursor - 1) + text.slice(cursor);
        const newCursor = cursor - 1;
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      }
      return true;
    }

    // Delete: elimina carácter siguiente o reemplaza selección
    if (keyLower === 'delete') {
      event.preventDefault?.();
      if (hasSelection) {
        this._textEditingState.currentText = text.slice(0, selMin) + text.slice(selMax);
        this._textEditingState.cursorIndex = selMin;
        this._textEditingState.selectionStart = selMin;
        this._textEditingState.selectionEnd = selMin;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      } else if (cursor < text.length) {
        this._textEditingState.currentText = text.slice(0, cursor) + text.slice(cursor + 1);
        this._textEditingState.cursorIndex = cursor;
        this._textEditingState.selectionStart = cursor;
        this._textEditingState.selectionEnd = cursor;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      }
      return true;
    }

    // Ctrl/Cmd + C: copiar texto seleccionado al portapapeles del sistema
    if ((event.ctrlKey || event.metaKey) && keyLower === 'c') {
      event.preventDefault?.();
      if (hasSelection && typeof navigator !== 'undefined' && navigator.clipboard) {
        const selectedText = text.slice(selMin, selMax);
        navigator.clipboard.writeText(selectedText).catch(() => {
          // Silenciar errores de permisos de portapapeles
        });
      }
      return true;
    }

    // Ctrl/Cmd + V: pegar texto del portapapeles del sistema
    if ((event.ctrlKey || event.metaKey) && keyLower === 'v') {
      event.preventDefault?.();
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.readText().then((pasted) => {
          if (!this._textEditingState || !pasted) return;
          const curText = this._textEditingState.currentText;
          const curCursor = this._textEditingState.cursorIndex;
          const curSelStart = this._textEditingState.selectionStart;
          const curSelEnd = this._textEditingState.selectionEnd;
          const hasTextSelection = curSelStart !== curSelEnd;
          const curSelMin = Math.min(curSelStart, curSelEnd);
          const curSelMax = Math.max(curSelStart, curSelEnd);
          // Normalizar saltos de línea del portapapeles
          const normalized = pasted.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          let newText: string;
          let newCursor: number;
          if (hasTextSelection) {
            newText = curText.slice(0, curSelMin) + normalized + curText.slice(curSelMax);
            newCursor = curSelMin + normalized.length;
          } else {
            newText = curText.slice(0, curCursor) + normalized + curText.slice(curCursor);
            newCursor = curCursor + normalized.length;
          }
          this._textEditingState.currentText = newText;
          this._textEditingState.cursorIndex = newCursor;
          this._textEditingState.selectionStart = newCursor;
          this._textEditingState.selectionEnd = newCursor;
          this.resetCursorBlink();
          this.stateManager.markDirty();
        }).catch(() => {
          // Silenciar errores de permisos de portapapeles
        });
      }
      return true;
    }

    // Escribir carácter imprimible (reemplaza selección o inserta en cursor)
    if (event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault?.();
      if (hasSelection) {
        this._textEditingState.currentText = text.slice(0, selMin) + event.key + text.slice(selMax);
        const newCursor = selMin + 1;
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      } else {
        this._textEditingState.currentText = text.slice(0, cursor) + event.key + text.slice(cursor);
        const newCursor = cursor + 1;
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
      }
      this.resetCursorBlink();
      this.stateManager.markDirty();
      return true;
    }

    return true;
  }

  public destroy(): void {
    this.stopCursorBlink();
    this._textEditingState = null;
    this._isMouseSelectingText = false;
  }
}
