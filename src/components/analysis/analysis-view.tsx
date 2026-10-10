"use client";

import React, { useMemo, useState } from "react";
import type { Product } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Skeleton } from "../ui/skeleton";
import { Badge } from "../ui/badge";
import { 
    TrendingUp, 
    Snowflake, 
    Package, 
    Clock, 
    AlertTriangle, 
    Sparkles, 
    DollarSign, 
    ShieldAlert, 
    Layers, 
    PieChart, 
    ArrowUpRight,
    Coins,
    BarChart3,
    CheckCircle2
} from "lucide-react";
import { differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

type AnalysisMetrics = {
    totalItems: number;
    totalStockUnits: number;
    totalCostUSD: number;
    totalCostBs: number;
    totalRetailUSD: number;
    totalRetailBs: number;
    potentialProfitUSD: number;
    potentialProfitBs: number;
    potentialMarginPercent: number;
    stagnantCostUSD: number;
    stagnantCount: number;
    criticalStockCount: number;
};

type AnalysisViewProps = {
    products: Product[];
    topProducts: Product[];
    stagnantProducts: Product[];
    criticalProducts: Product[];
    metrics: AnalysisMetrics;
    categoryBreakdown: { category: string; count: number; costUSD: number; retailUSD: number }[];
    isLoading?: boolean;
};

export function AnalysisView({ 
    products,
    topProducts, 
    stagnantProducts, 
    criticalProducts,
    metrics,
    categoryBreakdown,
    isLoading 
}: AnalysisViewProps) {
    const { format, bcvRate, parallelRate } = useCurrency();
    const [activeTab, setActiveTab] = useState<"overview" | "rotation" | "stagnant" | "critical">("overview");

    if (isLoading) {
        return (
            <div className="space-y-6 max-w-7xl mx-auto w-full pb-10">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-32 w-full rounded-2xl" />
                    ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Skeleton className="h-[400px] w-full rounded-2xl" />
                    <Skeleton className="h-[400px] w-full rounded-2xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto w-full pb-10">
            {/* BARRA SUPERIOR DE TASAS DE REFERENCIA FINANCIERA */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-md border border-slate-800">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                        Auditoría Gerencial en Tiempo Real
                    </span>
                    <span className="hidden sm:inline text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
                        0 lecturas Firestore (Caché RAM)
                    </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 uppercase font-black">Tasa BCV:</span>
                        <span className="font-mono text-emerald-400 font-bold">{format(bcvRate)} Bs/$</span>
                    </div>
                    <div className="h-3 w-[1px] bg-slate-700" />
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 uppercase font-black">Tasa Reposición:</span>
                        <span className="font-mono text-amber-400 font-bold">{format(parallelRate)} Bs/$</span>
                    </div>
                </div>
            </div>

            {/* 4 CARDS GERENCIALES / KPIS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* KPI 1: CAPITAL TOTAL INVERTIDO (COSTO) */}
                <Card className="border-2 border-slate-100 shadow-sm rounded-2xl bg-white hover:border-slate-200 transition-all">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                                Capital en Almacén
                            </CardTitle>
                            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                                <DollarSign className="w-4 h-4" />
                            </div>
                        </div>
                        <CardDescription className="text-[10px] font-medium text-slate-500 uppercase">
                            Costo neto de compra
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="text-2xl font-black text-slate-900 tracking-tight font-mono">
                            ${format(metrics.totalCostUSD)}
                        </div>
                        <div className="text-xs font-bold text-slate-500 font-mono mt-0.5">
                            Bs. {format(metrics.totalCostBs)}
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                            <span>{metrics.totalItems} productos</span>
                            <span>{metrics.totalStockUnits} unid. físicas</span>
                        </div>
                    </CardContent>
                </Card>

                {/* KPI 2: VALOR TOTAL DE VENTA Y RETORNO */}
                <Card className="border-2 border-emerald-100 shadow-sm rounded-2xl bg-white hover:border-emerald-200 transition-all">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-[11px] font-black uppercase tracking-wider text-emerald-800">
                                Valor de Venta Estimado
                            </CardTitle>
                            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                                <TrendingUp className="w-4 h-4" />
                            </div>
                        </div>
                        <CardDescription className="text-[10px] font-medium text-emerald-600 uppercase">
                            Ingreso proyectado (PVP)
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="text-2xl font-black text-emerald-700 tracking-tight font-mono">
                            ${format(metrics.totalRetailUSD)}
                        </div>
                        <div className="text-xs font-bold text-emerald-600/80 font-mono mt-0.5">
                            Bs. {format(metrics.totalRetailBs)}
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-emerald-50 flex items-center justify-between text-[10px] font-bold text-emerald-700 uppercase">
                            <span>Retorno Total</span>
                            <span className="flex items-center gap-0.5 font-black text-emerald-600">
                                <ArrowUpRight className="w-3 h-3" />
                                {format(metrics.potentialMarginPercent)}% margen
                            </span>
                        </div>
                    </CardContent>
                </Card>

                {/* KPI 3: UTILIDAD BRUTA PROYECTADA */}
                <Card className="border-2 border-indigo-100 shadow-sm rounded-2xl bg-white hover:border-indigo-200 transition-all">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-[11px] font-black uppercase tracking-wider text-indigo-800">
                                Margen Bruto Proyectado
                            </CardTitle>
                            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                                <Coins className="w-4 h-4" />
                            </div>
                        </div>
                        <CardDescription className="text-[10px] font-medium text-indigo-600 uppercase">
                            Ganancia neta esperada
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="text-2xl font-black text-indigo-700 tracking-tight font-mono">
                            +${format(metrics.potentialProfitUSD)}
                        </div>
                        <div className="text-xs font-bold text-indigo-600/80 font-mono mt-0.5">
                            Bs. {format(metrics.potentialProfitBs)}
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-indigo-50 flex items-center justify-between text-[10px] font-bold text-indigo-700 uppercase">
                            <span>Protegido Tasa Reposición</span>
                            <span className="font-black text-indigo-600">Activo</span>
                        </div>
                    </CardContent>
                </Card>

                {/* KPI 4: CAPITAL EN RIESGO / ESTANCADO */}
                <Card className={cn(
                    "border-2 shadow-sm rounded-2xl bg-white transition-all",
                    metrics.stagnantCount > 0 ? "border-amber-200 hover:border-amber-300" : "border-slate-100"
                )}>
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-[11px] font-black uppercase tracking-wider text-amber-900">
                                Capital Retenido (&gt;30d)
                            </CardTitle>
                            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                                <Snowflake className="w-4 h-4" />
                            </div>
                        </div>
                        <CardDescription className="text-[10px] font-medium text-amber-700 uppercase">
                            Mercancía de baja rotación
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="text-2xl font-black text-amber-800 tracking-tight font-mono">
                            ${format(metrics.stagnantCostUSD)}
                        </div>
                        <div className="text-xs font-bold text-amber-700/80 font-mono mt-0.5">
                            {metrics.stagnantCount} productos parados
                        </div>
                        <div className="mt-3 pt-2.5 border-t border-amber-100 flex items-center justify-between text-[10px] font-bold text-amber-800 uppercase">
                            <span>Alerta Reposición</span>
                            <span className="text-destructive font-black">
                                {metrics.criticalStockCount} por agotarse
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* SELECTOR DE PESTAÑAS PARA EXPLORAR DETALLES */}
            <div className="flex items-center justify-between pt-2">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                    <TabsList className="bg-slate-100 p-1 rounded-xl h-auto flex flex-wrap gap-1">
                        <TabsTrigger value="overview" className="rounded-lg text-xs font-bold uppercase data-[state=active]:bg-white data-[state=active]:shadow-sm">
                            <PieChart className="w-3.5 h-3.5 mr-1.5" /> Panorama & Categorías
                        </TabsTrigger>
                        <TabsTrigger value="rotation" className="rounded-lg text-xs font-bold uppercase data-[state=active]:bg-white data-[state=active]:shadow-sm">
                            <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> Alta Rotación ({topProducts.length})
                        </TabsTrigger>
                        <TabsTrigger value="stagnant" className="rounded-lg text-xs font-bold uppercase data-[state=active]:bg-white data-[state=active]:shadow-sm">
                            <Snowflake className="w-3.5 h-3.5 mr-1.5 text-blue-500" /> Estancados ({stagnantProducts.length})
                        </TabsTrigger>
                        <TabsTrigger value="critical" className="rounded-lg text-xs font-bold uppercase data-[state=active]:bg-white data-[state=active]:shadow-sm">
                            <ShieldAlert className="w-3.5 h-3.5 mr-1.5 text-red-500" /> Por Agotarse ({criticalProducts.length})
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* TAB 1: PANORAMA GENERAL Y CATEGORÍAS */}
            {activeTab === "overview" && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* DISTRIBUCIÓN DE CAPITAL POR CATEGORÍA */}
                    <Card className="lg:col-span-2 border-2 border-slate-100 shadow-sm rounded-2xl bg-white overflow-hidden">
                        <CardHeader className="bg-slate-50/70 border-b border-slate-100 py-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2 text-slate-800">
                                        <Layers className="w-4 h-4 text-primary" /> Concentración de Capital por Rubro
                                    </CardTitle>
                                    <CardDescription className="text-slate-500 text-[10px] font-bold uppercase mt-0.5">
                                        Dónde está depositado el dinero de tu negocio
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="text-[10px] font-black uppercase">
                                    {categoryBreakdown.length} Categorías
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-slate-50/40">
                                    <TableRow>
                                        <TableHead className="text-[10px] font-black uppercase py-3.5 pl-6">Categoría</TableHead>
                                        <TableHead className="text-center text-[10px] font-black uppercase">Items</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase">Costo Total</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase pr-6">PVP Proyectado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {categoryBreakdown.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-32 text-center text-muted-foreground italic text-xs uppercase font-bold">
                                                Sin datos de productos cargados.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        categoryBreakdown.map((cat, idx) => {
                                            const pct = metrics.totalCostUSD > 0 ? (cat.costUSD / metrics.totalCostUSD) * 100 : 0;
                                            return (
                                                <TableRow key={cat.category} className="hover:bg-slate-50 transition-colors">
                                                    <TableCell className="py-3.5 pl-6">
                                                        <div className="flex flex-col">
                                                            <span className="font-black text-xs uppercase text-slate-800">{cat.category}</span>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <div className="w-24 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                                                    <div 
                                                                        className="bg-primary h-full rounded-full" 
                                                                        style={{ width: `${Math.min(100, Math.max(5, pct))}%` }} 
                                                                    />
                                                                </div>
                                                                <span className="text-[9px] font-mono text-slate-400 font-bold">{pct.toFixed(1)}%</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-center font-bold text-xs text-slate-600">
                                                        {cat.count}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-xs text-slate-800">
                                                        ${format(cat.costUSD)}
                                                    </TableCell>
                                                    <TableCell className="text-right pr-6 font-mono font-black text-xs text-emerald-600">
                                                        ${format(cat.retailUSD)}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* CARD LATERAL: SALUD DE INVENTARIO */}
                    <div className="space-y-4">
                        <Card className="border-2 border-slate-100 shadow-sm rounded-2xl bg-white p-5">
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-primary" /> Salud del Stock
                            </h3>
                            
                            <div className="space-y-3">
                                <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-emerald-800">En Circulación Activa</p>
                                        <p className="text-xs font-medium text-emerald-700">Artículos con stock saludable</p>
                                    </div>
                                    <span className="font-black text-lg text-emerald-700 font-mono">
                                        {Math.max(0, metrics.totalItems - metrics.criticalStockCount - metrics.stagnantCount)}
                                    </span>
                                </div>

                                <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-xl flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-amber-800">Estancados &gt; 30 días</p>
                                        <p className="text-xs font-medium text-amber-700">Oportunidad de liquidación</p>
                                    </div>
                                    <span className="font-black text-lg text-amber-700 font-mono">
                                        {metrics.stagnantCount}
                                    </span>
                                </div>

                                <div className="p-3 bg-red-50/70 border border-red-100 rounded-xl flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-red-800">Stock Crítico o Agotado</p>
                                        <p className="text-xs font-medium text-red-700">Riesgo inminente de no venta</p>
                                    </div>
                                    <span className="font-black text-lg text-destructive font-mono">
                                        {metrics.criticalStockCount}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-5 pt-4 border-t border-slate-100">
                                <div className="flex items-start gap-2.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-slate-500 uppercase leading-relaxed font-semibold">
                                        Los cálculos están sincronizados con la tasa de reposición para garantizar que tu margen neto cubra la inflación del proveedor.
                                    </p>
                                </div>
                            </div>
                        </Card>

                        {/* CONSEJO DE GESTIÓN */}
                        <div className="bg-amber-50/80 border-2 border-amber-200/80 rounded-2xl p-4 flex items-start gap-3">
                            <div className="bg-amber-100 p-1.5 rounded-xl shrink-0"><AlertTriangle className="w-4 h-4 text-amber-700" /></div>
                            <div>
                                <h4 className="text-[11px] font-black uppercase text-amber-900 mb-0.5 tracking-wider">Estrategia Financiera:</h4>
                                <p className="text-[10px] text-amber-800 leading-relaxed font-semibold uppercase">
                                    Tienes <strong>${format(metrics.stagnantCostUSD)}</strong> en productos con más de 30 días sin salir. Se recomienda armar combos en el POS para liberar ese flujo de caja hacia los productos de alta rotación.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: ALTA ROTACIÓN */}
            {activeTab === "rotation" && (
                <Card className="border-2 border-green-100 shadow-sm overflow-hidden rounded-2xl bg-white">
                    <CardHeader className="bg-green-600 text-white py-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5" /> Top Productos Más Vendidos
                                </CardTitle>
                                <CardDescription className="text-green-100 text-[10px] font-bold uppercase mt-0.5">
                                    Artículos con mayor número de salidas registradas
                                </CardDescription>
                            </div>
                            <Sparkles className="w-6 h-6 opacity-30" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="bg-green-50/40">
                                <TableRow>
                                    <TableHead className="text-[10px] font-black uppercase py-4 pl-6">Producto</TableHead>
                                    <TableHead className="text-center text-[10px] font-black uppercase">Ventas</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Stock Restante</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase pr-6">PVP Unitario</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topProducts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-40 text-center text-muted-foreground italic text-xs uppercase font-bold">
                                            Sin registros de ventas aún en el sistema.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    topProducts.map((p) => {
                                        const availableStock = p.stockLevel - (p.reservedStock || 0);
                                        const isLow = availableStock <= (p.lowStockThreshold || 3);
                                        return (
                                            <TableRow key={p.id} className="hover:bg-green-50/20 transition-colors">
                                                <TableCell className="py-4 pl-6">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-xs uppercase text-slate-800 line-clamp-1">{p.name}</span>
                                                        <span className="text-[9px] text-muted-foreground font-bold uppercase">{p.category}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 font-black text-sm">
                                                        {p.salesCount || 0}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <span className={cn(
                                                        "text-xs font-black",
                                                        isLow ? "text-destructive" : "text-slate-700"
                                                    )}>
                                                        {availableStock} unid.
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right pr-6 font-mono font-bold text-xs text-slate-900">
                                                    ${format(p.costPrice)}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* TAB 3: ESTANCADOS */}
            {activeTab === "stagnant" && (
                <Card className="border-2 border-slate-100 shadow-sm overflow-hidden rounded-2xl bg-white">
                    <CardHeader className="bg-slate-900 text-white py-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                    <Snowflake className="w-5 h-5 text-blue-400" /> Mercancía Estancada (&gt; 30 Días)
                                </CardTitle>
                                <CardDescription className="text-slate-400 text-[10px] font-bold uppercase mt-0.5">
                                    Productos con unidades en almacén pero sin rotación reciente
                                </CardDescription>
                            </div>
                            <AlertTriangle className="w-6 h-6 text-amber-500 opacity-30" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="bg-slate-50">
                                <TableRow>
                                    <TableHead className="text-[10px] font-black uppercase py-4 pl-6">Artículo en Almacén</TableHead>
                                    <TableHead className="text-center text-[10px] font-black uppercase">Stock Físico</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Capital Parado</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase pr-6">Antigüedad</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stagnantProducts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-40 text-center text-muted-foreground italic text-xs uppercase font-bold">
                                            Excelente: Todo el inventario está circulando activamente.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    stagnantProducts.map((p) => {
                                        const daysInStock = p.createdAt ? differenceInDays(new Date(), parseISO(p.createdAt)) : 0;
                                        const availableStock = p.stockLevel - (p.reservedStock || 0);
                                        const tiedCapital = (p.costPrice || 0) * availableStock;
                                        return (
                                            <TableRow key={p.id} className="hover:bg-slate-50 transition-colors">
                                                <TableCell className="py-4 pl-6">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-xs uppercase text-slate-800 line-clamp-1">{p.name}</span>
                                                        <span className="text-[9px] text-muted-foreground font-bold uppercase">{p.category}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center font-black text-sm text-slate-800">
                                                    {availableStock}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-bold text-xs text-amber-700">
                                                    ${format(tiedCapital)}
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                                                        <span className={cn(
                                                            "text-[10px] font-black uppercase font-mono",
                                                            daysInStock > 30 ? "text-red-600" : "text-slate-500"
                                                        )}>
                                                            {daysInStock} DÍAS
                                                        </span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* TAB 4: ALERTAS DE REPOSICIÓN / CRÍTICOS */}
            {activeTab === "critical" && (
                <Card className="border-2 border-red-100 shadow-sm overflow-hidden rounded-2xl bg-white">
                    <CardHeader className="bg-red-600 text-white py-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                    <ShieldAlert className="w-5 h-5 text-red-200" /> Alertas de Reposición Inmediata
                                </CardTitle>
                                <CardDescription className="text-red-100 text-[10px] font-bold uppercase mt-0.5">
                                    Productos en nivel mínimo o agotados que requieren pedido urgente al proveedor
                                </CardDescription>
                            </div>
                            <AlertTriangle className="w-6 h-6 opacity-30" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="bg-red-50/50">
                                <TableRow>
                                    <TableHead className="text-[10px] font-black uppercase py-4 pl-6">Producto</TableHead>
                                    <TableHead className="text-center text-[10px] font-black uppercase">Stock Actual</TableHead>
                                    <TableHead className="text-center text-[10px] font-black uppercase">Mínimo Definido</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase pr-6">Estado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {criticalProducts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-40 text-center text-muted-foreground italic text-xs uppercase font-bold">
                                            Todo en orden: No hay productos por debajo del umbral mínimo de stock.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    criticalProducts.map((p) => {
                                        const availableStock = p.stockLevel - (p.reservedStock || 0);
                                        const threshold = p.lowStockThreshold || 3;
                                        const isOut = availableStock <= 0;
                                        return (
                                            <TableRow key={p.id} className="hover:bg-red-50/20 transition-colors">
                                                <TableCell className="py-4 pl-6">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-xs uppercase text-slate-800 line-clamp-1">{p.name}</span>
                                                        <span className="text-[9px] text-muted-foreground font-bold uppercase">{p.category}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={cn(
                                                        "font-mono font-black text-sm",
                                                        isOut ? "text-destructive" : "text-amber-600"
                                                    )}>
                                                        {availableStock}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center font-mono text-xs text-slate-600 font-bold">
                                                    {threshold}
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <Badge variant={isOut ? "destructive" : "outline"} className="text-[10px] font-black uppercase">
                                                        {isOut ? "Agotado" : "Por Agotarse"}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

        </div>
    );
}
