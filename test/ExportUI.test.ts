import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { setupUIBindings } from '../src/main.ts';
import type { Document } from '../src/types/scene-graph.ts';

import { sanitizeFilename } from '../src/utils/sanitizeFilename.ts';

// Mock DOM elemental para pruebas de UI del diálogo de exportación
function createMockElement(id: string, tag: string = 'div'): any {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const attrs: Record<string, string> = {};
  const dataset: Record<string, string> = {};
  let text = '';
  let val = '';
  let isChecked = false;
  let isDisabled = false;
  let isOpen = false;

  const el = {
    id,
    tagName: tag.toUpperCase(),
    style: { display: '' },
    dataset,
    select: () => {},
    classList: {
      toggle: () => false,
      add: () => {},
      remove: () => {},
      contains: () => false,
    },
    get textContent() {
      return text;
    },
    set textContent(v: string) {
      text = v;
    },
    get value() {
      return val;
    },
    set value(v: string) {
      val = v;
    },
    get checked() {
      return isChecked;
    },
    set checked(v: boolean) {
      isChecked = v;
    },
    get disabled() {
      return isDisabled;
    },
    set disabled(v: boolean) {
      isDisabled = v;
    },
    get open() {
      return isOpen;
    },
    set open(v: boolean) {
      isOpen = v;
    },
    getAttribute: (attr: string) => attrs[attr] ?? null,
    setAttribute: (attr: string, v: string) => {
      attrs[attr] = v;
      if (attr === 'open') isOpen = true;
    },
    removeAttribute: (attr: string) => {
      delete attrs[attr];
      if (attr === 'open') isOpen = false;
    },
    hasAttribute: (attr: string) => attr in attrs,
    addEventListener: (type: string, handler: (e: any) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener: (type: string, handler: (e: any) => void) => {
      listeners[type] = (listeners[type] || []).filter((h) => h !== handler);
    },
    dispatchEvent: (event: { type: string }) => {
      const handlers = listeners[event.type] || [];
      for (const h of handlers) h(event);
      return true;
    },
    click: () => {
      el.dispatchEvent({ type: 'click' });
    },
    focus: () => {},
    blur: () => {},
    showModal: () => {
      isOpen = true;
      attrs['open'] = '';
    },
    close: () => {
      isOpen = false;
      delete attrs['open'];
    },
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  return el;
}

describe('Integración UI de Exportación (Modal y Menús)', () => {
  it('abre el diálogo de exportación al pulsar #menu-item-export-modal y lo cierra con cancelar', () => {
    const elements: Record<string, any> = {
      '#menu-item-export-modal': createMockElement('menu-item-export-modal', 'button'),
      '#menu-item-export-svg': createMockElement('menu-item-export-svg', 'button'),
      '#menu-item-export-png': createMockElement('menu-item-export-png', 'button'),
      '#menu-item-export-webp': createMockElement('menu-item-export-webp', 'button'),
      '#menu-item-export': createMockElement('menu-item-export', 'button'),
      '#menu-item-import': createMockElement('menu-item-import', 'button'),
      '#export-dialog': createMockElement('export-dialog', 'dialog'),
      '#btn-close-export': createMockElement('btn-close-export', 'button'),
      '#btn-cancel-export': createMockElement('btn-cancel-export', 'button'),
      '#btn-confirm-export': createMockElement('btn-confirm-export', 'button'),
      '#group-export-scale': createMockElement('group-export-scale', 'div'),
      '#group-export-background': createMockElement('group-export-background', 'div'),
      '#radio-export-selection': createMockElement('radio-export-selection', 'input'),
      '#text-export-scope-selection': createMockElement('text-export-scope-selection', 'span'),
      '#export-summary-dim': createMockElement('export-summary-dim', 'span'),
      '#export-summary-filename': createMockElement('export-summary-filename', 'span'),
    };

    const docMock = {
      id: 'doc-1',
      name: 'Test Doc',
      type: 'document' as const,
      width: 800,
      height: 600,
      children: [
        {
          id: 'l1',
          name: 'Capa 1',
          type: 'layer' as const,
          children: [
            {
              id: 'r1',
              name: 'Rect 1',
              type: 'rectangle' as const,
              x: 10,
              y: 10,
              width: 100,
              height: 100,
              fill: '#38bdf8',
            },
          ],
        },
      ],
    };

    const origDoc = (globalThis as any).document;
    const documentListeners: Record<string, ((e: any) => void)[]> = {};

    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: (type: string, h: (e: any) => void) => {
        documentListeners[type] = documentListeners[type] || [];
        documentListeners[type].push(h);
      },
      removeEventListener: (type: string, h: (e: any) => void) => {
        documentListeners[type] = (documentListeners[type] || []).filter((l) => l !== h);
      },
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      const dialog = elements['#export-dialog'];
      const btnOpen = elements['#menu-item-export-modal'];
      const btnCancel = elements['#btn-cancel-export'];

      assert.strictEqual(dialog.open, false);

      // 1. Abrir diálogo
      btnOpen.click();
      assert.strictEqual(dialog.open, true);

      // 2. Cerrar con cancelar
      btnCancel.click();
      assert.strictEqual(dialog.open, false);

      // 3. Abrir y cerrar con Escape
      btnOpen.click();
      assert.strictEqual(dialog.open, true);

      const keydownHandlers = documentListeners['keydown'] || [];
      for (const h of keydownHandlers) {
        h({ key: 'Escape', preventDefault: () => {} });
      }
      assert.strictEqual(dialog.open, false);

      // Cleanup
      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('deshabilita la opción de selección si no hay figuras seleccionadas y la habilita si hay selección', () => {
    const radioSelection = createMockElement('radio-export-selection', 'input');
    const textSelection = createMockElement('text-export-scope-selection', 'span');
    const dialog = createMockElement('export-dialog', 'dialog');
    const btnOpen = createMockElement('menu-item-export-modal', 'button');

    const elements: Record<string, any> = {
      '#menu-item-export-modal': btnOpen,
      '#export-dialog': dialog,
      '#radio-export-selection': radioSelection,
      '#text-export-scope-selection': textSelection,
      '#export-summary-dim': createMockElement('export-summary-dim', 'span'),
      '#export-summary-filename': createMockElement('export-summary-filename', 'span'),
    };

    const docMock: Document = {
      id: 'doc-1',
      name: 'Test Doc',
      type: 'document',
      width: 800,
      height: 600,
      children: [
        {
          id: 'l1',
          name: 'Capa 1',
          type: 'layer',
          children: [
            {
              id: 'r1',
              name: 'R1',
              type: 'rectangle',
              x: 0,
              y: 0,
              width: 50,
              height: 50,
            },
          ],
        },
      ],
    };

    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      // Sin selección
      btnOpen.click();
      assert.strictEqual(radioSelection.disabled, true);
      assert.match(textSelection.textContent, /sin selección activa/);

      dialog.close();

      // Con selección
      stateManager.setSelection(['r1']);
      btnOpen.click();
      assert.strictEqual(radioSelection.disabled, false);
      assert.match(textSelection.textContent, /Solo selección \(1 figura\)/);

      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('sanitizeFilename limpia caracteres prohibidos, recorta espacios y remueve extensiones duplicadas', () => {
    assert.strictEqual(sanitizeFilename('mi diseño'), 'mi diseño');
    assert.strictEqual(sanitizeFilename('  mi diseño.svg  '), 'mi diseño');
    assert.strictEqual(sanitizeFilename('proyecto.JSON'), 'proyecto');
    assert.strictEqual(sanitizeFilename('archivo/con:caracteres*malos?'), 'archivo_con_caracteres_malos_');
    assert.strictEqual(sanitizeFilename(''), '');
    assert.strictEqual(sanitizeFilename(null, 'fallback'), 'fallback');
    assert.strictEqual(sanitizeFilename(undefined, 'default-name'), 'default-name');
  });

  it('permite nombrar el archivo en el diálogo de exportación y actualiza el resumen en tiempo real', () => {
    const filenameInput = createMockElement('export-filename-input', 'input');
    const filenameExt = createMockElement('export-filename-extension', 'span');
    const summaryFilename = createMockElement('export-summary-filename', 'span');
    const summaryDim = createMockElement('export-summary-dim', 'span');
    const dialog = createMockElement('export-dialog', 'dialog');
    const btnOpen = createMockElement('menu-item-export-modal', 'button');
    const btnConfirm = createMockElement('btn-confirm-export', 'button');

    const elements: Record<string, any> = {
      '#menu-item-export-modal': btnOpen,
      '#export-dialog': dialog,
      '#export-filename-input': filenameInput,
      '#export-filename-extension': filenameExt,
      '#export-summary-dim': summaryDim,
      '#export-summary-filename': summaryFilename,
      '#btn-confirm-export': btnConfirm,
    };

    const docMock: Document = {
      id: 'doc-1',
      name: 'Logo Empresa',
      type: 'document',
      width: 1200,
      height: 800,
      children: [],
    };

    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      // Abrir diálogo de exportación
      btnOpen.click();

      // Verifica que el nombre por defecto se cargue desde doc.name
      assert.strictEqual(filenameInput.value, 'Logo Empresa');
      assert.match(summaryFilename.textContent, /Archivo: Logo Empresa\.svg/);

      // Cambiar el nombre del archivo manualmente
      filenameInput.value = 'marca-vectorial';
      filenameInput.dispatchEvent({ type: 'input' });

      // El resumen debe reflejar el nombre personalizado en tiempo real
      assert.match(summaryFilename.textContent, /Archivo: marca-vectorial\.svg/);

      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('permite nombrar el archivo antes de guardar JSON mediante el diálogo #save-json-dialog', () => {
    const dialog = createMockElement('save-json-dialog', 'dialog');
    const filenameInput = createMockElement('save-json-filename-input', 'input');
    const btnClose = createMockElement('btn-close-save-json', 'button');
    const btnCancel = createMockElement('btn-cancel-save-json', 'button');
    const btnConfirm = createMockElement('btn-confirm-save-json', 'button');
    const form = createMockElement('form-save-json', 'form');
    const btnMenuSave = createMockElement('menu-item-save-json', 'button');

    const elements: Record<string, any> = {
      '#save-json-dialog': dialog,
      '#save-json-filename-input': filenameInput,
      '#btn-close-save-json': btnClose,
      '#btn-cancel-save-json': btnCancel,
      '#btn-confirm-save-json': btnConfirm,
      '#form-save-json': form,
      '#menu-item-save-json': btnMenuSave,
    };

    const docMock: Document = {
      id: 'doc-1',
      name: 'Mi Proyecto Especial',
      type: 'document',
      width: 1920,
      height: 1080,
      children: [],
    };

    const origDoc = (globalThis as any).document;
    const documentListeners: Record<string, ((e: any) => void)[]> = {};
    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: (type: string, h: (e: any) => void) => {
        documentListeners[type] = documentListeners[type] || [];
        documentListeners[type].push(h);
      },
      removeEventListener: (type: string, h: (e: any) => void) => {
        documentListeners[type] = (documentListeners[type] || []).filter((l) => l !== h);
      },
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      // Clic en Guardar JSON en el menú abre el diálogo
      btnMenuSave.click();
      assert.strictEqual(dialog.open, true);
      assert.strictEqual(filenameInput.value, 'Mi Proyecto Especial');

      // Cancelar cierra el diálogo
      btnCancel.click();
      assert.strictEqual(dialog.open, false);

      // Abrir de nuevo, cambiar nombre y cerrar con Escape
      btnMenuSave.click();
      assert.strictEqual(dialog.open, true);
      const keydownHandlers = documentListeners['keydown'] || [];
      for (const h of keydownHandlers) {
        h({ key: 'Escape', preventDefault: () => {} });
      }
      assert.strictEqual(dialog.open, false);

      // Abrir, personalizar nombre y confirmar guardado
      btnMenuSave.click();
      filenameInput.value = 'escena-final-2026';
      btnConfirm.click();
      assert.strictEqual(dialog.open, false);

      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('permite iniciar el flujo de Nuevo Documento y cancelar el diálogo de confirmación', () => {
    const confirmNewDialog = createMockElement('confirm-new-dialog', 'dialog');
    const btnCloseConfirmNew = createMockElement('btn-close-confirm-new', 'button');
    const btnConfirmNewCancel = createMockElement('btn-confirm-new-cancel', 'button');
    const btnConfirmNewDiscard = createMockElement('btn-confirm-new-discard', 'button');
    const btnConfirmNewSave = createMockElement('btn-confirm-new-save', 'button');
    const newDocumentDialog = createMockElement('new-document-dialog', 'dialog');
    const btnMenuNew = createMockElement('menu-item-new', 'button');

    const elements: Record<string, any> = {
      '#confirm-new-dialog': confirmNewDialog,
      '#btn-close-confirm-new': btnCloseConfirmNew,
      '#btn-confirm-new-cancel': btnConfirmNewCancel,
      '#btn-confirm-new-discard': btnConfirmNewDiscard,
      '#btn-confirm-new-save': btnConfirmNewSave,
      '#new-document-dialog': newDocumentDialog,
      '#menu-item-new': btnMenuNew,
    };

    const docMock: Document = {
      id: 'doc-1',
      name: 'Mi Proyecto',
      type: 'document',
      width: 1920,
      height: 1080,
      children: [],
    };

    const origDoc = (globalThis as any).document;
    const documentListeners: Record<string, ((e: any) => void)[]> = {};
    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: (type: string, h: (e: any) => void) => {
        documentListeners[type] = documentListeners[type] || [];
        documentListeners[type].push(h);
      },
      removeEventListener: (type: string, h: (e: any) => void) => {
        documentListeners[type] = (documentListeners[type] || []).filter((l) => l !== h);
      },
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      // Clic en Nuevo en el menú abre el diálogo de confirmación
      btnMenuNew.click();
      assert.strictEqual(confirmNewDialog.open, true);
      assert.strictEqual(newDocumentDialog.open, false);

      // Cancelar con el botón Cancelar cierra el diálogo y no abre el selector de tamaño
      btnConfirmNewCancel.click();
      assert.strictEqual(confirmNewDialog.open, false);
      assert.strictEqual(newDocumentDialog.open, false);

      // Reabrir y cerrar con Escape
      btnMenuNew.click();
      assert.strictEqual(confirmNewDialog.open, true);
      const keydownHandlers = documentListeners['keydown'] || [];
      for (const h of keydownHandlers) {
        h({ key: 'Escape', preventDefault: () => {} });
      }
      assert.strictEqual(confirmNewDialog.open, false);
      assert.strictEqual(newDocumentDialog.open, false);

      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('permite crear un nuevo documento eligiendo "No guardar" y seleccionando el preset 1080x1350', () => {
    const confirmNewDialog = createMockElement('confirm-new-dialog', 'dialog');
    const btnConfirmNewDiscard = createMockElement('btn-confirm-new-discard', 'button');
    const newDocumentDialog = createMockElement('new-document-dialog', 'dialog');
    const newDocPreset = createMockElement('new-doc-preset', 'select');
    const newDocWidth = createMockElement('new-doc-width', 'input');
    const newDocHeight = createMockElement('new-doc-height', 'input');
    const btnConfirmNewDoc = createMockElement('btn-confirm-new-doc', 'button');
    const formNewDocument = createMockElement('form-new-document', 'form');
    const btnMenuNew = createMockElement('menu-item-new', 'button');

    const elements: Record<string, any> = {
      '#confirm-new-dialog': confirmNewDialog,
      '#btn-confirm-new-discard': btnConfirmNewDiscard,
      '#new-document-dialog': newDocumentDialog,
      '#new-doc-preset': newDocPreset,
      '#new-doc-width': newDocWidth,
      '#new-doc-height': newDocHeight,
      '#btn-confirm-new-doc': btnConfirmNewDoc,
      '#form-new-document': formNewDocument,
      '#menu-item-new': btnMenuNew,
    };

    const docMock: Document = {
      id: 'doc-1',
      name: 'Proyecto Viejo',
      type: 'document',
      width: 800,
      height: 600,
      children: [],
    };

    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      btnMenuNew.click();
      assert.strictEqual(confirmNewDialog.open, true);

      // Clic en "No guardar" cierra confirmación y abre configuración de mesa de trabajo
      btnConfirmNewDiscard.click();
      assert.strictEqual(confirmNewDialog.open, false);
      assert.strictEqual(newDocumentDialog.open, true);

      // Seleccionar preset 1080x1350 (portrait-4-5)
      newDocPreset.value = 'portrait-4-5';
      newDocPreset.dispatchEvent({ type: 'change' });
      assert.strictEqual(newDocWidth.value, '1080');
      assert.strictEqual(newDocHeight.value, '1350');

      // Confirmar creación
      btnConfirmNewDoc.click();
      assert.strictEqual(newDocumentDialog.open, false);

      const newDoc = stateManager.getState();
      assert.strictEqual(newDoc.width, 1080);
      assert.strictEqual(newDoc.height, 1350);
      assert.strictEqual(newDoc.name, 'Nuevo Documento');
      assert.strictEqual(commandManager.canUndo(), false);
      assert.strictEqual(stateManager.getSelection().length, 0);

      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('permite crear un nuevo documento con preset historia 1080x1920 tras guardar JSON', () => {
    const confirmNewDialog = createMockElement('confirm-new-dialog', 'dialog');
    const btnConfirmNewSave = createMockElement('btn-confirm-new-save', 'button');
    const saveJsonDialog = createMockElement('save-json-dialog', 'dialog');
    const saveJsonFilenameInput = createMockElement('save-json-filename-input', 'input');
    const btnConfirmSaveJson = createMockElement('btn-confirm-save-json', 'button');
    const formSaveJson = createMockElement('form-save-json', 'form');
    const newDocumentDialog = createMockElement('new-document-dialog', 'dialog');
    const newDocPreset = createMockElement('new-doc-preset', 'select');
    const newDocWidth = createMockElement('new-doc-width', 'input');
    const newDocHeight = createMockElement('new-doc-height', 'input');
    const btnConfirmNewDoc = createMockElement('btn-confirm-new-doc', 'button');
    const formNewDocument = createMockElement('form-new-document', 'form');
    const btnMenuNew = createMockElement('menu-item-new', 'button');

    const elements: Record<string, any> = {
      '#confirm-new-dialog': confirmNewDialog,
      '#btn-confirm-new-save': btnConfirmNewSave,
      '#save-json-dialog': saveJsonDialog,
      '#save-json-filename-input': saveJsonFilenameInput,
      '#btn-confirm-save-json': btnConfirmSaveJson,
      '#form-save-json': formSaveJson,
      '#new-document-dialog': newDocumentDialog,
      '#new-doc-preset': newDocPreset,
      '#new-doc-width': newDocWidth,
      '#new-doc-height': newDocHeight,
      '#btn-confirm-new-doc': btnConfirmNewDoc,
      '#form-new-document': formNewDocument,
      '#menu-item-new': btnMenuNew,
    };

    const docMock: Document = {
      id: 'doc-1',
      name: 'Boceto Inicial',
      type: 'document',
      width: 500,
      height: 500,
      children: [],
    };

    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      activeElement: null,
    };

    try {
      const commandManager = new CommandManager();
      const stateManager = new StateManager(docMock, commandManager);
      const inputController = new InputController(
        { width: 800, height: 600, addEventListener: () => {}, removeEventListener: () => {} } as any,
        stateManager,
        commandManager,
        { enableKeyboardShortcuts: false }
      );

      const bindings = setupUIBindings(inputController, commandManager, stateManager);

      btnMenuNew.click();
      assert.strictEqual(confirmNewDialog.open, true);

      // Clic en "Guardar" abre el diálogo de Guardar JSON
      btnConfirmNewSave.click();
      assert.strictEqual(confirmNewDialog.open, false);
      assert.strictEqual(saveJsonDialog.open, true);

      // Guardar el JSON abre a continuación el diálogo de Nuevo Documento
      btnConfirmSaveJson.click();
      assert.strictEqual(saveJsonDialog.open, false);
      assert.strictEqual(newDocumentDialog.open, true);

      // Seleccionar preset historia 9:16 (1080x1920)
      newDocPreset.value = 'story-9-16';
      newDocPreset.dispatchEvent({ type: 'change' });
      assert.strictEqual(newDocWidth.value, '1080');
      assert.strictEqual(newDocHeight.value, '1920');

      // Confirmar creación
      btnConfirmNewDoc.click();
      assert.strictEqual(newDocumentDialog.open, false);

      const newDoc = stateManager.getState();
      assert.strictEqual(newDoc.width, 1080);
      assert.strictEqual(newDoc.height, 1920);
      assert.strictEqual(newDoc.name, 'Nuevo Documento');

      bindings.cleanup();
    } finally {
      (globalThis as any).document = origDoc;
    }
  });
});
