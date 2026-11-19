# Auditoría Técnica: Búsqueda Remota (`searchTokens`) y Optimización para Tablets

| | |
|---|---|
| **Fecha** | 2026-11-19 |
| **Módulos evaluados** | Inventario (`ProductFormDialog`, `BulkImportDialog`), POS (`ProductGrid`, `CartDisplay`), Scripts (`scripts/backfill.mjs`), Shell (`SidebarProvider`, `exchange-rate-reminder.tsx`) |
| **Objetivo** | 1. Diagnóstico de indexación y persistencia de `searchTokens` en productos nuevos vs. viejos.<br>2. Registro de optimizaciones de interfaz para tablets (viewport 1024 × 768 px y 768–1180 px). |
| **Impacto en Firestore** | **0 lecturas añadidas** (cumple la [Regla de Oro](./regla-de-oro-lecturas.md)). |

---

## 1. Seguridad y Acceso a Firebase

* **Dictamen:** **NO se requiere ni se debe compartir acceso directo a Firebase** (claves de servicio, credenciales o consola).
* **Justificación técnica:** El código fuente cliente y los scripts de backend definen exhaustivamente el esquema de datos (`src/lib/types.ts`), las mutaciones hacia Firestore (`ProductFormDialog`, `BulkImportDialog`, `runTransaction`) y las consultas (`usePagedQuery`, `useServerSearch`). Cualquier inconsistencia en los datos puede diagnosticarse y resolverse de forma segura y verificable desde el repositorio.

---

## 2. Diagnóstico de Indexación: `searchTokens` ("shert")

### ¿Qué es y cuál es su propósito?
Al activar la paginación eficiente de Fase 2 (`usePagedQuery` con 100 productos por página para reducir lecturas de Firestore), el dispositivo no descarga el catálogo completo en memoria de entrada.  
Para evitar que productos no cargados en los primeros 100 se pierdan al buscarlos, el sistema implementó la búsqueda remota en servidor (`useServerSearch` con filtro `array-contains`).

Para que Firestore pueda encontrar un producto por subcadenas o prefijos (ej. *"batería"*, *"pantalla"*), cada documento en la colección `products` debe contener:
- **`searchTokens`**: Un conjunto de prefijos normalizados (de 2 a 16 caracteres) generados desde el nombre, SKU, código de barras y categoría.
- **`searchKeywords`**: Palabras clave individuales limpias.
- **`searchName`**: Nombre normalizado (minúsculas, sin acentos ni signos diacríticos).
- **`isDeleted: false`**: Bandera booleana obligatoria para discriminar productos activos en consultas del servidor.

### Estado Actual del Catálogo

| Categoría de Producto | ¿Tiene `searchTokens` en Firebase? | Comportamiento en Búsqueda y Navegación |
| :--- | :---: | :--- |
| **Productos Nuevos (Formulario Manual)** | **SÍ (100%)** | En `src/components/inventory/product-form-dialog.tsx` (líneas 281–301), la función `onSubmit` ejecuta `buildSearchTokens` y guarda `searchTokens`, `searchKeywords`, `searchName` e `isDeleted: false` en Firestore en cada alta. |
| **Productos Nuevos (Importación Excel)** | **SÍ (100%)** | En `src/components/inventory/bulk-import-dialog.tsx` (líneas 293–295), la importación masiva mapea `makeKeywords`, `buildSearchTokens` y `searchName` para cada fila procesada antes de ejecutar el batch a Firestore. |
| **Productos Antiguos Editados** | **SÍ (Inmediato al guardar)** | Al abrir cualquier producto antiguo y hacer clic en *"Guardar Cambios"*, el formulario genera y persiste los tokens faltantes de forma transparente. |
| **Productos Antiguos No Editados** | **NO en la base de datos** | No están corruptos ni eliminados. En la pantalla de Inventario y POS, se listan normalmente mientras estén en los 100 cargados o al presionar *"Cargar 100 más"*. Sin embargo, **no responderán a consultas remotas por servidor** (`useServerSearch`) hasta que se les inyecte este campo. |

### Procedimiento para Regularizar Productos Antiguos
1. **Opción A (Bajo demanda):** Se actualizan orgánicamente a medida que el personal edita precios o existencias en el día a día.
2. **Opción B (Masiva y definitiva):** Ejecutar el script preexistente en el proyecto:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill.mjs
   ```
   Este script recorre la colección `users/{uid}/products`, genera los tokens de cada documento antiguo y actualiza las banderas sin tocar precios ni existencias.

---

## 3. Registro de Optimizaciones para Tablets (1024 × 768 px)

Se completó una reingeniería de respuesta visual enfocada en tablets (viewport objetivo: **1024 × 768 px**, con rango de 768 px a 1180 px):

### A. Breakpoints y Shell Responsivo
* **Hooks responsivos (`src/hooks/use-mobile.tsx`)**: Se definieron `TABLET_MIN_WIDTH = 768`, `TABLET_MAX_WIDTH = 1180`, `useIsTablet()` y `useIsDesktop()`.
* **Sidebar inteligente (`src/components/ui/sidebar.tsx`)**: Se configuró el colapso inicial a `Icon Rail` (48 px) en resoluciones `≤ 1180px`. Esto libera **+208 px netos** de ancho útil en tablets sin requerir interacción del usuario.

### B. Barra Superior y Herramientas (`exchange-rate-reminder.tsx` y `page.tsx`)
* Se eliminó el solapamiento de texto en el banner superior en resoluciones medianas.
* Se compactó la etiqueta del botón *"Instalar App"* a *"Instalar"*.
* Se abrevió la tasa *"Paralelo"* a *"Par."* en pantallas menores a `xl`.
* En tablets, los accesos directos de Calculadora y Venta Rápida se agruparon limpiamente dentro del menú desplegable `POSActionsSheet` ("Herramientas").

### C. Rebalanceo de Pantalla POS (`src/app/dashboard/pos/page.tsx`)
* **Distribución de 12 Columnas (`md:grid-cols-12`)**:
  * **Carrito (`CartDisplay`)**: Asignado a **7 de 12 columnas (58.3% del ancho)** (~569 px netos en tablet horizontal de 1024 px).
    * Mayor amplitud para la tabla de artículos, selectores de cantidad `[-] [1] [+]`, insignias de ofertas/descuentos y panel de pago.
  * **Catálogo de Productos (`ProductGrid`)**: Asignado a **5 de 12 columnas (41.7% del ancho)** (~407 px netos).
    * Rejilla adaptativa de 2 columnas de tarjetas (`lg:grid-cols-2`) en tablet horizontal y 1 columna amplia (`md:grid-cols-1`) en tablet vertical.
    * Selector de categorías compactado a `sm:w-[130px]` para priorizar el ancho de la barra de búsqueda.
* **Escritorio intacto (≥ 1280 px / 1536 px)**: En monitores convencionales, el catálogo retiene el 58.3% (`xl:col-span-7`) o 66.7% (`2xl:col-span-8`), y el carrito el 41.7% / 33.3%.

### D. Prioridad de Columnas en Tablas Administrativas
* **Inventario (`src/components/inventory/columns.tsx`)**: Columnas secundarias (`age`, `stockLevel`, `costPrice`) se configuraron con `hidden xl:table-cell` para dar visibilidad prioritaria al nombre, SKU, stock disponible y precio de venta en tablets.
* **Reparaciones (`src/components/repairs/columns.tsx`)**: Columnas de tiempo transcurrido (`timer`) y abono parcial (`amountPaid`) se ocultaron en tablets (`hidden xl:table-cell`), manteniendo al frente cliente, equipo, falla, costo total y estado.
* **Reportes (`src/components/reports/date-range-report.tsx`)**: Rejilla de tarjetas KPI adaptada a `sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5` para evitar saltos de línea irregulares.

---

## 4. Estado de Verificación
* **Compilación y Tipos**: Sin errores de TypeScript.
* **Consumo de Datos**: 0 consultas adicionales añadidas. Todo el rebalanceo visual de tablets opera 100% sobre CSS Tailwind y el estado local existente.
