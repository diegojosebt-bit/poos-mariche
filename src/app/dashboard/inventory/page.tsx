"use client";

import React, { Suspense, useState, useMemo, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PlusCircle, Trash2, Calculator, Clock } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { columns } from "@/components/inventory/columns";
import type { Product, UserProfile } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, writeBatch, doc, query, limit, orderBy } from 'firebase/firestore';
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
import { PrintLabelsButton } from '@/components/inventory/print-labels-button';
import { PriceCalculatorDialog } from '@/components/tools/price-calculator-dialog';
import { ProductFormDialog } from '@/components/inventory/product-form-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { differenceInDays, parseISO } from 'date-fns';
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";

const productFilterFn: FilterFn<Product> = (row, columnId, value) => {
    const term = String(value).toLowerCase();
    const p = row.original;
    const name = (p.name || "").toLowerCase();
    const sku = (p.sku || "").toLowerCase();
    const cat = (p.category || "").toLowerCase();
    const models = (p.compatibleModels || []).join(" ").toLowerCase();
    
    return name.includes(term) || sku.includes(term) || cat.includes(term) || models.includes(term);
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
            // OPTIMISTIC UPDATE
            const mutate = (table.options.meta as any)?.mutate;
            if (mutate) {
                const idsToDelete = selectedRows.map(r => r.original.id);
                mutate((prev: any) => prev?.filter((p: any) => !idsToDelete.includes(p.id)) || null);
            }

            await batch.commit();
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
    
    const profileRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid) : null,
        [firestore, user?.uid]
    );
    const { data: profile } = useDoc<UserProfile>(profileRef);
    
    // ESTANDARIZADO: Límite 200 para compartir cache con el POS
    const productsCollection = useMemoFirebase(() =>
        (firestore && user) ? query(collection(firestore, 'users', user.uid, 'products'), orderBy('name'), limit(200)) : null,
        [firestore, user?.uid]
    );
    const { data: products, isLoading, mutate: mutateProducts } = useCollection<Product>(productsCollection);

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
                <ProductFormDialog productCount={products?.length || 0} onSaved={handleOptimisticUpdate}>
                    <Button size="sm" className="sm:h-10 px-2 sm:px-4"><PlusCircle className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Añadir</span> Producto</Button>
                </ProductFormDialog>
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
                    filterPlaceholder="Buscar productos..."
                    meta={{ allProducts: products || [], showAging, showRepairs, mutate: mutateProducts }}
                    globalFilterFn={productFilterFn}
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
