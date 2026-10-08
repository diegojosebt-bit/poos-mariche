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
    const { format: formatCurrency, getSymbol, convert, settings } = useCurrency();
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
    });

    const stats = useMemo(() => {
        if (!date?.from || !sales || !repairJobs || !products || !settings) {
            return { 
                totalSales: 0, 
                totalProfit: 0, 
                totalReconciliationDifference: 0, 
                adjustedTotalSales: 0, 
                transactionCount: 0, 
                bsBreakdown: {}, 
                usdNet: 0,
                itemsBreakdown: [],
                totalProductCosts: 0
            };
        }

        const from = startOfDay(date.from);
        const to = endOfDay(date.to || date.from);

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

            const saleBcv = s.bcvRateAtTime || settings.bcvRate;
            const saleParallel = s.parallelRateAtTime || settings.parallelRate;
            const isSalePromo = s.items.some(i => i.isPromo);
            const rateFactor = isSalePromo ? 1 : (saleBcv / saleParallel);

            s.items.forEach(item => {
                const nominalItemRevenue = (item.price * item.quantity) * paymentRatio;
                const itemRevenue = nominalItemRevenue * rateFactor;
                
                let totalOriginalCost = 0;
                let key = item.productId;
                let name = item.name;
                let isRepair = !!item.isRepair;
                let isWarranty = !!item.isWarranty;

                // --- MOTOR DE RESCATE HÍBRIDO ---
                const persistedCost = item.costPrice ?? item.customCostPrice;

                if (persistedCost !== undefined && persistedCost !== null && persistedCost !== 0) {
                    // Caso A: Venta nueva con costo congelado
                    totalOriginalCost = persistedCost * item.quantity * paymentRatio;
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
                            totalOriginalCost = unitCost * item.quantity * paymentRatio;
                        } else {
                            totalOriginalCost = 0; // Si no hay referencia, el costo es 0 (Peor caso)
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
                const saleBcv = s.bcvRateAtTime || settings.bcvRate;
                const saleParallel = s.parallelRateAtTime || settings.parallelRate;
                const isSalePromo = s.items.some(i => i.isPromo);
                const rateFactor = isSalePromo ? 1 : (saleBcv / saleParallel);
                return sum + ((s.actualPaidAmount ?? s.totalAmount) * rateFactor);
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
            adjustedTotalSales: usdNet + convert(Object.values(bsBreakdown).reduce((a,b)=>a+b, 0), 'Bs', 'USD'),
            transactionCount: filteredSales.filter(s => s.status === 'completed').length,
            bsBreakdown,
            usdNet,
            itemsBreakdown,
            totalProductCosts,
            dateRangeLabel: date.to ? `${format(from, "dd/MM/yy")} al ${format(to, "dd/MM/yy")}` : format(from, "dd/MM/yy")
        };

    }, [date, sales, products, reconciliations, repairJobs, exchanges, fiados, settings, convert]);

    if (isLoading) return <div className="p-4 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;

    return (
        <div className="space-y-6">
            <Card className="shadow-lg border-2 border-primary/5">
                <CardHeader className="bg-primary/5 pb-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <CardTitle className="text-xl font-black text-primary">REPORTE DE FLUJO POR PERIODO</CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase tracking-widest">Valores ajustados a tasa de reposición para proteger inversión</CardDescription>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                            <Popover>
                                <PopoverTrigger asChild>
                                <Button variant={"outline"} className={cn("w-full sm:w-[300px] justify-start text-left font-bold bg-white border-2", !date && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date?.from ? (date.to ? `${format(date.from, "dd/MM/yy")} - ${format(date.to, "dd/MM/yy")}` : format(date.from, "dd/MM/yy")) : "Seleccionar fecha"}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end"><Calendar initialFocus mode="range" selected={date} onSelect={setDate} numberOfMonths={2} locale={es}/></PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-8 pt-6">
                    
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Flujo de Periodo (Ajustado a Valor Real)</h3>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                        <p className="text-[10px]">Muestra cuántos dólares REALES tienes tras ajustar los Bolívares cobrados a BCV contra el costo de reposición.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card className="bg-slate-900 text-white border-none shadow-xl overflow-hidden relative">
                                <div className="absolute right-2 top-2 opacity-10"><DollarSign className="w-16 h-16" /></div>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-[10px] uppercase font-black text-slate-400">Ingreso Neto (Real $)</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-3xl font-black">${formatCurrency(stats.totalSales)}</div>
                                    <p className="text-[9px] text-slate-500 uppercase font-bold mt-1">Valor real de caja para pago de mercancía y comisiones</p>
                                </CardContent>
                            </Card>

                            <Card className="bg-white border-2 border-primary/10 shadow-md overflow-hidden relative">
                                <div className="absolute right-2 top-2 opacity-5"><Landmark className="w-16 h-16" /></div>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-[10px] uppercase font-black text-muted-foreground">Flujo Neto Bolívares</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="text-3xl font-black text-primary">Bs {formatCurrency(Object.values(stats.bsBreakdown).reduce((a,b)=>a+b, 0))}</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {Object.entries(stats.bsBreakdown).map(([method, amount]) => {
                                            const Icon = methodIcons[method] || Landmark;
                                            const style = methodStyles[method] || { color: 'text-slate-600', bg: 'bg-muted/30', border: 'border-transparent' };
                                            return (
                                                <div key={method} className={cn(
                                                    "flex justify-between items-center p-2 rounded-lg border transition-all hover:shadow-sm",
                                                    style.bg,
                                                    style.border
                                                )}>
                                                    <div className="flex items-center gap-2">
                                                        <Icon className={cn("w-3.5 h-3.5", style.color)} />
                                                        <span className={cn("font-black uppercase text-[9px]", style.color)}>{method}:</span>
                                                    </div>
                                                    <span className={cn("font-black text-[11px] tabular-nums", (amount as number) < 0 ? "text-destructive" : "text-slate-900")}>Bs {formatCurrency(amount as number)}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest flex items-center gap-2"><Sigma className="w-3.5 h-3.5" /> Rendimiento Operativo Real</h3>
                            <Badge variant="outline" className="text-[9px] border-primary/20 text-primary uppercase">Cálculos a Tasa de Reposición</Badge>
                        </div>
                        
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                            <div className="p-4 rounded-xl bg-muted border-l-4 border-l-primary">
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Recaudación Real ($)</p>
                                <p className="text-2xl font-black">{getSymbol()}{formatCurrency(stats.totalSales)}</p>
                                <p className="text-[9px] text-muted-foreground mt-1">{stats.transactionCount} transacciones</p>
                            </div>
                            <div className="p-4 rounded-xl bg-muted border-l-4 border-l-blue-500">
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Inversión Costo ($)</p>
                                <p className="text-2xl font-black text-blue-600">{getSymbol()}{formatCurrency(stats.totalProductCosts)}</p>
                                <p className="text-[9px] text-muted-foreground mt-1">Costo de mercancía</p>
                            </div>
                            <div className="p-4 rounded-xl bg-muted border-l-4 border-l-green-500">
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Utilidad Real ($)</p>
                                <p className={cn("text-2xl font-black", stats.totalProfit > 0 ? "text-green-600" : "text-destructive")}>
                                    {getSymbol()}{formatCurrency(stats.totalProfit)}
                                </p>
                                <p className="text-[9px] text-muted-foreground mt-1">Base para comisiones</p>
                            </div>
                            <div className="p-4 rounded-xl bg-muted border-l-4 border-l-amber-500">
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Dif. Cierres ($)</p>
                                <p className={cn("text-2xl font-black", stats.totalReconciliationDifference >= 0 ? "text-green-600" : "text-destructive")}>
                                    {stats.totalReconciliationDifference >= 0 ? '+' : ''}{getSymbol()}{formatCurrency(stats.totalReconciliationDifference)}
                                </p>
                                <p className="text-[9px] text-muted-foreground mt-1">Faltantes/Sobrantes</p>
                            </div>
                            <div className="p-4 rounded-xl bg-primary text-primary-foreground shadow-lg flex flex-col justify-center border-none">
                                <p className="text-[10px] font-bold uppercase text-primary-foreground/70 tracking-widest">Balance de Caja</p>
                                <p className="text-3xl font-black">{getSymbol()}{formatCurrency(stats.adjustedTotalSales)}</p>
                                <p className="text-[8px] opacity-60 uppercase font-black mt-1">Saldo Neto Proyectado</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="shadow-lg border-2 border-primary/5">
                <CardHeader className="bg-slate-50 border-b">
                    <div className="flex items-center gap-2">
                        <ShoppingBag className="w-5 h-5 text-primary" />
                        <div>
                            <CardTitle className="text-sm font-black uppercase">Desglose de Rentabilidad Real por Artículo</CardTitle>
                            <CardDescription className="text-[10px]">Valores ajustados a tasa de reposición para cálculo exacto de comisiones.</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="text-[10px] font-black uppercase">Producto / Servicio</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase">Cant.</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase">Costo Inversión ($)</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase">Ingreso Real ($)</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase">Ganancia Real ($)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stats.itemsBreakdown.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground italic uppercase font-bold text-xs">
                                        No hay transacciones registradas en este periodo.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                stats.itemsBreakdown.map((item, idx) => (
                                    <TableRow key={idx} className="hover:bg-muted/20">
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {item.isRepair ? <TrendingUp className="w-3 h-3 text-blue-600" /> : <Package className="w-3 h-3 text-slate-400" />}
                                                <span className="font-bold text-xs uppercase">{item.name}</span>
                                                {item.isWarranty && <Badge variant="outline" className="text-[8px] h-3 border-orange-200 text-orange-600 font-bold">GARANTÍA</Badge>}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center font-mono text-xs font-bold">{item.quantity}</TableCell>
                                        <TableCell className="text-right font-mono text-xs text-muted-foreground">${formatCurrency(item.totalCost)}</TableCell>
                                        <TableCell className="text-right font-mono text-xs font-bold text-slate-700">${formatCurrency(item.totalRevenue)}</TableCell>
                                        <TableCell className="text-right">
                                            <Badge className={cn(
                                                "font-mono text-xs",
                                                item.profit > 0 ? "bg-green-600" : "bg-destructive"
                                            )}>
                                                ${formatCurrency(item.profit)}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                        {stats.itemsBreakdown.length > 0 && (
                            <TableFooter className="bg-primary/5 font-black">
                                <TableRow>
                                    <TableCell colSpan={2} className="text-[10px] uppercase text-primary">Totales Realistas:</TableCell>
                                    <TableCell className="text-right text-xs">${formatCurrency(stats.totalProductCosts)}</TableCell>
                                    <TableCell className="text-right text-xs">${formatCurrency(stats.totalSales)}</TableCell>
                                    <TableCell className="text-right">
                                        <Badge className={cn("font-mono text-xs shadow-sm", stats.totalProfit >= 0 ? "bg-green-600" : "bg-destructive")}>
                                            ${formatCurrency(stats.totalProfit)}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            </TableFooter>
                        )}
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
