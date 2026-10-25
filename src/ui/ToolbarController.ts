import type { CommandManager } from '../commands/CommandManager.ts';
import type { InputController, ToolMode } from '../input/InputController.ts';

export type ShapeTool = 'rectangle' | 'ellipse' | 'polygon' | 'star';
export const SHAPE_TOOLS: readonly ShapeTool[] = ['rectangle', 'ellipse', 'polygon', 'star'] as const;

export interface ToolbarControllerOptions {
  readonly inputController: InputController;
  readonly commandManager: CommandManager;
  readonly onToolChanged?: (tool: ToolMode) => void;
  readonly onHistoryChanged?: () => void;
}

export interface ToolbarController {
  readonly syncToolButtons: (tool: ToolMode) => void;
  readonly syncHistoryButtons: () => void;
  readonly getActiveShapeTool: () => ShapeTool;
  readonly openShapeFlyout: () => void;
  readonly closeShapeFlyout: () => void;
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
  const btnPolygon = document.querySelector<HTMLButtonElement>('#tool-polygon');
  const btnStar = document.querySelector<HTMLButtonElement>('#tool-star');
  const btnLine = document.querySelector<HTMLButtonElement>('#tool-line');
  const btnText = document.querySelector<HTMLButtonElement>('#tool-text');
  const btnEyedropper = document.querySelector<HTMLButtonElement>('#tool-eyedropper');
  const btnArtboard = document.querySelector<HTMLButtonElement>('#tool-artboard');
  const btnUndo = document.querySelector<HTMLButtonElement>('#btn-undo');
  const btnRedo = document.querySelector<HTMLButtonElement>('#btn-redo');

  const groupShapes = document.querySelector<HTMLElement>('#group-shapes');
  const flyoutShapes = document.querySelector<HTMLElement>('#flyout-shapes');
  const flyoutItems = flyoutShapes ? Array.from(flyoutShapes.querySelectorAll<HTMLButtonElement>('.flyout-item')) : [];

  let currentShapeTool: ShapeTool = 'rectangle';
  if (SHAPE_TOOLS.includes(inputController.currentTool as ShapeTool)) {
    currentShapeTool = inputController.currentTool as ShapeTool;
  }

  const shapeButtons: Record<ShapeTool, HTMLButtonElement | null> = {
    rectangle: btnRectangle,
    ellipse: btnEllipse,
    polygon: btnPolygon,
    star: btnStar,
  };

  let isFlyoutOpen = false;

  const updateFlyoutPosition = () => {
    if (!flyoutShapes || !groupShapes) return;
    const isMobile = typeof window !== 'undefined' && (window.innerWidth ?? 1024) <= 600;
    if (isMobile) {
      const rect = typeof groupShapes.getBoundingClientRect === 'function'
        ? groupShapes.getBoundingClientRect()
        : { left: 10, top: 500 };
      const flyoutWidth = flyoutShapes.offsetWidth || 180;
      const windowW = typeof window !== 'undefined' ? (window.innerWidth ?? 360) : 360;
      const windowH = typeof window !== 'undefined' ? (window.innerHeight ?? 640) : 640;
      const left = Math.max(8, Math.min(rect.left, windowW - flyoutWidth - 8));
      const bottom = Math.max(56, windowH - rect.top + 8);

      if (flyoutShapes.style) {
        flyoutShapes.style.position = 'fixed';
        flyoutShapes.style.left = `${left}px`;
        flyoutShapes.style.bottom = `${bottom}px`;
        flyoutShapes.style.top = 'auto';
        flyoutShapes.style.right = 'auto';
        flyoutShapes.style.zIndex = '1000';
      }
    } else {
      if (flyoutShapes.style) {
        flyoutShapes.style.position = '';
        flyoutShapes.style.left = '';
        flyoutShapes.style.bottom = '';
        flyoutShapes.style.top = '';
        flyoutShapes.style.right = '';
        flyoutShapes.style.zIndex = '';
      }
    }
  };

  const openShapeFlyout = () => {
    if (!flyoutShapes) return;
    isFlyoutOpen = true;
    flyoutShapes.removeAttribute('hidden');
    flyoutShapes.classList.add('open');
    updateFlyoutPosition();
    const currentBtn = shapeButtons[currentShapeTool];
    currentBtn?.setAttribute('aria-expanded', 'true');
  };

  const closeShapeFlyout = () => {
    if (!flyoutShapes) return;
    isFlyoutOpen = false;
    flyoutShapes.setAttribute('hidden', '');
    flyoutShapes.classList.remove('open');
    const currentBtn = shapeButtons[currentShapeTool];
    currentBtn?.setAttribute('aria-expanded', 'false');
  };

  const toggleShapeFlyout = () => {
    if (isFlyoutOpen) closeShapeFlyout();
    else openShapeFlyout();
  };

  const syncShapeGroup = (tool: ToolMode) => {
    if (SHAPE_TOOLS.includes(tool as ShapeTool)) {
      currentShapeTool = tool as ShapeTool;
    }

    for (const [shape, btn] of Object.entries(shapeButtons)) {
      if (!btn) continue;
      const isVisibleSlot = shape === currentShapeTool;
      btn.classList.toggle('tool-hidden', !isVisibleSlot);
      btn.classList.add('has-flyout');
      const isActive = shape === tool;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }

    if (flyoutShapes) {
      flyoutItems.forEach((item) => {
        const isCurrent = item.dataset.shape === tool;
        item.classList.toggle('active', isCurrent);
        item.setAttribute('aria-selected', String(isCurrent));
      });
    }
  };

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

    if (btnPolygon) {
      const isPolygon = tool === 'polygon';
      btnPolygon.classList.toggle('active', isPolygon);
      btnPolygon.setAttribute('aria-pressed', String(isPolygon));
    }

    if (btnStar) {
      const isStar = tool === 'star';
      btnStar.classList.toggle('active', isStar);
      btnStar.setAttribute('aria-pressed', String(isStar));
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

    if (btnEyedropper) {
      const isEyedropper = tool === 'eyedropper';
      btnEyedropper.classList.toggle('active', isEyedropper);
      btnEyedropper.setAttribute('aria-pressed', String(isEyedropper));
    }

    if (btnArtboard) {
      const isArtboard = tool === 'artboard';
      btnArtboard.classList.toggle('active', isArtboard);
      btnArtboard.setAttribute('aria-pressed', String(isArtboard));
    }

    syncShapeGroup(tool);

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
  const onShapeClick = (shape: ShapeTool) => {
    if (inputController.currentTool === shape) {
      // Si la figura ya está activa, un clic o toque conmuta el submenú (comportamiento Illustrator / táctil móvil)
      toggleShapeFlyout();
    } else {
      inputController.setTool(shape);
      closeShapeFlyout();
    }
  };

  const onRectangleClick = () => onShapeClick('rectangle');
  const onEllipseClick = () => onShapeClick('ellipse');
  const onPolygonClick = () => onShapeClick('polygon');
  const onStarClick = () => onShapeClick('star');
  const onLineClick = () => inputController.setTool('line');
  const onTextClick = () => inputController.setTool('text');
  const onEyedropperClick = () => inputController.setTool('eyedropper');
  const onArtboardClick = () => inputController.setTool('artboard');

  btnSelect?.addEventListener('click', onSelectClick);
  btnDirectSelect?.addEventListener('click', onDirectSelectClick);
  btnHand?.addEventListener('click', onHandClick);
  btnPen?.addEventListener('click', onPenClick);
  btnPencil?.addEventListener('click', onPencilClick);
  btnRectangle?.addEventListener('click', onRectangleClick);
  btnEllipse?.addEventListener('click', onEllipseClick);
  btnPolygon?.addEventListener('click', onPolygonClick);
  btnStar?.addEventListener('click', onStarClick);
  btnLine?.addEventListener('click', onLineClick);
  btnText?.addEventListener('click', onTextClick);
  btnEyedropper?.addEventListener('click', onEyedropperClick);
  btnArtboard?.addEventListener('click', onArtboardClick);

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let didLongPress = false;
  let pointerStartX = 0;
  let pointerStartY = 0;

  const onGroupPointerDown = (e: MouseEvent | PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    didLongPress = false;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;

    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
    }

    const isTouch = (e as PointerEvent).pointerType === 'touch' || (e as PointerEvent).pointerType === 'pen';
    const delay = isTouch ? 280 : 320;

    longPressTimer = setTimeout(() => {
      didLongPress = true;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(35);
        } catch {}
      }
      openShapeFlyout();
    }, delay);
  };

  const onGroupPointerMove = (e: MouseEvent | PointerEvent) => {
    if (longPressTimer !== null) {
      const isTouch = (e as PointerEvent).pointerType === 'touch' || (e as PointerEvent).pointerType === 'pen';
      const maxDistance = isTouch ? 18 : 8;
      const dist = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);
      if (dist > maxDistance) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
  };

  const onGroupPointerUp = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const onGroupClickCapture = (e: MouseEvent) => {
    if (didLongPress) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => {
        didLongPress = false;
      }, 50);
    }
  };

  const onGroupContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (didLongPress) {
      return;
    }
    toggleShapeFlyout();
  };

  const onDocumentPointerDown = (e: MouseEvent | PointerEvent) => {
    if (isFlyoutOpen && groupShapes && !groupShapes.contains(e.target as Node)) {
      closeShapeFlyout();
    }
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (isFlyoutOpen && e.key === 'Escape') {
      closeShapeFlyout();
    }
  };

  const onWindowResizeOrScroll = () => {
    if (isFlyoutOpen) {
      updateFlyoutPosition();
    }
  };

  const toolsSidebar = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.tools-sidebar') : null;
  toolsSidebar?.addEventListener?.('scroll', onWindowResizeOrScroll, { passive: true });
  if (typeof window !== 'undefined') {
    window.addEventListener?.('resize', onWindowResizeOrScroll);
  }

  if (groupShapes) {
    groupShapes.addEventListener('pointerdown', onGroupPointerDown as any);
    groupShapes.addEventListener('pointermove', onGroupPointerMove as any);
    groupShapes.addEventListener('pointerup', onGroupPointerUp as any);
    groupShapes.addEventListener('pointercancel', onGroupPointerUp as any);
    groupShapes.addEventListener('click', onGroupClickCapture, true);
    groupShapes.addEventListener('contextmenu', onGroupContextMenu);
  }

  document.addEventListener?.('pointerdown', onDocumentPointerDown as any);
  document.addEventListener?.('keydown', onDocumentKeyDown);

  const flyoutClickUnsubscribers: Array<() => void> = [];

  flyoutItems.forEach((item) => {
    const onItemClick = (e: MouseEvent) => {
      e.stopPropagation();
      const shape = item.dataset.shape as ShapeTool | undefined;
      if (shape && SHAPE_TOOLS.includes(shape)) {
        currentShapeTool = shape;
        inputController.setTool(shape);
        closeShapeFlyout();
      }
    };
    item.addEventListener('click', onItemClick);
    flyoutClickUnsubscribers.push(() => item.removeEventListener('click', onItemClick));
  });

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
    getActiveShapeTool: () => currentShapeTool,
    openShapeFlyout,
    closeShapeFlyout,
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
      btnPolygon?.removeEventListener('click', onPolygonClick);
      btnStar?.removeEventListener('click', onStarClick);
      btnLine?.removeEventListener('click', onLineClick);
      btnText?.removeEventListener('click', onTextClick);
      btnEyedropper?.removeEventListener('click', onEyedropperClick);
      btnArtboard?.removeEventListener('click', onArtboardClick);
      btnUndo?.removeEventListener('click', onUndoClick);
      btnRedo?.removeEventListener('click', onRedoClick);

      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
      }
      groupShapes?.removeEventListener('pointerdown', onGroupPointerDown as any);
      groupShapes?.removeEventListener('pointermove', onGroupPointerMove as any);
      groupShapes?.removeEventListener('pointerup', onGroupPointerUp as any);
      groupShapes?.removeEventListener('pointercancel', onGroupPointerUp as any);
      groupShapes?.removeEventListener('click', onGroupClickCapture, true);
      groupShapes?.removeEventListener('contextmenu', onGroupContextMenu);
      document.removeEventListener?.('pointerdown', onDocumentPointerDown as any);
      document.removeEventListener?.('keydown', onDocumentKeyDown);
      toolsSidebar?.removeEventListener?.('scroll', onWindowResizeOrScroll);
      if (typeof window !== 'undefined') {
        window.removeEventListener?.('resize', onWindowResizeOrScroll);
      }
      for (const unsub of flyoutClickUnsubscribers) {
        unsub();
      }
    },
  };
}
