
"use client"

import type { Product, Sale, DailyReconciliation, RepairJob, CurrencyExchange, Fiado } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { TransactionList } from "./transaction-list"
import { useCurrency } from "@/hooks/use-currency"
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase"
import { useMemo, useState } from "react"
import { collection, query, orderBy } from "firebase/firestore"
import { CashReconciliationDialog } from "./cash-reconciliation-dialog"
import { ReconciliationHistory } from "./reconciliation-history"
import { DateRangeReport } from "./date-range-report"
import { ExportSalesButton } from "./export-sales-button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { FileDown, Landmark, ReceiptText } from "lucide-react"
import * as XLSX from "xlsx";
import { format, parseISO } from "date-fns"

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
    const { format: formatCurrency } = useCurrency();

    const reconciliationsCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "daily_reconciliations"), orderBy("closedAt", "desc")) : null,
        [firestore, user?.uid]
    );
    const { data: reconciliations, isLoading: reconciliationsLoading } = useCollection<DailyReconciliation>(reconciliationsCollection);

    const openSales = useMemo(() => {
        if (!sales) return [];
        return sales.filter(s => s.status === 'completed' && !s.reconciliationId);
    }, [sales]);

    const fiscalSales = useMemo(() => {
        if (!sales) return [];
        return sales.filter(s => s.isFiscal === true).sort((a, b) => 
            (b.fiscalMetadata?.invoiceNumber || '').localeCompare(a.fiscalMetadata?.invoiceNumber || '')
        );
    }, [sales]);

    const handleExportSalesBook = () => {
        if (fiscalSales.length === 0) return;
        const data = fiscalSales.map(s => {
            const bcv = s.fiscalMetadata?.bcvRate || 1;
            const totalBs = s.totalAmount * bcv;
            const baseImponible = totalBs / 1.16;
            const iva = totalBs - baseImponible;
            
            return {
                'NRO FACTURA': s.fiscalMetadata?.invoiceNumber,
                'NRO CONTROL': s.fiscalMetadata?.controlNumber,
                'FECHA': format(parseISO(s.transactionDate), 'dd/MM/yyyy'),
                'CLIENTE': s.customerName || 'GENERAL',
                'C.I./RIF': s.customerID || 'N/A',
                'BASE IMPONIBLE (Bs)': Number(baseImponible.toFixed(2)),
                'IVA 16% (Bs)': Number(iva.toFixed(2)),
                'TOTAL VENTAS (Bs)': Number(totalBs.toFixed(2)),
                'TASA BCV': bcv,
                'REF. USD': s.totalAmount
            };
        });

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Libro de Ventas");
        XLSX.writeFile(wb, `Libro_Ventas_IVA_${format(new Date(), 'yyyy-MM')}.xlsx`);
    };

    return (
        <Tabs defaultValue="summary">
            <TabsList className="grid w-full grid-cols-4 bg-muted/50 p-1 h-auto">
                <TabsTrigger value="summary" className="py-2 text-[10px] sm:text-xs font-black uppercase">Resumen</TabsTrigger>
                <TabsTrigger value="fiscal" className="py-2 text-[10px] sm:text-xs font-black uppercase flex items-center gap-2"><Landmark className="w-3 h-3"/> Libro de Ventas</TabsTrigger>
                <TabsTrigger value="history" className="py-2 text-[10px] sm:text-xs font-black uppercase">Cierres</TabsTrigger>
                <TabsTrigger value="log" className="py-2 text-[10px] sm:text-xs font-black uppercase">Bitácora</TabsTrigger>
            </TabsList>
            
            <TabsContent value="summary" className="space-y-4 mt-4">
                 <CashReconciliationDialog openSales={openSales} />
                 <DateRangeReport sales={sales || []} products={products || []} repairJobs={repairJobs || []} fiados={fiados || []} reconciliations={reconciliations || []} exchanges={exchanges || []} isLoading={isLoading || reconciliationsLoading} />
                 <Card><CardHeader><CardTitle>Exportar Ventas</CardTitle><CardDescription>Reporte detallado de movimientos.</CardDescription></CardHeader><CardContent><ExportSalesButton sales={sales || []} products={products || []} repairJobs={repairJobs || []} fiados={fiados || []} /></CardContent></Card>
            </TabsContent>

            <TabsContent value="fiscal" className="mt-4">
                <Card className="shadow-md border-primary/10">
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5">
                        <div>
                            <CardTitle className="text-lg font-black uppercase flex items-center gap-2 text-primary">
                                <Landmark className="w-5 h-5" /> Libro de Ventas IVA
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase">Relación cronológica de facturación fiscal SENIAT.</CardDescription>
                        </div>
                        <Button onClick={handleExportSalesBook} disabled={fiscalSales.length === 0} className="font-black text-[10px] h-9 shadow-lg bg-green-600 hover:bg-green-700">
                            <FileDown className="w-4 h-4 mr-2" /> EXPORTAR LIBRO (XLSX)
                        </Button>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30 uppercase">
                                    <TableHead className="text-[9px] font-black">Factura / Control</TableHead>
                                    <TableHead className="text-[9px] font-black">Fecha</TableHead>
                                    <TableHead className="text-[9px] font-black">Cliente / RIF</TableHead>
                                    <TableHead className="text-right text-[9px] font-black">Base (Bs)</TableHead>
                                    <TableHead className="text-right text-[9px] font-black">IVA 16% (Bs)</TableHead>
                                    <TableHead className="text-right text-[9px] font-black">Total (Bs)</TableHead>
                                    <TableHead className="text-right text-[9px] font-black">Ref. USD</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {fiscalSales.length === 0 ? (
                                    <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground italic uppercase font-bold text-[10px]">No se han emitido facturas fiscales aún.</TableCell></TableRow>
                                ) : fiscalSales.map((s) => {
                                    const bcv = s.fiscalMetadata?.bcvRate || 1;
                                    const totalBs = s.totalAmount * bcv;
                                    const base = totalBs / 1.16;
                                    const iva = totalBs - base;
                                    return (
                                        <TableRow key={s.id} className="hover:bg-muted/10">
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-black text-xs text-red-600">FAC: {s.fiscalMetadata?.invoiceNumber}</span>
                                                    <span className="text-[9px] font-bold text-slate-500">CTRL: {s.fiscalMetadata?.controlNumber}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-[10px] font-bold uppercase">{format(parseISO(s.transactionDate), 'dd/MM/yy')}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black uppercase truncate max-w-[120px]">{s.customerName || 'GENERAL'}</span>
                                                    <span className="text-[8px] font-bold text-muted-foreground uppercase">{s.customerID || 'V-00000000'}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[10px]">{formatCurrency(base)}</TableCell>
                                            <TableCell className="text-right font-mono text-[10px]">{formatCurrency(iva)}</TableCell>
                                            <TableCell className="text-right font-black text-xs">{formatCurrency(totalBs)}</TableCell>
                                            <TableCell className="text-right font-bold text-primary text-[10px]">${formatCurrency(s.totalAmount)}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="history">
                 < ReconciliationHistory reconciliations={reconciliations || []} isLoading={reconciliationsLoading} />
            </TabsContent>
            <TabsContent value="log">
                <Card>
                    <CardHeader><CardTitle>Todas las Transacciones</CardTitle><CardDescription>Registro completo de ventas.</CardDescription></CardHeader>
                    <CardContent><TransactionList sales={sales || []} isLoading={isLoading} /></CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
}
