"use client";

import { PageHeader } from "@/components/page-header";
import MonthlyActivityOverview, { type MonthlyDayPoint } from "@/components/dashboard/monthly-activity-overview";
import { useDoc, useFirebase, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { monthKey } from "@/lib/firestore/rollups";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useMemo } from "react";

type MonthlyStats = {
    salesUSD?: number;
    salesCount?: number;
    profitUSD?: number;
    expensesUSD?: number;
    byDay?: Record<string, { salesUSD?: number; profitUSD?: number; count?: number }>;
};

export default function DashboardPage() {
    const { firestore, user } = useFirebase();
    const now = useMemo(() => new Date(), []);

    const statsRef = useMemoFirebase(
        () => (firestore && user)
            ? doc(firestore, 'users', user.uid, 'stats_monthly', monthKey(now))
            : null,
        [firestore, user?.uid],
    );

    // 1 lectura por mes. Antes: 50 ventas + 100 reparaciones.
    const { data: stats, isLoading } = useDoc<MonthlyStats>(statsRef);

    const days: MonthlyDayPoint[] = useMemo(() => {
        const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        return Array.from({ length: total }, (_, index) => {
            const day = String(index + 1).padStart(2, '0');
            const point = stats?.byDay?.[day];

            return {
                name: day,
                ventas: Number(point?.salesUSD || 0),
                utilidad: Number(point?.profitUSD || 0),
            };
        });
    }, [stats, now]);

    return (
        <>
            <PageHeader title="Panel de Control" />
            <main className="flex-1 p-4 sm:p-6 space-y-4">
                <MonthlyActivityOverview
                    monthLabel={format(now, 'MMMM yyyy', { locale: es })}
                    days={days}
                    isLoading={isLoading}
                />
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Datos agregados del mes · 1 lectura por mes
                </p>
            </main>
        </>
    );
}
