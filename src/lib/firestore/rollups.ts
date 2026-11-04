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
  const itemsNominal = sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemsCostSum = sale.items.reduce(
    (sum, item) => sum + (item.costPrice ?? item.customCostPrice ?? 0) * item.quantity,
    0,
  );

  // Ventas antiguas sin costo por artículo: se rescata el costo total de la venta
  // y se reparte proporcional al precio, para que el reporte no muestre costo 0.
  const effectiveCost = itemsCostSum > 0 ? itemsCostSum : Number(sale.costPrice || 0);
  const cost = effectiveCost * sign;
  const profit = revenue - cost;

  const monthly: Record<string, unknown> = {
    salesUSD: increment(revenue),
    salesCount: increment(sign),
    costUSD: increment(cost),
    profitUSD: increment(profit),
    updatedAt: serverTimestamp(),
  };

  const daily: Record<string, unknown> = { ...monthly };

  for (const payment of sale.payments ?? []) {
    const field = `byMethod.${methodKey(payment.method)}`;
    monthly[field] = increment(payment.amount * sign);
    daily[field] = increment(payment.amount * sign);
  }

  // El vuelto reduce el neto por método (el reporte muestra flujo neto).
  for (const change of sale.changeGiven ?? []) {
    const field = `byMethod.${methodKey(change.method)}`;
    monthly[field] = increment(-change.amount * sign);
    daily[field] = increment(-change.amount * sign);
  }

  const dayNumber = day.slice(8, 10);
  monthly[`byDay.${dayNumber}.salesUSD`] = increment(revenue);
  monthly[`byDay.${dayNumber}.profitUSD`] = increment(profit);
  monthly[`byDay.${dayNumber}.count`] = increment(sign);

  // Ingreso por artículo prorrateado al cobrado real (igual que el reporte).
  const paidNominal = sale.actualPaidAmount ?? sale.totalAmount ?? 0;
  const collectionRatio = itemsNominal > 0 ? paidNominal / itemsNominal : 1;

  const fallbackUnitCost = itemsCostSum === 0 && Number(sale.costPrice || 0) > 0 && itemsNominal > 0
    ? Number(sale.costPrice) / itemsNominal
    : 0;

  for (const item of sale.items) {
    if (item.isCustom || !item.productId) continue;
    const key = safeFieldKey(item.productId);
    const unitCost = Number(item.costPrice ?? item.customCostPrice ?? 0) || fallbackUnitCost * item.price;
    daily[`items.${key}.n`] = item.name;
    daily[`items.${key}.q`] = increment(item.quantity * sign);
    daily[`items.${key}.rev`] = increment(item.price * item.quantity * collectionRatio * sign);
    daily[`items.${key}.cost`] = increment(unitCost * item.quantity * sign);
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
    'fiados.pendingAmount': increment(nextPending - prevPending),
    'fiados.pendingCount': increment((nextPending > 0 ? 1 : 0) - (prevPending > 0 ? 1 : 0)),
    updatedAt: serverTimestamp(),
  };
}
