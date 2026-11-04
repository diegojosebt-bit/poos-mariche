
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

import { Loader2 } from "lucide-react"

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
}

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
  searchAddon
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 20,
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

  React.useEffect(() => {
    onGlobalFilterChange?.(globalFilter, filteredRowsCount);
  }, [globalFilter, filteredRowsCount, onGlobalFilterChange]);

  return (
    <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2 max-w-sm w-full">
              <div className="relative flex-1">
                <Input
                    placeholder={filterPlaceholder}
                    value={globalFilter ?? ""}
                    onChange={(event) =>
                        setGlobalFilter(event.target.value)
                    }
                    className="pr-8"
                />
                {isServerSearching && (
                  <div className="absolute right-2.5 top-2.5 text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
              </div>
              {searchAddon}
            </div>
             {children && children(table)}
        </div>
        <div className="rounded-md border bg-white">
        <ShadcnTable>
            <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                    return (
                    <TableHead key={header.id}>
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
                    <TableRow key={`loading-row-${i}`}>
                        {Array.from({ length: columnCount }).map((_, j) => (
                             <TableCell key={`loading-cell-${i}-${j}`}>
                                <Skeleton className="h-6" />
                             </TableCell>
                        ))}
                    </TableRow>
                ))
            ) : tableRows?.length ? (
                tableRows.map((row) => (
                <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                >
                    {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                    ))}
                </TableRow>
                ))
            ) : (
                <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground italic">
                    {isServerSearching ? (
                      <div className="flex items-center justify-center gap-2 text-primary font-bold">
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
        <div className="flex items-center justify-between">
            <div className="text-[10px] font-black uppercase text-muted-foreground">
                Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()} ({table.getFilteredRowModel().rows.length} total)
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-8 text-xs font-bold"
                >
                Anterior
                </Button>
                <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-8 text-xs font-bold"
                >
                Siguiente
                </Button>
            </div>
        </div>
    </div>
  )
}
