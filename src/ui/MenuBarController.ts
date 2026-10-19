import { StateManager, getLeafShapes } from '../state/StateManager.ts';
import { CommandManager } from '../commands/CommandManager.ts';
import { InputController } from '../input/InputController.ts';
import { ViewportManager } from '../utils/viewport.ts';
import { isGroup, type SelectableNode } from '../types/scene-graph.ts';
import type { AlignmentMode, DistributionAxis } from '../utils/geometry.ts';
import { isClosedShape, type BooleanOp } from '../utils/booleanOperations.ts';

export interface MenuBarControllerOptions {
  viewportManager: ViewportManager;
  canvas?: HTMLCanvasElement | null;
  onCloseContextMenu?: () => void;
  onImportClick?: () => void;
  onPlaceClick?: () => void;
  onExportClick?: () => void;
  onExportSvg?: () => void;
  onExportPng?: () => void;
  onExportWebp?: () => void;
  openExportDialog?: (restoreFocus?: HTMLElement | null) => void;
  openShortcutsDialog?: () => void;
  openAboutDialog?: (restoreFocus?: HTMLElement | null) => void;
  onSyncPropertiesPanel?: () => void;
  onAction?: () => void;
}

export interface MenuBarController {
  openMenu: (index: number, focusFirstItem?: boolean) => void;
  closeAllMenus: () => void;
  syncMenuItems: (selectedNodes?: readonly SelectableNode[]) => void;
  cleanup: () => void;
}

interface MenuEntry {
  trigger: HTMLButtonElement | null;
  dropdown: HTMLElement | null;
  items: (HTMLButtonElement | null)[];
}

interface SubmenuEntry {
  trigger: HTMLButtonElement | null;
  dropdown: HTMLElement | null;
  items: (HTMLButtonElement | null)[];
}

export function setupMenuBarBindings(
  inputController: InputController,
  commandManager: CommandManager,
  stateManager: StateManager,
  options: MenuBarControllerOptions
): MenuBarController {
  const { viewportManager } = options;
  const canvas = options.canvas ?? (typeof document !== 'undefined' ? document.querySelector<HTMLCanvasElement>('#viewport-canvas') : null);

  const menuBar = document.querySelector<HTMLElement>('.menu-bar');

  const menuBtnFile = document.querySelector<HTMLButtonElement>('#menu-btn-file');
  const menuBtnEdit = document.querySelector<HTMLButtonElement>('#menu-btn-edit');
  const menuBtnObject = document.querySelector<HTMLButtonElement>('#menu-btn-object');
  const menuBtnView = document.querySelector<HTMLButtonElement>('#menu-btn-view');
  const menuBtnHelp = document.querySelector<HTMLButtonElement>('#menu-btn-help');

  const menuDropdownFile = document.querySelector<HTMLElement>('#menu-dropdown-file');
  const menuDropdownEdit = document.querySelector<HTMLElement>('#menu-dropdown-edit');
  const menuDropdownObject = document.querySelector<HTMLElement>('#menu-dropdown-object');
  const menuDropdownView = document.querySelector<HTMLElement>('#menu-dropdown-view');
  const menuDropdownHelp = document.querySelector<HTMLElement>('#menu-dropdown-help');

  const menuItemImport = document.querySelector<HTMLButtonElement>('#menu-item-import');
  const menuItemPlace = document.querySelector<HTMLButtonElement>('#menu-item-place');
  const menuItemExportModal = document.querySelector<HTMLButtonElement>('#menu-item-export-modal');
  const menuItemExportSvg = document.querySelector<HTMLButtonElement>('#menu-item-export-svg');
  const menuItemExportPng = document.querySelector<HTMLButtonElement>('#menu-item-export-png');
  const menuItemExportWebp = document.querySelector<HTMLButtonElement>('#menu-item-export-webp');
  const menuItemExport = document.querySelector<HTMLButtonElement>('#menu-item-export');
  const menuItemUndo = document.querySelector<HTMLButtonElement>('#menu-item-undo');
  const menuItemRedo = document.querySelector<HTMLButtonElement>('#menu-item-redo');
  const menuItemCut = document.querySelector<HTMLButtonElement>('#menu-item-cut');
  const menuItemCopy = document.querySelector<HTMLButtonElement>('#menu-item-copy');
  const menuItemPaste = document.querySelector<HTMLButtonElement>('#menu-item-paste');
  const menuItemDuplicate = document.querySelector<HTMLButtonElement>('#menu-item-duplicate');
  const menuItemDelete = document.querySelector<HTMLButtonElement>('#menu-item-delete');
  const menuItemBringToFront = document.querySelector<HTMLButtonElement>('#menu-item-bring-to-front');
  const menuItemSendToBack = document.querySelector<HTMLButtonElement>('#menu-item-send-to-back');
  const menuItemGroup = document.querySelector<HTMLButtonElement>('#menu-item-group');
  const menuItemUngroup = document.querySelector<HTMLButtonElement>('#menu-item-ungroup');

  // Submenús Alinear y Distribuir en Menú Objeto
  const menuItemAlign = document.querySelector<HTMLButtonElement>('#menu-item-align');
  const menuDropdownAlign = document.querySelector<HTMLElement>('#menu-dropdown-align');
  const menuItemAlignLeft = document.querySelector<HTMLButtonElement>('#menu-item-align-left');
  const menuItemAlignCenterH = document.querySelector<HTMLButtonElement>('#menu-item-align-center-h');
  const menuItemAlignRight = document.querySelector<HTMLButtonElement>('#menu-item-align-right');
  const menuItemAlignTop = document.querySelector<HTMLButtonElement>('#menu-item-align-top');
  const menuItemAlignCenterV = document.querySelector<HTMLButtonElement>('#menu-item-align-center-v');
  const menuItemAlignBottom = document.querySelector<HTMLButtonElement>('#menu-item-align-bottom');

  const menuItemDistribute = document.querySelector<HTMLButtonElement>('#menu-item-distribute');
  const menuDropdownDistribute = document.querySelector<HTMLElement>('#menu-dropdown-distribute');
  const menuItemDistributeH = document.querySelector<HTMLButtonElement>('#menu-item-distribute-h');
  const menuItemDistributeV = document.querySelector<HTMLButtonElement>('#menu-item-distribute-v');

  // Submenú Pathfinder en Menú Objeto
  const menuItemPathfinder = document.querySelector<HTMLButtonElement>('#menu-item-pathfinder');
  const menuDropdownPathfinder = document.querySelector<HTMLElement>('#menu-dropdown-pathfinder');
  const menuItemPathfinderUnion = document.querySelector<HTMLButtonElement>('#menu-item-pathfinder-union');
  const menuItemPathfinderSubtract = document.querySelector<HTMLButtonElement>('#menu-item-pathfinder-subtract');
  const menuItemPathfinderIntersect = document.querySelector<HTMLButtonElement>('#menu-item-pathfinder-intersect');
  const menuItemPathfinderExclude = document.querySelector<HTMLButtonElement>('#menu-item-pathfinder-exclude');

  // Vista y Ayuda
  const menuItemZoomIn = document.querySelector<HTMLButtonElement>('#menu-item-zoom-in');
  const menuItemZoomOut = document.querySelector<HTMLButtonElement>('#menu-item-zoom-out');
  const menuItemZoomFit = document.querySelector<HTMLButtonElement>('#menu-item-zoom-fit');
  const menuItemZoom100 = document.querySelector<HTMLButtonElement>('#menu-item-zoom-100');
  const menuItemSmartGuides = document.querySelector<HTMLButtonElement>('#menu-item-smart-guides');
  const menuItemShortcuts = document.querySelector<HTMLButtonElement>('#menu-item-shortcuts');
  const menuItemAbout = document.querySelector<HTMLButtonElement>('#menu-item-about');
  const btnAboutBrand = document.querySelector<HTMLButtonElement>('#btn-about-brand');

  const menuEntries: MenuEntry[] = [
    {
      trigger: menuBtnFile,
      dropdown: menuDropdownFile,
      items: [
        menuItemImport,
        menuItemPlace,
        menuItemExportModal,
        menuItemExportSvg,
        menuItemExportPng,
        menuItemExportWebp,
        menuItemExport,
      ],
    },
    {
      trigger: menuBtnEdit,
      dropdown: menuDropdownEdit,
      items: [
        menuItemUndo,
        menuItemRedo,
        menuItemCut,
        menuItemCopy,
        menuItemPaste,
        menuItemDuplicate,
        menuItemDelete,
      ],
    },
    {
      trigger: menuBtnObject,
      dropdown: menuDropdownObject,
      items: [
        menuItemBringToFront,
        menuItemSendToBack,
        menuItemGroup,
        menuItemUngroup,
        menuItemAlign,
        menuItemDistribute,
      ],
    },
    {
      trigger: menuBtnView,
      dropdown: menuDropdownView,
      items: [
        menuItemSmartGuides,
        menuItemZoomIn,
        menuItemZoomOut,
        menuItemZoomFit,
        menuItemZoom100,
      ],
    },
    {
      trigger: menuBtnHelp,
      dropdown: menuDropdownHelp,
      items: [menuItemShortcuts, menuItemAbout],
    },
  ];

  const submenuEntries: SubmenuEntry[] = [
    {
      trigger: menuItemAlign,
      dropdown: menuDropdownAlign,
      items: [
        menuItemAlignLeft,
        menuItemAlignCenterH,
        menuItemAlignRight,
        menuItemAlignTop,
        menuItemAlignCenterV,
        menuItemAlignBottom,
      ],
    },
    {
      trigger: menuItemDistribute,
      dropdown: menuDropdownDistribute,
      items: [menuItemDistributeH, menuItemDistributeV],
    },
    {
      trigger: menuItemPathfinder,
      dropdown: menuDropdownPathfinder,
      items: [
        menuItemPathfinderUnion,
        menuItemPathfinderSubtract,
        menuItemPathfinderIntersect,
        menuItemPathfinderExclude,
      ],
    },
  ];

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

  let activeMenuIndex = -1;

  const closeAllMenus = () => {
    activeMenuIndex = -1;
    closeAllSubmenus();
    options.onCloseContextMenu?.();
    for (const entry of menuEntries) {
      if (entry.trigger) {
        entry.trigger.setAttribute('aria-expanded', 'false');
        entry.trigger.classList?.remove('is-open');
      }
      if (entry.dropdown) {
        entry.dropdown.hidden = true;
        entry.dropdown.classList?.remove('is-open');
      }
    }
  };

  function syncMenuItems(selectedNodes: readonly SelectableNode[] = stateManager.getSelectedNodes()): void {
    const canUndo = commandManager.canUndo();
    const canRedo = commandManager.canRedo();

    if (menuItemUndo) {
      menuItemUndo.disabled = !canUndo;
      menuItemUndo.setAttribute('aria-disabled', String(!canUndo));
    }
    if (menuItemRedo) {
      menuItemRedo.disabled = !canRedo;
      menuItemRedo.setAttribute('aria-disabled', String(!canRedo));
    }

    const hasSelection = selectedNodes.length > 0;

    if (menuItemCut) {
      menuItemCut.disabled = !hasSelection;
      menuItemCut.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemCopy) {
      menuItemCopy.disabled = !hasSelection;
      menuItemCopy.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemDuplicate) {
      menuItemDuplicate.disabled = !hasSelection;
      menuItemDuplicate.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemDelete) {
      menuItemDelete.disabled = !hasSelection;
      menuItemDelete.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemBringToFront) {
      menuItemBringToFront.disabled = !hasSelection;
      menuItemBringToFront.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (menuItemSendToBack) {
      menuItemSendToBack.disabled = !hasSelection;
      menuItemSendToBack.setAttribute('aria-disabled', String(!hasSelection));
    }

    if (menuBtnObject) {
      menuBtnObject.disabled = !hasSelection;
      menuBtnObject.setAttribute('aria-disabled', String(!hasSelection));
    }

    const canGroup = selectedNodes.length >= 2;
    const canUngroup = selectedNodes.some(isGroup);

    if (menuItemGroup) {
      menuItemGroup.disabled = !canGroup;
      menuItemGroup.setAttribute('aria-disabled', String(!canGroup));
    }
    if (menuItemUngroup) {
      menuItemUngroup.disabled = !canUngroup;
      menuItemUngroup.setAttribute('aria-disabled', String(!canUngroup));
    }

    const canAlign = selectedNodes.length >= 2;
    const canDistribute = selectedNodes.length >= 3;

    if (menuItemAlign) {
      menuItemAlign.disabled = !canAlign;
      menuItemAlign.setAttribute('aria-disabled', String(!canAlign));
    }

    const alignSubmenuItems = [
      menuItemAlignLeft,
      menuItemAlignCenterH,
      menuItemAlignRight,
      menuItemAlignTop,
      menuItemAlignCenterV,
      menuItemAlignBottom,
    ];
    for (let i = 0; i < alignSubmenuItems.length; i++) {
      const it = alignSubmenuItems[i];
      if (it) {
        it.disabled = !canAlign;
        it.setAttribute('aria-disabled', String(!canAlign));
      }
    }

    if (menuItemDistribute) {
      menuItemDistribute.disabled = !canDistribute;
      menuItemDistribute.setAttribute('aria-disabled', String(!canDistribute));
    }

    const distributeSubmenuItems = [menuItemDistributeH, menuItemDistributeV];
    for (let i = 0; i < distributeSubmenuItems.length; i++) {
      const it = distributeSubmenuItems[i];
      if (it) {
        it.disabled = !canDistribute;
        it.setAttribute('aria-disabled', String(!canDistribute));
      }
    }

    const leafShapes = getLeafShapes(selectedNodes);
    const closedShapes = leafShapes.filter(isClosedShape);
    const canPathfinder = closedShapes.length >= 2;

    if (menuItemPathfinder) {
      menuItemPathfinder.disabled = !canPathfinder;
      menuItemPathfinder.setAttribute('aria-disabled', String(!canPathfinder));
    }

    const pathfinderSubmenuItems = [
      menuItemPathfinderUnion,
      menuItemPathfinderSubtract,
      menuItemPathfinderIntersect,
      menuItemPathfinderExclude,
    ];
    for (let i = 0; i < pathfinderSubmenuItems.length; i++) {
      const it = pathfinderSubmenuItems[i];
      if (it) {
        it.disabled = !canPathfinder;
        it.setAttribute('aria-disabled', String(!canPathfinder));
      }
    }

    const hasClipboard = inputController.clipboard !== null;
    if (menuItemPaste) {
      menuItemPaste.disabled = !hasClipboard;
      menuItemPaste.setAttribute('aria-disabled', String(!hasClipboard));
    }

    // Deshabilitación de zoom en límites [0.1, 32]
    const currentZoom = viewportManager.zoom;
    const isAtMaxZoom = currentZoom >= 32 - 1e-4;
    const isAtMinZoom = currentZoom <= 0.1 + 1e-4;

    if (menuItemZoomIn) {
      menuItemZoomIn.disabled = isAtMaxZoom;
      menuItemZoomIn.setAttribute('aria-disabled', String(isAtMaxZoom));
    }
    if (menuItemZoomOut) {
      menuItemZoomOut.disabled = isAtMinZoom;
      menuItemZoomOut.setAttribute('aria-disabled', String(isAtMinZoom));
    }
  }

  const openMenu = (index: number, focusFirstItem: boolean = false) => {
    if (index < 0 || index >= menuEntries.length) return;
    const entry = menuEntries[index];
    if (!entry.trigger || entry.trigger.disabled || entry.trigger.getAttribute('aria-disabled') === 'true') {
      return;
    }

    closeAllMenus();
    activeMenuIndex = index;
    syncMenuItems();

    entry.trigger.setAttribute('aria-expanded', 'true');
    entry.trigger.classList?.add('is-open');

    if (entry.dropdown) {
      entry.dropdown.hidden = false;
      entry.dropdown.classList?.add('is-open');

      if (focusFirstItem) {
        const enabledItems = entry.items.filter((it): it is HTMLButtonElement =>
          it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabledItems.length > 0) {
          enabledItems[0].focus?.();
        }
      }
    }
  };

  const triggerClickHandlers = menuEntries.map((_, i) => () => {
    if (activeMenuIndex === i) {
      closeAllMenus();
    } else {
      openMenu(i, false);
    }
  });

  const triggerMouseEnterHandlers = menuEntries.map((_, i) => () => {
    if (activeMenuIndex !== -1 && activeMenuIndex !== i) {
      openMenu(i, false);
    }
  });

  const triggerKeyDownHandlers = menuEntries.map((_, index) => (e: KeyboardEvent) => {
    const key = e.key;
    if (key === 'ArrowRight') {
      e.preventDefault?.();
      const nextIndex = (index + 1) % menuEntries.length;
      menuEntries[nextIndex].trigger?.focus?.();
      if (activeMenuIndex !== -1) {
        openMenu(nextIndex, true);
      }
    } else if (key === 'ArrowLeft') {
      e.preventDefault?.();
      const prevIndex = (index - 1 + menuEntries.length) % menuEntries.length;
      menuEntries[prevIndex].trigger?.focus?.();
      if (activeMenuIndex !== -1) {
        openMenu(prevIndex, true);
      }
    } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
      e.preventDefault?.();
      openMenu(index, true);
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      openMenu(index, false);
      const enabledItems = menuEntries[index].items.filter((it): it is HTMLButtonElement =>
        it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
      );
      if (enabledItems.length > 0) {
        enabledItems[enabledItems.length - 1].focus?.();
      }
    } else if (key === 'Escape') {
      if (activeMenuIndex !== -1) {
        e.preventDefault?.();
        closeAllMenus();
      }
    }
  });

  const dropdownKeyDownHandlers = menuEntries.map((entry, menuIndex) => (e: KeyboardEvent) => {
    const key = e.key;
    const allItems = entry.items.filter(Boolean) as HTMLButtonElement[];
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
        return;
      }
      e.preventDefault?.();
      const nextMenuIndex = (menuIndex + 1) % menuEntries.length;
      menuEntries[nextMenuIndex].trigger?.focus?.();
      openMenu(nextMenuIndex, true);
    } else if (key === 'ArrowLeft') {
      e.preventDefault?.();
      const prevMenuIndex = (menuIndex - 1 + menuEntries.length) % menuEntries.length;
      menuEntries[prevMenuIndex].trigger?.focus?.();
      openMenu(prevMenuIndex, true);
    } else if (key === 'Escape') {
      e.preventDefault?.();
      closeAllMenus();
      entry.trigger?.focus?.();
    } else if (key === 'Tab') {
      closeAllMenus();
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
  });

  menuEntries.forEach((entry, i) => {
    entry.trigger?.addEventListener('click', triggerClickHandlers[i]);
    entry.trigger?.addEventListener('mouseenter', triggerMouseEnterHandlers[i]);
    entry.trigger?.addEventListener('keydown', triggerKeyDownHandlers[i]);
    entry.dropdown?.addEventListener('keydown', dropdownKeyDownHandlers[i]);
  });

  // Submenu mouse handlers
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
      closeAllMenus();
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

  const onDocumentClick = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (activeMenuIndex === -1) return;
    if (menuBar && typeof menuBar.contains === 'function') {
      if (!menuBar.contains(target)) {
        closeAllMenus();
      }
    } else {
      let isInside = false;
      for (const entry of menuEntries) {
        if (entry.trigger === target || entry.dropdown === target) {
          isInside = true;
          break;
        }
        if (entry.dropdown && typeof entry.dropdown.contains === 'function' && entry.dropdown.contains(target)) {
          isInside = true;
          break;
        }
      }
      if (!isInside) {
        closeAllMenus();
      }
    }
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'e') {
      e.preventDefault?.();
      closeAllMenus();
      options.openExportDialog?.(menuBtnFile);
      return;
    }

    if (e.key === 'Escape' && activeMenuIndex !== -1) {
      e.preventDefault?.();
      const trigger = menuEntries[activeMenuIndex]?.trigger;
      closeAllMenus();
      trigger?.focus?.();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  // Menu item click handlers
  const onMenuImportClick = () => {
    closeAllMenus();
    options.onImportClick?.();
  };

  const onMenuPlaceClick = () => {
    closeAllMenus();
    options.onPlaceClick?.();
  };

  const onMenuExportModalClick = () => {
    closeAllMenus();
    options.openExportDialog?.(menuBtnFile);
  };

  const onMenuExportSvgClick = () => {
    closeAllMenus();
    options.onExportSvg?.();
  };

  const onMenuExportPngClick = () => {
    closeAllMenus();
    options.onExportPng?.();
  };

  const onMenuExportWebpClick = () => {
    closeAllMenus();
    options.onExportWebp?.();
  };

  const onMenuExportClick = () => {
    closeAllMenus();
    options.onExportClick?.();
  };

  const onMenuUndoClick = () => {
    if (commandManager.canUndo()) {
      closeAllMenus();
      commandManager.undo();
      canvas?.focus?.();
    }
  };

  const onMenuRedoClick = () => {
    if (commandManager.canRedo()) {
      closeAllMenus();
      commandManager.redo();
      canvas?.focus?.();
    }
  };

  const onMenuCutClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.cut();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuCopyClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.copy();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuPasteClick = () => {
    if (inputController.clipboard) {
      closeAllMenus();
      inputController.paste();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuDuplicateClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.duplicate();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuDeleteClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.deleteSelected();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuBringToFrontClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.bringToFront();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuSendToBackClick = () => {
    if (stateManager.getSelection().length > 0) {
      closeAllMenus();
      inputController.sendToBack();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuGroupClick = () => {
    if (stateManager.getSelection().length >= 2) {
      closeAllMenus();
      inputController.groupSelection();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onMenuUngroupClick = () => {
    if (stateManager.getSelectedNodes().some(isGroup)) {
      closeAllMenus();
      inputController.ungroupSelection();
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const createAlignHandler = (mode: AlignmentMode) => () => {
    if (stateManager.getSelection().length >= 2) {
      closeAllMenus();
      inputController.alignSelection(mode);
      syncMenuItems();
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

  const createDistributeHandler = (axis: DistributionAxis) => () => {
    if (stateManager.getSelection().length >= 3) {
      closeAllMenus();
      inputController.distributeSelection(axis);
      syncMenuItems();
      options.onAction?.();
      canvas?.focus?.();
    }
  };

  const onDistributeH = createDistributeHandler('horizontal');
  const onDistributeV = createDistributeHandler('vertical');

  const createPathfinderHandler = (op: BooleanOp) => () => {
    closeAllMenus();
    inputController.applyBooleanOperation(op);
    options.onSyncPropertiesPanel?.();
    syncMenuItems();
    options.onAction?.();
    canvas?.focus?.();
  };

  const onPathfinderUnion = createPathfinderHandler('union');
  const onPathfinderSubtract = createPathfinderHandler('subtract');
  const onPathfinderIntersect = createPathfinderHandler('intersect');
  const onPathfinderExclude = createPathfinderHandler('exclude');

  const onMenuZoomInClick = () => {
    closeAllMenus();
    inputController.zoomIn();
    canvas?.focus?.();
  };

  const onMenuZoomOutClick = () => {
    closeAllMenus();
    inputController.zoomOut();
    canvas?.focus?.();
  };

  const onMenuZoomFitClick = () => {
    closeAllMenus();
    inputController.zoomFit();
    canvas?.focus?.();
  };

  const onMenuZoom100Click = () => {
    closeAllMenus();
    inputController.zoomReset();
    canvas?.focus?.();
  };

  const syncSmartGuidesMenuItem = () => {
    menuItemSmartGuides?.setAttribute('aria-checked', String(inputController.smartGuidesEnabled));
  };

  const onMenuSmartGuidesClick = () => {
    inputController.setSmartGuidesEnabled(!inputController.smartGuidesEnabled);
    syncSmartGuidesMenuItem();
  };

  const unsubscribeSmartGuides = inputController.onSmartGuidesChange(syncSmartGuidesMenuItem);
  syncSmartGuidesMenuItem();

  const onMenuShortcutsClick = () => {
    closeAllMenus();
    options.openShortcutsDialog?.();
  };

  const onMenuAboutClick = () => {
    closeAllMenus();
    options.openAboutDialog?.(menuBtnHelp);
  };

  const onBrandAboutClick = () => {
    closeAllMenus();
    options.openAboutDialog?.(btnAboutBrand);
  };

  menuItemImport?.addEventListener('click', onMenuImportClick);
  menuItemPlace?.addEventListener('click', onMenuPlaceClick);
  menuItemExportModal?.addEventListener('click', onMenuExportModalClick);
  menuItemExportSvg?.addEventListener('click', onMenuExportSvgClick);
  menuItemExportPng?.addEventListener('click', onMenuExportPngClick);
  menuItemExportWebp?.addEventListener('click', onMenuExportWebpClick);
  menuItemExport?.addEventListener('click', onMenuExportClick);
  menuItemUndo?.addEventListener('click', onMenuUndoClick);
  menuItemRedo?.addEventListener('click', onMenuRedoClick);
  menuItemCut?.addEventListener('click', onMenuCutClick);
  menuItemCopy?.addEventListener('click', onMenuCopyClick);
  menuItemPaste?.addEventListener('click', onMenuPasteClick);
  menuItemDuplicate?.addEventListener('click', onMenuDuplicateClick);
  menuItemDelete?.addEventListener('click', onMenuDeleteClick);
  menuItemBringToFront?.addEventListener('click', onMenuBringToFrontClick);
  menuItemSendToBack?.addEventListener('click', onMenuSendToBackClick);
  menuItemGroup?.addEventListener('click', onMenuGroupClick);
  menuItemUngroup?.addEventListener('click', onMenuUngroupClick);

  menuItemAlignLeft?.addEventListener('click', onAlignLeft);
  menuItemAlignCenterH?.addEventListener('click', onAlignCenterH);
  menuItemAlignRight?.addEventListener('click', onAlignRight);
  menuItemAlignTop?.addEventListener('click', onAlignTop);
  menuItemAlignCenterV?.addEventListener('click', onAlignCenterV);
  menuItemAlignBottom?.addEventListener('click', onAlignBottom);

  menuItemDistributeH?.addEventListener('click', onDistributeH);
  menuItemDistributeV?.addEventListener('click', onDistributeV);

  menuItemPathfinderUnion?.addEventListener('click', onPathfinderUnion);
  menuItemPathfinderSubtract?.addEventListener('click', onPathfinderSubtract);
  menuItemPathfinderIntersect?.addEventListener('click', onPathfinderIntersect);
  menuItemPathfinderExclude?.addEventListener('click', onPathfinderExclude);

  menuItemZoomIn?.addEventListener('click', onMenuZoomInClick);
  menuItemZoomOut?.addEventListener('click', onMenuZoomOutClick);
  menuItemZoomFit?.addEventListener('click', onMenuZoomFitClick);
  menuItemZoom100?.addEventListener('click', onMenuZoom100Click);
  menuItemSmartGuides?.addEventListener('click', onMenuSmartGuidesClick);
  menuItemShortcuts?.addEventListener('click', onMenuShortcutsClick);
  menuItemAbout?.addEventListener('click', onMenuAboutClick);
  btnAboutBrand?.addEventListener('click', onBrandAboutClick);

  return {
    openMenu,
    closeAllMenus,
    syncMenuItems,
    cleanup: () => {
      menuEntries.forEach((entry, i) => {
        entry.trigger?.removeEventListener('click', triggerClickHandlers[i]);
        entry.trigger?.removeEventListener('mouseenter', triggerMouseEnterHandlers[i]);
        entry.trigger?.removeEventListener('keydown', triggerKeyDownHandlers[i]);
        entry.dropdown?.removeEventListener('keydown', dropdownKeyDownHandlers[i]);
      });

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

      menuItemImport?.removeEventListener('click', onMenuImportClick);
      menuItemPlace?.removeEventListener('click', onMenuPlaceClick);
      menuItemExportModal?.removeEventListener('click', onMenuExportModalClick);
      menuItemExportSvg?.removeEventListener('click', onMenuExportSvgClick);
      menuItemExportPng?.removeEventListener('click', onMenuExportPngClick);
      menuItemExportWebp?.removeEventListener('click', onMenuExportWebpClick);
      menuItemExport?.removeEventListener('click', onMenuExportClick);
      menuItemUndo?.removeEventListener('click', onMenuUndoClick);
      menuItemRedo?.removeEventListener('click', onMenuRedoClick);
      menuItemCut?.removeEventListener('click', onMenuCutClick);
      menuItemCopy?.removeEventListener('click', onMenuCopyClick);
      menuItemPaste?.removeEventListener('click', onMenuPasteClick);
      menuItemDuplicate?.removeEventListener('click', onMenuDuplicateClick);
      menuItemDelete?.removeEventListener('click', onMenuDeleteClick);
      menuItemBringToFront?.removeEventListener('click', onMenuBringToFrontClick);
      menuItemSendToBack?.removeEventListener('click', onMenuSendToBackClick);
      menuItemGroup?.removeEventListener('click', onMenuGroupClick);
      menuItemUngroup?.removeEventListener('click', onMenuUngroupClick);

      menuItemAlignLeft?.removeEventListener('click', onAlignLeft);
      menuItemAlignCenterH?.removeEventListener('click', onAlignCenterH);
      menuItemAlignRight?.removeEventListener('click', onAlignRight);
      menuItemAlignTop?.removeEventListener('click', onAlignTop);
      menuItemAlignCenterV?.removeEventListener('click', onAlignCenterV);
      menuItemAlignBottom?.removeEventListener('click', onAlignBottom);

      menuItemDistributeH?.removeEventListener('click', onDistributeH);
      menuItemDistributeV?.removeEventListener('click', onDistributeV);

      menuItemPathfinderUnion?.removeEventListener('click', onPathfinderUnion);
      menuItemPathfinderSubtract?.removeEventListener('click', onPathfinderSubtract);
      menuItemPathfinderIntersect?.removeEventListener('click', onPathfinderIntersect);
      menuItemPathfinderExclude?.removeEventListener('click', onPathfinderExclude);

      menuItemZoomIn?.removeEventListener('click', onMenuZoomInClick);
      menuItemZoomOut?.removeEventListener('click', onMenuZoomOutClick);
      menuItemZoomFit?.removeEventListener('click', onMenuZoomFitClick);
      menuItemZoom100?.removeEventListener('click', onMenuZoom100Click);
      menuItemSmartGuides?.removeEventListener('click', onMenuSmartGuidesClick);
      unsubscribeSmartGuides();
      menuItemShortcuts?.removeEventListener('click', onMenuShortcutsClick);
      menuItemAbout?.removeEventListener('click', onMenuAboutClick);
      btnAboutBrand?.removeEventListener('click', onBrandAboutClick);

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeyDown);
      }
    },
  };
}
