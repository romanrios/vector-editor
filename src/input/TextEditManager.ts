import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { UpdateTextCommand } from '../commands/UpdateTextCommand.ts';
import {
  isText,
  type Shape,
  type Text,
  type Vector2D,
} from '../types/scene-graph.ts';
import {
  getTextIndexAtPosition,
  measureSingleLineTextWidth,
  getTextAABB,
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
  worldToScreen?: (point: Vector2D) => Vector2D;
  screenToWorld?: (point: Vector2D) => Vector2D;
  getZoom?: () => number;
  onWheel?: (event: WheelEvent) => void;
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
  private _mobileInputProxy: HTMLTextAreaElement | null = null;
  private _windowCleanupCallbacks: Array<() => void> = [];
  private _isProgrammaticProxySync: boolean = false;
  private _lastClickTime: number = 0;
  private _lastClickPos: { x: number; y: number } = { x: 0, y: 0 };
  private _clickCount: number = 0;

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

  public screenToWorldCoords(clientX: number, clientY: number): Vector2D {
    const rect = typeof this.canvas.getBoundingClientRect === 'function'
      ? this.canvas.getBoundingClientRect()
      : { left: 0, top: 0 };
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    if (this.hooks?.screenToWorld) {
      return this.hooks.screenToWorld({ x: screenX, y: screenY });
    }
    return { x: screenX, y: screenY };
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
    this.syncProxyValue();
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
      this.setupMobileInputProxy(selectAll);
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

    this.setupMobileInputProxy(selectAll);
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

    this.teardownMobileInputProxy();
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

    this.teardownMobileInputProxy();
    this.stopCursorBlink();
    this._isMouseSelectingText = false;
    this._textEditingState = null;
    this.stateManager.markDirty();
  }

  public registerClick(x: number, y: number, eventDetail?: number): number {
    const now = Date.now();
    const dt = now - this._lastClickTime;
    const dist = Math.hypot(x - this._lastClickPos.x, y - this._lastClickPos.y);
    if (dt < 400 && dist < 15) {
      this._clickCount++;
    } else {
      this._clickCount = 1;
    }
    this._lastClickTime = now;
    this._lastClickPos = { x, y };

    if (typeof eventDetail === 'number' && eventDetail > 0) {
      return Math.max(eventDetail, this._clickCount);
    }
    return this._clickCount;
  }

  /**
   * Maneja el clic en mousedown cuando la edición de texto está activa.
   * Soporta selección de palabra en doble clic y selección de línea en triple clic.
   * Retorna true si el evento fue consumido por el texto en edición.
   */
  public handleMouseDown(hitShape: Shape | null, x: number, y: number, clickCount?: number): boolean {
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

      const effectiveClicks = this.registerClick(x, y, clickCount);

      if (effectiveClicks >= 3) {
        this.selectLineAt(charIndex);
        this._isMouseSelectingText = false;
        this.setupMobileInputProxy(false);
        return true;
      }

      if (effectiveClicks === 2) {
        this.selectWordAt(charIndex);
        this._isMouseSelectingText = false;
        this.setupMobileInputProxy(false);
        return true;
      }

      this._textEditingState.cursorIndex = charIndex;
      this._textEditingState.selectionStart = charIndex;
      this._textEditingState.selectionEnd = charIndex;
      this._isMouseSelectingText = true;
      this._textDragAnchorIndex = charIndex;
      this.syncProxySelection();
      this.resetCursorBlink();
      this.stateManager.markDirty();
      this.setupMobileInputProxy(false);
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
        this.syncProxySelection();
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
      this.syncProxySelection();
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
      this.syncProxyValue();
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

    // Ctrl/Cmd + X: cortar texto seleccionado al portapapeles del sistema
    if ((event.ctrlKey || event.metaKey) && keyLower === 'x') {
      event.preventDefault?.();
      if (hasSelection) {
        const selectedText = text.slice(selMin, selMax);
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(selectedText).catch(() => {
            // Silenciar errores de permisos de portapapeles
          });
        }
        this._textEditingState.currentText = text.slice(0, selMin) + text.slice(selMax);
        this._textEditingState.cursorIndex = selMin;
        this._textEditingState.selectionStart = selMin;
        this._textEditingState.selectionEnd = selMin;
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

  public insertText(insertedText: string): void {
    if (!this._textEditingState) return;
    const text = this._textEditingState.currentText;
    const cursor = this._textEditingState.cursorIndex;
    const selAnchor = this._textEditingState.selectionStart;
    const selFocus = this._textEditingState.selectionEnd;
    const hasSelection = selAnchor !== selFocus;
    const selMin = Math.min(selAnchor, selFocus);
    const selMax = Math.max(selAnchor, selFocus);

    if (hasSelection) {
      this._textEditingState.currentText = text.slice(0, selMin) + insertedText + text.slice(selMax);
      const newCursor = selMin + insertedText.length;
      this._textEditingState.cursorIndex = newCursor;
      this._textEditingState.selectionStart = newCursor;
      this._textEditingState.selectionEnd = newCursor;
    } else {
      this._textEditingState.currentText = text.slice(0, cursor) + insertedText + text.slice(cursor);
      const newCursor = cursor + insertedText.length;
      this._textEditingState.cursorIndex = newCursor;
      this._textEditingState.selectionStart = newCursor;
      this._textEditingState.selectionEnd = newCursor;
    }
    this.resetCursorBlink();
    this.stateManager.markDirty();
  }

  private syncProxyValue(): void {
    if (!this._mobileInputProxy || !this._textEditingState) return;
    if (this._mobileInputProxy.value !== this._textEditingState.currentText) {
      this._mobileInputProxy.value = this._textEditingState.currentText;
    }
    if (this._textEditingState.hasSelection) {
      this.syncProxySelection();
    } else {
      const pos = this._textEditingState.cursorIndex;
      try {
        this._isProgrammaticProxySync = true;
        this._mobileInputProxy.setSelectionRange(pos, pos);
      } catch {
        // Ignorar si el entorno mock no implementa setSelectionRange
      } finally {
        setTimeout(() => {
          this._isProgrammaticProxySync = false;
        }, 0);
      }
    }
  }

  public updateMobileInputProxyPosition(): void {
    if (!this._mobileInputProxy || !this._textEditingState) return;
    const canvasRect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    let screenX = canvasRect.left + 50;
    let screenY = canvasRect.top + 50;
    let textWidth = 60;
    let textHeight = 36;

    const node = this.stateManager.findNode(this._textEditingState.textId);
    if (node && isText(node) && this.hooks?.worldToScreen) {
      const zoom = this.hooks.getZoom?.() ?? 1;
      const ctx = this.getMeasureContext();
      const effectiveNode = { ...node, text: this._textEditingState.currentText };
      const aabb = getTextAABB(effectiveNode, ctx);
      const screenPos = this.hooks.worldToScreen({ x: aabb.minX, y: aabb.minY });
      screenX = canvasRect.left + screenPos.x;
      screenY = canvasRect.top + screenPos.y;
      textWidth = Math.max(60, aabb.width * zoom);
      textHeight = Math.max(36, aabb.height * zoom);
    }

    const winW = typeof window !== 'undefined' ? window.innerWidth : 400;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 600;
    const clampedX = Math.max(10, Math.min(winW - 60, screenX));
    const clampedY = Math.max(10, Math.min(winH - 60, screenY));

    this._mobileInputProxy.style.top = `${clampedY}px`;
    this._mobileInputProxy.style.left = `${clampedX}px`;
    this._mobileInputProxy.style.width = `${Math.min(winW - clampedX - 10, Math.max(60, textWidth))}px`;
    this._mobileInputProxy.style.height = `${Math.min(winH - clampedY - 10, Math.max(36, textHeight))}px`;
    this._mobileInputProxy.style.pointerEvents = 'auto';
  }

  public ensureProxyFocused(): void {
    if (this._mobileInputProxy && this._textEditingState) {
      try {
        if (typeof document !== 'undefined' && document.activeElement !== this._mobileInputProxy) {
          this._mobileInputProxy.focus({ preventScroll: true });
        }
      } catch {
        this._mobileInputProxy?.focus();
      }
    }
  }

  private setupMobileInputProxy(selectAll: boolean = false): void {
    if (typeof document === 'undefined') return;
    if (!this._mobileInputProxy) {
      this._mobileInputProxy = document.createElement('textarea');
      this._mobileInputProxy.id = 'mobile-text-proxy';
      this._mobileInputProxy.setAttribute('autocomplete', 'off');
      this._mobileInputProxy.setAttribute('autocorrect', 'off');
      this._mobileInputProxy.setAttribute('autocapitalize', 'off');
      this._mobileInputProxy.setAttribute('spellcheck', 'false');
      this._mobileInputProxy.setAttribute('aria-label', 'Editor de texto');
      this._mobileInputProxy.style.position = 'fixed';
      this._mobileInputProxy.style.opacity = '0.01';
      this._mobileInputProxy.style.color = 'transparent';
      this._mobileInputProxy.style.background = 'transparent';
      this._mobileInputProxy.style.border = 'none';
      this._mobileInputProxy.style.outline = 'none';
      this._mobileInputProxy.style.resize = 'none';
      this._mobileInputProxy.style.overflow = 'hidden';
      this._mobileInputProxy.style.padding = '0';
      this._mobileInputProxy.style.margin = '0';
      this._mobileInputProxy.style.fontSize = '16px';
      this._mobileInputProxy.style.pointerEvents = 'auto';
      this._mobileInputProxy.style.zIndex = '50';

      this._mobileInputProxy.addEventListener('input', () => {
        if (!this._mobileInputProxy || !this._textEditingState) return;
        const newText = this._mobileInputProxy.value;
        const newCursor = this._mobileInputProxy.selectionStart ?? newText.length;
        this._textEditingState.currentText = newText;
        this._textEditingState.cursorIndex = newCursor;
        this._textEditingState.selectionStart = newCursor;
        this._textEditingState.selectionEnd = newCursor;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      });

      // Delegación de la rueda del ratón (Ctrl+Wheel / Pan) al ViewportManager
      this._mobileInputProxy.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        this.hooks?.onWheel?.(e);
      }, { passive: false });

      const handleProxyPointerDown = (e: MouseEvent | PointerEvent) => {
        if (e.button !== 0 && e.button !== undefined) return;
        e.preventDefault();
        this.ensureProxyFocused();
        this.resetCursorBlink();
        if (!this._textEditingState) return;
        const textNode = this.stateManager.findNode(this._textEditingState.textId);
        if (textNode && isText(textNode)) {
          const coords = this.screenToWorldCoords(e.clientX, e.clientY);
          const effectiveClicks = this.registerClick(coords.x, coords.y, (e as MouseEvent).detail);
          const charIndex = getTextIndexAtPosition(
            { ...textNode, text: this._textEditingState.currentText },
            coords.x,
            coords.y,
            this.getMeasureContext()
          );

          if (effectiveClicks >= 3) {
            this.selectLineAt(charIndex);
            this._isMouseSelectingText = false;
            return;
          }

          if (effectiveClicks === 2) {
            this.selectWordAt(charIndex);
            this._isMouseSelectingText = false;
            return;
          }

          this._textEditingState.cursorIndex = charIndex;
          this._textEditingState.selectionStart = charIndex;
          this._textEditingState.selectionEnd = charIndex;
          this._isMouseSelectingText = true;
          this._textDragAnchorIndex = charIndex;
          this.syncProxySelection();
          this.stateManager.markDirty();
        }
      };

      this._mobileInputProxy.addEventListener('pointerdown', handleProxyPointerDown);
      this._mobileInputProxy.addEventListener('mousedown', handleProxyPointerDown);

      const handleProxyPointerMove = (e: MouseEvent | PointerEvent) => {
        if (!this._isMouseSelectingText || !this._textEditingState) return;
        const textNode = this.stateManager.findNode(this._textEditingState.textId);
        if (textNode && isText(textNode)) {
          const coords = this.screenToWorldCoords(e.clientX, e.clientY);
          const charIndex = getTextIndexAtPosition(
            { ...textNode, text: this._textEditingState.currentText },
            coords.x,
            coords.y,
            this.getMeasureContext()
          );
          this._textEditingState.cursorIndex = charIndex;
          this._textEditingState.selectionStart = this._textDragAnchorIndex;
          this._textEditingState.selectionEnd = charIndex;
          this.syncProxySelection();
          this.stateManager.markDirty();
        }
      };

      this._mobileInputProxy.addEventListener('pointermove', handleProxyPointerMove);
      this._mobileInputProxy.addEventListener('mousemove', handleProxyPointerMove);

      const handleProxyPointerUp = (e?: MouseEvent | PointerEvent) => {
        e?.preventDefault?.();
        if (this._isMouseSelectingText) {
          this._isMouseSelectingText = false;
          this.syncProxySelection();
          this.stateManager.markDirty();
        }
      };

      this._mobileInputProxy.addEventListener('pointerup', handleProxyPointerUp);
      this._mobileInputProxy.addEventListener('mouseup', handleProxyPointerUp);

      this._mobileInputProxy.addEventListener('dblclick', (e: MouseEvent) => {
        if (!this._textEditingState) return;
        const textNode = this.stateManager.findNode(this._textEditingState.textId);
        if (textNode && isText(textNode)) {
          const coords = this.screenToWorldCoords(e.clientX, e.clientY);
          const charIndex = getTextIndexAtPosition(
            { ...textNode, text: this._textEditingState.currentText },
            coords.x,
            coords.y,
            this.getMeasureContext()
          );
          this.selectWordAt(charIndex);
        }
      });

      this._mobileInputProxy.addEventListener('click', (e: MouseEvent) => {
        if (!this._textEditingState) return;
        const textNode = this.stateManager.findNode(this._textEditingState.textId);
        if (!textNode || !isText(textNode)) return;
        const coords = this.screenToWorldCoords(e.clientX, e.clientY);
        const effectiveClicks = (e.detail && e.detail >= 3) ? e.detail : this._clickCount;
        if (effectiveClicks >= 3) {
          const charIndex = getTextIndexAtPosition(
            { ...textNode, text: this._textEditingState.currentText },
            coords.x,
            coords.y,
            this.getMeasureContext()
          );
          this.selectLineAt(charIndex);
        }
      });

      if (typeof window !== 'undefined') {
        const onWinMouseMove = (e: MouseEvent) => {
          if (this._isMouseSelectingText) {
            handleProxyPointerMove(e);
          }
        };
        const onWinMouseUp = () => {
          if (this._isMouseSelectingText) {
            handleProxyPointerUp();
          }
        };
        window.addEventListener('mousemove', onWinMouseMove);
        window.addEventListener('mouseup', onWinMouseUp);
        this._windowCleanupCallbacks.push(() => {
          window.removeEventListener('mousemove', onWinMouseMove);
          window.removeEventListener('mouseup', onWinMouseUp);
        });
      }

      const onSelectionSync = () => {
        if (
          !this._mobileInputProxy ||
          !this._textEditingState ||
          this._isMouseSelectingText ||
          this._isProgrammaticProxySync
        ) {
          return;
        }
        const proxyStart = this._mobileInputProxy.selectionStart ?? 0;
        const proxyEnd = this._mobileInputProxy.selectionEnd ?? 0;
        const isBackward = this._mobileInputProxy.selectionDirection === 'backward';
        const currentMin = Math.min(this._textEditingState.selectionStart, this._textEditingState.selectionEnd);
        const currentMax = Math.max(this._textEditingState.selectionStart, this._textEditingState.selectionEnd);

        if (currentMin === proxyStart && currentMax === proxyEnd) {
          return;
        }

        const expectedStart = isBackward ? proxyEnd : proxyStart;
        const expectedEnd = isBackward ? proxyStart : proxyEnd;
        const expectedCursor = isBackward ? proxyStart : proxyEnd;
        this._textEditingState.selectionStart = expectedStart;
        this._textEditingState.selectionEnd = expectedEnd;
        this._textEditingState.cursorIndex = expectedCursor;
        this.resetCursorBlink();
        this.stateManager.markDirty();
      };
      this._mobileInputProxy.addEventListener('select', onSelectionSync);
      this._mobileInputProxy.addEventListener('keyup', onSelectionSync);

      this._mobileInputProxy.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.commitTextEdit();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          this.handleKeyDown(e);
          this.syncProxyValue();
        }
      });

      document.body.appendChild(this._mobileInputProxy);
    }

    this.updateMobileInputProxyPosition();

    if (this._mobileInputProxy && this._textEditingState) {
      this._mobileInputProxy.value = this._textEditingState.currentText;
      const textLen = this._textEditingState.currentText.length;
      if (selectAll) {
        try {
          this._mobileInputProxy.setSelectionRange(0, textLen);
        } catch {}
      } else {
        const pos = Math.min(textLen, this._textEditingState.cursorIndex);
        try {
          this._mobileInputProxy.setSelectionRange(pos, pos);
        } catch {}
      }
      try {
        this._mobileInputProxy.focus({ preventScroll: true });
      } catch {
        this._mobileInputProxy.focus();
      }

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          if (this._textEditingState && this._mobileInputProxy) {
            try {
              if (document.activeElement !== this._mobileInputProxy) {
                this._mobileInputProxy.focus({ preventScroll: true });
              }
            } catch {}
          }
        });
      }
      if (typeof setTimeout !== 'undefined') {
        setTimeout(() => {
          if (this._textEditingState && this._mobileInputProxy) {
            try {
              if (document.activeElement !== this._mobileInputProxy) {
                this._mobileInputProxy.focus({ preventScroll: true });
              }
            } catch {}
          }
        }, 50);
      }
    }
  }

  private teardownMobileInputProxy(): void {
    if (this._mobileInputProxy) {
      this._mobileInputProxy.blur();
      this._mobileInputProxy.style.top = '-9999px';
      this._mobileInputProxy.style.left = '-9999px';
      this._mobileInputProxy.style.pointerEvents = 'none';
    }
  }

  /**
   * Selecciona la palabra completa ubicada en la posición `index` (para eventos de doble clic).
   */
  public selectWordAt(index: number): void {
    if (!this._textEditingState) return;
    const text = this._textEditingState.currentText;
    if (!text || text.length === 0) return;
    const pos = Math.max(0, Math.min(text.length, index));

    const isWordChar = (char: string) => /[\p{L}\p{N}_]/u.test(char);

    let start = pos;
    let end = pos;

    if (pos < text.length && isWordChar(text[pos])) {
      while (start > 0 && isWordChar(text[start - 1])) {
        start--;
      }
      while (end < text.length && isWordChar(text[end])) {
        end++;
      }
    } else if (pos > 0 && isWordChar(text[pos - 1])) {
      start = pos - 1;
      while (start > 0 && isWordChar(text[start - 1])) {
        start--;
      }
      end = pos;
      while (end < text.length && isWordChar(text[end])) {
        end++;
      }
    } else {
      while (start > 0 && !isWordChar(text[start - 1]) && text[start - 1] !== '\n') {
        start--;
      }
      while (end < text.length && !isWordChar(text[end]) && text[end] !== '\n') {
        end++;
      }
    }

    this._textEditingState.selectionStart = start;
    this._textEditingState.selectionEnd = end;
    this._textEditingState.cursorIndex = end;
    this.syncProxySelection();
    this.resetCursorBlink();
    this.stateManager.markDirty();
  }

  /**
   * Selecciona la línea completa ubicada en la posición `index` (para eventos de triple clic).
   */
  public selectLineAt(index: number): void {
    if (!this._textEditingState) return;
    const text = this._textEditingState.currentText;
    if (!text) return;
    const pos = Math.max(0, Math.min(text.length, index));
    const lastNewline = text.lastIndexOf('\n', pos - 1);
    const start = lastNewline === -1 ? 0 : lastNewline + 1;
    const nextNewline = text.indexOf('\n', pos);
    const end = nextNewline === -1 ? text.length : nextNewline;
    this._textEditingState.selectionStart = start;
    this._textEditingState.selectionEnd = end;
    this._textEditingState.cursorIndex = end;
    this.syncProxySelection();
    this.resetCursorBlink();
    this.stateManager.markDirty();
  }

  private syncProxySelection(): void {
    if (!this._mobileInputProxy || !this._textEditingState) return;
    try {
      this._isProgrammaticProxySync = true;
      const min = Math.min(this._textEditingState.selectionStart, this._textEditingState.selectionEnd);
      const max = Math.max(this._textEditingState.selectionStart, this._textEditingState.selectionEnd);
      const dir = this._textEditingState.selectionEnd < this._textEditingState.selectionStart ? 'backward' : 'forward';
      this._mobileInputProxy.setSelectionRange(min, max, dir);
    } catch {
      // Ignorar entornos mock donde setSelectionRange no esté implementado
    } finally {
      setTimeout(() => {
        this._isProgrammaticProxySync = false;
      }, 0);
    }
  }

  public destroy(): void {
    for (const cleanup of this._windowCleanupCallbacks) {
      try { cleanup(); } catch {}
    }
    this._windowCleanupCallbacks = [];
    this.teardownMobileInputProxy();
    if (this._mobileInputProxy) {
      this._mobileInputProxy.remove();
      this._mobileInputProxy = null;
    }
    this.stopCursorBlink();
    this._textEditingState = null;
    this._isMouseSelectingText = false;
  }
}
