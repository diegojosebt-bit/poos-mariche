"use client";

import type { Product } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Skeleton } from "../ui/skeleton";
import { Badge } from "../ui/badge";
import { TrendingUp, Snowflake, Package, ShoppingCart, Clock, AlertTriangle, Sparkles } from "lucide-react";
import { differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

type AnalysisViewProps = {
    topProducts: Product[];
    stagnantProducts: Product[];
    isLoading?: boolean;
};

export function AnalysisView({ topProducts, stagnantProducts, isLoading }: AnalysisViewProps) {
    
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-[400px] w-full rounded-xl" />
                <Skeleton className="h-[400px] w-full rounded-xl" />
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto w-full pb-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* PANEL 1: ALTA ROTACIÓN */}
                <Card className="border-2 border-green-100 shadow-xl overflow-hidden rounded-2xl bg-white">
                    <CardHeader className="bg-green-600 text-white py-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5" /> Top 10 Más Vendidos
                                </CardTitle>
                                <CardDescription className="text-green-100 text-[10px] font-bold uppercase mt-1">
                                    Máxima rotación de inventario
                                </CardDescription>
                            </div>
                            <Sparkles className="w-8 h-8 opacity-20" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="bg-green-50/50">
                                <TableRow>
                                    <TableHead className="text-[10px] font-black uppercase py-4 pl-6">Producto</TableHead>
                                    <TableHead className="text-center text-[10px] font-black uppercase">Ventas</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase pr-6">Stock</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topProducts.length === 0 ? (
                                    <TableRow><TableCell colSpan={3} className="h-40 text-center text-muted-foreground italic text-xs uppercase font-bold">Sin datos de ventas aún.</TableCell></TableRow>
                                ) : (
                                    topProducts.map((p, idx) => (
                                        <TableRow key={p.id} className="hover:bg-green-50/30 transition-colors">
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
                                            <TableCell className="text-right pr-6">
                                                <span className={cn(
                                                    "text-xs font-black",
                                                    (p.stockLevel - p.reservedStock) <= p.lowStockThreshold ? "text-destructive" : "text-slate-600"
                                                )}>
                                                    {p.stockLevel - p.reservedStock}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* PANEL 2: STOCK MUERTO */}
                <Card className="border-2 border-red-100 shadow-xl overflow-hidden rounded-2xl bg-white">
                    <CardHeader className="bg-slate-900 text-white py-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                                    <Snowflake className="w-5 h-5 text-blue-400" /> Productos Estancados
                                </CardTitle>
                                <CardDescription className="text-slate-400 text-[10px] font-bold uppercase mt-1">
                                    Mercancía con stock pero sin salida
                                </CardDescription>
                            </div>
                            <AlertTriangle className="w-8 h-8 text-amber-500 opacity-20" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="bg-slate-50">
                                <TableRow>
                                    <TableHead className="text-[10px] font-black uppercase py-4 pl-6">Artículo en Almacén</TableHead>
                                    <TableHead className="text-center text-[10px] font-black uppercase">Stock</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase pr-6">Antigüedad</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stagnantProducts.length === 0 ? (
                                    <TableRow><TableCell colSpan={3} className="h-40 text-center text-muted-foreground italic text-xs uppercase font-bold">Todo el inventario está circulando.</TableCell></TableRow>
                                ) : (
                                    stagnantProducts.map((p) => {
                                        const daysInStock = p.createdAt ? differenceInDays(new Date(), parseISO(p.createdAt)) : 0;
                                        return (
                                            <TableRow key={p.id} className="hover:bg-slate-50 transition-colors">
                                                <TableCell className="py-4 pl-6">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-xs uppercase text-slate-800 line-clamp-1">{p.name}</span>
                                                        <span className="text-[9px] text-muted-foreground font-bold uppercase">{p.category}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-black text-base text-slate-900">{p.stockLevel - p.reservedStock}</span>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <Clock className="w-3 h-3 text-slate-400" />
                                                        <span className={cn(
                                                            "text-[10px] font-black uppercase",
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
            </div>
            
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex items-start gap-4">
                <div className="bg-amber-100 p-2 rounded-full"><AlertTriangle className="w-5 h-5 text-amber-600" /></div>
                <div>
                    <h4 className="text-xs font-black uppercase text-amber-900 mb-1 tracking-widest">Consejo de Gestión:</h4>
                    <p className="text-[11px] text-amber-800 leading-relaxed font-medium uppercase">
                        Considera realizar promociones o combos con los productos que tienen más de <strong>30 días</strong> estancados para recuperar capital y reinvertir en los productos de <strong>Alta Rotación</strong>.
                    </p>
                </div>
            </div>
        </div>
    );
}
