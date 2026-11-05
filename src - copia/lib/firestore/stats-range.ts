'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { useFirebase } from '@/firebase/provider';
import { dayKey } from './rollups';
import { countServerReads } from './read-meter';

export type DayStats = {
  salesUSD: number;
  salesCount: number;
  costUSD: number;
  profitUSD: number;
  expensesUSD: number;
  expensesBs: number;
  byMethod: Record<string, number>;
  items: Record<string, { n: string; q: number; rev: number; cost: number }>;
};

export type StatsAggregate = DayStats & {
  days: number;
  from: string;
  to: string;
};

const EMPTY_AGGREGATE: DayStats = {
  salesUSD: 0,
  salesCount: 0,
  costUSD: 0,
  profitUSD: 0,
  expensesUSD: 0,
  expensesBs: 0,
  byMethod: {},
  items: {},
};

// Caché corta para que cambiar de pestaña o re-render no repita lecturas.
const RANGE_TTL_MS = 60_000;
const rangeCache = new Map<string, { at: number; data: StatsAggregate }>();

function aggregateDocs(
  docs: Array<{ id: string; data: () => Record<string, any> }>,
  from: string,
  to: string,
): StatsAggregate {
  const total: StatsAggregate = {
    ...EMPTY_AGGREGATE,
    byMethod: {},
    items: {},
    days: docs.length,
    from,
    to,
  };

  for (const doc of docs) {
    const data = doc.data() as Partial<DayStats>;
    total.salesUSD += Number(data.salesUSD || 0);
    total.salesCount += Number(data.salesCount || 0);
    total.costUSD += Number(data.costUSD || 0);
    total.profitUSD += Number(data.profitUSD || 0);
    total.expensesUSD += Number(data.expensesUSD || 0);
    total.expensesBs += Number(data.expensesBs || 0);

    for (const [key, value] of Object.entries(data.byMethod ?? {})) {
      total.byMethod[key] = (total.byMethod[key] ?? 0) + Number(value || 0);
    }

    for (const [key, item] of Object.entries(data.items ?? {})) {
      const current = total.items[key] ?? { n: item.n, q: 0, rev: 0, cost: 0 };
      current.n = item.n ?? current.n;
      current.q += Number(item.q || 0);
      current.rev += Number(item.rev || 0);
      current.cost += Number(item.cost || 0);
      total.items[key] = current;
    }
  }

  return total;
}

/**
 * Lee `stats_daily` del rango (1 lectura por día, máximo 31 por mes) y lo
 * agrega en memoria. Si no hay documentos, `hasData` es false y la pantalla
 * debe usar el cálculo anterior como fallback.
 */
export function useDailyStatsRange(from?: Date, to?: Date) {
  const { firestore, user } = useFirebase();
  const [data, setData] = useState<StatsAggregate | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fromDay = from ? dayKey(from) : '';
  const toDay = to ? dayKey(to) : fromDay;

  const key = useMemo(
    () => (fromDay ? `${user?.uid ?? ''}|${fromDay}|${toDay}` : ''),
    [user?.uid, fromDay, toDay],
  );

  useEffect(() => {
    if (!firestore || !user || !fromDay) {
      setData(null);
      return;
    }

    const cached = rangeCache.get(key);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) {
      setData(cached.data);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const snapshot = await getDocs(
          query(
            collection(firestore, 'users', user.uid, 'stats_daily'),
            where(documentId(), '>=', fromDay),
            where(documentId(), '<=', toDay),
          ),
        );

        countServerReads(Math.max(0, snapshot.size), 'stats_daily:range');

        const aggregate = aggregateDocs(snapshot.docs as any, fromDay, toDay);
        rangeCache.set(key, { at: Date.now(), data: aggregate });

        if (!cancelled) setData(aggregate);
      } catch (error) {
        console.warn('[stats] No se pudo leer el rango:', error);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, user, fromDay, toDay, key]);

  return {
    stats: data,
    hasData: !!data && data.days > 0,
    isLoading,
  };
}
