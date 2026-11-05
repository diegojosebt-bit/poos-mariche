'use client';
import {
  Auth,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateEmail,
  updatePassword,
  sendPasswordResetEmail,
} from 'firebase/auth';

/** Initiate anonymous sign-in. */
export async function initiateAnonymousSignIn(authInstance: Auth) {
  return signInAnonymously(authInstance);
}

/** Initiate email/password sign-up. */
export async function initiateEmailSignUp(authInstance: Auth, email: string, password: string) {
  return createUserWithEmailAndPassword(authInstance, email, password);
}

/** Initiate email/password sign-in. */
export async function initiateEmailSignIn(authInstance: Auth, email: string, password: string) {
  return signInWithEmailAndPassword(authInstance, email, password);
}

/** Sends a password reset email to a specific email address. */
export async function sendResetEmail(authInstance: Auth, email: string) {
    return sendPasswordResetEmail(authInstance, email);
}

/** Updates the current user's email. */
export async function updateUserEmail(authInstance: Auth, newEmail: string) {
    if (!authInstance.currentUser) throw new Error("No hay sesión activa");
    return updateEmail(authInstance.currentUser, newEmail);
}

/** Updates the current user's password. */
export async function updateUserPassword(authInstance: Auth, newPass: string) {
    if (!authInstance.currentUser) throw new Error("No hay sesión activa");
    return updatePassword(authInstance.currentUser, newPass);
}
