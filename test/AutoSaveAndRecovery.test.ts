import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { AddShapeCommand } from '../src/commands/AddShapeCommand.ts';
import { DEFAULT_DOCUMENT } from '../src/state/defaultDocument.ts';
import {
  MemoryStorageAdapter,
  LocalStorageAdapter,
  createStorageAdapter,
} from '../src/utils/storage.ts';
import {
  AutoSaveManager,
  countDocumentShapes,
  CURRENT_AUTOSAVE_SCHEMA_VERSION,
  type AutoSaveSession,
  type AutoSaveStatus,
} from '../src/state/AutoSaveManager.ts';
import {
  setupRecoveryDialogBindings,
  formatBackupTimestamp,
} from '../src/ui/RecoveryDialogController.ts';
import { setupStatusBarBindings } from '../src/ui/StatusBarController.ts';
import { ViewportManager } from '../src/utils/viewport.ts';
import { InputController } from '../src/input/InputController.ts';
import type { Document, Rectangle, Ellipse } from '../src/types/scene-graph.ts';

// Mock simple de MockElement para pruebas de DOM
class MockElement {
  public id: string;
  public tagName: string;
  public disabled: boolean = false;
  public hidden: boolean = false;
  public textContent: string = '';
  public value: string = '';
  public open: boolean = false;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  private classes: Set<string> = new Set();
  private attributes: Map<string, string> = new Map();
  private listeners: Map<string, Set<(e: any) => void>> = new Map();

  constructor(id: string = '', tagName: string = 'div') {
    this.id = id;
    this.tagName = tagName;
  }

  public get classList() {
    return {
      add: (...tokens: string[]) => tokens.forEach((cls) => this.classes.add(cls)),
      remove: (...tokens: string[]) => tokens.forEach((cls) => this.classes.delete(cls)),
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
    if (name === 'open') {
      this.open = true;
    }
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'open') {
      this.open = false;
    }
  }

  public addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatchEvent(event: any): boolean {
    const list = this.listeners.get(event.type);
    if (list) {
      list.forEach((cb) => cb(event));
    }
    return true;
  }

  public click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  public showModal(): void {
    this.open = true;
    this.setAttribute('open', '');
  }

  public close(): void {
    this.open = false;
    this.removeAttribute('open');
  }

  public focus(): void {}
}

describe('3.3. Persistencia y Autoguardado Local (Auto-Save & Recovery)', () => {
  describe('1. Adaptadores de Almacenamiento (StorageAdapter)', () => {
    it('MemoryStorageAdapter realiza operaciones CRUD en memoria', async () => {
      const storage = new MemoryStorageAdapter();

      assert.equal(await storage.getItem('clave'), null);

      await storage.setItem('clave', 'valor1');
      assert.equal(await storage.getItem('clave'), 'valor1');

      await storage.setItem('clave', 'valor2');
      assert.equal(await storage.getItem('clave'), 'valor2');

      await storage.removeItem('clave');
      assert.equal(await storage.getItem('clave'), null);

      await storage.setItem('a', '1');
      await storage.setItem('b', '2');
      await storage.clear();
      assert.equal(await storage.getItem('a'), null);
      assert.equal(await storage.getItem('b'), null);
    });

    it('LocalStorageAdapter delega en el objeto Storage con captura segura de errores', async () => {
      const mockStorageMap = new Map<string, string>();
      const customStorage: Storage = {
        length: 0,
        clear: () => mockStorageMap.clear(),
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        key: () => null,
        removeItem: (k: string) => {
          mockStorageMap.delete(k);
        },
        setItem: (k: string, v: string) => {
          if (k === 'error_trigger') {
            throw new Error('QuotaExceededError');
          }
          mockStorageMap.set(k, String(v));
        },
      };

      const adapter = new LocalStorageAdapter(customStorage);
      await adapter.setItem('test_key', 'test_val');
      assert.equal(await adapter.getItem('test_key'), 'test_val');

      await adapter.removeItem('test_key');
      assert.equal(await adapter.getItem('test_key'), null);

      await assert.rejects(async () => {
        await adapter.setItem('error_trigger', 'data');
      }, /QuotaExceededError/);
    });

    it('createStorageAdapter retorna MemoryStorageAdapter si se solicita preferred="memory"', () => {
      const adapter = createStorageAdapter('memory');
      assert.ok(adapter instanceof MemoryStorageAdapter);
    });
  });

  describe('2. Gestor de Autoguardado (AutoSaveManager)', () => {
    let memoryStorage: MemoryStorageAdapter;
    let stateManager: StateManager;
    let commandManager: CommandManager;

    beforeEach(() => {
      memoryStorage = new MemoryStorageAdapter();
      commandManager = new CommandManager();
      stateManager = new StateManager(DEFAULT_DOCUMENT, commandManager);
    });

    it('countDocumentShapes cuenta adecuadamente figuras en todas las capas', () => {
      const doc: Document = {
        id: 'doc-1',
        type: 'document',
        name: 'Test',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Capa 1',
            visible: true,
            locked: false,
            opacity: 1,
            children: [
              {
                id: 'rect-1',
                type: 'rectangle',
                name: 'Rect',
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                rotation: 0,
                opacity: 1,
                visible: true,
                locked: false,
                zIndex: 0,
              } as Rectangle,
            ],
          },
          {
            id: 'l2',
            type: 'layer',
            name: 'Capa 2',
            visible: true,
            locked: false,
            opacity: 1,
            children: [
              {
                id: 'ell-1',
                type: 'ellipse',
                name: 'Ellipse',
                x: 20,
                y: 20,
                radiusX: 10,
                radiusY: 10,
                rotation: 0,
                opacity: 1,
                visible: true,
                locked: false,
                zIndex: 0,
              } as Ellipse,
            ],
          },
        ],
      };

      assert.equal(countDocumentShapes(doc), 2);
      assert.equal(countDocumentShapes(null), 0);
    });

    it('saveImmediate guarda la sesión con metadatos y schema version', async () => {
      const manager = new AutoSaveManager(stateManager, {
        storage: memoryStorage,
        storageKey: 'test_autosave',
      });

      const session = await manager.saveImmediate();
      assert.ok(session);
      assert.equal(session.schemaVersion, CURRENT_AUTOSAVE_SCHEMA_VERSION);
      assert.ok(session.timestamp > 0);
      assert.equal(session.documentName, DEFAULT_DOCUMENT.name);
      assert.equal(session.dimensions.width, DEFAULT_DOCUMENT.width);
      assert.equal(session.dimensions.height, DEFAULT_DOCUMENT.height);
      assert.equal(manager.getStatus(), 'saved');

      const saved = await manager.getSavedSession();
      assert.ok(saved);
      assert.equal(saved.documentName, DEFAULT_DOCUMENT.name);
      assert.equal(saved.shapesCount, session.shapesCount);
    });

    it('scheduleSave programa guardado debounced y emite cambios de estado saving -> saved', async () => {
      const statuses: AutoSaveStatus[] = [];
      let savedSessionEmitted: any = null;

      const manager = new AutoSaveManager(stateManager, {
        storage: memoryStorage,
        storageKey: 'test_autosave',
        debounceMs: 50,
        onStatusChange: (s) => statuses.push(s),
        onSessionSaved: (s) => {
          savedSessionEmitted = s;
        },
      });

      manager.start();

      // Agregar una figura para mutar el StateManager
      const rect: Rectangle = {
        id: 'rect-auto-1',
        type: 'rectangle',
        name: 'Rect Auto',
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
      };

      const layerId = stateManager.getState().children[0].id;
      commandManager.executeCommand(new AddShapeCommand(stateManager, rect, layerId));

      assert.ok(statuses.includes('saving'));
      assert.equal(manager.getStatus(), 'saving');

      // Esperar a que el debounce expire
      await new Promise((res) => setTimeout(res, 80));

      assert.equal(manager.getStatus(), 'saved');
      assert.ok(statuses.includes('saved'));
      assert.ok(savedSessionEmitted);
      assert.equal((savedSessionEmitted as any).documentName, DEFAULT_DOCUMENT.name);

      manager.stop();
    });

    it('flush ejecuta inmediatamente el guardado si hay una operación pendiente', async () => {
      const manager = new AutoSaveManager(stateManager, {
        storage: memoryStorage,
        storageKey: 'test_autosave',
        debounceMs: 5000, // Alto para verificar flush inmediato
      });

      manager.start();
      manager.scheduleSave();
      assert.equal(manager.getStatus(), 'saving');

      await manager.flush();
      assert.equal(manager.getStatus(), 'saved');

      const session = await manager.getSavedSession();
      assert.ok(session);

      manager.stop();
    });

    it('hasRecoverableSession detecta correctamente si hay cambios para restaurar', async () => {
      const manager = new AutoSaveManager(stateManager, {
        storage: memoryStorage,
        storageKey: 'test_autosave',
      });

      // Sin sesión previa
      assert.equal(await manager.hasRecoverableSession(), false);

      // Guardar el documento por defecto
      await manager.saveImmediate();

      // El documento guardado es exactamente idéntico al actual en StateManager -> no requiere recuperar
      assert.equal(await manager.hasRecoverableSession(), false);

      // Crear un documento nuevo en StateManager (vaciado)
      const emptyDoc: Document = {
        id: 'doc-root',
        type: 'document',
        name: 'Nuevo Documento',
        width: 1920,
        height: 1080,
        children: [
          {
            id: 'layer-empty',
            type: 'layer',
            name: 'Capa 1',
            visible: true,
            locked: false,
            opacity: 1,
            children: [],
          },
        ],
      };

      // Si el usuario recarga y tiene un lienzo vacío, pero en el backup había figuras:
      stateManager.loadState(emptyDoc);
      assert.equal(await manager.hasRecoverableSession(), true);

      // Limpiar el respaldo
      await manager.clearBackup();
      assert.equal(await manager.hasRecoverableSession(), false);
    });

    it('getSavedSession maneja datos corruptos sin lanzar excepciones', async () => {
      const manager = new AutoSaveManager(stateManager, {
        storage: memoryStorage,
        storageKey: 'test_corrupt',
      });

      // Inyectar JSON inválido
      await memoryStorage.setItem('test_corrupt', 'JSON_INVALIDO{{{');
      assert.equal(await manager.getSavedSession(), null);

      // Inyectar objeto sin document válido
      await memoryStorage.setItem('test_corrupt', JSON.stringify({ schemaVersion: 1 }));
      assert.equal(await manager.getSavedSession(), null);
    });
  });

  describe('3. Diálogo de Restauración de Sesión (RecoveryDialogController)', () => {
    let memoryStorage: MemoryStorageAdapter;
    let stateManager: StateManager;
    let commandManager: CommandManager;
    let autoSaveManager: AutoSaveManager;

    let mockDialog: MockElement;
    let mockBtnClose: MockElement;
    let mockBtnDiscard: MockElement;
    let mockBtnRestore: MockElement;
    let mockLabelTime: MockElement;
    let mockLabelSummary: MockElement;
    let mockLabelMeta: MockElement;

    beforeEach(() => {
      memoryStorage = new MemoryStorageAdapter();
      commandManager = new CommandManager();
      stateManager = new StateManager(DEFAULT_DOCUMENT, commandManager);
      autoSaveManager = new AutoSaveManager(stateManager, {
        storage: memoryStorage,
        storageKey: 'recovery_test',
      });

      mockDialog = new MockElement('recovery-dialog', 'dialog');
      mockBtnClose = new MockElement('btn-close-recovery', 'button');
      mockBtnDiscard = new MockElement('btn-recovery-discard', 'button');
      mockBtnRestore = new MockElement('btn-recovery-restore', 'button');
      mockLabelTime = new MockElement('recovery-dialog-time', 'span');
      mockLabelSummary = new MockElement('recovery-dialog-summary', 'span');
      mockLabelMeta = new MockElement('recovery-dialog-meta', 'span');

      (globalThis as any).document = {
        querySelector: (sel: string) => {
          if (sel === '#recovery-dialog') return mockDialog;
          if (sel === '#btn-close-recovery') return mockBtnClose;
          if (sel === '#btn-recovery-discard') return mockBtnDiscard;
          if (sel === '#btn-recovery-restore') return mockBtnRestore;
          if (sel === '#recovery-dialog-time') return mockLabelTime;
          if (sel === '#recovery-dialog-summary') return mockLabelSummary;
          if (sel === '#recovery-dialog-meta') return mockLabelMeta;
          return null;
        },
        activeElement: null,
      };
    });

    afterEach(() => {
      delete (globalThis as any).document;
    });

    it('formatBackupTimestamp formatea correctamente marcas temporales recientes', () => {
      const now = Date.now();
      const formatted = formatBackupTimestamp(now);
      assert.ok(formatted.includes('Hoy a las') || formatted.includes(':'));
    });

    it('openRecoveryDialog llena los datos de la sesión y muestra el modal', () => {
      const controller = setupRecoveryDialogBindings({
        autoSaveManager,
        stateManager,
        commandManager,
      });

      const session: AutoSaveSession = {
        schemaVersion: 1,
        timestamp: Date.now(),
        document: DEFAULT_DOCUMENT,
        documentName: 'Proyecto Ilustración',
        shapesCount: 15,
        layersCount: 3,
        dimensions: { width: 1920, height: 1080 },
      };

      controller.openRecoveryDialog(session);

      assert.equal(mockDialog.open, true);
      assert.ok(mockLabelSummary.textContent.includes('Proyecto Ilustración'));
      assert.ok(mockLabelSummary.textContent.includes('1920 × 1080 px'));
      assert.ok(mockLabelMeta.textContent.includes('15 figuras en 3 capas'));

      controller.closeRecoveryDialog();
      assert.equal(mockDialog.open, false);
      controller.cleanup();
    });

    it('hacer clic en Restaurar sesión carga el documento y limpia el historial', () => {
      let restoredSession: AutoSaveSession | null = null;
      let zoomFitCalled = false;

      const mockInput = {
        zoomFit: () => {
          zoomFitCalled = true;
        },
      } as unknown as InputController;

      const controller = setupRecoveryDialogBindings({
        autoSaveManager,
        stateManager,
        commandManager,
        inputController: mockInput,
        onRestored: (s) => {
          restoredSession = s;
        },
      });

      const customDoc: Document = {
        id: 'doc-recovered',
        type: 'document',
        name: 'Documento Recuperado',
        width: 1280,
        height: 720,
        children: [
          {
            id: 'l1',
            type: 'layer',
            name: 'Capa 1',
            visible: true,
            locked: false,
            opacity: 1,
            children: [],
          },
        ],
      };

      const session: AutoSaveSession = {
        schemaVersion: 1,
        timestamp: Date.now(),
        document: customDoc,
        documentName: 'Documento Recuperado',
        shapesCount: 0,
        layersCount: 1,
        dimensions: { width: 1280, height: 720 },
      };

      controller.openRecoveryDialog(session);
      assert.equal(mockDialog.open, true);

      // Simular clic en Restaurar
      mockBtnRestore.click();

      assert.equal(mockDialog.open, false);
      assert.ok(restoredSession);
      assert.equal(stateManager.getState().name, 'Documento Recuperado');
      assert.equal(stateManager.getState().width, 1280);
      assert.equal(zoomFitCalled, true);

      controller.cleanup();
    });

    it('hacer clic en Descartar borra la sesión guardada y deja el estado intacto', async () => {
      let discardedCalled = false;

      const controller = setupRecoveryDialogBindings({
        autoSaveManager,
        stateManager,
        commandManager,
        onDiscarded: () => {
          discardedCalled = true;
        },
      });

      // Primero persistir algo en autoSaveManager
      await autoSaveManager.saveImmediate();
      assert.ok(await autoSaveManager.getSavedSession());

      const session = (await autoSaveManager.getSavedSession())!;
      controller.openRecoveryDialog(session);
      assert.equal(mockDialog.open, true);

      // Simular clic en Descartar
      mockBtnDiscard.click();

      // Esperar microtask para la promesa de clearBackup
      await new Promise((res) => setTimeout(res, 10));

      assert.equal(mockDialog.open, false);
      assert.equal(discardedCalled, true);
      assert.equal(await autoSaveManager.getSavedSession(), null);

      controller.cleanup();
    });

    it('checkAndPromptRecovery detecta y abre el diálogo automáticamente si hay sesión', async () => {
      const controller = setupRecoveryDialogBindings({
        autoSaveManager,
        stateManager,
        commandManager,
      });

      // Inicialmente sin respaldo
      const openedInitially = await controller.checkAndPromptRecovery();
      assert.equal(openedInitially, false);
      assert.equal(mockDialog.open, false);

      // Guardar sesión con figuras
      await autoSaveManager.saveImmediate();

      // Cambiar estado actual a documento vacío
      stateManager.loadState({
        id: 'doc-empty',
        type: 'document',
        name: 'Vacio',
        width: 800,
        height: 600,
        children: [
          {
            id: 'l-empty',
            type: 'layer',
            name: 'Capa Base',
            visible: true,
            locked: false,
            opacity: 1,
            children: [],
          },
        ],
      });

      const openedAfter = await controller.checkAndPromptRecovery();
      assert.equal(openedAfter, true);
      assert.equal(mockDialog.open, true);

      controller.cleanup();
    });
  });

  describe('4. Indicador de Autoguardado en StatusBarController', () => {
    let mockStatusContainer: MockElement;
    let mockStatusLabel: MockElement;
    let stateManager: StateManager;
    let viewportManager: ViewportManager;

    beforeEach(() => {
      mockStatusContainer = new MockElement('status-autosave-container');
      mockStatusLabel = new MockElement('status-autosave-label');
      stateManager = new StateManager(DEFAULT_DOCUMENT);
      viewportManager = new ViewportManager();

      (globalThis as any).document = {
        querySelector: (sel: string) => {
          if (sel === '#status-autosave-container') return mockStatusContainer;
          if (sel === '#status-autosave-label') return mockStatusLabel;
          return null;
        },
        querySelectorAll: () => [],
      };
    });

    afterEach(() => {
      delete (globalThis as any).document;
    });

    it('updateAutoSaveStatus sincroniza las clases CSS y el texto de estado', () => {
      const mockInput = {
        currentTool: 'select',
      } as unknown as InputController;

      const statusBar = setupStatusBarBindings({
        stateManager,
        viewportManager,
        inputController: mockInput,
        canvas: null,
      });

      assert.ok(statusBar.updateAutoSaveStatus);

      // Estado inicial 'saved'
      statusBar.updateAutoSaveStatus('saved');
      assert.ok(mockStatusContainer.classList.contains('is-saved'));
      assert.equal(mockStatusLabel.textContent, 'Guardado');

      // Estado 'saving'
      statusBar.updateAutoSaveStatus('saving');
      assert.ok(mockStatusContainer.classList.contains('is-saving'));
      assert.equal(mockStatusContainer.classList.contains('is-saved'), false);
      assert.equal(mockStatusLabel.textContent, 'Guardando...');

      // Estado 'error'
      statusBar.updateAutoSaveStatus('error');
      assert.ok(mockStatusContainer.classList.contains('is-error'));
      assert.equal(mockStatusLabel.textContent, 'Error al guardar');

      // Con etiqueta personalizada
      statusBar.updateAutoSaveStatus('saved', 'Sesión restaurada');
      assert.ok(mockStatusContainer.classList.contains('is-saved'));
      assert.equal(mockStatusLabel.textContent, 'Sesión restaurada');

      statusBar.cleanup();
    });
  });
});
