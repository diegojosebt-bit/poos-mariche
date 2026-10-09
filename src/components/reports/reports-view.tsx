"use client"

import type { Product, Sale, DailyReconciliation, RepairJob, CurrencyExchange, Fiado } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { TransactionList } from "./transaction-list"
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase"
import { useMemo } from "react"
import { collection, query, orderBy, limit } from "firebase/firestore"
import { CashReconciliationDialog } from "./cash-reconciliation-dialog"
import { ReconciliationHistory } from "./reconciliation-history"
import { DateRangeReport } from "./date-range-report"
import { ExportSalesButton } from "./export-sales-button"
import { ArrowLeftRight, History, PieChart } from "lucide-react"

type ReportsViewProps = {
    sales: Sale[];
    products: Product[];
    repairJobs: RepairJob[];
    exchanges: CurrencyExchange[];
    fiados: Fiado[];
    isLoading?: boolean;
}

export function ReportsView({ sales, products, repairJobs, exchanges, fiados, isLoading }: ReportsViewProps) {
    const { firestore, user } = useFirebase();

    const reconciliationsCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "daily_reconciliations"), orderBy("closedAt", "desc"), limit(50)) : null,
        [firestore, user?.uid]
    );
    const { data: reconciliations, isLoading: reconciliationsLoading } = useCollection<DailyReconciliation>(reconciliationsCollection);

    const openSales = useMemo(() => {
        if (!sales) return [];
        return sales.filter(s => s.status === 'completed' && !s.reconciliationId);
    }, [sales]);

    return (
        <Tabs defaultValue="summary">
            <TabsList className="grid w-full grid-cols-3 bg-muted/50 p-1 h-auto">
                <TabsTrigger value="summary" className="py-2 text-[10px] sm:text-xs font-black uppercase flex items-center justify-center gap-1.5">
                    <PieChart className="w-3.5 h-3.5" />
                    Resumen
                </TabsTrigger>
                <TabsTrigger value="history" className="py-2 text-[10px] sm:text-xs font-black uppercase flex items-center justify-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Cierres
                </TabsTrigger>
                <TabsTrigger value="transactions" className="py-2 text-[10px] sm:text-xs font-black uppercase flex items-center justify-center gap-1.5">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Transacciones
                </TabsTrigger>
            </TabsList>
            
            <TabsContent value="summary" className="space-y-4 mt-4">
                 <CashReconciliationDialog openSales={openSales} />
                 <DateRangeReport sales={sales || []} products={products || []} repairJobs={repairJobs || []} fiados={fiados || []} reconciliations={reconciliations || []} exchanges={exchanges || []} isLoading={isLoading || reconciliationsLoading} />
                 <Card>
                     <CardHeader>
                         <CardTitle>Exportar Ventas</CardTitle>
                         <CardDescription>Reporte detallado de movimientos.</CardDescription>
                     </CardHeader>
                     <CardContent>
                         <ExportSalesButton sales={sales || []} products={products || []} repairJobs={repairJobs || []} fiados={fiados || []} />
                     </CardContent>
                 </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-4">
                 <ReconciliationHistory reconciliations={reconciliations || []} isLoading={reconciliationsLoading} />
            </TabsContent>

            <TabsContent value="transactions" className="mt-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Todas las Transacciones</CardTitle>
                        <CardDescription>Registro completo y detallado de transacciones de ventas.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <TransactionList sales={sales || []} isLoading={isLoading} />
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
}
