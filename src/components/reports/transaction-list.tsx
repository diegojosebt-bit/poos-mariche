"use client"

import type { Sale, Payment, Product, CartItem, RepairJob, UserProfile, PaymentMethod, BusinessStats } from "@/lib/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useCurrency } from "@/hooks/use-currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ReceiptView, handlePrintReceipt } from "../pos/receipt-view";
import { Button } from "../ui/button";
import { Printer, Undo2, AlertTriangle, Calendar as CalendarIcon, Search, X as ClearIcon, Filter, CreditCard, Banknote, Landmark, Smartphone, DollarSign, ArrowDownLeft, ArrowUpRight, Sigma, Loader2, ChevronLeft, ChevronRight, User, Coins, ShoppingBag, ListChecks, CheckCircle2 } from "lucide-react";
import React, { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "../ui/skeleton";
import { AdminAuthDialog } from "../admin-auth-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc, runTransaction, getDoc, type DocumentSnapshot } from "firebase/firestore";
import { Badge } from "../ui/badge";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { Separator } from "../ui/separator";

type TransactionListProps = {
    sales: Sale[];
    isLoading?: boolean;
};

const PAYMENT_METHODS: (PaymentMethod | 'ALL')[] = [
    'ALL',
    'Efectivo USD',
    'Efectivo Bs',
    'Tarjeta',
    'Pago Móvil',
    'Transferencia',
    'USDT / Crypto'
];

const REFUND_METHODS: PaymentMethod[] = [
    'Efectivo USD',
    'Efectivo Bs',
    'Tarjeta / Pago Móvil',
    'Transferencia'
];

const methodIcons: Record<string, any> = {
    'Efectivo USD': DollarSign,
    'Efectivo Bs': Landmark,
    'Tarjeta': CreditCard,
    'Pago Móvil': Smartphone,
    'Transferencia': Banknote,
    'Tarjeta / Pago Móvil': Smartphone,
    'USDT / Crypto': Coins,
};

const ITEMS_PER_PAGE = 20;

const RefundButton = ({ sale }: { sale: Sale }) => {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [refundReason, setRefundReason] = useState("");
    const [stockAction, setStockAction] = useState<'return' | 'damage'>('return');
    const [refundMethod, setRefundMethod] = useState<PaymentMethod | "">("");
    const [isProcessing, setIsProcessing] = useState(false);
    
    const handleRefund = async () => {
        if (!firestore || !user || !sale.id || !refundReason.trim() || !refundMethod || isProcessing) return;
        
        setIsProcessing(true);
        try {
            await runTransaction(firestore, async (transaction) => {
                const repairJobSnap = sale.repairJobId ? await transaction.get(doc(firestore, 'users', user.uid, 'repair_jobs', sale.repairJobId)) : null;
                const repairJobData = repairJobSnap?.exists() ? repairJobSnap.data() as RepairJob : null;

                const productIdsToRead = new Set<string>();
                for (const item of sale.items) {
                    if (!item.isCustom && !item.isRepair) productIdsToRead.add(item.productId);
                }
                if (repairJobData?.reservedParts) {
                    repairJobData.reservedParts.forEach(p => productIdsToRead.add(p.productId));
                }

                const productSnapshots = new Map<string, DocumentSnapshot>();
                for(const pid of Array.from(productIdsToRead)) {
                    const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', pid));
                    productSnapshots.set(pid, snap);
                }

                const statsRef = doc(firestore, 'users', user.uid, 'system', 'estadisticas_actuales');
                const statsSnap = await transaction.get(statsRef);
                const currentStats = statsSnap.exists() ? statsSnap.data() as BusinessStats : { totalRealSales30d: 0, totalRealProfit30d: 0 };

                const productIdsToReturn = new Map<string, { quantity: number, isFromRepair: boolean }>();
                let totalCostToDeductUSD = 0;

                for (const item of sale.items) {
                    if (item.isCustom) {
                        totalCostToDeductUSD += (item.customCostPrice || 0) * item.quantity;
                        continue;
                    }
                    if (item.isRepair) continue;
                    
                    const pSnap = productSnapshots.get(item.productId);
                    if (pSnap?.exists()) {
                        totalCostToDeductUSD += (pSnap.data() as Product).costPrice * item.quantity;
                    }

                    const existing = productIdsToReturn.get(item.productId) || { quantity: 0, isFromRepair: false };
                    productIdsToReturn.set(item.productId, { 
                        quantity: existing.quantity + item.quantity, 
                        isFromRepair: false 
                    });
                }

                if (repairJobData?.reservedParts) {
                    repairJobData.reservedParts.forEach(part => {
                        totalCostToDeductUSD += part.costPrice * part.quantity;
                        const existing = productIdsToReturn.get(part.productId) || { quantity: 0, isFromRepair: true };
                        productIdsToReturn.set(part.productId, { 
                            quantity: existing.quantity + part.quantity, 
                            isFromRepair: true 
                        });
                    });
                }

                const saleBcv = sale.bcvRateAtTime || 1;
                const saleParallel = sale.parallelRateAtTime || 1;
                const isSalePromo = sale.items.some(i => i.isPromo);
                const rateFactor = isSalePromo ? 1 : (saleBcv / saleParallel);
                const realRevenueUSD = (sale.actualPaidAmount ?? sale.totalAmount) * rateFactor;
                const realProfitUSD = realRevenueUSD - totalCostToDeductUSD;

                if (repairJobSnap?.exists() && repairJobData) {
                    transaction.update(repairJobSnap.ref, { 
                        status: 'Pendiente', 
                        isPaid: false, 
                        amountPaid: 0,
                        partsConsumed: false
                    });
                }

                for (const [pid, info] of Array.from(productIdsToReturn.entries())) {
                    const pSnap = productSnapshots.get(pid);
                    if (pSnap?.exists()) {
                        const data = pSnap.data() as Product;
                        const newStock = (data.stockLevel || 0) + info.quantity;
                        const newDamaged = stockAction === 'damage' 
                            ? (data.damagedStock || 0) + info.quantity 
                            : (data.damagedStock || 0);
                        
                        let newReserved = data.reservedStock || 0;
                        if (info.isFromRepair && stockAction === 'return') {
                            newReserved += info.quantity;
                        }

                        transaction.update(pSnap.ref, { 
                            stockLevel: newStock, 
                            damagedStock: newDamaged,
                            reservedStock: newReserved
                        });
                    }
                }

                transaction.update(statsRef, {
                    totalRealSales30d: Math.max(0, (currentStats.totalRealSales30d || 0) - realRevenueUSD),
                    totalRealProfit30d: (currentStats.totalRealProfit30d || 0) - realProfitUSD,
                    updatedAt: new Date().toISOString()
                });

                const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', sale.id!);
                transaction.update(saleRef, { 
                    status: 'refunded', 
                    refundedAt: new Date().toISOString(), 
                    refundReason,
                    refundPaymentMethod: refundMethod 
                });
            });

            toast({ title: "Reembolso Procesado" });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setIsProcessing(false);
            setIsConfirmOpen(false);
        }
    };
    
    if (sale.status === 'refunded') return <Badge variant="secondary">Reembolsado</Badge>;
    
    return (
        <div className="flex items-center gap-2">
            <AdminAuthDialog onAuthorized={() => setIsConfirmOpen(true)}>
                <Button variant="outline" size="sm" className="h-8 text-[10px] font-black uppercase border-destructive/20 text-destructive hover:bg-destructive/5"><Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reembolsar</Button>
            </AdminAuthDialog>
            <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                <AlertDialogContent className="sm:max-w-md">
                    <AlertDialogHeader><AlertDialogTitle className="uppercase font-bold">Procesar Reembolso</AlertDialogTitle></AlertDialogHeader>
                    <div className="py-4 space-y-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground">Método de Devolución</Label>
                            <Select value={refundMethod} onValueChange={(v: any) => setRefundMethod(v)}>
                                <SelectTrigger className="h-11"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                <SelectContent>{REFUND_METHODS.map(m => (<SelectItem key={m} value={m} className="uppercase text-xs font-bold">{m}</SelectItem>))}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground">Motivo</Label>
                            <Textarea placeholder="MOTIVO..." value={refundReason} onChange={(e) => setRefundReason(e.target.value.toUpperCase())} className="uppercase text-xs" />
                        </div>
                        <div className="space-y-3">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground">Acción de Stock</Label>
                            <RadioGroup value={stockAction} onValueChange={(v: any) => setStockAction(v)} className="grid grid-cols-1 gap-2">
                                <div className={cn("flex items-center space-x-2 p-3 rounded-lg border", stockAction === 'return' ? "bg-green-50 border-green-200" : "bg-white")}>
                                    <RadioGroupItem value="return" id="r1" /><Label htmlFor="r1" className="font-bold text-xs">DEVOLVER A STOCK</Label>
                                </div>
                                <div className={cn("flex items-center space-x-2 p-3 rounded-lg border", stockAction === 'damage' ? "bg-destructive/5 border-destructive/20" : "bg-white")}>
                                    <RadioGroupItem value="damage" id="r2" /><Label htmlFor="r2" className="font-bold text-xs">A DAÑADO / GARANTÍA</Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </div>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRefund} disabled={!refundReason.trim() || !refundMethod || isProcessing} className="bg-destructive hover:bg-destructive/90 h-11 font-bold">
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Undo2 className="w-4 h-4 mr-2" />} CONFIRMAR
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export function TransactionList({ sales, isLoading }: TransactionListProps) {
    const { firestore, user } = useFirebase();
    const { format: formatCurrency, getSymbol, convert, bcvRate: currentBcvRate } = useCurrency();
    const { toast } = useToast();

    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'ALL'>('ALL');
    const [searchRef, setSearchRef] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    const profileRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid) : null,
        [firestore, user?.uid]
    );
    const { data: profile } = useDoc<UserProfile>(profileRef);

    const onReprint = async (sale: Sale) => {
        let repairData = null;
        if (sale.repairJobId && firestore && user) {
            const repairRef = doc(firestore, 'users', user.uid, 'repair_jobs', sale.repairJobId);
            const snap = await getDoc(repairRef);
            if (snap.exists()) {
                repairData = { ...snap.data(), id: snap.id } as RepairJob;
            }
        }

        handlePrintReceipt({
            sale,
            currency: { format: formatCurrency, getSymbol, convert },
            businessName: profile?.businessName,
            profile: profile,
            repairData: repairData
        }, (error) => {
            toast({ variant: "destructive", title: "Error", description: error });
        });
    };

    const filteredSales = useMemo(() => {
        if (!sales) return [];
        
        return sales.filter(sale => {
            if (dateRange?.from) {
                const saleDate = parseISO(sale.transactionDate);
                const start = startOfDay(dateRange.from);
                const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
                if (!isWithinInterval(saleDate, { start, end })) return false;
            }

            if (methodFilter !== 'ALL') {
                const hasMethod = sale.payments.some(p => p.method === methodFilter);
                const hasChangeInMethod = sale.changeGiven?.some(c => c.method === methodFilter);
                const hasRefundInMethod = sale.status === 'refunded' && sale.refundPaymentMethod === methodFilter;
                if (!hasMethod && !hasChangeInMethod && !hasRefundInMethod) return false;
            }

            if (searchRef.trim()) {
                const term = searchRef.toLowerCase();
                const matchesRef = sale.payments.some(p => p.reference?.toLowerCase().includes(term));
                const matchesId = sale.id?.toLowerCase().includes(term);
                const matchesCustomer = sale.customerName?.toLowerCase().includes(term) || sale.customerID?.toLowerCase().includes(term);
                if (!matchesRef && !matchesId && !matchesCustomer) return false;
            }

            return true;
        }).sort((a, b) => {
            const dateA = a.transactionDate ? new Date(a.transactionDate).getTime() : 0;
            const dateB = b.transactionDate ? new Date(b.transactionDate).getTime() : 0;
            return dateB - dateA;
        });
    }, [sales, dateRange, methodFilter, searchRef]);

    useEffect(() => {
        setCurrentPage(1);
    }, [dateRange, methodFilter, searchRef]);

    const totalPages = Math.ceil(filteredSales.length / ITEMS_PER_PAGE);
    const paginatedSales = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredSales.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredSales, currentPage]);

    const resetFilters = () => {
        setDateRange(undefined);
        setMethodFilter('ALL');
        setSearchRef("");
    };

    if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-muted/20 rounded-lg border">
                <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Rango de Fecha</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className={cn("w-full justify-start text-left font-normal bg-white h-10", !dateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}` : format(dateRange.from, "dd/MM/yy")) : "Filtrar..."}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start"><Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} /></PopoverContent>
                    </Popover>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Método de Pago</Label>
                    <Select value={methodFilter} onValueChange={(v: any) => setMethodFilter(v)}>
                        <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Todos" /></SelectTrigger>
                        <SelectContent>{PAYMENT_METHODS.map(m => (<SelectItem key={m} value={m}>{m === 'ALL' ? 'Todos los métodos' : m}</SelectItem>))}</SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Búsqueda Rápida</Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="CLIENTE, ID, REF..." className="pl-8 uppercase h-10 bg-white" value={searchRef} onChange={(e) => setSearchRef(e.target.value.toUpperCase())} />
                    </div>
                </div>

                <div className="flex items-end"><Button variant="ghost" onClick={resetFilters} className="w-full h-10 text-xs font-bold uppercase">Limpiar Filtros</Button></div>
            </div>

            <div className="space-y-4">
                {paginatedSales.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed rounded-xl"><p className="text-muted-foreground font-medium uppercase text-xs italic">No se encontraron transacciones con estos filtros.</p></div>
                ) : (
                    <Accordion type="single" collapsible className="w-full">
                        {paginatedSales.map((sale) => (
                            <AccordionItem value={sale.id!} key={sale.id} className="border rounded-xl mb-3 overflow-hidden bg-white shadow-sm">
                                <AccordionTrigger className="hover:no-underline px-4 py-4">
                                    <div className="flex justify-between w-full pr-4 items-center">
                                        <div className="text-left flex flex-col items-start gap-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-black text-xs text-slate-800">{sale.transactionDate ? format(parseISO(sale.transactionDate), "dd/MM/yy hh:mm a", { locale: es }) : 'S/F'}</p>
                                                <Badge variant="secondary" className="text-[9px] font-mono uppercase bg-slate-100">{sale.id}</Badge>
                                            </div>
                                            {(sale.customerName || sale.customerID) && (
                                                <div className="flex items-center gap-1.5 text-[10px] font-black text-primary uppercase">
                                                    <User className="w-3 h-3" />
                                                    <span>{sale.customerName || 'CLIENTE GENERAL'}</span>
                                                    {sale.customerID && <span className="opacity-50 font-medium">({sale.customerID})</span>}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {sale.status === 'refunded' && <Badge variant="destructive" className="text-[10px] font-black uppercase">REEMBOLSADO</Badge>}
                                            {sale.reconciliationId && (
                                                <Badge variant="outline" className="text-[9px] font-black uppercase border-green-600 text-green-600 bg-green-50/50 flex items-center gap-1">
                                                    <CheckCircle2 className="w-2.5 h-2.5" /> Cerrada
                                                </Badge>
                                            )}
                                            <div className="text-right">
                                                <p className={cn("font-black text-lg leading-none", sale.status === 'refunded' && "text-muted-foreground line-through")}>
                                                    {getSymbol()}{formatCurrency(sale.actualPaidAmount ?? sale.totalAmount)}
                                                </p>
                                                <p className="text-[8px] font-bold text-muted-foreground uppercase mt-1">{sale.paymentMethod}</p>
                                            </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-4 pb-4">
                                    <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                                        <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-dashed">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Resumen Neto</span>
                                                <p className="text-2xl font-black text-primary">${formatCurrency(sale.actualPaidAmount ?? sale.totalAmount)}</p>
                                                <span className="text-[9px] font-bold text-muted-foreground">TASA BCV: {(sale.bcvRateAtTime || currentBcvRate).toFixed(2)} BS/$</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button variant="outline" size="sm" className="h-9 font-black text-[10px] uppercase tracking-tighter" onClick={() => onReprint(sale)}><Printer className="mr-1.5 h-3.5 w-3.5" /> Ticket</Button>
                                                <RefundButton sale={sale} />
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <h4 className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                                                <ShoppingBag className="w-3 h-3" /> Artículos en esta Venta
                                            </h4>
                                            <div className="rounded-xl border overflow-hidden">
                                                <Table>
                                                    <TableHeader className="bg-muted/30">
                                                        <TableRow>
                                                            <TableHead className="text-[9px] font-black uppercase h-8">Producto / Concepto</TableHead>
                                                            <TableHead className="text-center text-[9px] font-black uppercase h-8">Cant.</TableHead>
                                                            <TableHead className="text-right text-[9px] font-black uppercase h-8">P. Unit</TableHead>
                                                            <TableHead className="text-right text-[9px] font-black uppercase h-8">Subtotal</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {sale.items.map((item, idx) => (
                                                            <TableRow key={idx} className="h-9">
                                                                <TableCell className="py-2 text-[11px] font-bold uppercase text-slate-700">
                                                                    {item.name}
                                                                    {item.isPromo && <Badge className="ml-2 bg-blue-600 text-[8px] h-3.5">PROMO</Badge>}
                                                                    {item.isWarranty && <Badge className="ml-2 bg-orange-600 text-[8px] h-3.5">GARANTÍA</Badge>}
                                                                </TableCell>
                                                                <TableCell className="py-2 text-center text-[11px] font-black">x{item.quantity}</TableCell>
                                                                <TableCell className="py-2 text-right text-[11px] text-muted-foreground">${formatCurrency(item.price)}</TableCell>
                                                                <TableCell className="py-2 text-right text-[11px] font-black text-slate-900">${formatCurrency(item.price * item.quantity)}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-3">
                                                <h4 className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                                                    <Coins className="w-3 h-3" /> Detalle de Pagos
                                                </h4>
                                                <div className="space-y-2">
                                                    {sale.payments.map((p, idx) => {
                                                        const Icon = methodIcons[p.method] || Landmark;
                                                        const isUSD = p.method === 'Efectivo USD' || p.method === 'USDT / Crypto';
                                                        return (
                                                            <div key={idx} className="flex justify-between items-center p-2.5 rounded-lg border bg-white shadow-sm">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="p-1.5 bg-muted rounded-md"><Icon className="w-3.5 h-3.5 text-slate-600" /></div>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-[9px] font-black uppercase text-slate-700 leading-tight">{p.method}</span>
                                                                        {p.reference && <span className="text-[8px] font-mono text-muted-foreground uppercase truncate max-w-[120px]">REF: {p.reference}</span>}
                                                                    </div>
                                                                </div>
                                                                <span className="font-black text-xs text-slate-900">{isUSD ? '$' : 'Bs'} {formatCurrency(p.amount)}</span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>

                                            {sale.changeGiven && sale.changeGiven.length > 0 && (
                                                <div className="space-y-3">
                                                    <h4 className="text-[10px] font-black uppercase text-amber-600 flex items-center gap-2 tracking-widest">
                                                        <Undo2 className="w-3 h-3" /> Vueltos Entregados
                                                    </h4>
                                                    <div className="space-y-2">
                                                        {sale.changeGiven.map((c, idx) => {
                                                            const Icon = methodIcons[c.method] || Landmark;
                                                            const isUSD = c.method === 'Efectivo USD';
                                                            return (
                                                                <div key={idx} className="flex justify-between items-center p-2.5 rounded-lg border border-amber-100 bg-amber-50/50">
                                                                    <div className="flex items-center gap-2">
                                                                        <Icon className="w-3.5 h-3.5 text-amber-600" />
                                                                        <span className="text-[9px] font-black uppercase text-amber-700">{c.method}</span>
                                                                    </div>
                                                                    <span className="font-black text-xs text-amber-700">-{isUSD ? '$' : 'Bs'} {formatCurrency(c.amount)}</span>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {sale.status === 'refunded' && (
                                            <div className="p-4 rounded-xl bg-destructive/10 border-2 border-destructive/20 space-y-2">
                                                <div className="flex items-center gap-2 text-destructive font-black text-[10px] uppercase">
                                                    <AlertTriangle className="w-4 h-4" /> Detalles del Reembolso
                                                </div>
                                                <p className="text-xs text-slate-800 font-bold uppercase"><span className="opacity-50">Motivo:</span> {sale.refundReason}</p>
                                                <p className="text-xs text-slate-800 font-bold uppercase"><span className="opacity-50">Devuelto por:</span> {sale.refundPaymentMethod}</p>
                                                <p className="text-[9px] text-muted-foreground font-medium italic">Fecha: {sale.refundedAt ? format(parseISO(sale.refundedAt), "dd/MM/yy HH:mm", { locale: es }) : 'S/F'}</p>
                                            </div>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                )}

                {totalPages > 1 && (
                    <div className="flex items-center justify-between py-6 border-t mt-4">
                        <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Página {currentPage} de {totalPages}</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-9 px-4 text-[10px] font-black uppercase tracking-tighter shadow-sm"><ChevronLeft className="w-3.5 h-3.5 mr-1" /> Anterior</Button>
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-9 px-4 text-[10px] font-black uppercase tracking-tighter shadow-sm">Siguiente <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
