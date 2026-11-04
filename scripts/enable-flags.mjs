/**
 * Activa las banderas de rendimiento en todos los negocios (Fase 7).
 *
 * Sin esto, los tenants que no tengan `featureFlags` siguen cargando el
 * catálogo completo y gastando lecturas.
 *
 * Uso:
 *   npm i -D firebase-admin
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\service-account.json"
 *
 *   node scripts/enable-flags.mjs            # dry run: lista los negocios
 *   node scripts/enable-flags.mjs --apply    # escribe las banderas
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const ONLY_USER = (process.argv.find((arg) => arg.startsWith('--user=')) || '').split('=')[1] || null;

const FLAGS = {
  pagedData: true,
  serverSearch: true,
};

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const snapshot = await db.collection('users').get();
  let updated = 0;

  console.log(`${APPLY ? '[APPLY]' : '[DRY RUN]'} negocios: ${snapshot.size}`);

  for (const doc of snapshot.docs) {
    if (ONLY_USER && doc.id !== ONLY_USER) continue;

    const profile = doc.data();

    if (APPLY) {
      await doc.ref.set({ featureFlags: FLAGS }, { merge: true });
    }

    updated += 1;
    console.log(
      `  ${APPLY ? 'ok ' : '>> '} ${doc.id} · ${profile.businessName || profile.email || 'sin nombre'}`,
    );
  }

  console.log(
    APPLY
      ? `\nListo: ${updated} negocios con pagedData y serverSearch.`
      : `\nDry run: ${updated} negocios se actualizarían. Ejecuta con --apply.`,
  );
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
