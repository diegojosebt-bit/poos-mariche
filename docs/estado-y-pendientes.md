# Estado de implementación y pendientes

| | |
|---|---|
| **Fecha** | 2026-11-18 |
| **Resumen** | Fase 0 completa · motor de Fase 2 completo · POS/Inventario/Reparaciones en beta · búsqueda en servidor cableada · **Fase 1 parcial** · **Multi-Cajeros (1 Administrador + Cajeros) y Blindaje Multi-Caja completo** |
| **Verificación** | `tsc --noEmit` → 0 errores · `npm run check:encoding` → OK |
| **Sin probar aún** | QA en vivo contra Firestore con `?reads=1` y deploy de reglas/índices |

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

### Multi-Cajeros (1 Administrador + Cajeros) y Blindaje Multi-Caja (2026-11-18)
- **Modelo simplificado 1 Administrador + Cajeros**: todas las cajas inician con el correo del negocio y cada operador entra con su PIN (`SHA-256` con salt por negocio + bloqueo progresivo anti-fuerza bruta `30s / 120s / 300s`). Se eliminó la complejidad de múltiples presets de rol y se exige definir el **PIN de Administrador** antes de crear el primer cajero.
- **Permisos granulares conectados de extremo a extremo**:
  - Módulos visibles filtrados en sidebar, barra móvil y `SecurityGate`.
  - `canGiveDiscounts`: oculta/bloquea descuentos, ofertas y obsequios en el carrito del POS.
  - `canEditProducts` / `canDeleteRecords`: exigidos por `AdminAuthDialog`, incluyendo el borrado masivo de Inventario (`BulkDeleteButton`).
  - `canViewCostsAndProfits`: oculta costos y ganancias reales en Inventario (tabla y tarjetas móviles) y en Reportes (`DateRangeReport`).
  - `canViewAllCashiersReports`: aísla ventas, cierres y resumen por rango por cajero (sin mezclar `stats_daily` global).
- **Sesiones simultáneas y Modo Supervisor híbrido**:
  - `activeSessions` se actualiza con dot-notation (`activeSessions.${deviceId}`) + validación regex del `deviceId` y limpieza de sesiones vencidas (>14h), evitando sobreescrituras entre cajas y con 0 lecturas adicionales.
  - **Aislamiento Multi-Pestaña y Dispositivo**: `getOrCreateDeviceId()` prioriza `sessionStorage` para que pestañas/ventanas distintas en el mismo navegador actúen como cajas independientes al hacer pruebas o cobros paralelos, persistiendo a través de F5 pero sin colisionar entre sí.
  - **Anti-Duplicación de Cajero (Anti-Colisión)**: un cajero no puede operar dos cajas a la vez. Si un cajero inicia turno en una caja nueva, la caja anterior detecta la sesión en tiempo real a través del snapshot de `users/{uid}`, cierra el turno automáticamente, expulsa al operador a la pantalla de PIN y muestra una alerta destructiva ("Sesión cerrada: Tu usuario inició turno en otra caja").
  - **Expulsión Inmediata por Límite de Cajas**: los cajeros no pueden forzar cupos ni expulsar a otras cajas en cobro. Si todos los cupos (`maxRegisters`) están ocupados por otros cajeros, el intento de entrada es rechazado de inmediato y devuelto a la pantalla de PIN, mostrando qué cajas están cobrando.
  - **Panel de Cajas Conectadas para el Administrador**: sección en vivo en Configuración -> Cajeros y Cajas donde el dueño ve en tiempo real cada caja conectada, operador activo y hora de última actividad, con botón *Liberar* para cerrar sesiones remotas o abandonadas con 1 clic.
  - Si el cupo (`maxRegisters`) está lleno y entra el Administrador, opera en **Modo Supervisor** (bloquea cobros en POS y abonos en Fiados sin cerrar la caja del cajero).
  - En `firestore.rules`: el propietario no puede alterar `planTier`, `maxRegisters`, `maxCashiers`, `licenseStatus`, `licenseExpiry`, `isAdmin`, `uid`, `email` ni `createdAt`; `cashiers.size()` queda acotado a `maxCashiers` y `activeSessions` a un mapa de máximo 25 entradas (0 lecturas extra en reglas).
- **Notificaciones del Sistema**: duración uniforme de 1 segundo para todas las alertas flotantes (guardado, editado, impreso, flash de carrito), permitiendo un flujo de cobro ultrarrápido sin retrasos visuales.
- **Integridad de datos y facturación Multi-Caja**:
  - **IDs sin colisión**: `S-YYMMDD-XXXXXXXX` (WebCrypto) en POS, `RFD-...` en reembolsos, `S-FIA-...` en abonos y `RECON-...` en cierres.
  - **Checkout transaccional**: con `maxRegisters > 1` exige conexión y valida stock real + doble cobro de reparaciones en `runTransaction` (plan 1 caja conserva modo optimista + cola offline).
  - **Edición de productos segura**: `ProductFormDialog` aplica deltas de stock en `runTransaction` preservando `salesCount` y stock vivo en servidor.
  - **Reembolsos blindados**: verifica `liveSale.status !== 'refunded'` y `!isRefund` dentro de `runTransaction`, guarda `refundedByCashierId`/`Name` y etiqueta `cashierId`/`registerName` en el asiento negativo.
  - **Cierres independientes y sin duplicados**: en modo cajeros no sobreescribe `app-settings/main.initialBalances` globales; antes de cerrar valida con 1 lectura centinela que el turno no haya sido cerrado en otro equipo.
  - **Ventas en espera (`held_sales`)**: en Multi-Caja se reclaman y eliminan atómicamente vía `runTransaction` (con guard `claimedHeldSalesRef`).
  - **Trazabilidad completa**: `cashierId`/`cashierName` registrados al crear ventas, abonos, fiados, reparaciones, gastos y cierres.

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

---

## 6. Regla de oro para cualquier cambio (incluidos los visuales)

> Ningún cambio de UI puede añadir lecturas de Firestore.

Antes de dar por terminado un cambio de interfaz, revisa
**[`docs/regla-de-oro-lecturas.md`](./regla-de-oro-lecturas.md)**: prohibiciones,
patrón correcto para tarjetas y listas, checklist de revisión y el registro de
cambios visuales con su impacto en lecturas (todos en 0 hasta hoy).
