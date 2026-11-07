"use client";

import React, { Suspense, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PlusCircle, Trash2, Calculator, Clock, RefreshCw, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { columns } from "@/components/inventory/columns";
import type { Product } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { differenceInDays, parseISO } from 'date-fns';
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";
import { normalizeText } from '@/lib/search-index';

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

    const handleDelete = async () => {
        if (!firestore || !user || selectedRows.length === 0) return;

        const batch = writeBatch(firestore);
        selectedRows.forEach(row => {
            const productRef = doc(firestore, 'users', user.uid, 'products', row.original.id!);
            batch.delete(productRef);
        });

        try {
            await batch.commit();

            // Actualizar la caché solo cuando Firestore confirmó el borrado.
            const mutate = (table.options.meta as any)?.mutate;
            if (mutate) {
                const idsToDelete = selectedRows.map(r => r.original.id);
                mutate((prev: any) => prev?.filter((p: any) => !idsToDelete.includes(p.id)) || null);
            }

            toast({
                title: "Productos Eliminados",
                description: `${selectedRows.length} productos han sido eliminados.`,
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
                <Button variant="destructive" size="sm" disabled={selectedRows.length === 0} className="h-9 px-2 sm:px-4">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Eliminar</span> ({selectedRows.length})
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                    <AlertDialogDescription>Esta acción eliminará permanentemente {selectedRows.length} producto(s).</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive">Sí, eliminar</AlertDialogAction>
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
        if (!products) return [];
        const uniqueCategories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];
        uniqueCategories.sort((a, b) => a.localeCompare(b));
        return ['all', ...uniqueCategories];
    }, [products]);

    const filteredProducts = useMemo(() => {
        if (!products) return [];
        let temp = products;
        if (categoryFilter !== 'all') temp = temp.filter(p => p.category === categoryFilter);
        
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

    return (
        <>
            <PageHeader title="Inventario">
                <PriceCalculatorDialog><Button variant="outline" size="icon" className="h-9 w-9 sm:h-10 sm:w-10"><Calculator className="h-4 w-4" /></Button></PriceCalculatorDialog>
                <Button
                    size="sm"
                    className="sm:h-10 px-2 sm:px-4"
                    onClick={() => {
                        if (drafts.product) setRestoreDraftOpen(true);
                        else setCreateOpen(true);
                    }}
                >
                    <PlusCircle className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Añadir</span> Producto
                </Button>
            </PageHeader>
            <main className="flex-1 p-2 sm:p-6 max-w-7xl mx-auto w-full">
                <Tabs value={stockFilter} onValueChange={(v) => setStockFilter(v as any)} className="mb-4">
                    <TabsList className="grid w-full h-auto grid-cols-2 sm:grid-cols-4 p-1 bg-muted/50">
                        <TabsTrigger value="all" className="text-[10px] sm:text-sm py-2">Todos</TabsTrigger>
                        <TabsTrigger value="low" className="text-[10px] sm:text-sm py-2 text-amber-600 font-bold">Stock Bajo</TabsTrigger>
                        <TabsTrigger value="out" className="text-[10px] sm:text-sm py-2 text-destructive font-bold">Sin Stock</TabsTrigger>
                        {showAging && (
                            <TabsTrigger value="old" className="text-[10px] sm:text-sm py-2 text-amber-600 font-bold">
                                <Clock className="w-3.5 h-3.5 mr-1 sm:mr-1.5" /> <span className="hidden sm:inline">Antiguos (+15d)</span><span className="sm:hidden">+15d</span>
                            </TabsTrigger>
                        )}
                    </TabsList>
                </Tabs>
                <DataTable 
                    columns={tableColumns} 
                    data={filteredProducts}
                    isLoading={isLoading}
                    filterPlaceholder="Buscar productos en inventario..."
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
                    footerBar={(table) => (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t bg-muted/20 px-3 py-2">
                            <div className="justify-self-start">
                                <AlertDialog open={isSyncConfirmOpen} onOpenChange={setIsSyncConfirmOpen}>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={isLoading}
                                            className="h-8 text-xs font-semibold gap-1.5"
                                        >
                                            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
                                            <span className="hidden sm:inline">Sincronizar catálogo</span>
                                            <span className="sm:hidden">Sincronizar</span>
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Sincronizar el catálogo?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Se volverán a descargar todos los productos desde Firebase y cada descarga consume lecturas.
                                                Úsalo solo si sospechas que otro dispositivo cambió el inventario.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => {
                                                if (!ensureOnline(toast, 'Sincronizar catálogo')) return;
                                                refetchProducts();
                                            }}>Sincronizar</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>

                            <div className="justify-self-center">
                                {usePaged ? (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => paged.loadMore()}
                                        disabled={paged.isLoadingMore || !paged.hasMore}
                                        className="h-8 text-xs font-semibold gap-1.5"
                                    >
                                        {paged.isLoadingMore
                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : <PlusCircle className="w-3.5 h-3.5" />}
                                        <span className="hidden sm:inline">{paged.hasMore ? 'Cargar 100 más' : 'Catálogo completo'}</span>
                                        <span className="sm:hidden">{paged.hasMore ? '+100' : 'Completo'}</span>
                                    </Button>
                                ) : (
                                    <span className="text-[10px] font-black uppercase text-muted-foreground">
                                        Catálogo completo
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center justify-self-end gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    aria-label="Página anterior"
                                    className="h-7 w-7"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </Button>
                                <span className="min-w-9 text-center text-[10px] font-black uppercase text-muted-foreground">
                                    {table.getState().pagination.pageIndex + 1}/{Math.max(1, table.getPageCount())}
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    aria-label="Página siguiente"
                                    className="h-7 w-7"
                                >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}
                >
                    {(table) => (
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                             <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                 <SelectTrigger className="w-full sm:w-[160px] h-9 text-xs"><SelectValue placeholder="Categoría" /></SelectTrigger>
                                 <SelectContent>{categories.map(c => <SelectItem key={c} value={c} className="text-xs">{c === 'all' ? 'Todas' : c}</SelectItem>)}</SelectContent>
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
        </>
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
