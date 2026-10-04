import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { TranslateCommand } from '../src/commands/TranslateCommand.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Rectangle } from '../src/types/scene-graph.ts';

// Mock de elemento DOM con soporte de classList y listeners
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public files: any[] = [];
  public clickCount: number = 0;
  public style: Record<string, string> = {};
  private attributes: Map<string, string> = new Map();
  private classes: Set<string> = new Set();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string, tagName: string = 'button') {
    this.id = id;
    this.tagName = tagName;
  }

  public get classList() {
    return {
      add: (cls: string) => this.classes.add(cls),
      remove: (cls: string) => this.classes.delete(cls),
      contains: (cls: string) => this.classes.has(cls),
      toggle: (cls: string, force?: boolean) => {
        if (force !== undefined) {
          if (force) this.classes.add(cls);
          else this.classes.delete(cls);
          return force;
        }
        if (this.classes.has(cls)) {
          this.classes.delete(cls);
          return false;
        }
        this.classes.add(cls);
        return true;
      },
    };
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public addEventListener(event: string, listener: (e: any) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  public removeEventListener(event: string, listener: (e: any) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  public click(): void {
    this.clickCount++;
    const set = this.listeners.get('click');
    if (set) {
      for (const listener of set) {
        listener({ type: 'click', target: this, stopPropagation: () => {} });
      }
    }
  }

  public dispatchEvent(e: any): void {
    if (!e.stopPropagation) {
      e.stopPropagation = () => {};
    }
    const set = this.listeners.get(e.type);
    if (set) {
      for (const listener of set) {
        listener(e);
      }
    }
  }
}

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  } as unknown as HTMLCanvasElement;
}

describe('Observabilidad DOM <-> Estado (setupUIBindings)', () => {
  it('sincroniza clases .active en botones de herramienta mediante Event Emitter de InputController', () => {
    const btnSelect = new MockElement('tool-select');
    const btnDirectSelect = new MockElement('tool-direct-select');
    const btnPen = new MockElement('tool-pen');
    const btnRectangle = new MockElement('tool-rectangle');
    const btnEllipse = new MockElement('tool-ellipse');
    const btnUndo = new MockElement('btn-undo');
    const btnRedo = new MockElement('btn-redo');
    const statusLabel = new MockElement('status-tool-label', 'span');

    const domMap: Record<string, MockElement> = {
      '#tool-select': btnSelect,
      '#tool-direct-select': btnDirectSelect,
      '#tool-pen': btnPen,
      '#tool-rectangle': btnRectangle,
      '#tool-ellipse': btnEllipse,
      '#btn-undo': btnUndo,
      '#btn-redo': btnRedo,
      '#status-tool-label': statusLabel,
    };

    // Mock global document
    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const { cleanup } = setupUIBindings(inputController, commandManager);

    // 1. Estado inicial: Selección activa
    assert.equal(btnSelect.classList.contains('active'), true);
    assert.equal(btnDirectSelect.classList.contains('active'), false);
    assert.equal(btnPen.classList.contains('active'), false);
    assert.equal(btnRectangle.classList.contains('active'), false);
    assert.equal(btnEllipse.classList.contains('active'), false);
    assert.equal(btnSelect.getAttribute('aria-pressed'), 'true');
    assert.equal(btnDirectSelect.getAttribute('aria-pressed'), 'false');
    assert.equal(btnPen.getAttribute('aria-pressed'), 'false');
    assert.equal(btnRectangle.getAttribute('aria-pressed'), 'false');
    assert.equal(btnEllipse.getAttribute('aria-pressed'), 'false');

    // 2. Cambiar herramienta a direct-select
    inputController.setTool('direct-select');
    assert.equal(btnSelect.classList.contains('active'), false);
    assert.equal(btnDirectSelect.classList.contains('active'), true);
    assert.equal(btnPen.classList.contains('active'), false);
    assert.equal(btnDirectSelect.getAttribute('aria-pressed'), 'true');
    assert.equal(statusLabel.textContent, 'Modo: Selección Directa');

    // 3. Cambiar herramienta a pen
    inputController.setTool('pen');
    assert.equal(btnSelect.classList.contains('active'), false);
    assert.equal(btnDirectSelect.classList.contains('active'), false);
    assert.equal(btnPen.classList.contains('active'), true);
    assert.equal(btnPen.getAttribute('aria-pressed'), 'true');
    assert.equal(statusLabel.textContent, 'Modo: Pluma (Bézier)');

    // 4. Cambiar herramienta a rectangle
    inputController.setTool('rectangle');
    assert.equal(btnPen.classList.contains('active'), false);
    assert.equal(btnRectangle.classList.contains('active'), true);
    assert.equal(btnRectangle.getAttribute('aria-pressed'), 'true');
    assert.equal(statusLabel.textContent, 'Modo: Rectángulo');

    // 5. Cambiar herramienta a ellipse
    inputController.setTool('ellipse');
    assert.equal(btnRectangle.classList.contains('active'), false);
    assert.equal(btnEllipse.classList.contains('active'), true);
    assert.equal(btnEllipse.getAttribute('aria-pressed'), 'true');
    assert.equal(statusLabel.textContent, 'Modo: Elipse');

    // 6. Clic en botón HTML Rectángulo -> activa herramienta en InputController
    btnRectangle.click();
    assert.equal(inputController.currentTool, 'rectangle');
    assert.equal(btnRectangle.classList.contains('active'), true);
    assert.equal(statusLabel.textContent, 'Modo: Rectángulo');

    // 7. Clic en botón HTML Elipse -> activa herramienta en InputController
    btnEllipse.click();
    assert.equal(inputController.currentTool, 'ellipse');
    assert.equal(btnEllipse.classList.contains('active'), true);
    assert.equal(statusLabel.textContent, 'Modo: Elipse');

    // 8. Clic en botón HTML Selección Directa -> activa herramienta en InputController
    btnDirectSelect.click();
    assert.equal(inputController.currentTool, 'direct-select');
    assert.equal(btnDirectSelect.classList.contains('active'), true);

    // 9. Clic en botón HTML Selección -> activa herramienta en InputController y actualiza DOM
    btnSelect.click();
    assert.equal(inputController.currentTool, 'select');
    assert.equal(btnSelect.classList.contains('active'), true);
    assert.equal(btnDirectSelect.classList.contains('active'), false);
    assert.equal(btnPen.classList.contains('active'), false);
    assert.equal(btnRectangle.classList.contains('active'), false);
    assert.equal(btnEllipse.classList.contains('active'), false);

    cleanup();

    // Tras cleanup, los clics en botones HTML ya no deben alterar InputController
    btnRectangle.click();
    assert.equal(inputController.currentTool, 'select', 'Cleanup debe desvincular el listener de btnRectangle');
    btnEllipse.click();
    assert.equal(inputController.currentTool, 'select', 'Cleanup debe desvincular el listener de btnEllipse');

    inputController.destroy();
    delete (globalThis as any).document;
  });

  it('habilita y deshabilita botones Deshacer/Rehacer mediante clases CSS (.disabled) según CommandManager', () => {
    const btnSelect = new MockElement('tool-select');
    const btnPen = new MockElement('tool-pen');
    const btnUndo = new MockElement('btn-undo');
    const btnRedo = new MockElement('btn-redo');
    const statusLabel = new MockElement('status-tool-label', 'span');

    const domMap: Record<string, MockElement> = {
      '#tool-select': btnSelect,
      '#tool-pen': btnPen,
      '#btn-undo': btnUndo,
      '#btn-redo': btnRedo,
      '#status-tool-label': statusLabel,
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const rect: Rectangle = {
      id: 'cmd-rect',
      type: 'rectangle',
      name: 'Rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);

    const { cleanup } = setupUIBindings(inputController, commandManager);

    // 1. Estado inicial sin historial: ambos deshabilitados
    assert.equal(btnUndo.classList.contains('disabled'), true);
    assert.equal(btnUndo.disabled, true);
    assert.equal(btnRedo.classList.contains('disabled'), true);
    assert.equal(btnRedo.disabled, true);

    // 2. Ejecutar un comando -> habilita Deshacer
    commandManager.executeCommand(new TranslateCommand(stateManager, 'cmd-rect', 0, 0, 10, 10));
    assert.equal(btnUndo.classList.contains('disabled'), false);
    assert.equal(btnUndo.disabled, false);
    assert.equal(btnRedo.classList.contains('disabled'), true);
    assert.equal(btnRedo.disabled, true);

    // 3. Clic en botón HTML Deshacer -> ejecuta undo() y habilita Rehacer
    btnUndo.click();
    assert.equal(btnUndo.classList.contains('disabled'), true);
    assert.equal(btnUndo.disabled, true);
    assert.equal(btnRedo.classList.contains('disabled'), false);
    assert.equal(btnRedo.disabled, false);

    // 4. Clic en botón HTML Rehacer -> ejecuta redo() y rehabilita Deshacer
    btnRedo.click();
    assert.equal(btnUndo.classList.contains('disabled'), false);
    assert.equal(btnUndo.disabled, false);
    assert.equal(btnRedo.classList.contains('disabled'), true);
    assert.equal(btnRedo.disabled, true);

    cleanup();
    inputController.destroy();
    delete (globalThis as any).document;
  });

  it('vincula #btn-export y #btn-import para exportación y carga de archivos JSON con FileReader', async () => {
    // Mock de FileReader
    class MockFileReader {
      public result: string | null = null;
      public onload: ((e: any) => void) | null = null;
      public onerror: ((e: any) => void) | null = null;

      public readAsText(blob: any): void {
        if (typeof blob.text === 'function') {
          blob.text().then((text: string) => {
            this.result = text;
            this.onload?.({ target: this });
          });
        } else {
          this.result = String(blob);
          setTimeout(() => this.onload?.({ target: this }), 0);
        }
      }
    }

    (globalThis as any).FileReader = MockFileReader;

    const btnExport = new MockElement('btn-export');
    const btnImport = new MockElement('btn-import');
    const fileInput = new MockElement('file-import-input', 'input');
    const noSelectionState = new MockElement('no-selection-state', 'div');
    const selectionState = new MockElement('selection-state', 'div');
    const statusShapesCount = new MockElement('status-shapes-count', 'span');
    const statusSelectionInfo = new MockElement('status-selection-info', 'span');
    const menuItemCopy = new MockElement('menu-item-copy', 'button');
    const menuItemDelete = new MockElement('menu-item-delete', 'button');

    const domMap: Record<string, MockElement> = {
      '#btn-export, #btn-export-json': btnExport,
      '#btn-export': btnExport,
      '#btn-import': btnImport,
      '#file-import-input': fileInput,
      '#no-selection-state': noSelectionState,
      '#selection-state': selectionState,
      '#status-shapes-count': statusShapesCount,
      '#status-selection-info': statusSelectionInfo,
      '#menu-item-copy': menuItemCopy,
      '#menu-item-delete': menuItemDelete,
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
      querySelectorAll: () => [],
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    // Agregar un comando al historial antes de importar
    const rect: Rectangle = {
      id: 'pre-import-rect',
      type: 'rectangle',
      name: 'Pre Import Rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    commandManager.executeCommand(new TranslateCommand(stateManager, 'pre-import-rect', 0, 0, 5, 5));
    assert.equal(commandManager.canUndo(), true);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Seleccionar una figura antes de importar
    stateManager.selectNode('pre-import-rect');
    assert.equal(selectionState.style.display, 'block');
    assert.equal(noSelectionState.style.display, 'none');

    // 1. Clic en #btn-export (no debe lanzar error y serializa el estado)
    btnExport.click();

    // 2. Clic en #btn-import dispara click en #file-import-input
    assert.equal(fileInput.clickCount, 0);
    btnImport.click();
    assert.equal(fileInput.clickCount, 1);

    // 3. Simular selección de archivo JSON en #file-import-input (con figuras y mismo id si se diera el caso)
    const validJsonDoc = {
      id: 'doc-imported',
      type: 'document',
      name: 'Imported Scene',
      width: 1920,
      height: 1080,
      children: [
        {
          id: 'layer-imported',
          type: 'layer',
          name: 'Capa Importada',
          children: [
            {
              id: 'pre-import-rect',
              type: 'rectangle',
              name: 'Imported Rect',
              x: 10,
              y: 10,
              width: 100,
              height: 50,
            },
            {
              id: 'imported-rect-2',
              type: 'rectangle',
              name: 'Imported Rect 2',
              x: 200,
              y: 200,
              width: 50,
              height: 50,
            },
          ],
        },
      ],
    };

    fileInput.files = [
      {
        name: 'test.json',
        text: async () => JSON.stringify(validJsonDoc),
      },
    ];

    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Esperar microtareas asíncronas de FileReader, parseDocument y loadState
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verificar que el estado del StateManager se actualizó
    assert.equal(stateManager.getState().id, 'doc-imported');
    assert.equal(stateManager.getState().name, 'Imported Scene');

    // Verificar que la selección quedó completamente vacía a pesar de compartir el ID 'pre-import-rect'
    assert.deepEqual(stateManager.getSelection(), []);
    assert.equal(stateManager.getSelectedNode(), null);

    // Verificar que el panel de propiedades quedó en "Sin selección"
    assert.equal(noSelectionState.style.display, 'block');
    assert.equal(selectionState.style.display, 'none');

    // Verificar que la barra de estado contó correctamente las figuras y no muestra selección
    assert.equal(statusShapesCount.textContent, '2 figuras');
    assert.equal(statusSelectionInfo.style.display, 'none');

    // Verificar que los ítems de menú dependientes de selección quedaron deshabilitados
    assert.equal(menuItemCopy.disabled, true);
    assert.equal(menuItemDelete.disabled, true);

    // Verificar que commandManager.clear() reinició el historial
    assert.equal(commandManager.canUndo(), false);
    assert.equal(commandManager.canRedo(), false);

    cleanup();
    inputController.destroy();
    delete (globalThis as any).document;
    delete (globalThis as any).FileReader;
  });

  it('sincroniza el panel de propiedades al seleccionar figura y oculta cuando no hay selección', () => {
    const noSelectionState = new MockElement('no-selection-state', 'div');
    const selectionState = new MockElement('selection-state', 'div');
    const inputFill = new MockElement('input-fill', 'input');
    const inputStroke = new MockElement('input-stroke', 'input');
    const inputStrokeWidth = new MockElement('input-stroke-width', 'input');

    const domMap: Record<string, MockElement> = {
      '#no-selection-state': noSelectionState,
      '#selection-state': selectionState,
      '#input-fill': inputFill,
      '#input-stroke': inputStroke,
      '#input-stroke-width': inputStrokeWidth,
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const rect: Rectangle = {
      id: 'prop-rect',
      type: 'rectangle',
      name: 'Prop Rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: 'transparent',
      stroke: '#ff00aa',
      strokeWidth: 4,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Inicialmente sin selección
    assert.equal(selectionState.style.display, 'none');
    assert.equal(noSelectionState.style.display, 'block');

    // Seleccionar figura
    stateManager.selectNode('prop-rect');
    assert.equal(selectionState.style.display, 'block');
    assert.equal(noSelectionState.style.display, 'none');
    assert.equal(inputFill.value, '#000000', 'transparent debe convertirse en hex code válido');
    assert.equal(inputStroke.value, '#ff00aa');
    assert.equal(inputStrokeWidth.value, '4');

    // Deseleccionar
    stateManager.selectNode(null);
    assert.equal(selectionState.style.display, 'none');
    assert.equal(noSelectionState.style.display, 'block');

    cleanup();
    inputController.destroy();
    delete (globalThis as any).document;
  });

  it('panel de propiedades: evento input hace previsualización en vivo y change registra StyleCommand con undo/redo', () => {
    const noSelectionState = new MockElement('no-selection-state', 'div');
    const selectionState = new MockElement('selection-state', 'div');
    const inputFill = new MockElement('input-fill', 'input');
    const inputStroke = new MockElement('input-stroke', 'input');
    const inputStrokeWidth = new MockElement('input-stroke-width', 'input');

    const domMap: Record<string, MockElement> = {
      '#no-selection-state': noSelectionState,
      '#selection-state': selectionState,
      '#input-fill': inputFill,
      '#input-stroke': inputStroke,
      '#input-stroke-width': inputStrokeWidth,
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);

    const rect: Rectangle = {
      id: 'style-edit-rect',
      type: 'rectangle',
      name: 'Edit Rect',
      x: 10,
      y: 10,
      width: 60,
      height: 60,
      fill: '#123456',
      stroke: '#654321',
      strokeWidth: 2,
    };
    stateManager.addShape(stateManager.getState().children[0].id, rect);
    stateManager.selectNode('style-edit-rect');

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // 1. Simular mousedown en inputFill para capturar estilo inicial
    inputFill.dispatchEvent({ type: 'mousedown' });

    // 2. Evento input -> previsualización en vivo sin registrar comando
    inputFill.value = '#00ff00';
    inputFill.dispatchEvent({ type: 'input' });

    let currentShape = stateManager.findNode('style-edit-rect') as Rectangle;
    assert.equal(currentShape.fill, '#00ff00');
    assert.equal(commandManager.undoCount, 0, 'No debe registrar comando durante input');

    // 3. Evento change -> consolidación y registro en CommandManager
    inputFill.value = '#33cc33';
    inputFill.dispatchEvent({ type: 'change' });

    currentShape = stateManager.findNode('style-edit-rect') as Rectangle;
    assert.equal(currentShape.fill, '#33cc33');
    assert.equal(commandManager.undoCount, 1, 'Debe registrar 1 comando tras change');

    // 4. Undo -> restaura valor previo a la interacción (#123456)
    assert.equal(commandManager.undo(), true);
    currentShape = stateManager.findNode('style-edit-rect') as Rectangle;
    assert.equal(currentShape.fill, '#123456');

    // 5. Redo -> re-aplica el valor consolidado (#33cc33)
    assert.equal(commandManager.redo(), true);
    currentShape = stateManager.findNode('style-edit-rect') as Rectangle;
    assert.equal(currentShape.fill, '#33cc33');

    cleanup();
    inputController.destroy();
    delete (globalThis as any).document;
  });

  it('conecta botones #btn-bring-to-front y #btn-send-to-back en setupUIBindings y cleanup() remueve los listeners', () => {
    const btnBringToFront = new MockElement('btn-bring-to-front');
    const btnSendToBack = new MockElement('btn-send-to-back');

    const domMap: Record<string, MockElement> = {
      '#btn-bring-to-front': btnBringToFront,
      '#btn-send-to-back': btnSendToBack,
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => domMap[selector] || null,
    };

    const stateManager = new StateManager();
    const commandManager = new CommandManager();
    const canvas = createMockCanvas();
    const inputController = new InputController(canvas, stateManager, commandManager);
    const layerId = stateManager.getState().children[0].id;

    const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 0, width: 10, height: 10 };
    const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 10, y: 10, width: 10, height: 10 };
    const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 20, y: 20, width: 10, height: 10 };
    stateManager.addShape(layerId, r1);
    stateManager.addShape(layerId, r2);
    stateManager.addShape(layerId, r3);

    const getIds = () => stateManager.getState().children[0].children.map((s) => s.id);
    assert.deepEqual(getIds(), ['r1', 'r2', 'r3']);

    const { cleanup } = setupUIBindings(inputController, commandManager, stateManager);

    // Seleccionar r1 y hacer clic en Traer al frente
    stateManager.selectNode('r1');
    btnBringToFront.click();
    assert.deepEqual(getIds(), ['r2', 'r3', 'r1']);
    assert.equal(commandManager.undoCount, 1);

    // Clic en Enviar al fondo sobre r1
    btnSendToBack.click();
    assert.deepEqual(getIds(), ['r1', 'r2', 'r3']);
    assert.equal(commandManager.undoCount, 2);

    // Ejecutar cleanup() y verificar que los listeners se removieron
    cleanup();

    btnBringToFront.click();
    assert.deepEqual(getIds(), ['r1', 'r2', 'r3'], 'El orden no debe cambiar tras invocar cleanup()');
    assert.equal(commandManager.undoCount, 2);

    btnSendToBack.click();
    assert.deepEqual(getIds(), ['r1', 'r2', 'r3'], 'El orden no debe cambiar tras invocar cleanup()');
    assert.equal(commandManager.undoCount, 2);

    inputController.destroy();
    delete (globalThis as any).document;
  });
});

