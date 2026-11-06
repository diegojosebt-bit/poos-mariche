'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase/provider';
import { buildQueryKey, serializeValue, type QueryFilter } from './cache-policy';
import { queryCache, type WithId } from './query-cache';
import { countServerReads } from './read-meter';
import { lastTokenOf, normalizeText } from '@/lib/search-index';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;

export type ServerSearchOptions<T> = {
  collectionName: string;
  term: string;
  orderField: string;
  orderDir?: 'asc' | 'desc';
  pageSize?: number;
  enabled?: boolean;
  tokensField?: string;
  /** Filtros de igualdad que acompañan a la búsqueda (p. ej. isDeleted == false). */
  filters?: QueryFilter[];
  /** Fusiona los resultados en otra caché (p. ej. el catálogo del POS). */
  onResults?: (items: WithId<T>[]) => void;
};

/**
 * Búsqueda en servidor con índice de tokens (`array-contains`), debounce y
 * caché de resultados. Repetir la misma búsqueda cuesta 0 lecturas.
 *
 * Requiere que los documentos tengan `searchTokens` (ver
 * `scripts/backfill.mjs`). Si aún no se ejecutó, la pantalla debe ofrecer un
 * fallback explícito ("cargar más" o búsqueda completa).
 */
export function useServerSearch<T>(opts: ServerSearchOptions<T>) {
  const { firestore, user } = useFirebase();
  const uid = user?.uid ?? '';
  const pageSize = opts.pageSize ?? 20;
  const tokensField = opts.tokensField ?? 'searchTokens';

  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<WithId<T>[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);

  const filtersRef = useRef(opts.filters);
  filtersRef.current = opts.filters;
  const onResultsRef = useRef(opts.onResults);
  onResultsRef.current = opts.onResults;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalizeText(opts.term)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [opts.term]);

  const lastToken = lastTokenOf(debounced);
  const normalizedTerm = normalizeText(opts.term);
  const active = opts.enabled !== false && lastToken.length >= MIN_CHARS;

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
        search: lastToken,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, opts.collectionName, opts.orderField, opts.orderDir, pageSize, lastToken, filtersSig],
  );

  useEffect(() => {
    if (!firestore || !uid || !active) {
      setItems([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setItems([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const cached = queryCache.get<T>(key);
    if (cached) {
      setItems(cached.items);
      setHasSearched(true);
      setIsSearching(false);
      onResultsRef.current?.(cached.items);
      return;
    }

    const myGeneration = ++generation.current;
    let cancelled = false;
    setIsSearching(true);
    setError(null);

    (async () => {
      try {
        const equalityFilters = (filtersRef.current ?? []).map(([field, op, value]) =>
          where(field, op, value),
        );

        const q = query(
          collection(firestore, 'users', uid, opts.collectionName),
          ...equalityFilters,
          where(tokensField, 'array-contains', lastToken),
          orderBy(opts.orderField, opts.orderDir ?? 'desc'),
          limit(pageSize),
        );

        const snapshot = await getDocs(q);
        countServerReads(Math.max(1, snapshot.size), `${opts.collectionName}:search`);

        if (cancelled || myGeneration !== generation.current) return;

        const list = snapshot.docs.map((doc) => ({
          ...(doc.data() as Record<string, unknown>),
          id: doc.id,
        })) as unknown as WithId<T>[];

        setItems(list);
        setHasSearched(true);
        onResultsRef.current?.(list);

        queryCache.set<T>(key, {
          items: list,
          ids: new Set(list.map((item) => item.id)),
          cursor: snapshot.docs[snapshot.docs.length - 1] ?? null,
          hasMore: false,
          source: 'server',
          serverSyncedAt: Date.now(),
          fetchedAt: Date.now(),
        });
      } catch (err: any) {
        if (!cancelled && myGeneration === generation.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (myGeneration === generation.current) setIsSearching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, uid, active, key, lastToken, pageSize, tokensField]);

  return {
    items,
    isSearching,
    hasSearched,
    error,
    isTooShort: normalizedTerm.length > 0 && lastToken.length < MIN_CHARS,
  };
}
