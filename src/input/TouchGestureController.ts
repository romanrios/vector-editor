import type { Vector2D } from '../types/scene-graph.ts';

export interface TouchGestureCallbacks {
  readonly onSinglePointerDown?: (event: PointerEvent | MouseEvent) => void;
  readonly onSinglePointerMove?: (event: PointerEvent | MouseEvent) => void;
  readonly onSinglePointerUp?: (event: PointerEvent | MouseEvent) => void;
  readonly onCancelSinglePointer?: () => void;
  readonly onPinchPan?: (midpointScreen: Vector2D, zoomFactor: number, panDelta: Vector2D) => void;
  readonly onLongPress?: (event: PointerEvent | MouseEvent) => void;
  readonly onDoubleTap?: (event: PointerEvent | MouseEvent) => void;
}

export interface TouchGestureOptions {
  readonly longPressDelayMs?: number;
  readonly longPressDistanceThreshold?: number;
  readonly doubleTapDelayMs?: number;
  readonly doubleTapDistanceThreshold?: number;
  readonly enableHaptics?: boolean;
}

interface PointerInfo {
  clientX: number;
  clientY: number;
  pointerType: string;
}

/**
 * Controlador desacoplado de eventos táctiles y punteros para el lienzo de Vectedit.
 * Gestiona:
 * 1. Punteros únicos para herramientas interactivas (con emulación segura de ratón).
 * 2. Gestos multitáctiles de 2 dedos (Pinch-to-zoom y Pan simultáneos) con lift-off protection.
 * 3. Pulsación prolongada (Long-Press) para invocar el menú contextual con respuesta háptica.
 * 4. Detección de doble toque (Double-Tap) para edición de texto y exploración de grupos.
 */
export class TouchGestureController {
  private readonly element: HTMLElement | HTMLCanvasElement;
  private readonly callbacks: TouchGestureCallbacks;
  private readonly options: Required<TouchGestureOptions>;

  private readonly activePointers = new Map<number, PointerInfo>();
  private isPinching = false;
  private lastPinchDistance = 0;
  private lastPinchMidpoint: Vector2D = { x: 0, y: 0 };

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStartPos: Vector2D = { x: 0, y: 0 };
  private longPressTriggered = false;

  private lastTapTime = 0;
  private lastTapPos: Vector2D = { x: 0, y: 0 };
  private lastPointerType: string = 'mouse';
  private lastPointerTimestamp = 0;

  private readonly onPointerDownHandler = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMoveHandler = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUpHandler = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerCancelHandler = (e: PointerEvent) => this.handlePointerCancel(e);

  constructor(
    element: HTMLElement | HTMLCanvasElement,
    callbacks: TouchGestureCallbacks,
    options: TouchGestureOptions = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.options = {
      longPressDelayMs: options.longPressDelayMs ?? 500,
      longPressDistanceThreshold: options.longPressDistanceThreshold ?? 10,
      doubleTapDelayMs: options.doubleTapDelayMs ?? 300,
      doubleTapDistanceThreshold: options.doubleTapDistanceThreshold ?? 24,
      enableHaptics: options.enableHaptics ?? true,
    };

    this.attach();
  }

  public get lastEventPointerType(): string {
    return this.lastPointerType;
  }

  public get lastPointerEventTime(): number {
    return this.lastPointerTimestamp;
  }

  public get isPinchActive(): boolean {
    return this.isPinching;
  }

  /**
   * Determina si la entrada activa actual proviene de un dispositivo táctil (teléfono, tablet).
   */
  public isTouchActive(): boolean {
    if (this.lastPointerType === 'touch') {
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(pointer: coarse)').matches;
    }
    return false;
  }

  private attach(): void {
    if (!this.element || typeof this.element.addEventListener !== 'function') {
      return;
    }

    this.element.addEventListener('pointerdown', this.onPointerDownHandler as EventListener);
    this.element.addEventListener('pointermove', this.onPointerMoveHandler as EventListener);
    this.element.addEventListener('pointerup', this.onPointerUpHandler as EventListener);
    this.element.addEventListener('pointercancel', this.onPointerCancelHandler as EventListener);
    this.element.addEventListener('lostpointercapture', this.onPointerCancelHandler as EventListener);
  }

  public destroy(): void {
    this.clearLongPressTimer();

    if (!this.element || typeof this.element.removeEventListener !== 'function') {
      return;
    }

    this.element.removeEventListener('pointerdown', this.onPointerDownHandler as EventListener);
    this.element.removeEventListener('pointermove', this.onPointerMoveHandler as EventListener);
    this.element.removeEventListener('pointerup', this.onPointerUpHandler as EventListener);
    this.element.removeEventListener('pointercancel', this.onPointerCancelHandler as EventListener);
    this.element.removeEventListener('lostpointercapture', this.onPointerCancelHandler as EventListener);

    this.activePointers.clear();
  }

  public handlePointerDown(event: PointerEvent): void {
    this.lastPointerType = event.pointerType || 'mouse';
    this.lastPointerTimestamp = Date.now();

    this.activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: this.lastPointerType,
    });

    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignorar si el entorno o mock no implementa setPointerCapture
    }

    const pointerCount = this.activePointers.size;

    if (pointerCount === 1) {
      this.longPressTriggered = false;

      // Detección de Doble Toque (Double-Tap)
      const now = Date.now();
      const distFromLastTap = Math.hypot(
        event.clientX - this.lastTapPos.x,
        event.clientY - this.lastTapPos.y
      );

      if (
        now - this.lastTapTime < this.options.doubleTapDelayMs &&
        distFromLastTap < this.options.doubleTapDistanceThreshold
      ) {
        this.clearLongPressTimer();
        this.lastTapTime = 0;
        this.callbacks.onDoubleTap?.(event);
        return;
      }

      this.lastTapTime = now;
      this.lastTapPos = { x: event.clientX, y: event.clientY };

      // Configurar temporizador de Pulsación Prolongada (Long-Press) si es táctil o botón principal
      if (this.lastPointerType === 'touch' || event.button === 0) {
        this.longPressStartPos = { x: event.clientX, y: event.clientY };
        this.clearLongPressTimer();
        this.longPressTimer = setTimeout(() => {
          this.triggerLongPress(event);
        }, this.options.longPressDelayMs);
      }

      this.callbacks.onSinglePointerDown?.(event);
    } else if (pointerCount === 2) {
      // Al ingresar un segundo dedo, cancelamos cualquier acción previa de un solo dedo
      this.clearLongPressTimer();
      this.isPinching = true;
      this.callbacks.onCancelSinglePointer?.();

      const [p1, p2] = Array.from(this.activePointers.values());
      this.lastPinchDistance = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      this.lastPinchMidpoint = {
        x: (p1.clientX + p2.clientX) / 2,
        y: (p1.clientY + p2.clientY) / 2,
      };
    } else {
      // Más de 2 dedos: cancelar temporizadores y mantener modo pinch/pan
      this.clearLongPressTimer();
    }
  }

  public handlePointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId)) {
      return;
    }

    this.activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType || this.lastPointerType,
    });

    if (this.isPinching && this.activePointers.size >= 2) {
      const [p1, p2] = Array.from(this.activePointers.values());
      const currentDistance = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      const currentMidpoint: Vector2D = {
        x: (p1.clientX + p2.clientX) / 2,
        y: (p1.clientY + p2.clientY) / 2,
      };

      if (this.lastPinchDistance > 5 && currentDistance > 5) {
        let zoomFactor = currentDistance / this.lastPinchDistance;
        // Limitar salto abrupto por frame para máxima suavidad visual
        zoomFactor = Math.max(0.7, Math.min(1.4, zoomFactor));

        const panDelta: Vector2D = {
          x: currentMidpoint.x - this.lastPinchMidpoint.x,
          y: currentMidpoint.y - this.lastPinchMidpoint.y,
        };

        this.callbacks.onPinchPan?.(currentMidpoint, zoomFactor, panDelta);
        this.lastPinchDistance = currentDistance;
        this.lastPinchMidpoint = currentMidpoint;
      }
      return;
    }

    if (this.activePointers.size === 1) {
      // Verificar si el movimiento cancela el temporizador de pulsación prolongada
      if (this.longPressTimer !== null) {
        const moveDist = Math.hypot(
          event.clientX - this.longPressStartPos.x,
          event.clientY - this.longPressStartPos.y
        );
        if (moveDist > this.options.longPressDistanceThreshold) {
          this.clearLongPressTimer();
        }
      }

      if (this.longPressTriggered) {
        return;
      }

      this.callbacks.onSinglePointerMove?.(event);
    }
  }

  public handlePointerUp(event: PointerEvent): void {
    this.clearLongPressTimer();
    this.activePointers.delete(event.pointerId);

    try {
      this.element.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignorar fallos de captura
    }

    // Lift-off protection: si estábamos en pinch, esperar a que todos los dedos se levanten
    if (this.isPinching) {
      if (this.activePointers.size === 0) {
        this.isPinching = false;
      }
      return;
    }

    // Si se disparó el menú contextual por Long-Press, ignorar el PointerUp para no deseleccionar
    if (this.longPressTriggered) {
      this.longPressTriggered = false;
      return;
    }

    if (this.activePointers.size === 0) {
      this.callbacks.onSinglePointerUp?.(event);
    }
  }

  public handlePointerCancel(event: PointerEvent): void {
    this.clearLongPressTimer();
    this.activePointers.delete(event.pointerId);

    try {
      this.element.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignorar fallos de captura
    }

    if (this.activePointers.size === 0) {
      this.isPinching = false;
      this.longPressTriggered = false;
      this.callbacks.onCancelSinglePointer?.();
    }
  }

  private triggerLongPress(event: PointerEvent | MouseEvent): void {
    this.longPressTimer = null;
    this.longPressTriggered = true;

    if (
      this.options.enableHaptics &&
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      try {
        navigator.vibrate(35);
      } catch {
        // Ignorar excepciones de vibración en entornos sin permisos
      }
    }

    this.callbacks.onLongPress?.(event);
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}
