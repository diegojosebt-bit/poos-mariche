'use client';

import { useEffect, useState } from 'react';
import type { UserProfile } from '@/lib/types';

/**
 * Banderas de despliegue progresivo.
 *
 * Se activan por negocio en `users/{uid}.featureFlags` (el perfil ya se
 * escucha con `onSnapshot`, así que leerlas cuesta 0 lecturas extra).
 *
 * Ejemplo en Firestore:
 *   { "pagedData": true, "serverSearch": true, "rollups": true }
 *
 * Para probar en local sin tocar Firestore:
 *   ?ff=pagedData                  (activa una)
 *   ?ff=pagedData,serverSearch     (activa varias)
 *   ?ff=-pagedData                 (desactiva)
 *
 * El override dura la pestaña (sessionStorage).
 */
export type FeatureFlag = 'pagedData' | 'serverSearch' | 'rollups';

const STORAGE_KEY = 'mm_ff';

export function isFeatureEnabled(
  profile: Pick<UserProfile, 'featureFlags'> | null | undefined,
  flag: FeatureFlag,
): boolean {
  return profile?.featureFlags?.[flag] === true;
}

function readFlagList(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = new URLSearchParams(window.location.search).get('ff');
    const source = raw !== null ? raw : window.sessionStorage.getItem(STORAGE_KEY) ?? '';
    return source
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readOverride(flag: FeatureFlag): boolean | null {
  const list = readFlagList();
  if (list.includes(`-${flag}`)) return false;
  if (list.includes(flag)) return true;
  return null;
}

/**
 * Hook de bandera: prioridad URL (`?ff=`) → sessionStorage → perfil.
 * Se inicializa en el cliente (las pantallas del dashboard se renderizan
 * después del login, así que no hay desajuste de hidratación).
 */
export function useFeatureFlag(
  profile: Pick<UserProfile, 'featureFlags'> | null | undefined,
  flag: FeatureFlag,
): boolean {
  const [value, setValue] = useState<boolean>(() => {
    const override = readOverride(flag);
    return override ?? isFeatureEnabled(profile, flag);
  });

  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get('ff');
      if (raw !== null) {
        const list = raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

        if (list.length > 0) {
          window.sessionStorage.setItem(STORAGE_KEY, list.join(','));
        } else {
          window.sessionStorage.removeItem(STORAGE_KEY);
        }
      }

      setValue(readOverride(flag) ?? isFeatureEnabled(profile, flag));
    } catch {
      /* modo privado */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);

  return value;
}
