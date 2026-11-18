# Puesta en marcha — qué hacer, paso a paso

> Guía operativa para desplegar lo implementado y probarlo en `localhost:3000`.
> Los comandos están en PowerShell (Windows). Ejecuta desde la raíz del proyecto.

---

## 0. Requisitos

- Node 20+ y npm (ya instalados: Node 24 / npm 11).
- Firebase CLI: `npm i -g firebase-tools` (si no lo tienes).
- Acceso al proyecto `studio-7217996896-79c3b` con rol Owner/Editor.
- Opcional (solo backfill/claims): cuenta de servicio del proyecto.

> **Aviso de lecturas:** todo lo que hagas contra el proyecto real cuenta lecturas. Para probar sin gastar, usa las banderas beta (100 productos) y evita abrir POS/Inventario repetidamente sin caché. El medidor `?reads=1` te dice el consumo en vivo.

---

## 1. Instalar dependencias y verificar tipos

```powershell
npm install
npm run typecheck
```

- **No uses `npm ci`**: el `package-lock.json` está desincronizado (`@types/node`). `npm install` lo corrige; si quieres, commitea el lock actualizado.
- `typecheck` debe terminar sin errores.

---

## 2. Probar en local (puerto 3000)

```powershell
npm run dev
```

Abre:

| URL | Qué prueba |
|---|---|
| `http://localhost:3000/dashboard/pos?ff=pagedData&reads=1` | POS con 100 productos + medidor |
| `http://localhost:3000/dashboard/inventory?ff=pagedData&reads=1` | Inventario con 100 |
| `http://localhost:3000/dashboard/repairs?ff=pagedData&reads=1` | Reparaciones con 100 |
| `http://localhost:3000/dashboard/pos?ff=pagedData,serverSearch&reads=1` | Búsqueda en servidor (requiere backfill, paso 5) |

Qué debes ver:

1. **Primera carga**: ~100 documentos en el medidor (no 1.500).
2. Navegar a otra pantalla y volver: **0 lecturas**.
3. Recargar (F5) dentro de 3–5 min: **0 lecturas**.
4. “Cargar 100 más”: +100.
5. Con `serverSearch` y backfill: buscar “bater” y encontrar un producto que no estaba en la página.
6. Escribir `?ff=-pagedData` para volver al comportamiento anterior.

> El override `?ff=` dura la pestaña (sessionStorage). Para producción se usa la bandera del perfil, no la URL.

---

## 3. Desplegar índices

```powershell
firebase login
firebase use studio-7217996896-79c3b
firebase deploy --only firestore:indexes
```

- En la consola: **Firestore → Índices**; espera a que todos digan **Habilitado**. Puede tardar minutos.
- Mientras están en “Creando”, las consultas nuevas fallan con `failed-precondition`; la app lo detecta (`needsIndex`) pero la búsqueda no funcionará hasta que terminen.

---

## 4. Migrar administradores a custom claims

1. Consola → ⚙️ **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**.
2. Guarda el JSON como `service-account.json` en la raíz (ya está en `.gitignore`).
3. Ejecuta:

```powershell
npm i -D firebase-admin
$env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\service-account.json"

node scripts/set-admin-claims.mjs           # dry run: lista quién sería admin
node scripts/set-admin-claims.mjs --apply   # escribe el claim
```

4. El admin debe **cerrar sesión y volver a entrar** (o refrescar el token) para que el claim esté activo.

---

## 5. Desplegar reglas (después de los claims)

```powershell
firebase deploy --only firestore:rules
```

Verifica:

- El **panel de Administración** sigue listando usuarios.
- Un usuario normal **no** puede listar `/users` (la regla lo bloquea).
- El dueño sigue leyendo/escribiendo sus subcolecciones.

> Las reglas mantienen un puente `exists(roles_admin)` para no romper nada si falta un claim. Cuando todos los admins tengan claim, borra esa línea de `firestore.rules` y vuelve a desplegar.

---

## 6. Backfill de búsqueda (`searchTokens`)

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\service-account.json"

node scripts/backfill.mjs --dry-run   # cuenta productos/reparaciones
node scripts/backfill.mjs             # escribe (baja actividad)
```

- Coste: **1 lectura + 1 escritura por producto y por reparación** (una sola vez).
- Al terminar imprime el resumen (`negocios`, `productos`, `reparaciones`, `errores`).
- Si hay errores, vuelve a ejecutarlo: es idempotente.

Verificación:

1. En la consola, abre un producto: debe tener `searchTokens`, `searchName`, `isDeleted`, `salesCount`.
2. En la app con `?ff=pagedData,serverSearch`, busca una palabra que no esté en la página 1; debe aparecer.

---

### 6.1 Reconstruir los stats históricos (después del backfill)

Los agregados (`stats_daily`/`stats_monthly`) solo existen desde que se empezaron a escribir; para que Reportes/Dashboard puedan usarlos con meses anteriores hay que reconstruirlos una vez:

```powershell
node scripts/rebuild-stats.mjs --dry-run --from=2025-01-01
node scripts/rebuild-stats.mjs --from=2025-01-01
```

- `--from` debe ser **día 1** para que el primer mes quede completo. Ajusta el año a tu histórico.
- `--user=UID` limita a un negocio (útil para probar).
- Es **idempotente**: sobrescribe los documentos del rango.
- Coste: 1 lectura por venta/gasto del rango + 1 escritura por día y por mes.
- Verifica en la consola: `users/{uid}/stats_daily/2026-11-03` debe tener `salesUSD`, `profitUSD`, `byMethod`, `items`.
- Las ventas `refunded` aportan 0 a los totales.
- El ingreso por artículo se prorratea al cobrado real y el vuelto se resta del neto por método.
- También recalcula `stats/overview.fiados.pendingAmount` (total en la calle) leyendo la colección de fiados.
- **Si ya lo habías ejecutado antes**, vuelve a correrlo (es idempotente) para aplicar el prorrateo, el neto de vuelto y el pendiente de fiados.
- **No toca** `stats/overview` (fiados/reparaciones/inventario); eso viene en el siguiente paso de código.

Verificación de Reportes:

1. Abre `Reportes` → pestaña de flujo por periodo.
2. Elige un mes pasado completo.
3. Los totales deben coincidir con tu cálculo manual; con `?reads=1` verás ~1 lectura por día del rango.
4. Cambiar de pestaña y volver en < 60 s: **0** (caché del rango).
5. Si no hay documentos de stats para el rango, la pantalla cae al cálculo anterior (últimas 100 ventas) — señal de que falta el rebuild de ese periodo.

### 7. Activar las banderas por negocio

En Firestore, documento `users/{uid}`:

```json
{
  "featureFlags": {
    "pagedData": true,
    "serverSearch": true
  }
}
```

- No hace falta tocar el código ni redeploy: el perfil ya se escucha con `onSnapshot`.
- Para todos los negocios de una vez:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\service-account.json"
node scripts/enable-flags.mjs            # dry run
node scripts/enable-flags.mjs --apply
```

- Activa primero en tu cuenta, luego en 3 negocios piloto, luego al resto.
- **No actives `serverSearch` antes del paso 6** (devolvería 0 resultados).
- Reversión inmediata: `pagedData: false` (o quitar la bandera).

---

## 8. Qué observar durante el piloto

| Métrica | Dónde | Objetivo |
|---|---|---|
| Lecturas/día | Consola → Firestore → Usage | caída ≥ 80 % frente a la línea base |
| Lecturas por sesión | `?reads=1` | ≤ 500 la primera vez; 0 en revisitas |
| Errores `failed-precondition` | Consola del navegador | 0 tras índices listos |
| Errores `permission-denied` | Consola del navegador | 0 (si aparecen, revisar claims) |
| “No encuentra producto” | Feedback de usuarios | 0 con backfill hecho |

Crea una alerta de presupuesto/uso en Google Cloud (p. ej. > 100.000 lecturas/día) para detectar regresiones.

---

## 9. Qué NO hacer todavía

- **No** activar los lectores de `stats_*` en Reportes/Dashboard: los agregados aún son parciales (faltan reparaciones, inventario y reconstrucción histórica).
- **No** borrar el código legacy (`useCollection`) hasta la Fase 5.
- **No** usar `?ff=` en producción; es solo para pruebas.
- **No** ejecutar el backfill en horario pico (consume lecturas/escrituras).

---

## 10. Pendientes antes de producción (resumen)

1. Reembolsos ✅ (ya restan en stats) y ventas offline ✅ (ya suman al sincronizar).
2. Reparaciones e inventario en `stats/overview` (pendiente).
3. Script de reconstrucción de stats + comparación contra el cálculo viejo (pendiente).
4. Reportes/Dashboard/Análisis leyendo stats (pendiente; ahí se corrige el histórico).
5. Fiados/Gastos paginados con totales de `stats/overview`.
6. Exportaciones paginadas y panel de admin sin listados masivos.
7. Fase 5: limpieza, service worker, limpiar IndexedDB al cerrar sesión.

Detalle y prioridades en [estado-y-pendientes.md](estado-y-pendientes.md).

---

## 11. Problemas típicos

| Síntoma | Causa | Solución |
|---|---|---|
| `failed-precondition` al buscar/listar | Índice aún creando o falta | Esperar / `firebase deploy --only firestore:indexes` |
| Panel de admin no lista usuarios | Claim faltante | `set-admin-claims.mjs --apply` + re-login |
| Búsqueda devuelve 0 con `serverSearch` | Backfill no ejecutado | Paso 6 |
| Solo aparecen 100 productos | Bandera `pagedData` activa | “Cargar 100 más” o activar `serverSearch` con backfill |
| `npm ci` falla | Lock desincronizado | `npm install` y commit del lock |
| Total del carrito en 0 tras mucho rato | Producto salió de la página y no hay `basePrice` | Ya se congela al añadir; si pasa con ventas viejas retenidas, vuelve a añadirlo |
| La app no arranca en 3000 con el sandbox | Next necesita `fork` (bloqueado) | Ejecuta `npm run dev` en tu terminal normal |
