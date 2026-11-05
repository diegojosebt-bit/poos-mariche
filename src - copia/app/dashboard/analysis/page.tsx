"use client";

import { useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { addMonths, format } from "date-fns";
import { es } from "date-fns/locale";
import {
    BarChart3,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    Receipt,
    TrendingUp,
    Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SecurityGate } from "@/components/security-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDoc, useFirebase, useMemoFirebase } from "@/firebase";
import { useCurrency } from "@/hooks/use-currency";
import { monthKey } from "@/lib/firestore/rollups";

type MonthlyStats = {
    salesUSD?: number;
    salesCount?: number;
    costUSD?: number;
    profitUSD?: number;
    expensesUSD?: number;
    expensesBs?: number;
    byMethod?: Record<string, number>;
    byDay?: Record<string, { salesUSD?: number; profitUSD?: number; count?: number }>;
};

const METHOD_LABELS: Record<string, string> = {
    cashUSD: 'Efectivo USD',
    cashBs: 'Efectivo Bs',
    card: 'Tarjeta',
    mobile: 'Pago Móvil',
    transfer: 'Transferencia',
    crypto: 'USDT / Crypto',
    other: 'Otros',
};

export default function AnalysisPage() {
    return (
        <SecurityGate module="analysis">
            <AnalysisContent />
        </SecurityGate>
    );
}

function AnalysisContent() {
    const { firestore, user } = useFirebase();
    const { format: formatCurrency, getSymbol } = useCurrency();
    const [monthOffset, setMonthOffset] = useState(0);

    const monthDate = useMemo(() => addMonths(new Date(), monthOffset), [monthOffset]);
    const monthId = monthKey(monthDate);

    const statsRef = useMemoFirebase(
        () => (firestore && user) ? doc(firestore, 'users', user.uid, 'stats_monthly', monthId) : null,
        [firestore, user?.uid, monthId],
    );

    // 1 lectura por mes consultado. Revisitar el mismo mes = 0.
    const { data: stats, isLoading } = useDoc<MonthlyStats>(statsRef);

    const sales = Number(stats?.salesUSD || 0);
    const profit = Number(stats?.profitUSD || 0);
    const expenses = Number(stats?.expensesUSD || 0);
    const count = Number(stats?.salesCount || 0);
    const ticket = count > 0 ? sales / count : 0;
    const margin = sales > 0 ? (profit / sales) * 100 : 0;

    const days = useMemo(() => {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const total = new Date(year, month + 1, 0).getDate();

        return Array.from({ length: total }, (_, index) => {
            const dayNumber = String(index + 1).padStart(2, '0');
            const value = Number(stats?.byDay?.[dayNumber]?.salesUSD || 0);
            return { day: dayNumber, value };
        });
    }, [monthDate, stats]);

    const maxDay = Math.max(1, ...days.map((day) => day.value));
    const methods = Object.entries(stats?.byMethod ?? {})
        .filter(([, amount]) => Number(amount) !== 0)
        .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])));

    const hasData = !!stats && (count > 0 || expenses > 0 || methods.length > 0);

    return (
        <>
            <PageHeader title="Análisis de Negocio">
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset((value) => value - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[130px] text-center text-xs font-black uppercase text-slate-700">
                        {format(monthDate, 'MMMM yyyy', { locale: es })}
                    </span>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setMonthOffset((value) => Math.min(0, value + 1))}
                        disabled={monthOffset >= 0}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </PageHeader>

            <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Resumen agregado del mes · 1 lectura por mes consultado
                </p>

                {isLoading ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <Skeleton key={index} className="h-28 w-full" />
                        ))}
                    </div>
                ) : !hasData ? (
                    <Card className="border-dashed">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <BarChart3 className="h-5 w-5 text-primary" /> Sin datos para este mes
                            </CardTitle>
                            <CardDescription>
                                Los totales se generan con las ventas y gastos del mes. Si el mes es anterior a la
                                activación de los agregados, ejecuta la reconstrucción de stats.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                ) : (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <CardHeader className="pb-1">
                                    <CardDescription className="flex items-center gap-1 text-[10px] font-black uppercase">
                                        <DollarSign className="h-3 w-3" /> Ventas del mes
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-black">{getSymbol()}{formatCurrency(sales)}</p>
                                    <p className="text-[10px] font-bold text-muted-foreground">{count} ventas</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-1">
                                    <CardDescription className="flex items-center gap-1 text-[10px] font-black uppercase">
                                        <TrendingUp className="h-3 w-3" /> Utilidad
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className={profit >= 0 ? 'text-2xl font-black text-green-600' : 'text-2xl font-black text-destructive'}>
                                        {getSymbol()}{formatCurrency(profit)}
                                    </p>
                                    <p className="text-[10px] font-bold text-muted-foreground">Margen {margin.toFixed(1)}%</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-1">
                                    <CardDescription className="flex items-center gap-1 text-[10px] font-black uppercase">
                                        <Receipt className="h-3 w-3" /> Gastos
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-black text-destructive">{getSymbol()}{formatCurrency(expenses)}</p>
                                    <p className="text-[10px] font-bold text-muted-foreground">Egresos del mes</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-1">
                                    <CardDescription className="flex items-center gap-1 text-[10px] font-black uppercase">
                                        <Wallet className="h-3 w-3" /> Ticket promedio
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-black">{getSymbol()}{formatCurrency(ticket)}</p>
                                    <p className="text-[10px] font-bold text-muted-foreground">Por venta</p>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                            <Card className="lg:col-span-2">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-black uppercase">Ventas por día</CardTitle>
                                    <CardDescription className="text-[10px]">Del 1 al último día del mes.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex h-40 items-end gap-1">
                                        {days.map((day) => (
                                            <div key={day.day} className="group flex flex-1 flex-col items-center justify-end gap-1">
                                                <div
                                                    className="w-full rounded-t bg-primary/70 transition-all group-hover:bg-primary"
                                                    style={{ height: `${Math.max(2, (day.value / maxDay) * 100)}%` }}
                                                    title={`${day.day}: ${getSymbol()}${formatCurrency(day.value)}`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex justify-between text-[9px] font-bold text-muted-foreground">
                                        <span>1</span>
                                        <span>{format(monthDate, 'MMMM', { locale: es })}</span>
                                        <span>{days.length}</span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-black uppercase">Métodos de pago</CardTitle>
                                    <CardDescription className="text-[10px]">Neto del mes.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {methods.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">Sin pagos registrados.</p>
                                    ) : (
                                        methods.map(([method, amount]) => (
                                            <div key={method} className="flex items-center justify-between gap-2 text-xs">
                                                <span className="font-bold uppercase text-slate-600">
                                                    {METHOD_LABELS[method] ?? method}
                                                </span>
                                                <span className="font-mono font-bold">
                                                    {method === 'cashUSD' || method === 'crypto' ? '$' : 'Bs '}
                                                    {formatCurrency(Number(amount))}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </>
                )}
            </main>
        </>
    );
}
