import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { TouchGestureController } from '../src/input/TouchGestureController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { getTextAABB } from '../src/utils/geometry.ts';
import type { Rectangle, Text, Vector2D } from '../src/types/scene-graph.ts';

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

  it('8. edición de texto en táctil / mobile: proxy visible, soporte IME/input y rechazo de mousedown sintético', () => {
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;

    const proxyListeners: Record<string, ((e: any) => void)[]> = {};
    const mockProxy = {
      id: '',
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      style: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      setAttribute: (k: string, v: string) => { mockProxy.attributes[k] = v; },
      getAttribute: (k: string) => mockProxy.attributes[k],
      focus: () => {},
      blur: () => {},
      remove: () => {
        if (appendedElement === mockProxy) {
          appendedElement = null;
        }
      },
      setSelectionRange: (s: number, e: number) => {
        mockProxy.selectionStart = s;
        mockProxy.selectionEnd = e;
      },
      addEventListener: (type: string, fn: (e: any) => void) => {
        proxyListeners[type] = proxyListeners[type] || [];
        proxyListeners[type].push(fn);
      },
      removeEventListener: () => {},
    };

    let appendedElement: any = null;
    const mockBody: any = {
      appendChild: (el: any) => {
        appendedElement = el;
        el.parentElement = mockBody;
      },
      removeChild: (el: any) => {
        if (appendedElement === el) {
          appendedElement = null;
          el.parentElement = null;
        }
      },
    };
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'textarea') return mockProxy;
        if (tag === 'canvas') {
          return {
            getContext: () => ({
              font: '16px Inter',
              textAlign: 'left',
              textBaseline: 'top',
              measureText: (str: string) => ({ width: str.length * 10 }),
            }),
          };
        }
        return {};
      },
      body: mockBody,
      getElementById: (id: string) => {
        if (appendedElement && appendedElement.id === id) return appendedElement;
        return null;
      },
    };
    (globalThis as any).window = {
      innerWidth: 360,
      innerHeight: 640,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    try {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const inputController = new InputController(canvas, stateManager, commandManager, {
        viewportManager,
      });

      const layerId = stateManager.getState().children[0].id;
      const textNode: Text = {
        id: 'text-mobile-1',
        type: 'text',
        name: 'Texto Móvil',
        x: 50,
        y: 120,
        text: 'Hola',
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#000000',
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, textNode);

      // Simular pointerdown/up touch para activar modo táctil
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: 50,
        clientY: 120,
        pointerType: 'touch',
      });
      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
      });

      // Iniciar edición de texto
      inputController.startEditingText(textNode.id);
      assert.equal(inputController.isEditingText, true);

      // Verificar que el proxy textarea fue configurado adecuadamente para Android IME
      assert.ok(appendedElement !== null, 'Debe adjuntar proxy textarea al body');
      assert.equal(appendedElement.id, 'mobile-text-proxy');
      assert.equal(appendedElement.style.opacity, '0.01');
      assert.equal(appendedElement.style.pointerEvents, 'auto');
      assert.equal(appendedElement.style.fontSize, '16px');
      // Debe estar dentro de las coordenadas visibles de la pantalla, no a -9999px
      assert.ok(parseInt(appendedElement.style.top, 10) >= 0);
      assert.ok(parseInt(appendedElement.style.left, 10) >= 0);
      assert.equal(appendedElement.value, 'Hola');

      // Simular escritura desde el teclado virtual móvil (evento input)
      mockProxy.value = 'Hola Mundo';
      mockProxy.selectionStart = 10;
      mockProxy.selectionEnd = 10;
      for (const listener of proxyListeners['input'] || []) {
        listener({ inputType: 'insertText', data: ' Mundo' });
      }
      assert.equal(inputController.textEditingState?.currentText, 'Hola Mundo');

      // Simular mousedown sintético de Android que llega después de pointerup (300ms)
      // Debe ser ignorado y NO cancelar la sesión de edición de texto
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 200,
        clientY: 200,
        button: 0,
        sourceCapabilities: { firesTouchEvents: true },
      });
      assert.equal(inputController.isEditingText, true, 'El mousedown sintético no debe cancelar la edición');

      // Confirmar edición: el proxy debe quedar inactivo fuera de pantalla
      inputController.commitTextEdit();
      assert.equal(inputController.isEditingText, false);
      assert.equal(appendedElement.style.pointerEvents, 'none');
      assert.equal(appendedElement.style.top, '-9999px');
      assert.equal(appendedElement.style.left, '-9999px');
      assert.equal(appendedElement.value, 'Hola Mundo');

      const updatedNode = stateManager.findNode(textNode.id) as Text;
      assert.equal(updatedNode.text, 'Hola Mundo');

      // Al destruir el controlador, el elemento proxy se elimina del DOM
      inputController.destroy();
      assert.equal(appendedElement, null, 'Debe remover el proxy del body al destruir el controlador');
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
    }
  });

  it('9. re-tocar un texto existente en Android mantiene el foco del teclado y previene el desenfoque del canvas', () => {
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;

    let focusCount = 0;
    const proxyListeners: Record<string, ((e: any) => void)[]> = {};
    const mockProxy = {
      id: '',
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      style: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      setAttribute: (k: string, v: string) => { mockProxy.attributes[k] = v; },
      getAttribute: (k: string) => mockProxy.attributes[k],
      focus: () => {
        focusCount++;
        (mockDocument as any).activeElement = mockProxy;
      },
      blur: () => {
        if ((mockDocument as any).activeElement === mockProxy) {
          (mockDocument as any).activeElement = null;
        }
      },
      remove: () => {
        if (appendedElement === mockProxy) {
          appendedElement = null;
        }
      },
      setSelectionRange: (s: number, e: number) => {
        mockProxy.selectionStart = s;
        mockProxy.selectionEnd = e;
      },
      addEventListener: (type: string, fn: (e: any) => void) => {
        proxyListeners[type] = proxyListeners[type] || [];
        proxyListeners[type].push(fn);
      },
      removeEventListener: () => {},
    };

    let appendedElement: any = null;
    const mockBody: any = {
      appendChild: (el: any) => {
        appendedElement = el;
        el.parentElement = mockBody;
      },
      removeChild: (el: any) => {
        if (appendedElement === el) {
          appendedElement = null;
          el.parentElement = null;
        }
      },
    };
    const mockDocument: any = {
      activeElement: null,
      createElement: (tag: string) => {
        if (tag === 'textarea') return mockProxy;
        if (tag === 'canvas') {
          return {
            getContext: () => ({
              font: '16px Inter',
              textAlign: 'left',
              textBaseline: 'top',
              measureText: (str: string) => ({ width: str.length * 10 }),
            }),
          };
        }
        return {};
      },
      body: mockBody,
      getElementById: (id: string) => {
        if (appendedElement && appendedElement.id === id) return appendedElement;
        return null;
      },
    };
    (globalThis as any).document = mockDocument;
    (globalThis as any).window = {
      innerWidth: 360,
      innerHeight: 640,
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: (cb: () => void) => cb(),
    };

    try {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const inputController = new InputController(canvas, stateManager, commandManager, {
        viewportManager,
      });

      const layerId = stateManager.getState().children[0].id;
      const textNode: Text = {
        id: 'text-android-1',
        type: 'text',
        name: 'Texto Android',
        x: 50,
        y: 120,
        text: 'Mi Texto',
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#000000',
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, textNode);

      // Paso 1: Activar modo táctil tocando el texto para seleccionarlo
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: 50,
        clientY: 120,
        pointerType: 'touch',
        button: 0,
      });
      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: 50,
        clientY: 120,
        pointerType: 'touch',
      });

      assert.equal(stateManager.getSelectedNodes().length, 1);
      assert.equal(stateManager.getSelectedNodes()[0].id, textNode.id);
      assert.equal(inputController.currentTool, 'select');

      // Paso 2: Volver a tocar el texto ya seleccionado en táctil
      // Debe entrar directamente en edición, prevenir el desenfoque del canvas (preventDefault) y enfocar el proxy
      let preventedDefault2 = false;
      const initialFocusCount = focusCount;
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: 50,
        clientY: 120,
        pointerType: 'touch',
        button: 0,
        preventDefault: () => { preventedDefault2 = true; },
      });

      assert.equal(preventedDefault2, true, 'Debe invocar preventDefault para que el canvas no robe el foco');
      assert.equal(inputController.isEditingText, true, 'Debe entrar en modo de edición de texto');
      assert.equal(inputController.currentTool, 'text', 'La herramienta debe conmutar a texto');
      assert.ok(focusCount > initialFocusCount, 'Debe haber llamado a focus en el proxy de texto');
      assert.equal(mockDocument.activeElement, mockProxy, 'El proxy debe ser el elemento activo');

      // Paso 3: Al levantar el dedo (pointerup), asegurar que no se pierda el foco
      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: 50,
        clientY: 120,
        pointerType: 'touch',
      });
      assert.equal(inputController.isEditingText, true);
      assert.equal(mockDocument.activeElement, mockProxy);

      // Paso 4: Tocar el texto de nuevo estando ya en edición (ej. para mover el cursor)
      // Debe invocar preventDefault y mantener el proxy enfocado
      let preventedDefault3 = false;
      const focusBeforeRetouch = focusCount;
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: 60,
        clientY: 120,
        pointerType: 'touch',
        button: 0,
        preventDefault: () => { preventedDefault3 = true; },
      });

      assert.equal(preventedDefault3, true, 'Debe llamar a preventDefault al re-tocar el texto en edición');
      assert.equal(inputController.isEditingText, true);
      assert.ok(focusCount >= focusBeforeRetouch, 'El proxy debe continuar enfocado');
      assert.equal(mockDocument.activeElement, mockProxy);

      // Paso 5: Al levantar el dedo tras el re-toque
      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: 60,
        clientY: 120,
        pointerType: 'touch',
      });
      assert.equal(inputController.isEditingText, true);
      assert.equal(mockDocument.activeElement, mockProxy);

      inputController.destroy();
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
    }
  });

  it('10. en mobile, los manejadores de un texto seleccionado permiten escalarlo sin entrar en modo edición de texto', async () => {
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;

    try {
      const canvas = createMockCanvas();
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const viewportManager = new ViewportManager({ zoom: 1, panX: 0, panY: 0 });

      const inputController = new InputController(canvas, stateManager, commandManager, {
        viewportManager,
      });

      const layerId = stateManager.getState().children[0].id;
      const textNode: Text = {
        id: 'text-scale-1',
        type: 'text',
        name: 'Texto Escalar',
        x: 100,
        y: 100,
        text: 'Hello World',
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#000000',
        stroke: 'none',
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, textNode);

      // Paso 1: Activar modo táctil seleccionando el texto
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: 120,
        clientY: 108,
        pointerType: 'touch',
        button: 0,
      });
      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: 120,
        clientY: 108,
        pointerType: 'touch',
      });

      assert.equal(inputController.isTouch, true);
      assert.equal(stateManager.getSelectedNodes().length, 1);
      assert.equal(stateManager.getSelectedNodes()[0].id, textNode.id);
      assert.equal(inputController.currentTool, 'select');
      assert.equal(inputController.isEditingText, false);

      // Esperar más que doubleTapDelayMs (300ms) para que el siguiente toque no sea interpretado como double-tap
      await new Promise((r) => setTimeout(r, 350));

      // Obtener las coordenadas del manejador top-left (esquina para escalar tamaño de fuente)
      const textAABB = getTextAABB(textNode);
      const tlX = textAABB.minX;
      const tlY = textAABB.minY;

      // Paso 2: Tocar el manejador top-left
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: tlX,
        clientY: tlY,
        pointerType: 'touch',
        button: 0,
      });

      // NO debe entrar en modo edición de texto; la herramienta debe permanecer en 'select' y activar redimensionado
      assert.equal(inputController.isEditingText, false, 'No debe entrar en modo edición al tocar el manejador');
      assert.equal(inputController.currentTool, 'select', 'La herramienta debe permanecer en select');
      assert.equal(inputController.selectToolHandler.isResizing, true, 'Debe iniciar redimensionado');
      assert.equal(inputController.selectToolHandler.currentResizeHandle, 'top-left');

      // Paso 3: Arrastrar el manejador top-left hacia afuera (-40, -40) para aumentar el tamaño de fuente
      canvas.dispatchSimulatedEvent('pointermove', {
        pointerId: 1,
        clientX: tlX - 40,
        clientY: tlY - 40,
        pointerType: 'touch',
      });

      // El tamaño de fuente debe haber aumentado
      const intermediateNode = stateManager.findNode(textNode.id) as Text;
      assert.ok((intermediateNode.fontSize ?? 16) > 16, 'El tamaño de fuente debe haber aumentado tras arrastrar el manejador');

      // Paso 4: Levantar el dedo para completar el escalado
      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: tlX - 40,
        clientY: tlY - 40,
        pointerType: 'touch',
      });

      assert.equal(inputController.selectToolHandler.isResizing, false);
      assert.equal(inputController.isEditingText, false);
      assert.equal(inputController.currentTool, 'select');

      const finalNode = stateManager.findNode(textNode.id) as Text;
      assert.ok((finalNode.fontSize ?? 16) > 16);

      // Deshacer revierte el escalado
      assert.ok(commandManager.canUndo);
      commandManager.undo();
      const undoneNode = stateManager.findNode(textNode.id) as Text;
      assert.equal(undoneNode.fontSize, 16);

      // Paso 5: Probar que tocar el manejador right-center permite ajustar boxWidth sin entrar en edición
      await new Promise((r) => setTimeout(r, 350));
      const midY = (textAABB.minY + textAABB.maxY) / 2;
      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: textAABB.maxX,
        clientY: midY,
        pointerType: 'touch',
        button: 0,
      });

      assert.equal(inputController.isEditingText, false, 'No debe editar texto al tocar el manejador');
      assert.equal(inputController.currentTool, 'select');
      assert.equal(inputController.selectToolHandler.isResizing, true);
      assert.ok(inputController.selectToolHandler.currentResizeHandle !== null);

      canvas.dispatchSimulatedEvent('pointermove', {
        pointerId: 1,
        clientX: textAABB.maxX + 50,
        clientY: midY,
        pointerType: 'touch',
      });

      const scaledNode = stateManager.findNode(textNode.id) as Text;
      assert.ok(
        (scaledNode.fontSize ?? 16) !== 16 ||
        (scaledNode.boxWidth !== undefined && scaledNode.boxWidth > 0),
        'Las dimensiones del texto deben cambiar al arrastrar el manejador'
      );

      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: textAABB.maxX + 50,
        clientY: midY,
        pointerType: 'touch',
      });

      assert.equal(inputController.selectToolHandler.isResizing, false);
      assert.equal(inputController.isEditingText, false);

      // Paso 6: Probar que tocar el manejador de rotación permite rotar el texto sin entrar en edición
      await new Promise((r) => setTimeout(r, 350));
      const rotY = textAABB.minY - 36;
      const midX = (textAABB.minX + textAABB.maxX) / 2;

      canvas.dispatchSimulatedEvent('pointerdown', {
        pointerId: 1,
        clientX: midX,
        clientY: rotY,
        pointerType: 'touch',
        button: 0,
      });

      assert.equal(inputController.isEditingText, false, 'No debe editar texto al tocar manejador de rotación');
      assert.equal(inputController.currentTool, 'select');
      assert.equal(inputController.selectToolHandler.isRotating, true);

      canvas.dispatchSimulatedEvent('pointerup', {
        pointerId: 1,
        clientX: midX,
        clientY: rotY,
        pointerType: 'touch',
      });
      assert.equal(inputController.selectToolHandler.isRotating, false);

      inputController.destroy();
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
    }
  });
});
