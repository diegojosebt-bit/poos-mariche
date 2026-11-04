# Fase 0 implementada — medición, caché e infraestructura

| | |
|---|---|
| **Fecha** | 2026-11-03 |
| **Estado** | Implementada en el repo. **Pendiente de desplegar** índices, reglas y ejecutar el backfill. |
| **Cambios visibles para el usuario** | **Ninguno.** No se tocó ninguna pantalla ni ningún `limit`. |
| **Objetivo** | Medir la línea base, corregir la clave de caché y dejar lista la infraestructura (índices, reglas, backfill) para las fases 1–4. |

---

## 1. Archivos

### Nuevos

| Archivo | Para qué |
|---|---|
| `src/lib/firestore/cache-policy.ts` | Claves deterministas, serialización real de fechas/Timestamps, TTL por colección y marcas de sincronización en `localStorage` |
| `src/lib/firestore/read-meter.ts` | Contador de lecturas (servidor) y aciertos de caché; expone `window.__reads` |
| `src/components/debug/read-meter-pill.tsx` | Pastilla de diagnóstico con `?reads=1` |
| `firestore.indexes.json` | Índices compuestos de las fases 2–4 |
| `firebase.json` | Configuración de Firestore (rules + indexes) |
| `.firebaserc` | Proyecto por defecto para `firebase deploy` |
| `scripts/backfill.mjs` | Rellena `isDeleted`, `salesCount`, `searchTokens` y `searchName` |
| `scripts/set-admin-claims.mjs` | Copia `roles_admin` a custom claims de Auth |

### Modificados

| Archivo | Cambio |
|---|---|
| `src/firebase/firestore/use-collection.tsx` | La clave de caché serializa bien los valores de filtro (antes un `Timestamp` caía en `"val"` y **dos rangos de fecha compartían caché**); ruta más robusta; cuenta lecturas y aciertos de caché; tipado de la deduplicación en vuelo |
| `src/firebase/firestore/use-doc.tsx` | Cuenta la primera lectura de cada listener |
| `src/components/providers.tsx` | Monta la pastilla de diagnóstico |
| `firestore.rules` | `isAdmin()` con custom claim + puente temporal `exists()`; `list` de usuarios solo admin; `system/announcements`; `roles_admin` cerrado |
| `.gitignore` | Ignora caché local de npm y credenciales de servicio |

### Correcciones encontradas al verificar (no relacionadas con lecturas)

| Archivo | Bug | Corrección |
|---|---|---|
| `src/components/reports/export-sales-button.tsx` | `rateFactor` **no existía**: exportar ventas con una reparación lanzaba `ReferenceError` | Se usa el ingreso ya prorrateado (igual que las líneas de producto) |
| `src/components/inventory/columns.tsx` | `title` pasado directo a iconos de Lucide (error de tipos) | Envuelto en `<span title>`; el tooltip se conserva |
| `src/components/pos/cart-display.tsx` | `item.discount` posiblemente `undefined` | `(item.discount ?? 0).toFixed(2)` |
| `src/app/dashboard/pos/page.tsx` | Se pasaba un segundo argumento inexistente a `mutate()` | Se eliminó |
| `src/app/dashboard/inventory/page.tsx` | “Sincronizar catálogo” descargaba todos los productos **sin confirmación** (hasta 1.500 lecturas por clic) | Diálogo de confirmación que explica el coste |

Resultado: `tsc --noEmit` termina con **exit 0** (sin errores de tipos en todo el proyecto).

---

## 2. Qué se corrigió exactamente

### 2.1 Colisión de claves de caché (bug de correctitud)

Antes, en `use-collection.tsx`:

```ts
let val = 'val';
if (typeof f?.value === 'string' || typeof f?.value === 'number' || typeof f?.value === 'boolean') {
  val = String(f.value);
} else if (Array.isArray(f?.value)) {
  val = `arr[${f.value.length}]`;
}
```

Un `Timestamp` (objeto) caía en `"val"`. Dos consultas como:

- `where('transactionDate', '>=', 2026-01-01)`
- `where('transactionDate', '>=', 2026-06-01)`

generaban **la misma clave** → la segunda devolvía los datos cacheados de la primera sin consultar. Hoy no hay consultas con filtros de fecha, pero la Fase 2 las introduce; este fix evita heredar el bug.

Ahora se usa `serializeValue()` (anexo A del informe), que distingue `date:`, `ts:segundos:nanos`, arrays, referencias y primitivos.

### 2.2 Ruta de la consulta

Si la ruta no se podía extraer, la clave era `unknown_path` para **todas** las consultas. Se añadió un fallback por `path.segments` / `path.toString()`.

### 2.3 Reglas: admin sin lecturas (con puente)

```js
function isAdmin() {
  return isSignedIn() && (
    request.auth.token.admin == true ||
    exists(/databases/$(database)/documents/roles_admin/$(request.auth.uid))
  );
}
```

- Para el **dueño** de un negocio, `isOwner(userId) || isAdmin()` cortocircuita en `isOwner`: **nunca** paga el `exists()`.
- Para un **admin con claim**: cortocircuita en el claim: **0 lecturas**.
- El `exists()` solo se evalúa para quien no es dueño ni tiene claim (durante la migración). Cuando todos los admin tengan claim, se borra esa línea.

### 2.4 Índices

Se crearon los índices que necesitan las consultas de las fases 2–4 (productos por nombre/categoría/más vendidos/búsqueda; reparaciones por estado/pago/búsqueda; ventas por cliente/método; fiados por estado).

> Los índices **no cambian la app actual** (hoy no hay consultas que los usen). Se despliegan ahora para que estén `READY` cuando se active la Fase 2.

---

## 3. Despliegue (en este orden)

```bash
# 1) Dependencia solo para los scripts (no entra al bundle)
npm i -D firebase-admin

# 2) Claims de administrador (dry run primero)
node scripts/set-admin-claims.mjs
node scripts/set-admin-claims.mjs --apply
#    → el admin debe volver a iniciar sesión para recibir el claim

# 3) Índices (tarda; esperar estado READY en la consola)
firebase deploy --only firestore:indexes

# 4) Reglas
firebase deploy --only firestore:rules

# 5) App (build/deploy normal)

# 6) Backfill de campos de búsqueda (baja actividad)
node scripts/backfill.mjs --dry-run
node scripts/backfill.mjs
```

Orden importante:

- **Claims antes que reglas.** Si se despliegan las reglas sin claim, el panel de Administración deja de listar usuarios. El puente `exists()` evita la caída, pero conviene no depender de él.
- **Backfill antes de activar la Fase 2.** Si se filtra por `isDeleted` y algún producto no tiene el campo, ese producto **desaparece** de la consulta (comportamiento de Firestore, no bug del hook).

---

## 4. Cómo verificar

### 4.1 Abrir el medidor

```
https://<tu-dominio>/dashboard/pos?reads=1
```

La pastilla queda fija abajo a la derecha durante la pestaña (se guarda en `sessionStorage`). Clic para reiniciar el contador. `?reads=0` la apaga.

También en consola:

```js
window.__reads.snapshot()
// { reads: 1520, cacheHits: 0, byKey: { 'users/.../products': 1500, ... } }
```

### 4.2 Línea base esperada (código actual, sin optimizar)

| Acción | Lecturas esperadas |
|---|---:|
| Login → POS (catálogo completo) | ~1.500 |
| POS → Inventario | 0 (misma clave RAM) |
| Inventario → Análisis | 0 (misma clave RAM) |
| Abrir Reparaciones | 100 |
| Abrir Fiados | ~350 |
| Abrir Gastos | ~900 |
| Abrir Reportes | ~100 |
| Recargar (F5) | vuelve a ~3.000 (todavía no hay TTL) |
| **Total sesión típica** | **~3.000–3.400** |

Que el F5 vuelva a leer es **lo esperado en Fase 0**: el TTL y la revalidación llegan en Fase 2. Lo importante es tener el número reproducible y el desglose por consulta (`byKey`).

### 4.3 Aciertos de caché

En la segunda visita dentro de la misma sesión, la pastilla debe mostrar `caché` > 0 y `lecturas` sin subir. Eso confirma que `getDocsFromCache` está sirviendo.

---

## 5. Qué NO cambia todavía

- No hay paginación nueva ni límites de 100 (Fase 2).
- No hay TTL ni revalidación (Fase 2).
- No hay agregados `stats_*` (Fase 1).
- No se modificó ninguna pantalla ni ningún flujo de venta.
- Los índices y el backfill son aditivos.

---

## 6. Rollback

| Cambio | Cómo revertir |
|---|---|
| Código | `git revert` del commit; la app vuelve al comportamiento anterior |
| Reglas | Volver a desplegar el `firestore.rules` anterior (el puente `exists()` mantiene compatibilidad) |
| Índices | Se pueden dejar; no afectan consultas que no los usan |
| Backfill | Los campos añadidos (`isDeleted`, `salesCount`, `searchTokens`) son inocuos para el código actual |

---

## 7. Limitaciones conocidas

1. **`isAdmin` con puente** sigue costando 1 lectura en operaciones de admin mientras no se borre el `exists()`. Borrarlo es un cambio de una línea cuando los claims estén verificados.
2. **El backfill requiere service account.** No se commitea ninguna credencial; `service-account*.json` está en `.gitignore`.
3. **`firebase-admin` no está en `package.json`** a propósito: es dependencia de scripts, no del runtime. Instálala con `npm i -D firebase-admin` cuando vayas a correrlos.
4. **El medidor cuenta listas y `useDoc`**, no los dos `onSnapshot` crudos del layout (perfil/ajustes). Son 2 lecturas por sesión; irrelevantes frente al total.

---

## 8. Siguiente paso

**Fase 1:** `src/lib/firestore/rollups.ts` + escribir `stats_daily` / `stats_monthly` en el checkout, gastos, fiados y reparaciones; luego reconstrucción de los últimos 90 días y reconciliación contra el cálculo actual.
