"use client";

import type { Product, Sale, DailyReconciliation, RepairJob, CurrencyExchange, Fiado } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TransactionList } from "./transaction-list";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { useMemo, useState } from "react";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { CashReconciliationDialog } from "./cash-reconciliation-dialog";
import { ReconciliationHistory } from "./reconciliation-history";
import { DateRangeReport } from "./date-range-report";
import { ExportSalesButton } from "./export-sales-button";
import { ArrowLeftRight, FileSpreadsheet, History, PieChart, Users } from "lucide-react";
import { useDashboardStore } from "@/contexts/dashboard-context";
import {
    OWNER_OPERATOR_ID,
    canOperatorPerform,
    hasCashierSystemActive,
} from "@/lib/cashiers";
import { cn } from "@/lib/utils";

type ReportsViewProps = {
    sales: Sale[];
    products: Product[];
    repairJobs: RepairJob[];
    exchanges: CurrencyExchange[];
    fiados: Fiado[];
    isLoading?: boolean;
    salesHasMore?: boolean;
    salesLoadingMore?: boolean;
    onLoadMoreSales?: () => void;
};

function matchesCashier(recordCashierId: string | undefined, targetId: string) {
    if (targetId === OWNER_OPERATOR_ID) {
        return !recordCashierId || recordCashierId === OWNER_OPERATOR_ID;
    }
    return recordCashierId === targetId;
}

export function ReportsView({
    sales, products, repairJobs, exchanges, fiados, isLoading,
    salesHasMore, salesLoadingMore, onLoadMoreSales,
}: ReportsViewProps) {
    const { firestore, user } = useFirebase();
    const { profile, activeOperator } = useDashboardStore();

    const reconciliationsCollection = useMemoFirebase(
        () => (firestore && user)
            ? query(collection(firestore, "users", user.uid, "daily_reconciliations"), orderBy("closedAt", "desc"), limit(50))
            : null,
        [firestore, user?.uid]
    );
    const { data: reconciliations, isLoading: reconciliationsLoading } = useCollection<DailyReconciliation>(reconciliationsCollection);

    const cashierMode = hasCashierSystemActive(profile);
    const canViewAll = !cashierMode || !activeOperator || activeOperator.isOwner || canOperatorPerform(activeOperator, 'canViewAllCashiersReports');
    const [selectedCashierFilter, setSelectedCashierFilter] = useState<string>('all');

    // Lista de operadores para el filtro rápido del Dueño / Encargado (0 lecturas extra)
    const cashierOptions = useMemo(() => {
        if (!cashierMode || !profile) return [];
        const ownerLabel = profile.accountName?.trim() || 'Dueño';
        const list: { id: string; label: string }[] = [
            { id: 'all', label: 'Todos' },
            { id: OWNER_OPERATOR_ID, label: ownerLabel },
        ];
        for (const c of profile.cashiers || []) {
            list.push({ id: c.id, label: c.name });
        }
        return list;
    }, [cashierMode, profile]);

    // Regla de visibilidad: un cajero normal solo ve sus propias ventas y cierres
    const effectiveFilter = useMemo(() => {
        if (!cashierMode) return 'all';
        if (!canViewAll && activeOperator) return activeOperator.id;
        return selectedCashierFilter;
    }, [cashierMode, canViewAll, activeOperator, selectedCashierFilter]);

    const visibleSales = useMemo(() => {
        if (!sales) return [];
        if (effectiveFilter === 'all') return sales;
        return sales.filter((s) => matchesCashier(s.cashierId, effectiveFilter));
    }, [sales, effectiveFilter]);

    const visibleReconciliations = useMemo(() => {
        if (!reconciliations) return [];
        if (effectiveFilter === 'all') return reconciliations;
        return reconciliations.filter((r) => matchesCashier(r.cashierId, effectiveFilter));
    }, [reconciliations, effectiveFilter]);

    // Cierre de caja: cada usuario cierra SU propia gaveta (o el gerente cierra la del cajero filtrado)
    const closingTarget = useMemo(() => {
        if (!cashierMode) {
            return {
                id: OWNER_OPERATOR_ID,
                name: profile?.accountName?.trim() || 'Dueño',
            };
        }
        if (effectiveFilter !== 'all') {
            const found = cashierOptions.find((o) => o.id === effectiveFilter);
            return {
                id: effectiveFilter,
                name: found?.label || activeOperator?.name || 'Operador',
            };
        }
        // Si el gerente está en vista "Todos", el cierre por defecto cuadra su propia gaveta
        return {
            id: activeOperator?.id || OWNER_OPERATOR_ID,
            name: activeOperator?.name || profile?.accountName?.trim() || 'Dueño',
        };
    }, [cashierMode, effectiveFilter, cashierOptions, activeOperator, profile]);

    const openSalesForClose = useMemo(() => {
        if (!sales) return [];
        const open = sales.filter((s) => s.status === 'completed' && !s.reconciliationId);
        if (!cashierMode) return open;
        return open.filter((s) => matchesCashier(s.cashierId, closingTarget.id));
    }, [sales, cashierMode, closingTarget.id]);

    return (
        <Tabs defaultValue="summary" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <TabsList className="grid w-full sm:w-auto sm:inline-grid grid-cols-3 rounded-xl border border-slate-200/90 bg-white p-1 h-auto shadow-sm">
                    <TabsTrigger
                        value="summary"
                        className="rounded-lg py-2 px-3 sm:px-5 text-xs font-medium text-slate-600 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-sm flex items-center justify-center gap-1.5"
                    >
                        <PieChart className="w-3.5 h-3.5 shrink-0" />
                        <span>Resumen</span>
                    </TabsTrigger>
                    <TabsTrigger
                        value="history"
                        className="rounded-lg py-2 px-3 sm:px-5 text-xs font-medium text-slate-600 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-sm flex items-center justify-center gap-1.5"
                    >
                        <History className="w-3.5 h-3.5 shrink-0" />
                        <span>Cierres</span>
                    </TabsTrigger>
                    <TabsTrigger
                        value="transactions"
                        className="rounded-lg py-2 px-3 sm:px-5 text-xs font-medium text-slate-600 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-sm flex items-center justify-center gap-1.5"
                    >
                        <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                        <span>Transacciones</span>
                    </TabsTrigger>
                </TabsList>

                {/* Filtro rápido por cajero para Dueño / Encargado (0 lecturas extra) */}
                {cashierMode && canViewAll && cashierOptions.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 sm:pb-0">
                        <span className="hidden items-center gap-1 text-[11px] font-medium text-slate-400 md:inline-flex">
                            <Users className="h-3.5 w-3.5" />
                            Cajero:
                        </span>
                        {cashierOptions.map((opt) => {
                            const active = selectedCashierFilter === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setSelectedCashierFilter(opt.id)}
                                    className={cn(
                                        "shrink-0 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all",
                                        active
                                            ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm"
                                            : "border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <TabsContent value="summary" className="space-y-4 mt-0">
                <CashReconciliationDialog
                    openSales={openSalesForClose}
                    targetCashierId={closingTarget.id}
                    targetCashierName={closingTarget.name}
                />
                <DateRangeReport
                    sales={visibleSales}
                    products={products || []}
                    repairJobs={repairJobs || []}
                    fiados={fiados || []}
                    reconciliations={visibleReconciliations}
                    exchanges={exchanges || []}
                    isLoading={isLoading || reconciliationsLoading}
                />
                {canViewAll && (
                    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-sm flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/80 bg-emerald-50 text-emerald-600">
                                <FileSpreadsheet className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-slate-900">Exportar ventas a Excel</h3>
                                <p className="text-xs text-slate-500">Descarga el reporte detallado de ingresos y utilidad real por rango de fechas.</p>
                            </div>
                        </div>
                        <ExportSalesButton sales={visibleSales} products={products || []} repairJobs={repairJobs || []} fiados={fiados || []} />
                    </div>
                )}
            </TabsContent>

            <TabsContent value="history" className="mt-0">
                <ReconciliationHistory reconciliations={visibleReconciliations} isLoading={reconciliationsLoading} />
            </TabsContent>

            <TabsContent value="transactions" className="mt-0">
                <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-4 py-3.5 sm:px-5">
                        <h2 className="text-sm font-semibold text-slate-900">
                            {canViewAll ? "Todas las transacciones" : "Mis transacciones"}
                        </h2>
                        <p className="text-xs text-slate-500">Registro detallado de cobros, métodos de pago, reimpresión y reembolsos.</p>
                    </div>
                    <div className="p-3.5 sm:p-5">
                        <TransactionList
                            sales={visibleSales}
                            isLoading={isLoading}
                            hasMore={salesHasMore}
                            isLoadingMore={salesLoadingMore}
                            onLoadMore={onLoadMoreSales}
                        />
                    </div>
                </div>
            </TabsContent>
        </Tabs>
    );
}
