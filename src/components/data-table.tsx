
"use client"

import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Table,
} from "@tanstack/react-table"

import {
  Table as ShadcnTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "./ui/skeleton"
import { TablePaginationBar } from "./table-pagination-bar"
import { cn } from "@/lib/utils"

import { Loader2, Search } from "lucide-react"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[],
  filterPlaceholder: string,
  isLoading?: boolean,
  children?: (table: Table<TData>) => React.ReactNode,
  globalFilterFn?: FilterFn<TData>,
  meta?: any;
  onGlobalFilterChange?: (filterValue: string, filteredCount: number) => void;
  isServerSearching?: boolean;
  searchAddon?: React.ReactNode;
  footerInfo?: React.ReactNode;
  footerActions?: React.ReactNode;
  itemLabel?: string;
  hideFooter?: boolean;
  pageSize?: number;
  footerBar?: (table: Table<TData>) => React.ReactNode;
  rowClassName?: (row: TData) => string;
  /**
   * Vista de tarjetas para móvil (<768px). Reutiliza las celdas ya definidas
   * en `columns`, por lo que no duplica acciones ni lógica.
   */
  mobileCard?: MobileCardConfig<TData>;
  /** Tarjeta a medida para móvil. Tiene prioridad sobre `mobileCard`. */
  mobileCardRender?: (row: TData, table: Table<TData>) => React.ReactNode;
}

export type MobileCardConfig<TData> = {
  /** Ids de columna que forman el encabezado de la tarjeta. */
  title?: string[];
  /** Ids de columna secundarios bajo el título. */
  subtitle?: string[];
  /** Ids de columna que se muestran como acciones a la derecha. */
  actions?: string[];
  /** Pares columna / etiqueta que se listan como detalle. */
  fields?: { id: string; label: string }[];
  /** Permite afinar visualmente una tarjeta concreta. */
  className?: (row: TData) => string | undefined;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  filterPlaceholder,
  isLoading = false,
  children,
  globalFilterFn,
  meta,
  onGlobalFilterChange,
  isServerSearching = false,
  searchAddon,
  footerInfo,
  footerActions,
  itemLabel = 'registros',
  hideFooter = false,
  pageSize = 20,
  footerBar,
  rowClassName,
  mobileCard,
  mobileCardRender,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize,
  })

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    globalFilterFn: globalFilterFn,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      pagination,
    },
    meta: meta
  })

  const columnCount = table.getAllColumns().length;
  const tableRows = table.getRowModel().rows;
  const filteredRowsCount = table.getFilteredRowModel().rows.length;

  const renderCell = (
    row: (typeof tableRows)[number],
    columnId: string
  ): React.ReactNode => {
    const cell = row.getVisibleCells().find((c) => c.column.id === columnId);
    if (!cell) return null;
    return flexRender(cell.column.columnDef.cell, cell.getContext());
  };

  React.useEffect(() => {
    onGlobalFilterChange?.(globalFilter, filteredRowsCount);
  }, [globalFilter, filteredRowsCount, onGlobalFilterChange]);

  return (
    <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2 max-w-md w-full">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    placeholder={filterPlaceholder}
                    value={globalFilter ?? ""}
                    onChange={(event) =>
                        setGlobalFilter(event.target.value)
                    }
                    className="h-10 sm:h-9 rounded-xl border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
                    type="search"
                    name="mm-table-search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                />
                {isServerSearching && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
              </div>
              {searchAddon}
            </div>
             {children && children(table)}
        </div>
        {(mobileCard || mobileCardRender) && (
          <div className="space-y-2 md:hidden">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`mobile-skeleton-${i}`} className="rounded-xl border border-border/70 bg-card p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                  <Skeleton className="mt-3 h-3 w-full" />
                </div>
              ))
            ) : tableRows?.length ? (
              tableRows.map((row) => {
                if (mobileCardRender) {
                  return (
                    <React.Fragment key={`mobile-${row.id}`}>
                      {mobileCardRender(row.original, table)}
                    </React.Fragment>
                  );
                }
                return (
                <div
                  key={`mobile-${row.id}`}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(
                    "rounded-xl border bg-white p-3 shadow-sm",
                    row.getIsSelected() && "border-primary/50 bg-primary/[0.03]",
                    mobileCard?.className?.(row.original)
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      {mobileCard?.title?.map((id) => (
                        <div
                          key={id}
                          className="min-w-0 truncate text-sm font-bold leading-tight text-foreground"
                        >
                          {renderCell(row, id)}
                        </div>
                      ))}
                      {mobileCard?.subtitle?.map((id) => (
                        <div
                          key={id}
                          className="min-w-0 truncate text-xs text-muted-foreground"
                        >
                          {renderCell(row, id)}
                        </div>
                      ))}
                    </div>
                    {mobileCard?.actions?.length ? (
                      <div className="flex shrink-0 items-center gap-1">
                        {mobileCard.actions.map((id) => (
                          <React.Fragment key={id}>
                            {renderCell(row, id)}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {mobileCard?.fields?.length ? (
                    <dl className="mt-2 space-y-1.5 border-t pt-2">
                      {mobileCard.fields.map(({ id, label }) => (
                        <div
                          key={id}
                          className="flex items-center justify-between gap-3 text-xs"
                        >
                          <dt className="shrink-0 font-medium text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="min-w-0 text-right font-semibold text-foreground">
                            {renderCell(row, id)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                );
              })
            ) : (
              <div className="rounded-xl border bg-white p-6 text-center text-sm italic text-muted-foreground">
                {isServerSearching
                  ? "Buscando en el servidor..."
                  : "No se encontraron resultados para esta búsqueda."}
              </div>
            )}
          </div>
        )}
        <div className={cn("overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs", (mobileCard || mobileCardRender) && "hidden md:block")}>
        <ShadcnTable>
            <TableHeader className="bg-slate-50/80">
            {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-slate-200/80 hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                    return (
                    <TableHead key={header.id} className="h-11 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                            )}
                    </TableHead>
                    )
                })}
                </TableRow>
            ))}
            </TableHeader>
            <TableBody>
            {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`loading-row-${i}`} className="border-slate-100">
                        {Array.from({ length: columnCount }).map((_, j) => (
                             <TableCell key={`loading-cell-${i}-${j}`}>
                                <Skeleton className="h-6 rounded-lg" />
                             </TableCell>
                        ))}
                    </TableRow>
                ))
            ) : tableRows?.length ? (
                tableRows.map((row) => (
                <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      "border-slate-100 transition-colors hover:bg-slate-50/70 data-[state=selected]:bg-blue-50/50",
                      rowClassName?.(row.original)
                    )}
                >
                    {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3 text-sm text-slate-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                    ))}
                </TableRow>
                ))
            ) : (
                <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center text-sm text-slate-400">
                    {isServerSearching ? (
                      <div className="flex items-center justify-center gap-2 text-blue-600 font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Buscando en el servidor...</span>
                      </div>
                    ) : (
                      "No se encontraron resultados para esta búsqueda."
                    )}
                </TableCell>
                </TableRow>
            )}
            </TableBody>
        </ShadcnTable>
        </div>
        {footerBar ? (
          footerBar(table)
        ) : !hideFooter ? (
          <TablePaginationBar
            page={table.getState().pagination.pageIndex + 1}
            totalPages={table.getPageCount()}
            totalItems={table.getFilteredRowModel().rows.length}
            rangeStart={
              table.getFilteredRowModel().rows.length === 0
                ? 0
                : table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1
            }
            rangeEnd={Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length,
            )}
            itemLabel={itemLabel}
            info={footerInfo}
            actions={footerActions}
            onPrevious={() => table.previousPage()}
            onNext={() => table.nextPage()}
            canPrevious={table.getCanPreviousPage()}
            canNext={table.getCanNextPage()}
          />
        ) : null}
    </div>
  )
}
