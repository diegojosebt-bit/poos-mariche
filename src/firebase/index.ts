'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentSingleTabManager,
  getFirestore,
  Firestore
} from 'firebase/firestore';

/**
 * initializeFirebase - Punto de entrada principal para los SDKs de Firebase.
 * Implementa una inicialización segura que evita duplicidad de instancias.
 */
export function initializeFirebase() {
  if (!getApps().length) {
    let firebaseApp;
    try {
      firebaseApp = initializeApp();
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      firebaseApp = initializeApp(firebaseConfig);
    }

    return getSdks(firebaseApp);
  }

  return getSdks(getApp());
}

/**
 * getSdks - Configura y retorna las instancias de Auth y Firestore.
 * Implementa persistencia local en IndexedDB con bloqueo de pestaña única (Safety First).
 */
export function getSdks(firebaseApp: FirebaseApp) {
  let firestore: Firestore;

  if (typeof window !== 'undefined') {
    /**
     * CONFIGURACIÓN DE SEGURIDAD Y COSTOS:
     * 1. persistentLocalCache: Habilita el guardado de datos en IndexedDB.
     * 2. persistentSingleTabManager: Restringe la caché a una sola pestaña activa. 
     *    Si se abre otra pestaña, Firestore funcionará sin caché o dará error de permisos 
     *    según las reglas de negocio implementadas en el layout.
     */
    try {
      firestore = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager()
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
