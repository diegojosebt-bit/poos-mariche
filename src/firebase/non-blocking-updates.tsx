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

    return await setDoc(docRef, enrichedData, options);
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
 * Realiza un deleteDoc físico (hard delete) para cualquier colección.
 * Los productos también se eliminan de la base, sin soft delete.
 */
export async function deleteDocumentNonBlocking(docRef: DocumentReference) {
  try {
    return await deleteDoc(docRef);
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
