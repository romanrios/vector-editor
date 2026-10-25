import type { MenuBarControllerOptions, MenuBarElements, MenuEntry, SubmenuEntry } from './types.ts';

export class MenuNavigationController {
  private readonly elements: MenuBarElements;
  private readonly menuEntries: MenuEntry[];
  private readonly submenuEntries: SubmenuEntry[];
  private readonly options: MenuBarControllerOptions;
  private readonly onMenuOpen?: (index: number) => void;

  private activeMenuIndex: number = -1;

  private triggerClickHandlers: (() => void)[] = [];
  private triggerMouseEnterHandlers: (() => void)[] = [];
  private triggerKeyDownHandlers: ((e: KeyboardEvent) => void)[] = [];
  private dropdownKeyDownHandlers: ((e: KeyboardEvent) => void)[] = [];

  private submenuContainerEnterHandlers: Array<{ container: HTMLElement | null; handler: () => void }> = [];
  private submenuContainerLeaveHandlers: Array<{ container: HTMLElement | null; handler: () => void }> = [];
  private submenuTriggerClickHandlers: Array<{ trigger: HTMLButtonElement | null; handler: (e: any) => void }> = [];
  private submenuKeyDownHandlers: ((e: KeyboardEvent) => void)[] = [];

  private boundDocumentClick: (e: MouseEvent) => void;
  private boundDocumentKeyDown: (e: KeyboardEvent) => void;

  constructor(
    elements: MenuBarElements,
    menuEntries: MenuEntry[],
    submenuEntries: SubmenuEntry[],
    options: MenuBarControllerOptions,
    onMenuOpen?: (index: number) => void
  ) {
    this.elements = elements;
    this.menuEntries = menuEntries;
    this.submenuEntries = submenuEntries;
    this.options = options;
    this.onMenuOpen = onMenuOpen;

    this.boundDocumentClick = (e: MouseEvent) => this.onDocumentClick(e);
    this.boundDocumentKeyDown = (e: KeyboardEvent) => this.onDocumentKeyDown(e);

    this.setupEventHandlers();
  }

  public getActiveMenuIndex(): number {
    return this.activeMenuIndex;
  }

  public closeAllSubmenus = (): void => {
    for (let i = 0; i < this.submenuEntries.length; i++) {
      const sub = this.submenuEntries[i];
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

  public openSubmenu = (submenu: SubmenuEntry, focusFirstItem: boolean = false): void => {
    if (!submenu.trigger || submenu.trigger.disabled || submenu.trigger.getAttribute('aria-disabled') === 'true') {
      return;
    }
    this.closeAllSubmenus();
    submenu.trigger.setAttribute('aria-expanded', 'true');
    submenu.trigger.classList?.add('is-open');
    if (submenu.dropdown) {
      submenu.dropdown.hidden = false;
      submenu.dropdown.classList?.add('is-open');
      if (focusFirstItem) {
        const enabled = submenu.items.filter(
          (it): it is HTMLButtonElement =>
            it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabled.length > 0) {
          enabled[0].focus?.();
        }
      }
    }
  };

  public closeAllMenus = (): void => {
    this.activeMenuIndex = -1;
    this.closeAllSubmenus();
    this.options.onCloseContextMenu?.();
    for (const entry of this.menuEntries) {
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

  public openMenu = (index: number, focusFirstItem: boolean = false): void => {
    if (index < 0 || index >= this.menuEntries.length) return;
    const entry = this.menuEntries[index];
    if (!entry.trigger || entry.trigger.disabled || entry.trigger.getAttribute('aria-disabled') === 'true') {
      return;
    }

    this.closeAllMenus();
    this.activeMenuIndex = index;
    this.onMenuOpen?.(index);

    entry.trigger.setAttribute('aria-expanded', 'true');
    entry.trigger.classList?.add('is-open');

    if (entry.dropdown) {
      entry.dropdown.hidden = false;
      entry.dropdown.classList?.add('is-open');

      if (focusFirstItem) {
        const enabledItems = entry.items.filter(
          (it): it is HTMLButtonElement =>
            it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabledItems.length > 0) {
          enabledItems[0].focus?.();
        }
      }
    }
  };

  private setupEventHandlers(): void {
    const { menuEntries, submenuEntries } = this;

    this.triggerClickHandlers = menuEntries.map((_, i) => () => {
      if (this.activeMenuIndex === i) {
        this.closeAllMenus();
      } else {
        this.openMenu(i, false);
      }
    });

    this.triggerMouseEnterHandlers = menuEntries.map((_, i) => () => {
      if (this.activeMenuIndex !== -1 && this.activeMenuIndex !== i) {
        this.openMenu(i, false);
      }
    });

    this.triggerKeyDownHandlers = menuEntries.map((_, index) => (e: KeyboardEvent) => {
      const key = e.key;
      if (key === 'ArrowRight') {
        e.preventDefault?.();
        const nextIndex = (index + 1) % menuEntries.length;
        menuEntries[nextIndex].trigger?.focus?.();
        if (this.activeMenuIndex !== -1) {
          this.openMenu(nextIndex, true);
        }
      } else if (key === 'ArrowLeft') {
        e.preventDefault?.();
        const prevIndex = (index - 1 + menuEntries.length) % menuEntries.length;
        menuEntries[prevIndex].trigger?.focus?.();
        if (this.activeMenuIndex !== -1) {
          this.openMenu(prevIndex, true);
        }
      } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
        e.preventDefault?.();
        this.openMenu(index, true);
      } else if (key === 'ArrowUp') {
        e.preventDefault?.();
        this.openMenu(index, false);
        const enabledItems = menuEntries[index].items.filter(
          (it): it is HTMLButtonElement =>
            it !== null && !it.disabled && it.getAttribute('aria-disabled') !== 'true'
        );
        if (enabledItems.length > 0) {
          enabledItems[enabledItems.length - 1].focus?.();
        }
      } else if (key === 'Escape') {
        if (this.activeMenuIndex !== -1) {
          e.preventDefault?.();
          this.closeAllMenus();
        }
      }
    });

    this.dropdownKeyDownHandlers = menuEntries.map((entry, menuIndex) => (e: KeyboardEvent) => {
      const key = e.key;
      const allItems = entry.items.filter(Boolean) as HTMLButtonElement[];
      const enabledItems = allItems.filter(
        (it) => !it.disabled && it.getAttribute('aria-disabled') !== 'true'
      );
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
        const prevIndex =
          currentEnabledIndex >= 0
            ? (currentEnabledIndex - 1 + enabledItems.length) % enabledItems.length
            : enabledItems.length - 1;
        enabledItems[prevIndex].focus?.();
      } else if (key === 'ArrowRight') {
        const sub = submenuEntries.find((s) => s.trigger === focusedItem);
        if (sub && !sub.trigger?.disabled && sub.trigger?.getAttribute('aria-disabled') !== 'true') {
          e.preventDefault?.();
          this.openSubmenu(sub, true);
          return;
        }
        e.preventDefault?.();
        const nextMenuIndex = (menuIndex + 1) % menuEntries.length;
        menuEntries[nextMenuIndex].trigger?.focus?.();
        this.openMenu(nextMenuIndex, true);
      } else if (key === 'ArrowLeft') {
        e.preventDefault?.();
        const prevMenuIndex = (menuIndex - 1 + menuEntries.length) % menuEntries.length;
        menuEntries[prevMenuIndex].trigger?.focus?.();
        this.openMenu(prevMenuIndex, true);
      } else if (key === 'Escape') {
        e.preventDefault?.();
        this.closeAllMenus();
        entry.trigger?.focus?.();
      } else if (key === 'Tab') {
        this.closeAllMenus();
      } else if (key === 'Enter' || key === ' ') {
        if (focusedItem && allItems.includes(focusedItem)) {
          if (!focusedItem.disabled && focusedItem.getAttribute('aria-disabled') !== 'true') {
            const sub = submenuEntries.find((s) => s.trigger === focusedItem);
            if (sub) {
              e.preventDefault?.();
              this.openSubmenu(sub, true);
              return;
            }
            e.preventDefault?.();
            focusedItem.click();
          }
        }
      }
    });

    menuEntries.forEach((entry, i) => {
      entry.trigger?.addEventListener('click', this.triggerClickHandlers[i]);
      entry.trigger?.addEventListener('mouseenter', this.triggerMouseEnterHandlers[i]);
      entry.trigger?.addEventListener('keydown', this.triggerKeyDownHandlers[i]);
      entry.dropdown?.addEventListener('keydown', this.dropdownKeyDownHandlers[i]);
    });

    // Submenu mouse handlers
    submenuEntries.forEach((sub) => {
      if (sub.trigger) {
        const container = (sub.trigger.closest?.('.menu-submenu-container') ||
          sub.trigger.parentElement) as HTMLElement | null;
        const onEnter = () => {
          if (sub.trigger && !sub.trigger.disabled && sub.trigger.getAttribute('aria-disabled') !== 'true') {
            this.openSubmenu(sub, false);
          }
        };
        const onLeave = () => {
          if (sub.dropdown && !sub.dropdown.hidden) {
            this.closeAllSubmenus();
          }
        };
        container?.addEventListener?.('mouseenter', onEnter);
        container?.addEventListener?.('mouseleave', onLeave);
        this.submenuContainerEnterHandlers.push({ container, handler: onEnter });
        this.submenuContainerLeaveHandlers.push({ container, handler: onLeave });

        const onTriggerClick = (e: any) => {
          e.stopPropagation?.();
          if (!sub.trigger?.disabled && sub.trigger?.getAttribute('aria-disabled') !== 'true') {
            if (sub.dropdown && !sub.dropdown.hidden) {
              this.closeAllSubmenus();
            } else {
              this.openSubmenu(sub, true);
            }
          }
        };
        sub.trigger.addEventListener('click', onTriggerClick);
        this.submenuTriggerClickHandlers.push({ trigger: sub.trigger, handler: onTriggerClick });
      }
    });

    this.submenuKeyDownHandlers = submenuEntries.map((sub) => (e: KeyboardEvent) => {
      const key = e.key;
      const allSubItems = sub.items.filter(Boolean) as HTMLButtonElement[];
      const enabledSubItems = allSubItems.filter(
        (it) => !it.disabled && it.getAttribute('aria-disabled') !== 'true'
      );
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
        const prevIndex =
          currentSubIndex >= 0
            ? (currentSubIndex - 1 + enabledSubItems.length) % enabledSubItems.length
            : enabledSubItems.length - 1;
        enabledSubItems[prevIndex].focus?.();
      } else if (key === 'ArrowLeft' || key === 'Escape') {
        e.preventDefault?.();
        this.closeAllSubmenus();
        sub.trigger?.focus?.();
      } else if (key === 'Tab') {
        this.closeAllMenus();
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
      sub.dropdown?.addEventListener('keydown', this.submenuKeyDownHandlers[i]);
    });

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', this.boundDocumentClick);
      document.addEventListener('keydown', this.boundDocumentKeyDown);
    }
  }

  private onDocumentClick(e: MouseEvent): void {
    const target = e.target as Node | null;
    if (this.activeMenuIndex === -1) return;
    const menuBar = this.elements.menuBar;
    if (menuBar && typeof menuBar.contains === 'function') {
      if (!menuBar.contains(target)) {
        this.closeAllMenus();
      }
    } else {
      let isInside = false;
      for (const entry of this.menuEntries) {
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
        this.closeAllMenus();
      }
    }
  }

  private onDocumentKeyDown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'e') {
      e.preventDefault?.();
      this.closeAllMenus();
      this.options.openExportDialog?.(this.elements.menuBtnFile);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key && e.key.toLowerCase() === 'n') {
      e.preventDefault?.();
      this.closeAllMenus();
      this.options.onNewClick?.();
      return;
    }

    if (e.key === 'Escape' && this.activeMenuIndex !== -1) {
      e.preventDefault?.();
      const trigger = this.menuEntries[this.activeMenuIndex]?.trigger;
      this.closeAllMenus();
      trigger?.focus?.();
    }
  }

  public cleanup(): void {
    this.menuEntries.forEach((entry, i) => {
      entry.trigger?.removeEventListener('click', this.triggerClickHandlers[i]);
      entry.trigger?.removeEventListener('mouseenter', this.triggerMouseEnterHandlers[i]);
      entry.trigger?.removeEventListener('keydown', this.triggerKeyDownHandlers[i]);
      entry.dropdown?.removeEventListener('keydown', this.dropdownKeyDownHandlers[i]);
    });

    this.submenuEntries.forEach((sub, i) => {
      sub.dropdown?.removeEventListener('keydown', this.submenuKeyDownHandlers[i]);
    });

    this.submenuContainerEnterHandlers.forEach(({ container, handler }) => {
      container?.removeEventListener?.('mouseenter', handler);
    });
    this.submenuContainerLeaveHandlers.forEach(({ container, handler }) => {
      container?.removeEventListener?.('mouseleave', handler);
    });
    this.submenuTriggerClickHandlers.forEach(({ trigger, handler }) => {
      trigger?.removeEventListener?.('click', handler);
    });

    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this.boundDocumentClick);
      document.removeEventListener('keydown', this.boundDocumentKeyDown);
    }
  }
}
