"use client";

import React, { Suspense, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import {
  Plus,
  PlusCircle,
  Trash2,
  Calculator,
  Clock,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Boxes,
  Package,
  AlertTriangle,
  PackageX,
  SlidersHorizontal,
} from "lucide-react";
import { DataTable } from "@/components/data-table";
import { columns } from "@/components/inventory/columns";
import { MobileProductCard } from "@/components/inventory/mobile-product-card";
import type { Product } from '@/lib/types';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useDashboardStore } from '@/contexts/dashboard-context';
import { useDraftModals } from '@/contexts/draft-modals-context';
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { useServerSearch } from '@/lib/firestore/use-server-search';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import { useFeatureFlag } from '@/lib/features';
import { collection, writeBatch, doc } from 'firebase/firestore';
import type { Table as TanstackTable, FilterFn } from '@tanstack/react-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { ensureOnline } from '@/lib/offline-guard';
import { PrintLabelsButton } from '@/components/inventory/print-labels-button';
import { PriceCalculatorDialog } from '@/components/tools/price-calculator-dialog';
import { ProductFormDialog } from '@/components/inventory/product-form-dialog';
import { BulkImportDialog } from '@/components/inventory/bulk-import-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { differenceInDays, parseISO } from 'date-fns';
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";
import { normalizeText } from '@/lib/search-index';
import { formatCategoryName } from '@/lib/inventory-utils';

const productFilterFn: FilterFn<Product> = (row, columnId, value) => {
    const term = normalizeText(String(value));
    const p = row.original;
    const name = normalizeText(p.name);
    const sku = normalizeText(p.sku);
    const cat = normalizeText(p.category);
    const models = normalizeText((p.compatibleModels || []).join(' '));
    const barcode = normalizeText(p.barcode);
    const keywords = normalizeText((p.searchKeywords || []).join(' '));

    return name.includes(term) || sku.includes(term) || cat.includes(term) ||
        models.includes(term) || barcode.includes(term) || keywords.includes(term);
};

function BulkDeleteButton({ table }: { table: TanstackTable<Product> }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const selectedRows = table.getSelectedRowModel().rows;

    const reservedRows = selectedRows.filter(r => (Number(r.original.reservedStock) || 0) > 0);
    const deletableRows = selectedRows.filter(r => (Number(r.original.reservedStock) || 0) <= 0);

    const handleDelete = async () => {
        if (!firestore || !user || selectedRows.length === 0) return;

        if (deletableRows.length === 0) {
            toast({
                variant: "destructive",
                title: "No se eliminó nada",
                description: "Los productos seleccionados tienen piezas reservadas en reparaciones.",
            });
            setIsConfirmOpen(false);
            return;
        }

        const batch = writeBatch(firestore);
        deletableRows.forEach(row => {
            const productRef = doc(firestore, 'users', user.uid, 'products', row.original.id!);
            batch.delete(productRef);
        });

        try {
            await batch.commit();

            // Actualizar la caché solo cuando Firestore confirmó el borrado.
            const mutate = (table.options.meta as any)?.mutate;
            if (mutate) {
                const idsToDelete = deletableRows.map(r => r.original.id);
                mutate((prev: any) => prev?.filter((p: any) => !idsToDelete.includes(p.id)) || null);
            }

            toast({
                title: "Productos Eliminados",
                description: `${deletableRows.length} producto(s) eliminados.` +
                    (reservedRows.length > 0
                        ? ` ${reservedRows.length} omitido(s) por tener piezas reservadas en reparaciones.`
                        : ""),
            });
            table.resetRowSelection();
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error al Eliminar",
                description: "No se pudieron eliminar los productos.",
            });
        } finally {
            setIsConfirmOpen(false);
        }
    };

    return (
        <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedRows.length === 0}
                    className={cn(
                        "h-10 sm:h-9 gap-1.5 rounded-xl px-3 text-xs font-medium shadow-sm transition-all",
                        selectedRows.length > 0
                            ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                            : "border-slate-200 bg-white text-slate-400"
                    )}
                    aria-label="Eliminar seleccionados"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Eliminar</span>
                    {selectedRows.length > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                            {selectedRows.length}
                        </span>
                    )}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl border-slate-200 bg-white shadow-xl">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-base font-semibold text-slate-900">¿Estás seguro?</AlertDialogTitle>
                    <AlertDialogDescription className="text-sm text-slate-500">
                        Esta acción eliminará permanentemente {deletableRows.length} producto(s).
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {reservedRows.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-800">
                        <p className="font-semibold">Productos con piezas reservadas</p>
                        <p className="mt-1">
                            {reservedRows.length} producto(s) se omitirán porque están apartados en reparaciones.
                            Libera esas reservas antes de eliminarlos.
                        </p>
                    </div>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl border-slate-200 text-slate-700">Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        disabled={deletableRows.length === 0}
                        className="rounded-xl bg-rose-600 text-white hover:bg-rose-500 font-medium"
                    >
                        Sí, eliminar
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

function InventoryContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    
    const { profile } = useDashboardStore();
    const { drafts, saveDraft, clearDraft, setFormOpen } = useDraftModals();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [restoreDraftOpen, setRestoreDraftOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const handledRestoreRef = useRef<string | null>(null);
    const keepDraftRef = useRef(false);
    const uid = user?.uid ?? '';

    useEffect(() => {
        setFormOpen(createOpen || restoreDraftOpen);
    }, [createOpen, restoreDraftOpen, setFormOpen]);

    useEffect(() => () => setFormOpen(false), [setFormOpen]);

    const handleProductMinimize = (values: any) => {
        keepDraftRef.current = true;
        saveDraft('product', values);
    };

    const handleProductOpenChange = (open: boolean, setOpen: (value: boolean) => void) => {
        setOpen(open);
        if (!open) {
            if (!keepDraftRef.current) clearDraft('product');
            keepDraftRef.current = false;
        }
    };

    const restoreToken = searchParams.get('restoreDraft') === 'product'
        ? (searchParams.get('t') || 'legacy')
        : null;

    useEffect(() => {
        if (!restoreToken || !drafts.product) return;
        if (handledRestoreRef.current === restoreToken) return;

        handledRestoreRef.current = restoreToken;
        setRestoreDraftOpen(true);
        // Limpiar la URL sin permitir que el efecto vuelva a abrir el modal.
        router.replace('/dashboard/inventory', { scroll: false });
    }, [restoreToken, drafts.product, router]);
    const usePaged = useFeatureFlag(profile, 'pagedData');

    // LEGACY (bandera apagada): catálogo completo, como hasta ahora.
    const productsCollection = useMemoFirebase(() =>
        (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null,
        [firestore, user?.uid]
    );
    const legacy = useCollection<Product>(usePaged ? null : productsCollection);

    // FASE 2 (bandera encendida): 100 productos + "Cargar más" + caché con TTL.
    const paged = usePagedQuery<Product>({
        collectionName: 'products',
        orderField: 'name',
        orderDir: 'asc',
        pageSize: 100,
        enabled: usePaged,
    });

    // Los soft-deleted se filtran en cliente hasta que el backfill permita
    // filtrarlos en el servidor (`isDeleted == false`).
    const pagedProducts = useMemo(
        () => paged.items.filter((product) => !product.isDeleted),
        [paged.items],
    );

    const products = usePaged ? pagedProducts : legacy.data;
    const isLoading = usePaged ? paged.isLoading : legacy.isLoading;
    const refetchProducts = usePaged ? paged.reload : legacy.refetch;

    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isSyncConfirmOpen, setIsSyncConfirmOpen] = useState(false);
    const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'old'>('all');
    const [categoryFilter, setCategoryFilter] = useState('all');

    const showAging = profile?.enabledModules?.includes('inventory_aging') ?? false;
    const showRepairs = profile?.enabledModules?.includes('repairs') ?? true;

    const tableColumns = useMemo(() => {
        return columns.filter(column => {
            if (column.id === 'age') return showAging;
            return true;
        });
    }, [showAging]);

    const categories = useMemo(() => {
        if (!products) return ['all'];
        const seen = new Map<string, string>();
        for (const p of products) {
            const formatted = formatCategoryName(p.category);
            if (formatted) {
                const key = formatted.toLowerCase();
                if (!seen.has(key)) seen.set(key, formatted);
            }
        }
        const uniqueCategories = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'es'));
        return ['all', ...uniqueCategories];
    }, [products]);

    const inventoryCounts = useMemo(() => {
        const list = products || [];
        let low = 0;
        let out = 0;
        let old = 0;
        const now = new Date();
        for (const p of list) {
            const available = p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0);
            if (available <= 0) out++;
            else if (available <= p.lowStockThreshold) low++;
            if (showAging && p.createdAt && differenceInDays(now, parseISO(p.createdAt)) > 15) {
                old++;
            }
        }
        return { all: list.length, low, out, old };
    }, [products, showAging]);

    const filteredProducts = useMemo(() => {
        if (!products) return [];
        let temp = products;
        if (categoryFilter !== 'all') temp = temp.filter(p => formatCategoryName(p.category).toLowerCase() === categoryFilter.toLowerCase());
        
        if (stockFilter === 'low') temp = temp.filter(p => {
            const available = p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0);
            return available > 0 && available <= p.lowStockThreshold;
        });
        
        if (stockFilter === 'out') temp = temp.filter(p => {
            const available = p.stockLevel - (p.reservedStock || 0) - (p.damagedStock || 0);
            return available <= 0;
        });

        if (stockFilter === 'old' && showAging) temp = temp.filter(p => {
            if (!p.createdAt) return false;
            return differenceInDays(new Date(), parseISO(p.createdAt)) > 15;
        });

        return temp;
    }, [products, stockFilter, categoryFilter, showAging]);

    /** Sustituye al `mutate` del hook legacy cuando la bandera está activa. */
    const mutateProducts = useCallback((updater: WithId<Product>[] | ((prev: WithId<Product>[] | null) => WithId<Product>[] | null)) => {
        if (!usePaged || !uid) {
            legacy.mutate(updater);
            return;
        }

        const current = paged.items;
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (!Array.isArray(next)) return;

        const currentById = new Map(current.map((item) => [item.id, item]));
        const nextIds = new Set(next.map((item) => item.id));

        next.forEach((item) => {
            if (!item?.id) return;
            const previous = currentById.get(item.id);
            if (!previous) {
                queryCache.mergeIntoCatalog(uid, 'products', [item]);
            } else if (previous !== item) {
                queryCache.patchItem(uid, 'products', item.id, item);
            }
        });

        current.forEach((item) => {
            if (item.id && !nextIds.has(item.id)) {
                queryCache.removeItem(uid, 'products', item.id);
            }
        });
    }, [usePaged, uid, paged.items, legacy.mutate]);

    // Búsqueda en servidor (Fase 2). Los resultados se fusionan al catálogo
    // cacheado, así que aparecen en la tabla sin cambiar el flujo de datos.
    const [searchTerm, setSearchTerm] = useState('');
    const serverSearchFlag = useFeatureFlag(profile, 'serverSearch');
    const serverSearch = useServerSearch<Product>({
        collectionName: 'products',
        term: searchTerm,
        orderField: 'name',
        orderDir: 'asc',
        pageSize: 20,
        enabled: usePaged && serverSearchFlag,
        onResults: (found) => queryCache.mergeIntoCatalog(uid, 'products', found),
    });
    const handleSearchChange = useCallback((value: string) => setSearchTerm(value), []);

    const handleOptimisticUpdate = (newProduct: Product) => {
        mutateProducts((prev) => {
            if (!prev) return [newProduct as any];
            const exists = prev.find(p => p.id === newProduct.id);
            if (exists) {
                return prev.map(p => p.id === newProduct.id ? (newProduct as any) : p);
            }
            return [newProduct as any, ...prev];
        });
    };

    const handleBulkImported = (imported: WithId<Product>[]) => {
        if (usePaged && uid) {
            // Un solo merge para 500 productos; evita 500 actualizaciones de caché.
            queryCache.mergeIntoCatalog(uid, 'products', imported);
            return;
        }
        legacy.mutate((prev) => {
            const existing = new Set((prev || []).map((product) => product.id));
            return [...imported.filter((product) => !existing.has(product.id)), ...(prev || [])];
        });
    };

    return (
        <div className="flex-1 bg-slate-100/70 min-h-0">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-3 sm:p-6">
                {/* Encabezado ejecutivo integrado (sin doble barra superior) */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-2xs">
                            <Boxes className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Inventario
                            </h1>
                            <p className="text-xs text-slate-500">
                                Gestión de catálogo, precios y existencias en tiempo real
                            </p>
                        </div>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <PriceCalculatorDialog>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white px-0 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3"
                                aria-label="Calculadora de precios"
                                title="Calculadora de precios"
                            >
                                <Calculator className="h-4 w-4 text-blue-600" />
                                <span className="hidden md:inline">Calculadora</span>
                            </Button>
                        </PriceCalculatorDialog>

                        <BulkImportDialog onImported={handleBulkImported}>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-10 shrink-0 gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 sm:h-9 sm:px-3.5"
                                aria-label="Importar Excel"
                                title="Importar Excel"
                            >
                                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                                <span className="sm:hidden">Excel</span>
                                <span className="hidden sm:inline">Importar Excel</span>
                            </Button>
                        </BulkImportDialog>

                        <Button
                            size="sm"
                            className="h-10 flex-1 gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-emerald-500/25 transition-all hover:from-emerald-500 hover:to-teal-400 sm:h-9 sm:flex-none sm:px-4"
                            aria-label="Añadir producto"
                            title="Añadir producto"
                            onClick={() => {
                                if (drafts.product) setRestoreDraftOpen(true);
                                else setCreateOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4" />
                            <span>Añadir Producto</span>
                        </Button>
                    </div>
                </div>

                {/* Tarjetas KPI compactas (filtro rápido con conteo en memoria, 0 lecturas extra) */}
                <div className={cn("grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5", showAging && "grid-cols-2 sm:flex")}>
                    <button
                        type="button"
                        onClick={() => setStockFilter('all')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-2xs transition-all sm:min-w-[160px] sm:px-3",
                            stockFilter === 'all'
                                ? "border-blue-500 ring-2 ring-blue-500/15"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                stockFilter === 'all' ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                            )}>
                                <Package className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Todos</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                            {inventoryCounts.all}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setStockFilter('low')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-2xs transition-all sm:min-w-[160px] sm:px-3",
                            stockFilter === 'low'
                                ? "border-amber-400 ring-2 ring-amber-400/20"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                stockFilter === 'low' ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-600"
                            )}>
                                <AlertTriangle className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Stock Bajo</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-amber-600">
                            {inventoryCounts.low}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setStockFilter('out')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-2xs transition-all sm:min-w-[160px] sm:px-3",
                            stockFilter === 'out'
                                ? "border-rose-400 ring-2 ring-rose-400/20"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                stockFilter === 'out' ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-600"
                            )}>
                                <PackageX className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Sin Stock</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-rose-600">
                            {inventoryCounts.out}
                        </span>
                    </button>

                    {showAging && (
                        <button
                            type="button"
                            onClick={() => setStockFilter('old')}
                            className={cn(
                                "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-2xs transition-all sm:min-w-[160px] sm:px-3",
                                stockFilter === 'old'
                                    ? "border-indigo-400 ring-2 ring-indigo-400/20"
                                    : "border-slate-200/90 hover:border-slate-300"
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <span className={cn(
                                    "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                    stockFilter === 'old' ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-600"
                                )}>
                                    <Clock className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate text-xs font-medium text-slate-600">Antiguos (+15d)</span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-indigo-600">
                                {inventoryCounts.old}
                            </span>
                        </button>
                    )}
                </div>

                <DataTable 
                    columns={tableColumns} 
                    data={filteredProducts}
                    isLoading={isLoading}
                    filterPlaceholder="Buscar por nombre, SKU, código o categoría..."
                    meta={{ 
                        allProducts: products || [], 
                        showAging, 
                        showRepairs, 
                        mutate: mutateProducts,
                        onEditProduct: (p: Product) => {
                            setEditingProduct(p);
                            setIsEditDialogOpen(true);
                        }
                    }}
                    globalFilterFn={productFilterFn}
                    onGlobalFilterChange={handleSearchChange}
                    isServerSearching={usePaged && serverSearchFlag && serverSearch.isSearching}
                    mobileCardRender={(product, table) => (
                        <MobileProductCard product={product} table={table} />
                    )}
                    footerBar={(table) => (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-2xs">
                            <div className="justify-self-start">
                                <AlertDialog open={isSyncConfirmOpen} onOpenChange={setIsSyncConfirmOpen}>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={isLoading}
                                            className="h-8 gap-1.5 rounded-xl border-slate-200/90 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            <RefreshCw className={cn("w-3.5 h-3.5 text-blue-600", isLoading && "animate-spin")} />
                                            <span className="hidden sm:inline">Sincronizar catálogo</span>
                                            <span className="sm:hidden">Sincronizar</span>
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="rounded-2xl border-slate-200 bg-white shadow-xl">
                                        <AlertDialogHeader>
                                            <AlertDialogTitle className="text-base font-semibold text-slate-900">¿Sincronizar el catálogo?</AlertDialogTitle>
                                            <AlertDialogDescription className="text-sm text-slate-500">
                                                Se volverán a descargar todos los productos desde Firebase y cada descarga consume lecturas.
                                                Úsalo solo si sospechas que otro dispositivo cambió el inventario.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel className="rounded-xl border-slate-200">Cancelar</AlertDialogCancel>
                                            <AlertDialogAction
                                                className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
                                                onClick={() => {
                                                    if (!ensureOnline(toast, 'Sincronizar catálogo')) return;
                                                    refetchProducts();
                                                }}
                                            >
                                                Sincronizar
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>

                            <div className="justify-self-center">
                                {usePaged ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => paged.loadMore()}
                                        disabled={paged.isLoadingMore || !paged.hasMore}
                                        className="h-8 gap-1.5 rounded-xl border-slate-200/90 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                        {paged.isLoadingMore
                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                            : <PlusCircle className="w-3.5 h-3.5 text-blue-600" />}
                                        <span className="hidden sm:inline">{paged.hasMore ? 'Cargar 100 más' : 'Catálogo completo'}</span>
                                        <span className="sm:hidden">{paged.hasMore ? '+100' : 'Completo'}</span>
                                    </Button>
                                ) : (
                                    <span className="text-xs font-medium text-slate-500">
                                        Catálogo completo ({filteredProducts.length})
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center justify-self-end gap-1.5">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    aria-label="Página anterior"
                                    className="h-8 w-8 rounded-xl border-slate-200/90 bg-white text-slate-600 hover:bg-slate-50"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="min-w-10 text-center text-xs font-medium tabular-nums text-slate-600">
                                    {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    aria-label="Página siguiente"
                                    className="h-8 w-8 rounded-xl border-slate-200/90 bg-white text-slate-600 hover:bg-slate-50"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                >
                    {(table) => (
                        <div className="no-scrollbar -mx-1 flex w-full items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                <SelectTrigger className="h-10 sm:h-9 w-auto min-w-[140px] shrink-0 gap-1.5 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700 shadow-sm">
                                    <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                                    <SelectValue placeholder="Categoría" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-slate-200 bg-white shadow-xl">
                                    {categories.map(c => (
                                        <SelectItem key={c} value={c} className="rounded-lg text-xs font-medium">
                                            {c === 'all' ? 'Todas las categorías' : c}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <PrintLabelsButton table={table} />
                            <BulkDeleteButton table={table} />
                        </div>
                    )}
                </DataTable>

                {editingProduct && (
                    <ProductFormDialog 
                        product={editingProduct} 
                        isOpen={isEditDialogOpen} 
                        onOpenChange={(open) => {
                            setIsEditDialogOpen(open);
                            if (!open) setEditingProduct(null);
                        }}
                        onSaved={handleOptimisticUpdate}
                    />
                )}
                {drafts.product && (
                    <ProductFormDialog
                        isOpen={restoreDraftOpen}
                        onOpenChange={(open) => handleProductOpenChange(open, setRestoreDraftOpen)}
                        initialDraft={drafts.product.values as any}
                        onMinimize={handleProductMinimize}
                        onSaved={(saved) => {
                            handleOptimisticUpdate(saved);
                            clearDraft('product');
                            setRestoreDraftOpen(false);
                        }}
                    />
                )}

                <ProductFormDialog
                    isOpen={createOpen}
                    onOpenChange={(open) => handleProductOpenChange(open, setCreateOpen)}
                    onSaved={handleOptimisticUpdate}
                    onMinimize={handleProductMinimize}
                />
            </main>
        </div>
    );
}

export default function Page() {
  return (
    <SecurityGate module="inventory">
        <Suspense fallback={<div>Cargando...</div>}>
            <InventoryContent />
        </Suspense>
    </SecurityGate>
  );
}
