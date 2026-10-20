import { StateManager, getLeafShapes } from '../state/StateManager.ts';
import { CommandManager } from '../commands/CommandManager.ts';
import { InputController } from '../input/InputController.ts';
import { SetLockedCommand } from '../commands/SetLockedCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import { isGroup, type SelectableNode } from '../types/scene-graph.ts';
import type { AlignmentMode } from '../utils/geometry.ts';
import { isClosedShape, type BooleanOp } from '../utils/booleanOperations.ts';
import { canOutlineStroke } from '../utils/strokeToPath.ts';

export interface ContextMenuControllerOptions {
  canvas?: HTMLCanvasElement | null;
  onOpen?: () => void;
  onAction?: () => void;
  onSyncPropertiesPanel?: () => void;
}

export interface ContextMenuController {
  openContextMenu: (clientX: number, clientY: number, worldX?: number, worldY?: number) => void;
  closeContextMenu: () => void;
  syncContextMenu: (selectedNodes?: readonly SelectableNode[]) => void;
  cleanup: () => void;
}

interface SubmenuEntry {
  trigger: HTMLButtonElement | null;
  dropdown: HTMLElement | null;
  items: (HTMLButtonElement | null)[];
}

export function setupContextMenuBindings(
  inputController: InputController,
  commandManager: CommandManager,
  stateManager: StateManager,
  options: ContextMenuControllerOptions = {}
): ContextMenuController {
  const canvas = options.canvas ?? (typeof document !== 'undefined' ? document.querySelector<HTMLCanvasElement>('#viewport-canvas') : null);

  const contextMenu = document.querySelector<HTMLElement>('#context-menu');
  const ctxItemCut = document.querySelector<HTMLButtonElement>('#ctx-item-cut');
  const ctxItemCopy = document.querySelector<HTMLButtonElement>('#ctx-item-copy');
  const ctxItemPaste = document.querySelector<HTMLButtonElement>('#ctx-item-paste');
  const ctxItemPasteHere = document.querySelector<HTMLButtonElement>('#ctx-item-paste-here');
  const ctxItemDuplicate = document.querySelector<HTMLButtonElement>('#ctx-item-duplicate');
  const ctxItemBringToFront = document.querySelector<HTMLButtonElement>('#ctx-item-bring-to-front');
  const ctxItemSendToBack = document.querySelector<HTMLButtonElement>('#ctx-item-send-to-back');
  const ctxItemGroup = document.querySelector<HTMLButtonElement>('#ctx-item-group');
  const ctxItemUngroup = document.querySelector<HTMLButtonElement>('#ctx-item-ungroup');
  const ctxItemMakeClipMask = document.querySelector<HTMLButtonElement>('#ctx-item-make-clip-mask');
  const ctxItemReleaseClipMask = document.querySelector<HTMLButtonElement>('#ctx-item-release-clip-mask');
  const ctxItemOutlineStroke = document.querySelector<HTMLButtonElement>('#ctx-item-outline-stroke');

  const ctxItemAlign = document.querySelector<HTMLButtonElement>('#ctx-item-align');
  const ctxDropdownAlign = document.querySelector<HTMLElement>('#ctx-dropdown-align');
  const ctxItemAlignLeft = document.querySelector<HTMLButtonElement>('#ctx-item-align-left');
  const ctxItemAlignCenterH = document.querySelector<HTMLButtonElement>('#ctx-item-align-center-h');
  const ctxItemAlignRight = document.querySelector<HTMLButtonElement>('#ctx-item-align-right');
  const ctxItemAlignTop = document.querySelector<HTMLButtonElement>('#ctx-item-align-top');
  const ctxItemAlignCenterV = document.querySelector<HTMLButtonElement>('#ctx-item-align-center-v');
  const ctxItemAlignBottom = document.querySelector<HTMLButtonElement>('#ctx-item-align-bottom');

  const ctxItemPathfinder = document.querySelector<HTMLButtonElement>('#ctx-item-pathfinder');
  const ctxDropdownPathfinder = document.querySelector<HTMLElement>('#ctx-dropdown-pathfinder');
  const ctxItemPathfinderUnion = document.querySelector<HTMLButtonElement>('#ctx-item-pathfinder-union');
  const ctxItemPathfinderSubtract = document.querySelector<HTMLButtonElement>('#ctx-item-pathfinder-subtract');
  const ctxItemPathfinderIntersect = document.querySelector<HTMLButtonElement>('#ctx-item-pathfinder-intersect');
  const ctxItemPathfinderExclude = document.querySelector<HTMLButtonElement>('#ctx-item-pathfinder-exclude');

  const ctxItemLock = document.querySelector<HTMLButtonElement>('#ctx-item-lock');
  const ctxItemSelectAll = document.querySelector<HTMLButtonElement>('#ctx-item-select-all');
  const ctxItemDelete = document.querySelector<HTMLButtonElement>('#ctx-item-delete');

  const ctxAlignSubmenuItems = [
    ctxItemAlignLeft,
    ctxItemAlignCenterH,
    ctxItemAlignRight,
    ctxItemAlignTop,
    ctxItemAlignCenterV,
    ctxItemAlignBottom,
  ];

  const ctxPathfinderSubmenuItems = [
    ctxItemPathfinderUnion,
    ctxItemPathfinderSubtract,
    ctxItemPathfinderIntersect,
    ctxItemPathfinderExclude,
  ];

  const ctxItemsList = [
    ctxItemCut,
    ctxItemCopy,
    ctxItemPaste,
    ctxItemPasteHere,
    ctxItemDuplicate,
    ctxItemBringToFront,
    ctxItemSendToBack,
    ctxItemGroup,
    ctxItemUngroup,
    ctxItemMakeClipMask,
    ctxItemReleaseClipMask,
    ctxItemOutlineStroke,
    ctxItemAlign,
    ctxItemPathfinder,
    ctxItemLock,
    ctxItemSelectAll,
    ctxItemDelete,
  ];

  const submenuEntries: SubmenuEntry[] = [
    {
      trigger: ctxItemAlign,
      dropdown: ctxDropdownAlign,
      items: ctxAlignSubmenuItems,
    },
    {
      trigger: ctxItemPathfinder,
      dropdown: ctxDropdownPathfinder,
      items: ctxPathfinderSubmenuItems,
    },
  ];

  let lastContextWorldCoords: { x: number; y: number } | null = null;

  const closeAllSubmenus = () => {
    for (let i = 0; i < submenuEntries.length; i++) {
      const sub = submenuEntries[i];
      if (sub.trigger) {
        sub.trigger.setAttribute('aria-expanded', 'false');
        sub.trigger.classList?.remove('is-open');
      }
      if (sub.dropdown) {
        sub.dropdown.hidden = true;
        sub.dropdown.classList?.remove('is-open');
      }
    }
  };

  const openSubmenu = (submenu: SubmenuEntry, focusFirstItem: boolean = false) => {
    if (!submenu.trigger || submenu.trigger.disabled || submenu.trigger.getAttribute('aria-disabled') === 'true') {
      return;
    }
    closeAllSubmenus();
    submenu.trigger.setAttribute('aria-expanded', 'true');
    submenu.trigger.classList?.add('is-open');
    if (submenu.dropdown) {
      submenu.dropdown.hidden = false;
      submenu.dropdown.classList?.add('is-open');
      if (focusFirstItem) {
        const enabled = submenu.items.filter((it): it is HTMLButtonElement =>
          it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabled.length > 0) {
          enabled[0].focus?.();
        }
      }
    }
  };

  const closeContextMenu = () => {
    closeAllSubmenus();
    if (contextMenu) {
      contextMenu.hidden = true;
      contextMenu.classList?.remove('is-open');
    }
  };

  const syncContextMenu = (selectedNodes: readonly SelectableNode[] = stateManager.getSelectedNodes()) => {
    const hasSelection = selectedNodes.length > 0;
    const canGroup = selectedNodes.length >= 2;
    const canUngroup = selectedNodes.some(isGroup);
    const canAlign = selectedNodes.length >= 2;
    const leafShapes = getLeafShapes(selectedNodes);
    const closedShapes = leafShapes.filter(isClosedShape);
    const canPathfinder = closedShapes.length >= 2;
    const hasClipboard = inputController.clipboard !== null;
    const allLocked = hasSelection && selectedNodes.every((n) => stateManager.isEffectivelyLocked(n.id));
    const anyLocked = selectedNodes.some((n) => stateManager.isEffectivelyLocked(n.id));

    if (ctxItemCut) {
      ctxItemCut.disabled = !hasSelection || allLocked;
      ctxItemCut.setAttribute('aria-disabled', String(!hasSelection || allLocked));
    }
    if (ctxItemCopy) {
      ctxItemCopy.disabled = !hasSelection;
      ctxItemCopy.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (ctxItemPaste) {
      ctxItemPaste.disabled = !hasClipboard;
      ctxItemPaste.setAttribute('aria-disabled', String(!hasClipboard));
    }
    if (ctxItemPasteHere) {
      ctxItemPasteHere.disabled = !hasClipboard;
      ctxItemPasteHere.setAttribute('aria-disabled', String(!hasClipboard));
    }
    if (ctxItemDuplicate) {
      ctxItemDuplicate.disabled = !hasSelection;
      ctxItemDuplicate.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (ctxItemBringToFront) {
      ctxItemBringToFront.disabled = !hasSelection;
      ctxItemBringToFront.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (ctxItemSendToBack) {
      ctxItemSendToBack.disabled = !hasSelection;
      ctxItemSendToBack.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (ctxItemGroup) {
      ctxItemGroup.disabled = !canGroup;
      ctxItemGroup.setAttribute('aria-disabled', String(!canGroup));
    }
    if (ctxItemUngroup) {
      ctxItemUngroup.disabled = !canUngroup;
      ctxItemUngroup.setAttribute('aria-disabled', String(!canUngroup));
    }

    const canMakeClipMask =
      selectedNodes.length >= 2 ||
      (selectedNodes.length === 1 && isGroup(selectedNodes[0]) && selectedNodes[0].children.length >= 2);
    const canReleaseClipMask = selectedNodes.some((n) => isGroup(n) && n.isClipMask === true);

    if (ctxItemMakeClipMask) {
      ctxItemMakeClipMask.disabled = !canMakeClipMask;
      ctxItemMakeClipMask.setAttribute('aria-disabled', String(!canMakeClipMask));
    }
    if (ctxItemReleaseClipMask) {
      ctxItemReleaseClipMask.disabled = !canReleaseClipMask;
      ctxItemReleaseClipMask.setAttribute('aria-disabled', String(!canReleaseClipMask));
    }
    const canOutlineStrokeValue = leafShapes.some(canOutlineStroke);
    if (ctxItemOutlineStroke) {
      ctxItemOutlineStroke.disabled = !canOutlineStrokeValue;
      ctxItemOutlineStroke.setAttribute('aria-disabled', String(!canOutlineStrokeValue));
    }
    if (ctxItemAlign) {
      ctxItemAlign.disabled = !canAlign;
      ctxItemAlign.setAttribute('aria-disabled', String(!canAlign));
    }
    for (let i = 0; i < ctxAlignSubmenuItems.length; i++) {
      const it = ctxAlignSubmenuItems[i];
      if (it) {
        it.disabled = !canAlign;
        it.setAttribute('aria-disabled', String(!canAlign));
      }
    }
    if (ctxItemPathfinder) {
      ctxItemPathfinder.disabled = !canPathfinder;
      ctxItemPathfinder.setAttribute('aria-disabled', String(!canPathfinder));
    }
    for (let i = 0; i < ctxPathfinderSubmenuItems.length; i++) {
      const it = ctxPathfinderSubmenuItems[i];
      if (it) {
        it.disabled = !canPathfinder;
        it.setAttribute('aria-disabled', String(!canPathfinder));
      }
    }
    if (ctxItemLock) {
      ctxItemLock.disabled = !hasSelection;
      ctxItemLock.setAttribute('aria-disabled', String(!hasSelection));
      const label = ctxItemLock.querySelector<HTMLElement>('.menu-item-label');
      if (label) {
        label.textContent = anyLocked ? 'Desbloquear' : 'Bloquear';
      }
    }
    if (ctxItemDelete) {
      ctxItemDelete.disabled = !hasSelection || allLocked;
      ctxItemDelete.setAttribute('aria-disabled', String(!hasSelection || allLocked));
    }
  };

  const openContextMenu = (clientX: number, clientY: number, worldX?: number, worldY?: number) => {
    if (!contextMenu) return;
    if (worldX !== undefined && worldY !== undefined) {
      lastContextWorldCoords = { x: worldX, y: worldY };
    }
    options.onOpen?.();
    syncContextMenu();

    contextMenu.hidden = false;
    contextMenu.classList?.add('is-open');

    const menuWidth = contextMenu.offsetWidth || 220;
    const menuHeight = contextMenu.offsetHeight || 320;
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    const posX = Math.max(10, Math.min(clientX, windowWidth - menuWidth - 10));
    const posY = Math.max(10, Math.min(clientY, windowHeight - menuHeight - 10));

    contextMenu.style.left = `${posX}px`;
    contextMenu.style.top = `${posY}px`;
  };

  const onCanvasContextMenu = (data: { clientX: number; clientY: number; worldX: number; worldY: number }) => {
    openContextMenu(data.clientX, data.clientY, data.worldX, data.worldY);
  };

  const onContextMenuNative = (e: MouseEvent) => {
    e.preventDefault?.();
  };

  // Submenu handlers
  const submenuContainerEnterHandlers: Array<{ container: HTMLElement | null; handler: () => void }> = [];
  const submenuContainerLeaveHandlers: Array<{ container: HTMLElement | null; handler: () => void }> = [];
  const submenuTriggerClickHandlers: Array<{ trigger: HTMLButtonElement | null; handler: (e: any) => void }> = [];

  submenuEntries.forEach((sub) => {
    if (sub.trigger) {
      const container = (sub.trigger.closest?.('.menu-submenu-container') || sub.trigger.parentElement) as HTMLElement | null;
      const onEnter = () => {
        if (sub.trigger && !sub.trigger.disabled && sub.trigger.getAttribute('aria-disabled') !== 'true') {
          openSubmenu(sub, false);
        }
      };
      const onLeave = () => {
        if (sub.dropdown && !sub.dropdown.hidden) {
          closeAllSubmenus();
        }
      };
      container?.addEventListener?.('mouseenter', onEnter);
      container?.addEventListener?.('mouseleave', onLeave);
      submenuContainerEnterHandlers.push({ container, handler: onEnter });
      submenuContainerLeaveHandlers.push({ container, handler: onLeave });

      const onTriggerClick = (e: any) => {
        e.stopPropagation?.();
        if (!sub.trigger?.disabled && sub.trigger?.getAttribute('aria-disabled') !== 'true') {
          if (sub.dropdown && !sub.dropdown.hidden) {
            closeAllSubmenus();
          } else {
            openSubmenu(sub, true);
          }
        }
      };
      sub.trigger.addEventListener('click', onTriggerClick);
      submenuTriggerClickHandlers.push({ trigger: sub.trigger, handler: onTriggerClick });
    }
  });

  const submenuKeyDownHandlers = submenuEntries.map((sub) => (e: KeyboardEvent) => {
    const key = e.key;
    const allSubItems = sub.items.filter(Boolean) as HTMLButtonElement[];
    const enabledSubItems = allSubItems.filter((it) => !it.disabled && it.getAttribute('aria-disabled') !== 'true');
    const focusedSubItem = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLButtonElement;
    const currentSubIndex = enabledSubItems.indexOf(focusedSubItem);

    if (key === 'ArrowDown') {
      e.preventDefault?.();
      if (enabledSubItems.length === 0) return;
      const nextIndex = currentSubIndex >= 0 ? (currentSubIndex + 1) % enabledSubItems.length : 0;
      enabledSubItems[nextIndex].focus?.();
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      if (enabledSubItems.length === 0) return;
      const prevIndex = currentSubIndex >= 0
        ? (currentSubIndex - 1 + enabledSubItems.length) % enabledSubItems.length
        : enabledSubItems.length - 1;
      enabledSubItems[prevIndex].focus?.();
    } else if (key === 'ArrowLeft' || key === 'Escape') {
      e.preventDefault?.();
      closeAllSubmenus();
      sub.trigger?.focus?.();
    } else if (key === 'Tab') {
      closeContextMenu();
    } else if (key === 'Enter' || key === ' ') {
      if (focusedSubItem && allSubItems.includes(focusedSubItem)) {
        if (!focusedSubItem.disabled && focusedSubItem.getAttribute('aria-disabled') !== 'true') {
          e.preventDefault?.();
          focusedSubItem.click();
        }
      }
    }
  });

  submenuEntries.forEach((sub, i) => {
    sub.dropdown?.addEventListener('keydown', submenuKeyDownHandlers[i]);
  });

  const onContextMenuKeyDown = (e: KeyboardEvent) => {
    const key = e.key;
    const allItems = ctxItemsList.filter(Boolean) as HTMLButtonElement[];
    const enabledItems = allItems.filter((it) => !it.disabled && it.getAttribute('aria-disabled') !== 'true');
    const focusedItem = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLButtonElement;
    const currentEnabledIndex = enabledItems.indexOf(focusedItem);

    if (key === 'ArrowDown') {
      e.preventDefault?.();
      if (enabledItems.length === 0) return;
      const nextIndex = currentEnabledIndex >= 0 ? (currentEnabledIndex + 1) % enabledItems.length : 0;
      enabledItems[nextIndex].focus?.();
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      if (enabledItems.length === 0) return;
      const prevIndex = currentEnabledIndex >= 0
        ? (currentEnabledIndex - 1 + enabledItems.length) % enabledItems.length
        : enabledItems.length - 1;
      enabledItems[prevIndex].focus?.();
    } else if (key === 'ArrowRight') {
      const sub = submenuEntries.find((s) => s.trigger === focusedItem);
      if (sub && !sub.trigger?.disabled && sub.trigger?.getAttribute('aria-disabled') !== 'true') {
        e.preventDefault?.();
        openSubmenu(sub, true);
      }
    } else if (key === 'ArrowLeft') {
      closeAllSubmenus();
      focusedItem?.focus?.();
    } else if (key === 'Escape') {
      e.preventDefault?.();
      closeContextMenu();
      canvas?.focus?.();
    } else if (key === 'Tab') {
      closeContextMenu();
    } else if (key === 'Enter' || key === ' ') {
      if (focusedItem && allItems.includes(focusedItem)) {
        if (!focusedItem.disabled && focusedItem.getAttribute('aria-disabled') !== 'true') {
          const sub = submenuEntries.find((s) => s.trigger === focusedItem);
          if (sub) {
            e.preventDefault?.();
            openSubmenu(sub, true);
            return;
          }
          e.preventDefault?.();
          focusedItem.click();
        }
      }
    }
  };

  const onDocumentClick = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (contextMenu && !contextMenu.hidden) {
      const isInsideCtx = contextMenu === target || (typeof contextMenu.contains === 'function' && contextMenu.contains(target));
      if (!isInsideCtx) {
        closeContextMenu();
      }
    }
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && contextMenu && !contextMenu.hidden) {
      e.preventDefault?.();
      closeContextMenu();
      canvas?.focus?.();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  // Action listeners
  const onCtxCutClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeContextMenu();
      inputController.cut();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxCopyClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeContextMenu();
      inputController.copy();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxPasteClick = () => {
    if (inputController.clipboard) {
      closeContextMenu();
      inputController.paste();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxPasteHereClick = () => {
    if (inputController.clipboard) {
      closeContextMenu();
      inputController.paste(lastContextWorldCoords ?? undefined);
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxDuplicateClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeContextMenu();
      inputController.duplicate();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxBringToFrontClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeContextMenu();
      inputController.bringToFront();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxSendToBackClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeContextMenu();
      inputController.sendToBack();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxGroupClick = () => {
    if (stateManager.getSelection().length >= 2) {
      closeContextMenu();
      inputController.groupSelection();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxUngroupClick = () => {
    if (stateManager.getSelectedNodes().some(isGroup)) {
      closeContextMenu();
      inputController.ungroupSelection();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxMakeClipMaskClick = () => {
    const selected = stateManager.getSelectedNodes();
    const canMake =
      selected.length >= 2 || (selected.length === 1 && isGroup(selected[0]) && selected[0].children.length >= 2);
    if (canMake) {
      closeContextMenu();
      inputController.makeClipMask();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxReleaseClipMaskClick = () => {
    if (stateManager.getSelectedNodes().some((n) => isGroup(n) && n.isClipMask === true)) {
      closeContextMenu();
      inputController.releaseClipMask();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onCtxOutlineStrokeClick = () => {
    const leafShapes = getLeafShapes(stateManager.getSelectedNodes());
    if (leafShapes.some(canOutlineStroke)) {
      closeContextMenu();
      inputController.outlineStroke();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const createAlignHandler = (mode: AlignmentMode) => () => {
    if (stateManager.getSelection().length >= 2) {
      closeContextMenu();
      inputController.alignSelection(mode);
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onAlignLeft = createAlignHandler('left');
  const onAlignCenterH = createAlignHandler('center-h');
  const onAlignRight = createAlignHandler('right');
  const onAlignTop = createAlignHandler('top');
  const onAlignCenterV = createAlignHandler('center-v');
  const onAlignBottom = createAlignHandler('bottom');

  const createPathfinderHandler = (op: BooleanOp) => () => {
    closeContextMenu();
    inputController.applyBooleanOperation(op);
    options.onSyncPropertiesPanel?.();
    syncContextMenu();
    options.onAction?.();
    canvas?.focus?.();
  };

  const onPathfinderUnion = createPathfinderHandler('union');
  const onPathfinderSubtract = createPathfinderHandler('subtract');
  const onPathfinderIntersect = createPathfinderHandler('intersect');
  const onPathfinderExclude = createPathfinderHandler('exclude');

  const onCtxLockClick = () => {
    const sel = stateManager.getSelection();
    if (sel.length === 0) return;
    closeContextMenu();
    const anyLocked = sel.some((id) => stateManager.isEffectivelyLocked(id));
    const targetLocked = !anyLocked;
    const commands = sel.map((id) => new SetLockedCommand(stateManager, id, targetLocked));
    if (commands.length === 1) {
      commandManager.executeCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.executeCommand(
        new BatchCommand(commands, targetLocked ? 'Bloquear elementos' : 'Desbloquear elementos')
      );
    }
    syncContextMenu();
    options.onAction?.();
    canvas?.focus?.();
  };

  const onCtxSelectAllClick = () => {
    closeContextMenu();
    stateManager.selectAll();
    syncContextMenu();
    options.onAction?.();
    canvas?.focus?.();
  };

  const onCtxDeleteClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeContextMenu();
      inputController.deleteSelected();
      syncContextMenu();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  ctxItemCut?.addEventListener('click', onCtxCutClick);
  ctxItemCopy?.addEventListener('click', onCtxCopyClick);
  ctxItemPaste?.addEventListener('click', onCtxPasteClick);
  ctxItemPasteHere?.addEventListener('click', onCtxPasteHereClick);
  ctxItemDuplicate?.addEventListener('click', onCtxDuplicateClick);
  ctxItemBringToFront?.addEventListener('click', onCtxBringToFrontClick);
  ctxItemSendToBack?.addEventListener('click', onCtxSendToBackClick);
  ctxItemGroup?.addEventListener('click', onCtxGroupClick);
  ctxItemUngroup?.addEventListener('click', onCtxUngroupClick);
  ctxItemMakeClipMask?.addEventListener('click', onCtxMakeClipMaskClick);
  ctxItemReleaseClipMask?.addEventListener('click', onCtxReleaseClipMaskClick);
  ctxItemOutlineStroke?.addEventListener('click', onCtxOutlineStrokeClick);

  ctxItemAlignLeft?.addEventListener('click', onAlignLeft);
  ctxItemAlignCenterH?.addEventListener('click', onAlignCenterH);
  ctxItemAlignRight?.addEventListener('click', onAlignRight);
  ctxItemAlignTop?.addEventListener('click', onAlignTop);
  ctxItemAlignCenterV?.addEventListener('click', onAlignCenterV);
  ctxItemAlignBottom?.addEventListener('click', onAlignBottom);

  ctxItemPathfinderUnion?.addEventListener('click', onPathfinderUnion);
  ctxItemPathfinderSubtract?.addEventListener('click', onPathfinderSubtract);
  ctxItemPathfinderIntersect?.addEventListener('click', onPathfinderIntersect);
  ctxItemPathfinderExclude?.addEventListener('click', onPathfinderExclude);

  ctxItemLock?.addEventListener('click', onCtxLockClick);
  ctxItemSelectAll?.addEventListener('click', onCtxSelectAllClick);
  ctxItemDelete?.addEventListener('click', onCtxDeleteClick);

  contextMenu?.addEventListener('keydown', onContextMenuKeyDown);
  contextMenu?.addEventListener('contextmenu', onContextMenuNative);
  inputController.on('canvasContextMenu', onCanvasContextMenu);

  return {
    openContextMenu,
    closeContextMenu,
    syncContextMenu,
    cleanup: () => {
      ctxItemCut?.removeEventListener('click', onCtxCutClick);
      ctxItemCopy?.removeEventListener('click', onCtxCopyClick);
      ctxItemPaste?.removeEventListener('click', onCtxPasteClick);
      ctxItemPasteHere?.removeEventListener('click', onCtxPasteHereClick);
      ctxItemDuplicate?.removeEventListener('click', onCtxDuplicateClick);
      ctxItemBringToFront?.removeEventListener('click', onCtxBringToFrontClick);
      ctxItemSendToBack?.removeEventListener('click', onCtxSendToBackClick);
      ctxItemGroup?.removeEventListener('click', onCtxGroupClick);
      ctxItemUngroup?.removeEventListener('click', onCtxUngroupClick);
      ctxItemMakeClipMask?.removeEventListener('click', onCtxMakeClipMaskClick);
      ctxItemReleaseClipMask?.removeEventListener('click', onCtxReleaseClipMaskClick);
      ctxItemOutlineStroke?.removeEventListener('click', onCtxOutlineStrokeClick);

      ctxItemAlignLeft?.removeEventListener('click', onAlignLeft);
      ctxItemAlignCenterH?.removeEventListener('click', onAlignCenterH);
      ctxItemAlignRight?.removeEventListener('click', onAlignRight);
      ctxItemAlignTop?.removeEventListener('click', onAlignTop);
      ctxItemAlignCenterV?.removeEventListener('click', onAlignCenterV);
      ctxItemAlignBottom?.removeEventListener('click', onAlignBottom);

      ctxItemPathfinderUnion?.removeEventListener('click', onPathfinderUnion);
      ctxItemPathfinderSubtract?.removeEventListener('click', onPathfinderSubtract);
      ctxItemPathfinderIntersect?.removeEventListener('click', onPathfinderIntersect);
      ctxItemPathfinderExclude?.removeEventListener('click', onPathfinderExclude);

      ctxItemLock?.removeEventListener('click', onCtxLockClick);
      ctxItemSelectAll?.removeEventListener('click', onCtxSelectAllClick);
      ctxItemDelete?.removeEventListener('click', onCtxDeleteClick);

      contextMenu?.removeEventListener('keydown', onContextMenuKeyDown);
      contextMenu?.removeEventListener('contextmenu', onContextMenuNative);
      inputController.off('canvasContextMenu', onCanvasContextMenu);

      submenuEntries.forEach((sub, i) => {
        sub.dropdown?.removeEventListener('keydown', submenuKeyDownHandlers[i]);
      });

      submenuContainerEnterHandlers.forEach(({ container, handler }) => {
        container?.removeEventListener?.('mouseenter', handler);
      });
      submenuContainerLeaveHandlers.forEach(({ container, handler }) => {
        container?.removeEventListener?.('mouseleave', handler);
      });
      submenuTriggerClickHandlers.forEach(({ trigger, handler }) => {
        trigger?.removeEventListener?.('click', handler);
      });

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeyDown);
      }
    },
  };
}
