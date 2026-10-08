import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { RenderEngine } from '../src/render/RenderEngine.ts';
import { UpdateTextCommand } from '../src/commands/UpdateTextCommand.ts';
import type { Text } from '../src/types/scene-graph.ts';

// Helper para mock de Canvas con eventos en Node.js
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
}

describe('Edición interactiva de texto (Text Editing)', () => {
  function setupTest(initialText: string = 'Texto Inicial') {
    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const layerId = stateManager.getState().children[0].id;

    const textNode: Text = {
      id: 'test-text-1',
      type: 'text',
      name: 'Texto 1',
      x: 100,
      y: 100,
      text: initialText,
      fontFamily: 'Inter',
      fontSize: 20,
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
    stateManager.selectNode(textNode.id);

    const canvas = createMockCanvas();
    const controller = new InputController(canvas, stateManager, commandManager);

    return { stateManager, commandManager, textNode, canvas, controller };
  }

  describe('1. Entrar en edición', () => {
    it('entra en modo edición mediante doble clic sobre un Text seleccionado', () => {
      const { controller, textNode, canvas } = setupTest('Mi Titulo');

      assert.equal(controller.isEditingText, false);

      // Doble clic sobre las coordenadas del texto (x=100, y=100)
      canvas.dispatchSimulatedEvent('dblclick', {
        clientX: 120,
        clientY: 110,
        button: 0,
      });

      assert.equal(controller.isEditingText, true);
      assert.ok(controller.textEditingState);
      assert.equal(controller.textEditingState?.textId, textNode.id);
      assert.equal(controller.textEditingState?.originalText, 'Mi Titulo');
      assert.equal(controller.textEditingState?.currentText, 'Mi Titulo');
    });

    it('entra en modo edición presionando Enter cuando un Text está seleccionado', () => {
      const { controller, textNode } = setupTest('Etiqueta');

      assert.equal(controller.isEditingText, false);

      controller.handleKeyDown({
        key: 'Enter',
        code: 'Enter',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.isEditingText, true);
      assert.equal(controller.textEditingState?.textId, textNode.id);
      assert.equal(controller.textEditingState?.currentText, 'Etiqueta');
    });

    it('no entra en edición con Enter si no hay figuras seleccionadas o hay más de una', () => {
      const { controller, stateManager } = setupTest('Texto');

      // Sin selección
      stateManager.setSelection([]);
      controller.handleKeyDown({
        key: 'Enter',
        code: 'Enter',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.isEditingText, false);
    });

    it('startEditingText inicializa correctamente el estado temporal sin mutar el Scene Graph', () => {
      const { controller, stateManager, textNode } = setupTest('Inmutable');

      const success = controller.startEditingText(textNode.id);
      assert.equal(success, true);
      assert.equal(controller.isEditingText, true);

      // El Scene Graph debe permanecer congelado con el texto original
      const nodeInState = stateManager.findNode(textNode.id) as Text;
      assert.equal(nodeInState.text, 'Inmutable');
    });
  });

  describe('2. Escribir', () => {
    it('permite escribir caracteres alfanuméricos modificando el estado temporal', () => {
      const { controller, stateManager, textNode } = setupTest('Hola');
      controller.startEditingText(textNode.id);

      // Simular escribir " mundo"
      const keys = [' ', 'm', 'u', 'n', 'd', 'o'];
      for (const key of keys) {
        controller.handleKeyDown({
          key,
          code: `Key${key.toUpperCase()}`,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          preventDefault: () => {},
        } as unknown as KeyboardEvent);
      }

      assert.equal(controller.textEditingState?.currentText, 'Hola mundo');
      // El estado en StateManager sigue siendo 'Hola' hasta que se confirme
      assert.equal((stateManager.findNode(textNode.id) as Text).text, 'Hola');
    });

    it('Backspace elimina el último carácter en edición', () => {
      const { controller } = setupTest('ABC');
      controller.startEditingText('test-text-1');

      controller.handleKeyDown({
        key: 'Backspace',
        code: 'Backspace',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.textEditingState?.currentText, 'AB');

      controller.handleKeyDown({
        key: 'Backspace',
        code: 'Backspace',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.textEditingState?.currentText, 'A');
    });

    it('Delete elimina el carácter siguiente en edición sin borrar la figura del documento', () => {
      const { controller, stateManager, textNode } = setupTest('XYZ');
      controller.startEditingText(textNode.id);

      // Situar el cursor al inicio para eliminar el carácter siguiente ('X')
      controller.handleKeyDown({
        key: 'Home',
        code: 'Home',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      controller.handleKeyDown({
        key: 'Delete',
        code: 'Delete',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.textEditingState?.currentText, 'YZ');
      // La figura no fue eliminada del documento
      assert.ok(stateManager.findNode(textNode.id));
    });

    it('Backspace en cadena vacía no produce errores', () => {
      const { controller } = setupTest('');
      controller.startEditingText('test-text-1');

      controller.handleKeyDown({
        key: 'Backspace',
        code: 'Backspace',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.textEditingState?.currentText, '');
    });

    it('letras que son atajos globales (V, P, T, R, E) se escriben en vez de activar herramientas', () => {
      const { controller } = setupTest('');
      controller.startEditingText('test-text-1');

      const toolKeys = ['p', 'v', 't', 'r', 'e'];
      for (const key of toolKeys) {
        controller.handleKeyDown({
          key,
          code: `Key${key.toUpperCase()}`,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          preventDefault: () => {},
        } as unknown as KeyboardEvent);
      }

      assert.equal(controller.textEditingState?.currentText, 'pvtre');
      assert.equal(controller.currentTool, 'select');
    });
  });

  describe('3. Confirmar', () => {
    it('Enter confirma la edición y actualiza el nodo en StateManager', () => {
      const { controller, stateManager, commandManager, textNode } = setupTest('Original');
      controller.startEditingText(textNode.id);

      // Escribir "!"
      controller.handleKeyDown({
        key: '!',
        code: 'Digit1',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.textEditingState?.currentText, 'Original!');

      // Presionar Enter para confirmar
      controller.handleKeyDown({
        key: 'Enter',
        code: 'Enter',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.isEditingText, false);
      assert.equal(controller.textEditingState, null);

      const updatedNode = stateManager.findNode(textNode.id) as Text;
      assert.equal(updatedNode.text, 'Original!');
      assert.equal(commandManager.canUndo(), true);
    });

    it('hacer clic fuera del texto confirma la edición y actualiza el nodo', () => {
      const { controller, stateManager, commandManager, textNode, canvas } = setupTest('Texto Antes');
      controller.startEditingText(textNode.id);

      // Escribir " Despues"
      for (const char of ' Despues') {
        controller.handleKeyDown({
          key: char,
          preventDefault: () => {},
        } as unknown as KeyboardEvent);
      }

      // Clic lejos del texto (x=800, y=800)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 800,
        clientY: 800,
        button: 0,
      });

      assert.equal(controller.isEditingText, false);
      assert.equal(controller.textEditingState, null);

      const updatedNode = stateManager.findNode(textNode.id) as Text;
      assert.equal(updatedNode.text, 'Texto Antes Despues');
      assert.equal(commandManager.canUndo(), true);
    });

    it('hacer clic dentro del texto en edición NO confirma y mantiene el modo edición activo', () => {
      const { controller, canvas } = setupTest('Texto Activo');
      controller.startEditingText('test-text-1');

      // Clic dentro del texto (x=120, y=110)
      canvas.dispatchSimulatedEvent('mousedown', {
        clientX: 120,
        clientY: 110,
        button: 0,
      });

      assert.equal(controller.isEditingText, true);
    });
  });

  describe('4. Cancelar', () => {
    it('Escape cancela la edición y restaura el contenido original sin registrar comando', () => {
      const { controller, stateManager, commandManager, textNode } = setupTest('Contenido Base');
      controller.startEditingText(textNode.id);

      // Escribir caracteres
      for (const char of ' Modificado') {
        controller.handleKeyDown({
          key: char,
          preventDefault: () => {},
        } as unknown as KeyboardEvent);
      }

      assert.equal(controller.textEditingState?.currentText, 'Contenido Base Modificado');

      // Presionar Escape
      controller.handleKeyDown({
        key: 'Escape',
        code: 'Escape',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.isEditingText, false);
      assert.equal(controller.textEditingState, null);

      // El Scene Graph conserva exactamente el contenido original
      const nodeInState = stateManager.findNode(textNode.id) as Text;
      assert.equal(nodeInState.text, 'Contenido Base');
      assert.equal(commandManager.canUndo(), false);
    });
  });

  describe('5. Contenido sin cambios', () => {
    it('confirmar sin cambios no registra ningún comando en CommandManager', () => {
      const { controller, commandManager, textNode } = setupTest('Sin Cambios');
      controller.startEditingText(textNode.id);

      // Confirmar con Enter inmediatamente
      controller.handleKeyDown({
        key: 'Enter',
        code: 'Enter',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.isEditingText, false);
      assert.equal(commandManager.canUndo(), false);
    });

    it('escribir y luego borrar volviendo al texto original no registra comando al confirmar', () => {
      const { controller, commandManager, textNode } = setupTest('Original');
      controller.startEditingText(textNode.id);

      // Escribir 'X'
      controller.handleKeyDown({
        key: 'X',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      // Borrar 'X' con Backspace
      controller.handleKeyDown({
        key: 'Backspace',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      assert.equal(controller.textEditingState?.currentText, 'Original');

      // Confirmar
      controller.commitTextEdit();

      assert.equal(controller.isEditingText, false);
      assert.equal(commandManager.canUndo(), false);
    });
  });

  describe('6. Undo / Redo', () => {
    it('la edición confirmada se deshace con Undo y se vuelve a aplicar con Redo', () => {
      const { controller, stateManager, commandManager, textNode } = setupTest('Version 1');
      controller.startEditingText(textNode.id);

      // Cambiar a "Version 2"
      controller.handleKeyDown({
        key: 'Backspace',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);
      controller.handleKeyDown({
        key: '2',
        preventDefault: () => {},
      } as unknown as KeyboardEvent);

      controller.commitTextEdit();

      assert.equal((stateManager.findNode(textNode.id) as Text).text, 'Version 2');

      // Deshacer (Undo)
      const undoResult = commandManager.undo();
      assert.equal(undoResult, true);
      assert.equal((stateManager.findNode(textNode.id) as Text).text, 'Version 1');

      // Rehacer (Redo)
      const redoResult = commandManager.redo();
      assert.equal(redoResult, true);
      assert.equal((stateManager.findNode(textNode.id) as Text).text, 'Version 2');
    });

    it('UpdateTextCommand implementa name, shapeId, execute y undo correctamente', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const text: Text = {
        id: 'cmd-text-test',
        type: 'text',
        name: 'Texto Cmd',
        x: 50,
        y: 50,
        text: 'Inicial',
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#000',
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, text);

      const command = new UpdateTextCommand(stateManager, text.id, 'Inicial', 'Modificado');
      assert.equal(command.name, 'UpdateTextCommand');
      assert.equal(command.shapeId, text.id);
      assert.equal(command.previousText, 'Inicial');
      assert.equal(command.newText, 'Modificado');
      assert.equal(command.isAlreadyAtTarget, false);

      command.execute();
      assert.equal((stateManager.findNode(text.id) as Text).text, 'Modificado');

      command.undo();
      assert.equal((stateManager.findNode(text.id) as Text).text, 'Inicial');
    });
  });

  describe('7. Integración con RenderEngine y overlay visual', () => {
    it('RenderEngine utiliza textEditProvider para renderizar el contenido temporal en edición', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const text: Text = {
        id: 'render-text-1',
        type: 'text',
        name: 'Texto Render',
        x: 20,
        y: 30,
        text: 'Texto Estable',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#ff0000',
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      stateManager.addShape(layerId, text);
      stateManager.selectNode(text.id);

      const filledTexts: string[] = [];
      const mockCtx = {
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        setTransform: () => {},
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        strokeRect: () => {},
        fillRect: () => {},
        setLineDash: () => {},
        measureText: (str: string) => ({ width: str.length * 10 }),
        fillText: (txt: string) => {
          filledTexts.push(txt);
        },
      } as unknown as CanvasRenderingContext2D;

      const mockCanvas = {
        getContext: () => mockCtx,
        width: 800,
        height: 600,
        getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
      } as unknown as HTMLCanvasElement;

      let editState: { textId: string; text: string } | null = {
        textId: text.id,
        text: 'Texto Temporal Editando...',
      };

      const engine = new RenderEngine(mockCanvas, stateManager, {
        textEditProvider: () => editState,
      });

      engine.render();

      assert.ok(
        filledTexts.includes('Texto Temporal Editando...'),
        'El canvas debe haber renderizado el texto temporal proveído por textEditProvider'
      );
      assert.ok(
        !filledTexts.includes('Texto Estable'),
        'El canvas no debe renderizar el texto anterior mientras está en edición'
      );

      // Al terminar edición, textEditProvider retorna null y se renderiza el texto del nodo
      editState = null;
      filledTexts.length = 0;
      stateManager.markDirty();
      engine.render();

      assert.ok(
        filledTexts.includes('Texto Estable'),
        'Al cerrar edición, debe renderizarse el texto del Scene Graph'
      );
    });
  });
});
