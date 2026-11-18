# Regla de oro: lecturas bajas de Firestore

Este proyecto se paga por lecturas. Cualquier cambio de interfaz debe respetar
esta regla, aunque sea "solo visual".

> **Ningún cambio de UI puede añadir lecturas.** Si una pantalla nueva necesita
> datos, los toma del array que ya está en memoria.

---

## 1. Las dos (y únicas) suscripciones del dashboard

Viven en `src/app/dashboard/layout.tsx`:

1. `users/{uid}` → perfil, licencia y `lastSessionId`.
2. `users/{uid}/app-settings/main` → tasas, márgenes y preferencias.

Todo lo demás (tasa BCV, "texto grande", moneda, márgenes) sale de
`useDashboardStore()`. **No crear suscripciones nuevas por pantalla.**

## 2. Prohibido en componentes de presentación

| No usar | Por qué |
|---|---|
| `useCollection` / `useDoc` por fila o por tarjeta | Multiplica lecturas por cada elemento |
| `getDocs` al abrir un modal o una tarjeta | Cada apertura es un viaje al servidor |
| `onSnapshot` "para mantener fresco" un listado ya cargado | Duplica el listener existente |
| Scroll infinito automático (`IntersectionObserver`) | Cada gesto del pulgar dispara una página |
| Bajar `pageSize` en móvil "para que se vea mejor" | Menos filas por página = más clics = más lecturas |

## 3. Permitido siempre

- Leer del array ya cargado y filtrar/derivar **en memoria**
  (`productos.filter(...)`, `table.getRowModel().rows`).
- `useCurrency()` para precios y conversiones.
- Estado local (`useState`) para desplegables, pestañas, filtros y confirmaciones.
- Escribir con `setDocumentNonBlocking` / `updateDocumentNonBlocking` /
  `runTransaction` cuando el usuario ejecuta una acción real.

## 4. Patrón correcto para listas (tarjetas móviles)

```tsx
// ✅ La tarjeta recibe la fila que ya vino en la página
mobileCardRender={(product, table) => (
  <MobileProductCard product={product} table={table} />
)}
```

```tsx
// ❌ Nunca dentro de la tarjeta
const { data } = useDoc(doc(firestore, 'users', uid, 'products', product.id));
```

El detalle desplegable de una tarjeta usa **solo** los campos que ya trae el
documento de la lista. Si un campo no viene en la consulta, se añade al modelo
(una lectura) o se carga al abrir el diálogo de edición (una lectura **bajo
demanda del usuario**), nunca al pintar la lista.

## 5. Paginación: no tocar

- `usePagedQuery` sigue en **100** por página.
- `DataTable` mantiene su paginación en cliente (20) sobre lo ya descargado.
- "Cargar más" es **explícito** (botón). No convertir a automático.

## 6. Cómo verificar antes de dar algo por terminado

1. Abrir la consola con `?reads=1` y anotar `window.__reads`.
2. Recorrer el flujo completo: Vender → añadir 3 productos → abrir carrito →
   cobrar; e Inventario → filtrar → abrir una tarjeta → editar.
3. Repetir con el cambio aplicado. **El número debe ser idéntico.**
4. Si sube, el cambio se rechaza aunque se vea mejor.

## 7. Registro de cambios de UI (sin lecturas nuevas)

| Fecha | Cambio | Lecturas | Escrituras |
|---|---|---|---|
| 2026-11 | Rediseño móvil: tarjetas desplegables de inventario y reparaciones | 0 | 0 |
| 2026-11 | Barra BCV compacta, pestañas verdes, píldora "añadido al carrito" | 0 | 0 |
| 2026-11 | Modo "Texto Grande" en Configuración | 0 | 1 (al guardar) |
| 2026-11 | Reglas de pago: "Pagado"/"Completado" exigen saldo cubierto | 0 | 0 |
| 2026-11 | Bloqueo de edición de reparaciones pagadas o entregadas | 0 | 0 |
| 2026-11 | Se retiró "Ver Historial" de reparaciones (listener de ventas que ya no se monta) | −0 (solo se abría a demanda) | 0 |
| 2026-11 | Búsqueda directa por folio de reparación: `R-YYMMDD-XXXX` completo hace **un** `getDoc` (1 lectura) para traer órdenes fuera de la página | +1 por búsqueda de folio | 0 |
| 2026-11 | Sincronización offline: verifica que los productos de la venta en cola existan antes de descontar stock (evita que un producto borrado atasque la cola) | +1 por documento implicado, sólo al sincronizar | 0 |

### Excepción deliberada 2: verificación de existencia al sincronizar offline

`syncOfflineQueue` lee cada producto (y la reparación) de la venta en cola antes de
armar el lote. Sin eso, un producto eliminado hacía fallar el `batch.update`
completo y la operación quedaba atascada para siempre ("1 en cola").

- Sólo ocurre en la ruta de sincronización offline, nunca al navegar.
- Como máximo 1 lectura por producto de esa venta (normalmente 1–3).
- Si el documento no existe, se omite el ajuste de stock y la venta se guarda igual.

### Excepción deliberada: lectura por acción explícita

La búsqueda por folio (`docs` → `repair_jobs/{folio}`) es la única lectura añadida
a propósito: el usuario escribe un folio completo y el sistema va directo al
documento. Reglas que la mantienen barata:

- Sólo se dispara con el **folio completo** (10 dígitos). Un folio a medias no
  consulta nada.
- Debounce de 400 ms y cancelación si el término cambia.
- 1 documento = 1 lectura, en lugar de una consulta por tokens con N resultados.

## 8. Checklist para revisar un cambio

- [ ] ¿Añade `useCollection`, `useDoc`, `getDocs` u `onSnapshot`? → **No**.
- [ ] ¿Cambia `pageSize`, cursores o dispara páginas sin acción del usuario? → **No**.
- [ ] ¿Las tarjetas leen solo de la fila recibida? → **Sí**.
- [ ] ¿Los filtros y contadores se calculan en memoria? → **Sí**.
- [ ] ¿El flujo de prueba deja `window.__reads` igual? → **Sí**.

---

Documento relacionado: `docs/auditoria-lecturas-firebase.md` (medición detallada
por pantalla y origen de cada lectura).
