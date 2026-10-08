"use client";

import { PageHeader } from "@/components/page-header";
import { AnalysisView } from "@/components/analysis/analysis-view";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import type { Product } from "@/lib/types";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { SecurityGate } from "@/components/security-gate";
import { useMemo } from "react";

export default function AnalysisPage() {
    return (
        <SecurityGate module="analysis">
            <AnalysisContent />
        </SecurityGate>
    );
}

function AnalysisContent() {
    const { firestore, user } = useFirebase();

    // ESTANDARIZADO: Consumimos el mismo cache de productos que el POS e Inventario (0 lecturas si ya se visitaron)
    const productsQuery = useMemoFirebase(() => 
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "products"), 
            orderBy("name"), 
            limit(200)
        ) : null, 
        [firestore, user?.uid]
    );
    const { data: products, isLoading } = useCollection<Product>(productsQuery);

    // PANEL 1: Top 10 más vendidos (Filtrado local para ahorrar lecturas)
    const topProducts = useMemo(() => {
        if (!products) return [];
        return [...products]
            .sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))
            .slice(0, 10);
    }, [products]);

    // PANEL 2: Productos estancados (Con stock pero sin salida - Filtrado local)
    const stagnantProducts = useMemo(() => {
        if (!products) return [];
        return products
            .filter(p => p.stockLevel > 0)
            .sort((a, b) => b.stockLevel - a.stockLevel)
            .slice(0, 15);
    }, [products]);

    return (
        <>
            <PageHeader title="Inteligencia de Inventario" />
            <main className="flex-1 p-4 sm:p-6">
                <AnalysisView 
                    topProducts={topProducts} 
                    stagnantProducts={stagnantProducts}
                    isLoading={isLoading}
                />
            </main>
        </>
    )
}
