import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import type { ViewportManager } from '../utils/viewport.ts';
import type { Guide } from '../types/scene-graph.ts';
import { AddGuideCommand } from '../commands/AddGuideCommand.ts';

/**
 * Calcula un paso de escala agradable (1, 2, 5 * 10^k) para graduar las reglas.
 */
export function getNiceRulerStep(targetWorldDist: number): number {
  if (targetWorldDist <= 0 || !Number.isFinite(targetWorldDist)) return 100;
  const power = Math.pow(10, Math.floor(Math.log10(targetWorldDist)));
  const fraction = targetWorldDist / power;
  if (fraction < 1.5) return 1 * power;
  if (fraction < 3.5) return 2 * power;
  if (fraction < 7.5) return 5 * power;
  return 10 * power;
}

/**
 * Calcula la cantidad de subdivisiones recomendadas para un paso dado.
 */
export function getRulerSubdivisions(step: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(step)));
  const fraction = Math.round(step / power);
  if (fraction === 1) return 10;
  if (fraction === 2) return 4;
  if (fraction === 5) return 5;
  return 10;
}

export interface RulersControllerOptions {
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly viewportManager: ViewportManager;
  readonly container?: HTMLElement | null;
  readonly canvasContainer?: HTMLElement | null;
  readonly horizontalRulerCanvas?: HTMLCanvasElement | null;
  readonly rulerHorizontal?: HTMLCanvasElement | null;
  readonly verticalRulerCanvas?: HTMLCanvasElement | null;
  readonly rulerVertical?: HTMLCanvasElement | null;
  readonly cornerElement?: HTMLElement | null;
  readonly rulerCorner?: HTMLElement | null;
  readonly onGuideDragChange?: (guide: Guide | null) => void;
}

export interface RulersController {
  render(): void;
  syncVisibility(): void;
  cleanup(): void;
  readonly activeDragGuide: Guide | null;
}

export function setupRulersController(options: RulersControllerOptions): RulersController {
  const {
    stateManager,
    commandManager,
    viewportManager,
    onGuideDragChange,
  } = options;
  const container = options.container ?? options.canvasContainer ?? null;
  const horizontalRulerCanvas = options.horizontalRulerCanvas ?? options.rulerHorizontal ?? null;
  const verticalRulerCanvas = options.verticalRulerCanvas ?? options.rulerVertical ?? null;
  const cornerElement = options.cornerElement ?? options.rulerCorner ?? null;

  let activeDragGuide: Guide | null = null;
  let cursorScreenPos: { x: number; y: number } | null = null;

  const RULER_THICKNESS = 20;

  function syncVisibility(): void {
    if (!container) return;
    const visible = stateManager.isRulersVisible();
    if (visible) {
      container.classList?.remove?.('hide-rulers');
    } else {
      container.classList?.add?.('hide-rulers');
    }
  }

  function getDpr(): number {
    return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  }

  function resizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
    const dpr = getDpr();
    const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
  }

  function renderHorizontal(): void {
    if (!horizontalRulerCanvas || !stateManager.isRulersVisible()) return;
    const ctx = horizontalRulerCanvas.getContext('2d');
    if (!ctx) return;

    const rect = typeof horizontalRulerCanvas.getBoundingClientRect === 'function' ? horizontalRulerCanvas.getBoundingClientRect() : null;
    const cssWidth = Math.max(1, rect?.width || horizontalRulerCanvas.clientWidth || 800);
    const cssHeight = RULER_THICKNESS;
    resizeCanvas(horizontalRulerCanvas, cssWidth, cssHeight);

    const dpr = getDpr();
    const vp = viewportManager.getViewport();
    const zoom = vp.zoom;
    const panX = vp.panX;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fondo y borde
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cssHeight - 0.5);
    ctx.lineTo(cssWidth, cssHeight - 0.5);
    ctx.stroke();

    // Cálculo de paso adaptativo
    const targetWorldDist = 60 / zoom;
    const step = getNiceRulerStep(targetWorldDist);
    const subdivisions = getRulerSubdivisions(step);
    const subStep = step / subdivisions;

    const minWorldX = (RULER_THICKNESS - panX) / zoom;
    const maxWorldX = (cssWidth - panX) / zoom;

    const firstStepIndex = Math.floor(minWorldX / step);
    const lastStepIndex = Math.ceil(maxWorldX / step);

    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a1a1aa';
    ctx.strokeStyle = '#3f3f46';

    // Graduaciones intermedias (subticks)
    ctx.beginPath();
    const firstSubIndex = Math.floor(minWorldX / subStep);
    const lastSubIndex = Math.ceil(maxWorldX / subStep);
    for (let s = firstSubIndex; s <= lastSubIndex; s++) {
      const worldX = s * subStep;
      const screenX = Math.round(worldX * zoom + panX) + 0.5;
      if (screenX < RULER_THICKNESS || screenX > cssWidth) continue;
      const isMid = s % subdivisions === Math.floor(subdivisions / 2);
      const tickH = isMid ? 6 : 3;
      ctx.moveTo(screenX, cssHeight - tickH);
      ctx.lineTo(screenX, cssHeight);
    }
    ctx.stroke();

    // Graduaciones principales con números
    ctx.beginPath();
    ctx.strokeStyle = '#52525b';
    for (let i = firstStepIndex; i <= lastStepIndex; i++) {
      const worldX = i * step;
      const screenX = Math.round(worldX * zoom + panX) + 0.5;
      if (screenX < RULER_THICKNESS || screenX > cssWidth) continue;

      ctx.moveTo(screenX, cssHeight - 8);
      ctx.lineTo(screenX, cssHeight);

      // Texto de la graduación
      const label = worldX === 0 ? '0' : String(Math.round(worldX));
      ctx.fillText(label, screenX + 2, 7);
    }
    ctx.stroke();

    // Resaltado del cursor
    if (cursorScreenPos && cursorScreenPos.x >= RULER_THICKNESS && cursorScreenPos.x <= cssWidth) {
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(cursorScreenPos.x - 0.5, 0, 1.5, cssHeight);
    }

    ctx.restore();
  }

  function renderVertical(): void {
    if (!verticalRulerCanvas || !stateManager.isRulersVisible()) return;
    const ctx = verticalRulerCanvas.getContext('2d');
    if (!ctx) return;

    const rect = typeof verticalRulerCanvas.getBoundingClientRect === 'function' ? verticalRulerCanvas.getBoundingClientRect() : null;
    const cssWidth = RULER_THICKNESS;
    const cssHeight = Math.max(1, rect?.height || verticalRulerCanvas.clientHeight || 600);
    resizeCanvas(verticalRulerCanvas, cssWidth, cssHeight);

    const dpr = getDpr();
    const vp = viewportManager.getViewport();
    const zoom = vp.zoom;
    const panY = vp.panY;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fondo y borde
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cssWidth - 0.5, 0);
    ctx.lineTo(cssWidth - 0.5, cssHeight);
    ctx.stroke();

    // Cálculo de paso adaptativo
    const targetWorldDist = 60 / zoom;
    const step = getNiceRulerStep(targetWorldDist);
    const subdivisions = getRulerSubdivisions(step);
    const subStep = step / subdivisions;

    const minWorldY = (RULER_THICKNESS - panY) / zoom;
    const maxWorldY = (cssHeight - panY) / zoom;

    const firstStepIndex = Math.floor(minWorldY / step);
    const lastStepIndex = Math.ceil(maxWorldY / step);

    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a1a1aa';
    ctx.strokeStyle = '#3f3f46';

    // Graduaciones intermedias (subticks)
    ctx.beginPath();
    const firstSubIndex = Math.floor(minWorldY / subStep);
    const lastSubIndex = Math.ceil(maxWorldY / subStep);
    for (let s = firstSubIndex; s <= lastSubIndex; s++) {
      const worldY = s * subStep;
      const screenY = Math.round(worldY * zoom + panY) + 0.5;
      if (screenY < RULER_THICKNESS || screenY > cssHeight) continue;
      const isMid = s % subdivisions === Math.floor(subdivisions / 2);
      const tickW = isMid ? 6 : 3;
      ctx.moveTo(cssWidth - tickW, screenY);
      ctx.lineTo(cssWidth, screenY);
    }
    ctx.stroke();

    // Graduaciones principales con números
    ctx.beginPath();
    ctx.strokeStyle = '#52525b';
    for (let i = firstStepIndex; i <= lastStepIndex; i++) {
      const worldY = i * step;
      const screenY = Math.round(worldY * zoom + panY) + 0.5;
      if (screenY < RULER_THICKNESS || screenY > cssHeight) continue;

      ctx.moveTo(cssWidth - 8, screenY);
      ctx.lineTo(cssWidth, screenY);

      // Texto de la graduación rotado -90°
      const label = worldY === 0 ? '0' : String(Math.round(worldY));
      ctx.save();
      ctx.translate(cssWidth - 9, screenY - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.stroke();

    // Resaltado del cursor
    if (cursorScreenPos && cursorScreenPos.y >= RULER_THICKNESS && cursorScreenPos.y <= cssHeight) {
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(0, cursorScreenPos.y - 0.5, cssWidth, 1.5);
    }

    ctx.restore();
  }

  function render(): void {
    renderHorizontal();
    renderVertical();
  }

  // --- Manejadores de Eventos del Ratón ---

  const onContainerMouseMove = (e: MouseEvent) => {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    cursorScreenPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    render();
  };

  const onContainerMouseLeave = () => {
    cursorScreenPos = null;
    render();
  };

  const onHorizontalMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    if (!container) return;

    if (!stateManager.isGuidesVisible()) {
      stateManager.setGuidesVisible(true);
    }

    const rect = container.getBoundingClientRect();
    const startY = e.clientY - rect.top;
    const guideId = 'guide-' + Math.random().toString(36).substring(2, 9);

    const vp = viewportManager.getViewport();
    const worldY = Math.round((startY - vp.panY) / vp.zoom);
    activeDragGuide = { id: guideId, axis: 'y', position: worldY };
    cursorScreenPos = { x: e.clientX - rect.left, y: startY };
    render();
    onGuideDragChange?.(activeDragGuide);
    stateManager.markDirty();

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'row-resize';
    }

    const onWindowMove = (we: MouseEvent) => {
      const currentVp = viewportManager.getViewport();
      const currY = we.clientY - rect.top;
      const currWorldY = Math.round((currY - currentVp.panY) / currentVp.zoom);
      activeDragGuide = { id: guideId, axis: 'y', position: currWorldY };
      cursorScreenPos = { x: we.clientX - rect.left, y: currY };
      render();
      onGuideDragChange?.(activeDragGuide);
      stateManager.markDirty();
    };

    const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any) : null);

    const onWindowUp = (we: MouseEvent) => {
      win?.removeEventListener?.('mousemove', onWindowMove);
      win?.removeEventListener?.('mouseup', onWindowUp);

      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
      }

      const currentVp = viewportManager.getViewport();
      const endY = we.clientY - rect.top;
      const finalWorldY = Math.round((endY - currentVp.panY) / currentVp.zoom);
      activeDragGuide = null;
      cursorScreenPos = null;
      render();
      onGuideDragChange?.(null);

      // Si se soltó dentro del área del lienzo (> 20px)
      if (endY > RULER_THICKNESS) {
        const newGuide: Guide = { id: guideId, axis: 'y', position: finalWorldY };
        const cmd = new AddGuideCommand(stateManager, newGuide);
        commandManager.executeCommand(cmd);
      } else {
        stateManager.markDirty();
      }
    };

    win?.addEventListener?.('mousemove', onWindowMove);
    win?.addEventListener?.('mouseup', onWindowUp);
  };

  const onHorizontalDblClick = (e: MouseEvent) => {
    if (!container) return;
    if (!stateManager.isGuidesVisible()) {
      stateManager.setGuidesVisible(true);
    }
    const rect = container.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const vp = viewportManager.getViewport();
    const worldY = Math.round((clickY - vp.panY) / vp.zoom);
    const guideId = 'guide-' + Math.random().toString(36).substring(2, 9);
    const newGuide: Guide = { id: guideId, axis: 'y', position: worldY };
    commandManager.executeCommand(new AddGuideCommand(stateManager, newGuide));
  };

  const onVerticalMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    if (!container) return;

    if (!stateManager.isGuidesVisible()) {
      stateManager.setGuidesVisible(true);
    }

    const rect = container.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const guideId = 'guide-' + Math.random().toString(36).substring(2, 9);

    const vp = viewportManager.getViewport();
    const worldX = Math.round((startX - vp.panX) / vp.zoom);
    activeDragGuide = { id: guideId, axis: 'x', position: worldX };
    cursorScreenPos = { x: startX, y: e.clientY - rect.top };
    render();
    onGuideDragChange?.(activeDragGuide);
    stateManager.markDirty();

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
    }

    const onWindowMove = (we: MouseEvent) => {
      const currentVp = viewportManager.getViewport();
      const currX = we.clientX - rect.left;
      const currWorldX = Math.round((currX - currentVp.panX) / currentVp.zoom);
      activeDragGuide = { id: guideId, axis: 'x', position: currWorldX };
      cursorScreenPos = { x: currX, y: we.clientY - rect.top };
      render();
      onGuideDragChange?.(activeDragGuide);
      stateManager.markDirty();
    };

    const winV = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any) : null);

    const onWindowUp = (we: MouseEvent) => {
      winV?.removeEventListener?.('mousemove', onWindowMove);
      winV?.removeEventListener?.('mouseup', onWindowUp);

      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
      }

      const currentVp = viewportManager.getViewport();
      const endX = we.clientX - rect.left;
      const finalWorldX = Math.round((endX - currentVp.panX) / currentVp.zoom);
      activeDragGuide = null;
      cursorScreenPos = null;
      render();
      onGuideDragChange?.(null);

      // Si se soltó dentro del área del lienzo (> 20px)
      if (endX > RULER_THICKNESS) {
        const newGuide: Guide = { id: guideId, axis: 'x', position: finalWorldX };
        const cmd = new AddGuideCommand(stateManager, newGuide);
        commandManager.executeCommand(cmd);
      } else {
        stateManager.markDirty();
      }
    };

    winV?.addEventListener?.('mousemove', onWindowMove);
    winV?.addEventListener?.('mouseup', onWindowUp);
  };

  const onVerticalDblClick = (e: MouseEvent) => {
    if (!container) return;
    if (!stateManager.isGuidesVisible()) {
      stateManager.setGuidesVisible(true);
    }
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const vp = viewportManager.getViewport();
    const worldX = Math.round((clickX - vp.panX) / vp.zoom);
    const guideId = 'guide-' + Math.random().toString(36).substring(2, 9);
    const newGuide: Guide = { id: guideId, axis: 'x', position: worldX };
    commandManager.executeCommand(new AddGuideCommand(stateManager, newGuide));
  };

  const onCornerClick = () => {
    // Al hacer clic en la esquina de origen, restablece zoom o pan al origen
    viewportManager.resetZoom({ x: RULER_THICKNESS, y: RULER_THICKNESS });
  };

  // Suscripciones
  if (container && typeof container.addEventListener === 'function') {
    container.addEventListener('mousemove', onContainerMouseMove);
    container.addEventListener('mouseleave', onContainerMouseLeave);
  }

  if (horizontalRulerCanvas && typeof horizontalRulerCanvas.addEventListener === 'function') {
    horizontalRulerCanvas.addEventListener('mousedown', onHorizontalMouseDown);
    horizontalRulerCanvas.addEventListener('dblclick', onHorizontalDblClick);
  }

  if (verticalRulerCanvas && typeof verticalRulerCanvas.addEventListener === 'function') {
    verticalRulerCanvas.addEventListener('mousedown', onVerticalMouseDown);
    verticalRulerCanvas.addEventListener('dblclick', onVerticalDblClick);
  }

  if (cornerElement && typeof cornerElement.addEventListener === 'function') {
    cornerElement.addEventListener('click', onCornerClick);
  }

  const unsubscribeViewport = viewportManager.subscribe(() => {
    render();
  });

  const unsubscribeState = stateManager.subscribe(() => {
    syncVisibility();
    render();
  });

  syncVisibility();
  render();

  return {
    render,
    syncVisibility,
    get activeDragGuide() {
      return activeDragGuide;
    },
    cleanup: () => {
      unsubscribeViewport();
      unsubscribeState();
      if (container && typeof container.removeEventListener === 'function') {
        container.removeEventListener('mousemove', onContainerMouseMove);
        container.removeEventListener('mouseleave', onContainerMouseLeave);
      }
      if (horizontalRulerCanvas && typeof horizontalRulerCanvas.removeEventListener === 'function') {
        horizontalRulerCanvas.removeEventListener('mousedown', onHorizontalMouseDown);
        horizontalRulerCanvas.removeEventListener('dblclick', onHorizontalDblClick);
      }
      if (verticalRulerCanvas && typeof verticalRulerCanvas.removeEventListener === 'function') {
        verticalRulerCanvas.removeEventListener('mousedown', onVerticalMouseDown);
        verticalRulerCanvas.removeEventListener('dblclick', onVerticalDblClick);
      }
      if (cornerElement && typeof cornerElement.removeEventListener === 'function') {
        cornerElement.removeEventListener('click', onCornerClick);
      }
    },
  };
}
