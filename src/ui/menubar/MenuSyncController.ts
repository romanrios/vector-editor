import { StateManager, getLeafShapes } from '../../state/StateManager.ts';
import { CommandManager } from '../../commands/CommandManager.ts';
import { InputController } from '../../input/InputController.ts';
import { ViewportManager } from '../../utils/viewport.ts';
import { isGroup, isText, type SelectableNode, type Text } from '../../types/scene-graph.ts';
import { isClosedShape } from '../../utils/booleanOperations.ts';
import { canOutlineStroke } from '../../utils/strokeToPath.ts';
import type { MenuBarElements } from './types.ts';

export class MenuSyncController {
  private readonly elements: MenuBarElements;
  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly inputController: InputController;
  private readonly viewportManager: ViewportManager;

  constructor(
    elements: MenuBarElements,
    stateManager: StateManager,
    commandManager: CommandManager,
    inputController: InputController,
    viewportManager: ViewportManager
  ) {
    this.elements = elements;
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.inputController = inputController;
    this.viewportManager = viewportManager;
  }

  public syncRulersAndGuidesMenuItems(): void {
    const el = this.elements;
    const sm = this.stateManager;

    el.menuItemRulers?.setAttribute('aria-checked', String(sm.isRulersVisible()));
    const checkRulers = el.menuItemRulers?.querySelector('.menu-check');
    if (checkRulers) checkRulers.textContent = sm.isRulersVisible() ? '✓' : '';

    el.menuItemShowGuides?.setAttribute('aria-checked', String(sm.isGuidesVisible()));
    const checkShow = el.menuItemShowGuides?.querySelector('.menu-check');
    if (checkShow) checkShow.textContent = sm.isGuidesVisible() ? '✓' : '';

    el.menuItemLockGuides?.setAttribute('aria-checked', String(sm.isGuidesLocked()));
    const checkLock = el.menuItemLockGuides?.querySelector('.menu-check');
    if (checkLock) checkLock.textContent = sm.isGuidesLocked() ? '✓' : '';

    el.menuItemSnapGuides?.setAttribute('aria-checked', String(sm.isGuideSnappingEnabled()));
    const checkSnap = el.menuItemSnapGuides?.querySelector('.menu-check');
    if (checkSnap) checkSnap.textContent = sm.isGuideSnappingEnabled() ? '✓' : '';
  }

  public syncSmartGuidesMenuItem = (): void => {
    this.elements.menuItemSmartGuides?.setAttribute(
      'aria-checked',
      String(this.inputController.smartGuidesEnabled)
    );
  };

  public syncMenuItems(
    selectedNodes: readonly SelectableNode[] = this.stateManager.getSelectedNodes()
  ): void {
    const el = this.elements;
    const canUndo = this.commandManager.canUndo();
    const canRedo = this.commandManager.canRedo();

    if (el.menuItemUndo) {
      el.menuItemUndo.disabled = !canUndo;
      el.menuItemUndo.setAttribute('aria-disabled', String(!canUndo));
    }
    if (el.menuItemRedo) {
      el.menuItemRedo.disabled = !canRedo;
      el.menuItemRedo.setAttribute('aria-disabled', String(!canRedo));
    }

    const hasSelection = selectedNodes.length > 0;

    if (el.menuItemCut) {
      el.menuItemCut.disabled = !hasSelection;
      el.menuItemCut.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (el.menuItemCopy) {
      el.menuItemCopy.disabled = !hasSelection;
      el.menuItemCopy.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (el.menuItemDuplicate) {
      el.menuItemDuplicate.disabled = !hasSelection;
      el.menuItemDuplicate.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (el.menuItemDelete) {
      el.menuItemDelete.disabled = !hasSelection;
      el.menuItemDelete.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (el.menuItemBringToFront) {
      el.menuItemBringToFront.disabled = !hasSelection;
      el.menuItemBringToFront.setAttribute('aria-disabled', String(!hasSelection));
    }
    if (el.menuItemSendToBack) {
      el.menuItemSendToBack.disabled = !hasSelection;
      el.menuItemSendToBack.setAttribute('aria-disabled', String(!hasSelection));
    }

    if (el.menuBtnObject) {
      el.menuBtnObject.disabled = !hasSelection;
      el.menuBtnObject.setAttribute('aria-disabled', String(!hasSelection));
    }

    const textNodes = getLeafShapes(selectedNodes).filter(isText);
    const hasAnyText = textNodes.length > 0;
    const singleTextNode =
      selectedNodes.length === 1 && isText(selectedNodes[0]) ? (selectedNodes[0] as Text) : null;

    if (el.menuBtnType) {
      el.menuBtnType.disabled = !hasAnyText;
      el.menuBtnType.setAttribute('aria-disabled', String(!hasAnyText));
    }

    const typeActionItems = [
      el.menuItemTypeFont,
      el.menuItemTypeSize,
      el.menuItemTypeStyle,
      el.menuItemTypeAlign,
      el.menuItemTypeConvertToCurves,
      el.menuItemTypeCasing,
      el.menuItemTypeLorem,
    ];
    for (let i = 0; i < typeActionItems.length; i++) {
      const it = typeActionItems[i];
      if (it) {
        it.disabled = !hasAnyText;
        it.setAttribute('aria-disabled', String(!hasAnyText));
      }
    }

    if (el.menuItemTypeToggleKind) {
      const canToggleKind = singleTextNode !== null;
      el.menuItemTypeToggleKind.disabled = !canToggleKind;
      el.menuItemTypeToggleKind.setAttribute('aria-disabled', String(!canToggleKind));
      if (singleTextNode) {
        const isArea =
          singleTextNode.textKind === 'area' ||
          (singleTextNode.boxWidth !== undefined && singleTextNode.textKind !== 'point');
        const label = el.menuItemTypeToggleKind.querySelector('.menu-item-label');
        if (label) {
          label.textContent = isArea ? 'Convertir a texto de punto' : 'Convertir a texto de área';
        }
      }
    }

    const canGroup = selectedNodes.length >= 2;
    const canUngroup = selectedNodes.some(isGroup);

    if (el.menuItemGroup) {
      el.menuItemGroup.disabled = !canGroup;
      el.menuItemGroup.setAttribute('aria-disabled', String(!canGroup));
    }
    if (el.menuItemUngroup) {
      el.menuItemUngroup.disabled = !canUngroup;
      el.menuItemUngroup.setAttribute('aria-disabled', String(!canUngroup));
    }

    const canMakeClipMask =
      selectedNodes.length >= 2 ||
      (selectedNodes.length === 1 && isGroup(selectedNodes[0]) && selectedNodes[0].children.length >= 2);
    const canReleaseClipMask = selectedNodes.some((n) => isGroup(n) && n.isClipMask === true);

    if (el.menuItemMakeClipMask) {
      el.menuItemMakeClipMask.disabled = !canMakeClipMask;
      el.menuItemMakeClipMask.setAttribute('aria-disabled', String(!canMakeClipMask));
    }
    if (el.menuItemReleaseClipMask) {
      el.menuItemReleaseClipMask.disabled = !canReleaseClipMask;
      el.menuItemReleaseClipMask.setAttribute('aria-disabled', String(!canReleaseClipMask));
    }

    const canAlign = selectedNodes.length >= 2;
    const canDistribute = selectedNodes.length >= 3;

    if (el.menuItemAlign) {
      el.menuItemAlign.disabled = !canAlign;
      el.menuItemAlign.setAttribute('aria-disabled', String(!canAlign));
    }

    const alignSubmenuItems = [
      el.menuItemAlignLeft,
      el.menuItemAlignCenterH,
      el.menuItemAlignRight,
      el.menuItemAlignTop,
      el.menuItemAlignCenterV,
      el.menuItemAlignBottom,
    ];
    for (let i = 0; i < alignSubmenuItems.length; i++) {
      const it = alignSubmenuItems[i];
      if (it) {
        it.disabled = !canAlign;
        it.setAttribute('aria-disabled', String(!canAlign));
      }
    }

    if (el.menuItemDistribute) {
      el.menuItemDistribute.disabled = !canDistribute;
      el.menuItemDistribute.setAttribute('aria-disabled', String(!canDistribute));
    }

    const distributeSubmenuItems = [el.menuItemDistributeH, el.menuItemDistributeV];
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
    const canOutlineStrokeValue = leafShapes.some(canOutlineStroke);

    if (el.menuItemOutlineStroke) {
      el.menuItemOutlineStroke.disabled = !canOutlineStrokeValue;
      el.menuItemOutlineStroke.setAttribute('aria-disabled', String(!canOutlineStrokeValue));
    }

    if (el.menuItemPathfinder) {
      el.menuItemPathfinder.disabled = !canPathfinder;
      el.menuItemPathfinder.setAttribute('aria-disabled', String(!canPathfinder));
    }

    const pathfinderSubmenuItems = [
      el.menuItemPathfinderUnion,
      el.menuItemPathfinderSubtract,
      el.menuItemPathfinderIntersect,
      el.menuItemPathfinderExclude,
    ];
    for (let i = 0; i < pathfinderSubmenuItems.length; i++) {
      const it = pathfinderSubmenuItems[i];
      if (it) {
        it.disabled = !canPathfinder;
        it.setAttribute('aria-disabled', String(!canPathfinder));
      }
    }

    const hasClipboard = this.inputController.clipboard !== null;
    if (el.menuItemPaste) {
      el.menuItemPaste.disabled = !hasClipboard;
      el.menuItemPaste.setAttribute('aria-disabled', String(!hasClipboard));
    }

    // Deshabilitación de zoom en límites [0.1, 32]
    const currentZoom = this.viewportManager.zoom;
    const isAtMaxZoom = currentZoom >= 32 - 1e-4;
    const isAtMinZoom = currentZoom <= 0.1 + 1e-4;

    if (el.menuItemZoomIn) {
      el.menuItemZoomIn.disabled = isAtMaxZoom;
      el.menuItemZoomIn.setAttribute('aria-disabled', String(isAtMaxZoom));
    }
    if (el.menuItemZoomOut) {
      el.menuItemZoomOut.disabled = isAtMinZoom;
      el.menuItemZoomOut.setAttribute('aria-disabled', String(isAtMinZoom));
    }

    this.syncRulersAndGuidesMenuItems();
  }
}
