import type { Document } from '../types/scene-graph.ts';
import { isSelectable } from '../types/scene-graph.ts';
import { StateManager, getLeafShapes } from './StateManager.ts';
import { Serializer, serializeDocument } from './Serializer.ts';
import { type StorageAdapter, createStorageAdapter } from '../utils/storage.ts';

export const CURRENT_AUTOSAVE_SCHEMA_VERSION = 1;
export const DEFAULT_AUTOSAVE_STORAGE_KEY = 'vectedit_autosave_session';
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 1000;

export type AutoSaveStatus = 'saved' | 'saving' | 'error';

/**
 * Estructura de la sesión guardada automáticamente en segundo plano.
 */
export interface AutoSaveSession {
  readonly schemaVersion: number;
  readonly timestamp: number;
  readonly document: Document;
  readonly documentName: string;
  readonly shapesCount: number;
  readonly layersCount: number;
  readonly dimensions: { readonly width: number; readonly height: number };
}

export interface AutoSaveOptions {
  readonly debounceMs?: number;
  readonly storage?: StorageAdapter;
  readonly storageKey?: string;
  readonly onStatusChange?: (status: AutoSaveStatus, error?: Error) => void;
  readonly onSessionSaved?: (session: AutoSaveSession) => void;
}

/**
 * Cuenta las figuras hoja seleccionables presentes en todas las capas del documento.
 */
export function countDocumentShapes(doc: Document | null | undefined): number {
  if (!doc || !Array.isArray(doc.children)) {
    return 0;
  }
  let total = 0;
  for (const layer of doc.children) {
    if (layer && Array.isArray(layer.children)) {
      total += getLeafShapes(layer.children.filter(isSelectable)).length;
    }
  }
  return total;
}

/**
 * Gestor de persistencia y autoguardado continuo en segundo plano.
 * Se suscribe a StateManager, aplica debounce y persiste el estado
 * en IndexedDB / LocalStorage para prevenir pérdida accidental de datos.
 */
export class AutoSaveManager {
  private readonly stateManager: StateManager;
  private readonly storage: StorageAdapter;
  private readonly debounceMs: number;
  private readonly storageKey: string;
  private readonly onStatusChange?: (status: AutoSaveStatus, error?: Error) => void;
  private readonly onSessionSaved?: (session: AutoSaveSession) => void;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: AutoSaveStatus = 'saved';
  private unsubscribeState: (() => void) | null = null;
  private isRunning: boolean = false;
  private lastSavedDocString: string | null = null;

  private boundBeforeUnload: ((e: BeforeUnloadEvent) => void) | null = null;
  private boundPageHide: ((e: PageTransitionEvent) => void) | null = null;

  constructor(stateManager: StateManager, options: AutoSaveOptions = {}) {
    this.stateManager = stateManager;
    this.storage = options.storage ?? createStorageAdapter();
    this.debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
    this.storageKey = options.storageKey ?? DEFAULT_AUTOSAVE_STORAGE_KEY;
    this.onStatusChange = options.onStatusChange;
    this.onSessionSaved = options.onSessionSaved;
  }

  /**
   * Inicia el ciclo de autoguardado suscribiéndose a cambios de StateManager
   * y registrando eventos del ciclo de vida de la página.
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    // Suscripción al StateManager inmutable
    this.unsubscribeState = this.stateManager.subscribe(() => {
      this.scheduleSave();
    });

    // Salvaguarda al cerrar o recargar la pestaña del navegador
    if (typeof window !== 'undefined') {
      this.boundBeforeUnload = () => {
        this.saveImmediateSyncFallback();
      };
      this.boundPageHide = () => {
        this.saveImmediateSyncFallback();
      };

      window.addEventListener('beforeunload', this.boundBeforeUnload);
      window.addEventListener('pagehide', this.boundPageHide);
    }
  }

  /**
   * Detiene el autoguardado, cancela temporizadores y desvincula eventos.
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }

    if (typeof window !== 'undefined') {
      if (this.boundBeforeUnload) {
        window.removeEventListener('beforeunload', this.boundBeforeUnload);
        this.boundBeforeUnload = null;
      }
      if (this.boundPageHide) {
        window.removeEventListener('pagehide', this.boundPageHide);
        this.boundPageHide = null;
      }
    }
  }

  /**
   * Programa un guardado debounced tras una mutación.
   */
  public scheduleSave(): void {
    this.setStatus('saving');

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveImmediate().catch((err) => {
        console.warn('⚠️ [AutoSaveManager] Error en autoguardado diferido:', err);
      });
    }, this.debounceMs);
  }

  /**
   * Realiza un guardado inmediato asíncrono del documento actual.
   */
  public async saveImmediate(): Promise<AutoSaveSession | null> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const currentDoc = this.stateManager.getState();
    if (!currentDoc || currentDoc.type !== 'document') {
      return null;
    }

    try {
      this.setStatus('saving');

      const docString = serializeDocument(currentDoc, false);

      // Si no ha habido cambios en la serialización respecto al último guardado, no reescribir
      if (docString === this.lastSavedDocString && this.status === 'saved') {
        return null;
      }

      const session: AutoSaveSession = {
        schemaVersion: CURRENT_AUTOSAVE_SCHEMA_VERSION,
        timestamp: Date.now(),
        document: currentDoc,
        documentName: currentDoc.name || 'Sin título',
        shapesCount: countDocumentShapes(currentDoc),
        layersCount: Array.isArray(currentDoc.children) ? currentDoc.children.length : 1,
        dimensions: {
          width: currentDoc.width || 1920,
          height: currentDoc.height || 1080,
        },
      };

      const payload = JSON.stringify(session);
      await this.storage.setItem(this.storageKey, payload);

      this.lastSavedDocString = docString;
      this.setStatus('saved');
      this.onSessionSaved?.(session);

      return session;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('⚠️ [AutoSaveManager] Error al persistir sesión:', error);
      this.setStatus('error', error);
      return null;
    }
  }

  /**
   * Intento síncrono de emergencia mediante LocalStorage para beforeunload/pagehide.
   */
  private saveImmediateSyncFallback(): void {
    try {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const currentDoc = this.stateManager.getState();
      if (!currentDoc || currentDoc.type !== 'document') return;

      const session: AutoSaveSession = {
        schemaVersion: CURRENT_AUTOSAVE_SCHEMA_VERSION,
        timestamp: Date.now(),
        document: currentDoc,
        documentName: currentDoc.name || 'Sin título',
        shapesCount: countDocumentShapes(currentDoc),
        layersCount: Array.isArray(currentDoc.children) ? currentDoc.children.length : 1,
        dimensions: {
          width: currentDoc.width || 1920,
          height: currentDoc.height || 1080,
        },
      };

      const payload = JSON.stringify(session);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, payload);
      }
      // También intentar flush asíncrono
      this.storage.setItem(this.storageKey, payload).catch(() => {});
    } catch {
      // Ignorar fallos de último momento
    }
  }

  /**
   * Fuerza el guardado inmediato si había una operación debounced pendiente.
   */
  public async flush(): Promise<void> {
    if (this.timer || this.status === 'saving') {
      await this.saveImmediate();
    }
  }

  /**
   * Obtiene la sesión guardada desde el almacenamiento local, validando su integridad estructural.
   */
  public async getSavedSession(): Promise<AutoSaveSession | null> {
    try {
      let raw = await this.storage.getItem(this.storageKey);

      // Si no se encuentra en el adapter (ej. IndexedDB inicial), intentar fallback de localStorage
      if (!raw && typeof window !== 'undefined' && window.localStorage) {
        raw = window.localStorage.getItem(this.storageKey);
      }

      if (!raw || typeof raw !== 'string') {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.document) {
        return null;
      }

      // Validar integridad estructural del documento con Serializer
      const docPayload = typeof parsed.document === 'string'
        ? parsed.document
        : JSON.stringify(parsed.document);
      const validatedDoc = await Serializer.parseDocument(docPayload);

      return {
        schemaVersion: parsed.schemaVersion || CURRENT_AUTOSAVE_SCHEMA_VERSION,
        timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
        document: validatedDoc,
        documentName: parsed.documentName || validatedDoc.name || 'Sin título',
        shapesCount: countDocumentShapes(validatedDoc),
        layersCount: Array.isArray(validatedDoc.children) ? validatedDoc.children.length : 1,
        dimensions: {
          width: validatedDoc.width || 1920,
          height: validatedDoc.height || 1080,
        },
      };
    } catch (err) {
      console.warn('⚠️ [AutoSaveManager] Sesión guardada corrupta o incompatible:', err);
      return null;
    }
  }

  /**
   * Determina si existe una sesión recuperable que difiera del documento actual.
   * Evita interrumpir al usuario si el estado guardado es idéntico al actual.
   */
  public async hasRecoverableSession(currentDoc?: Document): Promise<boolean> {
    const saved = await this.getSavedSession();
    if (!saved || !saved.document) {
      return false;
    }

    const docToCompare = currentDoc ?? this.stateManager.getState();
    if (!docToCompare) {
      return true;
    }

    // Comparar huella serializada
    const savedString = serializeDocument(saved.document, false);
    const currentString = serializeDocument(docToCompare, false);

    if (savedString === currentString) {
      return false;
    }

    // Si tiene figuras o difiere de dimensiones básicas, es recuperable
    return saved.shapesCount > 0 || saved.layersCount > 1 || saved.document.width !== docToCompare.width || saved.document.height !== docToCompare.height;
  }

  /**
   * Elimina la sesión de respaldo guardada en el almacenamiento local.
   */
  public async clearBackup(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastSavedDocString = null;
    await this.storage.removeItem(this.storageKey);

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(this.storageKey);
      } catch {
        // Ignorar
      }
    }

    this.setStatus('saved');
  }

  /**
   * Retorna el estado actual del autoguardado ('saved', 'saving', 'error').
   */
  public getStatus(): AutoSaveStatus {
    return this.status;
  }

  private setStatus(status: AutoSaveStatus, error?: Error): void {
    if (this.status !== status) {
      this.status = status;
      this.onStatusChange?.(status, error);
    }
  }
}
