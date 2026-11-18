"use client";

import { useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { addMonths, format } from "date-fns";
import { es } from "date-fns/locale";
import { DailySalesChart } from "@/components/analysis/daily-sales-chart";
import {
    BarChart3,
    Calendar,
    ChevronLeft,
    ChevronRight,
    CreditCard,
    DollarSign,
    Receipt,
    Scale,
    TrendingUp,
    Wallet,
} from "lucide-react";
import { SecurityGate } from "@/components/security-gate";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDoc, useFirebase, useMemoFirebase } from "@/firebase";
import { useCurrency } from "@/hooks/use-currency";
import { monthKey } from "@/lib/firestore/rollups";
import { cn } from "@/lib/utils";

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

const USD_METHODS = new Set(['cashUSD', 'crypto']);

function capitalizeFirst(text: string) {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

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
    const monthLabel = capitalizeFirst(format(monthDate, 'MMMM yyyy', { locale: es }));
    const shortMonthLabel = capitalizeFirst(format(monthDate, 'MMM yyyy', { locale: es }));

    const statsRef = useMemoFirebase(
        () => (firestore && user ? doc(firestore, 'users', user.uid, 'stats_monthly', monthId) : null),
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
    const netResult = profit - expenses;

    const days = useMemo(() => {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const total = new Date(year, month + 1, 0).getDate();

        return Array.from({ length: total }, (_, index) => {
            const dayNumber = String(index + 1).padStart(2, '0');
            const entry = stats?.byDay?.[dayNumber];
            return {
                day: dayNumber,
                value: Number(entry?.salesUSD || 0),
                profit: Number(entry?.profitUSD || 0),
                count: Number(entry?.count || 0),
            };
        });
    }, [monthDate, stats]);

    const maxDay = Math.max(1, ...days.map((day) => day.value));

    const { usdMethods, bsMethods, maxUsdMethod, maxBsMethod } = useMemo(() => {
        const entries = Object.entries(stats?.byMethod ?? {})
            .filter(([, amount]) => Number(amount) !== 0)
            .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])));

        const usd = entries.filter(([key]) => USD_METHODS.has(key));
        const bs = entries.filter(([key]) => !USD_METHODS.has(key));

        return {
            usdMethods: usd,
            bsMethods: bs,
            maxUsdMethod: Math.max(1, ...usd.map(([, val]) => Math.abs(Number(val)))),
            maxBsMethod: Math.max(1, ...bs.map(([, val]) => Math.abs(Number(val)))),
        };
    }, [stats]);

    const hasData = !!stats && (count > 0 || expenses > 0 || usdMethods.length > 0 || bsMethods.length > 0);
    const symbol = getSymbol();

    return (
        <div className="min-h-0 flex-1 bg-slate-100/70">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 pb-20 sm:px-6 sm:py-6">
                {/* Encabezado ejecutivo integrado */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                            <BarChart3 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Análisis de Negocio
                            </h1>
                            <p className="text-xs text-slate-500">
                                Desempeño mensual, rentabilidad y métodos de cobro
                            </p>
                        </div>
                    </div>

                    {/* Selector de mes estilo píldora 2026 */}
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                        {monthOffset < 0 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setMonthOffset(0)}
                                className="h-9 rounded-xl border-slate-200/80 bg-white px-3 text-xs font-medium text-blue-600 shadow-sm hover:bg-blue-50"
                            >
                                Mes actual
                            </Button>
                        )}
                        <div className="inline-flex flex-1 items-center justify-between gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm sm:flex-initial">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                onClick={() => setMonthOffset((value) => value - 1)}
                                aria-label="Mes anterior"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="flex min-w-[126px] items-center justify-center gap-1.5 px-2 text-xs font-semibold text-slate-800">
                                <Calendar className="h-3.5 w-3.5 text-blue-600" />
                                <span className="sm:hidden">{shortMonthLabel}</span>
                                <span className="hidden sm:inline">{monthLabel}</span>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35"
                                onClick={() => setMonthOffset((value) => Math.min(0, value + 1))}
                                disabled={monthOffset >= 0}
                                aria-label="Mes siguiente"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <Skeleton key={index} className="h-24 w-full rounded-2xl bg-white" />
                            ))}
                        </div>
                        <div className="grid gap-5 lg:grid-cols-3">
                            <Skeleton className="h-72 w-full rounded-2xl bg-white lg:col-span-2" />
                            <Skeleton className="h-72 w-full rounded-2xl bg-white" />
                        </div>
                    </div>
                ) : !hasData ? (
                    <section className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/90 bg-white/80 px-6 py-14 text-center shadow-sm">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200/80 bg-blue-50 text-blue-600">
                            <BarChart3 className="h-5 w-5" />
                        </div>
                        <h2 className="text-sm font-semibold text-slate-900">
                            Sin datos registrados en {monthLabel}
                        </h2>
                        <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                            Los totales se construyen automáticamente con las ventas y gastos del mes. Si consultas un mes
                            anterior a la activación de los agregados, puedes reconstruir las estadísticas.
                        </p>
                    </section>
                ) : (
                    <>
                        {/* 4 KPIs ejecutivos compactos (2x2 móvil, 4 cols escritorio) */}
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {/* Ventas */}
                            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-500">Ventas del mes</span>
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                        <DollarSign className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                                <p className="mt-2 truncate text-lg font-semibold tracking-tight tabular-nums text-slate-900 sm:text-2xl">
                                    {symbol}
                                    {formatCurrency(sales)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                    {count} {count === 1 ? "venta" : "ventas"}
                                </p>
                            </div>

                            {/* Utilidad */}
                            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-500">Utilidad bruta</span>
                                    <div
                                        className={cn(
                                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                                            profit >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600",
                                        )}
                                    >
                                        <TrendingUp className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                                <p
                                    className={cn(
                                        "mt-2 truncate text-lg font-semibold tracking-tight tabular-nums sm:text-2xl",
                                        profit >= 0 ? "text-emerald-700" : "text-rose-600",
                                    )}
                                >
                                    {symbol}
                                    {formatCurrency(profit)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                    Margen <span className="font-medium text-slate-700">{margin.toFixed(1)}%</span>
                                </p>
                            </div>

                            {/* Gastos */}
                            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-500">Gastos</span>
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                                        <Receipt className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                                <p className="mt-2 truncate text-lg font-semibold tracking-tight tabular-nums text-rose-600 sm:text-2xl">
                                    {symbol}
                                    {formatCurrency(expenses)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-500">Egresos del mes</p>
                            </div>

                            {/* Ticket promedio */}
                            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-500">Ticket promedio</span>
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                                        <Wallet className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                                <p className="mt-2 truncate text-lg font-semibold tracking-tight tabular-nums text-slate-900 sm:text-2xl">
                                    {symbol}
                                    {formatCurrency(ticket)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-500">Promedio por venta</p>
                            </div>
                        </div>

                        {/* Bento principal: Gráfica diaria + Métodos de pago y balance */}
                        <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
                            {/* Gráfica de ventas diarias */}
                            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm lg:col-span-2">
                                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                                    <div className="min-w-0">
                                        <h2 className="text-sm font-semibold text-slate-900">Ventas por día</h2>
                                        <p className="text-xs text-slate-500">
                                            Toca o pasa el cursor sobre el gráfico para ver el detalle diario
                                        </p>
                                    </div>
                                    <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                                        {monthLabel}
                                    </span>
                                </div>
                                <div className="p-4 sm:p-5">
                                    <DailySalesChart
                                        days={days}
                                        maxDay={maxDay}
                                        symbol={symbol}
                                        format={formatCurrency}
                                    />
                                </div>
                            </section>

                            {/* Métodos de pago y balance neto */}
                            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                                <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                                        <CreditCard className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-sm font-semibold text-slate-900">Métodos de pago</h2>
                                        <p className="text-xs text-slate-500">Ingresos netos del mes</p>
                                    </div>
                                </div>

                                <div className="space-y-4 p-5">
                                    {usdMethods.length === 0 && bsMethods.length === 0 ? (
                                        <p className="py-4 text-center text-xs text-slate-500">
                                            Sin pagos registrados en este mes.
                                        </p>
                                    ) : (
                                        <>
                                            {usdMethods.length > 0 && (
                                                <div className="space-y-2.5">
                                                    <p className="text-[11px] font-medium text-slate-400">En divisas ($)</p>
                                                    {usdMethods.map(([method, amount]) => {
                                                        const num = Number(amount);
                                                        const pct = Math.min(100, Math.max(6, (Math.abs(num) / maxUsdMethod) * 100));
                                                        return (
                                                            <div key={method} className="space-y-1">
                                                                <div className="flex items-center justify-between gap-2 text-xs">
                                                                    <span className="font-medium text-slate-700">
                                                                        {METHOD_LABELS[method] ?? method}
                                                                    </span>
                                                                    <span className="font-semibold tabular-nums text-slate-900">
                                                                        ${formatCurrency(num)}
                                                                    </span>
                                                                </div>
                                                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                                                    <div
                                                                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500"
                                                                        style={{ width: `${pct}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {bsMethods.length > 0 && (
                                                <div className={cn("space-y-2.5", usdMethods.length > 0 && "border-t border-slate-100 pt-3.5")}>
                                                    <p className="text-[11px] font-medium text-slate-400">En bolívares (Bs)</p>
                                                    {bsMethods.map(([method, amount]) => {
                                                        const num = Number(amount);
                                                        const pct = Math.min(100, Math.max(6, (Math.abs(num) / maxBsMethod) * 100));
                                                        return (
                                                            <div key={method} className="space-y-1">
                                                                <div className="flex items-center justify-between gap-2 text-xs">
                                                                    <span className="font-medium text-slate-700">
                                                                        {METHOD_LABELS[method] ?? method}
                                                                    </span>
                                                                    <span className="font-semibold tabular-nums text-emerald-700">
                                                                        Bs {formatCurrency(num)}
                                                                    </span>
                                                                </div>
                                                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                                                    <div
                                                                        className="h-full rounded-full bg-emerald-500"
                                                                        style={{ width: `${pct}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Balance neto (Utilidad - Gastos) */}
                                    <div
                                        className={cn(
                                            "flex items-center justify-between gap-3 rounded-xl border p-3",
                                            netResult >= 0
                                                ? "border-emerald-200/70 bg-emerald-50/40"
                                                : "border-rose-200/70 bg-rose-50/40",
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Scale
                                                className={cn(
                                                    "h-4 w-4 shrink-0",
                                                    netResult >= 0 ? "text-emerald-600" : "text-rose-600",
                                                )}
                                            />
                                            <div>
                                                <p className="text-xs font-semibold text-slate-800">Balance neto</p>
                                                <p className="text-[11px] text-slate-500">Utilidad menos gastos</p>
                                            </div>
                                        </div>
                                        <span
                                            className={cn(
                                                "text-sm font-semibold tabular-nums",
                                                netResult >= 0 ? "text-emerald-700" : "text-rose-700",
                                            )}
                                        >
                                            {netResult >= 0 ? "+" : ""}
                                            {symbol}
                                            {formatCurrency(netResult)}
                                        </span>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
