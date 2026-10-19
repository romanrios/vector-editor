import type { StateManager } from '../state/StateManager.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import {
  type Gradient,
  type GradientStop,
  type FillType,
  type Shape,
} from '../types/scene-graph.ts';
import type { PaintState } from '../utils/color.ts';
import { parseHexColor } from '../utils/color.ts';
import {
  createDefaultLinearGradient,
  createDefaultRadialGradient,
  interpolateGradientColor,
  colorWithOpacity,
} from '../utils/gradient.ts';
import { toValidHexColor } from './uiUtils.ts';

export interface GradientEditorCallbacks {
  readonly getCurrentPaintState: (property: 'fill' | 'stroke', shapes: readonly Shape[]) => PaintState;
  readonly commitColor: (property: 'fill' | 'stroke', color: FillType) => void;
  readonly previewColor: (property: 'fill' | 'stroke', color: FillType) => void;
  readonly captureInitialStyle: () => void;
  readonly syncPropertiesPanel: () => void;
  readonly getLastRememberedFill: () => string;
}

export interface GradientEditorController {
  readonly renderGradientControls: (fillState: PaintState) => void;
  readonly getActiveStopId: () => string | null;
  readonly setActiveStopId: (id: string | null) => void;
  readonly cleanup: () => void;
}

export function setupGradientEditor(
  stateManager: StateManager,
  callbacks: GradientEditorCallbacks
): GradientEditorController {
  const {
    getCurrentPaintState,
    commitColor,
    previewColor,
    captureInitialStyle,
    syncPropertiesPanel,
    getLastRememberedFill,
  } = callbacks;

  const selectFillMode = document.querySelector<HTMLSelectElement>('#select-fill-mode');
  const fillSolidControls = document.querySelector<HTMLElement>('#fill-solid-controls');
  const fillGradientControls = document.querySelector<HTMLElement>('#fill-gradient-controls');
  const gradientTrack = document.querySelector<HTMLElement>('#gradient-track');
  const gradientTrackFill = document.querySelector<HTMLElement>('#gradient-track-fill');
  const gradientStopsContainer = document.querySelector<HTMLElement>('#gradient-stops-container');

  const swatchStopPreview = document.querySelector<HTMLElement>('#swatch-stop-preview');
  const inputStopColor = document.querySelector<HTMLInputElement>('#input-stop-color');
  const inputStopHex = document.querySelector<HTMLInputElement>('#input-stop-hex');
  const inputStopOffset = document.querySelector<HTMLInputElement>('#input-stop-offset');
  const inputStopOpacity = document.querySelector<HTMLInputElement>('#input-stop-opacity');
  const btnGradientFlip = document.querySelector<HTMLButtonElement>('#btn-gradient-flip');
  const btnDeleteStop = document.querySelector<HTMLButtonElement>('#btn-delete-stop');

  let activeStopId: string | null = null;
  let isDraggingStopMarker = false;

  const onFillModeChange = () => {
    if (!selectFillMode) return;
    const mode = selectFillMode.value;
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const currentPaint = getCurrentPaintState('fill', leafShapes);
    const lastRememberedFill = getLastRememberedFill();

    if (mode === 'none') {
      commitColor('fill', 'none');
      syncPropertiesPanel();
      return;
    }

    if (mode === 'solid') {
      const color = currentPaint.kind === 'gradient'
        ? currentPaint.gradient.stops[0]?.color ?? lastRememberedFill
        : lastRememberedFill;
      commitColor('fill', color);
      syncPropertiesPanel();
      return;
    }

    if (mode === 'linear') {
      let grad: Gradient;
      if (currentPaint.kind === 'gradient') {
        grad = {
          type: 'linear',
          x1: 0,
          y1: 0.5,
          x2: 1,
          y2: 0.5,
          stops: currentPaint.gradient.stops,
        };
      } else {
        const baseColor = currentPaint.kind === 'color' ? currentPaint.hex : lastRememberedFill;
        grad = createDefaultLinearGradient(baseColor, '#ffffff');
      }
      commitColor('fill', grad);
      syncPropertiesPanel();
      return;
    }

    if (mode === 'radial') {
      let grad: Gradient;
      if (currentPaint.kind === 'gradient') {
        grad = {
          type: 'radial',
          cx: 0.5,
          cy: 0.5,
          r: 0.5,
          stops: currentPaint.gradient.stops,
        };
      } else {
        const baseColor = currentPaint.kind === 'color' ? currentPaint.hex : lastRememberedFill;
        grad = createDefaultRadialGradient(baseColor, '#ffffff');
      }
      commitColor('fill', grad);
      syncPropertiesPanel();
      return;
    }
  };

  const onGradientTrackClick = (e: MouseEvent) => {
    if (isDraggingStopMarker) return;
    const target = e.target as HTMLElement;
    if (target.closest('.gradient-stop-marker')) return;
    if (!gradientTrack) return;

    const rect = gradientTrack.getBoundingClientRect();
    if (rect.width <= 0) return;
    const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = getCurrentPaintState('fill', leafShapes);
    if (paintState.kind !== 'gradient') return;

    const currentGrad = paintState.gradient;
    const color = interpolateGradientColor(currentGrad, offset);
    const newStopId = `stop-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newStop: GradientStop = {
      id: newStopId,
      offset: Number(offset.toFixed(4)),
      color,
      opacity: 1,
    };
    const updatedStops = [...currentGrad.stops, newStop].sort((a, b) => a.offset - b.offset);
    const updatedGrad = { ...currentGrad, stops: updatedStops };

    activeStopId = newStopId;
    captureInitialStyle();
    commitColor('fill', updatedGrad);
    syncPropertiesPanel();
  };

  let stopDragState: {
    stopId: string;
    startX: number;
    startY: number;
    initialOffset: number;
    initialGradient: Gradient;
  } | null = null;

  let onWindowMouseMoveRef: ((e: MouseEvent) => void) | null = null;
  let onWindowMouseUpRef: ((e: MouseEvent) => void) | null = null;

  const onGradientStopsContainerMouseDown = (e: MouseEvent) => {
    const marker = (e.target as HTMLElement).closest('.gradient-stop-marker') as HTMLElement | null;
    if (!marker || !gradientTrack) return;
    e.stopPropagation();

    const stopId = marker.dataset.stopId;
    if (!stopId) return;

    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = getCurrentPaintState('fill', leafShapes);
    if (paintState.kind !== 'gradient') return;

    const currentGrad = paintState.gradient;
    const targetStop = currentGrad.stops.find((s) => s.id === stopId);
    if (!targetStop) return;

    activeStopId = stopId;
    isDraggingStopMarker = true;
    captureInitialStyle();

    stopDragState = {
      stopId,
      startX: e.clientX,
      startY: e.clientY,
      initialOffset: targetStop.offset,
      initialGradient: currentGrad,
    };

    onWindowMouseMoveRef = (moveEvent: MouseEvent) => {
      if (!stopDragState || !gradientTrack) return;
      const rect = gradientTrack.getBoundingClientRect();
      const newOffset = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
      const dy = moveEvent.clientY - stopDragState.startY;

      if (dy > 35 && stopDragState.initialGradient.stops.length > 2) {
        marker.style.opacity = '0.3';
      } else {
        marker.style.opacity = '1';
      }

      const updatedStops = stopDragState.initialGradient.stops.map((s) =>
        s.id === stopDragState!.stopId ? { ...s, offset: Number(newOffset.toFixed(4)) } : s
      );
      const previewGrad = { ...stopDragState.initialGradient, stops: updatedStops };
      previewColor('fill', previewGrad);

      marker.style.left = `${newOffset * 100}%`;
      if (inputStopOffset && document.activeElement !== inputStopOffset) {
        inputStopOffset.value = String(Math.round(newOffset * 100));
      }
      if (gradientTrackFill) {
        const sorted = [...updatedStops].sort((a, b) => a.offset - b.offset);
        const cssStops = sorted
          .map((s) => `${colorWithOpacity(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
          .join(', ');
        gradientTrackFill.style.background = `linear-gradient(to right, ${cssStops})`;
      }
    };

    onWindowMouseUpRef = (upEvent: MouseEvent) => {
      if (onWindowMouseMoveRef) {
        window.removeEventListener('mousemove', onWindowMouseMoveRef);
        onWindowMouseMoveRef = null;
      }
      if (onWindowMouseUpRef) {
        window.removeEventListener('mouseup', onWindowMouseUpRef);
        onWindowMouseUpRef = null;
      }
      if (!stopDragState) return;

      const dy = upEvent.clientY - stopDragState.startY;
      const shouldDelete = dy > 35 && stopDragState.initialGradient.stops.length > 2;

      if (shouldDelete) {
        const updatedStops = stopDragState.initialGradient.stops.filter((s) => s.id !== stopDragState!.stopId);
        const finalGrad = { ...stopDragState.initialGradient, stops: updatedStops };
        activeStopId = updatedStops[0]?.id ?? null;
        commitColor('fill', finalGrad);
      } else {
        const rect = gradientTrack.getBoundingClientRect();
        const finalOffset = Math.max(0, Math.min(1, (upEvent.clientX - rect.left) / rect.width));
        const updatedStops = stopDragState.initialGradient.stops.map((s) =>
          s.id === stopDragState!.stopId ? { ...s, offset: Number(finalOffset.toFixed(4)) } : s
        );
        const finalGrad = { ...stopDragState.initialGradient, stops: updatedStops };
        commitColor('fill', finalGrad);
      }

      stopDragState = null;
      isDraggingStopMarker = false;
      syncPropertiesPanel();
    };

    window.addEventListener('mousemove', onWindowMouseMoveRef);
    window.addEventListener('mouseup', onWindowMouseUpRef);
    syncPropertiesPanel();
  };

  const updateActiveStop = (updater: (stop: GradientStop) => GradientStop, isPreview: boolean = false) => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = getCurrentPaintState('fill', leafShapes);
    if (paintState.kind !== 'gradient' || !activeStopId) return;

    const currentGrad = paintState.gradient;
    const updatedStops = currentGrad.stops.map((s) => (s.id === activeStopId ? updater(s) : s));
    const nextGrad = { ...currentGrad, stops: updatedStops };

    if (isPreview) {
      previewColor('fill', nextGrad);
      if (gradientTrackFill) {
        const sorted = [...updatedStops].sort((a, b) => a.offset - b.offset);
        const cssStops = sorted
          .map((s) => `${colorWithOpacity(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
          .join(', ');
        gradientTrackFill.style.background = `linear-gradient(to right, ${cssStops})`;
      }
      const activeStop = updatedStops.find((s) => s.id === activeStopId);
      if (activeStop && swatchStopPreview) {
        swatchStopPreview.style.backgroundColor = colorWithOpacity(activeStop.color, activeStop.opacity ?? 1);
      }
    } else {
      commitColor('fill', nextGrad);
      syncPropertiesPanel();
    }
  };

  const onStopColorInput = () => {
    if (!inputStopColor) return;
    const hex = inputStopColor.value.toLowerCase();
    updateActiveStop((s) => ({ ...s, color: hex }), true);
    if (inputStopHex) inputStopHex.value = hex;
  };

  const onStopColorChange = () => {
    if (!inputStopColor) return;
    const hex = inputStopColor.value.toLowerCase();
    updateActiveStop((s) => ({ ...s, color: hex }), false);
  };

  const onStopHexBlur = () => {
    if (!inputStopHex) return;
    const parsed = parseHexColor(inputStopHex.value);
    if (parsed) {
      inputStopHex.removeAttribute('aria-invalid');
      updateActiveStop((s) => ({ ...s, color: parsed }), false);
    } else {
      syncPropertiesPanel();
    }
  };

  const onStopHexKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onStopHexBlur();
      inputStopHex?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      syncPropertiesPanel();
      inputStopHex?.blur();
    }
  };

  const onStopOffsetChange = () => {
    if (!inputStopOffset) return;
    const num = Math.max(0, Math.min(100, parseFloat(inputStopOffset.value) || 0));
    updateActiveStop((s) => ({ ...s, offset: Number((num / 100).toFixed(4)) }), false);
  };

  const onStopOpacityChange = () => {
    if (!inputStopOpacity) return;
    const num = Math.max(0, Math.min(100, parseFloat(inputStopOpacity.value) || 100));
    updateActiveStop((s) => ({ ...s, opacity: Number((num / 100).toFixed(2)) }), false);
  };

  const onGradientFlip = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = getCurrentPaintState('fill', leafShapes);
    if (paintState.kind !== 'gradient') return;

    const currentGrad = paintState.gradient;
    const flippedStops = currentGrad.stops
      .map((s) => ({ ...s, offset: Number((1 - s.offset).toFixed(4)) }))
      .sort((a, b) => a.offset - b.offset);

    const nextGrad = { ...currentGrad, stops: flippedStops };
    commitColor('fill', nextGrad);
    syncPropertiesPanel();
  };

  const onDeleteStop = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    const leafShapes = getLeafShapes(selectedNodes);
    const paintState = getCurrentPaintState('fill', leafShapes);
    if (paintState.kind !== 'gradient' || !activeStopId) return;

    const currentGrad = paintState.gradient;
    if (currentGrad.stops.length <= 2) return;

    const remainingStops = currentGrad.stops.filter((s) => s.id !== activeStopId);
    activeStopId = remainingStops[0]?.id ?? null;
    const nextGrad = { ...currentGrad, stops: remainingStops };
    commitColor('fill', nextGrad);
    syncPropertiesPanel();
  };

  selectFillMode?.addEventListener('change', onFillModeChange);
  gradientTrack?.addEventListener('click', onGradientTrackClick);
  gradientStopsContainer?.addEventListener('mousedown', onGradientStopsContainerMouseDown);
  inputStopColor?.addEventListener('input', onStopColorInput);
  inputStopColor?.addEventListener('change', onStopColorChange);
  inputStopHex?.addEventListener('blur', onStopHexBlur);
  inputStopHex?.addEventListener('keydown', onStopHexKeyDown);
  inputStopOffset?.addEventListener('change', onStopOffsetChange);
  inputStopOpacity?.addEventListener('change', onStopOpacityChange);
  btnGradientFlip?.addEventListener('click', onGradientFlip);
  btnDeleteStop?.addEventListener('click', onDeleteStop);

  const renderGradientControls = (fillState: PaintState) => {
    if (!fillSolidControls || !fillGradientControls) return;

    if (fillState.kind === 'gradient') {
      fillSolidControls.style.display = 'none';
      fillGradientControls.style.display = 'flex';

      const grad = fillState.gradient;
      if (!activeStopId || !grad.stops.some((s) => s.id === activeStopId)) {
        activeStopId = grad.stops[0]?.id ?? null;
      }

      if (gradientTrackFill) {
        const sortedStops = [...grad.stops].sort((a, b) => a.offset - b.offset);
        const cssStops = sortedStops
          .map((s) => `${colorWithOpacity(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
          .join(', ');
        gradientTrackFill.style.background = `linear-gradient(to right, ${cssStops})`;
      }

      if (gradientStopsContainer) {
        gradientStopsContainer.innerHTML = '';
        for (const stop of grad.stops) {
          const marker = document.createElement('div');
          marker.className = `gradient-stop-marker${stop.id === activeStopId ? ' selected' : ''}`;
          marker.style.left = `${stop.offset * 100}%`;
          marker.style.backgroundColor = colorWithOpacity(stop.color, stop.opacity ?? 1);
          marker.dataset.stopId = stop.id;
          gradientStopsContainer.appendChild(marker);
        }
      }

      const activeStop = grad.stops.find((s) => s.id === activeStopId) ?? grad.stops[0];
      if (activeStop) {
        if (inputStopColor) {
          inputStopColor.value = toValidHexColor(activeStop.color, '#000000');
        }
        if (swatchStopPreview) {
          swatchStopPreview.style.backgroundColor = colorWithOpacity(activeStop.color, activeStop.opacity ?? 1);
        }
        if (inputStopHex && (typeof document === 'undefined' || document.activeElement !== inputStopHex)) {
          inputStopHex.value = toValidHexColor(activeStop.color, '#000000');
        }
        if (inputStopOffset && (typeof document === 'undefined' || document.activeElement !== inputStopOffset)) {
          inputStopOffset.value = String(Math.round(activeStop.offset * 100));
        }
        if (inputStopOpacity && (typeof document === 'undefined' || document.activeElement !== inputStopOpacity)) {
          inputStopOpacity.value = String(Math.round((activeStop.opacity ?? 1) * 100));
        }
      }

      if (btnDeleteStop) {
        btnDeleteStop.disabled = grad.stops.length <= 2;
        btnDeleteStop.style.opacity = grad.stops.length <= 2 ? '0.35' : '1';
      }
    } else {
      fillSolidControls.style.display = 'flex';
      fillGradientControls.style.display = 'none';
    }
  };

  return {
    renderGradientControls,
    getActiveStopId: () => activeStopId,
    setActiveStopId: (id: string | null) => {
      activeStopId = id;
    },
    cleanup: () => {
      selectFillMode?.removeEventListener('change', onFillModeChange);
      gradientTrack?.removeEventListener('click', onGradientTrackClick);
      gradientStopsContainer?.removeEventListener('mousedown', onGradientStopsContainerMouseDown);
      inputStopColor?.removeEventListener('input', onStopColorInput);
      inputStopColor?.removeEventListener('change', onStopColorChange);
      inputStopHex?.removeEventListener('blur', onStopHexBlur);
      inputStopHex?.removeEventListener('keydown', onStopHexKeyDown);
      inputStopOffset?.removeEventListener('change', onStopOffsetChange);
      inputStopOpacity?.removeEventListener('change', onStopOpacityChange);
      btnGradientFlip?.removeEventListener('click', onGradientFlip);
      btnDeleteStop?.removeEventListener('click', onDeleteStop);

      if (onWindowMouseMoveRef) {
        window.removeEventListener('mousemove', onWindowMouseMoveRef);
        onWindowMouseMoveRef = null;
      }
      if (onWindowMouseUpRef) {
        window.removeEventListener('mouseup', onWindowMouseUpRef);
        onWindowMouseUpRef = null;
      }
    },
  };
}
