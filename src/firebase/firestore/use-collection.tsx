'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Query,
  getDocs,
  DocumentData,
  FirestoreError,
  CollectionReference,
  getDocsFromCache,
  getDocsFromServer,
} from 'firebase/firestore';
import { useDashboardStore } from '@/contexts/dashboard-context';
import { useFirebase } from '@/firebase';
import { serializeValue } from '@/lib/firestore/cache-policy';
import { countCacheHits, countServerReads } from '@/lib/firestore/read-meter';
import { withTimeout } from '@/lib/firestore/with-timeout';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  refetch: () => Promise<void>;
  mutate: (updater: WithId<T>[] | ((prev: WithId<T>[] | null) => WithId<T>[] | null)) => void;
}

// Mapa para deduplicar consultas idénticas en vuelo (evita lecturas duplicadas simultáneas)
const pendingQueries = new Map<string, Promise<any[]>>();

function getSafePath(query: any): string {
  if (!query) return '';
  try {
    if (query.type === 'collection') {
      return (query as CollectionReference).path || 'collection';
    }

    const internal = (query as any)._query ?? query;
    const path = internal?.path;

    if (path) {
      if (typeof path.canonicalString === 'function') return path.canonicalString();
      if (Array.isArray(path.segments)) return path.segments.join('/');
      if (typeof path.toString === 'function') return path.toString();
    }

    return (query as any).path || 'unknown_path';
  } catch {
    return 'unknown_path';
  }
}

function getQueryCacheKey(query: any): string {
  if (!query) return '';
  try {
    if (query.type === 'collection') {
      return `collection_cache:${(query as CollectionReference).path}`;
    }
    
    const path = getSafePath(query);
    const queryInternal = (query as any)._query || {};
    const limitVal = queryInternal.limit ?? 'none';
    
    let orderFields = '';
    if (Array.isArray(queryInternal.explicitOrderBy)) {
      orderFields = queryInternal.explicitOrderBy.map((o: any) => {
        const field = o?.field?.canonicalString?.() || o?.field?.toString?.() || 'field';
        const dir = o?.dir || 'asc';
        return `${field}_${dir}`;
      }).join('|');
    }

    let filterSummary = '';
    if (Array.isArray(queryInternal.filters)) {
      filterSummary = queryInternal.filters.map((f: any) => {
        const field = f?.field?.canonicalString?.() || f?.field?.toString?.() || 'field';
        const op = f?.op || 'op';
        // Antes: los Timestamps/Date caían en 'val' y dos rangos distintos
        // compartían la misma clave de caché (datos incorrectos).
        return `${field}_${op}_${serializeValue(f?.value)}`;
      }).join('&');
    }

    return `collection_cache:v2:${path}:limit_${limitVal}:orders_${orderFields}:filters_${filterSummary}`;
  } catch (e) {
    return 'unknown_query_key';
  }
}

/**
 * useCollection - Hook Ultra Optimizado (Blindaje Antifuga de Lecturas Firebase)
 * 1. Prioriza memoria RAM (0ms, 0 lecturas).
 * 2. Prioriza caché local IndexedDB (0 lecturas a la cuota diaria).
 * 3. Deduplica llamadas en vuelo para no duplicar peticiones de la misma colección.
 * 4. No entra en ciclos recursivos al actualizar el estado.
 */
export function useCollection<T = any>(
  memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean}) | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  const { dataCache, setCachedData } = useDashboardStore();
  const { firestore, user } = useFirebase();
  const isMountedRef = useRef(true);
  const dataCacheRef = useRef(dataCache);
  dataCacheRef.current = dataCache;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const queryKey = useMemo(() => getQueryCacheKey(memoizedTargetRefOrQuery), [memoizedTargetRefOrQuery]);
  const data = (queryKey ? dataCache[queryKey] : null) as ResultItemType[] | null;
  const [isLoading, setIsLoading] = useState<boolean>(!data);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const mutate = useCallback((updater: ResultItemType[] | ((prev: ResultItemType[] | null) => ResultItemType[] | null)) => {
    if (!queryKey) return;
    const current = dataCacheRef.current[queryKey] as ResultItemType[] | null;
    const newData = typeof updater === 'function' ? updater(current) : updater;
    setCachedData(queryKey, newData);
  }, [queryKey, setCachedData]);

  const fetchData = useCallback(async (forceServer = false) => {
    if (!memoizedTargetRefOrQuery || !queryKey || !firestore || !user) {
      if (!memoizedTargetRefOrQuery && isMountedRef.current) setIsLoading(false);
      return;
    }

    // NIVEL 1: Memoria RAM (0 lecturas, 0ms)
    if (!forceServer && dataCacheRef.current[queryKey] !== undefined && dataCacheRef.current[queryKey] !== null) {
      if (isMountedRef.current) setIsLoading(false);
      return;
    }

    // Deduplicación en vuelo: Si otra llamada ya está consultando esta clave, esperar
    if (!forceServer && pendingQueries.has(queryKey)) {
      const pending = pendingQueries.get(queryKey);
      if (pending) {
        try {
          const cached = await pending;
          if (isMountedRef.current) {
            setCachedData(queryKey, cached ?? []);
            setIsLoading(false);
          }
          return;
        } catch (e) {}
      }
    }

    if (isMountedRef.current && !dataCacheRef.current[queryKey]) {
      setIsLoading(true);
      setError(null);
    }

    const queryPromise = (async () => {
      let results: ResultItemType[] = [];
      const label = getSafePath(memoizedTargetRefOrQuery) || 'query';

      // NIVEL 2: Intentar primero desde Caché Local (IndexedDB) con 0 Lecturas al servidor de Firebase
      if (!forceServer) {
        try {
          const cacheSnap = await getDocsFromCache(memoizedTargetRefOrQuery);
          if (!cacheSnap.empty) {
            countCacheHits(cacheSnap.size, label);
            cacheSnap.forEach((doc) => {
              const item = doc.data() as any;
              if (!item.isDeleted) {
                results.push({ ...item, id: doc.id });
              }
            });
            return results;
          }
        } catch (cacheErr) {
          // Si no está en caché o es la primera carga, continuamos a la red
        }
      }

      // NIVEL 3: Servidor (Solo si no estaba en caché o si se fuerza refetch)
      try {
        const snapshot = forceServer 
          ? await withTimeout(getDocsFromServer(memoizedTargetRefOrQuery), 2500)
          : await withTimeout(getDocs(memoizedTargetRefOrQuery), 2500);

        // Firestore factura 1 lectura por documento devuelto; una consulta
        // vacía cuesta 1. Este contador es solo para diagnóstico.
        countServerReads(Math.max(1, snapshot.size), label);

        results = [];
        snapshot.forEach((doc) => {
          const item = doc.data() as any;
          if (!item.isDeleted) {
            results.push({ ...item, id: doc.id });
          }
        });
        return results;
      } catch (serverErr: any) {
        console.warn("Firestore fetch error:", serverErr?.code || serverErr?.message);
        
        // Si el servidor falla (ej. cuota diaria de 50k agotada o sin conexión), rescatar de IndexedDB
        try {
          const emergencyCacheSnap = await getDocsFromCache(memoizedTargetRefOrQuery);
          if (!emergencyCacheSnap.empty) {
            countCacheHits(emergencyCacheSnap.size, label);
            results = [];
            emergencyCacheSnap.forEach((doc) => {
              const item = doc.data() as any;
              if (!item.isDeleted) {
                results.push({ ...item, id: doc.id });
              }
            });
            return results;
          }
        } catch (e) {}
        
        throw serverErr;
      }
    })();

    pendingQueries.set(queryKey, queryPromise);

    try {
      const finalResults = await queryPromise;
      if (isMountedRef.current) {
        setCachedData(queryKey, finalResults);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        // Solo registrar error si no tenemos datos en memoria
        if (!dataCacheRef.current[queryKey]) {
          setError(err);
        }
      }
    } finally {
      pendingQueries.delete(queryKey);
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [memoizedTargetRefOrQuery, queryKey, setCachedData, firestore, user]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error(memoizedTargetRefOrQuery + ' was not properly memoized using useMemoFirebase');
  }

  return { data, isLoading, error, refetch, mutate };
}