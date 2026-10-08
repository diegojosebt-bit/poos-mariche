'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
  serverTimestamp,
  doc,
  Firestore
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * Helper para actualizar el Documento Guardián de Inventario
 */
async function updateGuardianMetadata(db: Firestore, userId: string) {
    try {
        const guardianRef = doc(db, 'users', userId, 'metadata', 'inventory_status');
        await setDoc(guardianRef, {
            lastUpdated: new Date().toISOString(),
            version: serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.warn("No se pudo actualizar metadatos del guardián:", e);
    }
}

/**
 * Realiza un setDoc con soporte para Metadatos e Invalización
 */
export async function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  try {
    const isProduct = docRef.path.includes('/products/');
    const enrichedData = isProduct ? { 
        ...data, 
        updatedAt: serverTimestamp(),
        isDeleted: data.isDeleted ?? false 
    } : data;

    const promise = setDoc(docRef, enrichedData, options);
    
    if (isProduct) {
        // Extraemos el userId de la ruta (users/{userId}/products/{id})
        const userId = docRef.path.split('/')[1];
        updateGuardianMetadata(docRef.firestore, userId);
    }

    return await promise;
  } catch (error) {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write',
        requestResourceData: data,
      })
    );
    throw error;
  }
}

/**
 * Realiza un addDoc enriquecido
 */
export async function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  try {
    const isProduct = colRef.path.includes('/products');
    const enrichedData = isProduct ? { 
        ...data, 
        updatedAt: serverTimestamp(),
        isDeleted: false 
    } : data;

    const promise = await addDoc(colRef, enrichedData);
    
    if (isProduct) {
        const userId = colRef.path.split('/')[1];
        updateGuardianMetadata(colRef.firestore, userId);
    }

    return promise;
  } catch (error) {
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: data,
        })
      );
    throw error;
  }
}

/**
 * Realiza un updateDoc enriquecido
 */
export async function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  try {
    const isProduct = docRef.path.includes('/products/');
    const enrichedData = isProduct ? { 
        ...data, 
        updatedAt: serverTimestamp() 
    } : data;

    const promise = updateDoc(docRef, enrichedData);

    if (isProduct) {
        const userId = docRef.path.split('/')[1];
        updateGuardianMetadata(docRef.firestore, userId);
    }

    return await promise;
  } catch (error) {
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        })
      );
    throw error;
  }
}

/**
 * Realiza un deleteDoc con lógica de Soft Delete para productos
 */
export async function deleteDocumentNonBlocking(docRef: DocumentReference) {
  try {
    const isProduct = docRef.path.includes('/products/');
    
    if (isProduct) {
        // SOFT DELETE: No borramos físicamente, marcamos como eliminado
        const userId = docRef.path.split('/')[1];
        const promise = updateDoc(docRef, {
            isDeleted: true,
            updatedAt: serverTimestamp()
        });
        updateGuardianMetadata(docRef.firestore, userId);
        return await promise;
    } else {
        // Borrado físico estándar para otras colecciones
        return await deleteDoc(docRef);
    }
  } catch (error) {
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      );
    throw error;
  }
}
