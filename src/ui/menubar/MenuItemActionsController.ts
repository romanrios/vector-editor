import { StateManager, getLeafShapes } from '../../state/StateManager.ts';
import { CommandManager } from '../../commands/CommandManager.ts';
import { InputController } from '../../input/InputController.ts';
import { isGroup } from '../../types/scene-graph.ts';
import type { AlignmentMode, DistributionAxis } from '../../utils/geometry.ts';
import type { BooleanOp } from '../../utils/booleanOperations.ts';
import { canOutlineStroke } from '../../utils/strokeToPath.ts';
import { ClearGuidesCommand } from '../../commands/ClearGuidesCommand.ts';
import type { MenuBarControllerOptions, MenuBarElements } from './types.ts';
import type { MenuNavigationController } from './MenuNavigationController.ts';
import type { MenuSyncController } from './MenuSyncController.ts';

export class MenuItemActionsController {
  private readonly elements: MenuBarElements;
  private readonly inputController: InputController;
  private readonly commandManager: CommandManager;
  private readonly stateManager: StateManager;
  private readonly options: MenuBarControllerOptions;
  private readonly navigation: MenuNavigationController;
  private readonly sync: MenuSyncController;

  private unsubscribeSmartGuides: () => void;

  // Handlers
  private onMenuNewClick = (): void => {
    this.navigation.closeAllMenus();
    this.options.onNewClick?.();
  };

  private onMenuOpenClick = (): void => {
    this.navigation.closeAllMenus();
    if (this.options.onOpenClick) {
      this.options.onOpenClick();
    } else {
      this.options.onImportClick?.();
    }
  };

  private onMenuSaveJsonClick = (): void => {
    this.navigation.closeAllMenus();
    if (this.options.onSaveJsonClick) {
      this.options.onSaveJsonClick();
    } else {
      this.options.onExportClick?.();
    }
  };

  private onMenuPlaceClick = (): void => {
    this.navigation.closeAllMenus();
    this.options.onPlaceClick?.();
  };

  private onMenuExportModalClick = (): void => {
    this.navigation.closeAllMenus();
    this.options.openExportDialog?.(this.elements.menuBtnFile);
  };

  private onMenuUndoClick = (): void => {
    if (this.commandManager.canUndo()) {
      this.navigation.closeAllMenus();
      this.commandManager.undo();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuRedoClick = (): void => {
    if (this.commandManager.canRedo()) {
      this.navigation.closeAllMenus();
      this.commandManager.redo();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuCutClick = (): void => {
    if (this.stateManager.getSelection().length > 0) {
      this.navigation.closeAllMenus();
      this.inputController.cut();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuCopyClick = (): void => {
    if (this.stateManager.getSelection().length > 0) {
      this.navigation.closeAllMenus();
      this.inputController.copy();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuPasteClick = (): void => {
    if (this.inputController.clipboard) {
      this.navigation.closeAllMenus();
      this.inputController.paste();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuDuplicateClick = (): void => {
    if (this.stateManager.getSelection().length > 0) {
      this.navigation.closeAllMenus();
      this.inputController.duplicate();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuDeleteClick = (): void => {
    if (this.stateManager.getSelection().length > 0) {
      this.navigation.closeAllMenus();
      this.inputController.deleteSelected();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuBringToFrontClick = (): void => {
    if (this.stateManager.getSelection().length > 0) {
      this.navigation.closeAllMenus();
      this.inputController.bringToFront();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuSendToBackClick = (): void => {
    if (this.stateManager.getSelection().length > 0) {
      this.navigation.closeAllMenus();
      this.inputController.sendToBack();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuGroupClick = (): void => {
    if (this.stateManager.getSelection().length >= 2) {
      this.navigation.closeAllMenus();
      this.inputController.groupSelection();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuUngroupClick = (): void => {
    if (this.stateManager.getSelectedNodes().some(isGroup)) {
      this.navigation.closeAllMenus();
      this.inputController.ungroupSelection();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuMakeClipMaskClick = (): void => {
    const selected = this.stateManager.getSelectedNodes();
    const canMake =
      selected.length >= 2 || (selected.length === 1 && isGroup(selected[0]) && selected[0].children.length >= 2);
    if (canMake) {
      this.navigation.closeAllMenus();
      this.inputController.makeClipMask();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuReleaseClipMaskClick = (): void => {
    if (this.stateManager.getSelectedNodes().some((n) => isGroup(n) && n.isClipMask === true)) {
      this.navigation.closeAllMenus();
      this.inputController.releaseClipMask();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onMenuOutlineStrokeClick = (): void => {
    const leafShapes = getLeafShapes(this.stateManager.getSelectedNodes());
    if (leafShapes.some(canOutlineStroke)) {
      this.navigation.closeAllMenus();
      this.inputController.outlineStroke();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    }
  };

  private createAlignHandler(mode: AlignmentMode): () => void {
    return () => {
      if (this.stateManager.getSelection().length >= 2) {
        this.navigation.closeAllMenus();
        this.inputController.alignSelection(mode);
        this.sync.syncMenuItems();
        this.options.onAction?.();
        this.elements.canvas?.focus?.();
      }
    };
  }

  private onAlignLeft = this.createAlignHandler('left');
  private onAlignCenterH = this.createAlignHandler('center-h');
  private onAlignRight = this.createAlignHandler('right');
  private onAlignTop = this.createAlignHandler('top');
  private onAlignCenterV = this.createAlignHandler('center-v');
  private onAlignBottom = this.createAlignHandler('bottom');

  private createDistributeHandler(axis: DistributionAxis): () => void {
    return () => {
      if (this.stateManager.getSelection().length >= 3) {
        this.navigation.closeAllMenus();
        this.inputController.distributeSelection(axis);
        this.sync.syncMenuItems();
        this.options.onAction?.();
        this.elements.canvas?.focus?.();
      }
    };
  }

  private onDistributeH = this.createDistributeHandler('horizontal');
  private onDistributeV = this.createDistributeHandler('vertical');

  private createPathfinderHandler(op: BooleanOp): () => void {
    return () => {
      this.navigation.closeAllMenus();
      this.inputController.applyBooleanOperation(op);
      this.options.onSyncPropertiesPanel?.();
      this.sync.syncMenuItems();
      this.options.onAction?.();
      this.elements.canvas?.focus?.();
    };
  }

  private onPathfinderUnion = this.createPathfinderHandler('union');
  private onPathfinderSubtract = this.createPathfinderHandler('subtract');
  private onPathfinderIntersect = this.createPathfinderHandler('intersect');
  private onPathfinderExclude = this.createPathfinderHandler('exclude');

  private onMenuZoomInClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.zoomIn();
    this.elements.canvas?.focus?.();
  };

  private onMenuZoomOutClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.zoomOut();
    this.elements.canvas?.focus?.();
  };

  private onMenuZoomFitClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.zoomFit();
    this.elements.canvas?.focus?.();
  };

  private onMenuZoom100Click = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.zoomReset();
    this.elements.canvas?.focus?.();
  };

  private onMenuRulersClick = (): void => {
    this.stateManager.setRulersVisible(!this.stateManager.isRulersVisible());
    this.sync.syncRulersAndGuidesMenuItems();
  };

  private onMenuShowGuidesClick = (): void => {
    this.stateManager.setGuidesVisible(!this.stateManager.isGuidesVisible());
    this.sync.syncRulersAndGuidesMenuItems();
  };

  private onMenuLockGuidesClick = (): void => {
    this.stateManager.setGuidesLocked(!this.stateManager.isGuidesLocked());
    this.sync.syncRulersAndGuidesMenuItems();
  };

  private onMenuSnapGuidesClick = (): void => {
    this.stateManager.setGuideSnappingEnabled(!this.stateManager.isGuideSnappingEnabled());
    this.sync.syncRulersAndGuidesMenuItems();
  };

  private onMenuClearGuidesClick = (): void => {
    this.navigation.closeAllMenus();
    const prev = this.stateManager.getGuides();
    if (prev.length > 0) {
      this.commandManager.executeCommand(new ClearGuidesCommand(this.stateManager, prev));
    }
  };

  private onMenuSmartGuidesClick = (): void => {
    this.inputController.setSmartGuidesEnabled(!this.inputController.smartGuidesEnabled);
    this.sync.syncSmartGuidesMenuItem();
  };

  private onMenuShortcutsClick = (): void => {
    this.navigation.closeAllMenus();
    this.options.openShortcutsDialog?.();
  };

  private onMenuAboutClick = (): void => {
    this.navigation.closeAllMenus();
    this.options.openAboutDialog?.(this.elements.menuBtnHelp);
  };

  private onBrandAboutClick = (): void => {
    this.navigation.closeAllMenus();
    this.options.openAboutDialog?.(this.elements.btnAboutBrand);
  };

  private onTypeFontClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.menu-item-type-font-opt');
    const font = target?.getAttribute('data-font');
    if (font) {
      this.navigation.closeAllMenus();
      this.inputController.applyTextTypography({ fontFamily: font });
      this.options.onAction?.();
      this.options.onSyncPropertiesPanel?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onTypeSizeClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.menu-item-type-size-opt');
    const size = parseFloat(target?.getAttribute('data-size') || '');
    if (!isNaN(size) && size > 0) {
      this.navigation.closeAllMenus();
      this.inputController.applyTextTypography({ fontSize: size });
      this.options.onAction?.();
      this.options.onSyncPropertiesPanel?.();
      this.elements.canvas?.focus?.();
    }
  };

  private onTypeStyleRegularClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.applyTextTypography({ fontWeight: 400, fontStyle: 'normal' });
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeStyleBoldClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.applyTextTypography({ fontWeight: 700 });
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeStyleItalicClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.applyTextTypography({ fontStyle: 'italic' });
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeAlignLeftClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.applyTextTypography({ textAlign: 'left' });
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeAlignCenterClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.applyTextTypography({ textAlign: 'center' });
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeAlignRightClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.applyTextTypography({ textAlign: 'right' });
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeToggleKindClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.toggleTextKind();
    this.sync.syncMenuItems();
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeUppercaseClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.changeTextCase('uppercase');
    this.sync.syncMenuItems();
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeLowercaseClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.changeTextCase('lowercase');
    this.sync.syncMenuItems();
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeTitlecaseClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.changeTextCase('titlecase');
    this.sync.syncMenuItems();
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  private onTypeLoremClick = (): void => {
    this.navigation.closeAllMenus();
    this.inputController.fillLoremIpsum();
    this.sync.syncMenuItems();
    this.options.onAction?.();
    this.options.onSyncPropertiesPanel?.();
    this.elements.canvas?.focus?.();
  };

  constructor(
    elements: MenuBarElements,
    inputController: InputController,
    commandManager: CommandManager,
    stateManager: StateManager,
    options: MenuBarControllerOptions,
    navigation: MenuNavigationController,
    sync: MenuSyncController
  ) {
    this.elements = elements;
    this.inputController = inputController;
    this.commandManager = commandManager;
    this.stateManager = stateManager;
    this.options = options;
    this.navigation = navigation;
    this.sync = sync;

    this.unsubscribeSmartGuides = this.inputController.onSmartGuidesChange(this.sync.syncSmartGuidesMenuItem);
    this.sync.syncSmartGuidesMenuItem();
    this.sync.syncRulersAndGuidesMenuItems();

    this.bindEvents();
  }

  private bindEvents(): void {
    const el = this.elements;

    el.menuItemNew?.addEventListener('click', this.onMenuNewClick);
    el.menuItemOpen?.addEventListener('click', this.onMenuOpenClick);
    el.menuItemSaveJson?.addEventListener('click', this.onMenuSaveJsonClick);
    el.menuItemPlace?.addEventListener('click', this.onMenuPlaceClick);
    el.menuItemExportModal?.addEventListener('click', this.onMenuExportModalClick);
    el.menuItemUndo?.addEventListener('click', this.onMenuUndoClick);
    el.menuItemRedo?.addEventListener('click', this.onMenuRedoClick);
    el.menuItemCut?.addEventListener('click', this.onMenuCutClick);
    el.menuItemCopy?.addEventListener('click', this.onMenuCopyClick);
    el.menuItemPaste?.addEventListener('click', this.onMenuPasteClick);
    el.menuItemDuplicate?.addEventListener('click', this.onMenuDuplicateClick);
    el.menuItemDelete?.addEventListener('click', this.onMenuDeleteClick);
    el.menuItemBringToFront?.addEventListener('click', this.onMenuBringToFrontClick);
    el.menuItemSendToBack?.addEventListener('click', this.onMenuSendToBackClick);
    el.menuItemGroup?.addEventListener('click', this.onMenuGroupClick);
    el.menuItemUngroup?.addEventListener('click', this.onMenuUngroupClick);
    el.menuItemMakeClipMask?.addEventListener('click', this.onMenuMakeClipMaskClick);
    el.menuItemReleaseClipMask?.addEventListener('click', this.onMenuReleaseClipMaskClick);
    el.menuItemOutlineStroke?.addEventListener('click', this.onMenuOutlineStrokeClick);

    el.menuItemAlignLeft?.addEventListener('click', this.onAlignLeft);
    el.menuItemAlignCenterH?.addEventListener('click', this.onAlignCenterH);
    el.menuItemAlignRight?.addEventListener('click', this.onAlignRight);
    el.menuItemAlignTop?.addEventListener('click', this.onAlignTop);
    el.menuItemAlignCenterV?.addEventListener('click', this.onAlignCenterV);
    el.menuItemAlignBottom?.addEventListener('click', this.onAlignBottom);

    el.menuItemDistributeH?.addEventListener('click', this.onDistributeH);
    el.menuItemDistributeV?.addEventListener('click', this.onDistributeV);

    el.menuItemPathfinderUnion?.addEventListener('click', this.onPathfinderUnion);
    el.menuItemPathfinderSubtract?.addEventListener('click', this.onPathfinderSubtract);
    el.menuItemPathfinderIntersect?.addEventListener('click', this.onPathfinderIntersect);
    el.menuItemPathfinderExclude?.addEventListener('click', this.onPathfinderExclude);

    for (const opt of el.menuItemTypeFontOptions) {
      opt.addEventListener('click', this.onTypeFontClick);
    }
    for (const opt of el.menuItemTypeSizeOptions) {
      opt.addEventListener('click', this.onTypeSizeClick);
    }
    el.menuItemTypeStyleRegular?.addEventListener('click', this.onTypeStyleRegularClick);
    el.menuItemTypeStyleBold?.addEventListener('click', this.onTypeStyleBoldClick);
    el.menuItemTypeStyleItalic?.addEventListener('click', this.onTypeStyleItalicClick);
    el.menuItemTypeAlignLeft?.addEventListener('click', this.onTypeAlignLeftClick);
    el.menuItemTypeAlignCenter?.addEventListener('click', this.onTypeAlignCenterClick);
    el.menuItemTypeAlignRight?.addEventListener('click', this.onTypeAlignRightClick);
    el.menuItemTypeToggleKind?.addEventListener('click', this.onTypeToggleKindClick);
    el.menuItemTypeUppercase?.addEventListener('click', this.onTypeUppercaseClick);
    el.menuItemTypeLowercase?.addEventListener('click', this.onTypeLowercaseClick);
    el.menuItemTypeTitlecase?.addEventListener('click', this.onTypeTitlecaseClick);
    el.menuItemTypeLorem?.addEventListener('click', this.onTypeLoremClick);

    el.menuItemZoomIn?.addEventListener('click', this.onMenuZoomInClick);
    el.menuItemZoomOut?.addEventListener('click', this.onMenuZoomOutClick);
    el.menuItemZoomFit?.addEventListener('click', this.onMenuZoomFitClick);
    el.menuItemZoom100?.addEventListener('click', this.onMenuZoom100Click);
    el.menuItemRulers?.addEventListener('click', this.onMenuRulersClick);
    el.menuItemShowGuides?.addEventListener('click', this.onMenuShowGuidesClick);
    el.menuItemLockGuides?.addEventListener('click', this.onMenuLockGuidesClick);
    el.menuItemSnapGuides?.addEventListener('click', this.onMenuSnapGuidesClick);
    el.menuItemClearGuides?.addEventListener('click', this.onMenuClearGuidesClick);
    el.menuItemSmartGuides?.addEventListener('click', this.onMenuSmartGuidesClick);
    el.menuItemShortcuts?.addEventListener('click', this.onMenuShortcutsClick);
    el.menuItemAbout?.addEventListener('click', this.onMenuAboutClick);
    el.btnAboutBrand?.addEventListener('click', this.onBrandAboutClick);
  }

  public cleanup(): void {
    const el = this.elements;

    el.menuItemNew?.removeEventListener('click', this.onMenuNewClick);
    el.menuItemOpen?.removeEventListener('click', this.onMenuOpenClick);
    el.menuItemSaveJson?.removeEventListener('click', this.onMenuSaveJsonClick);
    el.menuItemPlace?.removeEventListener('click', this.onMenuPlaceClick);
    el.menuItemExportModal?.removeEventListener('click', this.onMenuExportModalClick);
    el.menuItemUndo?.removeEventListener('click', this.onMenuUndoClick);
    el.menuItemRedo?.removeEventListener('click', this.onMenuRedoClick);
    el.menuItemCut?.removeEventListener('click', this.onMenuCutClick);
    el.menuItemCopy?.removeEventListener('click', this.onMenuCopyClick);
    el.menuItemPaste?.removeEventListener('click', this.onMenuPasteClick);
    el.menuItemDuplicate?.removeEventListener('click', this.onMenuDuplicateClick);
    el.menuItemDelete?.removeEventListener('click', this.onMenuDeleteClick);
    el.menuItemBringToFront?.removeEventListener('click', this.onMenuBringToFrontClick);
    el.menuItemSendToBack?.removeEventListener('click', this.onMenuSendToBackClick);
    el.menuItemGroup?.removeEventListener('click', this.onMenuGroupClick);
    el.menuItemUngroup?.removeEventListener('click', this.onMenuUngroupClick);
    el.menuItemMakeClipMask?.removeEventListener('click', this.onMenuMakeClipMaskClick);
    el.menuItemReleaseClipMask?.removeEventListener('click', this.onMenuReleaseClipMaskClick);
    el.menuItemOutlineStroke?.removeEventListener('click', this.onMenuOutlineStrokeClick);

    el.menuItemAlignLeft?.removeEventListener('click', this.onAlignLeft);
    el.menuItemAlignCenterH?.removeEventListener('click', this.onAlignCenterH);
    el.menuItemAlignRight?.removeEventListener('click', this.onAlignRight);
    el.menuItemAlignTop?.removeEventListener('click', this.onAlignTop);
    el.menuItemAlignCenterV?.removeEventListener('click', this.onAlignCenterV);
    el.menuItemAlignBottom?.removeEventListener('click', this.onAlignBottom);

    el.menuItemDistributeH?.removeEventListener('click', this.onDistributeH);
    el.menuItemDistributeV?.removeEventListener('click', this.onDistributeV);

    el.menuItemPathfinderUnion?.removeEventListener('click', this.onPathfinderUnion);
    el.menuItemPathfinderSubtract?.removeEventListener('click', this.onPathfinderSubtract);
    el.menuItemPathfinderIntersect?.removeEventListener('click', this.onPathfinderIntersect);
    el.menuItemPathfinderExclude?.removeEventListener('click', this.onPathfinderExclude);

    for (const opt of el.menuItemTypeFontOptions) {
      opt.removeEventListener('click', this.onTypeFontClick);
    }
    for (const opt of el.menuItemTypeSizeOptions) {
      opt.removeEventListener('click', this.onTypeSizeClick);
    }
    el.menuItemTypeStyleRegular?.removeEventListener('click', this.onTypeStyleRegularClick);
    el.menuItemTypeStyleBold?.removeEventListener('click', this.onTypeStyleBoldClick);
    el.menuItemTypeStyleItalic?.removeEventListener('click', this.onTypeStyleItalicClick);
    el.menuItemTypeAlignLeft?.removeEventListener('click', this.onTypeAlignLeftClick);
    el.menuItemTypeAlignCenter?.removeEventListener('click', this.onTypeAlignCenterClick);
    el.menuItemTypeAlignRight?.removeEventListener('click', this.onTypeAlignRightClick);
    el.menuItemTypeToggleKind?.removeEventListener('click', this.onTypeToggleKindClick);
    el.menuItemTypeUppercase?.removeEventListener('click', this.onTypeUppercaseClick);
    el.menuItemTypeLowercase?.removeEventListener('click', this.onTypeLowercaseClick);
    el.menuItemTypeTitlecase?.removeEventListener('click', this.onTypeTitlecaseClick);
    el.menuItemTypeLorem?.removeEventListener('click', this.onTypeLoremClick);

    el.menuItemZoomIn?.removeEventListener('click', this.onMenuZoomInClick);
    el.menuItemZoomOut?.removeEventListener('click', this.onMenuZoomOutClick);
    el.menuItemZoomFit?.removeEventListener('click', this.onMenuZoomFitClick);
    el.menuItemZoom100?.removeEventListener('click', this.onMenuZoom100Click);
    el.menuItemRulers?.removeEventListener('click', this.onMenuRulersClick);
    el.menuItemShowGuides?.removeEventListener('click', this.onMenuShowGuidesClick);
    el.menuItemLockGuides?.removeEventListener('click', this.onMenuLockGuidesClick);
    el.menuItemSnapGuides?.removeEventListener('click', this.onMenuSnapGuidesClick);
    el.menuItemClearGuides?.removeEventListener('click', this.onMenuClearGuidesClick);
    el.menuItemSmartGuides?.removeEventListener('click', this.onMenuSmartGuidesClick);
    this.unsubscribeSmartGuides();
    el.menuItemShortcuts?.removeEventListener('click', this.onMenuShortcutsClick);
    el.menuItemAbout?.removeEventListener('click', this.onMenuAboutClick);
    el.btnAboutBrand?.removeEventListener('click', this.onBrandAboutClick);
  }
}
