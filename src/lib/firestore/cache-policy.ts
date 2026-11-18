import type { WhereFilterOp } from 'firebase/firestore';

/**
 * Política de caché de Firestore (Fase 0).
 *
 * Objetivo: que dos consultas distintas NUNCA compartan clave y que la app
 * sepa cuándo su copia local sigue siendo válida, sin pagar lecturas.
 *
 * - `buildQueryKey`: clave determinista y serializable (nada de internals del SDK).
 * - `serializeValue`: fechas y Timestamps se serializan de verdad (antes se
 *   colapsaban a "val" y dos rangos distintos compartían caché).
 * - `getLastSync` / `setLastSync`: marca de última sincronización con el
 *   servidor en `localStorage` (0 lecturas), para sobrevivir a un F5 dentro
 *   del TTL.
 */

export type QueryFilter = [field: string, op: WhereFilterOp, value: unknown];

export const TTL_MS: Record<string, number> = {
  products: 10 * 60_000,
  repair_jobs: 3 * 60_000,
  sale_transactions: 5 * 60_000,
  fiados: 5 * 60_000,
  expenses: 10 * 60_000,
  held_sales: 60_000,
  currency_exchanges: 10 * 60_000,
  daily_reconciliations: 10 * 60_000,
  users: 10 * 60_000,
  stats: 60_000,
  stats_daily: 60_000,
  stats_monthly: 60_000,
  stats_analysis: 60_000,
};

export const ttlFor = (collectionName: string): number =>
  TTL_MS[collectionName] ?? 5 * 60_000;

const isTimestampLike = (value: object): value is { seconds: number; nanoseconds?: number } =>
  'seconds' in value && typeof (value as { seconds?: unknown }).seconds === 'number';

/**
 * Serializa un valor de filtro de forma estable.
 * Soporta primitivos, Date, Timestamp de Firestore, arrays y los wrappers
 * internos del SDK (`_internalValue` / `{ type: 'value' }`).
 */
export function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return `date:${value.getTime()}`;

  if (Array.isArray(value)) {
    return `[${value.map(serializeValue).join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, any>;

    // Timestamp de Firestore: { seconds, nanoseconds }
    if (isTimestampLike(obj)) return `ts:${obj.seconds}:${obj.nanoseconds ?? 0}`;

    // DocumentReference: { path, ... } (duck typing)
    if (typeof obj.path === 'string' && ('converter' in obj || 'firestore' in obj)) {
      return `ref:${obj.path}`;
    }

    // Wrappers internos del SDK (según versión)
    if ('_internalValue' in obj) return serializeValue(obj._internalValue);
    if (obj.type === 'value' && 'value' in obj) return serializeValue(obj.value);

    try {
      return `obj:${JSON.stringify(obj)}`;
    } catch {
      return `obj:${String(obj)}`;
    }
  }

  return `${typeof value}:${String(value)}`;
}

export function buildQueryKey(
  uid: string,
  collectionName: string,
  opts: {
    filters?: QueryFilter[];
    orderField?: string;
    orderDir?: 'asc' | 'desc';
    pageSize?: number;
    search?: string;
  } = {},
): string {
  const filters = (opts.filters ?? [])
    .map(([field, op, value]) => `${field}${op}${serializeValue(value)}`)
    .sort()
    .join('&');

  return [
    `u:${uid}`,
    `c:${collectionName}`,
    `f:${filters || '-'}`,
    `o:${opts.orderField ?? '__name__'}:${opts.orderDir ?? 'asc'}`,
    `l:${opts.pageSize ?? 0}`,
    `s:${opts.search ?? '-'}`,
  ].join('|');
}

/** Clave para consultas ya construidas con el SDK (compatibilidad Fase 0). */
export function buildKeyFromParts(parts: {
  path: string;
  limit?: number | string;
  orders?: string;
  filters?: string;
  search?: string;
}): string {
  return [
    `p:${parts.path || 'unknown'}`,
    `l:${parts.limit ?? 'none'}`,
    `o:${parts.orders || '-'}`,
    `f:${parts.filters || '-'}`,
    `s:${parts.search || '-'}`,
  ].join('|');
}

const SYNC_PREFIX = 'fsq:sync:';

export function getLastSync(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(SYNC_PREFIX + key);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export function setLastSync(key: string, at = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SYNC_PREFIX + key, String(at));
  } catch {
    /* cuota llena o modo privado: se ignora */
  }
}

export function isSyncFresh(key: string, ttlMs: number): boolean {
  const last = getLastSync(key);
  return last > 0 && Date.now() - last < ttlMs;
}

export function clearSync(key?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (key) {
      window.localStorage.removeItem(SYNC_PREFIX + key);
      return;
    }
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(SYNC_PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* noop */
  }
}
