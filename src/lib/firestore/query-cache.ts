import type { DocumentSnapshot } from 'firebase/firestore';
import { clearSync } from './cache-policy';

export type WithId<T> = T & { id: string };

export type CacheEntry<T> = {
  items: WithId<T>[];
  ids: Set<string>;
  /** Cursor de la última página traída del SERVIDOR (no de IndexedDB). */
  cursor: DocumentSnapshot | null;
  hasMore: boolean;
  source: 'server' | 'cache';
  /** Última vez que el servidor confirmó esta consulta. */
  serverSyncedAt: number;
  /** Última vez que se cargó en RAM (evita repetir hasta el hit de IndexedDB). */
  fetchedAt: number;
};

/**
 * Caché en memoria de resultados paginados (Fase 2).
 *
 * - 0 lecturas: todo lo que esté aquí se sirve sin tocar la red.
 * - LRU acotado para no crecer sin control en tablets de 2 GB.
 * - Los aciertos de IndexedDB también se reflejan como `source: 'cache'`.
 */
class QueryCache {
  private map = new Map<string, CacheEntry<any>>();
  private listeners = new Set<() => void>();

  constructor(private readonly maxEntries = 80) {}

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  get<T>(key: string): CacheEntry<T> | undefined {
    return this.map.get(key);
  }

  set<T>(key: string, entry: CacheEntry<T>): void {
    this.map.set(key, entry);

    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest) {
        this.map.delete(oldest);
        clearSync(oldest);
      }
    }

    this.emit();
  }

  delete(key: string): void {
    this.map.delete(key);
    clearSync(key);
    this.emit();
  }

  clearAll(): void {
    this.map.clear();
    clearSync();
    this.emit();
  }

  private keysFor(uid: string, collectionName: string, listsOnly = false): string[] {
    const prefix = `u:${uid}|c:${collectionName}|`;
    return Array.from(this.map.keys()).filter(
      (key) => key.startsWith(prefix) && (!listsOnly || key.endsWith('|s:-')),
    );
  }

  /** Invalida todas las variantes cacheadas de una colección. */
  invalidateCollection(uid: string, collectionName: string): void {
    const keys = this.keysFor(uid, collectionName);
    if (!keys.length) return;

    keys.forEach((key) => {
      this.map.delete(key);
      clearSync(key);
    });
    this.emit();
  }

  /** Actualiza un documento en las listas que ya lo contienen (sin leer). */
  patchItem<T>(uid: string, collectionName: string, id: string, patch: Partial<T>): void {
    let changed = false;

    for (const key of this.keysFor(uid, collectionName)) {
      const entry = this.map.get(key);
      if (!entry) continue;

      const index = entry.items.findIndex((item) => item.id === id);
      if (index === -1) continue;

      const items = entry.items.slice();
      items[index] = { ...items[index], ...patch };
      this.map.set(key, { ...entry, items });
      changed = true;
    }

    if (changed) this.emit();
  }

  /** Quita un documento de las listas cacheadas (tras un borrado). */
  removeItem(uid: string, collectionName: string, id: string): void {
    let changed = false;

    for (const key of this.keysFor(uid, collectionName)) {
      const entry = this.map.get(key);
      if (!entry || !entry.ids.has(id)) continue;

      const items = entry.items.filter((item) => item.id !== id);
      this.map.set(key, {
        ...entry,
        items,
        ids: new Set(items.map((item) => item.id)),
      });
      changed = true;
    }

    if (changed) this.emit();
  }

  /**
   * Une resultados de búsqueda al catálogo ya cacheado.
   * Imprescindible para que el costo/stock de un producto buscado en el
   * servidor esté disponible al venderlo.
   */
  mergeIntoCatalog<T>(uid: string, collectionName: string, incoming: WithId<T>[]): void {
    if (!incoming.length) return;

    let changed = false;

    // Solo listas (no entradas de búsqueda): evita contaminar resultados cacheados.
    for (const key of this.keysFor(uid, collectionName, true)) {
      const entry = this.map.get(key);
      if (!entry) continue;

      const fresh = incoming.filter((item) => !entry.ids.has(item.id));
      if (!fresh.length) continue;

      const items = [...fresh, ...entry.items];
      this.map.set(key, {
        ...entry,
        items,
        ids: new Set(items.map((item) => item.id)),
      });
      changed = true;
    }

    if (changed) this.emit();
  }
}

export const queryCache = new QueryCache();
