"use client";

import { ReportsView } from "@/components/reports/reports-view";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import type { Product, Sale, RepairJob, CurrencyExchange, Fiado } from "@/lib/types";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { useFeatureFlag } from '@/lib/features';
import { SecurityGate } from "@/components/security-gate";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
    return (
        <SecurityGate module="reports">
            <ReportsContent />
        </SecurityGate>
    );
}

function ReportsContent() {
    const { firestore, user } = useFirebase();
    const { dataCache, profile } = useDashboardStore();
    const usePaged = useFeatureFlag(profile, 'pagedData');
    const [enableDetailedAnalytics, setEnableDetailedAnalytics] = useState(false);
    
    // Consulta base de ventas (para transacciones y arqueo de caja)
    const salesCollection = useMemoFirebase(() => 
        (firestore && user && !usePaged) ? query(collection(firestore, "users", user.uid, "sale_transactions"), orderBy("transactionDate", "desc"), limit(100)) : null, 
        [firestore, user?.uid, usePaged]
    );
    const legacySales = useCollection<Sale>(salesCollection);

    // FASE 2: 100 por página + "Cargar 100 más" (sin tope fijo).
    const pagedSales = usePagedQuery<Sale>({
        collectionName: 'sale_transactions',
        orderField: 'transactionDate',
        orderDir: 'desc',
        pageSize: 100,
        enabled: usePaged,
    });

    const sales = usePaged ? pagedSales.items : legacySales.data;
    const salesLoading = usePaged ? pagedSales.isLoading : legacySales.isLoading;

    // Verificación de memoria RAM para colecciones complementarias (0 lecturas si ya se visitaron)
    const cachedProducts = useMemo(() => {
        const key = Object.keys(dataCache).find(k => k.includes('/products'));
        return key ? (dataCache[key] as Product[]) : null;
    }, [dataCache]);

    const cachedRepairs = useMemo(() => {
        const key = Object.keys(dataCache).find(k => k.includes('/repair_jobs'));
        return key ? (dataCache[key] as RepairJob[]) : null;
    }, [dataCache]);

    const cachedFiados = useMemo(() => {
        const key = Object.keys(dataCache).find(k => k.includes('/fiados'));
        return key ? (dataCache[key] as Fiado[]) : null;
    }, [dataCache]);

    const cachedExchanges = useMemo(() => {
        const key = Object.keys(dataCache).find(k => k.includes('/currency_exchanges'));
        return key ? (dataCache[key] as CurrencyExchange[]) : null;
    }, [dataCache]);

    // CARGA BAJO DEMANDA: Solo consulta si el usuario lo solicita y no está en RAM
    const shouldFetchProducts = enableDetailedAnalytics && !cachedProducts;
    const shouldFetchRepairs = enableDetailedAnalytics && !cachedRepairs;
    const shouldFetchFiados = enableDetailedAnalytics && !cachedFiados;
    const shouldFetchExchanges = enableDetailedAnalytics && !cachedExchanges;

    const productsCollection = useMemoFirebase(() => 
        (firestore && user && shouldFetchProducts) ? query(collection(firestore, "users", user.uid, "products"), limit(50)) : null,
        [firestore, user?.uid, shouldFetchProducts]
    );
    const { data: fetchedProducts, isLoading: productsLoading } = useCollection<Product>(productsCollection);

    const repairJobsCollection = useMemoFirebase(() =>
        (firestore && user && shouldFetchRepairs) ? query(collection(firestore, "users", user.uid, "repair_jobs"), orderBy("createdAt", "desc"), limit(50)) : null,
        [firestore, user?.uid, shouldFetchRepairs]
    );
    const { data: fetchedRepairs, isLoading: repairsLoading } = useCollection<RepairJob>(repairJobsCollection);

    const exchangeCollection = useMemoFirebase(() => 
        (firestore && user && shouldFetchExchanges) ? query(collection(firestore, "users", user.uid, "currency_exchanges"), orderBy("createdAt", "desc"), limit(30)) : null,
        [firestore, user?.uid, shouldFetchExchanges]
    );
    const { data: fetchedExchanges, isLoading: exchangesLoading } = useCollection<CurrencyExchange>(exchangeCollection);

    const fiadosCollection = useMemoFirebase(() => 
        (firestore && user && shouldFetchFiados) ? query(collection(firestore, "users", user.uid, "fiados"), orderBy("createdAt", "desc"), limit(30)) : null,
        [firestore, user?.uid, shouldFetchFiados]
    );
    const { data: fetchedFiados, isLoading: fiadosLoading } = useCollection<Fiado>(fiadosCollection);

    const products = cachedProducts || fetchedProducts || [];
    const repairJobs = cachedRepairs || fetchedRepairs || [];
    const exchanges = cachedExchanges || fetchedExchanges || [];
    const fiados = cachedFiados || fetchedFiados || [];

    const isDetailedLoaded = (cachedProducts || fetchedProducts) && (cachedRepairs || fetchedRepairs);

    return (
        <div className="flex-1 bg-slate-100/70 min-h-0">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-3 sm:p-6">
                {/* Encabezado ejecutivo integrado */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                            <BarChart3 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Reportes y Cierre
                            </h1>
                            <p className="text-xs text-slate-500">
                                Flujo de caja, rentabilidad por periodo, cierres y movimientos
                            </p>
                        </div>
                    </div>

                    {!isDetailedLoaded && !enableDetailedAnalytics && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEnableDetailedAnalytics(true)}
                            className="h-10 w-full sm:h-9 sm:w-auto gap-1.5 rounded-xl border-blue-200 bg-white px-3.5 text-xs font-medium text-blue-700 shadow-sm hover:bg-blue-50 hover:text-blue-800"
                        >
                            <BarChart3 className="w-3.5 h-3.5" />
                            <span>Cargar análisis detallado</span>
                        </Button>
                    )}
                </div>

                <ReportsView 
                    sales={sales || []} 
                    products={products} 
                    repairJobs={repairJobs} 
                    exchanges={exchanges} 
                    fiados={fiados} 
                    isLoading={salesLoading || productsLoading || repairsLoading || exchangesLoading || fiadosLoading}
                    salesHasMore={usePaged ? pagedSales.hasMore : false}
                    salesLoadingMore={pagedSales.isLoadingMore}
                    onLoadMoreSales={usePaged ? () => { void pagedSales.loadMore(); } : undefined}
                />
            </main>
        </div>
    )
}
