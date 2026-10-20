import type { StateManager } from '../state/StateManager.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import type { ViewportManager } from '../utils/viewport.ts';
import type { InputController, ToolMode } from '../input/InputController.ts';
import {
  isGroup,
  isSelectable,
  type SelectableNode,
} from '../types/scene-graph.ts';

export interface StatusBarControllerOptions {
  readonly stateManager: StateManager;
  readonly viewportManager: ViewportManager;
  readonly inputController: InputController;
  readonly canvas: HTMLCanvasElement | null;
  readonly onBeforeOpenZoomMenu?: () => void;
  readonly onZoomChanged?: () => void;
}

export interface StatusBarController {
  readonly syncStatusBar: (selectedNodes?: readonly SelectableNode[]) => void;
  readonly syncToolLabel: (tool: ToolMode) => void;
  readonly updateZoomIndicator: (zoom: number) => void;
  readonly closeZoomMenu: () => void;
  readonly cleanup: () => void;
}

export function setupStatusBarBindings(options: StatusBarControllerOptions): StatusBarController {
  const { stateManager, viewportManager, inputController, canvas, onBeforeOpenZoomMenu, onZoomChanged } = options;

  const statusToolLabel = document.querySelector<HTMLElement>('#status-tool-label');
  const statusShapesCount = document.querySelector<HTMLElement>('#status-shapes-count');
  const statusSelectionInfo = document.querySelector<HTMLElement>('#status-selection-info');
  const statusSelectionSeparator = document.querySelector<HTMLElement>('#status-selection-separator');

  const statusZoomBtn = document.querySelector<HTMLButtonElement>('#status-zoom-btn');
  const statusZoomLabel = document.querySelector<HTMLElement>('#status-zoom-label');
  const zoomDropdown = document.querySelector<HTMLElement>('#zoom-dropdown');
  const zoomPresetItems = (typeof document.querySelectorAll === 'function'
    ? Array.from(document.querySelectorAll<HTMLButtonElement>('.zoom-dropdown-item'))
    : []) as HTMLButtonElement[];

  const syncToolLabel = (tool: ToolMode) => {
    if (statusToolLabel) {
      statusToolLabel.textContent = `Modo: ${
        tool === 'pen'
          ? 'Pluma (Bézier)'
          : tool === 'pencil'
            ? 'Lápiz (Mano alzada)'
            : tool === 'eyedropper'
              ? 'Cuentagotas (Muestreo)'
              : tool === 'direct-select'
                ? 'Selección Directa'
                : tool === 'rectangle'
                  ? 'Rectángulo'
                  : tool === 'ellipse'
                    ? 'Elipse'
                    : tool === 'polygon'
                      ? 'Polígono regular'
                      : tool === 'star'
                        ? 'Estrella'
                        : tool === 'line'
                          ? 'Línea'
                          : tool === 'text'
                            ? 'Texto'
                            : tool === 'hand'
                              ? 'Mano'
                              : 'Selección'
      }`;
    }
  };

  const syncStatusBar = (selectedNodes: readonly SelectableNode[] = stateManager.getSelectedNodes()) => {
    if (statusShapesCount) {
      const doc = stateManager.getState();
      let count = 0;
      if (doc && doc.children) {
        for (const layer of doc.children) {
          count += getLeafShapes(layer.children.filter(isSelectable)).length;
        }
      }
      statusShapesCount.textContent = count === 1 ? '1 figura' : `${count} figuras`;
    }

    if (statusSelectionInfo) {
      if (selectedNodes.length === 1) {
        const node = selectedNodes[0];
        if (isGroup(node)) {
          const directCount = node.children.length;
          const countLabel = directCount === 1 ? '1 elemento' : `${directCount} elementos`;
          statusSelectionInfo.textContent = `${node.name} (${countLabel})`;
        } else {
          const typeLabels: Record<string, string> = {
            rectangle: 'Rectángulo',
            ellipse: 'Elipse',
            polygon: 'Polígono',
            star: 'Estrella',
            image: 'Imagen',
            path: 'Trazado',
            text: 'Texto',
          };
          const typeName = typeLabels[node.type] || node.type;
          statusSelectionInfo.textContent = `${node.name} (${typeName})`;
        }
        if (statusSelectionInfo.style) {
          statusSelectionInfo.style.display = 'inline';
        }
        if (statusSelectionSeparator && statusSelectionSeparator.style) {
          statusSelectionSeparator.style.display = 'inline';
        }
      } else if (selectedNodes.length > 1) {
        const hasGroup = selectedNodes.some(isGroup);
        statusSelectionInfo.textContent = hasGroup
          ? `${selectedNodes.length} elementos seleccionados`
          : `${selectedNodes.length} figuras seleccionadas`;
        if (statusSelectionInfo.style) {
          statusSelectionInfo.style.display = 'inline';
        }
        if (statusSelectionSeparator && statusSelectionSeparator.style) {
          statusSelectionSeparator.style.display = 'inline';
        }
      } else {
        statusSelectionInfo.textContent = '';
        if (statusSelectionInfo.style) {
          statusSelectionInfo.style.display = 'none';
        }
        if (statusSelectionSeparator && statusSelectionSeparator.style) {
          statusSelectionSeparator.style.display = 'none';
        }
      }
    }
  };

  const updateZoomIndicator = (zoom: number) => {
    if (statusZoomLabel) {
      statusZoomLabel.textContent = `${Math.round(zoom * 100)} %`;
    }
  };

  updateZoomIndicator(viewportManager.zoom);

  const unsubscribeViewport = viewportManager.subscribe((vp) => {
    updateZoomIndicator(vp.zoom);
    onZoomChanged?.();
  });

  let isZoomMenuOpen = false;

  const openZoomMenu = () => {
    if (!zoomDropdown || !statusZoomBtn) return;
    isZoomMenuOpen = true;
    zoomDropdown.hidden = false;
    statusZoomBtn.setAttribute('aria-expanded', 'true');
    statusZoomBtn.classList.add('is-open');
  };

  const closeZoomMenu = () => {
    if (!zoomDropdown || !statusZoomBtn) return;
    isZoomMenuOpen = false;
    zoomDropdown.hidden = true;
    statusZoomBtn.setAttribute('aria-expanded', 'false');
    statusZoomBtn.classList.remove('is-open');
  };

  const onZoomBtnClick = (e: MouseEvent) => {
    e.stopPropagation?.();
    if (isZoomMenuOpen) {
      closeZoomMenu();
    } else {
      onBeforeOpenZoomMenu?.();
      openZoomMenu();
    }
  };

  const onZoomBtnKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault?.();
      openZoomMenu();
      const firstItem = typeof zoomDropdown?.querySelector === 'function'
        ? zoomDropdown.querySelector<HTMLButtonElement>('.zoom-dropdown-item')
        : null;
      firstItem?.focus?.();
    } else if (e.key === 'Escape') {
      if (isZoomMenuOpen) {
        e.preventDefault?.();
        closeZoomMenu();
      }
    }
  };

  statusZoomBtn?.addEventListener('click', onZoomBtnClick);
  statusZoomBtn?.addEventListener('keydown', onZoomBtnKeyDown);

  const onPresetClick = (e: MouseEvent) => {
    const target = e.currentTarget as HTMLButtonElement;
    const preset = target.getAttribute('data-preset');
    closeZoomMenu();

    if (preset === 'fit') {
      inputController.zoomFit();
    } else if (preset) {
      const targetZoom = parseFloat(preset);
      if (!isNaN(targetZoom)) {
        const center = inputController.getCanvasCenter();
        const currentZoom = viewportManager.zoom;
        const factor = targetZoom / currentZoom;
        viewportManager.zoomAt(center, factor);
      }
    }
    canvas?.focus?.();
  };

  const presetElements = Array.from(zoomPresetItems);
  presetElements.forEach((item) => {
    item.addEventListener('click', onPresetClick);
  });

  const onZoomDropdownKeyDown = (e: KeyboardEvent) => {
    const key = e.key;
    const items = Array.from(zoomPresetItems).filter((it) => !it.disabled);
    const focused = typeof document !== 'undefined' ? (document.activeElement as HTMLButtonElement) : null;
    const idx = focused ? items.indexOf(focused) : -1;

    if (key === 'ArrowDown') {
      e.preventDefault?.();
      if (items.length === 0) return;
      const next = idx >= 0 ? (idx + 1) % items.length : 0;
      items[next].focus?.();
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      if (items.length === 0) return;
      const prev = idx >= 0 ? (idx - 1 + items.length) % items.length : items.length - 1;
      items[prev].focus?.();
    } else if (key === 'Escape') {
      e.preventDefault?.();
      closeZoomMenu();
      statusZoomBtn?.focus?.();
    } else if (key === 'Tab') {
      closeZoomMenu();
    }
  };

  zoomDropdown?.addEventListener('keydown', onZoomDropdownKeyDown);

  const onDocumentClick = (e: MouseEvent) => {
    if (isZoomMenuOpen) {
      const target = e.target as Node | null;
      const isInsideZoom = (statusZoomBtn && (statusZoomBtn === target || (typeof statusZoomBtn.contains === 'function' && statusZoomBtn.contains(target)))) ||
                           (zoomDropdown && (zoomDropdown === target || (typeof zoomDropdown.contains === 'function' && zoomDropdown.contains(target))));
      if (!isInsideZoom) {
        closeZoomMenu();
      }
    }
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isZoomMenuOpen) {
      e.preventDefault?.();
      closeZoomMenu();
      statusZoomBtn?.focus?.();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  // Inicializar estado
  syncToolLabel(inputController.currentTool);
  syncStatusBar();

  return {
    syncStatusBar,
    syncToolLabel,
    updateZoomIndicator,
    closeZoomMenu,
    cleanup: () => {
      unsubscribeViewport();
      statusZoomBtn?.removeEventListener('click', onZoomBtnClick);
      statusZoomBtn?.removeEventListener('keydown', onZoomBtnKeyDown);
      presetElements.forEach((item) => {
        item.removeEventListener('click', onPresetClick);
      });
      zoomDropdown?.removeEventListener('keydown', onZoomDropdownKeyDown);

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeyDown);
      }
    },
  };
}
