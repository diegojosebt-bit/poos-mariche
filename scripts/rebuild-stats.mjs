/**
 * Reconstrucción de agregados históricos (Fase 1).
 *
 * Recalcula `stats_daily/{YYYY-MM-DD}` y `stats_monthly/{YYYY-MM}` desde
 * `sale_transactions` y `expenses` para el rango indicado. Es idempotente:
 * sobrescribe los documentos del rango con los totales recalculados.
 *
 * NO toca `stats/overview` (fiados/reparaciones/inventario): eso se cablea
 * en el siguiente paso.
 *
 * Uso:
 *   npm i -D firebase-admin
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\service-account.json"
 *
 *   node scripts/rebuild-stats.mjs --dry-run
 *   node scripts/rebuild-stats.mjs --from=2025-01-01
 *   node scripts/rebuild-stats.mjs --from=2025-01-01 --user=UID
 *
 * Notas:
 *  - `--from` debe ser día 1 para que el primer mes quede completo.
 *  - Las ventas `refunded` aportan 0 (no se cuentan ni restan).
 *  - Las lecturas del Admin SDK se facturan: ejecútalo en baja actividad.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_USER = (args.find((arg) => arg.startsWith('--user=')) || '').split('=')[1] || null;
const FROM_ARG = (args.find((arg) => arg.startsWith('--from=')) || '').split('=')[1] || null;
const PAGE_SIZE = 400;

const METHOD_KEYS = {
  'Efectivo USD': 'cashUSD',
  'Efectivo Bs': 'cashBs',
  Tarjeta: 'card',
  'Pago Móvil': 'mobile',
  'Tarjeta / Pago Móvil': 'mobile',
  Transferencia: 'transfer',
  'USDT / Crypto': 'crypto',
};

const safeFieldKey = (id) => String(id).replace(/[.~*/[\]\s]/g, '_');

function startOfPreviousMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

function dayKeyOf(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    day: `${y}-${m}-${d}`,
    month: `${y}-${m}`,
    dayNumber: d,
  };
}

const emptyDay = () => ({
  salesUSD: 0,
  salesCount: 0,
  costUSD: 0,
  profitUSD: 0,
  expensesUSD: 0,
  expensesBs: 0,
  byMethod: {},
  items: {},
});

async function forEachPage(queryRef, onPage) {
  let last = null;

  for (;;) {
    let pageQuery = queryRef.orderBy('transactionDate').limit(PAGE_SIZE);
    if (last) pageQuery = pageQuery.startAfter(last);

    const snapshot = await pageQuery.get();
    if (snapshot.empty) return;

    await onPage(snapshot.docs);

    if (snapshot.size < PAGE_SIZE) return;
    last = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function rebuildUser(db, userRef, fromIso, counters) {
  const salesQuery = userRef
    .collection('sale_transactions')
    .where('transactionDate', '>=', fromIso);

  const days = new Map();

  const dayFor = (day) => {
    if (!days.has(day)) days.set(day, { ...emptyDay(), byMethod: {}, items: {} });
    return days.get(day);
  };

  await forEachPage(salesQuery, async (docs) => {
    for (const doc of docs) {
      const sale = doc.data();
      if (sale.status === 'refunded') {
        counters.refunded += 1;
        continue;
      }

      const keys = dayKeyOf(sale.transactionDate);
      if (!keys) continue;

      const entry = dayFor(keys.day);
      const revenue = Number(sale.actualPaidAmount ?? sale.totalAmount ?? 0);
      const items = Array.isArray(sale.items) ? sale.items : [];
      const itemsNominal = items.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
        0,
      );
      const collectionRatio = itemsNominal > 0 ? revenue / itemsNominal : 1;

      let cost = items.reduce(
        (sum, item) => sum + Number(item.costPrice ?? item.customCostPrice ?? 0) * Number(item.quantity || 0),
        0,
      );

      const itemsCostSum = cost;

      if (cost === 0 && Number(sale.costPrice || 0) > 0) {
        cost = Number(sale.costPrice);
      }

      const fallbackUnitCost = itemsCostSum === 0 && Number(sale.costPrice || 0) > 0 && itemsNominal > 0
        ? Number(sale.costPrice) / itemsNominal
        : 0;

      entry.salesUSD += revenue;
      entry.salesCount += 1;
      entry.costUSD += cost;
      entry.profitUSD += revenue - cost;

      for (const payment of sale.payments ?? []) {
        const key = METHOD_KEYS[payment.method] ?? 'other';
        entry.byMethod[key] = (entry.byMethod[key] ?? 0) + Number(payment.amount || 0);
      }

      // El vuelto reduce el neto por método.
      for (const change of sale.changeGiven ?? []) {
        const key = METHOD_KEYS[change.method] ?? 'other';
        entry.byMethod[key] = (entry.byMethod[key] ?? 0) - Number(change.amount || 0);
      }

      for (const item of items) {
        // Los abonos de fiado suman al total (caja) pero NO son un artículo vendido.
        if (sale.fiadoId || !item.productId) continue;
        // Venta rápida: agrupar por nombre, no por el id temporal.
        const key = item.isCustom
          ? safeFieldKey(`custom_${item.name || 'rapida'}`)
          : safeFieldKey(item.productId);
        const current = entry.items[key] ?? { n: item.name, q: 0, rev: 0, cost: 0 };
        current.n = item.name;
        current.q += Number(item.quantity || 0);
        current.rev += Number(item.price || 0) * Number(item.quantity || 0) * collectionRatio;
        const unitCost = Number(item.costPrice ?? item.customCostPrice ?? 0) || fallbackUnitCost * Number(item.price || 0);
        current.cost += unitCost * Number(item.quantity || 0);
        entry.items[key] = current;
      }

      counters.sales += 1;
    }
  });

  // Gastos del mismo rango
  const expensesSnap = await userRef
    .collection('expenses')
    .where('createdAt', '>=', fromIso)
    .get();

  for (const doc of expensesSnap.docs) {
    const expense = doc.data();
    const keys = dayKeyOf(expense.createdAt);
    if (!keys) continue;

    const entry = dayFor(keys.day);
    entry.expensesUSD += Number(expense.amountUSD || 0);
    entry.expensesBs += Number(expense.amountBs || 0);
    counters.expenses += 1;
  }

  // Pendiente total de fiados (para stats/overview)
  const fiadosSnap = await userRef.collection('fiados').get();
  let pendingAmount = 0;
  let pendingCount = 0;

  for (const doc of fiadosSnap.docs) {
    const fiado = doc.data();
    if (fiado.status !== 'Pendiente') continue;
    pendingAmount += Math.max(0, Number(fiado.totalAmount || 0) - Number(fiado.amountPaid || 0));
    pendingCount += 1;
  }
  counters.fiados += fiadosSnap.size;

  // Agregados por mes
  const months = new Map();

  for (const [day, value] of days) {
    const month = day.slice(0, 7);
    const dayNumber = day.slice(8, 10);

    if (!months.has(month)) {
      months.set(month, {
        salesUSD: 0,
        salesCount: 0,
        costUSD: 0,
        profitUSD: 0,
        expensesUSD: 0,
        expensesBs: 0,
        byMethod: {},
        byDay: {},
      });
    }

    const monthEntry = months.get(month);
    monthEntry.salesUSD += value.salesUSD;
    monthEntry.salesCount += value.salesCount;
    monthEntry.costUSD += value.costUSD;
    monthEntry.profitUSD += value.profitUSD;
    monthEntry.expensesUSD += value.expensesUSD;
    monthEntry.expensesBs += value.expensesBs;

    for (const [key, amount] of Object.entries(value.byMethod)) {
      monthEntry.byMethod[key] = (monthEntry.byMethod[key] ?? 0) + amount;
    }

    monthEntry.byDay[dayNumber] = {
      salesUSD: value.salesUSD,
      profitUSD: value.profitUSD,
      count: value.salesCount,
    };
  }

  if (DRY_RUN) return;

  // Escribir diarios
  let batch = db.batch();
  let pending = 0;

  for (const [day, value] of days) {
    batch.set(
      userRef.collection('stats_daily').doc(day),
      { ...value, updatedAt: FieldValue.serverTimestamp() },
      { merge: false },
    );
    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();

  // Escribir mensuales
  batch = db.batch();
  pending = 0;

  for (const [month, value] of months) {
    batch.set(
      userRef.collection('stats_monthly').doc(month),
      { ...value, updatedAt: FieldValue.serverTimestamp() },
      { merge: false },
    );
    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();

  // Overview: pendiente de fiados
  await userRef.collection('stats').doc('overview').set(
    {
      fiados: { pendingAmount, pendingCount },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(
    `[${userRef.id}] días=${days.size} meses=${months.size} ventas=${counters.sales} gastos=${counters.expenses} fiados=${fiadosSnap.size}`,
  );
}

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const fromDate = FROM_ARG ? new Date(`${FROM_ARG}T00:00:00`) : startOfPreviousMonth();

  // Un rebuild parcial del mes sobrescribiría stats_monthly con datos incompletos.
  if (FROM_ARG && fromDate.getDate() !== 1) {
    console.warn(`[rebuild] --from=${FROM_ARG} no es día 1; se normaliza a ${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-01`);
    fromDate.setDate(1);
  }

  if (Number.isNaN(fromDate.getTime())) {
    throw new Error('--from inválido. Usa YYYY-MM-DD (idealmente día 1).');
  }

  const fromIso = fromDate.toISOString();
  const counters = { sales: 0, expenses: 0, refunded: 0, fiados: 0, errors: 0 };

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Reconstruyendo stats desde ${fromIso}`);

  let lastUser = null;

  for (;;) {
    let usersQuery = db.collection('users').orderBy('__name__').limit(100);
    if (lastUser) usersQuery = usersQuery.startAfter(lastUser);

    const usersSnap = await usersQuery.get();
    if (usersSnap.empty) break;

    for (const userDoc of usersSnap.docs) {
      if (ONLY_USER && userDoc.id !== ONLY_USER) continue;

      try {
        await rebuildUser(db, userDoc.ref, fromIso, counters);
      } catch (error) {
        counters.errors += 1;
        console.error(`[${userDoc.id}] error:`, error?.message || error);
      }
    }

    if (usersSnap.size < 100) break;
    lastUser = usersSnap.docs[usersSnap.docs.length - 1];
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Resumen`);
  console.log(`  ventas procesadas:    ${counters.sales}`);
  console.log(`  reembolsadas (0):     ${counters.refunded}`);
  console.log(`  gastos procesados:    ${counters.expenses}`);
  console.log(`  fiados revisados:     ${counters.fiados}`);
  console.log(`  errores:              ${counters.errors}`);
  console.log('──────────────────────────────────────────────');

  if (counters.errors > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error('Reconstrucción abortada:', error);
  process.exit(1);
});
