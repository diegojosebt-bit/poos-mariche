/**
 * Limpieza única de productos con soft delete antiguo (isDeleted: true).
 *
 * El sistema ahora borra productos físicamente (hard delete). Los productos
 * que se eliminaron con la versión anterior quedaron marcados con
 * `isDeleted: true` en Firestore; este script los borra de verdad.
 *
 * Uso:
 *   npm i -D firebase-admin
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\service-account.json"
 *
 *   node scripts/purge-soft-deleted-products.mjs
 *   node scripts/purge-soft-deleted-products.mjs --apply
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const ONLY_USER = (process.argv.find((arg) => arg.startsWith('--user=')) || '').split('=')[1] || null;
const PAGE = 400;

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const usersSnap = await db.collection('users').get();
  let total = 0;
  let deleted = 0;

  for (const userDoc of usersSnap.docs) {
    if (ONLY_USER && userDoc.id !== ONLY_USER) continue;

    const snap = await userDoc.ref
      .collection('products')
      .where('isDeleted', '==', true)
      .get();

    if (snap.empty) continue;

    total += snap.size;

    for (let index = 0; index < snap.docs.length; index += PAGE) {
      const chunk = snap.docs.slice(index, index + PAGE);

      if (APPLY) {
        const batch = db.batch();
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      deleted += chunk.length;
    }

    console.log(`[${userDoc.id}] soft-deleted: ${snap.size}`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`${APPLY ? '[APPLY]' : '[DRY RUN]'} productos con isDeleted=true: ${total}`);
  console.log(`${APPLY ? 'borrados' : 'se borrarían'}: ${deleted}`);
  console.log('──────────────────────────────────────────────');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
