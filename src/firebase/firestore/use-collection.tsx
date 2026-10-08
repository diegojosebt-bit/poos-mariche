'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
 * Función para generar una clave de caché única basada en la consulta de Firestore.
 */
function getQueryCacheKey(query: any): string {
    if (!query) return '';
    try {
        const path = query.type === 'collection' 
            ? (query as CollectionReference).path 
            : (query as unknown as InternalQuery)._query.path.canonicalString();
        
        const queryInternal = (query as any)._query || {};
        const signature = JSON.stringify({
            filters: queryInternal.filters || [],
            orders: queryInternal.explicitOrderBy || [],
            limit: queryInternal.limit || null
        });

        return `collection_cache:${path}:${signature}`;
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
  
  const queryKey = useMemo(() => getQueryCacheKey(memoizedTargetRefOrQuery), [memoizedTargetRefOrQuery]);
  const data = (queryKey ? dataCache[queryKey] : null) as ResultItemType[] | null;
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const mutate = useCallback((updater: ResultItemType[] | ((prev: ResultItemType[] | null) => ResultItemType[] | null)) => {
    if (!queryKey) return;
    const newData = typeof updater === 'function' ? updater(data) : updater;
    setCachedData(queryKey, newData);
  }, [queryKey, data, setCachedData]);

  const fetchData = useCallback(async () => {
    if (!memoizedTargetRefOrQuery || !queryKey || !firestore || !user) {
      if (!memoizedTargetRefOrQuery) setIsLoading(false);
      return;
    }

    // 1. VERIFICACIÓN RAM (Caché de nivel 1 - 0ms)
    if (dataCache[queryKey] !== undefined && dataCache[queryKey] !== null) {
        return;
    }

    setIsLoading(true);
    setError(null);

    const path = memoizedTargetRefOrQuery.type === 'collection'
        ? (memoizedTargetRefOrQuery as CollectionReference).path
        : (memoizedTargetRefOrQuery as unknown as InternalQuery)._query.path.canonicalString();

    try {
      let results: ResultItemType[] = [];

      // 2. PATRÓN DE DOCUMENTO GUARDIÁN (Solo para Inventario)
      if (path.includes('/products')) {
          const syncKey = `last_sync_products_${user.uid}`;
          const localTimestamp = localStorage.getItem(syncKey);
          const guardianRef = doc(firestore, 'users', user.uid, 'metadata', 'inventory_status');

          try {
              // Consultamos solo 1 documento de metadatos (1 lectura)
              const guardianSnap = await getDocFromServer(guardianRef);
              const serverTimestamp = guardianSnap.exists() ? guardianSnap.data().lastUpdated : null;

              if (serverTimestamp && localTimestamp === serverTimestamp) {
                  // VERSIONES COINCIDEN: Carga instantánea desde disco local
                  const cacheSnapshot = await getDocsFromCache(memoizedTargetRefOrQuery);
                  cacheSnapshot.forEach(doc => {
                      const p = doc.data() as any;
                      if (!p.isDeleted) results.push({ ...p, id: doc.id });
                  });
              } else if (serverTimestamp && localTimestamp) {
                  // DELTA SYNC: Intentar descargar solo lo nuevo desde el último timestamp local
                  try {
                      const mergedMap = new Map<string, any>();
                      
                      // Cargar base desde caché (0 lecturas)
                      const cacheSnap = await getDocsFromCache(memoizedTargetRefOrQuery);
                      cacheSnap.forEach(d => mergedMap.set(d.id, d.data()));

                      // Pedir solo el "Delta" (documentos modificados después de localTimestamp)
                      const lastSyncDate = new Date(localTimestamp);
                      const deltaQuery = query(memoizedTargetRefOrQuery, where('updatedAt', '>', lastSyncDate));
                      const deltaSnap = await getDocsFromServer(deltaQuery);
                      
                      deltaSnap.forEach(d => mergedMap.set(d.id, d.data()));

                      // Reconstruir lista filtrando eliminados
                      results = Array.from(mergedMap.entries())
                        .map(([id, data]) => ({ ...data, id }))
                        .filter(p => !p.isDeleted);

                      localStorage.setItem(syncKey, serverTimestamp);
                  } catch (deltaErr) {
                      // FALLBACK: Si falta índice o falla Delta, descarga completa de seguridad
                      const fullSnap = await getDocsFromServer(memoizedTargetRefOrQuery);
                      fullSnap.forEach(doc => {
                          const p = doc.data() as any;
                          if (!p.isDeleted) results.push({ ...p, id: doc.id });
                      });
                      localStorage.setItem(syncKey, serverTimestamp);
                  }
              } else {
                  // PRIMERA CARGA: Descarga completa inicial
                  const serverSnapshot = await getDocsFromServer(memoizedTargetRefOrQuery);
                  serverSnapshot.forEach(doc => {
                      const p = doc.data() as any;
                      if (!p.isDeleted) results.push({ ...p, id: doc.id });
                  });
                  if (serverTimestamp) localStorage.setItem(syncKey, serverTimestamp);
              }
          } catch (guardianErr) {
              // FALLBACK OFFLINE: Si falla el guardián, intentar caché y luego servidor
              try {
                  const snap = await getDocsFromCache(memoizedTargetRefOrQuery);
                  snap.forEach(doc => {
                      const p = doc.data() as any;
                      if (!p.isDeleted) results.push({ ...p, id: doc.id });
                  });
              } catch {
                  const snap = await getDocsFromServer(memoizedTargetRefOrQuery);
                  snap.forEach(doc => {
                      const p = doc.data() as any;
                      if (!p.isDeleted) results.push({ ...p, id: doc.id });
                  });
              }
          }
      } else {
          // 3. LOGICA ESTANDAR PARA OTRAS COLECCIONES
          const snapshot = await getDocs(memoizedTargetRefOrQuery);
          snapshot.forEach((doc) => {
            results.push({ ...(doc.data() as T), id: doc.id });
          });
      }
      
      setCachedData(queryKey, results);
    } catch (err: any) {
      console.error("Fetch error:", err);
      const contextualError = new FirestorePermissionError({
        operation: 'list',
        path,
      });
      setError(contextualError);
      errorEmitter.emit('permission-error', contextualError);
    } finally {
      setIsLoading(false);
    }
  }, [memoizedTargetRefOrQuery, queryKey, dataCache, setCachedData, firestore, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error(memoizedTargetRefOrQuery + ' was not properly memoized using useMemoFirebase');
  }

  return { data, isLoading, error, refetch: fetchData, mutate };
}