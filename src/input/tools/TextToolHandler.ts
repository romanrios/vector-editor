import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { CreateTextCommand } from '../../commands/CreateTextCommand.ts';
import type { TextEditManager } from '../TextEditManager.ts';
import {
  getTextIndexAtPosition,
} from '../../utils/geometry.ts';
import type { Shape, Text, Vector2D } from '../../types/scene-graph.ts';
import type { ToolHandler } from './ToolHandler.ts';
import type { ToolMode } from '../InputController.ts';

export class TextToolHandler implements ToolHandler {
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly textEditManager: TextEditManager;
  private readonly hitTest: (x: number, y: number) => Shape | null;

  public textCounter: number = 0;
  private _textCreation: { command: CreateTextCommand; startX: number } | null = null;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    canvas: HTMLCanvasElement,
    textEditManager: TextEditManager,
    hitTest: (x: number, y: number) => Shape | null
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.canvas = canvas;
    this.textEditManager = textEditManager;
    this.hitTest = hitTest;
  }

  public get textCreation(): { command: CreateTextCommand; startX: number } | null {
    return this._textCreation;
  }

  public onActivate(): void {
    this.canvas.style.cursor = 'text';
  }

  public onDeactivate(nextTool?: ToolMode): void {
    if (nextTool !== 'text') {
      this._textCreation = null;
    }
  }

  public onMouseDown(_event: MouseEvent, coords: Vector2D): void {
    const hitShape = this.hitTest(coords.x, coords.y);

    if (this.textEditManager.isEditingText) {
      if (hitShape && hitShape.id === this.textEditManager.textEditingState?.textId) {
        _event.preventDefault?.();
        this.textEditManager.handleMouseDown(hitShape, coords.x, coords.y);
        return;
      } else {
        this.textEditManager.commitTextEdit();
      }
    }

    if (hitShape && hitShape.type === 'text') {
      _event.preventDefault?.();
      const textNode = hitShape as Text;
      const charIndex = getTextIndexAtPosition(
        textNode,
        coords.x,
        coords.y,
        this.textEditManager.getMeasureContext()
      );
      this.textEditManager.startEditingText(textNode.id, charIndex, false);
      return;
    }

    _event.preventDefault?.();
    this.handleTextMouseDown(coords.x, coords.y);
  }

  public onMouseMove(_event: MouseEvent, coords: Vector2D): void {
    if (this.textEditManager.isMouseSelectingText) {
      this.textEditManager.handleMouseMove(coords.x, coords.y);
      return;
    }

    if (this._textCreation) {
      const deltaX = coords.x - this._textCreation.startX;
      const hasDragged = Math.abs(deltaX) >= 5;
      const boxWidth = hasDragged ? Math.max(20, Math.abs(deltaX)) : undefined;
      this._textCreation.command.updateGeometry(
        hasDragged ? Math.min(this._textCreation.startX, coords.x) : this._textCreation.startX,
        boxWidth
      );
    }
  }

  public onMouseUp(_event: MouseEvent, _coords: Vector2D): void {
    if (this.textEditManager.isMouseSelectingText) {
      this.textEditManager.handleMouseUp();
      return;
    }

    if (this._textCreation) {
      this._textCreation = null;
      this.stateManager.markDirty();
    }
  }

  public onDoubleClick(_event: MouseEvent, coords: Vector2D): void {
    const hitShape = this.hitTest(coords.x, coords.y);
    if (hitShape && hitShape.type === 'text') {
      _event.preventDefault?.();
      const textNode = hitShape as Text;
      const charIndex = getTextIndexAtPosition(
        textNode,
        coords.x,
        coords.y,
        this.textEditManager.getMeasureContext()
      );
      this.textEditManager.startEditingText(textNode.id, charIndex, false);
    }
  }

  public handleTextMouseDown(x: number, y: number): void {
    const currentState = this.stateManager.getState();
    const targetLayer = this.stateManager.getActiveLayer() ?? currentState.children[0];
    if (!targetLayer) {
      return;
    }

    const style = this.stateManager.getDrawingStyle();
    this.textCounter++;
    const newText: Text = {
      id: `text-${Date.now()}-${this.textCounter}`,
      type: 'text',
      name: `Texto ${this.textCounter}`,
      x,
      y,
      text: 'Texto',
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'left',
      fill: style.fill && style.fill !== 'none' ? style.fill : '#000000',
      rotation: 0,
      opacity: style.opacity,
      visible: true,
      locked: false,
    };

    const command = new CreateTextCommand(this.stateManager, targetLayer.id, newText);
    this.commandManager.executeCommand(command);

    this.stateManager.selectNode(newText.id);
    this._textCreation = { command, startX: x };

    // Entra automáticamente en edición seleccionando todo el contenido inicial para que el primer carácter lo reemplace
    this.textEditManager.startEditingText(newText.id, newText.text.length, true);
  }

  public cancelCreation(): void {
    this._textCreation = null;
  }

  public destroy(): void {
    this._textCreation = null;
  }
}
