/**
 * Migración de administradores a custom claims (Fase 0).
 *
 * Las reglas nuevas evalúan `request.auth.token.admin` (0 lecturas) y dejan
 * `exists(roles_admin/...)` solo como puente. Este script copia los roles de
 * `roles_admin` al claim de Auth.
 *
 * Uso:
 *   npm i -D firebase-admin
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/set-admin-claims.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/set-admin-claims.mjs --apply
 *
 * Sin `--apply` solo muestra lo que haría (dry run).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');

async function main() {
  initializeApp({ credential: applicationDefault() });

  const auth = getAuth();
  const db = getFirestore();

  const rolesSnap = await db.collection('roles_admin').get();
  const roleUids = rolesSnap.docs.map((doc) => doc.id);

  console.log(`${APPLY ? '[APPLY]' : '[DRY RUN]'} roles_admin: ${roleUids.length}`);

  for (const uid of roleUids) {
    if (APPLY) {
      await auth.setCustomUserClaims(uid, { admin: true });
    }
    console.log(`  admin  ${uid}`);
  }

  // Auditoría: perfiles marcados como admin que NO están en roles_admin.
  // Ojo: `profile.isAdmin` es un campo que el dueño puede escribir; el claim
  // es la única fuente de verdad para las reglas.
  const profilesSnap = await db.collection('users').where('isAdmin', '==', true).get();
  const missing = profilesSnap.docs.map((doc) => doc.id).filter((uid) => !roleUids.includes(uid));

  if (missing.length > 0) {
    console.warn('\nPerfiles con isAdmin=true pero sin rol en roles_admin:');
    missing.forEach((uid) => console.warn(`  ! ${uid}`));
    console.warn('Revisa si deben ser admin antes de borrar el fallback exists() de las reglas.');
  }

  console.log(
    APPLY
      ? '\nListo. El usuario debe volver a iniciar sesión (o refrescar el token) para recibir el claim.'
      : '\nDry run. Ejecuta con --apply para escribir los claims.',
  );
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
