/**
 * Backfill de campos de búsqueda y banderas de inventario (Fase 0).
 *
 * Rellena en cada producto:
 *   - isDeleted: false            (necesario para filtrar en el servidor)
 *   - salesCount: 0               (necesario para ordenar por más vendidos)
 *   - searchName / searchTokens   (búsqueda por prefijos con array-contains)
 *   - searchVersion: 1
 *
 * Y en cada reparación:
 *   - searchTokens                (cliente, equipo, ID, teléfono, falla)
 *   - searchVersion: 1
 *
 * Los agregados (stats_*) se reconstruyen en la Fase 1 con otro script.
 *
 * Uso:
 *   npm i -D firebase-admin
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill.mjs --dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill.mjs
 *   ... node scripts/backfill.mjs --user=UID_SOLO_UN_NEGOCIO
 *
 * Este script usa el SDK de Admin (omite las reglas de seguridad) y sus
 * lecturas se facturan como cualquier lectura de Firestore. Ejecútalo en
 * horario de baja actividad.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_USER = (args.find((arg) => arg.startsWith('--user=')) || '').split('=')[1] || null;
const PAGE_SIZE = 400;

const MARKS = /[\u0300-\u036f]/g;
const MAX_TOKENS = 60;

function normalize(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTokens(inputs) {
  const tokens = new Set();

  for (const input of inputs) {
    if (!input) continue;
    const text = normalize(Array.isArray(input) ? input.join(' ') : input);
    if (!text) continue;

    for (const word of text.split(' ')) {
      if (!word) continue;
      for (let length = 2; length <= Math.min(word.length, 16); length++) {
        tokens.add(word.slice(0, length));
      }
      tokens.add(word);
      if (tokens.size >= MAX_TOKENS) return Array.from(tokens).slice(0, MAX_TOKENS);
    }
  }

  return Array.from(tokens);
}

async function forEachPage(collectionRef, onPage) {
  let last = null;

  for (;;) {
    let pageQuery = collectionRef.orderBy('__name__').limit(PAGE_SIZE);
    if (last) pageQuery = pageQuery.startAfter(last);

    const snapshot = await pageQuery.get();
    if (snapshot.empty) return;

    await onPage(snapshot.docs);

    if (snapshot.size < PAGE_SIZE) return;
    last = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function backfillProducts(db, userRef, counters) {
  await forEachPage(userRef.collection('products'), async (docs) => {
    const batch = DRY_RUN ? null : db.batch();

    for (const doc of docs) {
      const product = doc.data();
      const payload = {
        isDeleted: product.isDeleted ?? false,
        salesCount: Number(product.salesCount ?? 0),
        searchName: normalize(product.name),
        searchTokens: buildTokens([
          product.name,
          product.sku,
          product.barcode,
          product.category,
          Array.isArray(product.compatibleModels) ? product.compatibleModels : [],
          Array.isArray(product.searchKeywords) ? product.searchKeywords : [],
        ]),
        searchVersion: 1,
      };

      if (batch) batch.set(doc.ref, payload, { merge: true });
      counters.products += 1;
    }

    if (batch) await batch.commit();
  });
}

async function backfillRepairs(db, userRef, counters) {
  await forEachPage(userRef.collection('repair_jobs'), async (docs) => {
    const batch = DRY_RUN ? null : db.batch();

    for (const doc of docs) {
      const repair = doc.data();
      const payload = {
        searchTokens: buildTokens([
          repair.customerName,
          repair.customerID,
          repair.customerPhone,
          repair.deviceMake,
          repair.deviceModel,
          repair.reportedIssue,
        ]),
        searchVersion: 1,
      };

      if (batch) batch.set(doc.ref, payload, { merge: true });
      counters.repairs += 1;
    }

    if (batch) await batch.commit();
  });
}

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const counters = { users: 0, products: 0, repairs: 0, errors: 0 };
  const startedAt = Date.now();

  let usersQuery = db.collection('users').orderBy('__name__').limit(200);
  let lastUser = null;

  for (;;) {
    if (lastUser) usersQuery = db.collection('users').orderBy('__name__').startAfter(lastUser).limit(200);

    const usersSnap = await usersQuery.get();
    if (usersSnap.empty) break;

    for (const userDoc of usersSnap.docs) {
      if (ONLY_USER && userDoc.id !== ONLY_USER) continue;

      counters.users += 1;

      try {
        await backfillProducts(db, userDoc.ref, counters);
        await backfillRepairs(db, userDoc.ref, counters);
      } catch (error) {
        counters.errors += 1;
        console.error(`[${userDoc.id}] error:`, error?.message || error);
      }

      console.log(
        `[${userDoc.id}] ok · productos=${counters.products} · reparaciones=${counters.repairs}`,
      );
    }

    if (usersSnap.size < 200) break;
    lastUser = usersSnap.docs[usersSnap.docs.length - 1];
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n──────────────────────────────────────────────');
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Resumen`);
  console.log(`  negocios:      ${counters.users}`);
  console.log(`  productos:     ${counters.products}`);
  console.log(`  reparaciones:  ${counters.repairs}`);
  console.log(`  errores:       ${counters.errors}`);
  console.log(`  duración:      ${seconds}s`);
  console.log('──────────────────────────────────────────────');

  if (counters.errors > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error('Backfill abortado:', error);
  process.exit(1);
});
