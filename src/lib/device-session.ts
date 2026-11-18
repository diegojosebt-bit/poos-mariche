import { differenceInHours, parseISO } from 'date-fns';
import type { ActiveOperator, ActiveRegisterSession } from './types';

export const DEVICE_ID_KEY = 'mm_device_id';
export const SESSION_KEY = 'mm_session_id';

const VALID_DEVICE_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

/**
 * Obtiene o crea un ID único de dispositivo / caja.
 *
 * Aislamiento Multi-Pestaña y Multi-Caja:
 * - Prioriza sessionStorage para que pestañas/ventanas distintas en el mismo navegador
 *   actúen como cajas independientes al hacer pruebas o cobros paralelos.
 * - Si sessionStorage está vacío, consulta localStorage para mantener el ID de un equipo físico.
 * - Si no existe en ninguno, genera un ID nuevo con prefijo `dev_`.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server';

  try {
    const sessionVal = sessionStorage.getItem(DEVICE_ID_KEY);
    if (sessionVal && VALID_DEVICE_ID_RE.test(sessionVal)) {
      return sessionVal;
    }

    const localVal = localStorage.getItem(DEVICE_ID_KEY);
    // Si localStorage ya tiene un ID, sólo lo adoptamos en la primera pestaña;
    // para pruebas multi-caja en pestañas nuevas, creamos uno único por sesión.
    let newId: string;
    if (localVal && VALID_DEVICE_ID_RE.test(localVal) && !sessionVal) {
      newId = localVal;
    } else {
      newId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    sessionStorage.setItem(DEVICE_ID_KEY, newId);
    if (!localStorage.getItem(DEVICE_ID_KEY)) {
      localStorage.setItem(DEVICE_ID_KEY, newId);
    }
    return newId;
  } catch {
    return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Construye el payload de una sesión de caja para Firestore.
 */
export function buildDeviceSession(
  deviceId: string,
  deviceName: string,
  operator: ActiveOperator | null,
  mode: 'register' | 'supervisor' = 'register',
): ActiveRegisterSession {
  const session: ActiveRegisterSession = {
    deviceId,
    deviceName: deviceName?.trim() || 'Caja Principal',
    mode,
    lastSeenAt: new Date().toISOString(),
  };
  if (operator?.id) session.cashierId = operator.id;
  if (operator?.name) session.cashierName = operator.name;
  if (operator) session.isOwner = operator.isOwner;
  return session;
}

/**
 * Filtra sesiones frescas (máximo 14 horas de inactividad para descartar turnos del día anterior).
 */
export function getFreshSessions(
  raw: Record<string, ActiveRegisterSession> | undefined,
): Record<string, ActiveRegisterSession> {
  if (!raw) return {};
  const now = new Date();
  const fresh: Record<string, ActiveRegisterSession> = {};
  for (const [key, session] of Object.entries(raw)) {
    if (!session?.lastSeenAt) continue;
    try {
      if (differenceInHours(now, parseISO(session.lastSeenAt)) < 14) {
        const cleaned: ActiveRegisterSession = {
          deviceId: session.deviceId || key,
          lastSeenAt: session.lastSeenAt,
        };
        if (session.deviceName) cleaned.deviceName = session.deviceName;
        if (session.cashierId) cleaned.cashierId = session.cashierId;
        if (session.cashierName) cleaned.cashierName = session.cashierName;
        if (typeof session.isOwner === 'boolean') cleaned.isOwner = session.isOwner;
        if (session.mode === 'register' || session.mode === 'supervisor') cleaned.mode = session.mode;
        fresh[key] = cleaned;
      }
    } catch {
      // Ignorar fechas inválidas
    }
  }
  return fresh;
}

/**
 * Encuentra si otro equipo ya tiene activo al mismo cajero.
 */
export function findDuplicateCashierSession(
  fresh: Record<string, ActiveRegisterSession>,
  currentDeviceId: string,
  cashierId: string | undefined,
): ActiveRegisterSession | undefined {
  if (!cashierId) return undefined;
  return Object.values(fresh).find(
    (s) => s.deviceId !== currentDeviceId && s.cashierId === cashierId && s.mode !== 'supervisor',
  );
}
