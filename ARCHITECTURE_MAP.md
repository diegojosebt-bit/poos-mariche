# MAPA DE ARQUITECTURA DEL SISTEMA (Cero Consumo de Tokens)

> **Generado automáticamente:** 2026-10-09T01:18:18.003Z
> Este archivo es una referencia ultracompacta para auditorías rápidas de la IA sin tener que leer archivos pesados de UI.

## 1. Rutas y Pantallas de la Aplicación

| Ruta | Módulo / Seguridad | Colecciones Consultadas | Archivo |
| :--- | :--- | :--- | :--- |
| **/** | `Ninguno (Público/General)` | _Ninguna_ | `src/app/page.tsx` |
| **/dashboard** | `Ninguno (Público/General)` | `sale_transactions`, `repair_jobs` | `src/app/dashboard/page.tsx` |
| **/dashboard/admin** | `admin` | _Ninguna_ | `src/app/dashboard/admin/page.tsx` |
| **/dashboard/analysis** | `analysis` | `products` | `src/app/dashboard/analysis/page.tsx` |
| **/dashboard/expenses** | `expenses` | `expenses` | `src/app/dashboard/expenses/page.tsx` |
| **/dashboard/fiados** | `fiados` | `fiados`, `products`, `repair_jobs` | `src/app/dashboard/fiados/page.tsx` |
| **/dashboard/inventory** | `inventory` | `products` | `src/app/dashboard/inventory/page.tsx` |
| **/dashboard/pos** | `pos` | `products`, `held_sales` | `src/app/dashboard/pos/page.tsx` |
| **/dashboard/repairs** | `repairs` | `repair_jobs` | `src/app/dashboard/repairs/page.tsx` |
| **/dashboard/reports** | `reports` | `sale_transactions`, `products`, `repair_jobs`, `currency_exchanges`, `fiados` | `src/app/dashboard/reports/page.tsx` |
| **/dashboard/settings** | `settings` | `products` | `src/app/dashboard/settings/page.tsx` |

## 2. Mapa de Colecciones Firestore y Estrategia de Lecturas

| Colección | Estrategia de Costo | Archivos Principales que la Usan |
| :--- | :--- | :--- |
| `fiados` | **Carga bajo demanda en pestaña Fiados / RAM** | `admin/page.tsx`, `fiados/page.tsx`, `reports/page.tsx`, `settings/page.tsx` (+3 más) |
| `expenses` | **Carga por rango de fechas en gastos / RAM** | `admin/page.tsx`, `expenses/page.tsx`, `settings/page.tsx`, `components/auth-view.tsx` (+3 más) |
| `products` | **Catálogo completo en RAM (0ms, 0 lecturas tras carga inicial)** | `analysis/page.tsx`, `fiados/page.tsx`, `inventory/page.tsx`, `pos/page.tsx` (+9 más) |
| `repair_jobs` | **Límite 100 recientes + Filtro activo/garantía en RAM** | `fiados/page.tsx`, `dashboard/page.tsx`, `repairs/page.tsx`, `reports/page.tsx` (+4 más) |
| `sale_transactions` | **Límite estricto 50 + Paginación servidor (Blindaje)** | `fiados/page.tsx`, `dashboard/page.tsx`, `pos/page.tsx`, `reports/page.tsx` (+5 más) |
| `held_sales` | **Tiempo real / Subcolección de ventas en espera** | `pos/page.tsx`, `pos/held-sales-sheet.tsx` |
| `currency_exchanges` | **Carga bajo demanda en arqueo de caja / RAM** | `reports/page.tsx` |
| `metadata` | **Documentos guardián y estados del negocio** | `pos/cart-display.tsx`, `firebase/non-blocking-updates.tsx`, `lib/fiscal-helpers.ts` |

## 3. Estado Global y Caché en Memoria (RAM)

- **`src/contexts/dashboard-context.tsx`**:
  - `dataCache`: Almacén global que retiene colecciones completas en memoria para evitar re-consultas entre pantallas (POS, Inventario, Reportes).
  - `addItemToCache`, `updateCachedItem`, `removeCachedItem`: Mutaciones optimistas en 0ms.
- **`src/firebase/firestore/use-collection.tsx`**:
  - Hook principal que alimenta las pantallas. Consulta la memoria RAM (`dataCache`) primero y solo va al servidor cuando no existe el dato o se fuerza con `refetch()`. Purga claves obsoletas de sincronización local.

## 4. Componentes Clave por Módulo

### POS / Caja
- `src/components/pos/cart-display.tsx`
- `src/components/pos/checkout-dialog.tsx`
- `src/components/pos/custom-item-dialog.tsx`
- `src/components/pos/held-sale-dialog.tsx`
- `src/components/pos/held-sales-sheet.tsx`
- `src/components/pos/hold-sale-dialog.tsx`
- `src/components/pos/product-grid.tsx`
- `src/components/pos/receipt-view.tsx`

### Inventario
- `src/components/inventory/columns.tsx`
- `src/components/inventory/print-labels-button.tsx`
- `src/components/inventory/product-form-dialog.tsx`
- `src/components/inventory/product-label.tsx`
- `src/components/inventory/replenish-stock-dialog.tsx`

### Reparaciones
- `src/components/repairs/columns.tsx`
- `src/components/repairs/pay-repair-button.tsx`
- `src/components/repairs/repair-draft-pill.tsx`
- `src/components/repairs/repair-form-dialog.tsx`
- `src/components/repairs/repair-ticket.tsx`

### Reportes / Arqueo
- `src/components/reports/cash-reconciliation-dialog.tsx`
- `src/components/reports/date-range-report.tsx`
- `src/components/reports/export-sales-button.tsx`
- `src/components/reports/reconciliation-history.tsx`
- `src/components/reports/reconciliation-ticket.tsx`
- `src/components/reports/repair-analysis.tsx`
- `src/components/reports/reports-view.tsx`
- `src/components/reports/transaction-list.tsx`

### Seguridad y Auth
- `src/components/admin-auth-dialog.tsx`
- `src/components/app-lock.tsx`
- `src/components/auth-view.tsx`
- `src/components/security-gate.tsx`

## 5. Instrucciones de Búsqueda Quirúrgica (CLI) para la IA

Para evitar leer archivos completos, la IA debe preferir:
```bash
# Buscar dónde se llama una función o colección:
grep -rn "collectionName" src/

# Ver solo las líneas de la consulta Firestore en un archivo:
grep -n -C 3 "collection(" src/app/dashboard/pos/page.tsx

# Regenerar este mapa en cualquier momento:
npm run map
```
