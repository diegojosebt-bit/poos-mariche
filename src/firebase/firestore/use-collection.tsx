'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Query,
  getDocs,
  DocumentData,
  FirestoreError,
  CollectionReference,
  getDocFromServer,
  doc,
  getDocsFromCache,
  getDocsFromServer,
  where,
  query,
  Timestamp
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useDashboardStore } from '@/contexts/dashboard-context';
import { useFirebase } from '@/firebase';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  refetch: () => Promise<void>;
  mutate: (updater: WithId<T>[] | ((prev: WithId<T>[] | null) => WithId<T>[] | null)) => void;
}

export interface InternalQuery extends Query<DocumentData> {
  _query: {
    path: {
      canonicalString(): string;
      toString(): string;
    }
  }
}

/**
 * Extrae la ruta de forma segura sin lanzar excepciones si las propiedades privadas cambian.
 */
function getSafePath(query: any): string {
    if (!query) return '';
    try {
        if (query.type === 'collection') {
            return (query as CollectionReference).path || 'collection';
        }
        return (query as any)._query?.path?.canonicalString?.() 
            || (query as any)._query?.path?.toString?.() 
            || (query as any).path 
            || 'unknown_path';
    } catch {
        return 'unknown_path';
    }
}

/**
 * Función para generar una clave de caché única basada en la consulta de Firestore de forma segura.
 */
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
                let val = 'val';
                if (typeof f?.value === 'string' || typeof f?.value === 'number' || typeof f?.value === 'boolean') {
                    val = String(f.value);
                } else if (Array.isArray(f?.value)) {
                    val = `arr[${f.value.length}]`;
                }
                return `${field}_${op}_${val}`;
            }).join('&');
        }

        return `collection_cache:${path}:limit_${limitVal}:orders_${orderFields}:filters_${filterSummary}`;
    } catch (e) {
        return 'unknown_query_key';
    }
}

/**
 * useCollection - Hook Inteligente con Delta Sync y Patrón Guardián
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  const { dataCache, setCachedData } = useDashboardStore();
  const { firestore, user } = useFirebase();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined' && user?.uid) {
      try {
        localStorage.removeItem(`last_sync_products_${user.uid}`);
      } catch (e) {}
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [user?.uid]);
  
  const queryKey = useMemo(() => getQueryCacheKey(memoizedTargetRefOrQuery), [memoizedTargetRefOrQuery]);
  const data = (queryKey ? dataCache[queryKey] : null) as ResultItemType[] | null;
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const mutate = useCallback((updater: ResultItemType[] | ((prev: ResultItemType[] | null) => ResultItemType[] | null)) => {
    if (!queryKey) return;
    const newData = typeof updater === 'function' ? updater(data) : updater;
    setCachedData(queryKey, newData);
  }, [queryKey, data, setCachedData]);

  const fetchData = useCallback(async (forceServer = false) => {
    if (!memoizedTargetRefOrQuery || !queryKey || !firestore || !user) {
      if (!memoizedTargetRefOrQuery && isMountedRef.current) setIsLoading(false);
      return;
    }

    // 1. VERIFICACIÓN RAM (Caché de nivel 1 - 0ms)
    if (!forceServer && dataCache[queryKey] !== undefined && dataCache[queryKey] !== null) {
        return;
    }

    if (isMountedRef.current) {
      setIsLoading(true);
      setError(null);
    }

    const path = getSafePath(memoizedTargetRefOrQuery);

    try {
      let results: ResultItemType[] = [];

      // Carga directa y autoritativa desde Firestore
      const snapshot = forceServer ? await getDocsFromServer(memoizedTargetRefOrQuery) : await getDocs(memoizedTargetRefOrQuery);
      snapshot.forEach((doc) => {
        const item = doc.data() as any;
        if (!item.isDeleted) {
          results.push({ ...item, id: doc.id });
        }
      });
      
      if (isMountedRef.current) {
        setCachedData(queryKey, results);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        console.error("Fetch error:", err);
        const contextualError = new FirestorePermissionError({
          operation: 'list',
          path,
        });
        setError(contextualError);
        errorEmitter.emit('permission-error', contextualError);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [memoizedTargetRefOrQuery, queryKey, dataCache, setCachedData, firestore, user]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error(memoizedTargetRefOrQuery + ' was not properly memoized using useMemoFirebase');
  }

  return { data, isLoading, error, refetch, mutate };
}