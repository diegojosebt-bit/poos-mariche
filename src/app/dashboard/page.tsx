
"use client";

import { PageHeader } from "@/components/page-header";
import MonthlyActivityOverview from "@/components/dashboard/monthly-activity-overview";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, query, orderBy, limit } from "firebase/firestore";
import type { Sale, RepairJob } from "@/lib/types";
import { startOfMonth, isAfter, parseISO } from "date-fns";
import { useMemo } from "react";

export default function DashboardPage() {
    const { firestore, user } = useFirebase();

    // VENTAS - Usamos la consulta estándar para aprovechar el cache global (0 Lecturas si ya cargó Reportes)
    const salesCollection = useMemoFirebase(() => 
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "sale_transactions"),
            orderBy("transactionDate", "desc"),
            limit(50)
        ) : null, 
        [firestore, user?.uid]
    );
    const { data: allSales, isLoading: salesLoading } = useCollection<Sale>(salesCollection);

    // REPARACIONES - Usamos la consulta estándar para aprovechar el cache global (0 Lecturas si ya cargó Reparaciones)
    const repairJobsCollection = useMemoFirebase(() =>
        (firestore && user) ? query(
            collection(firestore, "users", user.uid, "repair_jobs"),
            orderBy("createdAt", "desc"),
            limit(100)
        ) : null,
        [firestore, user?.uid]
    );
    const { data: allRepairs, isLoading: repairsLoading } = useCollection<RepairJob>(repairJobsCollection);

    // FILTRADO LOCAL (0 LECTURAS): Procesamos el mes actual en el cliente
    const { sales, repairJobs } = useMemo(() => {
        const startOfCurrentMonth = startOfMonth(new Date());
        
        const filteredSales = (allSales || []).filter(s => 
            s.transactionDate && isAfter(parseISO(s.transactionDate), startOfCurrentMonth)
        );
        
        const filteredRepairs = (allRepairs || []).filter(r => 
            r.createdAt && isAfter(parseISO(r.createdAt), startOfCurrentMonth)
        );

        return { sales: filteredSales, repairJobs: filteredRepairs };
    }, [allSales, allRepairs]);

    const isLoading = salesLoading || repairsLoading;

    return (
        <>
            <PageHeader title="Panel de Control" />
            <main className="flex-1 p-4 sm:p-6">
                <MonthlyActivityOverview 
                    sales={sales} 
                    repairJobs={repairJobs} 
                    isLoading={isLoading}
                />
            </main>
        </>
    );
}
