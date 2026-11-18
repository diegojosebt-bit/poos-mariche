
"use client";

import type { RepairJob, Product } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Skeleton } from "../ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";

type RepairAnalysisProps = {
    repairJobs: RepairJob[];
    products: Product[];
    isLoading?: boolean;
};

type PartUsage = {
    productId: string;
    productName: string;
    category: string;
    quantity: number;
};

export function RepairAnalysis({ repairJobs, products, isLoading }: RepairAnalysisProps) {
    const [selectedCategory, setSelectedCategory] = useState<string>("Todos");

    const { analysisData, categories } = useMemo(() => {
        if (!repairJobs || !products) return { analysisData: [], categories: ["Todos"] };

        // Consider parts as "used" if the job is paid or marked delivered
        const completedJobs = repairJobs.filter(job => job.status === 'Completado' || job.status === 'Pagado' || job.isPaid);
        
        const partUsageMap = new Map<string, PartUsage>();

        completedJobs.forEach(job => {
            job.reservedParts?.forEach(part => {
                const existingPart = partUsageMap.get(part.productId);
                if (existingPart) {
                    existingPart.quantity += part.quantity;
                } else {
                    const productDetails = products.find(p => p.id === part.productId);
                    partUsageMap.set(part.productId, {
                        productId: part.productId,
                        productName: part.productName,
                        category: productDetails?.category || 'Desconocida',
                        quantity: part.quantity,
                    });
                }
            });
        });
        
        const allCategories = ['Todos', ...Array.from(new Set(Array.from(partUsageMap.values()).map(p => p.category)))];

        const sortedData = Array.from(partUsageMap.values()).sort((a, b) => b.quantity - a.quantity);
        
        return { analysisData: sortedData, categories: allCategories };
    }, [repairJobs, products]);
    
    const filteredData = useMemo(() => {
        if (selectedCategory === "Todos") {
            return analysisData;
        }
        return analysisData.filter(part => part.category === selectedCategory);
    }, [analysisData, selectedCategory]);


    return (
        <Card>
            <CardHeader>
                <CardTitle>Análisis de Piezas en Reparaciones</CardTitle>
                <CardDescription>
                    Un resumen de las piezas más utilizadas en los trabajos de reparación completados.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="mb-4 flex items-center gap-4">
                    <label className="text-sm font-medium">Filtrar por Categoría:</label>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder="Seleccionar categoría" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map(cat => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Pieza</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead className="text-right">Cantidad Usada</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={`loading-${i}`}>
                                    <TableCell><Skeleton className="h-5 w-3/4" /></TableCell>
                                    <TableCell><Skeleton className="h-5 w-1/2" /></TableCell>
                                    <TableCell className="text-right"><Skeleton className="h-5 w-1/4 ml-auto" /></TableCell>
                                </TableRow>
                            ))
                        ) : filteredData.length > 0 ? (
                            filteredData.map(part => (
                                <TableRow key={part.productId}>
                                    <TableCell className="font-medium">{part.productName}</TableCell>
                                    <TableCell><Badge variant="outline">{part.category}</Badge></TableCell>
                                    <TableCell className="text-right font-bold text-lg">{part.quantity}</TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center">
                                    No hay datos para la categoría seleccionada.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
