"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy, limit } from "firebase/firestore";
import type { CurrencyExchange, Sale, PaymentMethod, PayrollPayment, Loan, Expense, AppSettings, BsTransfer } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { PlusCircle, Trash2, Landmark, DollarSign, ArrowRightLeft, History, TrendingUp, Info, Calendar as CalendarIcon, X as ClearIcon, CreditCard, Smartphone, Banknote, Sigma, ShoppingBag, ArrowUpCircle, Wallet, Settings, Receipt, MinusCircle, RefreshCcw, Repeat } from "lucide-react";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, isAfter, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";

const BS_EXCHANGE_METHODS: PaymentMethod[] = ['Efectivo Bs', 'Tarjeta / Pago Móvil', 'Transferencia'];

export default function ExchangePage() {
    return (
        <SecurityGate module="exchange">
            <ExchangeContent />
        </SecurityGate>
    );
}

function ExchangeContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, settings, bcvRate } = useCurrency();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isExpenseOpen, setIsExpenseOpen] = useState(false);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
    });

    // ACOTE DE CONSULTAS: limit(50) para proteger rendimiento
    const exchangeCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "currency_exchanges"), orderBy("createdAt", "desc"), limit(50)) : null,
        [firestore, user?.uid]
    );
    const { data: exchanges } = useCollection<CurrencyExchange>(exchangeCollection);

    const transfersCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "bs_transfers"), orderBy("createdAt", "desc"), limit(50)) : null,
        [firestore, user?.uid]
    );
    const { data: transfers } = useCollection<BsTransfer>(transfersCollection);

    const salesCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "sale_transactions"), orderBy("transactionDate", "desc"), limit(50)) : null, 
        [firestore, user?.uid]
    );
    const { data: sales } = useCollection<Sale>(salesCollection);

    const payrollCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "payroll_payments"), orderBy("createdAt", "desc"), limit(50)) : null, 
        [firestore, user?.uid]
    );
    const { data: payroll } = useCollection<PayrollPayment>(payrollCollection);

    const loansCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "loans"), orderBy("createdAt", "desc"), limit(50)) : null, 
        [firestore, user?.uid]
    );
    const { data: loans } = useCollection<Loan>(loansCollection);

    const expensesCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "expenses"), orderBy("createdAt", "desc"), limit(50)) : null, 
        [firestore, user?.uid]
    );
    const { data: expenses } = useCollection<Expense>(expensesCollection);

    // SALDO REAL (CONSOLIDADO DESDE EL ÚLTIMO PUNTO DE CONTROL)
    const walletBalance = useMemo(() => {
        if (!sales || !settings) return { usd: 0, bsBreakdown: {}, totalBs: 0, lastReset: null };

        const resetDate = settings.balancesUpdatedAt ? parseISO(settings.balancesUpdatedAt) : new Date(0);

        const bsBreakdown: Record<string, number> = {
            'Efectivo Bs': settings.initialBalances?.['Efectivo Bs'] || 0,
            'Tarjeta / Pago Móvil': settings.initialBalances?.['Tarjeta / Pago Móvil'] || 0,
            'Transferencia': settings.initialBalances?.['Transferencia'] || 0
        };
        let usdBalance = settings.initialBalances?.['Efectivo USD'] || 0;

        const filterByReset = (dateStr?: string) => {
            if (!dateStr) return false;
            const date = parseISO(dateStr);
            return isValid(date) && isAfter(date, resetDate);
        };

        const mapBsMethod = (m: string): string => {
            if (m === 'Tarjeta' || m === 'Pago Móvil' || m === 'Tarjeta / Pago Móvil') return 'Tarjeta / Pago Móvil';
            return m;
        };

        sales.forEach(s => {
            if (!filterByReset(s.transactionDate)) return;

            // CASO 1: VENTA REEMBOLSADA
            if (s.status === 'refunded' && s.refundPaymentMethod) {
                const refundMethod = mapBsMethod(s.refundPaymentMethod);
                const refundAmountUSD = s.actualPaidAmount ?? s.totalAmount;
                
                if (refundMethod === 'Efectivo USD') {
                    usdBalance -= refundAmountUSD;
                } else if (bsBreakdown[refundMethod] !== undefined) {
                    bsBreakdown[refundMethod] -= refundAmountUSD * (s.bcvRateAtTime || settings.bcvRate);
                }
                return;
            }

            // CASO 2: VENTA COMPLETADA
            if (s.status === 'completed') {
                s.payments.forEach(p => {
                    if (p.method === 'Efectivo USD') usdBalance += p.amount;
                    else {
                        const method = mapBsMethod(p.method);
                        if (bsBreakdown[method] !== undefined) bsBreakdown[method] += p.amount;
                    }
                });
                s.changeGiven?.forEach(c => {
                    if (c.method === 'Efectivo USD') usdBalance -= c.amount;
                    else {
                        const method = mapBsMethod(c.method);
                        if (bsBreakdown[method] !== undefined) breakdown[method] -= c.amount;
                    }
                });
            }
        });

        (exchanges || []).forEach(e => {
            if (!filterByReset(e.createdAt)) return;
            usdBalance += e.usdAmount || 0;
            const source = mapBsMethod(e.sourceMethod);
            if (bsBreakdown[source] !== undefined) bsBreakdown[source] -= (e.bsAmount || 0);
        });

        (transfers || []).forEach(t => {
            if (!filterByReset(t.createdAt)) return;
            const source = mapBsMethod(t.sourceMethod);
            const target = mapBsMethod(t.targetMethod);
            if (bsBreakdown[source] !== undefined) bsBreakdown[source] -= (t.amountSent || 0);
            if (bsBreakdown[target] !== undefined) bsBreakdown[target] += (t.amountReceived || 0);
        });

        (payroll || []).forEach(p => {
            if (!filterByReset(p.createdAt)) return;
            if (p.amountUSD > 0) usdBalance -= p.amountUSD;
            if (p.amountBs > 0) {
                const method = mapBsMethod(p.methodBs || 'Tarjeta / Pago Móvil');
                if (bsBreakdown[method] !== undefined) bsBreakdown[method] -= p.amountBs;
                else bsBreakdown['Tarjeta / Pago Móvil'] -= p.amountBs;
            }
        });

        (loans || []).forEach(l => {
            if (!filterByReset(l.createdAt)) return;
            if (l.currency === 'USD') usdBalance -= (l.totalAmount || 0);
            else {
                const method = mapBsMethod(l.sourceMethod || 'Transferencia');
                if (bsBreakdown[method] !== undefined) bsBreakdown[method] -= (l.totalAmount || 0);
                else bsBreakdown['Transferencia'] -= (l.totalAmount || 0);
            }
        });

        (expenses || []).forEach(ex => {
            if (!filterByReset(ex.createdAt)) return;
            if (ex.amountUSD > 0) usdBalance -= ex.amountUSD;
            if (ex.amountBs > 0) {
                const method = mapBsMethod(ex.methodBs || 'Tarjeta / Pago Móvil');
                if (bsBreakdown[method] !== undefined) bsBreakdown[method] -= ex.amountBs;
                else breakdown['Tarjeta / Pago Móvil'] -= ex.amountBs;
            }
        });

        return {
            usd: usdBalance,
            bsBreakdown,
            totalBs: Object.values(bsBreakdown).reduce((a, b) => a + b, 0),
            lastReset: settings.balancesUpdatedAt ? parseISO(settings.balancesUpdatedAt) : null
        };
    }, [sales, exchanges, transfers, payroll, loans, expenses, settings]);

    const cashStatus = useMemo(() => {
        if (!sales || !settings || !dateRange?.from) return { bsSpent: 0, bsFromSales: 0, bsAvailable: 0, breakdown: {}, usdFromSales: 0, usdFromExchanges: 0, usdTotal: 0 };

        const from = startOfDay(dateRange.from);
        const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);

        const breakdown: Record<string, number> = { 'Efectivo Bs': 0, 'Tarjeta / Pago Móvil': 0, 'Transferencia': 0 };
        let usdFromSales = 0; let usdFromExchanges = 0; let bsFromSales = 0; let bsSpent = 0;

        const mapBsMethod = (m: string): string => {
            if (m === 'Tarjeta' || m === 'Pago Móvil' || m === 'Tarjeta / Pago Móvil') return 'Tarjeta / Pago Móvil';
            return m;
        };

        sales.forEach(s => {
            if (!s.transactionDate) return;
            const saleDate = parseISO(s.transactionDate);
            if (isValid(saleDate) && isWithinInterval(saleDate, { start: from, end: to })) {
                
                // RESTAR REEMBOLSOS DEL FLUJO DEL PERIODO
                if (s.status === 'refunded' && s.refundPaymentMethod) {
                    const refundMethod = mapBsMethod(s.refundPaymentMethod);
                    const refundAmountUSD = s.actualPaidAmount ?? s.totalAmount;
                    
                    if (refundMethod === 'Efectivo USD') {
                        usdFromSales -= refundAmountUSD;
                    } else if (breakdown[refundMethod] !== undefined) {
                        const amountBs = refundAmountUSD * (s.bcvRateAtTime || settings.bcvRate);
                        breakdown[refundMethod] -= amountBs;
                        bsFromSales -= amountBs;
                    }
                    return;
                }

                if (s.status === 'completed') {
                    s.payments.forEach(p => {
                        if (p.method === 'Efectivo USD') usdFromSales += p.amount;
                        else {
                            const method = mapBsMethod(p.method);
                            if (breakdown[method] !== undefined) {
                                breakdown[method] += p.amount;
                                bsFromSales += p.amount;
                            }
                        }
                    });
                    s.changeGiven?.forEach(c => {
                        if (c.method === 'Efectivo USD') usdFromSales -= c.amount;
                        else {
                            const method = mapBsMethod(c.method);
                            if (breakdown[method] !== undefined) {
                                breakdown[method] -= c.amount;
                                bsFromSales -= c.amount;
                            }
                        }
                    });
                }
            }
        });

        (exchanges || []).forEach(e => {
            if (!e.createdAt) return;
            const exchangeDate = parseISO(e.createdAt);
            if (isValid(exchangeDate) && isWithinInterval(exchangeDate, { start: from, end: to })) {
                bsSpent += (e.bsAmount || 0);
                usdFromExchanges += (e.usdAmount || 0);
                const source = mapBsMethod(e.sourceMethod);
                if (breakdown[source] !== undefined) breakdown[source] -= (e.bsAmount || 0);
            }
        });

        (transfers || []).forEach(t => {
            if (!t.createdAt) return;
            const transferDate = parseISO(t.createdAt);
            if (isValid(transferDate) && isWithinInterval(transferDate, { start: from, end: to })) {
                const source = mapBsMethod(t.sourceMethod);
                const target = mapBsMethod(t.targetMethod);
                if (breakdown[source] !== undefined) breakdown[source] -= (t.amountSent || 0);
                if (breakdown[target] !== undefined) breakdown[target] += (t.amountReceived || 0);
            }
        });

        (expenses || []).forEach(ex => {
            if (!ex.createdAt) return;
            const exDate = parseISO(ex.createdAt);
            if (isValid(exDate) && isWithinInterval(exDate, { start: from, end: to })) {
                if (ex.amountBs > 0) {
                    bsSpent += ex.amountBs;
                    const method = mapBsMethod(ex.methodBs || 'Tarjeta / Pago Móvil');
                    if (breakdown[method] !== undefined) breakdown[method] -= ex.amountBs;
                }
            }
        });

        return { bsFromSales, bsSpent, bsAvailable: Object.values(breakdown).reduce((a, b) => a + b, 0), breakdown, usdFromSales, usdFromExchanges, usdTotal: usdFromSales + usdFromExchanges };
    }, [sales, exchanges, transfers, expenses, dateRange, settings]);

    const combinedHistory = useMemo(() => {
        const history = [
            ...(exchanges || []).map(e => ({ ...e, type: 'exchange' })),
            ...(transfers || []).map(t => ({ ...t, type: 'transfer' })),
            ...(expenses || []).map(ex => ({ ...ex, type: 'expense' }))
        ];
        
        const filtered = history.filter(item => {
            if (!item.createdAt) return false;
            const itemDate = parseISO(item.createdAt);
            if (!isValid(itemDate)) return false;
            
            if (!dateRange?.from) return true;
            
            const from = startOfDay(dateRange.from);
            const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
            return isWithinInterval(itemDate, { start: from, end: to });
        });

        return filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }, [exchanges, transfers, expenses, dateRange]);

    const handleDelete = (id: string, type: string) => {
        if (!firestore || !user || !id) return;
        const collectionName = 
            type === 'exchange' ? 'currency_exchanges' : 
            type === 'transfer' ? 'bs_transfers' : 
            'expenses';
        deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, collectionName, id));
        toast({ title: "Registro eliminado", variant: "destructive" });
    };

    return (
        <>
            <PageHeader title="Cambio de Divisa">
                <div className="flex items-center gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className={cn("w-[260px] justify-start text-left font-normal bg-white", !dateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                    dateRange.to ? `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}` : format(dateRange.from, "dd/MM/yy")
                                ) : "Filtrar por fecha"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} locale={es} />
                        </PopoverContent>
                    </Popover>
                    {dateRange && <Button variant="ghost" size="icon" onClick={() => setDateRange(undefined)}><ClearIcon className="h-4 w-4" /></Button>}
                    
                    <AddTransferDialog onAdded={() => setIsTransferOpen(false)} isOpen={isTransferOpen} setIsOpen={setIsTransferOpen}>
                        <Button variant="outline" className="text-blue-600 border-blue-200 hover:bg-blue-50"><Repeat className="mr-2 h-4 w-4" /> Cambiar Efectivo a Digital</Button>
                    </AddTransferDialog>

                    <AddExpenseDialog onAdded={() => setIsExpenseOpen(false)} isOpen={isExpenseOpen} setIsOpen={setIsExpenseOpen}>
                        <Button variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50"><MinusCircle className="mr-2 h-4 w-4" /> Registrar Gasto</Button>
                    </AddExpenseDialog>

                    <AddExchangeDialog onAdded={() => setIsAddOpen(false)} isOpen={isAddOpen} setIsOpen={setIsAddOpen}>
                        <Button className="shadow-lg"><PlusCircle className="mr-2 h-4 w-4" /> Registrar Compra USD</Button>
                    </AddExchangeDialog>
                </div>
            </PageHeader>
            <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
                
                <div className="grid gap-4 md:grid-cols-2">
                    <Card className="bg-green-600 text-white shadow-xl overflow-hidden relative">
                        <div className="absolute right-2 top-2 opacity-20"><TrendingUp className="w-20 h-20" /></div>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-green-100 flex items-center gap-2">
                                <Sigma className="w-3 h-3" /> Movimiento Divisa (Periodo)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="text-4xl font-black leading-none">${formatCurrency(cashStatus.usdTotal)}</div>
                            <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-3">
                                <div><p className="text-[8px] font-black text-green-100/60 uppercase">Ventas Netas USD</p><p className="text-sm font-bold">${formatCurrency(cashStatus.usdFromSales)}</p></div>
                                <div><p className="text-[8px] font-black text-green-100/60 uppercase">Dólares Comprados</p><p className="text-sm font-bold">${formatCurrency(cashStatus.usdFromExchanges)}</p></div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900 text-white shadow-xl overflow-hidden relative">
                        <div className="absolute right-2 top-2 opacity-20"><Landmark className="w-20 h-20" /></div>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-slate-400 flex items-center gap-2">
                                <Sigma className="w-3 h-3" /> Movimiento Bolívares (Periodo)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="text-4xl font-black leading-none">Bs {formatCurrency(cashStatus.bsAvailable)}</div>
                            <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-3">
                                <div><p className="text-[8px] font-black text-slate-500 uppercase">Ventas Netas Bs</p><p className="text-sm font-bold text-green-400">Bs {formatCurrency(cashStatus.bsFromSales)}</p></div>
                                <div><p className="text-[8px] font-black text-slate-500 uppercase">Bolívares Gastados</p><p className="text-sm font-bold text-amber-400">Bs {formatCurrency(cashStatus.bsSpent)}</p></div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                        <Card className="shadow-md">
                            <CardHeader><CardTitle className="flex items-center gap-2"><History className="w-5 h-5"/> Historial de Movimientos</CardTitle></CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Tipo / Origen</TableHead><TableHead className="text-right">Salida</TableHead><TableHead className="text-right">Entrada</TableHead><TableHead className="text-center">Ref / Tasa</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {combinedHistory.map((item: any) => {
                                            const isExchange = item.type === 'exchange';
                                            const isExpense = item.type === 'expense';
                                            const isTransfer = item.type === 'transfer';
                                            const itemDate = item.createdAt ? parseISO(item.createdAt) : null;
                                            
                                            return (
                                                <TableRow key={item.id}>
                                                    <TableCell className="text-xs font-medium">
                                                        {itemDate && isValid(itemDate) ? format(itemDate, "dd/MM/yy hh:mm a") : 'N/A'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1">
                                                            <Badge variant={isExchange ? "default" : isExpense ? "destructive" : "outline"} className="text-[9px] uppercase font-bold w-fit">
                                                                {isExchange ? "COMPRA USD" : isExpense ? "GASTO / EGRESO" : "CAMBIO BS"}
                                                            </Badge>
                                                            <span className="text-[10px] font-black uppercase text-slate-600">
                                                                {isExpense ? (item.description || 'Sin descripción') : (item.sourceMethod || 'N/A')} 
                                                                {isTransfer && ` -> ${item.targetMethod || 'N/A'}`}
                                                                {isExpense && item.amountBs > 0 && ` (${item.methodBs})`}
                                                            </span>
                                                            {(isExchange || isTransfer) && item.notes && <span className="text-[9px] text-muted-foreground italic font-bold uppercase truncate max-w-[150px]" title={item.notes}>{item.notes}</span>}
                                                            {isExpense && <span className="text-[9px] text-muted-foreground font-bold uppercase">{item.category}</span>}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-amber-600">
                                                        {isExpense ? (
                                                            <div className="flex flex-col items-end">
                                                                {(item.amountUSD || 0) > 0 && <span>$ {formatCurrency(item.amountUSD)}</span>}
                                                                {(item.amountBs || 0) > 0 && <span>Bs {formatCurrency(item.amountBs)}</span>}
                                                            </div>
                                                        ) : (
                                                            `Bs ${formatCurrency(isExchange ? (item.bsAmount || 0) : (item.amountSent || 0))}`
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right font-black text-green-600">
                                                        {isExpense ? "-" : (isExchange ? `$ ${formatCurrency(item.usdAmount || 0)}` : `Bs ${formatCurrency(item.amountReceived || 0)}`)}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Badge className="font-mono text-[10px] bg-slate-800">
                                                            {isExchange ? (item.rate || 0).toFixed(2) : isExpense ? "EGRESO" : "1:1"}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <AdminAuthDialog onAuthorized={() => handleDelete(item.id!, item.type)}><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"><Trash2 className="h-4 w-4" /></Button></AdminAuthDialog>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        {combinedHistory.length === 0 && (
                                            <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No se encontraron movimientos en este periodo.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-4">
                        <Card className="bg-white border-2 border-primary/10 shadow-sm overflow-hidden h-fit">
                            <CardHeader className="pb-2 bg-muted/30">
                                <CardTitle className="text-[10px] uppercase font-black text-muted-foreground flex justify-between items-center">
                                    <span>Saldo Real (En Mano)</span>
                                    <Wallet className="w-3" />
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 space-y-4">
                                <div className="space-y-1">
                                    <p className="text-[8px] font-black text-muted-foreground uppercase">Efectivo USD Disponible</p>
                                    <p className="text-2xl font-black text-primary">${formatCurrency(walletBalance.usd)}</p>
                                </div>
                                <Separator />
                                <div className="space-y-2">
                                    <p className="text-[8px] font-black text-muted-foreground uppercase">Desglose de Bolívares</p>
                                    <div className="space-y-1">
                                        {Object.entries(walletBalance.bsBreakdown).map(([method, amount]) => (
                                            <div key={method} className="flex justify-between items-center text-[10px] border-b border-muted py-1.5 last:border-0">
                                                <span className="font-bold text-slate-600 uppercase">{method}:</span>
                                                <span className={cn("font-black", (amount as number) < 0 ? "text-destructive" : "text-slate-800")}>Bs {formatCurrency(amount as number)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex flex-col gap-2">
                                    <div className="flex items-center gap-2 text-blue-800 font-bold text-[10px] uppercase">
                                        <RefreshCcw className="w-3 h-3" /> Sincronizado:
                                    </div>
                                    <p className="text-[9px] text-blue-700 leading-tight">
                                        Este saldo cuenta desde tu ajuste manual en <strong>Ajustes</strong> ({walletBalance.lastReset && isValid(walletBalance.lastReset) ? format(walletBalance.lastReset, "dd/MM/yy HH:mm") : 'No definido'}). 
                                        Solo suma y resta lo ocurrido desde ese momento.
                                    </p>
                                </div>
                                <Link href="/dashboard/settings" className="block w-full">
                                    <Button variant="outline" size="sm" className="w-full text-[10px] font-black uppercase h-8 border-primary/20">
                                        <Settings className="w-3 h-3 mr-1.5" /> Arqueo / Ajustar Fondo Base
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
        </>
    );
}

function AddTransferDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [amountSent, setAmountSent] = useState("");
    const [amountReceived, setAmountReceived] = useState("");
    const [sourceMethod, setSourceMethod] = useState<PaymentMethod>("Efectivo Bs");
    const [targetMethod, setTargetMethod] = useState<PaymentMethod>("Tarjeta / Pago Móvil");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !amountSent || !amountReceived) return;
        setLoading(true);
        try {
            const transfersRef = collection(firestore, 'users', user.uid, 'bs_transfers');
            const newDoc = doc(transfersRef);
            await setDocumentNonBlocking(newDoc, {
                id: newDoc.id,
                amountSent: parseFloat(amountSent),
                amountReceived: parseFloat(amountReceived),
                sourceMethod,
                targetMethod,
                notes: notes.trim(),
                createdAt: new Date().toISOString()
            }, { merge: true });
            toast({ title: "Cambio de Bolívares Registrado" });
            onAdded();
        } catch (e) {
            toast({ title: "Error", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><Repeat className="w-5 h-5 text-blue-600"/> Venta de Efectivo (Bs -> Digital)</DialogTitle><DialogDescription>Usa esta option cuando entregas billetes para que te paguen por móvil o transferencia.</DialogDescription></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Desde (Entregas)</Label><Select value={sourceMethod} onValueChange={(v: any) => setSourceMethod(v)}><SelectTrigger className="h-10 text-xs font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Efectivo Bs" className="text-xs">EFECTIVO BS</SelectItem><SelectItem value="Tarjeta / Pago Móvil" className="text-xs">TARJETA / P. MÓVIL</SelectItem></SelectContent></Select></div>
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Hacia (Recibes)</Label><Select value={targetMethod} onValueChange={(v: any) => setTargetMethod(v)}><SelectTrigger className="h-10 text-xs font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Tarjeta / Pago Móvil" className="text-xs">TARJETA / P. MÓVIL</SelectItem><SelectItem value="Transferencia" className="text-xs">TRANSFERENCIA</SelectItem><SelectItem value="Efectivo Bs" className="text-xs">EFECTIVO BS</SelectItem></SelectContent></Select></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label className="text-xs font-bold">Monto Entregado (Bs)</Label><Input type="number" step="0.01" value={amountSent} onChange={(e) => setAmountSent(e.target.value)} placeholder="0.00" required /></div>
                        <div className="space-y-2"><Label className="text-xs font-bold">Monto Recibido (Bs)</Label><Input type="number" step="0.01" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} placeholder="0.00" required /></div>
                    </div>
                    <div className="space-y-2"><Label className="text-xs font-bold">¿A quién se le vendió?</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Cliente local, Vecino..." /></div>
                    <DialogFooter><Button type="submit" className="w-full h-12" disabled={loading}>{loading ? "Procesando..." : "Confirmar Movimiento Interno"}</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AddExpenseDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [description, setDescription] = useState("");
    const [amountUSD, setAmountUSD] = useState("");
    const [amountBs, setAmountBs] = useState("");
    const [methodBs, setMethodBs] = useState<PaymentMethod>("Tarjeta / Pago Móvil");
    const [category, setCategory] = useState<any>("Mercancía");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !description) return;
        setLoading(true);
        try {
            const expensesRef = collection(firestore, 'users', user.uid, 'expenses');
            const newDoc = doc(expensesRef);
            const data: Expense = {
                id: newDoc.id, description: description.trim().toUpperCase(), category,
                amountUSD: parseFloat(amountUSD) || 0, amountBs: parseFloat(amountBs) || 0,
                methodUSD: 'Efectivo USD', methodBs: methodBs,
                createdAt: new Date().toISOString()
            };
            await setDocumentNonBlocking(newDoc, data, { merge: true });
            toast({ title: "Gasto Registrado" });
            setDescription(""); setAmountUSD(""); setAmountBs("");
            onAdded();
        } catch (e) {
            toast({ title: "Error", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-amber-600"/> Registrar Egreso / Gasto</DialogTitle><DialogDescription>Cualquier pago de mercancía o servicio se restará de tu Saldo Real.</DialogDescription></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2"><Label className="text-xs font-bold uppercase">Descripción del Gasto</Label><Input value={description} onChange={(e) => setDescription(e.target.value.toUpperCase())} placeholder="EJ: COMPRA DE PANTALLAS, ALQUILER..." className="uppercase" required /></div>
                    <div className="space-y-2"><Label className="text-xs font-bold uppercase">Categoría</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Mercancía">Mercancía (Inventario)</SelectItem><SelectItem value="Servicios">Servicios (Luz, Agua, Internet)</SelectItem><SelectItem value="Alquiler">Alquiler</SelectItem><SelectItem value="Retiro Personal">Retiro Personal</SelectItem><SelectItem value="Otros">Otros</SelectItem></SelectContent></Select></div>
                    
                    <div className="space-y-4 p-3 bg-muted/50 rounded-lg border border-dashed">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase text-green-700">Gasto en USD ($)</Label><Input type="number" step="0.01" value={amountUSD} onChange={(e) => setAmountUSD(e.target.value)} placeholder="0.00" /></div>
                            <div className="space-y-2"><Label className="text-[10px] font-black uppercase text-amber-700">Gasto en Bs (Bolívares)</Label><Input type="number" step="0.01" value={amountBs} onChange={(e) => setAmountBs(e.target.value)} placeholder="0.00" /></div>
                        </div>
                        {parseFloat(amountBs) > 0 && (
                            <div className="space-y-2 animate-in fade-in duration-200">
                                <Label className="text-[10px] font-black uppercase text-muted-foreground">¿De dónde salen los Bolívares?</Label>
                                <Select value={methodBs} onValueChange={(v: any) => setMethodBs(v)}>
                                    <SelectTrigger className="h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Efectivo Bs" className="text-xs">EFECTIVO BS</SelectItem>
                                        <SelectItem value="Tarjeta / Pago Móvil" className="text-xs">TARJETA / P. MÓVIL</SelectItem>
                                        <SelectItem value="Transferencia" className="text-xs">TRANSFERENCIA</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    <DialogFooter><Button type="submit" className="w-full h-12 text-base font-bold shadow-md" disabled={loading}>{loading ? "Procesando..." : "Confirmar Salida de Dinero"}</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AddExchangeDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { bcvRate } = useCurrency();
    const [bsAmount, setBsAmount] = useState("");
    const [usdAmount, setUsdAmount] = useState("");
    const [sourceMethod, setSourceMethod] = useState<PaymentMethod | "">("");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);

    const currentRate = useMemo(() => {
        const bs = parseFloat(bsAmount) || 0;
        const usd = parseFloat(usdAmount) || 0;
        return (bs > 0 && usd > 0) ? bs / usd : 0;
    }, [bsAmount, usdAmount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !bsAmount || !usdAmount || !sourceMethod) return;
        setLoading(true);
        try {
            const exchangeRef = collection(firestore, 'users', user.uid, 'currency_exchanges');
            const newDoc = doc(exchangeRef);
            await setDocumentNonBlocking(newDoc, {
                id: newDoc.id, bsAmount: parseFloat(bsAmount), usdAmount: parseFloat(usdAmount),
                rate: currentRate, sourceMethod: sourceMethod as PaymentMethod,
                notes: notes.trim(), createdAt: new Date().toISOString()
            }, { merge: true });
            toast({ title: "Conversión Registrada" });
            setBsAmount(""); setUsdAmount(""); setNotes(""); setSourceMethod("");
            onAdded();
        } catch (e) {
            toast({ title: "Error", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-primary"/> Registrar Compra de Divisa</DialogTitle><DialogDescription>Indica cuántos Bs entregaste y de qué método se debitan.</DialogDescription></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6 py-4">
                    <div className="space-y-2"><Label className="text-xs font-black uppercase text-slate-600">¿De dónde salen los Bolívares?</Label><Select value={sourceMethod} onValueChange={(v: any) => setSourceMethod(v)}><SelectTrigger className="h-11 font-bold"><SelectValue placeholder="Seleccionar método..." /></SelectTrigger><SelectContent>{BS_EXCHANGE_METHODS.map(m => (<SelectItem key={m} value={m} className="font-bold">{m.toUpperCase()}</SelectItem>))}</SelectContent></Select></div>
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2"><Label className="text-xs font-black uppercase text-slate-600">Bolívares Entregados (Gasto)</Label><Input type="number" step="0.01" value={bsAmount} onChange={(e) => setBsAmount(e.target.value)} className="h-11 text-lg font-black border-2 border-amber-200" placeholder="Bs 0.00" required /></div>
                        <div className="space-y-2"><Label className="text-xs font-black uppercase text-slate-600">Dólares Recibidos (Ingreso)</Label><Input type="number" step="0.01" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} className="h-11 text-lg font-black border-2 border-green-200" placeholder="$ 0.00" required /></div>
                    </div>
                    <div className="space-y-2"><Label className="text-xs font-black uppercase text-slate-600">Notas / ¿A quién se compra?</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Comprado a Carlos, Remesa..." className="h-11 font-bold" /></div>
                    {currentRate > 0 && (<div className="p-4 bg-slate-900 text-white rounded-xl shadow-lg space-y-2 text-center"><p className="text-[10px] font-black uppercase text-slate-400">Tasa Calculada</p><div className="text-2xl font-black">{currentRate.toFixed(2)} <span className="text-xs font-normal">Bs/$</span></div><p className="text-[9px] text-slate-500 uppercase font-bold">Ref BCV: {bcvRate.toFixed(2)} Bs</p></div>)}
                    <DialogFooter><Button type="submit" className="w-full h-12 text-base font-bold shadow-md" disabled={loading || !bsAmount || !usdAmount || !sourceMethod}>{loading ? "PROCESANDO..." : "Confirmar Cambio y Debitar Bs"}</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}