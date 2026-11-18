"use client";

const SHA256_PREFIX = "sha256:";

/**
 * Hashea un PIN con SHA-256 usando WebCrypto nativo y un salt por negocio.
 * - 0 dependencias, 0 lecturas extra a Firestore.
 * - Si WebCrypto no está disponible (ej. red local HTTP sin HTTPS), guarda el
 *   PIN normal para no romper pruebas locales y lo hashea al operar en HTTPS.
 */
export async function hashPin(pin: string, salt = "mm_default"): Promise<string> {
  const clean = pin.trim();
  if (!clean) return "";
  if (clean.startsWith(SHA256_PREFIX)) return clean;

  try {
    if (typeof window !== "undefined" && window.crypto?.subtle) {
      const data = new TextEncoder().encode(`${salt}:${clean}`);
      const digest = await window.crypto.subtle.digest("SHA-256", data);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `${SHA256_PREFIX}${hex}`;
    }
  } catch {
    // Fallback seguro en contextos no seguros locales
  }
  return clean;
}

export function isHashedPin(stored?: string | null): boolean {
  return Boolean(stored && stored.startsWith(SHA256_PREFIX));
}

/**
 * Verifica un PIN ingresado contra un PIN almacenado (compatible tanto con
 * hashes `sha256:` nuevos como con PINs legados en texto plano).
 */
export async function verifyPin(
  inputPin: string,
  storedPin?: string | null,
  salt = "mm_default",
): Promise<boolean> {
  if (!storedPin) return false;
  const cleanInput = inputPin.trim();
  if (!cleanInput) return false;

  if (!isHashedPin(storedPin)) {
    return constantTimeEqual(cleanInput, storedPin);
  }

  const hashedInput = await hashPin(cleanInput, salt);
  return constantTimeEqual(hashedInput, storedPin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Bloqueo progresivo persistente en `localStorage` (sobrevive recargas F5).
 */
export type LockoutRecord = {
  attempts: number;
  strikes: number;
  lockedUntil: number;
};

export type LockoutConfig = {
  maxAttempts: number;
  /** Duraciones progresivas en segundos según cantidad de bloqueos previos. */
  durationsSeconds: number[];
};

export function readLockoutState(storageKey: string): {
  attempts: number;
  strikes: number;
  remainingSeconds: number;
  lockedUntil: number;
} {
  if (typeof window === "undefined") {
    return { attempts: 0, strikes: 0, remainingSeconds: 0, lockedUntil: 0 };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { attempts: 0, strikes: 0, remainingSeconds: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<LockoutRecord>;
    const lockedUntil = Number(parsed.lockedUntil || 0);
    const remainingSeconds = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
    return {
      attempts: Number(parsed.attempts || 0),
      strikes: Number(parsed.strikes || 0),
      remainingSeconds,
      lockedUntil,
    };
  } catch {
    return { attempts: 0, strikes: 0, remainingSeconds: 0, lockedUntil: 0 };
  }
}

export function recordFailedAttempt(
  storageKey: string,
  config: LockoutConfig,
): {
  attempts: number;
  remainingAttempts: number;
  locked: boolean;
  lockoutSeconds: number;
} {
  const current = readLockoutState(storageKey);
  if (current.remainingSeconds > 0) {
    return {
      attempts: current.attempts,
      remainingAttempts: 0,
      locked: true,
      lockoutSeconds: current.remainingSeconds,
    };
  }

  const nextAttempts = current.attempts + 1;
  if (nextAttempts >= config.maxAttempts) {
    const nextStrikes = current.strikes + 1;
    const durationIdx = Math.min(nextStrikes - 1, config.durationsSeconds.length - 1);
    const lockoutSeconds = config.durationsSeconds[durationIdx] || 60;
    const lockedUntil = Date.now() + lockoutSeconds * 1000;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ attempts: 0, strikes: nextStrikes, lockedUntil }),
      );
    } catch {}
    return {
      attempts: 0,
      remainingAttempts: 0,
      locked: true,
      lockoutSeconds,
    };
  }

  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        attempts: nextAttempts,
        strikes: current.strikes,
        lockedUntil: 0,
      }),
    );
  } catch {}

  return {
    attempts: nextAttempts,
    remainingAttempts: Math.max(0, config.maxAttempts - nextAttempts),
    locked: false,
    lockoutSeconds: 0,
  };
}

export function forceLockout(storageKey: string, seconds: number) {
  if (typeof window === "undefined") return;
  const current = readLockoutState(storageKey);
  const lockedUntil = Date.now() + seconds * 1000;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        attempts: 0,
        strikes: current.strikes + 1,
        lockedUntil,
      }),
    );
  } catch {}
}

export function clearLockoutState(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey);
  } catch {}
}
