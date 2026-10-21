import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { TouchGestureController } from '../src/input/TouchGestureController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import type { Rectangle, Vector2D } from '../src/types/scene-graph.ts';

function createMockCanvas(): HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void } {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    getContext: () => null,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of [...listeners[type]]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('TouchGestureController y Soporte Táctil Móvil', () => {
  it('1. detecta puntero único y emite onSinglePointerDown, Move y Up', () => {
    const canvas = createMockCanvas();
    const events: string[] = [];

    const controller = new TouchGestureController(canvas, {
      onSinglePointerDown: () => events.push('down'),
      onSinglePointerMove: () => events.push('move'),
      onSinglePointerUp: () => events.push('up'),
    });

    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      pointerType: 'touch',
      button: 0,
    });
    assert.deepEqual(events, ['down']);

    canvas.dispatchSimulatedEvent('pointermove', {
      pointerId: 1,
      clientX: 120,
      clientY: 120,
      pointerType: 'touch',
    });
    assert.deepEqual(events, ['down', 'move']);

    canvas.dispatchSimulatedEvent('pointerup', {
      pointerId: 1,
      clientX: 120,
      clientY: 120,
      pointerType: 'touch',
    });
    assert.deepEqual(events, ['down', 'move', 'up']);

    controller.destroy();
  });

  it('2. gesto multitáctil de 2 dedos (Pinch-to-zoom y Pan) cancela acción previa y calcula zoom y pan', () => {
    const canvas = createMockCanvas();
    let canceledCount = 0;
    const pinchCalls: { midpoint: Vector2D; factor: number; pan: Vector2D }[] = [];

    const controller = new TouchGestureController(canvas, {
      onCancelSinglePointer: () => {
        canceledCount++;
      },
      onPinchPan: (midpoint, factor, pan) => {
        pinchCalls.push({ midpoint, factor, pan });
      },
    });

    // 1er dedo toca
    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 200,
      clientY: 300,
      pointerType: 'touch',
    });
    assert.equal(canceledCount, 0);

    // 2do dedo toca -> cancela acción de 1 dedo y entra en modo pinch
    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 2,
      clientX: 400,
      clientY: 300,
      pointerType: 'touch',
    });
    assert.equal(canceledCount, 1);
    assert.equal(controller.isPinchActive, true);

    // Los dos dedos se separan (pinch out para zoom in) y se desplazan 20px a la derecha
    canvas.dispatchSimulatedEvent('pointermove', {
      pointerId: 1,
      clientX: 150,
      clientY: 300,
      pointerType: 'touch',
    });
    canvas.dispatchSimulatedEvent('pointermove', {
      pointerId: 2,
      clientX: 470,
      clientY: 300,
      pointerType: 'touch',
    });

    assert.ok(pinchCalls.length > 0);
    const lastPinch = pinchCalls[pinchCalls.length - 1];
    assert.ok(lastPinch.factor > 1.0, `Factor de zoom debería ser > 1, fue ${lastPinch.factor}`);

    // Lift-off protection: levantar 1 dedo mientras quedan dedos activos NO debe disparar single pointer
    canvas.dispatchSimulatedEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
    });
    assert.equal(controller.isPinchActive, true, 'isPinchActive debe ser true mientras queden dedos (lift-off protection)');

    // Levantar el último dedo
    canvas.dispatchSimulatedEvent('pointerup', {
      pointerId: 2,
      pointerType: 'touch',
    });
    assert.equal(controller.isPinchActive, false, 'isPinchActive vuelve a false al levantar todos los dedos');

    controller.destroy();
  });

  it('3. pulsación prolongada (Long-Press) dispara onLongPress tras 500ms si el contacto no se mueve', async () => {
    const canvas = createMockCanvas();
    let longPressed = false;

    const controller = new TouchGestureController(
      canvas,
      {
        onLongPress: () => {
          longPressed = true;
        },
      },
      { longPressDelayMs: 40 }
    );

    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 250,
      clientY: 250,
      pointerType: 'touch',
    });

    assert.equal(longPressed, false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(longPressed, true, 'Long-press debe haberse disparado');

    controller.destroy();
  });

  it('4. movimiento superior al umbral cancela el temporizador de Long-Press', async () => {
    const canvas = createMockCanvas();
    let longPressed = false;

    const controller = new TouchGestureController(
      canvas,
      {
        onLongPress: () => {
          longPressed = true;
        },
      },
      { longPressDelayMs: 40, longPressDistanceThreshold: 8 }
    );

    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      pointerType: 'touch',
    });

    // Mover 15 px (supera umbral de 8px)
    canvas.dispatchSimulatedEvent('pointermove', {
      pointerId: 1,
      clientX: 115,
      clientY: 100,
      pointerType: 'touch',
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(longPressed, false, 'Long-press no debe dispararse si hubo arrastre');

    controller.destroy();
  });

  it('5. doble toque rápido (Double-Tap) dispara onDoubleTap', () => {
    const canvas = createMockCanvas();
    let doubleTapped = false;

    const controller = new TouchGestureController(
      canvas,
      {
        onDoubleTap: () => {
          doubleTapped = true;
        },
      },
      { doubleTapDelayMs: 300, doubleTapDistanceThreshold: 20 }
    );

    // 1er toque
    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 300,
      clientY: 300,
      pointerType: 'touch',
    });
    canvas.dispatchSimulatedEvent('pointerup', {
      pointerId: 1,
      clientX: 300,
      clientY: 300,
      pointerType: 'touch',
    });

    // 2do toque rápido en posición cercana
    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 304,
      clientY: 302,
      pointerType: 'touch',
    });

    assert.equal(doubleTapped, true);
    controller.destroy();
  });

  it('6. InputController integra TouchGestureController y ejecuta zoomAt y panBy en handlePinchPan', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

    const inputController = new InputController(canvas, stateManager, commandManager, {
      viewportManager,
    });

    assert.equal(viewportManager.zoom, 1);
    assert.equal(viewportManager.panX, 0);
    assert.equal(viewportManager.panY, 0);

    // Simular gesto de pellizco (zoom 1.25x en (500, 400)) con desplazamiento (10, -5)
    inputController.handlePinchPan({ x: 500, y: 400 }, 1.25, { x: 10, y: -5 });

    assert.equal(viewportManager.zoom, 1.25);
    assert.notEqual(viewportManager.panX, 0);
    assert.notEqual(viewportManager.panY, 0);

    inputController.destroy();
  });

  it('7. tolerancia táctil ampliada: en modo touch, hitTestNode tolera contactos hasta 20px', () => {
    const canvas = createMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

    const inputController = new InputController(canvas, stateManager, commandManager, {
      viewportManager,
    });

    const layerId = stateManager.getState().children[0].id;
    const rect: Rectangle = {
      id: 'rect-touch-test',
      type: 'rectangle',
      name: 'Rect Touch',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      fill: '#38bdf8',
      stroke: 'none',
      visible: true,
      locked: false,
    };
    stateManager.addShape(layerId, rect);

    // En modo ratón (isTouch = false), un clic a 10px fuera de la figura (x: 210) no acierta (tolerancia 4px)
    assert.equal(inputController.isTouch, false);
    const hitMouse = inputController.hitTest(210, 150);
    assert.equal(hitMouse, null);

    // Simular evento táctil para activar isTouch
    canvas.dispatchSimulatedEvent('pointerdown', {
      pointerId: 1,
      clientX: 210,
      clientY: 150,
      pointerType: 'touch',
    });
    assert.equal(inputController.isTouch, true);

    // Con isTouch activo, la tolerancia táctil es 16px, por lo que 210 (10px fuera) sí colisiona
    const hitTouch = inputController.hitTest(210, 150);
    assert.ok(hitTouch !== null, 'En modo táctil, la tolerancia de 16px debe capturar el contacto');
    assert.equal(hitTouch?.id, rect.id);

    canvas.dispatchSimulatedEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
    });
    inputController.destroy();
  });
});
