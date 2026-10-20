import type { CommandManager } from '../commands/CommandManager.ts';
import type { InputController, ToolMode } from '../input/InputController.ts';

export interface ToolbarControllerOptions {
  readonly inputController: InputController;
  readonly commandManager: CommandManager;
  readonly onToolChanged?: (tool: ToolMode) => void;
  readonly onHistoryChanged?: () => void;
}

export interface ToolbarController {
  readonly syncToolButtons: (tool: ToolMode) => void;
  readonly syncHistoryButtons: () => void;
  readonly cleanup: () => void;
}

export function setupToolbarBindings(options: ToolbarControllerOptions): ToolbarController {
  const { inputController, commandManager, onToolChanged, onHistoryChanged } = options;

  const btnSelect = document.querySelector<HTMLButtonElement>('#tool-select');
  const btnDirectSelect = document.querySelector<HTMLButtonElement>('#tool-direct-select');
  const btnHand = document.querySelector<HTMLButtonElement>('#tool-hand');
  const btnPen = document.querySelector<HTMLButtonElement>('#tool-pen');
  const btnPencil = document.querySelector<HTMLButtonElement>('#tool-pencil');
  const btnRectangle = document.querySelector<HTMLButtonElement>('#tool-rectangle');
  const btnEllipse = document.querySelector<HTMLButtonElement>('#tool-ellipse');
  const btnLine = document.querySelector<HTMLButtonElement>('#tool-line');
  const btnText = document.querySelector<HTMLButtonElement>('#tool-text');
  const btnUndo = document.querySelector<HTMLButtonElement>('#btn-undo');
  const btnRedo = document.querySelector<HTMLButtonElement>('#btn-redo');

  const syncToolButtons = (tool: ToolMode) => {
    if (btnSelect) {
      const isSelect = tool === 'select';
      btnSelect.classList.toggle('active', isSelect);
      btnSelect.setAttribute('aria-pressed', String(isSelect));
    }

    if (btnDirectSelect) {
      const isDirectSelect = tool === 'direct-select';
      btnDirectSelect.classList.toggle('active', isDirectSelect);
      btnDirectSelect.setAttribute('aria-pressed', String(isDirectSelect));
    }

    if (btnHand) {
      const isHand = tool === 'hand';
      btnHand.classList.toggle('active', isHand);
      btnHand.setAttribute('aria-pressed', String(isHand));
    }

    if (btnPen) {
      const isPen = tool === 'pen';
      btnPen.classList.toggle('active', isPen);
      btnPen.setAttribute('aria-pressed', String(isPen));
    }

    if (btnPencil) {
      const isPencil = tool === 'pencil';
      btnPencil.classList.toggle('active', isPencil);
      btnPencil.setAttribute('aria-pressed', String(isPencil));
    }

    if (btnRectangle) {
      const isRect = tool === 'rectangle';
      btnRectangle.classList.toggle('active', isRect);
      btnRectangle.setAttribute('aria-pressed', String(isRect));
    }

    if (btnEllipse) {
      const isEllipse = tool === 'ellipse';
      btnEllipse.classList.toggle('active', isEllipse);
      btnEllipse.setAttribute('aria-pressed', String(isEllipse));
    }

    if (btnLine) {
      const isLine = tool === 'line';
      btnLine.classList.toggle('active', isLine);
      btnLine.setAttribute('aria-pressed', String(isLine));
    }

    if (btnText) {
      const isText = tool === 'text';
      btnText.classList.toggle('active', isText);
      btnText.setAttribute('aria-pressed', String(isText));
    }

    onToolChanged?.(tool);
  };

  const syncHistoryButtons = () => {
    const canUndo = commandManager.canUndo();
    const canRedo = commandManager.canRedo();

    if (btnUndo) {
      btnUndo.disabled = !canUndo;
      btnUndo.classList.toggle('disabled', !canUndo);
      btnUndo.classList.toggle('is-disabled', !canUndo);
    }

    if (btnRedo) {
      btnRedo.disabled = !canRedo;
      btnRedo.classList.toggle('disabled', !canRedo);
      btnRedo.classList.toggle('is-disabled', !canRedo);
    }

    onHistoryChanged?.();
  };

  const unsubscribeToolChange = inputController.on('toolChange', (tool) => {
    syncToolButtons(tool);
  });

  const unsubscribeHistory = commandManager.on('change', () => {
    syncHistoryButtons();
  });

  const onSelectClick = () => inputController.setTool('select');
  const onDirectSelectClick = () => inputController.setTool('direct-select');
  const onHandClick = () => inputController.setTool('hand');
  const onPenClick = () => inputController.setTool('pen');
  const onPencilClick = () => inputController.setTool('pencil');
  const onRectangleClick = () => inputController.setTool('rectangle');
  const onEllipseClick = () => inputController.setTool('ellipse');
  const onLineClick = () => inputController.setTool('line');
  const onTextClick = () => inputController.setTool('text');

  btnSelect?.addEventListener('click', onSelectClick);
  btnDirectSelect?.addEventListener('click', onDirectSelectClick);
  btnHand?.addEventListener('click', onHandClick);
  btnPen?.addEventListener('click', onPenClick);
  btnPencil?.addEventListener('click', onPencilClick);
  btnRectangle?.addEventListener('click', onRectangleClick);
  btnEllipse?.addEventListener('click', onEllipseClick);
  btnLine?.addEventListener('click', onLineClick);
  btnText?.addEventListener('click', onTextClick);

  const onUndoClick = () => commandManager.undo();
  const onRedoClick = () => commandManager.redo();

  btnUndo?.addEventListener('click', onUndoClick);
  btnRedo?.addEventListener('click', onRedoClick);

  // Inicializar estado visual
  syncToolButtons(inputController.currentTool);
  syncHistoryButtons();

  return {
    syncToolButtons,
    syncHistoryButtons,
    cleanup: () => {
      unsubscribeToolChange();
      unsubscribeHistory();
      btnSelect?.removeEventListener('click', onSelectClick);
      btnDirectSelect?.removeEventListener('click', onDirectSelectClick);
      btnHand?.removeEventListener('click', onHandClick);
      btnPen?.removeEventListener('click', onPenClick);
      btnPencil?.removeEventListener('click', onPencilClick);
      btnRectangle?.removeEventListener('click', onRectangleClick);
      btnEllipse?.removeEventListener('click', onEllipseClick);
      btnLine?.removeEventListener('click', onLineClick);
      btnText?.removeEventListener('click', onTextClick);
      btnUndo?.removeEventListener('click', onUndoClick);
      btnRedo?.removeEventListener('click', onRedoClick);
    },
  };
}
