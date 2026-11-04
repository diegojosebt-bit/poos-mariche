# Auditoría de lecturas Firestore y plan de reducción — POS Mariche 2.5

| | |
|---|---|
| **Fecha** | 2026-11-03 |
| **Alcance** | `poos-mariche2.5` (Next.js 14 + Firebase Web SDK 11, Firestore Native, persistencia IndexedDB) |
| **Objetivo** | Dejar el sistema con **cero lecturas redundantes**, paginación y búsqueda en servidor, 100 productos / 100 reparaciones por usuario, y presupuesto de lecturas acotado y medible. |
| **Restricción** | Sin degradar la experiencia: mismas pantallas, mismos flujos, sin “pantallas vacías”, sin romper el modo offline del POS. |
| **Estado** | Fase 0 + motor Fase 2 + POS/Inventario/Reparaciones en beta + búsqueda en servidor + **Fase 1 parcial** (ventas online, gastos, fiados). Pendientes y prioridades en [estado-y-pendientes.md](estado-y-pendientes.md). |

---

## 0. TL;DR (para decidir en 2 minutos)

1. **El diagnóstico del reporte está mal atribuido.** `/users/*/repair_jobs` en la consola de Firebase es el **uid enmascarado**, no un comodín. En este repo **no existe ni un solo `collectionGroup()`** (verificado con grep). Los 704.000 / 470.000 / 454.000 / 260.000 se explican por **documentos devueltos × ejecuciones**, no por un escaneo global.
2. **Las cuatro fugas reales** son: (a) catálogo completo descargado en POS/Inventario/Análisis, (b) colecciones **sin `limit`** (fiados, gastos, exportaciones), (c) **caché sin política** (sin TTL, sin invalidación, con colisiones de clave), y (d) **filtros, orden y totales calculados en el cliente**, lo que obliga a traer todo.
3. **“Cero lecturas” no existe**; existe **cero lecturas redundantes**. La meta correcta: primera carga de cada dispositivo ≤ ~500 documentos, revisitas dentro del TTL = **0 lecturas**, y ningún total calculado recorriendo una colección.
4. **El plan baja ~85–93 %** las lecturas (de ~3.300 por sesión a ~500, y a ~0 en revisitas), sin tocar la UI más allá de un botón “Cargar más” y una búsqueda que ahora sí encuentra todo.
5. **Hay 3 bugs de correctitud** que el plan corrige de paso y que hoy producen números falsos: reportes por rango que solo ven las últimas 100 ventas, gráfico mensual con 50 ventas, y utilidad con costo 0 cuando el producto no está en RAM.

---

## 1. Resumen ejecutivo

### 1.1 Qué dicen los números que trajiste

| Consulta reportada | Lecturas | Ejecuciones | Lecturas / ejecución |
|---|---:|---:|---:|
| `/users/*/repair_jobs` (variante A) | 704.000 | — | ~100 si el `limit` es 100 |
| `/users/*/repair_jobs` + `ORDER_BY createdAt DESC` | 470.000 | — | ~100 |
| `/users/*/sale_transactions` + `ORDER_BY __name__` + `START_AFTER` + `LIMIT 400` | 454.000 | 1.854 | **245** |
| `/users/*/sale_transactions` + rango `transactionDate` | 260.000 | 5.106 | **51** |

La aritmética es concluyente: **245 ≈ documentos devueltos por una página de 400** y **51 ≈ ventas de un día**. Es decir, la facturación sigue el modelo “1 lectura por documento devuelto”, no “1 lectura por comodín”. Si de verdad fuera una *collection group* sobre todos los usuarios, cada ejecución devolvería miles de documentos y 704.000 lecturas se agotarían en **5 ejecuciones**, no en miles.

**Conclusión:** el problema no es el comodín; es **cuántos documentos devuelve cada consulta y cuántas veces se ejecuta**.

### 1.2 Qué encontré en el código

| # | Hallazgo | Coste |
|---|---|---|
| H1 | POS, Inventario y Análisis descargan **la colección completa de productos** | ~1.500 docs por sesión (una vez, compartida por RAM) |
| H2 | Fiados y Gastos descargan **la colección completa, sin `limit`** | ~350 + ~900 docs por sesión |
| H3 | “Exportar reparaciones” y “Exportar inventario” descargan **todo** al abrir un modal | ~1.200 / ~1.500 docs por uso |
| H4 | Caché RAM **sin TTL ni invalidación**: datos viejos toda la pestaña; y **colisión de claves** (dos rangos de fecha distintos comparten clave) | lecturas duplicadas + datos incorrectos |
| H5 | La misma colección con **claves distintas** (`collection()` vs `query()+limit()`) se descarga 2 veces | +100 docs |
| H6 | `addItemToCache` inserta en **todas** las listas que contengan el path (ignora filtros/orden/límite) | duplicados y desorden |
| H7 | “Sincronizar catálogo” fuerza `getDocsFromServer` sin confirmación | +1.500 docs por clic |
| H8 | Productos **soft-deleted** se descargan y se filtran en memoria; `inventory_status` se escribe y nunca se lee | 30–40 % de docs inútiles + escrituras basura |
| H9 | Búsquedas de cliente/equipo consultan Firestore **en cada pausa de tecleo** | decenas de lecturas/día por usuario |
| H10 | **Reportes por rango solo ven las últimas 100 ventas** (filtro en cliente) | **números falsos** |
| H11 | Reglas con `exists()` por evaluación y comodín de escritura total | lecturas por regla + riesgo |
| H12 | Listeners de perfil/ajustes se re-suscriben; `useDoc` no comparte caché | 2 lecturas por remontaje |
| H13 | Admin descarga 100 perfiles de usuario en cada visita | 100 docs |
| H14 | **No hay `firestore.indexes.json`** | las consultas del plan fallarían sin índices |
| H15 | **No hay instrumentación** | imposible demostrar “0 lecturas” ni detectar regresiones |

### 1.3 La meta correcta

> **Cero lecturas redundantes**, no cero lecturas.

| Nivel | Situación | Lecturas esperadas |
|---|---|---|
| N0 | Navegar entre pantallas dentro de la misma sesión | **0** |
| N1 | Recargar la app dentro de 3 min (TTL mínimo) | **0** |
| N2 | Primera carga del día en un dispositivo | ≤ 500 documentos |
| N3 | Búsqueda en servidor (3+ caracteres) | ≤ 20 |
| N4 | “Cargar más” | ≤ 100 |
| N5 | Sincronizar / exportar (acción explícita) | acotado, con aviso |

---

## 2. Cómo se facturan las lecturas (lo que hay que saber para no autoengañarse)

### 2.1 Tabla de costes

| Operación | Coste facturado |
|---|---|
| `getDocs(query)` contra servidor | 1 lectura por documento devuelto; **1** si no devuelve nada |
| `getDocsFromCache(query)` | **0** |
| `getDocFromCache(ref)` | **0** (clave para calcular deltas sin leer) |
| `onSnapshot(query)` | 1 por doc en el primer snapshot + 1 por doc en cada cambio; **cada re-suscripción vuelve a leer** |
| `limit(400)` | hasta 400; el límite no abarata, solo **pone techo** |
| `count()` / `sum()` / `avg()` | 1 lectura por cada 1.000 documentos que coinciden (mínimo 1) |
| `get()` / `exists()` en reglas | consumen lecturas cuando se evalúan; se evalúan **por documento/consulta** |
| `collectionGroup('x')` | docs devueltos + evaluaciones de regla; **no** “escanea todas las subcolecciones” como tal, pero multiplica reglas y devuelve mucho |

Fuentes: [precios y ejemplos de facturación de Firestore](https://firebase.google.com/docs/firestore/billing-example), [consultas de agregación](https://firebase.google.com/docs/firestore/query-data/aggregation-queries), [reglas y acceso a otros documentos](https://firebase.google.com/docs/firestore/security/rules-conditions).

### 2.2 El mito del comodín `/users/*/...`

La consola de uso de Firestore **enmascara el id del documento con `*`**. Una consulta normal a `users/abc123/repair_jobs` se muestra como `/users/*/repair_jobs`. Eso **no** significa que sea una *collection group*.

Cómo distinguirlo en 10 segundos:

1. En la vista de uso/monitoreo de Firestore, abre el detalle de la consulta.
2. Mira la **etiqueta de tipo** (en Cloud Monitoring: `type`):
   - `COLLECTION` → es una consulta por usuario (normal; el `*` es el uid enmascarado).
   - `COLLECTION_GROUP` → sí es un comodín (`collectionGroup()`), y ahí sí hay que eliminarlo.
3. Busca en el código: `collectionGroup(` no aparece en este repo.

**En este checkout no existe ninguna consulta de rango sobre `transactionDate` ni ningún `limit(400)`.** Si el build desplegado los tiene, entonces el build desplegado **no es este repo** (o es una versión anterior). El plan cubre ambos casos; la Fase 0 incluye el logger para mapear consulta → pantalla en producción.

### 2.3 Reconstrucción aritmética de tus métricas

Con `limit(100)`: 704.000 ÷ 100 = **7.040 ejecuciones**; 470.000 ÷ 100 = **4.700**. Con `limit(400)`: 454.000 ÷ 1.854 = **245** documentos por página. Con rango de fechas: 260.000 ÷ 5.106 = **51** documentos por ejecución.

Eso encaja con un POS multi-dispositivo: ~110 dispositivos × ~2 sesiones/día × ~3.300 lecturas/sesión ≈ **726.000 lecturas/día**. No hace falta ningún comodín para llegar a 704.000.

**Implicación para el plan:** no hay que “quitar un wildcard”; hay que **reducir documentos por ejecución** (paginación + 100 iniciales) y **reducir ejecuciones** (caché + TTL + agregados). Ambas cosas están en el plan.

---

## 3. Auditoría del código

### 3.1 Mapa de la capa de datos

```
UI (páginas y componentes)
   │
   ├─ useCollection()  ──────► dataCache (RAM, en DashboardContext, sin TTL ni LRU)
   │      │                       │
   │      ├─ getDocsFromCache ────┤  (IndexedDB, 0 lecturas)
   │      └─ getDocs / getDocsFromServer (red, 1 lectura/doc)
   │
   ├─ useDoc() ───────────────► onSnapshot (2 listeners globales: perfil y ajustes)
   │
   └─ getDocs() directos en componentes (exportaciones, búsquedas de cliente)
```

Puntos clave del código actual:

- `src/firebase/index.ts:36` — persistencia local correcta (`persistentLocalCache` + `persistentMultipleTabManager`). **Bien.**
- `src/firebase/firestore/use-collection.tsx:44-83` — clave de caché construida desde **internals del SDK** (`_query`), con valores no serializables colapsados a `"val"`.
- `src/firebase/firestore/use-collection.tsx:153-169` — “cache-first”: si hay algo en IndexedDB, **devuelve y nunca revalida**.
- `src/contexts/dashboard-context.tsx:66-85` — `addItemToCache` recorre **todas** las claves y usa `includes(path)`.
- `src/app/dashboard/layout.tsx:115-157` — 2 listeners de documento (perfil y ajustes). **Bien**, pero se re-suscriben si el layout se remonta.

### 3.2 Inventario de consultas

> Supuestos de volumen: **P** = 1.500 productos, **R** = 1.200 reparaciones, **S** = 25.000 ventas, **F** = 350 fiados, **E** = 900 gastos, **U** = 120 usuarios.

| # | Pantalla | Archivo:línea | Consulta | Docs/apertura | Frecuencia | Veredicto |
|---|---|---|---:|---:|---|---|
| 1 | POS | `pos/page.tsx:31` | `products` (colección completa) | 1.500 | 1ª pantalla de la sesión | ❌ |
| 2 | POS | `pos/page.tsx:37` | `held_sales` completa | ~20 | sesión | ⚠️ |
| 3 | Inventario | `inventory/page.tsx:115` | `products` completa | 0 (comparte RAM) | sesión | ❌ |
| 4 | Análisis | `analysis/page.tsx:28` | `products` completa | 0 (comparte RAM) | sesión | ⚠️ |
| 5 | Reparaciones | `repairs/page.tsx:54` | `repair_jobs` `limit(100)` | 100 | 2/día | ⚠️ |
| 6 | Dashboard | `dashboard/page.tsx:27` | `repair_jobs` `limit(100)` | 0/100 (misma clave) | 2/día | ✅ comparte |
| 7 | Dashboard | `dashboard/page.tsx:16` | `sale_transactions` `limit(50)` | 50 | 2/día | ⚠️ clave distinta |
| 8 | Reportes | `reports/page.tsx:28` | `sale_transactions` `limit(100)` | 100 | 1/día | ❌ |
| 9 | Reportes (bajo demanda) | `reports/page.tsx:61-83` | 4 consultas (50/50/30/30) | 160 | 0,3/día | ⚠️ |
| 10 | Fiados | `fiados/page.tsx:60` | `fiados` **sin límite** | 350 | 1/día | ❌ |
| 11 | Gastos | `expenses/page.tsx:53` | `expenses` **sin límite** | 900 | 1/día | ❌ |
| 12 | Exportar reparaciones | `export-repairs-dialog.tsx:57` | `repair_jobs` **sin límite** | 1.200 | por apertura | ❌ |
| 13 | Exportar inventario | `settings/page.tsx:315` | `products` completa | 1.500 | ocasional | ❌ |
| 14 | Admin | `admin/page.tsx:354` | `users` `limit(100)` | 100 | ocasional | ⚠️ |
| 15 | Receta/repuesto | `repair-form-dialog.tsx:243` | `products` `orderBy(name)` `limit(200)` | 200 | por apertura | ❌ |
| 16 | Cliente POS | `cart-display.tsx:55` | `sale_transactions` `where(customerID)` `limit(1)` | 1 | por pausa de tecleo | ⚠️ |
| 17 | Cliente reparación | `repair-form-dialog.tsx:273` | `repair_jobs` `where(customerID)` `limit(1)` | 1 | por pausa | ⚠️ |
| 18 | Perfil/Ajustes | `layout.tsx:117,149` | 2 `onSnapshot` de documento | 2 | sesión | ✅ |
| 19 | Checkout | `cart-display.tsx:474-509` | `writeBatch` + `increment` | **0** | por venta | ✅ |
| 20 | Devolución / entrega | `transaction-list.tsx:80`, `repairs/columns.tsx:226` | transacción con lectura por producto | 3–10 | baja | ⚠️ |

**Total típico por sesión ≈ 3.300 lecturas.** Es exactamente el orden de magnitud del reporte.

### 3.3 Hallazgos

#### H1 — Catálogo completo en tres pantallas
`inventory/page.tsx:115`, `pos/page.tsx:31`, `analysis/page.tsx:28` piden `collection(...,'products')` sin `where` ni `limit`. Se comparte por RAM (misma clave), pero **cada sesión nueva paga P lecturas**. Con 1.500 productos y 110 dispositivos, son **165.000 lecturas/día solo por abrir**.

#### H2 — Colecciones sin `limit`
`fiados/page.tsx:60` → `orderBy('createdAt','desc')` sin `limit`.
`expenses/page.tsx:53` → `orderBy('createdAt','desc')` sin `limit`.
Estas colecciones **solo crecen**. Hoy 350 y 900; en dos años pueden ser 5.000 y 20.000. Es una fuga estructural, no un pico.

#### H3 — Exportaciones que descargan todo
`export-repairs-dialog.tsx:52-70` hace `getDocs` de **todo** el histórico al abrir el modal; `settings/page.tsx:307-330` hace lo mismo con productos si no está en RAM. El usuario cree que “abrió un modal”; en realidad descargó 1.200–1.500 documentos.
El patrón `ORDER_BY __name__ ASC START_AFTER (?) LIMIT 400` de tu reporte es **exactamente** una exportación paginada del histórico completo (63 páginas de 400 para 25.000 ventas).

#### H4 — Caché sin política y con colisión de claves
`getQueryCacheKey()` (`use-collection.tsx:44-83`):
- Usa `query._query` (API interna; puede cambiar entre versiones).
- En `filters`, convierte los valores a texto **solo si son string/number/boolean**; un `Timestamp` cae en `'val'`. Resultado: **dos rangos de fecha distintos producen la misma clave** → sirve datos del rango anterior y evita la consulta correcta. Es un bug de correctitud, no solo de coste.
- No incluye TTL ni `updatedAt`: `getDocsFromCache` no vacío ⇒ `return` definitivo (`:157-164`). Los precios y el stock quedan congelados hasta recargar.

#### H5 — Doble descarga por claves distintas
`collection(firestore,'users',uid,'products')` y `query(collection(...), limit(50))` son claves distintas. Reportes (`reports/page.tsx:62`) y Reparaciones (`repair-form-dialog.tsx:243`) piden variantes que **no comparten** con la colección completa. Cada variante paga su propia descarga.

#### H6 — `addItemToCache` contamina listas
`dashboard-context.tsx:66-85` inserta la venta nueva en **toda** clave que contenga `sale_transactions`, sin mirar filtros, orden ni límite. Con listas paginadas esto rompe la página (aparece un ítem que no corresponde al cursor) y duplica al fusionar.
`updateCachedItem` (`:87-107`) hace lo mismo con cualquier lista que contenga el id.

#### H7 — “Sincronizar catálogo” sin freno
`inventory/page.tsx:236` llama `refetchProducts()` → `use-collection.tsx:229` → `getDocsFromServer` ⇒ **1.500 lecturas por clic**, sin confirmación, sin cadencia, sin aviso de coste.

#### H8 — Soft-delete descargado + “guardián” inútil
`deleteDocumentNonBlocking` (`non-blocking-updates.tsx:135`) hace soft-delete (`isDeleted: true`) y `useCollection` filtra en memoria (`:160,180,195`). Se descargan los borrados y se descartan: 20–40 % de lecturas basura.
Además, cada escritura de producto actualiza `metadata/inventory_status` (`:21-31`) y **nadie lo lee** (grep: solo escrituras). Escrituras 100 % desperdiciadas.

#### H9 — Búsquedas por tecleo
`cart-display.tsx:48-70` y `repair-form-dialog.tsx:267-280`: cada pausa de 400/600 ms con 5+ caracteres dispara una consulta. 40 búsquedas/día × 110 dispositivos = 4.400 lecturas/día y **ninguna caché** si repites el mismo cliente.

#### H10 — Reportes históricos falsos (crítico)
`reports/page.tsx:28` carga `limit(100)` y `date-range-report.tsx:80-83` filtra **en el cliente**. Si el usuario elige “septiembre”, y hay más de 100 ventas después, el reporte muestra **$0 y 0 transacciones**. Lo mismo en:
- `monthly-activity-overview.tsx:31-37` (gráfico mensual sobre 50 ventas),
- `reports/transaction-list.tsx:271-303` (paginación sobre 100),
- `export-sales-button.tsx:48-52` (exporta solo lo cargado).

Esto es más grave que el coste: **el dueño está tomando decisiones con números incompletos**.

#### H11 — Reglas que cuestan lecturas
`firestore.rules:13-15` define `isAdmin()` con `exists(/roles_admin/$(uid))`, y `:47-49` aplica `isOwner || isAdmin` a **todas** las subcolecciones. Para consultas del dueño el `||` cortocircuita (bien), pero cualquier consulta cruzada evalúa `exists()` por documento, y el comodín `{allData=**}` permite escrituras en todo el árbol. Con *custom claims* esto pasa a **0 lecturas por regla**.

#### H12 — Listeners que se re-suscriben
`layout.tsx:115-157` está bien (2 documentos), pero cada recarga completa o remontaje del layout re-abre los listeners (2 lecturas). `useDoc` no comparte caché con `useCollection`. No es el problema principal, pero conviene unificarlo.

#### H13 — Admin
`admin/page.tsx:354` descarga 100 perfiles. Si en producción existe un panel con `collectionGroup` sobre `sale_transactions` o `repair_jobs` para “ver todos los negocios”, ahí sí se dispara el coste (y las reglas `exists()` lo multiplican).

#### H14 — Sin índices
No hay `firestore.indexes.json` ni `firebase.json`. Cualquier `where + orderBy` del plan fallará con `failed-precondition` hasta crear el índice compuesto. **Hay que crearlos antes de desplegar** y tener *fallback* mientras se construyen.

#### H15 — Sin instrumentación
No hay forma de responder “¿cuántas lecturas hizo esta pantalla?”. Sin medidor, cualquier optimización es fe.

### 3.4 Causas raíz

1. **Modelo de datos “traer todo y filtrar en cliente”**, cómodo para 100 productos, inviable para 1.500 y catastrófico multi-tenant.
2. **Caché sin política**: RAM infinita por pestaña, IndexedDB sin TTL, sin invalidación por evento, sin límite de tamaño.
3. **Ausencia de agregados**: cada total recorre la colección.
4. **Búsqueda y filtros en cliente**: obligan a tener el universo completo en memoria.
5. **Reglas que leen documentos** y un panel de admin que consulta en cruzado.
6. **Cero observabilidad**: no se mide, no se ve la regresión.

---

## 4. Arquitectura objetivo

### 4.1 Principios

> **Ninguna pantalla pide más de una página. Ninguna búsqueda se hace sobre la página. Ningún total se calcula recorriendo la colección.**

1. **Página 1 siempre**: 100 productos, 100 reparaciones, 50 ventas, 50 fiados, 50 gastos.
2. **El resto, por servidor**: `startAfter` + `limit`, o búsqueda por índice.
3. **Caché primero**: RAM (5 min) → IndexedDB (0 lecturas) → red.
4. **TTL por colección** + invalidación por escritura.
5. **Agregados precalculados** para todos los totales.
6. **Búsqueda con índice invertido en el documento** (`searchTokens`) para que “bater” encuentre “Batería iPhone 11”.

### 4.2 Capas y flujo

```
┌──────────────────────────────────────────────────────────────┐
│ UI: pantallas (sin lógica de Firestore, sin filtros masivos) │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Hooks de datos                                                │
│  usePagedQuery()     → lista + paginación por cursor          │
│  useServerSearch()   → búsqueda con debounce y cancelación    │
│  useStats()          → lee 1 doc de agregados                 │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ queryCache (RAM)                                              │
│  · clave determinista  · LRU 80 entradas                      │
│  · fetchedAt (5 min)   · serverSyncedAt (TTL por colección)   │
│  · cursor / hasMore    · merge de resultados de búsqueda      │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Firestore persistent cache (IndexedDB, compartida entre tabs) │
│  · getDocsFromCache = 0 lecturas                              │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Red: getDocs(limit ≤ 100) / startAfter / getDocsFromServer    │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 Presupuesto por pantalla

| Pantalla | Primera visita | Revisita < 5 min | Revisita < TTL | Búsqueda |
|---|---:|---:|---:|---:|
| POS | 100 productos + 20 retenidas | 0 | 0 | ≤ 20 |
| Inventario | 100 productos | 0 | 0 | ≤ 20 |
| Reparaciones | 100 | 0 | 0 | ≤ 20 |
| Dashboard | 2 docs de stats | 0 | 0 | — |
| Reportes | 1–31 días de stats + 50 ventas | 0 | 0 | ≤ 20 |
| Fiados | 50 + 1 stat | 0 | 0 | ≤ 20 |
| Gastos | 50 + 1 stat | 0 | 0 | ≤ 20 |
| Análisis | 1 doc `stats/analysis` | 0 | 0 | — |
| Perfil/Ajustes | 2 (listeners) | 2 | 2 | — |
| **Total** | **≈ 500** (+ ≤ 20 por búsqueda) | **≈ 2** | **≤ 50** | — |

### 4.4 Contrato de caché

| Colección | TTL servidor | TTL RAM | Invalidación |
|---|---:|---:|---|
| `products` | 10 min | 5 min | al guardar/borrar producto, al importar |
| `repair_jobs` | 3 min | 5 min | al crear/actualizar/entregar |
| `sale_transactions` | 5 min | 5 min | al cobrar, reembolsar, arquear |
| `fiados` | 5 min | 5 min | al crear/abonar/eliminar |
| `expenses` | 10 min | 5 min | al crear/eliminar |
| `held_sales` | 1 min | 1 min | al retener/restaurar |
| `stats/*` | 1 min | 1 min | escritura de la colección origen |
| `users`, `app-settings` | — (listener) | — | `onSnapshot` |

Reglas de oro:

1. **Clave determinista y serializable**: `u:{uid}|c:{colección}|f:{filtros ordenados}|o:{campo}:{dir}|l:{limit}`. Nunca derivada de `query._query`.
2. **Nunca marcar como “fresco” lo que vino de caché**: `serverSyncedAt` separado de `fetchedAt`.
3. **Una revalidación por ventana de TTL**, no por navegación.
4. **LRU de 80 entradas** para no crecer sin control en tablets de 2 GB.
5. **Multi-pestaña**: la persistencia ya es compartida; además, `BroadcastChannel('mm-cache')` para invalidar RAM de otras pestañas al escribir (opcional, Fase 5).
6. **Privacidad en equipos compartidos**: al cerrar sesión, ofrecer limpieza de IndexedDB (ver 4.5).

### 4.5 Las dos cachés del navegador (no confundirlas)

| Caché | Qué guarda | Quién la usa | ¿Ahorra lecturas? |
|---|---|---|---|
| **Firestore persistent cache** (IndexedDB) | documentos y resultados de consultas | SDK de Firestore | **Sí, es la clave** |
| **HTTP / Service Worker** | JS, CSS, HTML, íconos | navegador | No; ahorra latencia y datos móviles |

- `firebase/index.ts:36-40` ya configura la caché persistente correctamente (`persistentLocalCache` + `persistentMultipleTabManager`). **No tocar**, solo añadir `cacheSizeBytes` si se quiere más espacio (por defecto ~40 MB; suficiente para 1.500 productos y 100 reparaciones).
- `public/sw.js` existe (generado con Workbox) pero **no está registrado**: no hay `serviceWorker.register` en `src/`. Registrarlo acelera la carga y permite abrir el POS sin red, pero **no reduce ni una lectura**. Va en Fase 5, con estrategia `stale-while-revalidate` solo para estáticos y **nunca** cacheando tráfico de Firestore.
- `localStorage` solo para metadatos (timestamps de sincronización, preferencias). **Nunca** para listas: 5 MB, `JSON.parse` en cada render y datos desincronizados.
- Al cerrar sesión en equipos compartidos, ofrecer “limpiar datos locales” (IndexedDB) porque el caché conserva documentos del usuario anterior.

### 4.6 Integridad con catálogo parcial (el riesgo #1)

Hoy, el costo y la utilidad de una venta se calculan **buscando el producto en `allProducts`** (`cart-display.tsx:321,323,336`). Si solo cargas 100 productos, un producto buscado en servidor **no estará en RAM** y la venta se registrará con **costo 0 ⇒ utilidad inflada**. Lo mismo pasa con combos (`:233`) y con repuestos de reparación (`repair-form-dialog.tsx:305`).

Mitigaciones obligatorias (van en la Fase 2, no después):

1. **Catálogo canónico acumulativo**: `queryCache.mergeIntoCatalog(uid,'products', items)` cada vez que una búsqueda devuelve productos. La caché de `products` crece con lo que el usuario usa, no con lo que existe.
2. **Congelar el costo en el carrito**: al añadir un producto, guardar `costPrice` en el ítem del carrito; al cobrar, persistirlo en el ítem de la venta (ya se hace: `:358-362`). Así el cálculo no depende de una segunda búsqueda.
3. **Si un componente de combo no está en caché**, leerlo por id (`getDoc`, 1 lectura) o impedir la venta del combo hasta sincronizar.
4. **Búsqueda de repuestos**: sustituir el filtro sobre 200 por `useServerSearch` + merge.
5. **Nunca** calcular stock disponible de un producto ausente de la caché como 0 silenciosamente: mostrar “sincronizando…” y bloquear el añadido.

---

## 5. Paginación y búsqueda en servidor

### 5.1 Paginación por cursor

Firestore no tiene `offset`: se pagina con `startAfter(documento)`. Consecuencias de diseño:

- **“Cargar más” (scroll infinito)** es el patrón natural: cada página cuesta exactamente `pageSize` lecturas y nunca se relee lo anterior.
- **Saltar a la página 7** exigiría recorrer las 6 anteriores (6 × 100 lecturas). No se implementa: se usa búsqueda para llegar a un registro concreto.
- **`hasMore`**: `documentosDevueltos === pageSize`. En el peor caso, una consulta extra de 0 resultados cuesta **1 lectura**.
- **Orden estable**: Firestore usa `__name__` como desempate al recorrer el índice; para estabilidad absoluta (empates exactos de fecha) añade `orderBy(documentId())` y su índice.
- **Caché + cursor**: un cursor obtenido de IndexedDB puede no coincidir con la primera página del servidor. Por eso `loadMore` **solo se habilita si la página 1 vino del servidor**; si vino de caché, el primer toque sincroniza (100 lecturas) y el segundo pagina.

### 5.2 Búsqueda: opciones y decisión

| Opción | Consulta | Coste | Problema |
|---|---|---|---|
| Prefijo en `name` | `name >= t && name <= t+'\uf8ff'` | ≤ 20 | solo prefijo, no “contiene” |
| `array-contains` en `searchTokens` | `where('searchTokens','array-contains', token)` | ≤ 20 | requiere escribir tokens al guardar |
| `array-contains-any` | hasta 30 tokens | ≤ 20 | límite 30 y muchos falsos positivos |
| Algolia / Typesense | externo | 0 Firestore | coste y sincronización extra |

**Decisión: `array-contains` sobre `searchTokens`** (prefijos de cada palabra) + exacto para `barcode` y `customerID`.

- Al guardar un producto se calculan tokens de: `name`, `sku`, `barcode`, `category`, `compatibleModels`, `searchKeywords`.
- Se normaliza: minúsculas, sin acentos (`NFD`), sin signos.
- Tokens: por cada palabra, prefijos de 2 a 16 caracteres + palabra completa. Tope **60 tokens** (~1 KB por documento).
- Búsqueda: se toma **la última palabra tecleada** (≥ 3 caracteres) y se filtra el resto del texto en cliente sobre ≤ 20 resultados.
- Debounce 350 ms, cancelación por generación y resultados guardados en el LRU de consultas (**repetir la misma búsqueda = 0 lecturas**).

### 5.3 Índice de búsqueda en el documento

```json
// users/{uid}/products/{id}
{
  "name": "Batería iPhone 11",
  "searchName": "bateria iphone 11",
  "searchTokens": ["ba","bat","bate","bater","bateri","bateria","ip","iph","ipho","iphon","iphone","11"],
  "searchVersion": 1,
  "isDeleted": false,
  "salesCount": 12
}
```

`searchVersion` permite reindexar sin recorrer todo (solo los que tengan versión anterior).

### 5.4 Cómo queda cada pantalla

| Pantalla | Página 1 | Filtros | Búsqueda |
|---|---|---|---|
| **POS** | 100 productos por `salesCount desc` (los más vendidos primero) + 20 retenidas | categoría → consulta por servidor | tokens + `barcode` exacto |
| **Inventario** | 100 por `name asc` | stock bajo/sin stock/antiguos → `where` en servidor | tokens |
| **Reparaciones** | 100 por `createdAt desc` | estado y rango de fechas → `where` | tokens (cliente, equipo, ID, teléfono) |
| **Fiados** | 50 `Pendiente` por `createdAt desc` | “todos” / “pendientes” | tokens de cliente |
| **Gastos** | 50 del mes en curso | rango de fechas y categoría | descripción |
| **Reportes** | totales de `stats_daily` + 50 ventas | rango → stats + consulta de rango | cliente/ref |
| **Análisis** | 1 doc `stats/analysis` (top vendidos, críticos y estancados precalculados) | — | — |
| **Admin** | `stats/overview` por tenant o `count()` | — | — |

> **Nota POS:** ordenar por `salesCount` requiere que **todos** los productos tengan el campo. El backfill lo inicializa en 0. Si se prefiere no reindexar, usar `name asc` (también válido).

Uso típico en la pantalla (así queda el contrato en el código):

```tsx
// Página 1: 100 productos, 0 lecturas si ya están en caché
const catalog = usePagedQuery<Product>({
  collectionName: 'products',
  filters: [['isDeleted', '==', false]],
  orderField: 'name',
  orderDir: 'asc',
  pageSize: 100,
});

// Búsqueda: solo pega al servidor cuando hay 3+ caracteres y no está cacheada
const search = useServerSearch<Product>({
  collectionName: 'products',
  term: searchTerm,
  filters: [['isDeleted', '==', false]],
  orderField: 'name',
  orderDir: 'asc',
  onResults: (found) => queryCache.mergeIntoCatalog(uid, 'products', found),
});

// “Cargar más”
<Button onClick={() => catalog.loadMore()} disabled={!catalog.hasMore}>Cargar más</Button>
```

---

## 6. Agregados (rollups): eliminar “traer todo para sumar”

### 6.1 Esquema

```
users/{uid}/stats/overview          // 1 lectura: dashboard y análisis
  inventory: { items, units, costUSD, retailUSD, lowStock, outOfStock }
  repairs:   { open, unpaidAmount, warranty }
  fiados:    { pendingCount, pendingAmount }
  updatedAt

users/{uid}/stats_monthly/{YYYY-MM} // 1 lectura por mes: dashboard y reportes
  salesUSD, salesCount, costUSD, profitUSD, expensesUSD
  byMethod: { cashUSD, cashBs, card, mobile, transfer, crypto }
  byDay:    { "01": { salesUSD, profitUSD, count, repairs }, ... "31": {...} }
  updatedAt

users/{uid}/stats_daily/{YYYY-MM-DD} // 1 lectura por día: reportes exactos
  salesUSD, salesCount, costUSD, profitUSD, expensesUSD
  byMethod: {...}
  items: { "<productId>": { n, q, rev, cost } }
  updatedAt

users/{uid}/stats/analysis           // 1 lectura: pantalla de Análisis
  topSellers: [ { id, name, salesCount, revenue } ... 10 ]
  critical:   [ { id, name, stock, threshold } ... 20 ]
  stagnant:   [ { id, name, stock, days } ... 15 ]
  categories: [ { name, count, costUSD, retailUSD } ]
  generatedAt
```

El doc `stats/analysis` lo genera una ruta de servidor (`/api/tenant-analysis`, Admin SDK) con caché de 1 hora por tenant: se paga **una vez por hora** y todos los clientes leen **1 documento**. Si todavía no existe, la pantalla cae a 2 páginas de 100 (200 lecturas) como máximo.

Con esto:

- Dashboard = **2 lecturas** (overview + monthly del mes).
- Reporte “hoy” = **1 lectura** (daily de hoy) + 50 ventas de la lista.
- Reporte “este mes” = **1** (monthly) + 31 daily si se necesita el desglose por artículo.
- Reporte “enero a marzo” = **3** (monthly) + 0 daily.
- Análisis = **1** (`stats/analysis`, generado por servidor con caché de 1 h).

### 6.2 Escritura sin lecturas (`increment`)

El checkout **ya** usa `writeBatch` + `increment` (`cart-display.tsx:474-509`), o sea **0 lecturas por venta**. Se amplía el mismo batch:

```ts
const stats = saleStatsWrites(sale);           // ver anexo F
batch.set(dailyRef(firestore, uid, dayKey()), stats.daily, { merge: true });
batch.set(monthlyRef(firestore, uid, monthKey()), stats.monthly, { merge: true });
batch.set(overviewRef(firestore, uid), { updatedAt: serverTimestamp() }, { merge: true });
await batch.commit();
```

- Los `increment()` son **transformaciones atómicas**: no leen, no hacen `transaction.get`.
- Un reembolso aplica los mismos campos en negativo.
- Un cambio de producto actualiza el inventario con un delta calculado **desde caché**: `getDocFromCache` cuesta **0 lecturas**. Si no está en caché, se marca `statsDirty` y lo corrige la reconciliación (no se paga una lectura por cada guardado).
- Coste: +2–3 escrituras por venta (≈ $0,000003). Irrelevante frente a las lecturas ahorradas. **Ojo:** Firestore limita a ~1 escritura sostenida/segundo por documento; con un POS es de sobra, con 50 cajas simultáneas habría que fragmentar (`stats_daily/{día}/shards/{n}`).

### 6.3 Reportes por rango

```
rango = [from, to]
mesesCompletos = meses totalmente dentro del rango
diasParciales  = días del borde (≤ 62)

total = Σ stats_monthly[mes]  +  Σ stats_daily[día]
detalle = daily.items de los días del rango (solo si el usuario abre el desglose)
lista   = usePagedQuery(sale_transactions, where(transactionDate >= from, <= to), 50)
```

Resultado: exacto para cualquier rango histórico (**hoy, con la implementación actual, es falso**: ver H10) y acotado a decenas de lecturas.

### 6.4 `count()` / `sum()` como complemento

Para métricas que no se quieran mantener (p. ej. “cantidad de ventas del año”):

```ts
const snap = await getCountFromServer(query(collection(firestore,'users',uid,'sale_transactions'),
  where('transactionDate','>=', from), where('transactionDate','<=', to)));
```

Cuesta **1 lectura por cada 1.000 documentos** que coinciden. Sirve para contadores; **no** para listas ni para sumas de importes (no hay `sum` de expresiones).

### 6.5 Consistencia y reconciliación

Los `increment` pueden desviarse si una escritura falla a medias o si se importan datos por fuera de la app. Medidas:

1. Cada doc de stats lleva `updatedAt` y la UI muestra “actualizado hace X”.
2. Script de reconciliación (anexo J) recalcula `overview` y los últimos 90 días desde `sale_transactions`/`products` y compara; se ejecuta a demanda o 1 vez al mes.
3. Si `|desvío| > 1 %`, alerta. Las lecturas del script son de administrador y se ejecutan de noche.

---

## 7. Índices y reglas

### 7.1 Índices compuestos

Los que el plan necesita (anexo H, listo para `firebase deploy`):

| Colección | Campos |
|---|---|
| `products` | `isDeleted ASC, name ASC` |
| `products` | `isDeleted ASC, category ASC, name ASC` |
| `products` | `isDeleted ASC, salesCount DESC` |
| `products` | `isDeleted ASC, searchTokens CONTAINS, name ASC` |
| `repair_jobs` | `status ASC, createdAt DESC` |
| `repair_jobs` | `isPaid ASC, createdAt DESC` |
| `repair_jobs` | `searchTokens CONTAINS, createdAt DESC` |
| `sale_transactions` | `customerID ASC, transactionDate DESC` |
| `sale_transactions` | `paymentMethods CONTAINS, transactionDate DESC` |
| `fiados` | `status ASC, createdAt DESC` |

Los `orderBy` de un solo campo y los rangos sobre el mismo campo **no** requieren índice compuesto (Firestore los crea solos).

### 7.2 Reglas sin lecturas (custom claims)

`firestore.rules:13-15` usa `exists()`. Cambio:

```js
function isAdmin() { return isSignedIn() && request.auth.token.admin == true; }
```

- 0 lecturas por regla, 0 latencia añadida.
- Se mantiene `roles_admin` solo como fuente para un script que setea el claim:

```js
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

- **Migración segura**: 1) setear claims, 2) verificar en staging, 3) desplegar reglas, 4) borrar la rama `exists()`.
- **Aviso:** si despliegas las reglas nuevas sin haber seteado el claim, el panel de Administración deja de listar usuarios (`allow list: if isAdmin()`). El orden importa.
- El cliente debe dejar de confiar en `profile.isAdmin` (campo escribible por el dueño) para mostrar el panel; el claim manda. Las reglas ya bloquean el acceso real, pero el menú puede mostrarse por error.

### 7.3 Despliegue de índices

Hoy no hay `firebase.json`. Crear:

```json
{ "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" } }
```

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules
```

Los índices se construyen en segundo plano (minutos si hay pocos documentos, horas si hay millones). Mientras están `CREATING`, las consultas fallan con `failed-precondition`: por eso la Fase 2 arranca con bandera apagada y un **fallback** que muestra un aviso en lugar de una pantalla rota.

---

## 8. Presupuesto y proyección

### 8.1 Antes vs después (por sesión/dispositivo)

| Concepto | Antes | Después (1ª vez) | Después (revisita) |
|---|---:|---:|---:|
| Catálogo (POS/Inventario/Análisis) | 1.500 | 100 | 0 |
| Reparaciones | 100 | 100 | 0 |
| Ventas (dashboard + reportes) | 150 | 50 | 0 |
| Fiados | 350 | 50 | 0 |
| Gastos | 900 | 50 | 0 |
| Repuestos (modal reparación) | 200 | 20 (búsqueda) | 0 |
| Búsquedas de cliente | 60 | 20 (con caché) | 0 |
| Exportaciones (promedio) | 120 | 0 (solo rango) | 0 |
| Perfil + ajustes | 2 | 2 | 2 |
| Stats (overview + daily/monthly) | 0 | 5 | 0 |
| **Total** | **≈ 3.300** | **≈ 500** | **≈ 2** |

Con 110 dispositivos y 2 aperturas/día (una con caché tibia):

| Escenario | Lecturas/día | Lecturas/mes | Coste aprox.* |
|---|---:|---:|---:|
| Antes | ~726.000 | ~21,8 M | ~$6,50 |
| Después | ~55.000 | ~1,65 M | ~$0,50 |
| **Reducción** | **−92 %** | | |

\* A $0,03 por 100.000 lecturas (us-central1; varía por región). **El ahorro real no es el dólar: es no agotar la cuota diaria (50.000 en Spark) ni pagar latencia de 490 ms.**

> Ajuste fino: subir el TTL de `products` a 30 min y el de `expenses` a 60 min baja el escenario a ~40.000/día, dentro del nivel gratuito.

### 8.2 Escenarios

| Dispositivos activos | Antes (día) | Después (día) | Después con TTL 30 min |
|---|---:|---:|---:|
| 10 | 66.000 | 5.000 | 3.700 |
| 50 | 330.000 | 25.000 | 18.000 |
| 120 | 792.000 | 60.000 | 44.000 |
| 300 | 1.980.000 | 150.000 | 110.000 |

---

## 9. Plan de implementación

> **Regla de oro del despliegue:** cada fase deja el sistema funcionando y medible. Nada se enciende al 100 % sin bandera y sin métrica.

### 9.1 Garantías de no-impacto para el usuario

| Garantía | Cómo se cumple |
|---|---|
| Mismas rutas y pantallas | No se renombra ni se elimina ninguna vista; solo cambia la fuente de datos |
| Nada “desaparece” | La página 1 (100) se pinta como hoy; “Cargar más” reemplaza al scroll sobre 1.500 |
| La búsqueda sigue respondiendo al teclear | Debounce 350 ms + resultados desde caché; el filtro local se mantiene como respaldo sobre la página |
| Los totales no cambian de un día para otro | Fase 1 escribe stats **en paralelo** y se comparan contra el cálculo viejo antes de usarlos |
| Pantalla nunca rota por un índice faltante | `needsIndex` muestra aviso + botón “modo compatible” que usa el hook anterior hasta la Fase 5 |
| Se puede vender sin internet | El POS conserva los 100 productos cacheados + cola offline existente |
| Precios/stock no quedan congelados | TTL 3–10 min + revalidación al abrir + botón de sincronización |
| Reversión inmediata | Bandera por tenant; apagarla vuelve al código anterior en la próxima carga, sin redeploy |

### 9.2 Fases

#### Fase 0 — Observabilidad y cimientos (1–2 días, sin cambios visibles)

| Paso | Archivo | Qué se hace |
|---|---|---|
| 0.1 | `src/lib/firestore/read-meter.ts` | Contador de lecturas de servidor + `window.__reads` (anexo G) |
| 0.2 | `src/components/debug/read-meter-pill.tsx` | Pastilla visible con `?reads=1`, para QA |
| 0.3 | `src/lib/firestore/cache-policy.ts` | TTL y claves deterministas (anexo A) |
| 0.4 | `use-collection.tsx` | Corregir `getQueryCacheKey`: serializar fechas/Timestamps (hoy colapsan a `'val'`) sin cambiar la firma del hook. La sustitución completa por `buildQueryKey` llega en Fase 2 |
| 0.5 | `firestore.indexes.json`, `firebase.json` | Crear y desplegar índices |
| 0.6 | `firestore.rules` + script de claims | `isAdmin()` sin `exists()` |
| 0.7 | `scripts/backfill.mjs --dry-run` | Medir cuántos documentos faltan de `isDeleted`, `salesCount`, `searchTokens` |

**Aceptación:** ninguna pantalla cambia; el contador refleja ~3.300 por sesión (línea base reproducible).
**Rollback:** revertir el commit; los índices y claims no afectan la app.

#### Fase 1 — Agregados y backfill (2–3 días, sin cambios visibles)

| Paso | Qué |
|---|---|
| 1.1 | `src/lib/firestore/rollups.ts` (anexo F) |
| 1.2 | Escribir `stats_daily` + `stats_monthly` en el checkout (`cart-display.tsx`) y en gastos/fiados/reparaciones |
| 1.3 | `scripts/backfill.mjs` (tokens, `isDeleted`, `salesCount`) + script de reconstrucción de stats con la misma lógica de `saleStatsWrites` (últimos 90 días) |
| 1.4 | Script de reconciliación + comparación contra el cálculo viejo |

**Aceptación:** los totales de stats coinciden con el cálculo actual (ventas del mes, gastos, fiados pendientes, inventario) con desvío < 0,5 %.
**Rollback:** los stats son aditivos; apagar su escritura no rompe nada.

#### Fase 2 — Productos a 100 + búsqueda en servidor (3–5 días, bandera `pagedData`)

| Paso | Archivo | Qué |
|---|---|---|
| 2.1 | `src/lib/firestore/query-cache.ts` | Caché RAM con LRU y TTL (anexo B) |
| 2.2 | `src/lib/firestore/use-paged-query.ts` | Hook de paginación (anexo C) |
| 2.3 | `src/lib/firestore/use-server-search.ts` | Hook de búsqueda (anexo D) |
| 2.4 | `src/lib/search-index.ts` | Normalización y tokens (anexo E) |
| 2.5 | `pos/page.tsx`, `inventory/page.tsx` | 100 productos; búsqueda; “Cargar más”; merge al catálogo |
| 2.6 | `inventory/page.tsx:236` | “Sincronizar” con confirmación de coste |
| 2.7 | `repair-form-dialog.tsx:243` | Reemplazar `limit(200)` por búsqueda |
| 2.8 | `cart-display.tsx` | Congelar `costPrice` en el ítem; leer de caché con `getDocFromCache` |
| 2.9 | `analysis/page.tsx` + `src/app/api/tenant-analysis/route.ts` | Métricas y listas desde `stats/analysis` (fallback a 2 páginas de 100) |

**Aceptación:**
- Primera carga de POS/Inventario ≤ 100 productos.
- Búsqueda de un producto que no está en la página 1 lo encuentra y lo vende con costo correcto.
- Segunda visita en < 5 min: **0 lecturas** (medido).
- Modo offline: muestra los 100 cacheados y avisa “catálogo parcial sin conexión”.
- **Antes de activar la bandera:** el backfill de `isDeleted` y `salesCount` cubre el 100 % de los productos. Si se filtra por un campo que algunos documentos no tienen, esos productos **desaparecen** de la consulta (no es un fallo del hook, es cómo funciona Firestore).

**Rollback:** bandera `pagedData=false` vuelve al código anterior (se conserva hasta la Fase 5).

#### Fase 3 — Reparaciones, fiados y gastos (2–3 días)

| Paso | Archivo | Qué |
|---|---|---|
| 3.1 | `repairs/page.tsx` | 100 + paginación + estado/fecha en servidor + búsqueda |
| 3.2 | `repairs/export-repairs-dialog.tsx` | Exportar solo el rango: páginas de 100 con `startAfter`, armando el Excel por partes |
| 3.3 | `fiados/page.tsx` | 50 pendientes + paginación + stat de “total en la calle” |
| 3.4 | `expenses/page.tsx` | 50 del mes + paginación + stat |
| 3.5 | `cart-display.tsx:48`, `repair-form-dialog.tsx:267` | Búsqueda de cliente con caché (0 lecturas al repetir) |

**Aceptación:** exportación de un mes = ≤ 100 + 31 docs; “total en la calle” exacto sin recorrer la colección.

#### Fase 4 — Reportes y admin (3–5 días)

| Paso | Archivo | Qué |
|---|---|---|
| 4.1 | `reports/page.tsx` | Stats por rango + 50 ventas paginadas |
| 4.2 | `date-range-report.tsx` | Totales desde stats (corrige H10) |
| 4.3 | `monthly-activity-overview.tsx` | `byDay` del monthly doc (corrige el gráfico) |
| 4.4 | `export-sales-button.tsx` | Exportar solo el rango, por páginas |
| 4.5 | `transaction-list.tsx` | Paginación por cursor y filtros en servidor |
| 4.6 | `admin/page.tsx` | Quitar listado masivo; usar `count()` y stats por tenant |
| 4.7 | `settings/page.tsx:307` | Exportación de inventario por páginas |

**Aceptación:** reporte de un mes de hace 6 meses devuelve los mismos totales que un cálculo manual; “hoy” = 1–31 lecturas de stats.

#### Fase 5 — Limpieza y hardening (2 días, opcional)

- Borrar `useCollection` y `addItemToCache` (o dejarlos solo para `held_sales`).
- Eliminar `metadata/inventory_status` (nadie lo lee).
- Añadir validación de stock no negativa en reglas (requiere reglas por colección, no comodín).
- Botón “limpiar datos locales” para equipos compartidos.
- Registrar el service worker (`public/sw.js`) para carga offline del shell; **no** afecta lecturas.

### 9.3 Banderas y rollout

```ts
// users/{uid}.featureFlags
{ "pagedData": true, "serverSearch": true, "rollups": true }
```

1. **Interno** (tu cuenta) 3 días.
2. **3 negocios piloto** (los más activos y los más grandes) 1 semana.
3. **25 %** → **100 %**.
4. Criterio de avance: 0 errores `failed-precondition`, 0 quejas de “no encuentra producto”, lecturas/día −80 %.

Si algo falla: apagar bandera (1 escritura, efecto inmediato en la próxima carga). Sin redeploy.

### 9.4 Qué NO hacer

- ❌ `onSnapshot` en listas “para que esté fresco”: multiplica lecturas por cada cambio.
- ❌ Subir `limit` a 400 para “hacer menos llamadas”: es exactamente el patrón que disparó 454.000 lecturas.
- ❌ Cachear listas en `localStorage`: 5 MB, `JSON.parse` en cada render, y se desincroniza.
- ❌ `collectionGroup` para paneles de admin: es el patrón que hay que eliminar, no adoptar.
- ❌ Paginar con `offset`: existe en el SDK pero salta documentos sin ahorrar trabajo y se desincroniza con las inserciones; usa `startAfter`.
- ❌ Filtrar/ordenar en cliente “porque ya lo tengo”: por eso hay que traerlo todo.
- ❌ Revalidar al enfocar la ventana: 1 revalidación por TTL, no por `focus`.

---

## 10. QA: cómo demostrar “cero lecturas”

### 10.1 Medidor

- `?reads=1` muestra la pastilla con: lecturas de servidor de la sesión, docs por consulta, aciertos de caché.
- `window.__reads.snapshot()` devuelve `{ total, byKey }`.

### 10.2 Pruebas manuales (por pantalla)

| Prueba | Esperado |
|---|---|
| Login → POS | ≤ 120 docs |
| POS → Inventario → Análisis | 0 |
| Volver a POS | 0 |
| Recargar (F5) dentro de 3 min | 0 |
| Buscar “bater” | ≤ 20 |
| Repetir la misma búsqueda | 0 |
| Abrir modal de repuesto | ≤ 20 |
| “Cargar más” | ≤ 100 |
| Reporte “hoy” | ≤ 55 |
| Reporte de mes pasado | ≤ 32 |
| Cerrar y abrir sesión al día siguiente | ≤ 500 |

### 10.3 Pruebas automáticas

Script de Playwright (o Cypress) que:
1. Hace login.
2. Navega todas las pantallas.
3. Vuelve a navegar.
4. Lee `window.__reads.total` y **falla si > 0** en la segunda pasada.
5. Recarga y falla si > 550.

### 10.4 Consola de Firebase

- Firestore → Usage → filtrar por colección; comparar el mismo día de la semana antes/después.
- Crear una alerta de presupuesto/uso (p. ej. > 100.000 lecturas/día) para detectar regresiones.

### 10.5 Matriz de dispositivos

- Tablet Android del POS (2 GB RAM): verificar LRU y memoria.
- iPhone/Safari: la caché persistente se puede desalojar a los 7 días sin uso → probar “primera carga tras 10 días”.
- Dos pestañas abiertas: verificar que la segunda no duplica lecturas.
- Modo avión: POS debe vender con lo cacheado y encolar.

---

## 11. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Producto fuera de la página 1 se vende con costo 0 | Alta | **Alto** (utilidad falsa) | merge al catálogo + `costPrice` congelado en el ítem + prueba de aceptación 2.8 |
| Búsqueda por tokens no encuentra algo que el filtro “contains” sí encontraba | Media | Medio | tokens de prefijos + fallback “buscar en todo el catálogo” explícito (con aviso de coste) |
| Índices aún construyendo | Media | Alto | desplegar índices 24 h antes; fallback con aviso; bandera apagada |
| Reportes históricos cambian de número | Media | Alto | reconciliación contra el método viejo para 90 días; comunicar que **antes estaban mal** |
| Stock viejo en POS | Media | Alto | TTL 60 s para productos en carrito + validación en checkout + botón “actualizar stock” |
| Offline con catálogo parcial | Media | Medio | banner “catálogo parcial”; permitir vender solo lo cacheado; cola offline ya existe |
| Crecimiento del doc de stats (items) | Baja | Medio | tope de 2.000 SKU/mes; si se supera, mover el desglose a BigQuery |
| Escrituras concurrentes al mismo doc de stats | Baja | Bajo | 1 escritura/s por doc; fragmentar por shard si hay muchas cajas |
| Deriva de `increment` | Media | Bajo | reconciliación mensual + `updatedAt` visible |
| Datos del usuario anterior en IndexedDB | Media | Medio | botón “limpiar datos locales” al cerrar sesión en equipos compartidos |
| Complejidad percibida por el equipo | Media | Medio | hooks encapsulados, una sola forma de leer datos, documentación de 1 página |

---

## 12. Anexos (código listo para copiar)

> Todo el código asume los tipos existentes en `src/lib/types.ts` y el SDK modular de Firebase 11.

### A. `src/lib/firestore/cache-policy.ts`

```ts
import type { WhereFilterOp } from 'firebase/firestore';

export type QueryFilter = [field: string, op: WhereFilterOp, value: unknown];

export const TTL_MS: Record<string, number> = {
  products: 10 * 60_000,
  repair_jobs: 3 * 60_000,
  sale_transactions: 5 * 60_000,
  fiados: 5 * 60_000,
  expenses: 10 * 60_000,
  held_sales: 60_000,
  currency_exchanges: 10 * 60_000,
  daily_reconciliations: 10 * 60_000,
};

export const ttlFor = (collectionName: string) => TTL_MS[collectionName] ?? 5 * 60_000;

export function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (typeof value === 'object' && 'seconds' in (value as any)) {
    const ts = value as { seconds: number; nanoseconds?: number };
    return `ts:${ts.seconds}:${ts.nanoseconds ?? 0}`;
  }
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(',')}]`;
  return `${typeof value}:${String(value)}`;
}

export function buildQueryKey(
  uid: string,
  collectionName: string,
  opts: {
    filters?: QueryFilter[];
    orderField?: string;
    orderDir?: 'asc' | 'desc';
    pageSize?: number;
    search?: string;
  } = {},
): string {
  const filters = (opts.filters ?? [])
    .map(([field, op, value]) => `${field}${op}${serializeValue(value)}`)
    .sort()
    .join('&');

  return [
    `u:${uid}`,
    `c:${collectionName}`,
    `f:${filters || '-'}`,
    `o:${opts.orderField ?? '__name__'}:${opts.orderDir ?? 'asc'}`,
    `l:${opts.pageSize ?? 0}`,
    `s:${opts.search ?? '-'}`,
  ].join('|');
}

const SYNC_PREFIX = 'fsq:sync:';

export function getLastSync(key: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(SYNC_PREFIX + key);
  return raw ? Number(raw) || 0 : 0;
}

export function setLastSync(key: string, at = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SYNC_PREFIX + key, String(at));
  } catch {
    /* cuota llena: se ignora */
  }
}

export function isSyncFresh(key: string, ttlMs: number): boolean {
  return Date.now() - getLastSync(key) < ttlMs;
}

export function clearSync(key?: string): void {
  if (typeof window === 'undefined') return;
  if (key) {
    window.localStorage.removeItem(SYNC_PREFIX + key);
    return;
  }
  Object.keys(window.localStorage)
    .filter((k) => k.startsWith(SYNC_PREFIX))
    .forEach((k) => window.localStorage.removeItem(k));
}
```

### B. `src/lib/firestore/query-cache.ts`

```ts
import type { DocumentSnapshot } from 'firebase/firestore';
import { clearSync } from './cache-policy';

export type WithId<T> = T & { id: string };

export type CacheEntry<T> = {
  items: WithId<T>[];
  ids: Set<string>;
  cursor: DocumentSnapshot | null;
  hasMore: boolean;
  source: 'server' | 'cache';
  /** última vez que el servidor confirmó esta consulta */
  serverSyncedAt: number;
  /** última vez que se cargó en RAM (para no repetir ni el hit de IndexedDB) */
  fetchedAt: number;
};

class QueryCache {
  private map = new Map<string, CacheEntry<any>>();
  private listeners = new Set<() => void>();

  constructor(private readonly maxEntries = 80) {}

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  get<T>(key: string): CacheEntry<T> | undefined {
    return this.map.get(key);
  }

  set<T>(key: string, entry: CacheEntry<T>): void {
    this.map.set(key, entry);
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest) {
        this.map.delete(oldest);
        clearSync(oldest);
      }
    }
    this.emit();
  }

  delete(key: string): void {
    this.map.delete(key);
    clearSync(key);
    this.emit();
  }

  private keysFor(uid: string, collectionName: string): string[] {
    const prefix = `u:${uid}|c:${collectionName}|`;
    return Array.from(this.map.keys()).filter((k) => k.startsWith(prefix));
  }

  invalidateCollection(uid: string, collectionName: string): void {
    const keys = this.keysFor(uid, collectionName);
    if (!keys.length) return;
    keys.forEach((k) => {
      this.map.delete(k);
      clearSync(k);
    });
    this.emit();
  }

  /** Actualiza un documento en todas las listas que ya lo contienen (sin leer). */
  patchItem<T>(uid: string, collectionName: string, id: string, patch: Partial<T>): void {
    let changed = false;
    for (const key of this.keysFor(uid, collectionName)) {
      const entry = this.map.get(key);
      if (!entry) continue;
      const index = entry.items.findIndex((i) => i.id === id);
      if (index === -1) continue;
      const items = entry.items.slice();
      items[index] = { ...items[index], ...patch };
      this.map.set(key, { ...entry, items });
      changed = true;
    }
    if (changed) this.emit();
  }

  /**
   * Une resultados de búsqueda al catálogo ya cacheado.
   * Imprescindible para que el costo/stock de un producto buscado esté disponible.
   */
  mergeIntoCatalog<T>(uid: string, collectionName: string, incoming: WithId<T>[]): void {
    if (!incoming.length) return;
    let changed = false;
    for (const key of this.keysFor(uid, collectionName)) {
      const entry = this.map.get(key);
      if (!entry) continue;
      const fresh = incoming.filter((item) => !entry.ids.has(item.id));
      if (!fresh.length) continue;
      const items = [...fresh, ...entry.items];
      this.map.set(key, {
        ...entry,
        items,
        ids: new Set(items.map((i) => i.id)),
      });
      changed = true;
    }
    if (changed) this.emit();
  }
}

export const queryCache = new QueryCache();
```

### C. `src/lib/firestore/use-paged-query.ts`

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  collection,
  getDocs,
  getDocsFromCache,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryConstraint,
} from 'firebase/firestore';
import { useFirebase } from '@/firebase/provider';
import {
  buildQueryKey,
  getLastSync,
  serializeValue,
  setLastSync,
  ttlFor,
  type QueryFilter,
} from './cache-policy';
import { queryCache, type CacheEntry, type WithId } from './query-cache';
import { countServerReads } from './read-meter';

const RAM_TTL_MS = 5 * 60_000;
const inflight = new Map<string, Promise<void>>();

export type PagedQueryOptions<T> = {
  collectionName: string;
  filters?: QueryFilter[];
  orderField?: string;
  orderDir?: 'asc' | 'desc';
  pageSize?: number;
  enabled?: boolean;
  ttlMs?: number;
  cacheOnly?: boolean;
  mapDoc?: (data: DocumentData, id: string) => WithId<T>;
};

const defaultMapDoc = (data: DocumentData, id: string) =>
  ({ ...(data as Record<string, unknown>), id }) as WithId<any>;

const EMPTY: WithId<never>[] = [];

export function usePagedQuery<T>(opts: PagedQueryOptions<T>) {
  const { firestore, user } = useFirebase();
  const uid = user?.uid ?? '';
  const pageSize = opts.pageSize ?? 100;
  const ttlMs = opts.ttlMs ?? ttlFor(opts.collectionName);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const filtersSig = (opts.filters ?? [])
    .map(([f, op, v]) => `${f}:${op}:${serializeValue(v)}`)
    .join('&');

  const key = useMemo(
    () =>
      buildQueryKey(uid, opts.collectionName, {
        filters: opts.filters,
        orderField: opts.orderField,
        orderDir: opts.orderDir,
        pageSize,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, opts.collectionName, filtersSig, opts.orderField, opts.orderDir, pageSize],
  );

  const entry = useSyncExternalStore(
    queryCache.subscribe,
    () => queryCache.get<T>(key),
    () => undefined,
  );

  const entryRef = useRef<CacheEntry<T> | undefined>(entry);
  entryRef.current = entry;

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [needsIndex, setNeedsIndex] = useState(false);

  const makeQuery = useCallback(
    (cursor: DocumentSnapshot | null) => {
      if (!firestore || !uid) return null;
      const constraints: QueryConstraint[] = [];
      for (const [field, op, value] of optsRef.current.filters ?? []) {
        constraints.push(where(field, op, value));
      }
      if (optsRef.current.orderField) {
        constraints.push(orderBy(optsRef.current.orderField, optsRef.current.orderDir ?? 'asc'));
      }
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(pageSize));
      return query(
        collection(firestore, 'users', uid, optsRef.current.collectionName),
        ...constraints,
      );
    },
    [firestore, uid, pageSize],
  );

  const run = useCallback(
    async (mode: 'auto' | 'server'): Promise<void> => {
      if (!firestore || !uid || optsRef.current.enabled === false) return;

      const current = entryRef.current;
      if (mode === 'auto' && current && Date.now() - current.fetchedAt < RAM_TTL_MS) return;

      const existing = inflight.get(key);
      if (existing) return existing;

      const task = (async () => {
        setLoading(true);
        setError(null);
        setNeedsIndex(false);

        const q = makeQuery(null);
        if (!q) {
          setLoading(false);
          return;
        }

        const mapDoc = (data: DocumentData, id: string) =>
          (optsRef.current.mapDoc ?? defaultMapDoc)(data, id) as WithId<T>;

        const online = typeof navigator === 'undefined' ? true : navigator.onLine;
        const now = Date.now();
        let items: WithId<T>[] = [];
        let cursor: DocumentSnapshot | null = null;
        let fromServer = false;

        if (mode === 'auto') {
          try {
            const cached = await getDocsFromCache(q);
            if (!cached.empty) {
              items = cached.docs.map((d) => mapDoc(d.data(), d.id));
              cursor = cached.docs[cached.docs.length - 1] ?? null;
            }
          } catch {
            /* sin caché local */
          }
        }

        const lastSync = Math.max(current?.serverSyncedAt ?? 0, getLastSync(key));
        const stale = now - lastSync > ttlMs;
        const mustHitServer =
          online &&
          !optsRef.current.cacheOnly &&
          (mode === 'server' || stale || items.length === 0);

        if (mustHitServer) {
          try {
            const snap = await getDocs(q);
            countServerReads(snap.docs.length || 1);
            items = snap.docs.map((d) => mapDoc(d.data(), d.id));
            cursor = snap.docs[snap.docs.length - 1] ?? null;
            fromServer = true;
            setLastSync(key);
          } catch (e: any) {
            if (e?.code === 'failed-precondition') setNeedsIndex(true);
            if (!items.length) setError(e instanceof Error ? e : new Error(String(e)));
          }
        }

        const serverSyncedAt = fromServer
          ? Date.now()
          : Math.max(current?.serverSyncedAt ?? 0, getLastSync(key));

        queryCache.set<T>(key, {
          items,
          ids: new Set(items.map((i) => i.id)),
          cursor,
          hasMore: items.length >= pageSize,
          source: fromServer ? 'server' : 'cache',
          serverSyncedAt,
          fetchedAt: Date.now(),
        });

        setLoading(false);
      })();

      inflight.set(key, task);
      try {
        await task;
      } finally {
        inflight.delete(key);
      }
    },
    [firestore, uid, key, makeQuery, pageSize, ttlMs],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    const current = entryRef.current;
    if (!firestore || !uid || !current || !current.hasMore || loadingMore) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    // Un cursor de IndexedDB no garantiza continuidad con el servidor:
    // primera pasada sincroniza, la siguiente pagina.
    if (current.source !== 'server' || !current.cursor) {
      await run('server');
      return;
    }

    setLoadingMore(true);
    try {
      const q = makeQuery(current.cursor);
      if (!q) return;

      const snap = await getDocs(q);
      countServerReads(snap.docs.length || 1);

      const mapDoc = (data: DocumentData, id: string) =>
        (optsRef.current.mapDoc ?? defaultMapDoc)(data, id) as WithId<T>;

      const incoming = snap.docs
        .map((d) => mapDoc(d.data(), d.id))
        .filter((i) => !current.ids.has(i.id));

      const items = [...current.items, ...incoming];

      queryCache.set<T>(key, {
        ...current,
        items,
        ids: new Set(items.map((i) => i.id)),
        cursor: snap.docs[snap.docs.length - 1] ?? current.cursor,
        hasMore: snap.docs.length >= pageSize,
        serverSyncedAt: Date.now(),
        fetchedAt: Date.now(),
      });
      setLastSync(key);
    } catch (e: any) {
      if (e?.code === 'failed-precondition') setNeedsIndex(true);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoadingMore(false);
    }
  }, [firestore, uid, key, makeQuery, pageSize, run, loadingMore]);

  useEffect(() => {
    void run('auto');
  }, [run]);

  return {
    items: entry?.items ?? (EMPTY as WithId<T>[]),
    isLoading: loading && !entry,
    isFetching: loading,
    isLoadingMore: loadingMore,
    hasMore: entry?.hasMore ?? false,
    fromCache: entry?.source === 'cache',
    error,
    needsIndex,
    reload: () => run('server'),
    loadMore,
  };
}
```

### D. `src/lib/firestore/use-server-search.ts`

```ts
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase/provider';
import { buildQueryKey, serializeValue, type QueryFilter } from './cache-policy';
import { queryCache, type WithId } from './query-cache';
import { countServerReads } from './read-meter';
import { normalizeText } from '@/lib/search-index';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;

export type ServerSearchOptions<T> = {
  collectionName: string;
  term: string;
  orderField: string;
  orderDir?: 'asc' | 'desc';
  pageSize?: number;
  enabled?: boolean;
  tokensField?: string;
  /** filtros de igualdad aplicados junto a la búsqueda (p. ej. isDeleted == false) */
  filters?: QueryFilter[];
  /** callback para fusionar los resultados en otra caché (p. ej. el catálogo) */
  onResults?: (items: WithId<T>[]) => void;
};

export function useServerSearch<T>(opts: ServerSearchOptions<T>) {
  const { firestore, user } = useFirebase();
  const uid = user?.uid ?? '';
  const pageSize = opts.pageSize ?? 20;
  const tokensField = opts.tokensField ?? 'searchTokens';

  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<WithId<T>[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const filtersRef = useRef(opts.filters);
  filtersRef.current = opts.filters;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalizeText(opts.term)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [opts.term]);

  const lastToken = debounced.split(' ').filter(Boolean).pop() ?? '';
  const enabled = opts.enabled !== false && lastToken.length >= MIN_CHARS;
  const filtersSig = (opts.filters ?? [])
    .map(([f, op, v]) => `${f}:${op}:${serializeValue(v)}`)
    .join('&');

  const key = useMemo(
    () =>
      buildQueryKey(uid, opts.collectionName, {
        filters: opts.filters,
        orderField: opts.orderField,
        orderDir: opts.orderDir,
        pageSize,
        search: lastToken,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, opts.collectionName, opts.orderField, opts.orderDir, pageSize, lastToken, filtersSig],
  );

  useEffect(() => {
    if (!firestore || !uid || !enabled) {
      setItems([]);
      setIsSearching(false);
      return;
    }

    // Repetir la misma búsqueda no cuesta lecturas.
    const cached = queryCache.get<T>(key);
    if (cached) {
      setItems(cached.items);
      setIsSearching(false);
      opts.onResults?.(cached.items);
      return;
    }

    const myGeneration = ++generation.current;
    setIsSearching(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const constraints = (filtersRef.current ?? []).map(([field, op, value]) =>
          where(field, op, value),
        );
        const q = query(
          collection(firestore, 'users', uid, opts.collectionName),
          ...constraints,
          where(tokensField, 'array-contains', lastToken),
          orderBy(opts.orderField, opts.orderDir ?? 'desc'),
          limit(pageSize),
        );
        const snap = await getDocs(q);
        countServerReads(snap.docs.length || 1);
        if (myGeneration !== generation.current) return;

        const list = snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })) as WithId<T>[];
        setItems(list);
        opts.onResults?.(list);

        queryCache.set<T>(key, {
          items: list,
          ids: new Set(list.map((i) => i.id)),
          cursor: snap.docs[snap.docs.length - 1] ?? null,
          hasMore: false,
          source: 'server',
          serverSyncedAt: Date.now(),
          fetchedAt: Date.now(),
        });
      } catch (e: any) {
        if (myGeneration === generation.current) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (myGeneration === generation.current) setIsSearching(false);
      }
    }, 0);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, uid, enabled, key, lastToken, pageSize, tokensField]);

  return {
    items,
    isSearching,
    error,
    isTooShort: normalizeText(opts.term).length > 0 && lastToken.length < MIN_CHARS,
  };
}
```

### E. `src/lib/search-index.ts`

```ts
const MARKS = /[\u0300-\u036f]/g;
const SEPARATORS = /[^a-z0-9]+/g;
const MAX_TOKENS = 60;

export function normalizeText(input: string | undefined | null): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Genera tokens de búsqueda por prefijos.
 * "Batería iPhone" -> ba, bat, bate, bater, bateri, bateria, ip, iph, ...
 */
export function buildSearchTokens(
  inputs: Array<string | string[] | undefined | null>,
  options: { min?: number; max?: number } = {},
): string[] {
  const min = options.min ?? 2;
  const max = options.max ?? 16;
  const tokens = new Set<string>();

  for (const input of inputs) {
    if (!input) continue;
    const text = normalizeText(Array.isArray(input) ? input.join(' ') : input);
    if (!text) continue;

    for (const word of text.split(' ')) {
      if (!word) continue;
      const limitTo = Math.min(word.length, max);
      for (let length = min; length <= limitTo; length++) {
        tokens.add(word.slice(0, length));
      }
      tokens.add(word);
      if (tokens.size >= MAX_TOKENS) return Array.from(tokens).slice(0, MAX_TOKENS);
    }
  }

  return Array.from(tokens);
}

export function lastTokenOf(term: string): string {
  return normalizeText(term).split(' ').filter(Boolean).pop() ?? '';
}
```

### F. `src/lib/firestore/rollups.ts`

```ts
import { doc, increment, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { Expense, Fiado, Product, RepairJob, Sale } from '@/lib/types';

export const monthKey = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const dayKey = (date = new Date()): string =>
  `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;

export const overviewRef = (db: Firestore, uid: string) => doc(db, 'users', uid, 'stats', 'overview');
export const monthlyRef = (db: Firestore, uid: string, month = monthKey()) =>
  doc(db, 'users', uid, 'stats_monthly', month);
export const dailyRef = (db: Firestore, uid: string, day = dayKey()) =>
  doc(db, 'users', uid, 'stats_daily', day);

const METHOD_KEYS: Record<string, string> = {
  'Efectivo USD': 'cashUSD',
  'Efectivo Bs': 'cashBs',
  Tarjeta: 'card',
  'Pago Móvil': 'mobile',
  'Tarjeta / Pago Móvil': 'mobile',
  Transferencia: 'transfer',
  'USDT / Crypto': 'crypto',
};

const methodKey = (method: string) => METHOD_KEYS[method] ?? 'other';
const safeFieldKey = (id: string) => id.replace(/[.~*/[\]\s]/g, '_');

export type StatsWrites = {
  monthly: Record<string, unknown>;
  daily: Record<string, unknown>;
};

/**
 * Payload de una venta. Multiplicador -1 para reembolsos.
 * Todos los campos son transformaciones atómicas: 0 lecturas.
 */
export function saleStatsWrites(sale: Sale, sign: 1 | -1 = 1): StatsWrites {
  const revenue = (sale.actualPaidAmount ?? sale.totalAmount ?? 0) * sign;
  const cost =
    sale.items.reduce(
      (sum, item) => sum + (item.costPrice ?? item.customCostPrice ?? 0) * item.quantity,
      0,
    ) * sign;
  const profit = revenue - cost;

  const monthly: Record<string, unknown> = {
    salesUSD: increment(revenue),
    salesCount: increment(1 * sign),
    costUSD: increment(cost),
    profitUSD: increment(profit),
    updatedAt: serverTimestamp(),
  };

  const daily: Record<string, unknown> = { ...monthly };

  for (const payment of sale.payments ?? []) {
    const field = `byMethod.${methodKey(payment.method)}`;
    monthly[field] = increment(payment.amount * sign);
    daily[field] = increment(payment.amount * sign);
  }

  const day = dayKey(new Date(sale.transactionDate));
  monthly[`byDay.${day.slice(8, 10)}.salesUSD`] = increment(revenue);
  monthly[`byDay.${day.slice(8, 10)}.profitUSD`] = increment(profit);
  monthly[`byDay.${day.slice(8, 10)}.count`] = increment(1 * sign);

  for (const item of sale.items) {
    if (item.isCustom || !item.productId) continue;
    const key = safeFieldKey(item.productId);
    daily[`items.${key}.n`] = item.name;
    daily[`items.${key}.q`] = increment(item.quantity * sign);
    daily[`items.${key}.rev`] = increment(item.price * item.quantity * sign);
    daily[`items.${key}.cost`] = increment((item.costPrice ?? 0) * item.quantity * sign);
  }

  return { monthly, daily };
}

export function expenseStatsWrites(expense: Expense, sign: 1 | -1 = 1): StatsWrites {
  const amount = (expense.amountUSD ?? 0) * sign;
  const base = {
    expensesUSD: increment(amount),
    updatedAt: serverTimestamp(),
  };
  return { monthly: { ...base }, daily: { ...base } };
}

/** Se llama al crear/abonar/eliminar un fiado, con el saldo pendiente antes y después. */
export function fiadoOverviewWrites(prevPending: number, nextPending: number) {
  return {
    'fiados.pendingAmount': increment(nextPending - prevPending),
    'fiados.pendingCount': increment((nextPending > 0 ? 1 : 0) - (prevPending > 0 ? 1 : 0)),
    updatedAt: serverTimestamp(),
  };
}

/** Se llama al cambiar el estado de una reparación. */
export function repairOverviewWrites(wasOpen: boolean, isOpen: boolean) {
  return {
    'repairs.open': increment((isOpen ? 1 : 0) - (wasOpen ? 1 : 0)),
    updatedAt: serverTimestamp(),
  };
}

/** Delta de inventario calculado con datos ya en memoria (0 lecturas). */
export function inventoryDeltaWrites(prev: Product | null, next: Product | null, finalPrice: (p: Product) => number) {
  const deltaItems = (next ? 1 : 0) - (prev ? 1 : 0);
  const prevUnits = prev ? Math.max(0, prev.stockLevel - (prev.reservedStock || 0)) : 0;
  const nextUnits = next ? Math.max(0, next.stockLevel - (next.reservedStock || 0)) : 0;
  const prevCost = prev ? (prev.costPrice || 0) * prevUnits : 0;
  const nextCost = next ? (next.costPrice || 0) * nextUnits : 0;
  const prevRetail = prev ? finalPrice(prev) * prevUnits : 0;
  const nextRetail = next ? finalPrice(next) * nextUnits : 0;

  return {
    'inventory.items': increment(deltaItems),
    'inventory.units': increment(nextUnits - prevUnits),
    'inventory.costUSD': increment(nextCost - prevCost),
    'inventory.retailUSD': increment(nextRetail - prevRetail),
    'inventory.lowStock': increment(
      (next && next.stockLevel <= (next.lowStockThreshold || 3) ? 1 : 0) -
        (prev && prev.stockLevel <= (prev.lowStockThreshold || 3) ? 1 : 0),
    ),
    'inventory.outOfStock': increment(
      (next && next.stockLevel <= 0 ? 1 : 0) - (prev && prev.stockLevel <= 0 ? 1 : 0),
    ),
    updatedAt: serverTimestamp(),
  };
}
```

### G. `src/lib/firestore/read-meter.ts` + pastilla

```ts
// read-meter.ts
type Snapshot = { total: number; byKey: Record<string, number> };

let total = 0;
const byKey: Record<string, number> = {};

export function countServerReads(count: number, label = 'query'): void {
  total += count;
  byKey[label] = (byKey[label] ?? 0) + count;
  if (typeof window !== 'undefined' && (window as any).__MM_READS_DEBUG) {
    console.debug(`[reads] +${count} (${label}) → ${total}`);
  }
}

export function readSnapshot(): Snapshot {
  return { total, byKey: { ...byKey } };
}

export function resetReads(): void {
  total = 0;
  Object.keys(byKey).forEach((k) => delete byKey[k]);
}

if (typeof window !== 'undefined') {
  (window as any).__reads = { snapshot: readSnapshot, reset: resetReads };
}
```

```tsx
// src/components/debug/read-meter-pill.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { readSnapshot } from '@/lib/firestore/read-meter';

export function ReadMeterPill() {
  const params = useSearchParams();
  const enabled = params.get('reads') === '1';
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTotal(readSnapshot().total), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[9999] rounded-full bg-slate-900 text-white px-3 py-1.5 text-[11px] font-mono shadow-lg">
      lecturas: {total}
    </div>
  );
}
```

### H. `firestore.indexes.json`

```json
{
  "indexes": [
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "name", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "name", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "salesCount", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "products",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isDeleted", "order": "ASCENDING" },
        { "fieldPath": "searchTokens", "arrayConfig": "CONTAINS" },
        { "fieldPath": "name", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "repair_jobs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "repair_jobs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isPaid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "repair_jobs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "searchTokens", "arrayConfig": "CONTAINS" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "sale_transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "customerID", "order": "ASCENDING" },
        { "fieldPath": "transactionDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "sale_transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "paymentMethods", "arrayConfig": "CONTAINS" },
        { "fieldPath": "transactionDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "fiados",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

### I. `firestore.rules` (reemplazo)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    // Custom claim: 0 lecturas por evaluación (antes: exists() = 1 lectura).
    function isAdmin() {
      return isSignedIn() && request.auth.token.admin == true;
    }

    match /roles_admin/{adminId} {
      // Solo el propio admin puede consultar su registro (para migración).
      allow get: if isOwner(adminId);
      allow read, write: if false;
    }

    match /system/{doc=**} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    match /users/{userId} {
      allow get: if isOwner(userId) || isAdmin();
      // Nadie lista todos los usuarios desde el cliente.
      allow list: if isAdmin();
      allow create: if isOwner(userId);
      allow update, delete: if isOwner(userId) || isAdmin();

      match /{allData=**} {
        allow read: if isOwner(userId) || isAdmin();
        allow write: if isOwner(userId) || isAdmin();
      }
    }
  }
}
```

### J. `scripts/backfill.mjs`

```js
// Uso:
//   npm i -D firebase-admin
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill.mjs --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill.mjs
// Requiere el SDK de Admin (no está en package.json todavía).
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry-run');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const MARKS = /[\u0300-\u036f]/g;
const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function tokens(inputs, max = 60) {
  const out = new Set();
  for (const input of inputs) {
    for (const word of normalize(input).split(' ')) {
      if (!word) continue;
      for (let i = 2; i <= Math.min(word.length, 16); i++) out.add(word.slice(0, i));
      out.add(word);
      if (out.size >= max) return Array.from(out).slice(0, max);
    }
  }
  return Array.from(out);
}

async function main() {
  const usersSnap = await db.collection('users').get();
  let products = 0;
  let repairs = 0;
  let sales = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const base = db.collection('users').doc(uid);

    // 1. Productos: tokens + campos que faltan
    const productsSnap = await base.collection('products').get();
    for (let i = 0; i < productsSnap.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of productsSnap.docs.slice(i, i + 400)) {
        const p = doc.data();
        batch.update(doc.ref, {
          isDeleted: p.isDeleted ?? false,
          salesCount: p.salesCount ?? 0,
          searchName: normalize(p.name),
          searchTokens: tokens([
            p.name,
            p.sku,
            p.barcode,
            p.category,
            ...(p.compatibleModels ?? []),
            ...(p.searchKeywords ?? []),
          ]),
          searchVersion: 1,
        });
        products++;
      }
      if (!DRY_RUN) await batch.commit();
    }

    // 2. Reparaciones
    const repairsSnap = await base.collection('repair_jobs').get();
    for (let i = 0; i < repairsSnap.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of repairsSnap.docs.slice(i, i + 400)) {
        const r = doc.data();
        batch.update(doc.ref, {
          searchTokens: tokens([
            r.customerName,
            r.customerID,
            r.customerPhone,
            r.deviceMake,
            r.deviceModel,
            r.reportedIssue,
          ]),
          searchVersion: 1,
        });
        repairs++;
      }
      if (!DRY_RUN) await batch.commit();
    }

    // 3. Stats de ventas de los últimos 90 días
    const from = new Date(Date.now() - 90 * 86400000).toISOString();
    const salesSnap = await base
      .collection('sale_transactions')
      .where('transactionDate', '>=', from)
      .get();
    sales += salesSnap.size;

    console.log(
      `[${uid}] productos: ${productsSnap.size} · reparaciones: ${repairsSnap.size} · ventas 90d: ${salesSnap.size}`,
    );
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}productos: ${products}, reparaciones: ${repairs}, ventas: ${sales}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

> El backfill de ventas debe usar la misma lógica de `saleStatsWrites` (Anexo F) para reconstruir `stats_daily` y `stats_monthly`; se omite por brevedad, pero es un `batch.set(..., { merge: true })` por día.

### K. Checklist de despliegue

- [ ] Backup lógico: exportar Firestore (`gcloud firestore export`).
- [ ] Crear `firebase.json` + `firestore.indexes.json`.
- [ ] `firebase deploy --only firestore:indexes` y esperar estado **READY**.
- [ ] Correr `backfill.mjs --dry-run` y revisar conteos.
- [ ] Correr backfill real en horario de baja actividad.
- [ ] Setear custom claims de admin y verificar en staging.
- [ ] Desplegar reglas.
- [ ] Desplegar código con `pagedData=false` (no-op).
- [ ] Activar bandera en cuenta interna → QA con `?reads=1`.
- [ ] Piloto 3 negocios (1 semana) → medir lecturas/día.
- [ ] 25 % → 100 %.
- [ ] Borrar código viejo (Fase 5) y añadir alerta de presupuesto.

---

## 13. Conclusión

El sistema no tiene un problema de “comodines”: tiene un problema de **arquitectura de lectura**. Hoy cada pantalla intenta tener el universo completo en memoria y el caché no tiene política. La solución no es un parche de `limit`, es un **contrato de datos**: una página por pantalla, búsqueda en servidor, agregados precalculados y una caché con TTL, invalidación y medición.

Con las fases 0–4 (≈ 3 semanas de trabajo efectivo, sin downtime y con rollout por banderas) el sistema pasa de **~3.300 lecturas por sesión a ~500 la primera vez y 0 en las revisitas**, deja de agotar cuotas y, sobre todo, **empieza a mostrar números correctos** en los reportes históricos.

