import type { SelectableNode } from '../../types/scene-graph.ts';
import type { ViewportManager } from '../../utils/viewport.ts';

export interface MenuBarControllerOptions {
  viewportManager: ViewportManager;
  canvas?: HTMLCanvasElement | null;
  onCloseContextMenu?: () => void;
  onNewClick?: () => void;
  onOpenClick?: () => void;
  onImportClick?: () => void;
  onSaveJsonClick?: () => void;
  onPlaceClick?: () => void;
  onExportClick?: () => void;
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

export interface MenuEntry {
  trigger: HTMLButtonElement | null;
  dropdown: HTMLElement | null;
  items: (HTMLButtonElement | null)[];
}

export interface SubmenuEntry {
  trigger: HTMLButtonElement | null;
  dropdown: HTMLElement | null;
  items: (HTMLButtonElement | null)[];
}

export interface MenuBarElements {
  canvas: HTMLCanvasElement | null;
  menuBar: HTMLElement | null;

  menuBtnFile: HTMLButtonElement | null;
  menuBtnEdit: HTMLButtonElement | null;
  menuBtnObject: HTMLButtonElement | null;
  menuBtnType: HTMLButtonElement | null;
  menuBtnView: HTMLButtonElement | null;
  menuBtnHelp: HTMLButtonElement | null;

  menuDropdownFile: HTMLElement | null;
  menuDropdownEdit: HTMLElement | null;
  menuDropdownObject: HTMLElement | null;
  menuDropdownType: HTMLElement | null;
  menuDropdownView: HTMLElement | null;
  menuDropdownHelp: HTMLElement | null;

  menuItemNew: HTMLButtonElement | null;
  menuItemOpen: HTMLButtonElement | null;
  menuItemSaveJson: HTMLButtonElement | null;
  menuItemPlace: HTMLButtonElement | null;
  menuItemExportModal: HTMLButtonElement | null;
  menuItemUndo: HTMLButtonElement | null;
  menuItemRedo: HTMLButtonElement | null;
  menuItemCut: HTMLButtonElement | null;
  menuItemCopy: HTMLButtonElement | null;
  menuItemPaste: HTMLButtonElement | null;
  menuItemDuplicate: HTMLButtonElement | null;
  menuItemDelete: HTMLButtonElement | null;
  menuItemBringToFront: HTMLButtonElement | null;
  menuItemSendToBack: HTMLButtonElement | null;
  menuItemGroup: HTMLButtonElement | null;
  menuItemUngroup: HTMLButtonElement | null;
  menuItemMakeClipMask: HTMLButtonElement | null;
  menuItemReleaseClipMask: HTMLButtonElement | null;
  menuItemOutlineStroke: HTMLButtonElement | null;

  menuItemAlign: HTMLButtonElement | null;
  menuDropdownAlign: HTMLElement | null;
  menuItemAlignLeft: HTMLButtonElement | null;
  menuItemAlignCenterH: HTMLButtonElement | null;
  menuItemAlignRight: HTMLButtonElement | null;
  menuItemAlignTop: HTMLButtonElement | null;
  menuItemAlignCenterV: HTMLButtonElement | null;
  menuItemAlignBottom: HTMLButtonElement | null;

  menuItemDistribute: HTMLButtonElement | null;
  menuDropdownDistribute: HTMLElement | null;
  menuItemDistributeH: HTMLButtonElement | null;
  menuItemDistributeV: HTMLButtonElement | null;

  menuItemPathfinder: HTMLButtonElement | null;
  menuDropdownPathfinder: HTMLElement | null;
  menuItemPathfinderUnion: HTMLButtonElement | null;
  menuItemPathfinderSubtract: HTMLButtonElement | null;
  menuItemPathfinderIntersect: HTMLButtonElement | null;
  menuItemPathfinderExclude: HTMLButtonElement | null;

  menuItemTypeFont: HTMLButtonElement | null;
  menuDropdownTypeFont: HTMLElement | null;
  menuItemTypeFontOptions: HTMLButtonElement[];

  menuItemTypeSize: HTMLButtonElement | null;
  menuDropdownTypeSize: HTMLElement | null;
  menuItemTypeSizeOptions: HTMLButtonElement[];

  menuItemTypeStyle: HTMLButtonElement | null;
  menuDropdownTypeStyle: HTMLElement | null;
  menuItemTypeStyleRegular: HTMLButtonElement | null;
  menuItemTypeStyleBold: HTMLButtonElement | null;
  menuItemTypeStyleItalic: HTMLButtonElement | null;

  menuItemTypeAlign: HTMLButtonElement | null;
  menuDropdownTypeAlign: HTMLElement | null;
  menuItemTypeAlignLeft: HTMLButtonElement | null;
  menuItemTypeAlignCenter: HTMLButtonElement | null;
  menuItemTypeAlignRight: HTMLButtonElement | null;

  menuItemTypeToggleKind: HTMLButtonElement | null;

  menuItemTypeCasing: HTMLButtonElement | null;
  menuDropdownTypeCasing: HTMLElement | null;
  menuItemTypeUppercase: HTMLButtonElement | null;
  menuItemTypeLowercase: HTMLButtonElement | null;
  menuItemTypeTitlecase: HTMLButtonElement | null;

  menuItemTypeLorem: HTMLButtonElement | null;

  menuItemRulers: HTMLButtonElement | null;
  menuItemGuides: HTMLButtonElement | null;
  menuDropdownGuides: HTMLElement | null;
  menuItemShowGuides: HTMLButtonElement | null;
  menuItemLockGuides: HTMLButtonElement | null;
  menuItemSnapGuides: HTMLButtonElement | null;
  menuItemClearGuides: HTMLButtonElement | null;

  menuItemZoomIn: HTMLButtonElement | null;
  menuItemZoomOut: HTMLButtonElement | null;
  menuItemZoomFit: HTMLButtonElement | null;
  menuItemZoom100: HTMLButtonElement | null;
  menuItemSmartGuides: HTMLButtonElement | null;
  menuItemShortcuts: HTMLButtonElement | null;
  menuItemAbout: HTMLButtonElement | null;
  btnAboutBrand: HTMLButtonElement | null;
}
