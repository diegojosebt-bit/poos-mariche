# Fase 2 (parte 1) — Motor de datos: caché, paginación y búsqueda

| | |
|---|---|
| **Fecha** | 2026-11-03 |
| **Estado** | Motor implementado y verificado (`tsc` 0 errores + pruebas de funciones puras). **Las pantallas todavía no están cableadas.** |
| **Cambios visibles** | Ninguno todavía (los hooks no se usan en ninguna página). |
| **Prerrequisito** | Índices desplegados (Fase 0) y `scripts/backfill.mjs` ejecutado para la búsqueda. |

---

## 1. Archivos nuevos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/search-index.ts` | `normalizeText`, `buildSearchTokens` (prefijos 2–16, tope 60) y `lastTokenOf` |
| `src/lib/firestore/query-cache.ts` | Caché RAM con LRU de 80 entradas, TTL por entrada, invalidación por colección, `patchItem`, `removeItem`, `mergeIntoCatalog` |
| `src/lib/firestore/use-paged-query.ts` | Lectura paginada por cursor, cache-first, revalidación por TTL, `loadMore()` |
| `src/lib/firestore/use-server-search.ts` | Búsqueda `array-contains` con debounce 350 ms, cancelación por generación y caché de resultados |
| `src/lib/firestore/fetch-by-ids.ts` | Trae por id (≤30) productos fuera de la página y los fusiona a la caché |

Se apoyan en lo ya creado en Fase 0: `cache-policy.ts` (claves/TTL/sync) y `read-meter.ts` (medición).

---

## 2. Cómo resuelve una lectura

```
usePagedQuery(...)
      │
      ├─ ¿RAM fresca (< 5 min)? ──────────────► devuelve, 0 lecturas, 0 IndexedDB
      │
      ├─ getDocsFromCache(query) ─────────────► pinta desde IndexedDB, 0 lecturas facturadas
      │      └─ ¿hace más de TTL que el servidor confirmó?
      │             └─ getDocs(query) ────────► 1 lectura por documento (máx. pageSize)
      │
      └─ loadMore() ─► startAfter(cursor) + limit ─► +pageSize lecturas, sin releer
```

Detalles que evitan fugas:

- **Clave determinista** (`u:uid|c:colección|f:filtros|o:orden|l:límite`): dos consultas distintas nunca comparten caché.
- **`fetchedAt` vs `serverSyncedAt`**: lo que vino de IndexedDB no se marca como “fresco”; se revalida una vez por ventana de TTL, no por navegación.
- **Deduplicación en vuelo**: dos componentes que piden lo mismo comparten una sola promesa.
- **`loadMore` con cursor local**: si la página 1 vino de IndexedDB, primero sincroniza con el servidor y luego pagina en la misma pulsación (el cursor local no garantiza continuidad).
- **Búsquedas cacheadas**: repetir la misma búsqueda no consulta el servidor.

---

## 3. Coste por operación

| Operación | Lecturas |
|---|---:|
| Primera página de 100 | ≤ 100 |
| Navegar a la misma pantalla en < 5 min | 0 |
| Recargar (F5) dentro del TTL | 0 |
| “Cargar más” | ≤ 100 |
| Búsqueda (3+ caracteres) | ≤ 20 |
| Repetir la misma búsqueda | 0 |
| Resultado vacío | 1 |

---

## 4. Uso previsto (así se cablearán las pantallas)

### Productos / Inventario

```tsx
const catalog = usePagedQuery<Product>({
  collectionName: 'products',
  orderField: 'name',
  orderDir: 'asc',
  pageSize: 100,
});

const search = useServerSearch<Product>({
  collectionName: 'products',
  term: searchTerm,
  orderField: 'name',
  orderDir: 'asc',
  filters: [['isDeleted', '==', false]],   // tras el backfill
  onResults: (found) => queryCache.mergeIntoCatalog(uid, 'products', found),
});
```

### Reparaciones

```tsx
const repairs = usePagedQuery<RepairJob>({
  collectionName: 'repair_jobs',
  orderField: 'createdAt',
  orderDir: 'desc',
  pageSize: 100,
});
```

### Actualizaciones optimistas (sustituyen a `mutate`)

```ts
queryCache.patchItem(uid, 'products', product.id!, product);       // editar
queryCache.removeItem(uid, 'products', productId);                  // borrar
queryCache.mergeIntoCatalog(uid, 'products', [newProduct]);         // crear / resultados de búsqueda
queryCache.invalidateCollection(uid, 'products');                   // tras importación masiva
```

---

## 5. Reglas de integridad (obligatorias al cablear)

1. **Todo resultado de búsqueda se fusiona al catálogo** (`mergeIntoCatalog`). Si no, un producto buscado no está en RAM y la venta se registra con **costo 0** (utilidad falsa).
2. **Al añadir al carrito, congelar `costPrice`** en el ítem (ya se hace al cobrar; debe hacerse al añadir).
3. **Combos**: si un componente no está en caché, leerlo por id (`getDoc`, 1 lectura) antes de calcular stock; nunca asumir 0 en silencio.
4. **Fallback de búsqueda mientras no haya backfill**: si `searchTokens` no existe, `useServerSearch` devolverá 0 resultados. La pantalla debe caer al filtro local sobre la página cargada (comportamiento actual) y ofrecer “Cargar más”, no una pantalla vacía.
5. **No habilitar el filtro `isDeleted == false`** hasta que el backfill cubra el 100 %; si no, los productos sin el campo desaparecen de la consulta.

---

## 6. Verificación ejecutada

```
tsc --noEmit                      → exit 0 (todo el proyecto, incluye el cableado beta de Inventario)
node .tmp-test/check.js           → OK
```

Las pruebas cubren:

- `normalizeText` con acentos y espacios.
- Tokens por prefijo (`bater`, `bateria`, `iphone`, `11`, `sku`), sin duplicados y ≤ 60.
- `lastTokenOf` para “bateria iphone” → `iphone`.
- **Serialización de Timestamps**: dos `seconds` distintos producen strings distintos (el bug que hacía colisionar dos rangos de fecha).
- **Claves de caché**: distinto filtro, colección, usuario y límite ⇒ claves distintas; misma consulta ⇒ misma clave.

---

## 7. Estado del cableado

| Pantalla | Estado | Cómo probar |
|---|---|---|
| **Inventario** | ✅ beta con bandera | `/dashboard/inventory?ff=pagedData,serverSearch` |
| **POS** | ✅ beta con bandera | `/dashboard/pos?ff=pagedData,serverSearch` |
| **Reparaciones** | ✅ beta con bandera | `/dashboard/repairs?ff=pagedData,serverSearch` |
| **Fiados / Gastos** | ⏳ pendiente | — |
| **Búsqueda en servidor** | ✅ cableada (requiere backfill) | ver 7.1 |
| **Stats (Fase 1)** | ⏳ pendiente | se cablea con Reportes/Dashboard |

### 7.1 Búsqueda en servidor: requisito y comportamiento

La búsqueda usa `where('searchTokens','array-contains', ultimaPalabra)`. **Si el backfill no se ejecutó, no hay tokens y devuelve 0 resultados**; por eso la pantalla mantiene el filtro local sobre lo cargado (no se rompe nada, simplemente no encuentra fuera de la página).

Activación:

1. `firebase deploy --only firestore:indexes` (incluye el índice `searchTokens + name` sin `isDeleted`).
2. `node scripts/backfill.mjs` (rellena `searchTokens` en productos y reparaciones).
3. Probar con `?ff=pagedData,serverSearch`.
4. Cuando esté validado, activar `featureFlags.serverSearch` por negocio.

Comportamiento:

- Debounce 350 ms, mínimo 3 caracteres, cancelación por generación.
- ≤ 20 resultados por búsqueda; repetir la misma búsqueda cuesta 0 lecturas.
- Los resultados se **fusionan a la caché** de la colección (`mergeIntoCatalog`), así que aparecen en la tabla/grid con su filtro local y, en POS, quedan disponibles para vender con costo y stock correctos.
- Si la búsqueda no devuelve nada, se conserva el filtro local sobre lo cargado.
- Los filtros locales ahora usan `normalizeText`: **“bateria” encuentra “Batería”** (antes fallaba por el acento).
- `mergeIntoCatalog` solo añade a las **listas** cacheadas, no a las entradas de búsqueda, para no contaminar resultados de búsquedas anteriores.

### Qué hace el modo beta de Inventario

- Carga **100 productos** por nombre y ofrece **“Cargar 100 más”**.
- Filtra los soft-deleted en cliente hasta que el backfill permita hacerlo en servidor.
- Las ediciones, altas y borrados se reflejan sin releer (`patchItem`, `mergeIntoCatalog`, `removeItem`).
- La búsqueda usa servidor cuando `serverSearch` está activo y hay tokens (ver 7.1); si no, cae al filtro local sobre lo cargado.

### Qué hace el modo beta de POS

- Carga **100 productos** por nombre y ofrece **“Cargar 100 más”** en el pie del grid.
- **Ventas retenidas**: si un producto del carrito restaurado no está en la página, se trae por id (`fetchDocsByIds`) antes de restaurar; si el documento ya no existe, se descarta igual que antes (sin bucle). También se traen los componentes de los combos incluidos en la venta retenida.
- **Combos**: si un componente no está en la página, se trae por id al seleccionar el combo; la tarjeta muestra `S: ?` y se deja pulsar para resolverlo, en lugar de aparecer agotada. Así el stock y el costo son correctos.
- **Precio y costo congelados**: al añadir al carrito se guardan `basePrice` y `costPrice`. Si el producto sale de la página (o el TTL reemplaza la lista), el carrito sigue mostrando y cobrando el precio correcto, y el checkout trae por id lo que falte antes de calcular.
- El checkout sigue igual (`writeBatch` + `increment`, 0 lecturas). El stock del grid se actualiza en memoria con `patchItem`.
- La búsqueda usa servidor cuando `serverSearch` está activo y hay tokens (ver 7.1); si no, cae al filtro local sobre lo cargado.
- Filtros locales con `normalizeText`: “bateria” encuentra “Batería”.

> **No activar las banderas en producción todavía**: `pagedData` ya funciona con paginación y “Cargar más”, pero la búsqueda en servidor no encuentra nada hasta ejecutar el backfill de `searchTokens`. Es una beta para validar el motor y la UX.

---

## 8. Siguiente paso (cableado, en este orden)

| Orden | Pantalla | Por qué en ese orden |
|---|---|---|
| 1 | **Fiados / Gastos** | 50 + stat, sin lógica de catálogo |
| 2 | **Backfill + activación de búsqueda** | Ejecutar script con service account y validar en las 3 pantallas |
| 3 | **Fase 1 (stats)** | Se cablea junto con Reportes/Dashboard para no dejar agregados a medias |

Cada pantalla se activa con banderas por tenant (`profile.featureFlags.pagedData` / `serverSearch`) y conserva el código anterior hasta la Fase 5.
