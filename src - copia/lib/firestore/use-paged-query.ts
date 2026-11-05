'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  collection,
  getDocs,
  getDocsFromCache,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryConstraint,
} from 'firebase/firestore';
import { useFirebase } from '@/firebase/provider';
import {
  buildQueryKey,
  getLastSync,
  serializeValue,
  setLastSync,
  ttlFor,
  type QueryFilter,
} from './cache-policy';
import { queryCache, type CacheEntry, type WithId } from './query-cache';
import { countServerReads } from './read-meter';

/** Tiempo que se sirve la copia en RAM sin tocar ni IndexedDB. */
const RAM_TTL_MS = 5 * 60_000;

/** Deduplicación de la misma consulta en vuelo. */
const inflight = new Map<string, Promise<void>>();

export type PagedQueryOptions<T> = {
  /** Nombre de la colección dentro de `users/{uid}`. */
  collectionName: string;
  filters?: QueryFilter[];
  orderField?: string;
  orderDir?: 'asc' | 'desc';
  /** Documentos por página (100 productos / 100 reparaciones por defecto). */
  pageSize?: number;
  enabled?: boolean;
  ttlMs?: number;
  /** Fuerza solo caché (modo offline explícito). */
  cacheOnly?: boolean;
  mapDoc?: (data: DocumentData, id: string) => WithId<T>;
};

const defaultMapDoc = (data: DocumentData, id: string) =>
  ({ ...(data as Record<string, unknown>), id }) as WithId<any>;

const EMPTY: WithId<never>[] = [];

/**
 * Hook de lectura paginada con caché (Fase 2).
 *
 * Orden de resolución:
 *  1. RAM fresca (< 5 min)            → 0 lecturas, 0 IndexedDB.
 *  2. IndexedDB (`getDocsFromCache`)  → 0 lecturas facturadas.
 *  3. Servidor (`getDocs` + `limit`)  → como máximo `pageSize` lecturas.
 *
 * `loadMore()` usa `startAfter` y nunca relee lo anterior. Si la página 1
 * vino de IndexedDB, primero sincroniza con el servidor y luego pagina en la
 * misma pulsación (el cursor local no garantiza continuidad).
 */
export function usePagedQuery<T>(opts: PagedQueryOptions<T>) {
  const { firestore, user } = useFirebase();
  const uid = user?.uid ?? '';
  const pageSize = opts.pageSize ?? 100;
  const ttlMs = opts.ttlMs ?? ttlFor(opts.collectionName);
  const enabled = opts.enabled !== false;

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const filtersSig = (opts.filters ?? [])
    .map(([field, op, value]) => `${field}:${op}:${serializeValue(value)}`)
    .join('&');

  const key = useMemo(
    () =>
      buildQueryKey(uid, opts.collectionName, {
        filters: opts.filters,
        orderField: opts.orderField,
        orderDir: opts.orderDir,
        pageSize,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, opts.collectionName, filtersSig, opts.orderField, opts.orderDir, pageSize],
  );

  const entry = useSyncExternalStore(
    queryCache.subscribe,
    () => queryCache.get<T>(key),
    () => undefined,
  );

  const entryRef = useRef<CacheEntry<T> | undefined>(entry);
  entryRef.current = entry;

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [needsIndex, setNeedsIndex] = useState(false);

  const makeQuery = useCallback(
    (cursor: DocumentSnapshot | null) => {
      if (!firestore || !uid) return null;

      const constraints: QueryConstraint[] = [];
      for (const [field, op, value] of optsRef.current.filters ?? []) {
        constraints.push(where(field, op, value));
      }
      if (optsRef.current.orderField) {
        constraints.push(orderBy(optsRef.current.orderField, optsRef.current.orderDir ?? 'asc'));
      }
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(pageSize));

      return query(
        collection(firestore, 'users', uid, optsRef.current.collectionName),
        ...constraints,
      );
    },
    [firestore, uid, pageSize],
  );

  const mapDoc = useCallback(
    (data: DocumentData, id: string): WithId<T> =>
      (optsRef.current.mapDoc ?? defaultMapDoc)(data, id) as WithId<T>,
    [],
  );

  const run = useCallback(
    async (mode: 'auto' | 'server'): Promise<void> => {
      if (!firestore || !uid || !enabled) return;

      const current = entryRef.current;
      if (mode === 'auto' && current && Date.now() - current.fetchedAt < RAM_TTL_MS) return;

      const existing = inflight.get(key);
      if (existing) return existing;

      const task = (async () => {
        setLoading(true);
        setError(null);
        setNeedsIndex(false);

        const q = makeQuery(null);
        if (!q) {
          setLoading(false);
          return;
        }

        const online = typeof navigator === 'undefined' ? true : navigator.onLine;
        const now = Date.now();
        let items: WithId<T>[] = [];
        let cursor: DocumentSnapshot | null = null;
        let fromServer = false;

        if (mode === 'auto') {
          try {
            const cached = await getDocsFromCache(q);
            if (!cached.empty) {
              items = cached.docs.map((doc) => mapDoc(doc.data(), doc.id));
              cursor = cached.docs[cached.docs.length - 1] ?? null;
            }
          } catch {
            /* sin caché local */
          }
        }

        const lastSync = Math.max(current?.serverSyncedAt ?? 0, getLastSync(key));
        const stale = now - lastSync > ttlMs;
        const mustHitServer =
          online &&
          !optsRef.current.cacheOnly &&
          (mode === 'server' || stale || items.length === 0);

        if (mustHitServer) {
          try {
            const snapshot = await getDocs(q);
            countServerReads(Math.max(1, snapshot.size), optsRef.current.collectionName);

            items = snapshot.docs.map((doc) => mapDoc(doc.data(), doc.id));
            cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;
            fromServer = true;
            setLastSync(key);
          } catch (err: any) {
            if (err?.code === 'failed-precondition') setNeedsIndex(true);
            if (!items.length) setError(err instanceof Error ? err : new Error(String(err)));
          }
        }

        const serverSyncedAt = fromServer
          ? Date.now()
          : Math.max(current?.serverSyncedAt ?? 0, getLastSync(key));

        queryCache.set<T>(key, {
          items,
          ids: new Set(items.map((item) => item.id)),
          cursor,
          hasMore: items.length >= pageSize,
          source: fromServer ? 'server' : 'cache',
          serverSyncedAt,
          fetchedAt: Date.now(),
        });

        setLoading(false);
      })();

      inflight.set(key, task);
      try {
        await task;
      } finally {
        inflight.delete(key);
      }
    },
    [firestore, uid, key, makeQuery, mapDoc, pageSize, ttlMs, enabled],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    let current = entryRef.current;
    if (!firestore || !uid || !current || !current.hasMore || loadingMore) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    // Si la página 1 vino de IndexedDB, su cursor no garantiza continuidad:
    // primero se sincroniza con el servidor y luego se pagina en la misma pulsación.
    if (current.source !== 'server') {
      await run('server');
      current = entryRef.current;
    }
    if (!current?.cursor || !current.hasMore) return;

    setLoadingMore(true);
    try {
      const q = makeQuery(current.cursor);
      if (!q) return;

      const snapshot = await getDocs(q);
      countServerReads(Math.max(1, snapshot.size), optsRef.current.collectionName);

      const incoming = snapshot.docs
        .map((doc) => mapDoc(doc.data(), doc.id))
        .filter((item) => !current.ids.has(item.id));

      const items = [...current.items, ...incoming];

      queryCache.set<T>(key, {
        ...current,
        items,
        ids: new Set(items.map((item) => item.id)),
        cursor: snapshot.docs[snapshot.docs.length - 1] ?? current.cursor,
        hasMore: snapshot.docs.length >= pageSize,
        serverSyncedAt: Date.now(),
        fetchedAt: Date.now(),
      });
      setLastSync(key);
    } catch (err: any) {
      if (err?.code === 'failed-precondition') setNeedsIndex(true);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingMore(false);
    }
  }, [firestore, uid, key, makeQuery, mapDoc, pageSize, loadingMore, run]);

  useEffect(() => {
    void run('auto');
  }, [run]);

  return {
    items: entry?.items ?? (EMPTY as WithId<T>[]),
    isLoading: loading && !entry,
    isFetching: loading,
    isLoadingMore: loadingMore,
    hasMore: entry?.hasMore ?? false,
    fromCache: entry?.source === 'cache',
    error,
    needsIndex,
    reload: () => run('server'),
    loadMore,
  };
}
