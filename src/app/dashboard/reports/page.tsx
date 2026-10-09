"use client";

import { PageHeader } from "@/components/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import type { Product, Sale, RepairJob, CurrencyExchange, Fiado } from "@/lib/types";
import { collection, query, orderBy, limit } from "firebase/firestore";
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
    const { dataCache } = useDashboardStore();
    const [enableDetailedAnalytics, setEnableDetailedAnalytics] = useState(false);
    
    // Consulta base de ventas (para transacciones y arqueo de caja)
    const salesCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "sale_transactions"), orderBy("transactionDate", "desc"), limit(50)) : null, 
        [firestore, user?.uid]
    );
    const { data: sales, isLoading: salesLoading } = useCollection<Sale>(salesCollection);

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
        <>
            <PageHeader title="Reportes">
                {!isDetailedLoaded && !enableDetailedAnalytics && (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setEnableDetailedAnalytics(true)}
                        className="h-8 text-xs font-bold border-primary/30 text-primary"
                    >
                        <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                        Cargar Análisis Detallado
                    </Button>
                )}
            </PageHeader>
            <main className="flex-1 p-4 sm:p-6">
                <ReportsView 
                    sales={sales || []} 
                    products={products} 
                    repairJobs={repairJobs} 
                    exchanges={exchanges} 
                    fiados={fiados} 
                    isLoading={salesLoading || productsLoading || repairsLoading || exchangesLoading || fiadosLoading}
                />
            </main>
        </>
    )
}
