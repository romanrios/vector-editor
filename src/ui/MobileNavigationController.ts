/**
 * MobileNavigationController.ts
 *
 * Gestiona la navegación y el comportamiento responsivo en dispositivos móviles:
 * - Cajón lateral de navegación (Mobile Drawer) activado por el botón Hamburguesa.
 * - Cierre y control del Bottom Sheet del panel de propiedades.
 * - Delegación de acciones de los elementos del cajón hacia los botones reales de la barra de menú.
 * - Sincronización de estados deshabilitados (Undo, Redo, Cut, Copy, etc.).
 * - Atajos de teclado (Escape) y backdrops táctiles con desenfoque.
 */

export interface MobileNavigationControllerOptions {
  readonly onDrawerOpen?: () => void;
  readonly onDrawerClose?: () => void;
  readonly onPanelClose?: () => void;
}

export interface MobileNavigationController {
  readonly isDrawerOpen: () => boolean;
  readonly openDrawer: () => void;
  readonly closeDrawer: () => void;
  readonly toggleDrawer: () => void;
  readonly isPanelOpen: () => boolean;
  readonly openPanel: () => void;
  readonly closePanel: () => void;
  readonly togglePanel: () => void;
  readonly syncDrawerItems: () => void;
  readonly cleanup: () => void;
}

export function setupMobileNavigationBindings(
  options: MobileNavigationControllerOptions = {}
): MobileNavigationController {
  const btnHamburger = document.querySelector<HTMLButtonElement>('#btn-hamburger-menu');
  const mobileDrawer = document.querySelector<HTMLElement>('#mobile-menu-drawer');
  const mobileBackdrop = document.querySelector<HTMLElement>('#mobile-menu-backdrop');
  const btnCloseDrawer = document.querySelector<HTMLButtonElement>('#btn-close-drawer');

  const btnTogglePanel = document.querySelector<HTMLButtonElement>('#btn-toggle-panel');
  const panelBackdrop = document.querySelector<HTMLElement>('#panel-backdrop');
  const btnCloseSheet = document.querySelector<HTMLButtonElement>('#btn-close-sheet');

  let closeDrawerTimer: ReturnType<typeof setTimeout> | null = null;

  const isDrawerOpen = (): boolean => {
    return mobileDrawer?.classList.contains('is-open') ?? false;
  };

  const isPanelOpen = (): boolean => {
    return (
      (typeof document !== 'undefined' &&
        document.body &&
        document.body.classList.contains('panel-open')) ??
      false
    );
  };

  const syncDrawerItems = (): void => {
    if (!mobileDrawer) return;
    const items = mobileDrawer.querySelectorAll<HTMLButtonElement>('button[data-trigger]');
    items.forEach((item) => {
      const targetSelector = item.getAttribute('data-trigger');
      if (!targetSelector) return;
      const targetElement = document.querySelector<HTMLElement>(targetSelector);
      if (!targetElement) return;

      const isDisabled =
        (targetElement as HTMLButtonElement).disabled ||
        targetElement.classList.contains('disabled') ||
        targetElement.getAttribute('aria-disabled') === 'true';

      item.disabled = isDisabled;
      item.classList.toggle('disabled', isDisabled);
      item.setAttribute('aria-disabled', String(isDisabled));
    });
  };

  const openDrawer = (): void => {
    if (!mobileDrawer) return;
    if (closeDrawerTimer !== null) {
      clearTimeout(closeDrawerTimer);
      closeDrawerTimer = null;
    }

    mobileDrawer.removeAttribute('hidden');
    mobileBackdrop?.removeAttribute('hidden');

    // Forzar reflujo si está disponible para que la transición CSS se anime
    if ('offsetWidth' in mobileDrawer) {
      void mobileDrawer.offsetWidth;
    }

    mobileDrawer.classList.add('is-open');
    mobileBackdrop?.classList.add('is-open');
    btnHamburger?.setAttribute('aria-expanded', 'true');

    syncDrawerItems();
    btnCloseDrawer?.focus();
    options.onDrawerOpen?.();
  };

  const closeDrawer = (): void => {
    if (!mobileDrawer) return;

    mobileDrawer.classList.remove('is-open');
    mobileBackdrop?.classList.remove('is-open');
    btnHamburger?.setAttribute('aria-expanded', 'false');

    if (closeDrawerTimer !== null) {
      clearTimeout(closeDrawerTimer);
    }

    // Ocultar tras la animación CSS de deslizamiento
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      closeDrawerTimer = setTimeout(() => {
        if (!mobileDrawer.classList.contains('is-open')) {
          mobileDrawer.setAttribute('hidden', '');
          mobileBackdrop?.setAttribute('hidden', '');
        }
        closeDrawerTimer = null;
      }, 280);
    } else {
      mobileDrawer.setAttribute('hidden', '');
      mobileBackdrop?.setAttribute('hidden', '');
    }

    if (
      btnHamburger &&
      typeof document !== 'undefined' &&
      document.activeElement &&
      mobileDrawer.contains(document.activeElement)
    ) {
      btnHamburger.focus();
    }
    options.onDrawerClose?.();
  };

  const toggleDrawer = (): void => {
    if (isDrawerOpen()) {
      closeDrawer();
    } else {
      openDrawer();
    }
  };

  const openPanel = (): void => {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.add('panel-open');
      btnTogglePanel?.setAttribute('aria-expanded', 'true');
      panelBackdrop?.classList.add('is-open');
      panelBackdrop?.removeAttribute('hidden');
    }
  };

  const closePanel = (): void => {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('panel-open');
      btnTogglePanel?.setAttribute('aria-expanded', 'false');
      panelBackdrop?.classList.remove('is-open');
      panelBackdrop?.setAttribute('hidden', '');
      options.onPanelClose?.();
    }
  };

  const togglePanel = (): void => {
    if (isPanelOpen()) {
      closePanel();
    } else {
      openPanel();
    }
  };

  // 1. Eventos del Drawer
  const onHamburgerClick = (e: MouseEvent): void => {
    e.stopPropagation();
    toggleDrawer();
  };

  const onCloseDrawerClick = (e: MouseEvent): void => {
    e.stopPropagation();
    closeDrawer();
  };

  const onBackdropClick = (e: MouseEvent): void => {
    e.stopPropagation();
    closeDrawer();
  };

  // 2. Delegación de clic en elementos del Drawer
  const onDrawerClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('button[data-trigger]');
    if (!button) return;

    const targetSelector = button.getAttribute('data-trigger');
    if (!targetSelector) return;

    const targetElement = document.querySelector<HTMLElement>(targetSelector);
    if (!targetElement) return;

    const isDisabled =
      (targetElement as HTMLButtonElement).disabled ||
      targetElement.classList.contains('disabled') ||
      targetElement.getAttribute('aria-disabled') === 'true';

    if (isDisabled) return;

    closeDrawer();
    targetElement.click();
  };

  // 3. Eventos del Bottom Sheet (Panel de Propiedades)
  const onCloseSheetClick = (e: MouseEvent): void => {
    e.stopPropagation();
    closePanel();
  };

  const onPanelBackdropClick = (e: MouseEvent): void => {
    e.stopPropagation();
    closePanel();
  };

  // 4. Tecla Escape
  const onDocumentKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (isDrawerOpen()) {
        e.preventDefault();
        closeDrawer();
      } else if (isPanelOpen()) {
        e.preventDefault();
        closePanel();
      }
    }
  };

  btnHamburger?.addEventListener('click', onHamburgerClick);
  btnCloseDrawer?.addEventListener('click', onCloseDrawerClick);
  mobileBackdrop?.addEventListener('click', onBackdropClick);
  mobileDrawer?.addEventListener('click', onDrawerClick);

  btnCloseSheet?.addEventListener('click', onCloseSheetClick);
  panelBackdrop?.addEventListener('click', onPanelBackdropClick);

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  return {
    isDrawerOpen,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    isPanelOpen,
    openPanel,
    closePanel,
    togglePanel,
    syncDrawerItems,
    cleanup: () => {
      if (closeDrawerTimer !== null) {
        clearTimeout(closeDrawerTimer);
        closeDrawerTimer = null;
      }
      btnHamburger?.removeEventListener('click', onHamburgerClick);
      btnCloseDrawer?.removeEventListener('click', onCloseDrawerClick);
      mobileBackdrop?.removeEventListener('click', onBackdropClick);
      mobileDrawer?.removeEventListener('click', onDrawerClick);

      btnCloseSheet?.removeEventListener('click', onCloseSheetClick);
      panelBackdrop?.removeEventListener('click', onPanelBackdropClick);

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('keydown', onDocumentKeyDown);
      }
    },
  };
}
