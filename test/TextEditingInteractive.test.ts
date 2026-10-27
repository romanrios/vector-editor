import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { isText, type Text } from '../src/types/scene-graph.ts';
import { setSharedMeasureContext } from '../src/utils/geometry.ts';

// Helper de mock Canvas con simulación de eventos y medición tipográfica determinista
function createInteractiveMockCanvas() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  const mockCtx = {
    font: '16px Inter',
    textAlign: 'left',
    textBaseline: 'top',
    measureText: (str: string) => ({ width: str.length * 10 }),
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
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
    getContext: () => mockCtx,
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
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };

  setSharedMeasureContext(mockCtx);

  return { canvas, mockCtx };
}

describe('Mejoras interactivas en la herramienta Texto (Text Editing UX)', () => {
  function setupTestEnvironment(initialText?: string) {
    const { canvas, mockCtx } = createInteractiveMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    let textNode: Text | null = null;
    if (initialText !== undefined) {
      textNode = {
        id: 'sample-text-1',
        type: 'text',
        name: 'Texto Muestra',
        x: 100,
        y: 100,
        text: initialText,
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
    }

    return { canvas, mockCtx, stateManager, commandManager, controller, layerId, textNode };
  }

  it('1. crear Text y entrar automáticamente en edición', () => {
    const { canvas, stateManager, controller, layerId } = setupTestEnvironment();

    controller.setTool('text');
    assert.equal(controller.isEditingText, false);

    // Clic en el canvas en (150, 150)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 150, clientY: 150, button: 0 });

    const layer = stateManager.findNode(layerId) as any;
    assert.equal(layer.children.length, 1, 'Debe haber creado un nodo');
    const created = layer.children[0] as Text;
    assert.equal(isText(created), true);

    // Entra automáticamente en modo edición
    assert.equal(controller.isEditingText, true);
    assert.ok(controller.textEditingState);
    assert.equal(controller.textEditingState?.textId, created.id);
  });

  it('2. cursor inicial y selección total en Text recién creado', () => {
    const { canvas, controller } = setupTestEnvironment();

    controller.setTool('text');
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 120, clientY: 120, button: 0 });

    assert.equal(controller.isEditingText, true);
    const editState = controller.textEditingState!;
    assert.equal(editState.currentText, 'Texto');
    // Para un Text recién creado, todo el contenido debe estar inicialmente seleccionado
    assert.equal(editState.cursorIndex, 5);
    assert.equal(editState.selectionStart, 0);
    assert.equal(editState.selectionEnd, 5);
    assert.equal(editState.hasSelection, true);
    assert.equal(controller.hasTextSelection, true);
    assert.deepEqual(controller.textSelectionRange, { start: 0, end: 5 });
  });

  it('3. escribir caracteres en Text recién creado reemplaza el contenido por defecto', () => {
    const { canvas, controller } = setupTestEnvironment();

    controller.setTool('text');
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 100, clientY: 100, button: 0 });

    // El primer carácter reemplaza "Texto"
    controller.handleKeyDown({ key: 'H', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'H');
    assert.equal(controller.textEditingState?.cursorIndex, 1);
    assert.equal(controller.hasTextSelection, false);

    // Los siguientes caracteres se añaden correlativamente
    controller.handleKeyDown({ key: 'o', preventDefault: () => {} } as unknown as KeyboardEvent);
    controller.handleKeyDown({ key: 'l', preventDefault: () => {} } as unknown as KeyboardEvent);
    controller.handleKeyDown({ key: 'a', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'Hola');
    assert.equal(controller.textEditingState?.cursorIndex, 4);
  });

  it('4. mover cursor con flechas', () => {
    const { controller, textNode } = setupTestEnvironment('ABCDE');
    controller.startEditingText(textNode!.id);

    assert.equal(controller.textCursorPosition, 5);

    // Mover cursor dos posiciones a la izquierda
    controller.handleKeyDown({ key: 'ArrowLeft', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 4);

    controller.handleKeyDown({ key: 'ArrowLeft', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 3);
    assert.equal(controller.hasTextSelection, false);

    // Mover una posición a la derecha
    controller.handleKeyDown({ key: 'ArrowRight', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 4);
    assert.equal(controller.hasTextSelection, false);
  });

  it('5. Home/End', () => {
    const { controller, textNode } = setupTestEnvironment('Palabra');
    controller.startEditingText(textNode!.id, 3);

    assert.equal(controller.textCursorPosition, 3);

    // Home debe llevar el cursor a 0
    controller.handleKeyDown({ key: 'Home', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 0);
    assert.equal(controller.hasTextSelection, false);

    // End debe llevar el cursor al final (7)
    controller.handleKeyDown({ key: 'End', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 7);
    assert.equal(controller.hasTextSelection, false);
  });

  it('6. Backspace', () => {
    const { controller, textNode } = setupTestEnvironment('Hola');
    controller.startEditingText(textNode!.id, 4);

    // Backspace al final borra la 'a'
    controller.handleKeyDown({ key: 'Backspace', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'Hol');
    assert.equal(controller.textCursorPosition, 3);

    // Mover a la posición 0 y pulsar Backspace no hace nada
    controller.handleKeyDown({ key: 'Home', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 0);

    controller.handleKeyDown({ key: 'Backspace', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'Hol');
    assert.equal(controller.textCursorPosition, 0);
  });

  it('7. Delete', () => {
    const { controller, textNode } = setupTestEnvironment('Mundo');
    controller.startEditingText(textNode!.id, 0);

    // Delete al inicio borra la 'M' siguiente
    controller.handleKeyDown({ key: 'Delete', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'undo');
    assert.equal(controller.textCursorPosition, 0);

    // Mover al final (4) y presionar Delete no hace nada
    controller.handleKeyDown({ key: 'End', preventDefault: () => {} } as unknown as KeyboardEvent);
    controller.handleKeyDown({ key: 'Delete', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'undo');
    assert.equal(controller.textCursorPosition, 4);
  });

  it('8. seleccionar con Shift + flechas', () => {
    const { controller, textNode } = setupTestEnvironment('ABCDE');
    controller.startEditingText(textNode!.id, 5);

    // Shift + Flecha izquierda selecciona el último carácter
    controller.handleKeyDown({
      key: 'ArrowLeft',
      shiftKey: true,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);

    assert.equal(controller.hasTextSelection, true);
    assert.deepEqual(controller.textSelectionRange, { start: 4, end: 5 });
    assert.equal(controller.textCursorPosition, 4);

    // Otro Shift + Flecha izquierda amplía la selección
    controller.handleKeyDown({
      key: 'ArrowLeft',
      shiftKey: true,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);

    assert.deepEqual(controller.textSelectionRange, { start: 3, end: 5 });

    // Shift + Flecha derecha reduce la selección
    controller.handleKeyDown({
      key: 'ArrowRight',
      shiftKey: true,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);

    assert.deepEqual(controller.textSelectionRange, { start: 4, end: 5 });
  });

  it('9. Ctrl/Cmd + A', () => {
    const { controller, textNode } = setupTestEnvironment('Vectorial');
    controller.startEditingText(textNode!.id, 2);

    controller.handleKeyDown({
      key: 'a',
      ctrlKey: true,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);

    assert.equal(controller.hasTextSelection, true);
    assert.deepEqual(controller.textSelectionRange, { start: 0, end: 9 });
  });

  it('10. reemplazar selección', () => {
    const { controller, textNode } = setupTestEnvironment('ABCDE');
    controller.startEditingText(textNode!.id, 5);

    // Seleccionar todo con Ctrl+A
    controller.handleKeyDown({
      key: 'a',
      ctrlKey: true,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);

    // Escribir 'X' debe reemplazar toda la selección
    controller.handleKeyDown({
      key: 'X',
      preventDefault: () => {},
    } as unknown as KeyboardEvent);

    assert.equal(controller.textEditingState?.currentText, 'X');
    assert.equal(controller.textCursorPosition, 1);
    assert.equal(controller.hasTextSelection, false);

    // Ahora probar reemplazo parcial: escribir 'Y', 'Z' -> 'XYZ'
    controller.handleKeyDown({ key: 'Y', preventDefault: () => {} } as unknown as KeyboardEvent);
    controller.handleKeyDown({ key: 'Z', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'XYZ');

    // Seleccionar 'Y' (desde index 1 a 2)
    controller.startEditingText(textNode!.id);
    controller.textEditingState!.selectionStart = 1;
    controller.textEditingState!.selectionEnd = 2;
    controller.textEditingState!.cursorIndex = 2;

    controller.handleKeyDown({ key: '9', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'X9Z');
  });

  it('11. Escape', () => {
    const { controller, stateManager, commandManager, textNode } = setupTestEnvironment('Inicial');
    controller.startEditingText(textNode!.id);

    controller.handleKeyDown({ key: ' ', preventDefault: () => {} } as unknown as KeyboardEvent);
    controller.handleKeyDown({ key: 'X', preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.equal(controller.textEditingState?.currentText, 'Inicial X');

    // Escape cancela y restaura
    controller.handleKeyDown({ key: 'Escape', preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.equal(controller.isEditingText, false);
    assert.equal(controller.textEditingState, null);

    const nodeInState = stateManager.findNode(textNode!.id) as Text;
    assert.equal(nodeInState.text, 'Inicial');
    assert.equal(commandManager.canUndo(), false);
  });

  it('12. Enter', () => {
    const { canvas, controller, stateManager, commandManager, textNode } = setupTestEnvironment('Borrador');
    controller.startEditingText(textNode!.id);

    controller.handleKeyDown({ key: '!', preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.equal(controller.textEditingState?.currentText, 'Borrador!');

    // Enter inserta '\n' sin confirmar la edición
    controller.handleKeyDown({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.equal(controller.isEditingText, true);
    assert.equal(controller.textEditingState?.currentText, 'Borrador!\n');

    // Clic fuera confirma la edición
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 800, clientY: 800, button: 0 });

    assert.equal(controller.isEditingText, false);
    assert.equal(controller.textEditingState, null);

    const nodeInState = stateManager.findNode(textNode!.id) as Text;
    assert.equal(nodeInState.text, 'Borrador!\n');
    assert.equal(commandManager.canUndo(), true);
  });

  it('13. click en Text existente posiciona el cursor en el carácter más cercano sin seleccionar todo el contenido', () => {
    // textNode en (100, 100), texto '0123456789' (10px por carácter en mockCtx)
    const { canvas, controller, textNode } = setupTestEnvironment('0123456789');

    controller.setTool('text');
    // Clic en x=135 (offset 35px -> carácter 3 ó 4)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 135, clientY: 105, button: 0 });

    assert.equal(controller.isEditingText, true);
    assert.equal(controller.textEditingState?.textId, textNode!.id);
    const pos = controller.textCursorPosition;
    assert.ok(pos === 3 || pos === 4, `El cursor debe posicionarse cerca de la posición del clic (actual: ${pos})`);
    assert.equal(controller.hasTextSelection, false, 'No debe seleccionar todo el contenido');
    assert.equal(controller.textEditingState?.selectionStart, pos);
    assert.equal(controller.textEditingState?.selectionEnd, pos);
  });

  it('14. selección mediante arrastre', () => {
    // textNode en (100, 100), texto '0123456789' (10px por carácter)
    const { canvas, controller, textNode } = setupTestEnvironment('0123456789');

    controller.startEditingText(textNode!.id);

    // Mousedown en x=110 (char 1)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 110, clientY: 105, button: 0 });
    // Mousemove a x=160 (char 6)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 160, clientY: 105 });
    // Mouseup
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 160, clientY: 105 });

    assert.equal(controller.hasTextSelection, true);
    const range = controller.textSelectionRange!;
    assert.equal(range.start, 1);
    assert.equal(range.end, 6);

    // Escribir reemplaza la selección arrastrada
    controller.handleKeyDown({ key: 'W', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, '0W6789');
  });

  it('15. undo/redo del contenido', () => {
    const { controller, stateManager, commandManager, textNode } = setupTestEnvironment('Version 1');
    controller.startEditingText(textNode!.id);

    // Cambiar texto a "Version 2"
    controller.handleKeyDown({ key: 'Backspace', preventDefault: () => {} } as unknown as KeyboardEvent);
    controller.handleKeyDown({ key: '2', preventDefault: () => {} } as unknown as KeyboardEvent);

    controller.commitTextEdit();

    assert.equal((stateManager.findNode(textNode!.id) as Text).text, 'Version 2');

    // Deshacer
    assert.equal(commandManager.canUndo(), true);
    commandManager.undo();
    assert.equal((stateManager.findNode(textNode!.id) as Text).text, 'Version 1');

    // Rehacer
    assert.equal(commandManager.canRedo(), true);
    commandManager.redo();
    assert.equal((stateManager.findNode(textNode!.id) as Text).text, 'Version 2');
  });

  it('16. salir de edición haciendo clic fuera', () => {
    const { canvas, controller, stateManager, textNode } = setupTestEnvironment('Titulo');
    controller.startEditingText(textNode!.id);

    controller.handleKeyDown({ key: '!', preventDefault: () => {} } as unknown as KeyboardEvent);

    assert.equal(controller.isEditingText, true);

    // Clic lejos del texto (x=800, y=800)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 800, clientY: 800, button: 0 });

    assert.equal(controller.isEditingText, false);
    assert.equal(controller.textEditingState, null);

    const nodeInState = stateManager.findNode(textNode!.id) as Text;
    assert.equal(nodeInState.text, 'Titulo!');
  });

  it('17. selectWordAt selecciona la palabra completa delimitada por espacios o símbolos', () => {
    const { controller, textNode } = setupTestEnvironment('Hola Mundo Vectorial');
    controller.startEditingText(textNode!.id);

    // Seleccionar palabra "Mundo" con índice 7 ('u')
    controller.textEditManager.selectWordAt(7);
    const range = controller.textSelectionRange!;
    assert.equal(range.start, 5);
    assert.equal(range.end, 10);
    assert.equal(controller.textEditingState!.currentText.slice(range.start, range.end), 'Mundo');
  });

  it('18. selectLineAt selecciona la línea completa sin incluir el salto de línea', () => {
    const { controller, textNode } = setupTestEnvironment('Primera linea\nSegunda linea\nTercera');
    controller.startEditingText(textNode!.id);

    // Cursor en "Segunda" (índice 17)
    controller.textEditManager.selectLineAt(17);
    const range = controller.textSelectionRange!;
    assert.equal(range.start, 14);
    assert.equal(range.end, 27);
    assert.equal(controller.textEditingState!.currentText.slice(range.start, range.end), 'Segunda linea');
  });

  it('19. zoom con Ctrl+rueda dentro de edición de texto aplica preventDefault y actualiza zoom del canvas', () => {
    const { controller, textNode } = setupTestEnvironment('Texto Zoom');
    controller.startEditingText(textNode!.id);
    assert.equal(controller.isEditingText, true);

    let prevented = false;
    const wheelEvent = {
      clientX: 120,
      clientY: 110,
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as WheelEvent;

    controller.handleWheel(wheelEvent);
    assert.equal(prevented, true, 'Debe prevenir zoom nativo del navegador');
    assert.ok(controller.viewportManager.zoom > 1, 'Debe aplicar zoom al viewport');
    assert.equal(controller.isEditingText, true, 'Debe permanecer en edición de texto');
  });

  it('20. interacción y selección de texto con mouse mediante screenToWorldCoords', () => {
    const { controller, textNode } = setupTestEnvironment('0123456789');
    controller.startEditingText(textNode!.id);

    // textNode está en (100, 100), cada char 10px en mock context
    // Simular mousedown en x=120 (índice 2)
    const worldPoint = controller.textEditManager.screenToWorldCoords(120, 105);
    assert.equal(worldPoint.x, 120);

    controller.textEditManager.handleMouseDown(textNode, 120, 105);
    assert.equal(controller.textEditingState?.cursorIndex, 2);

    // Simular arrastre a x=170 (índice 7)
    controller.textEditManager.handleMouseMove(170, 105);
    const range = controller.textSelectionRange!;
    assert.equal(range.start, 2);
    assert.equal(range.end, 7);

    // Soltar arrastre
    controller.textEditManager.handleMouseUp();
    assert.equal(controller.textEditManager.isMouseSelectingText, false);
  });

  it('21. arrastre de derecha a izquierda preserva la selección al soltar el clic (no se deselecciona)', () => {
    const { controller, textNode } = setupTestEnvironment('0123456789');
    controller.startEditingText(textNode!.id);

    // Mousedown en x=170 (índice 7, derecha)
    controller.textEditManager.handleMouseDown(textNode, 170, 105);
    assert.equal(controller.textEditingState?.cursorIndex, 7);
    assert.equal(controller.textEditingState?.selectionStart, 7);
    assert.equal(controller.textEditingState?.selectionEnd, 7);

    // Arrastre a la izquierda hasta x=120 (índice 2)
    controller.textEditManager.handleMouseMove(120, 105);
    assert.equal(controller.textEditingState?.selectionStart, 7);
    assert.equal(controller.textEditingState?.selectionEnd, 2);
    assert.equal(controller.textEditingState?.cursorIndex, 2);

    const rangeBeforeUp = controller.textSelectionRange!;
    assert.equal(rangeBeforeUp.start, 2);
    assert.equal(rangeBeforeUp.end, 7);

    // Soltar el clic con handleMouseUp
    controller.textEditManager.handleMouseUp();
    assert.equal(controller.textEditManager.isMouseSelectingText, false);

    // La selección DEBE preservarse intacta (no deseleccionarse ni colapsar)
    const rangeAfterUp = controller.textSelectionRange!;
    assert.equal(rangeAfterUp.start, 2);
    assert.equal(rangeAfterUp.end, 7);
    assert.equal(controller.textEditingState?.selectionStart, 7);
    assert.equal(controller.textEditingState?.selectionEnd, 2);

    // Invocar handleMouseUp de InputController tampoco debe deseleccionar ni salir de modo edición
    const mouseUpEvent = {
      button: 0,
      clientX: 120,
      clientY: 105,
      preventDefault: () => {},
    } as unknown as MouseEvent;
    controller.handleMouseUp(mouseUpEvent);
    assert.equal(controller.isEditingText, true);
    assert.equal(controller.textSelectionRange?.start, 2);
    assert.equal(controller.textSelectionRange?.end, 7);
  });

  it('22. triple clic selecciona la línea completa de texto', () => {
    const { controller, textNode } = setupTestEnvironment('Primera linea\nSegunda linea completa\nTercera');
    controller.startEditingText(textNode!.id);

    // Mousedown en la segunda línea ("Segunda linea completa") con detail = 3 (triple clic)
    const textNodeModel = controller.stateManager.findNode(textNode!.id) as Text;
    controller.textEditManager.handleMouseDown(textNodeModel, 160, 125, 3);

    const range = controller.textSelectionRange!;
    assert.ok(range, 'Debe haber un rango de selección activo');
    assert.equal(range.start, 14);
    assert.equal(range.end, 36);
    assert.equal(
      controller.textEditingState?.currentText.slice(range.start, range.end),
      'Segunda linea completa'
    );

    // Prueba también con clics consecutivos rápidos
    const controller2 = setupTestEnvironment('Linea Unica').controller;
    const text2 = controller2.stateManager.findNode(textNode!.id) as Text;
    controller2.startEditingText(text2.id);

    // Simular 3 clics rápidos en x=120, y=105
    controller2.textEditManager.handleMouseDown(text2, 120, 105);
    controller2.textEditManager.handleMouseDown(text2, 120, 105);
    controller2.textEditManager.handleMouseDown(text2, 120, 105);

    const range2 = controller2.textSelectionRange!;
    assert.equal(range2.start, 0);
    assert.equal(range2.end, 11);
    assert.equal(controller2.textEditingState?.currentText.slice(range2.start, range2.end), 'Linea Unica');
  });

  it('23. pulsar Enter en proxy textarea o con eventos que se propagan inserta exactamente un salto de línea (no dos)', () => {
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;

    const proxyListeners: Record<string, ((e: any) => void)[]> = {};
    const mockProxy = {
      id: 'mobile-text-proxy',
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      style: {} as Record<string, string>,
      setAttribute: () => {},
      focus: () => {},
      blur: () => {},
      remove: () => {},
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
      },
      removeChild: () => {},
    };

    const windowListeners: Record<string, ((e: any) => void)[]> = {};

    (globalThis as any).document = {
      createElement: (tag: string) => (tag === 'textarea' ? mockProxy : {}),
      body: mockBody,
      activeElement: mockProxy,
    };
    (globalThis as any).window = {
      addEventListener: (type: string, fn: (e: any) => void) => {
        windowListeners[type] = windowListeners[type] || [];
        windowListeners[type].push(fn);
      },
      removeEventListener: () => {},
    };

    try {
      const { controller, textNode } = setupTestEnvironment('Linea');
      controller.startEditingText(textNode!.id, 5);

      assert.ok(appendedElement, 'El proxy debe ser adjuntado al DOM');
      assert.equal(controller.textEditingState?.currentText, 'Linea');

      let stopPropagationCalled = false;
      let defaultPrevented = false;

      const enterEvent = {
        key: 'Enter',
        target: mockProxy,
        defaultPrevented: false,
        preventDefault: () => {
          defaultPrevented = true;
          enterEvent.defaultPrevented = true;
        },
        stopPropagation: () => {
          stopPropagationCalled = true;
        },
      };

      // Simular keydown 'Enter' en el proxy textarea
      for (const fn of proxyListeners['keydown'] || []) {
        fn(enterEvent);
      }

      assert.equal(stopPropagationCalled, true, 'Debe invocar stopPropagation en Enter para evitar duplicación');
      assert.equal(defaultPrevented, true, 'Debe prevenir la acción por defecto del textarea');
      assert.equal(controller.textEditingState?.currentText, 'Linea\n');

      // Si por alguna razón el evento llegase al window listener (simulando burbujeo si no se hubiese detenido)
      for (const fn of windowListeners['keydown'] || []) {
        fn(enterEvent);
      }

      // Debe seguir teniendo exactamente un único salto de línea, no dos
      assert.equal(controller.textEditingState?.currentText, 'Linea\n');
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
    }
  });
});


