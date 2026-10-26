import type { InputController } from './InputController.ts';
import { isText } from '../types/scene-graph.ts';

export class KeyboardShortcutsHandler {
  private readonly controller: InputController;

  constructor(controller: InputController) {
    this.controller = controller;
  }

  public isInputFocused(event: KeyboardEvent): boolean {
    const target =
      (event.target as HTMLElement | null) ??
      (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
    if (!target || target.id === 'mobile-text-proxy') {
      return false;
    }
    const tagName = target.tagName;
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      (target as any).isContentEditable === true
    );
  }

  public handleKeyDown(event: KeyboardEvent): void {
    if (this.isInputFocused(event)) {
      return;
    }

    if (this.controller.currentTool === 'artboard') {
      if (this.controller.artboardToolHandler.onKeyDown(event)) {
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key && event.key.toLowerCase() === 'u') {
      event.preventDefault?.();
      this.controller.setSmartGuidesEnabled(!this.controller.smartGuidesEnabled);
      return;
    }

    if (this.controller.textEditManager.isEditingText) {
      const handled = this.controller.textEditManager.handleKeyDown(event);
      if (handled) return;
    }

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isCtrlOrCmd) {
      const key = event.key;
      const keyLower = key ? key.toLowerCase() : '';

      if (keyLower === 'z') {
        event.preventDefault?.();
        if (event.shiftKey) {
          this.controller.commandManager.redo();
        } else {
          this.controller.commandManager.undo();
        }
        return;
      } else if (keyLower === 'y') {
        event.preventDefault?.();
        this.controller.commandManager.redo();
        return;
      }

      if (keyLower === 'x') {
        event.preventDefault?.();
        this.controller.cut();
        return;
      }

      if (keyLower === 'c') {
        event.preventDefault?.();
        this.controller.copy();
        return;
      }

      if (keyLower === 'v') {
        event.preventDefault?.();
        this.controller.paste();
        return;
      }

      if (keyLower === 'd') {
        event.preventDefault?.();
        this.controller.duplicate();
        return;
      }

      if (keyLower === 'a') {
        event.preventDefault?.();
        this.controller.stateManager.selectAll();
        return;
      }

      if (keyLower === 'e') {
        event.preventDefault?.();
        this.controller.emit('exportRequest');
        return;
      }

      if (keyLower === 'g') {
        event.preventDefault?.();
        if (event.shiftKey) {
          this.controller.ungroupSelection();
        } else {
          this.controller.groupSelection();
        }
        return;
      }

      if (key === '7' || event.code === 'Digit7' || event.code === 'Numpad7') {
        event.preventDefault?.();
        if (event.altKey) {
          this.controller.releaseClipMask();
        } else {
          this.controller.makeClipMask();
        }
        return;
      }

      if (keyLower === 'o' && event.shiftKey) {
        event.preventDefault?.();
        this.controller.outlineStroke();
        return;
      }

      const isBringToFront = event.shiftKey && (key === ']' || key === '}' || event.code === 'BracketRight');
      const isSendToBack = event.shiftKey && (key === '[' || key === '{' || event.code === 'BracketLeft');

      if (isBringToFront || isSendToBack) {
        if (!this.isInputFocused(event)) {
          if (this.controller.stateManager.getSelection().length > 0) {
            event.preventDefault?.();
            if (isBringToFront) {
              this.controller.bringToFront();
            } else {
              this.controller.sendToBack();
            }
          }
        }
        return;
      }

      if (keyLower === 'r' && !event.shiftKey && !event.altKey) {
        event.preventDefault?.();
        this.controller.stateManager.setRulersVisible(!this.controller.stateManager.isRulersVisible());
        return;
      }

      if (key === ';' || event.code === 'Semicolon') {
        event.preventDefault?.();
        if (event.altKey) {
          this.controller.stateManager.setGuidesLocked(!this.controller.stateManager.isGuidesLocked());
        } else {
          this.controller.stateManager.setGuidesVisible(!this.controller.stateManager.isGuidesVisible());
        }
        return;
      }

      if (key === '+' || key === '=') {
        event.preventDefault?.();
        this.controller.zoomIn();
        return;
      } else if (key === '-') {
        event.preventDefault?.();
        this.controller.zoomOut();
        return;
      } else if (key === '0') {
        event.preventDefault?.();
        this.controller.zoomFit();
        return;
      } else if (key === '1') {
        event.preventDefault?.();
        this.controller.zoomReset();
        return;
      }
    }

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault?.();
      if (!this.controller.isSpacePressed) {
        this.controller.isSpacePressed = true;
        if (!this.controller.isPanning) {
          this.controller.canvas.style.cursor = 'grab';
        }
      }
      return;
    }

    if (event.key === 'Shift') {
      this.controller.selectToolHandler.handleShiftToggle(true);
      if (this.controller.creationToolHandler.isCreatingShape) {
        this.controller.creationToolHandler.updateShapePreview(
          this.controller.currentTool as 'rectangle' | 'ellipse' | 'polygon' | 'star',
          true
        );
        this.controller.stateManager.markDirty();
      } else if (this.controller.currentTool === 'line' && this.controller.lineToolHandler.isCreating) {
        this.controller.lineToolHandler.updatePreview(true);
        this.controller.stateManager.markDirty();
      }
    }

    if (event.key === 'Alt') {
      this.controller.selectToolHandler.handleAltToggle(true);
    }

    const key = event.key;
    const isArrowKey =
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'Up' ||
      key === 'Down' ||
      key === 'Left' ||
      key === 'Right';

    if (isArrowKey) {
      if (this.controller.currentTool !== 'select') {
        return;
      }

      const selectedShapes = this.controller.stateManager.getSelectedNodes().filter((s) => !s.locked);
      if (selectedShapes.length === 0) {
        return;
      }

      event.preventDefault?.();

      const step = event.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;

      if (key === 'ArrowUp' || key === 'Up') dy = -step;
      else if (key === 'ArrowDown' || key === 'Down') dy = step;
      else if (key === 'ArrowLeft' || key === 'Left') dx = -step;
      else if (key === 'ArrowRight' || key === 'Right') dx = step;

      const customEvent = event as KeyboardEvent & { customTimestamp?: number; time?: number };
      const customTimestamp = customEvent.customTimestamp ?? customEvent.time;
      this.controller.moveSelection(dx, dy, customTimestamp);
      return;
    }

    const keyLower = key ? key.toLowerCase() : '';
    if (keyLower === 'delete' || keyLower === 'backspace') {
      if (this.controller.selectToolHandler.deleteHoveredGuide()) {
        event.preventDefault?.();
        return;
      }
      if (this.controller.deleteSelected()) {
        event.preventDefault?.();
      }
      return;
    }

    if (keyLower === 'p') {
      this.controller.setTool('pen');
    } else if (event.shiftKey && keyLower === 'o') {
      this.controller.setTool('artboard');
    } else if (keyLower === 'b' || keyLower === 'n') {
      this.controller.setTool('pencil');
    } else if (keyLower === 'i') {
      this.controller.setTool('eyedropper');
    } else if (keyLower === 'v') {
      this.controller.setTool('select');
    } else if (keyLower === 'a') {
      this.controller.setTool('direct-select');
    } else if (keyLower === 'r') {
      this.controller.setTool('rectangle');
    } else if (keyLower === 'e') {
      this.controller.setTool('ellipse');
    } else if (keyLower === 'y') {
      this.controller.setTool('polygon');
    } else if (keyLower === 's') {
      this.controller.setTool('star');
    } else if (keyLower === 'l') {
      this.controller.setTool('line');
    } else if (keyLower === 'h') {
      this.controller.setTool('hand');
    } else if (keyLower === 't') {
      this.controller.setTool('text');
    } else if (keyLower === 'escape') {
      if (this.controller.selectToolHandler.handleEscape()) {
        return;
      } else if (this.controller.creationToolHandler.isCreatingShape) {
        this.controller.creationToolHandler.cancelCreation();
      } else if (this.controller.currentTool === 'line') {
        this.controller.lineToolHandler.cancelCreation();
      } else if (this.controller.currentTool === 'pencil') {
        this.controller.pencilToolHandler.cancelDrawing();
      } else if (this.controller.currentTool === 'pen') {
        this.controller.penToolHandler.finishActivePath();
      } else if (
        !this.controller.selectToolHandler.isDragging &&
        !this.controller.selectToolHandler.isResizing &&
        !this.controller.selectToolHandler.isRotating &&
        !this.controller.isPanning &&
        !this.controller.directSelectToolHandler.isDraggingPoint &&
        this.controller.stateManager.getSelection().length > 0
      ) {
        this.controller.stateManager.selectNode(null);
      }
    } else if (keyLower === 'enter') {
      if (this.controller.currentTool === 'pen') {
        this.controller.penToolHandler.finishActivePath();
      } else {
        const selectedNodes = this.controller.stateManager.getSelectedNodes();
        if (selectedNodes.length === 1 && isText(selectedNodes[0])) {
          event.preventDefault?.();
          this.controller.setTool('text');
          this.controller.startEditingText(selectedNodes[0].id);
          return;
        }
      }
    }
  }

  public handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this.controller.selectToolHandler.handleShiftToggle(false);
      if (this.controller.creationToolHandler.isCreatingShape) {
        this.controller.creationToolHandler.updateShapePreview(
          this.controller.currentTool as 'rectangle' | 'ellipse' | 'polygon' | 'star',
          false
        );
        this.controller.stateManager.markDirty();
      } else if (this.controller.currentTool === 'line' && this.controller.lineToolHandler.isCreating) {
        this.controller.lineToolHandler.updatePreview(false);
        this.controller.stateManager.markDirty();
      }
    }

    if (event.key === 'Alt') {
      this.controller.selectToolHandler.handleAltToggle(false);
    }

    if (event.code === 'Space' || event.key === ' ') {
      this.controller.isSpacePressed = false;
      if (!this.controller.isPanning) {
        this.controller.restoreToolCursor();
      }
    }
  }
}
