import type { MenuBarControllerOptions, MenuBarElements, MenuEntry, SubmenuEntry } from './types.ts';

export function queryMenuBarElements(options: MenuBarControllerOptions): MenuBarElements {
  const canvas =
    options.canvas ??
    (typeof document !== 'undefined' ? document.querySelector<HTMLCanvasElement>('#viewport-canvas') : null);
  const menuBar = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.menu-bar') : null;

  const q = <T extends HTMLElement>(selector: string): T | null =>
    typeof document !== 'undefined' ? document.querySelector<T>(selector) : null;

  const qa = <T extends HTMLElement>(selector: string): T[] =>
    typeof document !== 'undefined' && typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll<T>(selector))
      : [];

  return {
    canvas,
    menuBar,
    menuBtnFile: q<HTMLButtonElement>('#menu-btn-file'),
    menuBtnEdit: q<HTMLButtonElement>('#menu-btn-edit'),
    menuBtnObject: q<HTMLButtonElement>('#menu-btn-object'),
    menuBtnType: q<HTMLButtonElement>('#menu-btn-type'),
    menuBtnView: q<HTMLButtonElement>('#menu-btn-view'),
    menuBtnHelp: q<HTMLButtonElement>('#menu-btn-help'),

    menuDropdownFile: q<HTMLElement>('#menu-dropdown-file'),
    menuDropdownEdit: q<HTMLElement>('#menu-dropdown-edit'),
    menuDropdownObject: q<HTMLElement>('#menu-dropdown-object'),
    menuDropdownType: q<HTMLElement>('#menu-dropdown-type'),
    menuDropdownView: q<HTMLElement>('#menu-dropdown-view'),
    menuDropdownHelp: q<HTMLElement>('#menu-dropdown-help'),

    menuItemNew: q<HTMLButtonElement>('#menu-item-new'),
    menuItemOpen:
      q<HTMLButtonElement>('#menu-item-open') ?? q<HTMLButtonElement>('#menu-item-import'),
    menuItemSaveJson:
      q<HTMLButtonElement>('#menu-item-save-json') ??
      q<HTMLButtonElement>('#menu-item-save') ??
      q<HTMLButtonElement>('#menu-item-export'),
    menuItemPlace: q<HTMLButtonElement>('#menu-item-place'),
    menuItemExportModal: q<HTMLButtonElement>('#menu-item-export-modal'),
    menuItemUndo: q<HTMLButtonElement>('#menu-item-undo'),
    menuItemRedo: q<HTMLButtonElement>('#menu-item-redo'),
    menuItemCut: q<HTMLButtonElement>('#menu-item-cut'),
    menuItemCopy: q<HTMLButtonElement>('#menu-item-copy'),
    menuItemPaste: q<HTMLButtonElement>('#menu-item-paste'),
    menuItemDuplicate: q<HTMLButtonElement>('#menu-item-duplicate'),
    menuItemDelete: q<HTMLButtonElement>('#menu-item-delete'),
    menuItemBringToFront: q<HTMLButtonElement>('#menu-item-bring-to-front'),
    menuItemSendToBack: q<HTMLButtonElement>('#menu-item-send-to-back'),
    menuItemGroup: q<HTMLButtonElement>('#menu-item-group'),
    menuItemUngroup: q<HTMLButtonElement>('#menu-item-ungroup'),
    menuItemMakeClipMask: q<HTMLButtonElement>('#menu-item-make-clip-mask'),
    menuItemReleaseClipMask: q<HTMLButtonElement>('#menu-item-release-clip-mask'),
    menuItemOutlineStroke: q<HTMLButtonElement>('#menu-item-outline-stroke'),

    menuItemAlign: q<HTMLButtonElement>('#menu-item-align'),
    menuDropdownAlign: q<HTMLElement>('#menu-dropdown-align'),
    menuItemAlignLeft: q<HTMLButtonElement>('#menu-item-align-left'),
    menuItemAlignCenterH: q<HTMLButtonElement>('#menu-item-align-center-h'),
    menuItemAlignRight: q<HTMLButtonElement>('#menu-item-align-right'),
    menuItemAlignTop: q<HTMLButtonElement>('#menu-item-align-top'),
    menuItemAlignCenterV: q<HTMLButtonElement>('#menu-item-align-center-v'),
    menuItemAlignBottom: q<HTMLButtonElement>('#menu-item-align-bottom'),

    menuItemDistribute: q<HTMLButtonElement>('#menu-item-distribute'),
    menuDropdownDistribute: q<HTMLElement>('#menu-dropdown-distribute'),
    menuItemDistributeH: q<HTMLButtonElement>('#menu-item-distribute-h'),
    menuItemDistributeV: q<HTMLButtonElement>('#menu-item-distribute-v'),

    menuItemPathfinder: q<HTMLButtonElement>('#menu-item-pathfinder'),
    menuDropdownPathfinder: q<HTMLElement>('#menu-dropdown-pathfinder'),
    menuItemPathfinderUnion: q<HTMLButtonElement>('#menu-item-pathfinder-union'),
    menuItemPathfinderSubtract: q<HTMLButtonElement>('#menu-item-pathfinder-subtract'),
    menuItemPathfinderIntersect: q<HTMLButtonElement>('#menu-item-pathfinder-intersect'),
    menuItemPathfinderExclude: q<HTMLButtonElement>('#menu-item-pathfinder-exclude'),

    menuItemTypeFont: q<HTMLButtonElement>('#menu-item-type-font'),
    menuDropdownTypeFont: q<HTMLElement>('#menu-dropdown-type-font'),
    menuItemTypeFontOptions: qa<HTMLButtonElement>('.menu-item-type-font-opt'),

    menuItemTypeSize: q<HTMLButtonElement>('#menu-item-type-size'),
    menuDropdownTypeSize: q<HTMLElement>('#menu-dropdown-type-size'),
    menuItemTypeSizeOptions: qa<HTMLButtonElement>('.menu-item-type-size-opt'),

    menuItemTypeStyle: q<HTMLButtonElement>('#menu-item-type-style'),
    menuDropdownTypeStyle: q<HTMLElement>('#menu-dropdown-type-style'),
    menuItemTypeStyleRegular: q<HTMLButtonElement>('#menu-item-type-style-regular'),
    menuItemTypeStyleBold: q<HTMLButtonElement>('#menu-item-type-style-bold'),
    menuItemTypeStyleItalic: q<HTMLButtonElement>('#menu-item-type-style-italic'),

    menuItemTypeAlign: q<HTMLButtonElement>('#menu-item-type-align'),
    menuDropdownTypeAlign: q<HTMLElement>('#menu-dropdown-type-align'),
    menuItemTypeAlignLeft: q<HTMLButtonElement>('#menu-item-type-align-left'),
    menuItemTypeAlignCenter: q<HTMLButtonElement>('#menu-item-type-align-center'),
    menuItemTypeAlignRight: q<HTMLButtonElement>('#menu-item-type-align-right'),

    menuItemTypeToggleKind: q<HTMLButtonElement>('#menu-item-type-toggle-kind'),
    menuItemTypeConvertToCurves: q<HTMLButtonElement>('#menu-item-type-convert-to-curves'),

    menuItemTypeCasing: q<HTMLButtonElement>('#menu-item-type-casing'),
    menuDropdownTypeCasing: q<HTMLElement>('#menu-dropdown-type-casing'),
    menuItemTypeUppercase: q<HTMLButtonElement>('#menu-item-type-uppercase'),
    menuItemTypeLowercase: q<HTMLButtonElement>('#menu-item-type-lowercase'),
    menuItemTypeTitlecase: q<HTMLButtonElement>('#menu-item-type-titlecase'),

    menuItemTypeLorem: q<HTMLButtonElement>('#menu-item-type-lorem'),

    menuItemRulers: q<HTMLButtonElement>('#menu-item-rulers'),
    menuItemGuides: q<HTMLButtonElement>('#menu-item-guides'),
    menuDropdownGuides: q<HTMLElement>('#menu-dropdown-guides'),
    menuItemShowGuides: q<HTMLButtonElement>('#menu-item-show-guides'),
    menuItemLockGuides: q<HTMLButtonElement>('#menu-item-lock-guides'),
    menuItemSnapGuides: q<HTMLButtonElement>('#menu-item-snap-guides'),
    menuItemClearGuides: q<HTMLButtonElement>('#menu-item-clear-guides'),

    menuItemZoomIn: q<HTMLButtonElement>('#menu-item-zoom-in'),
    menuItemZoomOut: q<HTMLButtonElement>('#menu-item-zoom-out'),
    menuItemZoomFit: q<HTMLButtonElement>('#menu-item-zoom-fit'),
    menuItemZoom100: q<HTMLButtonElement>('#menu-item-zoom-100'),
    menuItemSmartGuides: q<HTMLButtonElement>('#menu-item-smart-guides'),
    menuItemShortcuts: q<HTMLButtonElement>('#menu-item-shortcuts'),
    menuItemAbout: q<HTMLButtonElement>('#menu-item-about'),
    btnAboutBrand: q<HTMLButtonElement>('#btn-about-brand'),
  };
}

export function createMenuEntries(el: MenuBarElements): MenuEntry[] {
  return [
    {
      trigger: el.menuBtnFile,
      dropdown: el.menuDropdownFile,
      items: [
        el.menuItemNew,
        el.menuItemOpen,
        el.menuItemSaveJson,
        el.menuItemPlace,
        el.menuItemExportModal,
      ],
    },
    {
      trigger: el.menuBtnEdit,
      dropdown: el.menuDropdownEdit,
      items: [
        el.menuItemUndo,
        el.menuItemRedo,
        el.menuItemCut,
        el.menuItemCopy,
        el.menuItemPaste,
        el.menuItemDuplicate,
        el.menuItemDelete,
      ],
    },
    {
      trigger: el.menuBtnObject,
      dropdown: el.menuDropdownObject,
      items: [
        el.menuItemBringToFront,
        el.menuItemSendToBack,
        el.menuItemGroup,
        el.menuItemUngroup,
        el.menuItemMakeClipMask,
        el.menuItemReleaseClipMask,
        el.menuItemOutlineStroke,
        el.menuItemAlign,
        el.menuItemDistribute,
      ],
    },
    {
      trigger: el.menuBtnType,
      dropdown: el.menuDropdownType,
      items: [
        el.menuItemTypeFont,
        el.menuItemTypeSize,
        el.menuItemTypeStyle,
        el.menuItemTypeAlign,
        el.menuItemTypeToggleKind,
        el.menuItemTypeConvertToCurves,
        el.menuItemTypeCasing,
        el.menuItemTypeLorem,
      ],
    },
    {
      trigger: el.menuBtnView,
      dropdown: el.menuDropdownView,
      items: [
        el.menuItemRulers,
        el.menuItemSmartGuides,
        el.menuItemGuides,
        el.menuItemZoomIn,
        el.menuItemZoomOut,
        el.menuItemZoomFit,
        el.menuItemZoom100,
      ],
    },
    {
      trigger: el.menuBtnHelp,
      dropdown: el.menuDropdownHelp,
      items: [el.menuItemShortcuts, el.menuItemAbout],
    },
  ];
}

export function createSubmenuEntries(el: MenuBarElements): SubmenuEntry[] {
  return [
    {
      trigger: el.menuItemAlign,
      dropdown: el.menuDropdownAlign,
      items: [
        el.menuItemAlignLeft,
        el.menuItemAlignCenterH,
        el.menuItemAlignRight,
        el.menuItemAlignTop,
        el.menuItemAlignCenterV,
        el.menuItemAlignBottom,
      ],
    },
    {
      trigger: el.menuItemDistribute,
      dropdown: el.menuDropdownDistribute,
      items: [el.menuItemDistributeH, el.menuItemDistributeV],
    },
    {
      trigger: el.menuItemPathfinder,
      dropdown: el.menuDropdownPathfinder,
      items: [
        el.menuItemPathfinderUnion,
        el.menuItemPathfinderSubtract,
        el.menuItemPathfinderIntersect,
        el.menuItemPathfinderExclude,
      ],
    },
    {
      trigger: el.menuItemTypeFont,
      dropdown: el.menuDropdownTypeFont,
      items: el.menuItemTypeFontOptions,
    },
    {
      trigger: el.menuItemTypeSize,
      dropdown: el.menuDropdownTypeSize,
      items: el.menuItemTypeSizeOptions,
    },
    {
      trigger: el.menuItemTypeStyle,
      dropdown: el.menuDropdownTypeStyle,
      items: [
        el.menuItemTypeStyleRegular,
        el.menuItemTypeStyleBold,
        el.menuItemTypeStyleItalic,
      ],
    },
    {
      trigger: el.menuItemTypeAlign,
      dropdown: el.menuDropdownTypeAlign,
      items: [
        el.menuItemTypeAlignLeft,
        el.menuItemTypeAlignCenter,
        el.menuItemTypeAlignRight,
      ],
    },
    {
      trigger: el.menuItemTypeCasing,
      dropdown: el.menuDropdownTypeCasing,
      items: [
        el.menuItemTypeUppercase,
        el.menuItemTypeLowercase,
        el.menuItemTypeTitlecase,
      ],
    },
    {
      trigger: el.menuItemGuides,
      dropdown: el.menuDropdownGuides,
      items: [
        el.menuItemShowGuides,
        el.menuItemLockGuides,
        el.menuItemSnapGuides,
        el.menuItemClearGuides,
      ],
    },
  ];
}
