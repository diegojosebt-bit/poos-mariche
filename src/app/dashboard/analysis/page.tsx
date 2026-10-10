"use client";

import { PageHeader } from "@/components/page-header";
import { AnalysisView } from "@/components/analysis/analysis-view";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import type { Product } from "@/lib/types";
import { collection } from "firebase/firestore";
import { SecurityGate } from "@/components/security-gate";
import { useMemo } from "react";
import { useCurrency } from "@/hooks/use-currency";
import { differenceInDays, parseISO } from "date-fns";

export default function AnalysisPage() {
    return (
        <SecurityGate module="analysis">
            <AnalysisContent />
        </SecurityGate>
    );
}

function AnalysisContent() {
    const { firestore, user } = useFirebase();
    const { getFinalPrice, bcvRate, parallelRate } = useCurrency();

    // GARANTÍA CERO LECTURAS ADICIONALES:
    // Reutiliza la misma referencia exacta a `users/{uid}/products` que usan el POS y el módulo de Inventario.
    // Al acceder a esta pantalla, useCollection detecta la memoria RAM (dataCache) y retorna los datos al instante (0ms, 0 lecturas).
    const productsCollection = useMemoFirebase(() => 
        (firestore && user) ? collection(firestore, "users", user.uid, "products") : null, 
        [firestore, user?.uid]
    );
    const { data: rawProducts, isLoading } = useCollection<Product>(productsCollection);

    const products = useMemo(() => {
        if (!rawProducts) return [];
        return rawProducts.filter(p => !p.isDeleted);
    }, [rawProducts]);

    // CÁLCULOS FINANCIEROS Y AUDITORÍA EN MEMORIA (0 Firestore Reads)
    const metrics = useMemo(() => {
        let totalItems = 0;
        let totalStockUnits = 0;
        let totalCostUSD = 0;
        let totalRetailUSD = 0;
        let stagnantCostUSD = 0;
        let stagnantCount = 0;
        let criticalStockCount = 0;

        const now = new Date();

        products.forEach(p => {
            totalItems += 1;
            const availableStock = Math.max(0, (p.stockLevel || 0) - (p.reservedStock || 0));
            const cost = p.costPrice || 0;
            const finalPrice = getFinalPrice(p);

            totalStockUnits += availableStock;
            totalCostUSD += cost * availableStock;
            totalRetailUSD += finalPrice * availableStock;

            // Antigüedad y estancamiento (> 30 días sin ventas o creado hace >30 días con stock)
            const daysInStock = p.createdAt ? differenceInDays(now, parseISO(p.createdAt)) : 0;
            if (daysInStock > 30 && availableStock > 0 && (!p.salesCount || p.salesCount === 0)) {
                stagnantCostUSD += cost * availableStock;
                stagnantCount += 1;
            }

            // Alerta de stock crítico
            const threshold = p.lowStockThreshold || 3;
            if (availableStock <= threshold) {
                criticalStockCount += 1;
            }
        });

        const totalCostBs = totalCostUSD * (parallelRate || bcvRate || 1);
        const totalRetailBs = totalRetailUSD * (bcvRate || 1);
        const potentialProfitUSD = Math.max(0, totalRetailUSD - totalCostUSD);
        const potentialProfitBs = Math.max(0, totalRetailBs - totalCostBs);
        const potentialMarginPercent = totalCostUSD > 0 
            ? ((potentialProfitUSD / totalCostUSD) * 100) 
            : 0;

        return {
            totalItems,
            totalStockUnits,
            totalCostUSD,
            totalCostBs,
            totalRetailUSD,
            totalRetailBs,
            potentialProfitUSD,
            potentialProfitBs,
            potentialMarginPercent,
            stagnantCostUSD,
            stagnantCount,
            criticalStockCount
        };
    }, [products, getFinalPrice, bcvRate, parallelRate]);

    // TOP 10 MÁS VENDIDOS (Procesado 100% en cliente)
    const topProducts = useMemo(() => {
        return [...products]
            .sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))
            .slice(0, 10);
    }, [products]);

    // PRODUCTOS ESTANCADOS (> 30 días o mayor stock acumulado sin salir)
    const stagnantProducts = useMemo(() => {
        const now = new Date();
        return products
            .filter(p => {
                const available = (p.stockLevel || 0) - (p.reservedStock || 0);
                if (available <= 0) return false;
                const days = p.createdAt ? differenceInDays(now, parseISO(p.createdAt)) : 0;
                return days > 30 || (!p.salesCount || p.salesCount === 0);
            })
            .sort((a, b) => {
                const stockA = (a.stockLevel || 0) - (a.reservedStock || 0);
                const stockB = (b.stockLevel || 0) - (b.reservedStock || 0);
                return stockB - stockA;
            })
            .slice(0, 15);
    }, [products]);

    // PRODUCTOS CRÍTICOS (Stock por agotarse o agotado)
    const criticalProducts = useMemo(() => {
        return products
            .filter(p => {
                const available = (p.stockLevel || 0) - (p.reservedStock || 0);
                const threshold = p.lowStockThreshold || 3;
                return available <= threshold;
            })
            .sort((a, b) => {
                const stockA = (a.stockLevel || 0) - (a.reservedStock || 0);
                const stockB = (b.stockLevel || 0) - (b.reservedStock || 0);
                return stockA - stockB;
            })
            .slice(0, 20);
    }, [products]);

    // DESGLOSE FINANCIERO POR CATEGORÍA
    const categoryBreakdown = useMemo(() => {
        const map = new Map<string, { count: number; costUSD: number; retailUSD: number }>();

        products.forEach(p => {
            const cat = p.category || "General";
            const current = map.get(cat) || { count: 0, costUSD: 0, retailUSD: 0 };
            const availableStock = Math.max(0, (p.stockLevel || 0) - (p.reservedStock || 0));
            const cost = (p.costPrice || 0) * availableStock;
            const retail = getFinalPrice(p) * availableStock;

            map.set(cat, {
                count: current.count + 1,
                costUSD: current.costUSD + cost,
                retailUSD: current.retailUSD + retail,
            });
        });

        return Array.from(map.entries())
            .map(([category, stats]) => ({
                category,
                ...stats,
            }))
            .sort((a, b) => b.costUSD - a.costUSD);
    }, [products, getFinalPrice]);

    return (
        <>
            <PageHeader title="Análisis de Negocio" />
            <main className="flex-1 p-4 sm:p-6">
                <AnalysisView 
                    products={products}
                    topProducts={topProducts} 
                    stagnantProducts={stagnantProducts}
                    criticalProducts={criticalProducts}
                    metrics={metrics}
                    categoryBreakdown={categoryBreakdown}
                    isLoading={isLoading}
                />
            </main>
        </>
    );
}
