'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  getFirestore,
  Firestore
} from 'firebase/firestore';

/**
 * initializeFirebase - Punto de entrada principal para los SDKs de Firebase.
 * Implementa una inicialización segura que evita duplicidad de instancias.
 */
export function initializeFirebase() {
  if (!getApps().length) {
    const firebaseApp = initializeApp(firebaseConfig);
    return getSdks(firebaseApp);
  }

  return getSdks(getApp());
}

/**
 * getSdks - Configura y retorna las instancias de Auth y Firestore.
 * Implementa persistencia local en IndexedDB compartida entre múltiples pestañas.
 */
export function getSdks(firebaseApp: FirebaseApp) {
  let firestore: Firestore;

  if (typeof window !== 'undefined') {
    try {
      firestore = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
    } catch (e) {
      // Fallback si initializeFirestore falla por estar ya inicializado
      firestore = getFirestore(firebaseApp);
    }
  } else {
    // Inicialización estándar para Server-Side Rendering
    firestore = getFirestore(firebaseApp);
  }

  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
