import type { StateManager } from '../state/StateManager.ts';
import type { ViewportManager } from '../utils/viewport.ts';

export interface CanvasResizeControllerOptions {
  readonly stateManager: StateManager;
  readonly viewportManager: ViewportManager;
  readonly canvas: HTMLCanvasElement | null;
}

export interface CanvasResizeController {
  readonly cleanup: () => void;
}

export function setupCanvasResizeObserver(options: CanvasResizeControllerOptions): CanvasResizeController {
  const { stateManager, viewportManager, canvas } = options;

  const canvasContainer = document.querySelector<HTMLElement>('#canvas-container, .canvas-viewport') ?? canvas;
  let resizeObserver: ResizeObserver | null = null;

  if (typeof ResizeObserver !== 'undefined' && canvasContainer) {
    resizeObserver = new ResizeObserver(() => {
      if (canvas) {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const rect = canvas.getBoundingClientRect();
        const prevCssWidth = canvas.width / dpr;
        const prevCssHeight = canvas.height / dpr;

        const newCssWidth = Math.max(1, Math.floor(rect.width || (typeof window !== 'undefined' ? window.innerWidth : 800)));
        const newCssHeight = Math.max(1, Math.floor(rect.height || (typeof window !== 'undefined' ? window.innerHeight : 600)));
        const width = Math.max(1, Math.floor(newCssWidth * dpr));
        const height = Math.max(1, Math.floor(newCssHeight * dpr));

        if (canvas.width !== width || canvas.height !== height) {
          if (prevCssWidth > 0 && prevCssHeight > 0 && (newCssWidth !== prevCssWidth || newCssHeight !== prevCssHeight)) {
            const oldCenterWorld = viewportManager.screenToWorld({
              x: prevCssWidth / 2,
              y: prevCssHeight / 2,
            });
            const newCenterScreen = {
              x: newCssWidth / 2,
              y: newCssHeight / 2,
            };
            const newPanX = newCenterScreen.x - oldCenterWorld.x * viewportManager.zoom;
            const newPanY = newCenterScreen.y - oldCenterWorld.y * viewportManager.zoom;
            viewportManager.setViewport({
              zoom: viewportManager.zoom,
              panX: newPanX,
              panY: newPanY,
            });
          }

          canvas.width = width;
          canvas.height = height;
        }
      }
      stateManager.markDirty();
    });
    resizeObserver.observe(canvasContainer);
  }

  return {
    cleanup: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
  };
}
