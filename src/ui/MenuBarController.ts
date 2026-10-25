import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import type { InputController } from '../input/InputController.ts';
import type { SelectableNode } from '../types/scene-graph.ts';
import type { MenuBarController, MenuBarControllerOptions } from './menubar/types.ts';
import { queryMenuBarElements, createMenuEntries, createSubmenuEntries } from './menubar/menuElements.ts';
import { MenuSyncController } from './menubar/MenuSyncController.ts';
import { MenuNavigationController } from './menubar/MenuNavigationController.ts';
import { MenuItemActionsController } from './menubar/MenuItemActionsController.ts';

export type { MenuBarControllerOptions, MenuBarController };

export function setupMenuBarBindings(
  inputController: InputController,
  commandManager: CommandManager,
  stateManager: StateManager,
  options: MenuBarControllerOptions
): MenuBarController {
  const elements = queryMenuBarElements(options);
  const menuEntries = createMenuEntries(elements);
  const submenuEntries = createSubmenuEntries(elements);

  const sync = new MenuSyncController(
    elements,
    stateManager,
    commandManager,
    inputController,
    options.viewportManager
  );

  const navigation = new MenuNavigationController(
    elements,
    menuEntries,
    submenuEntries,
    options,
    () => sync.syncMenuItems()
  );

  const actions = new MenuItemActionsController(
    elements,
    inputController,
    commandManager,
    stateManager,
    options,
    navigation,
    sync
  );

  return {
    openMenu: navigation.openMenu,
    closeAllMenus: navigation.closeAllMenus,
    syncMenuItems: (selectedNodes?: readonly SelectableNode[]) => sync.syncMenuItems(selectedNodes),
    cleanup: () => {
      navigation.cleanup();
      actions.cleanup();
    },
  };
}
