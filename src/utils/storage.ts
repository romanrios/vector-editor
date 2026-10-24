/**
 * Adaptadores de almacenamiento abstracto para persistencia local en Vectedit.
 * Proporciona soporte asíncrono para IndexedDB (prioritario) con fallback transparente
 * a LocalStorage y MemoryStorage para entornos de test o almacenamiento restringido.
 */

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Adaptador en memoria para pruebas unitarias y entornos donde ningún storage persistente esté disponible.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, string>();

  public async getItem(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, String(value));
  }

  public async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * Adaptador basado en window.localStorage con manejo seguro de excepciones (cuota excedida, modo privado).
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly storage: Storage;

  constructor(customStorage?: Storage) {
    if (customStorage) {
      this.storage = customStorage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      this.storage = (globalThis as any).localStorage;
    } else {
      throw new Error('localStorage no está disponible en este entorno.');
    }
  }

  public async getItem(key: string): Promise<string | null> {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  public async setItem(key: string, value: string): Promise<void> {
    try {
      this.storage.setItem(key, value);
    } catch (err) {
      console.warn('⚠️ [LocalStorageAdapter] Error al escribir en localStorage (¿cuota excedida?):', err);
      throw err;
    }
  }

  public async removeItem(key: string): Promise<void> {
    try {
      this.storage.removeItem(key);
    } catch {
      // Ignorar errores de acceso en modo restringido
    }
  }

  public async clear(): Promise<void> {
    try {
      this.storage.clear();
    } catch {
      // Ignorar
    }
  }
}

/**
 * Adaptador nativo basado en IndexedDB.
 * Permite almacenar documentos de gran tamaño sin bloquear el hilo principal ni agotar la cuota de LocalStorage.
 */
export class IndexedDBStorageAdapter implements StorageAdapter {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string = 'vectedit_db', storeName: string = 'keyval', version: number = 1) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;
  }

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const idbFactory = typeof indexedDB !== 'undefined'
        ? indexedDB
        : (typeof window !== 'undefined' ? window.indexedDB : null);

      if (!idbFactory) {
        return reject(new Error('IndexedDB no está soportado en este entorno.'));
      }

      const request = idbFactory.open(this.dbName, this.version);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Error al abrir la base de datos IndexedDB'));
      };

      request.onblocked = () => {
        console.warn('⚠️ [IndexedDBStorageAdapter] Conexión a IndexedDB bloqueada por otra pestaña.');
      };
    });

    return this.dbPromise;
  }

  public async getItem(key: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      return new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);

        req.onsuccess = () => {
          const result = req.result;
          resolve(typeof result === 'string' ? result : null);
        };

        req.onerror = () => reject(req.error || new Error(`Error al leer clave ${key}`));
      });
    } catch {
      return null;
    }
  }

  public async setItem(key: string, value: string): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(value, key);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error(`Error al escribir clave ${key}`));
    });
  }

  public async removeItem(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.delete(key);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error(`Error al borrar clave ${key}`));
      });
    } catch {
      // Ignorar
    }
  }

  public async clear(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.clear();

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('Error al vaciar IndexedDB'));
      });
    } catch {
      // Ignorar
    }
  }
}

/**
 * Crea la mejor instancia de StorageAdapter disponible según el entorno.
 */
export function createStorageAdapter(preferred?: 'indexeddb' | 'localstorage' | 'memory'): StorageAdapter {
  if (preferred === 'memory') {
    return new MemoryStorageAdapter();
  }

  if (preferred === 'localstorage') {
    try {
      return new LocalStorageAdapter();
    } catch {
      return new MemoryStorageAdapter();
    }
  }

  // Comprobar soporte de IndexedDB
  const hasIDB = typeof indexedDB !== 'undefined' ||
    (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined');

  if (hasIDB) {
    try {
      return new IndexedDBStorageAdapter();
    } catch {
      // Fallback
    }
  }

  // Fallback a LocalStorage
  try {
    return new LocalStorageAdapter();
  } catch {
    // Fallback final a memoria
    return new MemoryStorageAdapter();
  }
}
