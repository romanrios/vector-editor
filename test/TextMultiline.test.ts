import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { serializeDocument, parseDocument } from '../src/state/Serializer.ts';
import { isText, type Text } from '../src/types/scene-graph.ts';
import {
  getTextBaseAABB,
  getTextLineHeight,
  setSharedMeasureContext,
} from '../src/utils/geometry.ts';

// Helper de mock Canvas para simulación de eventos, renderizado y métricas tipográficas
function createInteractiveMockCanvas() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const fillTextCalls: { text: string; x: number; y: number }[] = [];
  const fillRectCalls: { x: number; y: number; w: number; h: number }[] = [];

  const mockCtx = {
    font: '16px Inter',
    textAlign: 'left',
    textBaseline: 'top',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    rect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push({ x, y, w, h });
    },
    strokeRect: () => {},
    clearRect: () => {},
    setLineDash: () => {},
    fillText: (text: string, x: number, y: number) => {
      fillTextCalls.push({ text, x, y });
    },
    measureText: (str: string) => ({ width: str.length * 10 }),
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 1000,
    height: 800,
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

  return { canvas, mockCtx, fillTextCalls, fillRectCalls };
}

describe('Soporte de texto multilínea (Multiline Text Module)', () => {
  function setupEnv(initialText?: string, extraTextProps?: Partial<Text>) {
    const { canvas, mockCtx, fillTextCalls, fillRectCalls } = createInteractiveMockCanvas();
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const controller = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    let textNode: Text | null = null;
    if (initialText !== undefined) {
      textNode = {
        id: 'multiline-text-1',
        type: 'text',
        name: 'Texto Multilínea',
        x: 100,
        y: 100,
        text: initialText,
        fontFamily: 'Inter',
        fontSize: 20,
        lineHeight: 24,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#000000',
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        ...extraTextProps,
      };
      stateManager.addShape(layerId, textNode);
    }

    return { canvas, mockCtx, stateManager, commandManager, controller, layerId, textNode, fillTextCalls, fillRectCalls };
  }

  // 1. Text de una línea existente
  it('1. Text de una línea existente conserva sus propiedades y comportamiento', () => {
    const { textNode, mockCtx } = setupEnv('Línea única', { lineHeight: undefined });
    assert.ok(textNode);
    assert.equal(textNode.text, 'Línea única');

    const baseAABB = getTextBaseAABB(textNode, mockCtx);
    assert.equal(baseAABB.minX, 100);
    assert.equal(baseAABB.minY, 100);
    assert.equal(baseAABB.width, 'Línea única'.length * 10);
    // Para una sola línea sin lineHeight explícito, la altura es fontSize (compatibilidad estricta)
    assert.equal(baseAABB.height, 20);
  });

  // 2. Enter inserta "\n"
  it('2. Enter inserta "\\n" sin finalizar la edición (y Shift + Enter hace lo mismo)', () => {
    const { controller, textNode } = setupEnv('Hola');
    controller.startEditingText(textNode!.id, 4);

    assert.equal(controller.isEditingText, true);

    // Enter
    controller.handleKeyDown({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.isEditingText, true, 'No debe salir de edición');
    assert.equal(controller.textEditingState?.currentText, 'Hola\n');
    assert.equal(controller.textEditingState?.cursorIndex, 5);

    // Escribir "Mundo"
    for (const c of 'Mundo') {
      controller.handleKeyDown({ key: c, preventDefault: () => {} } as unknown as KeyboardEvent);
    }
    assert.equal(controller.textEditingState?.currentText, 'Hola\nMundo');

    // Shift + Enter
    controller.handleKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.isEditingText, true);
    assert.equal(controller.textEditingState?.currentText, 'Hola\nMundo\n');
  });

  // 3. edición de tres líneas
  it('3. edición de tres líneas completas mediante teclado', () => {
    const { controller, textNode } = setupEnv('');
    controller.startEditingText(textNode!.id, 0);

    const fullContent = 'Hola mundo\nEsta es una segunda línea\nY esta es una tercera línea';
    for (const c of fullContent) {
      if (c === '\n') {
        controller.handleKeyDown({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent);
      } else {
        controller.handleKeyDown({ key: c, preventDefault: () => {} } as unknown as KeyboardEvent);
      }
    }

    assert.equal(controller.textEditingState?.currentText, fullContent);
    assert.equal(controller.isEditingText, true);
  });

  // 4. cursor entre líneas
  it('4. cursor entre líneas refleja el índice 1D exacto considerando "\\n"', () => {
    const { controller, textNode } = setupEnv('ABC\nDEF\nGHI');
    controller.startEditingText(textNode!.id, 0);

    // Mover 4 posiciones a la derecha: saltará de ABC (índices 0, 1, 2) pasando por '\n' (índice 3) a 'D' (índice 4)
    for (let i = 0; i < 4; i++) {
      controller.handleKeyDown({ key: 'ArrowRight', preventDefault: () => {} } as unknown as KeyboardEvent);
    }
    assert.equal(controller.textCursorPosition, 4);
    assert.equal(controller.textEditingState?.currentText[controller.textCursorPosition], 'D');
  });

  // 5. ↑
  it('5. ↑ mueve el cursor a la línea anterior intentando conservar la posición horizontal', () => {
    // Línea 0: "012345" (offset en '3' es 3)
    // Línea 1: "abcdef"
    const { controller, textNode } = setupEnv('012345\nabcdef');
    // Situar cursor en 'c' (índice 7 + 2 = 9)
    controller.startEditingText(textNode!.id, 9);
    assert.equal(controller.textCursorPosition, 9);

    controller.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} } as unknown as KeyboardEvent);
    // Debe haber subido a la misma columna ('2' en índice 2)
    assert.equal(controller.textCursorPosition, 2);

    // Si vuelve a presionar ↑ en la primera línea, va al inicio (0)
    controller.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 0);
  });

  // 6. ↓
  it('6. ↓ mueve el cursor a la línea siguiente intentando conservar la posición horizontal', () => {
    const { controller, textNode } = setupEnv('012345\nabcdef');
    // Situar cursor en '3' (índice 3)
    controller.startEditingText(textNode!.id, 3);

    controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as unknown as KeyboardEvent);
    // Debe haber bajado a 'd' (índice 7 + 3 = 10)
    assert.equal(controller.textCursorPosition, 10);

    // Si vuelve a presionar ↓ en la última línea, va al fin del texto (13)
    controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 13);
  });

  // 7. Home
  it('7. Home mueve al inicio de la línea actual', () => {
    const { controller, textNode } = setupEnv('Primera\nSegunda Línea\nTercera');
    // Cursor dentro de la segunda línea en 'L' (índice 8 + 8 = 16)
    controller.startEditingText(textNode!.id, 16);

    controller.handleKeyDown({ key: 'Home', preventDefault: () => {} } as unknown as KeyboardEvent);
    // Inicio de la segunda línea es el índice 8 ('S')
    assert.equal(controller.textCursorPosition, 8);
  });

  // 8. End
  it('8. End mueve al final de la línea actual', () => {
    const { controller, textNode } = setupEnv('Primera\nSegunda\nTercera');
    // Cursor al inicio de la segunda línea (índice 8)
    controller.startEditingText(textNode!.id, 8);

    controller.handleKeyDown({ key: 'End', preventDefault: () => {} } as unknown as KeyboardEvent);
    // Fin de la segunda línea es antes del siguiente '\n' (índice 8 + 7 = 15)
    assert.equal(controller.textCursorPosition, 15);
  });

  // 9. Ctrl/Cmd + Home
  it('9. Ctrl/Cmd + Home mueve al inicio de todo el texto', () => {
    const { controller, textNode } = setupEnv('Primera\nSegunda\nTercera');
    controller.startEditingText(textNode!.id, 18);

    controller.handleKeyDown({ key: 'Home', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 0);
  });

  // 10. Ctrl/Cmd + End
  it('10. Ctrl/Cmd + End mueve al final de todo el texto', () => {
    const { controller, textNode } = setupEnv('Primera\nSegunda\nTercera');
    controller.startEditingText(textNode!.id, 2);

    controller.handleKeyDown({ key: 'End', metaKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textCursorPosition, 'Primera\nSegunda\nTercera'.length);
  });

  // 11. selección multilínea
  it('11. selección multilínea abarca rangos a través de saltos de línea', () => {
    const { controller, textNode } = setupEnv('Línea 1\nLínea 2\nLínea 3');
    controller.startEditingText(textNode!.id);

    // Selección desde índice 2 (en línea 1) hasta 12 (en línea 2)
    controller.textEditingState!.selectionStart = 2;
    controller.textEditingState!.selectionEnd = 12;

    assert.equal(controller.hasTextSelection, true);
    assert.deepEqual(controller.textSelectionRange, { start: 2, end: 12 });
  });

  // 12. selección con Shift
  it('12. selección con Shift amplía la selección horizontal y verticalmente', () => {
    const { controller, textNode } = setupEnv('01234\n56789');
    controller.startEditingText(textNode!.id, 2);

    // Shift + ArrowRight: selecciona carácter siguiente
    controller.handleKeyDown({ key: 'ArrowRight', shiftKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.hasTextSelection, true);
    assert.deepEqual(controller.textSelectionRange, { start: 2, end: 3 });

    // Shift + ArrowDown: amplía la selección a la línea siguiente
    controller.handleKeyDown({ key: 'ArrowDown', shiftKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.hasTextSelection, true);
    // Debe haber bajado a índice 6 + 3 = 9
    assert.deepEqual(controller.textSelectionRange, { start: 2, end: 9 });
  });

  // 13. Ctrl/Cmd + A
  it('13. Ctrl/Cmd + A selecciona todo el contenido incluyendo todos los saltos de línea', () => {
    const { controller, textNode } = setupEnv('A\nB\nC');
    controller.startEditingText(textNode!.id, 1);

    controller.handleKeyDown({ key: 'a', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.hasTextSelection, true);
    assert.deepEqual(controller.textSelectionRange, { start: 0, end: 5 });
    assert.equal(controller.textCursorPosition, 5);
  });

  // 14. Backspace sobre selección multilínea
  it('14. Backspace sobre selección multilínea elimina el rango y fusiona las líneas', () => {
    const { controller, textNode } = setupEnv('Hola\nMundo');
    controller.startEditingText(textNode!.id);

    // Seleccionar desde 'l' (2) hasta 'n' (8) -> incluye '\n'
    controller.textEditingState!.selectionStart = 2;
    controller.textEditingState!.selectionEnd = 8;

    controller.handleKeyDown({ key: 'Backspace', preventDefault: () => {} } as unknown as KeyboardEvent);
    // Queda "Hodo"
    assert.equal(controller.textEditingState?.currentText, 'Hodo');
    assert.equal(controller.textCursorPosition, 2);
    assert.equal(controller.hasTextSelection, false);
  });

  // 15. Delete sobre selección multilínea
  it('15. Delete sobre selección multilínea elimina correctamente el rango', () => {
    const { controller, textNode } = setupEnv('Uno\nDos\nTres');
    controller.startEditingText(textNode!.id);

    // Seleccionar desde 'o' (2) hasta 'T' (9)
    controller.textEditingState!.selectionStart = 2;
    controller.textEditingState!.selectionEnd = 9;

    controller.handleKeyDown({ key: 'Delete', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'Unres');
    assert.equal(controller.textCursorPosition, 2);
    assert.equal(controller.hasTextSelection, false);
  });

  // 16. reemplazo de selección multilínea
  it('16. escribir reemplaza la selección multilínea por el nuevo carácter', () => {
    const { controller, textNode } = setupEnv('Alfa\nBeta\nGamma');
    controller.startEditingText(textNode!.id);

    // Seleccionar todo
    controller.handleKeyDown({ key: 'a', ctrlKey: true, preventDefault: () => {} } as unknown as KeyboardEvent);

    // Escribir 'Z'
    controller.handleKeyDown({ key: 'Z', preventDefault: () => {} } as unknown as KeyboardEvent);
    assert.equal(controller.textEditingState?.currentText, 'Z');
    assert.equal(controller.textCursorPosition, 1);
    assert.equal(controller.hasTextSelection, false);
  });

  // 17. click posicionando cursor en línea correcta
  it('17. click sobre Text posiciona el cursor en la línea y carácter más cercanos', () => {
    // textNode en x=100, y=100, fontSize=20, lineHeight=24, cada char=10px
    // Línea 0: "012345" -> y: [100, 124)
    // Línea 1: "abcdef" -> y: [124, 148)
    const { canvas, controller } = setupEnv('012345\nabcdef');
    controller.setTool('text');

    // Clic en x=135, y=130 (cae en la línea 1 'abcdef', offset x=35px -> char index 3 ó 4)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 135, clientY: 130, button: 0 });

    assert.equal(controller.isEditingText, true);
    // Línea 1 inicia en índice 7. El carácter 3 es índice 10 ('d')
    const pos = controller.textCursorPosition;
    assert.ok(pos >= 9 && pos <= 11, `El cursor debe estar en la línea 1 cerca de x=35 (actual: ${pos})`);
  });

  // 18. drag selection entre líneas
  it('18. drag selection permite seleccionar texto entre diferentes líneas hacia adelante y atrás', () => {
    const { canvas, controller, textNode } = setupEnv('012345\nabcdef');
    controller.startEditingText(textNode!.id);

    // Mousedown en línea 0, char 2 (x=120, y=110)
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 120, clientY: 110, button: 0 });

    // Mousemove a línea 1, char 4 (x=140, y=135)
    canvas.dispatchSimulatedEvent('mousemove', { clientX: 140, clientY: 135 });
    canvas.dispatchSimulatedEvent('mouseup', { clientX: 140, clientY: 135 });

    assert.equal(controller.hasTextSelection, true);
    const range = controller.textSelectionRange!;
    assert.ok(range.start === 2, `Inicio debe ser 2 (actual: ${range.start})`);
    assert.ok(range.end >= 10 && range.end <= 12, `Fin debe estar en línea 1 (actual: ${range.end})`);
  });

  // 19. AABB de texto multilínea
  it('19. AABB de texto multilínea toma la línea más ancha y la altura según número de líneas y lineHeight', () => {
    const { mockCtx } = setupEnv();
    const text: Text = {
      id: 't-multi',
      type: 'text',
      name: 'Multi',
      x: 50,
      y: 80,
      text: 'Corta\nEsta es una línea mucho más larga\nMedia',
      fontSize: 20,
      lineHeight: 30,
      textAlign: 'left',
    };

    const longestLine = 'Esta es una línea mucho más larga';
    const expectedWidth = longestLine.length * 10;
    const expectedHeight = 3 * 30; // 3 líneas * 30px lineHeight

    const aabb = getTextBaseAABB(text, mockCtx);
    assert.equal(aabb.minX, 50);
    assert.equal(aabb.minY, 80);
    assert.equal(aabb.width, expectedWidth);
    assert.equal(aabb.height, expectedHeight);
    assert.equal(aabb.maxX, 50 + expectedWidth);
    assert.equal(aabb.maxY, 80 + expectedHeight);
  });

  // 20. renderizado de múltiples líneas
  it('20. renderizado de múltiples líneas invoca fillText para cada línea con separación lineHeight', () => {
    const { canvas, stateManager, fillTextCalls } = setupEnv('Primera\nSegunda\nTercera');
    const engine = new RenderEngine(canvas, stateManager);

    engine.render();

    // Debe haber llamado fillText para 'Primera', 'Segunda' y 'Tercera'
    const renderedTexts = fillTextCalls.map((c) => c.text);
    assert.ok(renderedTexts.includes('Primera'), 'Debe renderizar la línea 1');
    assert.ok(renderedTexts.includes('Segunda'), 'Debe renderizar la línea 2');
    assert.ok(renderedTexts.includes('Tercera'), 'Debe renderizar la línea 3');

    // Verificar las coordenadas Y de cada línea (text.y=100, lineHeight=24)
    const call1 = fillTextCalls.find((c) => c.text === 'Primera');
    const call2 = fillTextCalls.find((c) => c.text === 'Segunda');
    const call3 = fillTextCalls.find((c) => c.text === 'Tercera');
    assert.equal(call1?.y, 100);
    assert.equal(call2?.y, 124);
    assert.equal(call3?.y, 148);
  });

  // 21. Undo/Redo
  it('21. Undo y Redo restauran y reaplican contenido multilínea correctamente', () => {
    const { controller, stateManager, commandManager, textNode, canvas } = setupEnv('Original');
    controller.startEditingText(textNode!.id, 8);

    // Escribir "\nSegunda Línea"
    controller.handleKeyDown({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent);
    for (const c of 'Nueva') {
      controller.handleKeyDown({ key: c, preventDefault: () => {} } as unknown as KeyboardEvent);
    }

    // Confirmar clic fuera
    canvas.dispatchSimulatedEvent('mousedown', { clientX: 900, clientY: 900, button: 0 });
    assert.equal(controller.isEditingText, false);

    const updated = stateManager.findNode(textNode!.id) as Text;
    assert.equal(updated.text, 'Original\nNueva');

    // Deshacer (Undo)
    assert.equal(commandManager.undo(), true);
    assert.equal((stateManager.findNode(textNode!.id) as Text).text, 'Original');

    // Rehacer (Redo)
    assert.equal(commandManager.redo(), true);
    assert.equal((stateManager.findNode(textNode!.id) as Text).text, 'Original\nNueva');
  });

  // 22. serialización
  it('22. serialización JSON conserva saltos "\\n" y propiedad opcional lineHeight', async () => {
    const { stateManager } = setupEnv('Línea 1\nLínea 2\nLínea 3', { lineHeight: 28 });

    const json = serializeDocument(stateManager.getState());
    assert.ok(json.includes('\\n') || json.includes('\n'));
    assert.ok(json.includes('"lineHeight": 28') || json.includes('"lineHeight":28'));

    const docParsed = await parseDocument(json);
    const parsedNode = docParsed.children[0].children[0] as Text;
    assert.equal(isText(parsedNode), true);
    assert.equal(parsedNode.text, 'Línea 1\nLínea 2\nLínea 3');
    assert.equal(parsedNode.lineHeight, 28);
  });

  // 23. compatibilidad con Text de una sola línea
  it('23. compatibilidad con Text de una sola línea sin lineHeight en deserialización y renderizado', async () => {
    const singleLineJson = JSON.stringify({
      version: 1,
      type: 'document',
      id: 'doc-1',
      name: 'Doc',
      width: 800,
      height: 600,
      children: [
        {
          id: 'layer-1',
          type: 'layer',
          name: 'Capa 1',
          visible: true,
          locked: false,
          children: [
            {
              id: 'text-single',
              type: 'text',
              name: 'Texto Simple',
              x: 100,
              y: 100,
              text: 'Una sola línea',
              fontSize: 18,
            },
          ],
        },
      ],
    });

    const doc = await parseDocument(singleLineJson);
    const text = doc.children[0].children[0] as Text;
    assert.equal(text.text, 'Una sola línea');
    assert.equal(text.lineHeight, undefined);

    // Métrica consistente
    const lh = getTextLineHeight(text);
    assert.equal(lh, 18 * 1.2);

    // AABB mantiene altura = fontSize para compatibilidad
    const aabb = getTextBaseAABB(text, null);
    assert.equal(aabb.height, 18);
  });
});
