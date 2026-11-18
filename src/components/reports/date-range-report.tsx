"use client";

import { useState, useMemo } from "react";
import type { Sale, Product, DailyReconciliation, RepairJob, CurrencyExchange, Fiado } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { DateRange } from "react-day-picker";
import { format, startOfDay, endOfDay, isWithinInterval, addWeeks, isAfter, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "../ui/button";
import { CalendarIcon, Landmark, DollarSign, Info, Sigma, TrendingUp, ShoppingBag, Package, CreditCard, Smartphone, Banknote } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { Skeleton } from "../ui/skeleton";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Badge } from "../ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "../ui/table";
import { useDailyStatsRange } from '@/lib/firestore/stats-range';
import { useIsMobile } from "@/hooks/use-mobile";

type DateRangeReportProps = {
    sales: Sale[];
    products: Product[];
    reconciliations: DailyReconciliation[];
    repairJobs: RepairJob[];
    exchanges: CurrencyExchange[];
    fiados: Fiado[];
    isLoading?: boolean;
};

const methodIcons: Record<string, any> = {
    'Efectivo Bs': Landmark,
    'Tarjeta': CreditCard,
    'Pago Móvil': Smartphone,
    'Transferencia': Banknote,
    'Tarjeta / Pago Móvil': Smartphone,
};

const methodStyles: Record<string, { color: string, bg: string, border: string }> = {
    'Efectivo Bs': { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    'Tarjeta': { color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
    'Pago Móvil': { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
    'Transferencia': { color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
    'Tarjeta / Pago Móvil': { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
};

export function DateRangeReport({ sales, products, reconciliations, repairJobs, exchanges, fiados, isLoading }: DateRangeReportProps) {
    const isMobile = useIsMobile();
    const { format: formatCurrency, getSymbol, convert, settings } = useCurrency();
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
    });

    const {
        stats: rangeAggregate,
        hasData: hasRangeStats,
        isLoading: isRangeLoading,
    } = useDailyStatsRange(date?.from, date?.to || date?.from);

    const stats = useMemo(() => {
        const empty = {
            totalSales: 0,
            totalProfit: 0,
            totalReconciliationDifference: 0,
            adjustedTotalSales: 0,
            transactionCount: 0,
            bsBreakdown: {} as Record<string, number>,
            usdNet: 0,
            itemsBreakdown: [] as any[],
            totalProductCosts: 0,
            dateRangeLabel: '',
        };

        if (!date?.from || !settings) return empty;

        const from = startOfDay(date.from);
        const to = endOfDay(date.to || date.from);

        // Fase 4: totales desde agregados (1 lectura por día del rango).
        if (hasRangeStats && rangeAggregate) {
            const bsBreakdown: Record<string, number> = {
                'Efectivo Bs': rangeAggregate.byMethod.cashBs ?? 0,
                'Tarjeta': rangeAggregate.byMethod.card ?? 0,
                'Pago Móvil': rangeAggregate.byMethod.mobile ?? 0,
                'Transferencia': rangeAggregate.byMethod.transfer ?? 0,
            };
            const usdNet = rangeAggregate.byMethod.cashUSD ?? 0;

            const itemsBreakdown = Object.entries(rangeAggregate.items)
                .map(([key, item]) => ({
                    key,
                    name: item.n || key,
                    quantity: item.q,
                    totalCost: item.cost,
                    totalRevenue: item.rev,
                    profit: item.rev - item.cost,
                    isRepair: false,
                    isWarranty: false,
                }))
                .sort((a, b) => b.totalRevenue - a.totalRevenue);

            const filteredReconciliations = (reconciliations || []).filter(r => {
                const reconDate = new Date(r.date);
                return isWithinInterval(reconDate, { start: from, end: to });
            });

            return {
                totalSales: rangeAggregate.salesUSD,
                totalProfit: rangeAggregate.profitUSD,
                totalReconciliationDifference: filteredReconciliations.reduce((sum, r) => sum + r.totalDifference, 0),
                adjustedTotalSales: usdNet + convert(Object.values(bsBreakdown).reduce((a, b) => a + b, 0), 'Bs', 'USD', true),
                transactionCount: rangeAggregate.salesCount,
                bsBreakdown,
                usdNet,
                itemsBreakdown,
                totalProductCosts: rangeAggregate.costUSD,
                dateRangeLabel: date.to
                    ? `${format(from, "dd/MM/yy")} al ${format(to, "dd/MM/yy")}`
                    : format(from, "dd/MM/yy"),
            };
        }

        if (!sales || !repairJobs || !products) return empty;

        const bsBreakdown: Record<string, number> = { 
            'Efectivo Bs': 0, 
            'Tarjeta': 0,
            'Pago Móvil': 0,
            'Transferencia': 0 
        };
        let usdNet = 0;

        const filteredSales = sales.filter(s => {
            if (!s.transactionDate) return false;
            return isWithinInterval(new Date(s.transactionDate), { start: from, end: to });
        });

        const itemsMap = new Map<string, { 
            name: string, 
            quantity: number, 
            totalCost: number, 
            totalRevenue: number,
            isRepair: boolean,
            isWarranty: boolean 
        }>();

        filteredSales.forEach(s => {
            const isRefunded = s.status === 'refunded';
            const refundMethod = s.refundPaymentMethod;
            const refundAmountUSD = s.actualPaidAmount ?? s.totalAmount;

            if (isRefunded && refundMethod) {
                if (refundMethod === 'Efectivo USD') {
                    usdNet -= refundAmountUSD;
                } else {
                    const amountBs = refundAmountUSD * (s.bcvRateAtTime || settings.bcvRate);
                    const methodKey = refundMethod === 'Tarjeta / Pago Móvil' ? 'Pago Móvil' : refundMethod;
                    if (bsBreakdown[methodKey as string] !== undefined) {
                        bsBreakdown[methodKey as string] -= amountBs;
                    }
                }
                return;
            }

            if (s.status !== 'completed') return;

            s.payments.forEach(p => {
                if (p.method === 'Efectivo USD') usdNet += p.amount;
                else if (p.method === 'Efectivo Bs') bsBreakdown['Efectivo Bs'] += p.amount;
                else if (p.method === 'Tarjeta') bsBreakdown['Tarjeta'] += p.amount;
                else if (p.method === 'Pago Móvil') bsBreakdown['Pago Móvil'] += p.amount;
                else if (p.method === 'Tarjeta / Pago Móvil') {
                    bsBreakdown['Pago Móvil'] += p.amount;
                }
                else if (p.method === 'Transferencia') {
                    bsBreakdown['Transferencia'] += p.amount;
                }
            });
            s.changeGiven?.forEach(c => {
                if (c.method === 'Efectivo USD') usdNet -= c.amount;
                else if (c.method === 'Efectivo Bs') bsBreakdown['Efectivo Bs'] -= c.amount;
                else if (c.method === 'Tarjeta') bsBreakdown['Tarjeta'] -= c.amount;
                else if (c.method === 'Pago Móvil') bsBreakdown['Pago Móvil'] -= c.amount;
                else if (c.method === 'Tarjeta / Pago Móvil') {
                    bsBreakdown['Pago Móvil'] -= c.amount;
                }
                else if (c.method === 'Transferencia') {
                    bsBreakdown['Transferencia'] -= c.amount;
                }
            });

            const totalCollectedNominal = s.actualPaidAmount ?? s.totalAmount;
            const itemsTotalBillable = s.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const paymentRatio = itemsTotalBillable > 0 ? totalCollectedNominal / itemsTotalBillable : 1;

            // Análisis de costos congelados en los artículos de esta transacción
            const itemsWithFrozenCost = s.items.filter(i => {
                const c = i.costPrice ?? i.customCostPrice;
                return c !== undefined && c !== null && c > 0;
            });
            const frozenCostSum = itemsWithFrozenCost.reduce((acc, i) => acc + ((i.costPrice ?? i.customCostPrice ?? 0) * i.quantity), 0);
            const remainingSaleCost = typeof s.costPrice === 'number' && s.costPrice > 0 
                ? Math.max(0, s.costPrice - frozenCostSum) 
                : 0;
            const itemsNeedingCost = s.items.filter(i => {
                const c = i.costPrice ?? i.customCostPrice;
                return c === undefined || c === null || c <= 0;
            });
            const billableOfNeedingCost = itemsNeedingCost.reduce((acc, i) => acc + (i.price * i.quantity), 0);

            s.items.forEach(item => {
                const nominalItemRevenue = (item.price * item.quantity) * paymentRatio;
                const itemRevenue = nominalItemRevenue;
                
                let totalOriginalCost = 0;
                let key = item.productId;
                let name = item.name;
                let isRepair = !!item.isRepair;
                let isWarranty = !!item.isWarranty;

                // --- MOTOR DE RESCATE HÍBRIDO ---
                const persistedCost = item.costPrice ?? item.customCostPrice;

                if (persistedCost !== undefined && persistedCost !== null && persistedCost > 0) {
                    // Caso A: Venta con costo congelado (Inmutable e independiente del precio de cobro)
                    totalOriginalCost = persistedCost * item.quantity;
                } else {
                    // Caso B: Venta antigua o sin costo - Rescate desde Memoria Global (RAM)
                    if (item.isRepair) {
                        key = `repair-${s.repairJobId || item.productId}`;
                        const repair = repairJobs.find(rj => rj.id === (s.repairJobId || item.productId));
                        if (repair) {
                            const totalJobPartsCost = [...(repair.reservedParts || []), ...(repair.consumedParts || [])]
                                .reduce((sum, p) => sum + (p.costPrice * p.quantity), 0);
                            const costRatio = repair.estimatedCost > 0 ? totalJobPartsCost / repair.estimatedCost : 0;
                            totalOriginalCost = nominalItemRevenue * costRatio;
                        }
                    } else if (s.fiadoId) {
                        key = `fiado-${s.fiadoId}`;
                        const fiado = fiados?.find(f => f.id === s.fiadoId);
                        if (fiado) {
                            const costRatio = fiado.totalAmount > 0 ? (fiado.totalCost || 0) / fiado.totalAmount : 0;
                            totalOriginalCost = nominalItemRevenue * costRatio;
                        }
                    } else {
                        // Lookup en RAM por ID, SKU o Nombre (Blindaje histórico)
                        const matchedProduct = products.find(p => 
                            p.id === item.productId || 
                            p.sku === item.productId || 
                            p.name === item.name
                        );
                        if (matchedProduct) {
                            const unitCost = matchedProduct.costPrice ?? 0;
                            totalOriginalCost = unitCost * item.quantity;
                        } else {
                            totalOriginalCost = 0;
                        }
                    }

                    // --- FALLBACK MAESTRO (0 LECTURAS): Rescate desde s.costPrice ---
                    // Si el costo dio 0 (ej. RAM sin cargar catálogo de productos/reparaciones o catálogo desasociado),
                    // pero la venta registró un costPrice general en su documento raíz de Firestore:
                    if (totalOriginalCost === 0 && remainingSaleCost > 0) {
                        if (itemsNeedingCost.length === 1) {
                            totalOriginalCost = remainingSaleCost;
                        } else if (billableOfNeedingCost > 0) {
                            totalOriginalCost = ((item.price * item.quantity) / billableOfNeedingCost) * remainingSaleCost;
                        } else {
                            totalOriginalCost = remainingSaleCost / (itemsNeedingCost.length || 1);
                        }
                    } else if (totalOriginalCost === 0 && typeof s.costPrice === 'number' && s.costPrice > 0 && frozenCostSum === 0) {
                        if (s.items.length === 1) {
                            totalOriginalCost = s.costPrice;
                        } else if (itemsTotalBillable > 0) {
                            totalOriginalCost = ((item.price * item.quantity) / itemsTotalBillable) * s.costPrice;
                        } else {
                            totalOriginalCost = s.costPrice / s.items.length;
                        }
                    }
                }

                const existing = itemsMap.get(key);
                if (existing) {
                    existing.quantity += item.quantity;
                    existing.totalCost += totalOriginalCost;
                    existing.totalRevenue += itemRevenue;
                } else {
                    itemsMap.set(key, {
                        name,
                        quantity: item.quantity,
                        totalCost: totalOriginalCost,
                        totalRevenue: itemRevenue,
                        isRepair,
                        isWarranty
                    });
                }
            });
        });

        const filteredExchanges = exchanges.filter(e => {
            const eDate = new Date(e.createdAt);
            return isWithinInterval(eDate, { start: from, end: to });
        });

        filteredExchanges.forEach(e => {
            usdNet += e.usdAmount;
            if (e.sourceMethod === 'Tarjeta') bsBreakdown['Tarjeta'] -= e.bsAmount;
            else if (e.sourceMethod === 'Pago Móvil') bsBreakdown['Pago Móvil'] -= e.bsAmount;
            else if (e.sourceMethod === 'Tarjeta / Pago Móvil') bsBreakdown['Pago Móvil'] -= e.bsAmount;
            else if (bsBreakdown[e.sourceMethod] !== undefined) {
                bsBreakdown[e.sourceMethod] -= e.bsAmount;
            }
        });

        const totalIncomeFromSales = filteredSales
            .filter(s => s.status === 'completed')
            .reduce((sum, s) => {
                return sum + (s.actualPaidAmount ?? s.totalAmount);
            }, 0);
        
        const itemsBreakdown = Array.from(itemsMap.values()).map(item => ({
            ...item,
            profit: item.totalRevenue - item.totalCost
        })).sort((a, b) => b.totalRevenue - a.totalRevenue);

        const totalProductCosts = itemsBreakdown.reduce((sum, i) => sum + i.totalCost, 0);

        const filteredReconciliations = (reconciliations || []).filter(r => {
             const reconDate = new Date(r.date);
             return isWithinInterval(reconDate, { start: from, end: to });
        });

        const totalProfit = itemsBreakdown.reduce((sum, i) => sum + i.profit, 0);
        const totalReconciliationDifference = filteredReconciliations.reduce((sum, r) => sum + r.totalDifference, 0);

        return {
            totalSales: totalIncomeFromSales,
            totalProfit,
            totalReconciliationDifference,
            adjustedTotalSales: usdNet + convert(Object.values(bsBreakdown).reduce((a,b)=>a+b, 0), 'Bs', 'USD', true),
            transactionCount: filteredSales.filter(s => s.status === 'completed').length,
            bsBreakdown,
            usdNet,
            itemsBreakdown,
            totalProductCosts,
            dateRangeLabel: date.to ? `${format(from, "dd/MM/yy")} al ${format(to, "dd/MM/yy")}` : format(from, "dd/MM/yy")
        };

    }, [date, sales, products, reconciliations, repairJobs, exchanges, fiados, settings, convert, hasRangeStats, rangeAggregate]);

    if (isLoading || isRangeLoading) return <div className="space-y-4"><Skeleton className="h-36 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>;

    const totalBsNet = Object.values(stats.bsBreakdown).reduce((a, b) => a + b, 0);

    return (
        <div className="space-y-4">
            {/* Tarjeta Principal: Flujo y Rendimiento por Periodo */}
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                            <Sigma className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <h2 className="truncate text-sm font-semibold text-slate-900">Flujo y rendimiento del periodo</h2>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="Información del reporte">
                                                <Info className="w-3.5 h-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-xs">Ingresos cobrados, costos, utilidad operativa y flujo en dólares y bolívares.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <p className="text-[11px] text-slate-500">Resumen de ingresos, costos y utilidad operativa</p>
                        </div>
                    </div>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={cn("h-10 sm:h-9 w-full sm:w-auto justify-start text-left text-xs font-medium rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm", !date && "text-slate-400")}
                            >
                                <CalendarIcon className="mr-2 h-3.5 w-3.5 text-blue-600 shrink-0" />
                                {date?.from ? (date.to ? `${format(date.from, "dd/MM/yy")} - ${format(date.to, "dd/MM/yy")}` : format(date.from, "dd/MM/yy")) : "Seleccionar fecha"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-xl border-slate-200 bg-white shadow-xl" align="end">
                            <Calendar initialFocus mode="range" selected={date} onSelect={setDate} numberOfMonths={isMobile ? 1 : 2} locale={es} />
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                    {/* 5 KPIs compactos y equilibrados */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                        <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs">
                            <p className="text-[11px] font-medium text-slate-500">Recaudación total</p>
                            <p className="mt-1 text-lg sm:text-xl font-semibold tracking-tight tabular-nums text-slate-900">
                                {getSymbol()}{formatCurrency(stats.totalSales)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-400 tabular-nums">{stats.transactionCount} transacciones</p>
                        </div>

                        <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs">
                            <p className="text-[11px] font-medium text-slate-500">Inversión costo</p>
                            <p className="mt-1 text-lg sm:text-xl font-semibold tracking-tight tabular-nums text-blue-700">
                                {getSymbol()}{formatCurrency(stats.totalProductCosts)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-400">Costo mercancía</p>
                        </div>

                        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/35 p-3 shadow-2xs">
                            <p className="text-[11px] font-medium text-emerald-800/80">Utilidad real</p>
                            <p className={cn("mt-1 text-lg sm:text-xl font-semibold tracking-tight tabular-nums", stats.totalProfit >= 0 ? "text-emerald-700" : "text-rose-600")}>
                                {getSymbol()}{formatCurrency(stats.totalProfit)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-emerald-700/70">Margen neto</p>
                        </div>

                        <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs">
                            <p className="text-[11px] font-medium text-slate-500">Dif. cierres</p>
                            <p className={cn("mt-1 text-lg sm:text-xl font-semibold tracking-tight tabular-nums", stats.totalReconciliationDifference >= 0 ? "text-emerald-700" : "text-rose-600")}>
                                {stats.totalReconciliationDifference >= 0 ? '+' : ''}{getSymbol()}{formatCurrency(stats.totalReconciliationDifference)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-400">Faltantes / sobrantes</p>
                        </div>

                        <div className="col-span-2 sm:col-span-1 rounded-xl border border-blue-200/90 bg-gradient-to-br from-blue-50/70 via-white to-emerald-50/45 p-3 shadow-2xs">
                            <p className="text-[11px] font-medium text-blue-700">Balance de caja</p>
                            <p className="mt-1 text-lg sm:text-xl font-semibold tracking-tight tabular-nums text-slate-900">
                                {getSymbol()}{formatCurrency(stats.adjustedTotalSales)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">Saldo neto proyectado</p>
                        </div>
                    </div>

                    {/* Flujo Neto en Divisas y Bolívares */}
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2">
                                <Landmark className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                <span className="text-xs font-semibold text-slate-800">Flujo neto por moneda y método</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center text-xs tabular-nums">
                                <span className="inline-flex items-center justify-between sm:justify-start gap-1.5 rounded-xl sm:rounded-full border border-blue-200/80 bg-white px-2.5 py-1.5 sm:py-0.5 font-medium text-slate-700">
                                    <span className="inline-flex items-center gap-1 text-slate-500"><DollarSign className="h-3 w-3 text-blue-600" />USD</span>
                                    <strong className="font-semibold text-slate-900">${formatCurrency(stats.usdNet)}</strong>
                                </span>
                                <span className="inline-flex items-center justify-between sm:justify-start gap-1.5 rounded-xl sm:rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2.5 py-1.5 sm:py-0.5 font-semibold text-emerald-700">
                                    <span className="text-[11px] font-medium text-emerald-700/80 sm:hidden">Total</span>
                                    <span>Bs {formatCurrency(totalBsNet)}</span>
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                            {Object.entries(stats.bsBreakdown).map(([method, amount]) => {
                                const Icon = methodIcons[method] || Landmark;
                                const style = methodStyles[method] || { color: 'text-slate-600', bg: 'bg-white', border: 'border-slate-200' };
                                return (
                                    <div
                                        key={method}
                                        className="flex justify-between items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/80 bg-white"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", style.bg, style.color)}>
                                                <Icon className="w-3.5 h-3.5" />
                                            </span>
                                            <span className="truncate text-xs font-medium text-slate-700">{method}</span>
                                        </div>
                                        <span className={cn("text-xs font-semibold tabular-nums shrink-0", (amount as number) < 0 ? "text-rose-600" : "text-slate-900")}>
                                            Bs {formatCurrency(amount as number)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Desglose de Rentabilidad por Artículo */}
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-200/80 bg-indigo-50 text-indigo-600">
                            <ShoppingBag className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h2 className="truncate text-sm font-semibold text-slate-900">Rentabilidad por artículo</h2>
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                                    {stats.itemsBreakdown.length}
                                </span>
                            </div>
                            <p className="hidden text-xs text-slate-500 sm:block">Ingresos facturados, costo de inversión y ganancia exacta por producto o servicio.</p>
                        </div>
                    </div>
                </div>

                {/* Móvil: tarjetas limpias */}
                <div className="space-y-2.5 p-3 md:hidden">
                    {stats.itemsBreakdown.length === 0 ? (
                        <p className="py-8 text-center text-xs text-slate-400">
                            No hay transacciones registradas en este periodo.
                        </p>
                    ) : stats.itemsBreakdown.map((item, idx) => (
                        <div key={idx} className="space-y-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
                            <div className="flex items-start gap-1.5">
                                {item.isRepair
                                    ? <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                                    : <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                                <span className="min-w-0 flex-1 text-xs font-semibold leading-snug text-slate-900">{item.name}</span>
                                {item.isWarranty && (
                                    <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2 py-px text-[10px] font-medium text-orange-700">Garantía</span>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                <div className="flex justify-between gap-2">
                                    <span className="text-slate-400">Cant.</span>
                                    <span className="font-medium tabular-nums text-slate-700">{item.quantity}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-slate-400">P. Unit.</span>
                                    <span className="tabular-nums text-slate-700">${formatCurrency(item.quantity > 0 ? item.totalRevenue / item.quantity : 0)}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-slate-400">Costo</span>
                                    <span className="tabular-nums text-slate-600">${formatCurrency(item.totalCost)}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-slate-400">Ingreso</span>
                                    <span className="font-semibold tabular-nums text-slate-900">${formatCurrency(item.totalRevenue)}</span>
                                </div>
                            </div>

                            <div className={cn("flex items-center justify-between rounded-lg border px-2.5 py-1.5", item.profit > 0 ? "border-emerald-200/70 bg-emerald-50/70" : "border-rose-200/70 bg-rose-50/70")}>
                                <span className="text-[11px] font-medium text-slate-600">Ganancia</span>
                                <span className={cn("text-xs font-semibold tabular-nums", item.profit > 0 ? "text-emerald-700" : "text-rose-700")}>
                                    ${formatCurrency(item.profit)}
                                </span>
                            </div>
                        </div>
                    ))}

                    {stats.itemsBreakdown.length > 0 && (
                        <div className="flex items-center justify-between rounded-xl border border-blue-200/80 bg-blue-50/50 px-3.5 py-2.5">
                            <span className="text-xs font-semibold text-blue-800">Ganancia total del periodo</span>
                            <span className={cn("text-sm font-semibold tabular-nums", stats.totalProfit >= 0 ? "text-emerald-700" : "text-rose-600")}>
                                ${formatCurrency(stats.totalProfit)}
                            </span>
                        </div>
                    )}
                </div>

                {/* Escritorio: tabla limpia */}
                <div className="hidden md:block">
                    <Table>
                        <TableHeader className="bg-slate-50/80 border-b border-slate-100">
                            <TableRow className="hover:bg-transparent border-slate-100">
                                <TableHead className="text-[11px] font-medium text-slate-500">Producto / Servicio</TableHead>
                                <TableHead className="text-center text-[11px] font-medium text-slate-500">Cant.</TableHead>
                                <TableHead className="text-right text-[11px] font-medium text-slate-500">P. Unit. ($)</TableHead>
                                <TableHead className="text-right text-[11px] font-medium text-slate-500">Costo ($)</TableHead>
                                <TableHead className="text-right text-[11px] font-medium text-slate-500">Ingreso ($)</TableHead>
                                <TableHead className="text-right text-[11px] font-medium text-slate-500">Ganancia ($)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stats.itemsBreakdown.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-xs text-slate-400">
                                        No hay transacciones registradas en este periodo.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                stats.itemsBreakdown.map((item, idx) => (
                                    <TableRow key={idx} className="border-slate-100 hover:bg-slate-50/60 transition-colors">
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {item.isRepair ? <TrendingUp className="w-3.5 h-3.5 text-blue-600 shrink-0" /> : <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                                                <span className="font-medium text-xs text-slate-900">{item.name}</span>
                                                {item.isWarranty && <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-px text-[10px] font-medium text-orange-700">Garantía</span>}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center tabular-nums text-xs font-medium text-slate-700">{item.quantity}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs text-slate-500">
                                            ${formatCurrency(item.quantity > 0 ? item.totalRevenue / item.quantity : 0)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums text-xs text-slate-500">${formatCurrency(item.totalCost)}</TableCell>
                                        <TableCell className="text-right tabular-nums text-xs font-semibold text-slate-900">${formatCurrency(item.totalRevenue)}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={cn(
                                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                                                item.profit > 0
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : "border-rose-200 bg-rose-50 text-rose-700"
                                            )}>
                                                ${formatCurrency(item.profit)}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                        {stats.itemsBreakdown.length > 0 && (
                            <TableFooter className="bg-slate-50/90 border-t border-slate-200/80">
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={3} className="text-xs font-semibold text-slate-700">Totales del periodo</TableCell>
                                    <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700">${formatCurrency(stats.totalProductCosts)}</TableCell>
                                    <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-900">${formatCurrency(stats.totalSales)}</TableCell>
                                    <TableCell className="text-right">
                                        <span className={cn(
                                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                                            stats.totalProfit >= 0
                                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                : "border-rose-200 bg-rose-50 text-rose-700"
                                        )}>
                                            ${formatCurrency(stats.totalProfit)}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            </TableFooter>
                        )}
                    </Table>
                </div>
            </div>
        </div>
    );
}
