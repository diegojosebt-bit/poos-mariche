import { doc, increment, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { Expense, Sale } from '@/lib/types';

/**
 * Agregados de la Fase 1.
 *
 * Se escriben con `increment()` dentro del mismo batch de la operación
 * (venta/gasto), así que **no cuestan lecturas**. La UI los leerá en la
 * Fase 4 (Reportes/Dashboard) con 1–31 lecturas en lugar de recorrer la
 * colección completa.
 *
 * Mientras no estén cableados todos los orígenes (ventas offline, fiados,
 * reparaciones), estos documentos son parciales: NO activar su lectura en
 * producción hasta correr el script de reconstrucción.
 */

export type StatsWrites = {
  daily: Record<string, unknown>;
  monthly: Record<string, unknown>;
  /** Día `YYYY-MM-DD` al que pertenecen los incrementos. */
  day: string;
};

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function dayKey(date = new Date()): string {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dayKeyFromIso(iso?: string): string {
  const parsed = iso ? new Date(iso) : new Date();
  return dayKey(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
}

export const overviewRef = (db: Firestore, uid: string) =>
  doc(db, 'users', uid, 'stats', 'overview');

export const monthlyRef = (db: Firestore, uid: string, month = monthKey()) =>
  doc(db, 'users', uid, 'stats_monthly', month);

export const dailyRef = (db: Firestore, uid: string, day = dayKey()) =>
  doc(db, 'users', uid, 'stats_daily', day);

const METHOD_KEYS: Record<string, string> = {
  'Efectivo USD': 'cashUSD',
  'Efectivo Bs': 'cashBs',
  Tarjeta: 'card',
  'Pago Móvil': 'mobile',
  'Tarjeta / Pago Móvil': 'mobile',
  Transferencia: 'transfer',
  'USDT / Crypto': 'crypto',
};

const methodKey = (method: string) => METHOD_KEYS[method] ?? 'other';

/** Los ids se usan como claves de mapa: hay que quitar `.` y `/`. */
const safeFieldKey = (id: string) => id.replace(/[.~*/[\]\s]/g, '_');

/**
 * Payload de una venta. `sign = -1` para reembolsos.
 * Todo son transformaciones atómicas: 0 lecturas.
 */
export function saleStatsWrites(sale: Sale, sign: 1 | -1 = 1): StatsWrites {
  const day = dayKeyFromIso(sale.transactionDate);
  const revenue = (sale.actualPaidAmount ?? sale.totalAmount ?? 0) * sign;
  const items = Array.isArray(sale.items) ? sale.items : [];
  const itemsNominal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemsCostSum = items.reduce(
    (sum, item) => sum + (item.costPrice ?? item.customCostPrice ?? 0) * item.quantity,
    0,
  );

  // Ventas antiguas sin costo por artículo: se rescata el costo total de la venta
  // y se reparte proporcional al precio, para que el reporte no muestre costo 0.
  const effectiveCost = itemsCostSum > 0 ? itemsCostSum : Number(sale.costPrice || 0);
  const cost = effectiveCost * sign;
  const profit = revenue - cost;

  const totals = {
    salesUSD: increment(revenue),
    salesCount: increment(sign),
    costUSD: increment(cost),
    profitUSD: increment(profit),
    updatedAt: serverTimestamp(),
  };

  const monthly: Record<string, any> = { ...totals, byDay: {} };
  const daily: Record<string, any> = { ...totals };

  // IMPORTANTE: se escriben MAPAS ANIDADOS, no claves con puntos.
  // `set({ 'byMethod.cashUSD': x }, { merge: true })` crea el campo literal
  // "byMethod.cashUSD" y el reporte nunca encuentra byMethod/items.
  const methodDeltas: Record<string, number> = {};
  const addMethod = (method: string, amount: number) => {
    const key = methodKey(method);
    methodDeltas[key] = (methodDeltas[key] ?? 0) + amount;
  };

  for (const payment of sale.payments ?? []) addMethod(payment.method, payment.amount * sign);
  // El vuelto reduce el neto por método (el reporte muestra flujo neto).
  for (const change of sale.changeGiven ?? []) addMethod(change.method, -change.amount * sign);

  if (Object.keys(methodDeltas).length > 0) {
    monthly.byMethod = {};
    daily.byMethod = {};
    for (const [key, amount] of Object.entries(methodDeltas)) {
      monthly.byMethod[key] = increment(amount);
      daily.byMethod[key] = increment(amount);
    }
  }

  const dayNumber = day.slice(8, 10);
  monthly.byDay[dayNumber] = {
    salesUSD: increment(revenue),
    profitUSD: increment(profit),
    count: increment(sign),
  };

  // Ingreso por artículo prorrateado al cobrado real (igual que el reporte).
  const paidNominal = sale.actualPaidAmount ?? sale.totalAmount ?? 0;
  const collectionRatio = itemsNominal > 0 ? paidNominal / itemsNominal : 1;
  const fallbackUnitCost = itemsCostSum === 0 && Number(sale.costPrice || 0) > 0 && itemsNominal > 0
    ? Number(sale.costPrice) / itemsNominal
    : 0;

  const itemDeltas: Record<string, { n: string; q: number; rev: number; cost: number }> = {};

  for (const item of items) {
    // Los abonos de fiado no son artículos (solo suman al total).
    if (sale.fiadoId || !item.productId) continue;
    // Venta rápida: se agrupa por nombre, no por el id temporal "custom-...".
    const key = item.isCustom
      ? safeFieldKey(`custom_${item.name || 'rapida'}`)
      : safeFieldKey(item.productId);
    const unitCost = Number(item.costPrice ?? item.customCostPrice ?? 0) || fallbackUnitCost * item.price;
    const current = itemDeltas[key] ?? { n: item.name, q: 0, rev: 0, cost: 0 };
    current.n = item.name;
    current.q += item.quantity * sign;
    current.rev += item.price * item.quantity * collectionRatio * sign;
    current.cost += unitCost * item.quantity * sign;
    itemDeltas[key] = current;
  }

  // No escribir un mapa vacío: con merge, `items: {}` borra los artículos ya acumulados.
  if (Object.keys(itemDeltas).length > 0) {
    daily.items = {};
    for (const [key, value] of Object.entries(itemDeltas)) {
      daily.items[key] = {
        n: value.n,
        q: increment(value.q),
        rev: increment(value.rev),
        cost: increment(value.cost),
      };
    }
  }

  return { daily, monthly, day };
}

/** Payload de un gasto. `sign = -1` al eliminarlo. */
export function expenseStatsWrites(expense: Expense, sign: 1 | -1 = 1): StatsWrites {
  const day = dayKeyFromIso(expense.createdAt);
  const amountUSD = (expense.amountUSD ?? 0) * sign;
  const amountBs = (expense.amountBs ?? 0) * sign;

  return {
    day,
    daily: {
      expensesUSD: increment(amountUSD),
      expensesBs: increment(amountBs),
      updatedAt: serverTimestamp(),
    },
    monthly: {
      expensesUSD: increment(amountUSD),
      expensesBs: increment(amountBs),
      updatedAt: serverTimestamp(),
    },
  };
}

/** Actualiza el pendiente total de fiados en `stats/overview` (create/pago/delete). */
export function fiadoOverviewWrites(prevPending: number, nextPending: number) {
  return {
    fiados: {
      pendingAmount: increment(nextPending - prevPending),
      pendingCount: increment((nextPending > 0 ? 1 : 0) - (prevPending > 0 ? 1 : 0)),
    },
    updatedAt: serverTimestamp(),
  };
}
