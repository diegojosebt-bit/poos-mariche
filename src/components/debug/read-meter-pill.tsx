'use client';

import { useEffect, useState } from 'react';
import { readSnapshot, resetReads } from '@/lib/firestore/read-meter';

/**
 * Pastilla de diagnóstico (solo QA). Se activa con `?reads=1` y se mantiene
 * durante la sesión de pestaña; `?reads=0` la apaga.
 *
 * Muestra:
 *  - `lecturas`: documentos devueltos por el servidor (lo que se factura).
 *  - `caché`: documentos servidos desde IndexedDB (0 lecturas).
 *
 * Al hacer clic se reinicia el contador.
 */
export function ReadMeterPill() {
  const [enabled, setEnabled] = useState(false);
  const [totals, setTotals] = useState({ reads: 0, cacheHits: 0 });

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('reads') === '1') sessionStorage.setItem('mm_reads', '1');
      if (params.get('reads') === '0') sessionStorage.removeItem('mm_reads');
      setEnabled(sessionStorage.getItem('mm_reads') === '1');
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      const snapshot = readSnapshot();
      setTotals({ reads: snapshot.reads, cacheHits: snapshot.cacheHits });
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => {
        resetReads();
        setTotals({ reads: 0, cacheHits: 0 });
      }}
      title="Lecturas de servidor en esta pestaña. Clic para reiniciar."
      className="fixed bottom-3 right-3 z-[9999] flex items-center gap-2 rounded-full bg-slate-900/95 px-3 py-1.5 font-mono text-[11px] text-white shadow-xl ring-1 ring-white/10 transition hover:bg-slate-800"
    >
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        lecturas {totals.reads}
      </span>
      <span className="text-white/30">|</span>
      <span className="flex items-center gap-1 text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        caché {totals.cacheHits}
      </span>
    </button>
  );
}
