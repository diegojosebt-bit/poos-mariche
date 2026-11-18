# ¿Migrar el sistema de Firebase a Supabase? — Análisis de viabilidad

| | |
|---|---|
| **Fecha** | 2026-11-04 |
| **Base analizada** | `backups/firestore-backup-2026-11-04T15-42-51-463Z.json` (9,2 MB) |
| **Alcance** | Evaluación y plan. **No se modificó ni migró ningún dato.** |
| **Recomendación corta** | **No migrar ahora.** Terminar el despliegue en Vercel, medir 30–60 días y reevaluar solo si aparece un disparador concreto (ver §8). |

---

## 1. Resumen ejecutivo

- El sistema tiene **5 negocios**, ~**5.900 documentos** y **9,2 MB**. Es una base pequeña.
- Ya se redujeron las lecturas ~90 % con paginación, caché y agregados. **Firebase ya no es el cuello de botella.**
- Supabase **no es un reemplazo directo**: cambia el modelo de datos (subcolecciones → tablas), las reglas (→ RLS), las transacciones (→ RPC), la búsqueda y, sobre todo, **el modo offline del POS**, que hoy funciona con la caché persistente de Firestore.
- La migración realista es de **10–14 semanas** de reescritura y pruebas, no un fin de semana. El riesgo de perder funciones (offline, arqueo, reparaciones, reembolsos) es alto.
- A este volumen, **Firebase cuesta menos** (< $3/mes) que Supabase Pro ($25/mes) y ya está optimizado.
- **Veredicto:** quedarse en Firebase. Hacer un POC acotado solo si en el futuro necesitan SQL analítico, joins o varios desarrolladores trabajando en reportes.

---

## 2. Realidad de tus datos (del backup)

### 2.1 Tenants y volumen real

| Negocio | Productos | Ventas | Reparaciones | Cierres | Gastos | Stats días |
|---|---:|---:|---:|---:|---:|---:|
| aponstoreoficial19 | 113 | 649 | 0 | 66 | 0 | 59 |
| diegojosebt | 11 | 84 | 15 | 12 | 11 | 23 |
| medinaollarves | 157 | 60 | 0 | 0 | 0 | 18 |
| movilmariche | 36 | 1.840 | 951 | 216 | 5 | 218 |
| dmcell.vzla | 52 | 570 | 516 | 86 | 9 | 125 |
| **Total** | **369** | **3.203** | **1.482** | **380** | **25** | **443** |

Otras colecciones: `stats_monthly` 28, `daily_reconciliations` 380, `currency_exchanges` 9, `fiados` 3, `loans` 6, `workers` 4, `payroll_payments` 8, `bs_transfers` 3, `security_audit` 2.

> El backup también trae colecciones **en la raíz** (`products` 108, `repair_jobs` 141, `sale_transactions` 340, `daily_reconciliations` 36) que parecen de una versión anterior de un solo negocio. **No deben migrarse a ciegas**: primero hay que decidir si son históricos válidos o basura.

### 2.2 Formato del backup

No es un export oficial de Firestore: es un JSON con colecciones en la raíz y, dentro de cada usuario, una clave `_subcollections` con sus subcolecciones. Cualquier migración necesita un parser propio y validación de conteos.

---

## 3. Qué usa hoy el sistema de Firebase

| Función | Implementación actual | Criticidad |
|---|---|---|
| Login / registro / reset | Firebase Auth (email + contraseña) | Alta |
| Sesión y licencia | `onSnapshot` del perfil + campos de licencia | Alta |
| Multi-tenant | `users/{uid}/...` + reglas por dueño | Alta |
| POS y stock | `writeBatch` + `increment` (atómico), combos, retenidas | Alta |
| Reparaciones | `runTransaction` (repuestos, entrega, garantía) | Alta |
| Fiados / abonos | `runTransaction` (saldos) | Alta |
| Reembolsos | `runTransaction` (stock + stats) | Alta |
| Arqueo / cierres | `writeBatch` + `daily_reconciliations` | Alta |
| Offline POS | **Caché persistente de Firestore + cola local** | **Muy alta** |
| Tiempo real | `onSnapshot` (perfil, ajustes, stats) | Media |
| Reportes | Consultas por rango + agregados `stats_*` | Media |
| Búsqueda | `array-contains` sobre `searchTokens` | Media |
| Seguridad | Reglas Firestore + custom claims | Alta |
| Exportaciones | Excel en cliente | Media |

---

## 4. Equivalencias en Supabase

| Firebase | Supabase | Dificultad |
|---|---|---|
| Firestore (documentos anidados) | Postgres (tablas + `tenant_id`, JSONB para ítems/repuestos) | Media |
| `users/{uid}/products/...` | `products` con FK a `tenants` | Baja |
| Reglas Firestore | RLS por `tenant_id` + JWT | Media/Alta |
| `writeBatch` / `increment` | Transacción SQL o función RPC | Media |
| `runTransaction` | RPC PL/pgSQL | Media/Alta |
| `onSnapshot` | Realtime (`postgres_changes`) | Baja |
| `getCountFromServer` / `sum` | `COUNT`/`SUM` SQL | Baja (mejor) |
| `array-contains` / tokens | `pg_trgm` / `tsvector` | Baja (mejor) |
| Caché offline persistente | **No existe equivalente directo**; habría que construirla (Dexie) | **Muy alta** |
| Firebase Auth | Supabase Auth (hashes/escrypt o reset) | Media |
| Custom claims admin | JWT claims / tabla `platform_admins` | Media |
| Export XLSX cliente | Igual (no depende del backend) | Baja |

---

## 5. Lo que se perdería o habría que reescribir

### 5.1 Offline del POS (el bloqueador principal)

Hoy el POS vende sin internet gracias a la caché persistente de Firestore y a la cola `offline-sync-manager`. En Supabase **no hay caché offline automática**: habría que construir:

- Caché local (Dexie/IndexedDB) de productos, clientes y ventas.
- Cola de operaciones con resolución de conflictos.
- Sincronización por lotes y reintentos.
- UI de “sin conexión” y reconciliación.

Eso solo son **1–2 semanas** y es la parte más delicada de un POS en Venezuela.

### 5.2 Transacciones y atomicidad

Checkout, entrega de reparación, reembolso y abonos usan transacciones de Firestore. En Postgres hay que escribir **funciones RPC** equivalentes y probar concurrencia (dos cajas vendiendo el mismo producto).

### 5.3 Seguridad

Las reglas actuales son cortas y probadas. En Supabase hay que diseñar RLS para ~18 tablas; un error de RLS puede exponer datos entre negocios. Requiere pruebas específicas.

### 5.4 Auth

- Las contraseñas no se pueden leer.
- Con **5 negocios**, lo más simple es **forzar restablecimiento de contraseña** en la migración (poco volumen, riesgo bajo).
- Si se intenta importar hashes, validarlo antes en el POC.

### 5.5 Datos y reportes

Los `stats_daily`/`stats_monthly` se pueden reemplazar por **vistas SQL** (mejor), pero hay que reescribir Reportes/Dashboard/Análisis y validar cifras contra los totales actuales.

---

## 6. Costos (aproximados)

| | Firebase (Blaze) | Supabase |
|---|---|---|
| Base | 9,2 MB | 9,2 MB |
| Lecturas | ~$0,03 por 100.000 | No se cobran lecturas; se cobra compute/egress |
| Escrituras | ~$0,09 por 100.000 | Incluidas |
| Costo estimado con uso actual | **$0–3/mes** | **$0 (free) / $25/mes (Pro)** |
| Free tier | 50.000 lecturas/día | 500 MB DB, se pausa por inactividad |
| Offline | Incluido | **A construir** |

A 5 negocios, **el costo no justifica la migración**.

---

## 7. Riesgos de migrar

| Riesgo | Impacto | Mitigación |
|---|---|---|
| POS deja de funcionar offline | **Crítico** | Construir caché/cola antes del corte; POC de offline |
| Pérdida o duplicación de ventas en la migración | **Crítico** | Dry-run, conteos, checksums, modo sombra |
| RLS mal configurado expone datos entre negocios | **Crítico** | Revisión de políticas + tests por rol |
| Errores en transacciones (stock negativo, abonos) | Alto | RPC probadas con concurrencia |
| Auth: usuarios sin acceso | Alto | Reset de contraseñas (5 negocios) |
| 10–14 semanas sin features nuevas | Alto | POC con puerta go/no-go |
| Doble mantenimiento durante la transición | Medio | Congelar features y migrar por fases |

---

## 8. Cuándo sí valdría la pena Supabase

Disparadores concretos (no “porque es más moderno”):

1. Necesitan **reportes SQL/joins** que hoy obligan a descargar datos o mantener agregados.
2. El equipo crece y varios devs necesitan **SQL/Postgres** en vez de SDK de Firestore.
3. Superan ~**50–100 negocios** y la factura de Firebase o los límites duelen de verdad.
4. Necesitan **storage** de archivos, búsqueda avanzada o analítica pesada.
5. El offline deja de ser requisito (POS 100 % en línea).

Si nada de eso aplica, migrar es cambiar un problema resuelto por uno nuevo.

---

## 9. Plan de viabilidad por fases (sin cambios todavía)

> Cada fase termina con una puerta **go/no-go**. Si el POC no convence, se aborta sin tocar producción.

### Fase 0 — Higiene y línea base (2–3 días)

- Añadir `backups/` a `.gitignore` y **no commitear** el JSON (contiene emails y `securityPin` en texto plano).
- Cifrar el backup y guardarlo fuera del repo.
- Medir lecturas/escrituras actuales durante 7 días (Firebase Usage).
- Confirmar qué colecciones raíz son históricas y cuáles basura.

**Salida:** informe de volumen, costo y datos a migrar.

### Fase 1 — Diseño del esquema (1 semana)

- Modelo Postgres: `tenants`, `profiles`, `products`, `sales`, `sale_items`, `repair_jobs`, `repair_parts`, `fiados`, `expenses`, `reconciliations`, `settings`, etc.
- Decidir JSONB para ítems/repuestos/combos.
- RLS por `tenant_id`; `platform_admins`.
- Índices para las consultas actuales (fecha, estado, búsqueda `pg_trgm`).
- Funciones RPC: checkout, entrega de reparación, reembolso, abono de fiado.

**Salida:** esquema + documento de mapeo colección → tabla.

### Fase 2 — POC acotado (2 semanas) ← **puerta principal**

- Proyecto Supabase de pruebas.
- Migrar **1 negocio** (el más pequeño, ej. diegojosebt: 11 productos, 84 ventas).
- Implementar en una rama: login, listado de productos paginado, una venta con descuento de stock, y un reporte del mes.
- Medir latencia, lecturas/egress y **probar offline** (aunque sea con caché mínima).
- Comparar totales contra Firebase.

**Salida:** decisión go/no-go con números.

### Fase 3 — Migración de datos en seco (1 semana)

- Script backup JSON → Postgres (idempotente).
- Validaciones: conteo por tabla, sumas de ventas/utilidad, muestras aleatorias.
- Excluir colecciones raíz dudosas o tratarlas como archivo histórico.

**Salida:** base staging con paridad verificada.

### Fase 4 — Refactor del cliente (4–6 semanas)

- Adaptador de datos (reemplazar hooks de Firestore por consultas Supabase).
- Transacciones → RPC.
- Realtime para perfil/ajustes.
- Búsqueda con `pg_trgm`.
- Reportes/Stats con vistas SQL.
- **Offline**: caché Dexie + cola + reintentos.

**Salida:** app completa en staging con paridad funcional.

### Fase 5 — Corte de Auth (1 semana)

- Exportar usuarios, crear cuentas en Supabase.
- Forzar restablecimiento de contraseña a los 5 negocios (o importar hashes si el POC lo valida).
- Mantener login Firebase en paralelo unos días.

### Fase 6 — Modo sombra y corte (2 semanas)

- Escribir en ambos sistemas (o leer de ambos y comparar reportes) durante 1–2 semanas.
- Comparar totales diarios; corregir diferencias.
- Corte definitivo y 30 días de soporte.

### Fase 7 — Desmantelar Firebase

- Export final, congelar, cancelar proyecto.
- Conservar backups verificados.

**Duración total realista:** 10–14 semanas con una persona; más si se hace en paralelo con soporte.

---

## 10. POC recomendado si quieren explorar (2 semanas, bajo riesgo)

1. Crear proyecto Supabase free (no tocar producción).
2. Tablas mínimas: `tenants`, `products`, `sales`, `sale_items`.
3. Importar solo el negocio `diegojosebt` desde el backup.
4. Pantalla de prueba (fuera de la app o en rama): listar productos paginados, registrar una venta, descontar stock, ver reporte del mes.
5. Medir: latencia, egress, esfuerzo de offline.
6. **Criterio de éxito:** la venta y el stock cuadran, el reporte coincide con Firebase y el offline es viable en ≤2 semanas.

Si el POC falla en offline, no migrar.

---

## 11. Seguridad del backup (urgente, independiente de la migración)

- `backups/` **no está en `.gitignore`**: si se sube el repo a GitHub/Vercel, se filtran emails, teléfonos, direcciones y **PINs en texto plano**.
- Acciones recomendadas:
  1. Añadir `backups/` a `.gitignore`.
  2. Sacar el archivo del repo y cifrarlo (7-Zip/Age) fuera del proyecto.
  3. Rotar/eliminar los `securityPin` en texto plano (hoy están en el perfil).
  4. Si el repo ya se subió, asumir el backup como comprometido.

---

## 12. Conclusión

- **Técnicamente es viable**, pero **no es recomendable ahora**: el sistema ya está optimizado, la base es pequeña y el offline del POS es un activo que Supabase no da gratis.
- **Recomendación:** quedarse en Firebase, terminar Vercel, medir 30–60 días y revisar los disparadores de §8.
- Si en el futuro hay una razón de negocio clara (SQL/reportes, escala, equipo), ejecutar el POC de §10 antes de comprometer 3 meses de reescritura.
- **Prioridad inmediata:** proteger el backup (hoy está expuesto en el repo).
