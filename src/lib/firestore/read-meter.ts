/**
 * Medidor de lecturas de Firestore (solo para diagnóstico).
 *
 * Cuenta:
 *  - `reads`: documentos devueltos por el servidor (lo que Firestore factura).
 *  - `cacheHits`: documentos servidos desde IndexedDB (0 lecturas).
 *
 * No altera el comportamiento de la app. Se activa con `?reads=1` (ver
 * `src/components/debug/read-meter-pill.tsx`).
 */

export type ReadSnapshot = {
  reads: number;
  cacheHits: number;
  byKey: Record<string, number>;
  cacheByKey: Record<string, number>;
};

const state: ReadSnapshot = {
  reads: 0,
  cacheHits: 0,
  byKey: {},
  cacheByKey: {},
};

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).__MM_READS_DEBUG);
}

export function countServerReads(count: number, label = 'query'): void {
  if (!Number.isFinite(count) || count < 0) return;
  state.reads += count;
  state.byKey[label] = (state.byKey[label] ?? 0) + count;
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.debug(`[reads] +${count} (${label}) → ${state.reads}`);
  }
}

export function countCacheHits(count: number, label = 'query'): void {
  if (!Number.isFinite(count) || count < 0) return;
  state.cacheHits += count;
  state.cacheByKey[label] = (state.cacheByKey[label] ?? 0) + count;
}

export function readSnapshot(): ReadSnapshot {
  return {
    reads: state.reads,
    cacheHits: state.cacheHits,
    byKey: { ...state.byKey },
    cacheByKey: { ...state.cacheByKey },
  };
}

export function resetReads(): void {
  state.reads = 0;
  state.cacheHits = 0;
  Object.keys(state.byKey).forEach((k) => delete state.byKey[k]);
  Object.keys(state.cacheByKey).forEach((k) => delete state.cacheByKey[k]);
}

if (typeof window !== 'undefined') {
  (window as any).__reads = {
    snapshot: readSnapshot,
    reset: resetReads,
    count: countServerReads,
  };
}
