# Estado de implementación y pendientes

| | |
|---|---|
| **Fecha** | 2026-11-03 |
| **Resumen** | Fase 0 completa · motor de Fase 2 completo · POS/Inventario/Reparaciones en beta · búsqueda en servidor cableada · **Fase 1 parcial** (ventas online, gastos, fiados) |
| **Verificación** | `tsc --noEmit` → 0 errores en todo el proyecto |
| **Sin probar aún** | Nada se ejecutó contra Firestore desde esta sesión (el server no se levantó para no consumir lecturas) |

---

## 1. Lo que ya está hecho

### Fase 0 — base y medición
- `?reads=1`: pastilla con lecturas de servidor y aciertos de caché (`window.__reads`).
- Clave de caché corregida: fechas/Timestamps ya no colisionan.
- `firestore.indexes.json`, `firebase.json`, `.firebaserc`.
- Reglas con custom claim + puente `exists()`; `list` de usuarios solo admin; `roles_admin` cerrado.
- `scripts/backfill.mjs` (searchTokens/isDeleted/salesCount) y `scripts/set-admin-claims.mjs`.
- Confirmación antes de “Sincronizar catálogo”.
- Bugs corregidos: `rateFactor` (crash al exportar con reparación), `discount` undefined, `title` en iconos, argumento extra en `mutate`.

### Fase 2 — motor de datos
- `queryCache` (RAM, LRU 80, TTL, invalidación, patch/remove/merge).
- `usePagedQuery` (100 por página, cursor, cache-first, `loadMore`).
- `useServerSearch` (tokens, debounce, cancelación, caché).
- `fetchDocsByIds` (productos fuera de página: carrito, combos, venta retenida).
- Banderas `pagedData` / `serverSearch` con override `?ff=...`.

### Pantallas en beta (bandera apagada por defecto)
- **POS**: 100 productos + “Cargar 100 más”; precio y costo congelados; checkout trae por id lo que falte; combos con `S: ?` se resuelven al pulsar.
- **Inventario**: 100 + “Cargar 100 más”; altas/ediciones/borrados sin releer.
- **Reparaciones**: 100 + “Cargar 100 más”; altas/ediciones sin releer.
- **Búsqueda en servidor** en las tres (requiere backfill; si no hay tokens, cae al filtro local).
- Filtros locales insensibles a acentos (“bateria” encuentra “Batería”).

### Fase 1 — parcial
- `rollups.ts` con esquema `stats/overview`, `stats_daily/{día}`, `stats_monthly/{mes}`.
- **Ventas online**: `stats_daily` + `stats_monthly` dentro del mismo batch (0 lecturas).
- **Reembolsos**: revierten la venta en `stats_daily`/`stats_monthly` (0 lecturas).
- **Ventas offline**: al sincronizar la cola, escriben los mismos agregados.
- **Gastos**: alta y eliminación actualizan `expensesUSD`/`expensesBs`.
- **Fiados**: alta, abono y eliminación mantienen `fiados.pendingAmount`/`pendingCount` en `overview`.
- **Reportes por rango**: `DateRangeReport` lee `stats_daily` (1 lectura por día) y usa los agregados para totales, utilidad, costo y desglose por artículo; si no hay documentos, cae al cálculo anterior.
- **Fiados y Gastos**: 50 por página + “Cargar 50 más”; el total de fiados sale de `stats/overview` y el de gastos de `stats_daily` (no de la lista cargada).
- **Repuestos de reparación**: el selector carga 100 y usa búsqueda en servidor (antes 200 fijos por apertura).
- **Reportes**: la lista de transacciones carga 100 y ofrece “Cargar 100 más” (sin tope fijo); los totales del periodo salen de `stats_daily`.
- **Exportar reparaciones**: consulta solo el rango de fechas elegido y en páginas de 200 (antes descargaba todo el histórico al abrir el modal).
- **Exportar ventas**: rango de **7 días por defecto**, tope de 31 días / 2.000 ventas, estimación con `count()` y confirmación; luego páginas de 200. Ya no usa solo las 100 cargadas.
- **Exportar inventario**: pagina todos los productos (300 por página) con confirmación; ya no exporta la caché parcial de 100.
- **`scripts/enable-flags.mjs`**: activa `pagedData` y `serverSearch` en todos los negocios de una vez.
- **Análisis**: resumen del mes desde `stats_monthly` (ventas, utilidad, gastos, ticket, ventas por día y métodos de pago). **1 lectura por mes consultado**, sin cargar el catálogo.
- **Dashboard**: gráfico mensual desde `stats_monthly` (**1 lectura por mes**); ya no pide 50 ventas + 100 reparaciones.

---

## 2. Lo que falta (por prioridad)

| # | Pendiente | Depende de | Esfuerzo | Por qué importa |
|---|---|---|---|---|
| 1 | ~~Reembolsos~~ ✅ hecho | — | — | Ya revierte stats |
| 2 | ~~Ventas offline~~ ✅ hecho | — | — | Ya suma al sincronizar |
| 3 | **Reparaciones**: `overview.repairs.open/unpaidAmount` en crear/entregar/cobrar | Fase 1 | 3–4 h | Dashboard y reportes de reparaciones |
| 4 | **Inventario**: `overview.inventory.*` con deltas desde caché (`getDocFromCache`) | Fase 1 | 2–3 h | Análisis y valorización sin cargar catálogo |
| 5 | ~~Script de reconstrucción~~ ✅ implementado (`scripts/rebuild-stats.mjs`) | — | — | Falta ejecutarlo con service account |
| 6 | **Lectores**: Reportes ✅, Análisis ✅, Dashboard ✅ | 1–5 | — | Corrige los “últimos 100” (H10) y el gráfico mensual |
| 7 | ~~Fiados/Gastos~~ ✅ 50 por página + totales de stats | — | — | Ya no cargan la colección completa |
| 8 | **Backfill de `searchTokens`** + deploy de índices | Operativo | 1 h | Sin esto la búsqueda en servidor devuelve 0 |
| 9 | **Claims de admin** + deploy de reglas | Operativo | 1 h | Quitar el puente `exists()` y bloquear `list` |
| 10 | ~~Exportaciones paginadas~~ ✅ ventas, reparaciones e inventario | — | — | Ya no descargan todo el histórico ni cachés parciales |
| 11 | **Admin**: quitar listados masivos / `collectionGroup`; usar `count()` y stats por tenant | Fase 4 | 3–4 h | Evita el patrón que disparó las 704k |
| 12 | **Limpieza Fase 5**: borrar `inventory_status`, `useCollection` legacy, registrar SW, limpiar IndexedDB al cerrar sesión | — | 1–2 días | Menos escrituras y datos locales en equipos compartidos |
| 13 | **QA en localhost:3000** con `?reads=1` por pantalla | 8–9 | 2–4 h | Validar 0 lecturas en revisitas y medir línea base |

---

## 3. Bloqueos operativos

- **Backfill**: `scripts/backfill.mjs` necesita `firebase-admin` + service account (`GOOGLE_APPLICATION_CREDENTIALS`). Alternativa sin credenciales: agregar un botón “Reindexar catálogo” que haga el backfill desde el navegador (1 lectura + 1 escritura por producto, una sola vez).
- **Índices**: desplegar y esperar `READY` antes de activar `serverSearch`. Mientras construyen, las consultas fallan con `failed-precondition` (el hook ya expone `needsIndex`).
- **Orden de reglas**: claims primero, reglas después; si no, el panel de admin deja de listar usuarios (el puente lo evita temporalmente).
- **Stats parciales**: no activar los lectores (puntos 6–7) hasta completar 1–5 y correr la reconstrucción.

---

## 4. Números esperados al activar las banderas

| Pantalla | Hoy | Con `pagedData` (+ `serverSearch` tras backfill) |
|---|---:|---:|
| POS (entrada) | ~1.500 | 100 (+ ≤20 por búsqueda) |
| Inventario | ~1.500 (comparte RAM) | 100 (o 0 si POS ya cargó) |
| Reparaciones | 100 | 100 (+ 100 por “Cargar más”) |
| Revisita dentro del TTL | vuelve a leer | **0** |
| Búsqueda repetida | — | **0** |

---

## 5. Orden recomendado para terminar

1. Reembolsos + ventas offline + reparaciones + inventario en stats (cerrar Fase 1).
2. Script de reconstrucción y verificación contra el cálculo viejo.
3. Dashboard/Reportes/Análisis leyendo stats (aquí se ve el arreglo de los reportes).
4. Fiados/Gastos paginados con totales de `overview`.
5. Backfill + activar `serverSearch` en las tres pantallas.
6. Exportaciones paginadas y admin.
7. QA en 3000 con `?reads=1` y luego rollout por banderas.
