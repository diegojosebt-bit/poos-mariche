'use client';
    
import { useState, useEffect, useCallback } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentData,
  FirestoreError,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type WithId<T> = T & { id: string };

export interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  refetch: () => Promise<void>;
  mutate: (newData: WithId<T> | ((prev: WithId<T> | null) => WithId<T> | null)) => void;
}

/**
 * Hook de Tiempo Real (PUSH).
 * Usa onSnapshot para asegurar que los datos se actualicen instantáneamente
 * sin necesidad de refrescar la página, manteniendo eficiencia en lecturas.
 */
export function useDoc<T = any>(
  memoizedDocRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const mutate = useCallback((updater: WithId<T> | ((prev: WithId<T> | null) => WithId<T> | null)) => {
    setData(current => typeof updater === 'function' ? updater(current) : updater);
  }, []);

  // Refetch se mantiene por compatibilidad, pero onSnapshot ya lo hace solo
  const refetch = useCallback(async () => {
      // El listener de onSnapshot ya mantiene los datos frescos
  }, []);

  useEffect(() => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Creamos el escuchador en tiempo real
    const unsubscribe = onSnapshot(
      memoizedDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setData({ ...(snapshot.data() as T), id: snapshot.id });
        } else {
          setData(null);
        }
        setIsLoading(false);
      },
      (err: any) => {
        console.error("Firestore Doc Listener Error:", err);
        const contextualError = new FirestorePermissionError({
          operation: 'get',
          path: memoizedDocRef.path,
        });
        setError(contextualError);
        errorEmitter.emit('permission-error', contextualError);
        setIsLoading(false);
      }
    );

    // Limpieza al desmontar el componente
    return () => unsubscribe();
  }, [memoizedDocRef]);

  return { data, isLoading, error, refetch, mutate };
}
