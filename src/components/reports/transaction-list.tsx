"use client"

import type { Sale, Payment, Product, CartItem, RepairJob, UserProfile, PaymentMethod, BusinessStats } from "@/lib/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useCurrency } from "@/hooks/use-currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ReceiptView, handlePrintReceipt } from "../pos/receipt-view";
import { Button } from "../ui/button";
import { Printer, Undo2, AlertTriangle, Calendar as CalendarIcon, Search, X as ClearIcon, Filter, CreditCard, Banknote, Landmark, Smartphone, DollarSign, ArrowDownLeft, ArrowUpRight, Sigma, Loader2, ChevronLeft, ChevronRight, ChevronDown, User, Coins, ShoppingBag, ListChecks, CheckCircle2 } from "lucide-react";
import React, { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "../ui/skeleton";
import { AdminAuthDialog } from "../admin-auth-dialog";
import { TablePaginationBar } from "../table-pagination-bar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { useFirebase } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { doc, runTransaction, getDoc, type DocumentSnapshot } from "firebase/firestore";
import { saleStatsWrites } from '@/lib/firestore/rollups';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import { invalidateStatsRange } from '@/lib/firestore/stats-range';
import { ensureOnline } from '@/lib/offline-guard';
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
import { SmoothCollapse } from "../ui/smooth-collapse";

type TransactionListProps = {
    sales: Sale[];
    isLoading?: boolean;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
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
    const { updateCachedItem, addItemToCache } = useDashboardStore();
    const { toast } = useToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [refundReason, setRefundReason] = useState("");
    const [stockAction, setStockAction] = useState<'return' | 'damage'>('return');
    const [refundMethod, setRefundMethod] = useState<PaymentMethod | "">("");
    const [isProcessing, setIsProcessing] = useState(false);
    
    const handleRefund = async () => {
        if (!firestore || !user || !sale.id || !refundReason.trim() || !refundMethod || isProcessing) return;
        if (!ensureOnline(toast, 'Procesar un reembolso')) return;
        
        const refundedAt = new Date().toISOString();
        const productCachePatches: Array<{
            id: string;
            stockLevel: number;
            damagedStock: number;
            reservedStock: number;
        }> = [];
        let refundedRepairId: string | null = null;
        let refundSaleForCache: Sale | null = null;
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

                const realRevenueUSD = (sale.actualPaidAmount ?? sale.totalAmount);
                const realProfitUSD = realRevenueUSD - totalCostToDeductUSD;

                if (repairJobSnap?.exists() && repairJobData) {
                    refundedRepairId = repairJobSnap.ref.id;
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

                        productCachePatches.push({
                            id: pid,
                            stockLevel: newStock,
                            damagedStock: newDamaged,
                            reservedStock: newReserved,
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
                    refundedAt, 
                    refundReason,
                    refundPaymentMethod: refundMethod 
                });

                // Si la venta ya estaba cerrada, la devolución es un egreso del
                // cierre actual. Si seguía abierta, basta con excluir la venta.
                if (sale.reconciliationId) {
                    const refundAmount = Math.abs(Number(sale.actualPaidAmount ?? sale.totalAmount ?? 0));
                    const refundRate = sale.bcvRateAtTime ?? 1;
                    const refundInMethod = refundMethod === 'Efectivo USD' || refundMethod === 'USDT / Crypto'
                        ? -refundAmount
                        : -refundAmount * refundRate;
                    const refundSaleId = `RFD-${Date.now()}`;
                    const refundSaleData = {
                        id: refundSaleId,
                        items: [],
                        subtotal: -refundAmount,
                        discount: 0,
                        totalAmount: -refundAmount,
                        costPrice: 0,
                        paymentMethod: refundMethod,
                        transactionDate: refundedAt,
                        status: 'completed' as const,
                        payments: [{ method: refundMethod, amount: refundInMethod }],
                        actualPaidAmount: -refundAmount,
                        changeGiven: [],
                        totalChangeInUSD: 0,
                        refundOfSaleId: sale.id,
                        isRefund: true,
                        refundReason,
                        bcvRateAtTime: refundRate,
                    };
                    transaction.set(doc(firestore, 'users', user.uid, 'sale_transactions', refundSaleId), refundSaleData);
                    refundSaleForCache = refundSaleData;
                }

                // Fase 1: revertir la venta en los agregados (0 lecturas).
                try {
                    const stats = saleStatsWrites(sale, -1);
                    transaction.set(
                        doc(firestore, 'users', user.uid, 'stats_daily', stats.day),
                        stats.daily,
                        { merge: true },
                    );
                    transaction.set(
                        doc(firestore, 'users', user.uid, 'stats_monthly', stats.day.slice(0, 7)),
                        stats.monthly,
                        { merge: true },
                    );
                } catch (statsError) {
                    console.warn('[reembolso] No se pudieron preparar los agregados:', statsError);
                }
            });

            const refundPatch = {
                status: 'refunded' as const,
                refundedAt,
                refundReason,
                refundPaymentMethod: refundMethod,
            };
            updateCachedItem(sale.id!, refundPatch);
            queryCache.patchItem(user.uid, 'sale_transactions', sale.id!, refundPatch);

            // Reflejar la devolución de stock en inventario/POS sin recargar.
            for (const product of productCachePatches) {
                const { id, ...stockPatch } = product;
                updateCachedItem(id, stockPatch);
                queryCache.patchItem(user.uid, 'products', id, stockPatch);
            }

            // La reparación vuelve a Pendiente y sin pago.
            if (refundedRepairId) {
                const repairPatch = {
                    status: 'Pendiente' as const,
                    isPaid: false,
                    amountPaid: 0,
                    partsConsumed: false,
                };
                updateCachedItem(refundedRepairId, repairPatch);
                queryCache.patchItem(user.uid, 'repair_jobs', refundedRepairId, repairPatch);
            }

            // Añadir el movimiento negativo a la lista/cierre sin recargar.
            if (refundSaleForCache) {
                addItemToCache('sale_transactions', refundSaleForCache);
                queryCache.mergeIntoCatalog(user.uid, 'sale_transactions', [refundSaleForCache as unknown as WithId<Sale>]);
            }

            invalidateStatsRange(user.uid);

            toast({ title: "Reembolso Procesado" });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setIsProcessing(false);
            setIsConfirmOpen(false);
        }
    };
    
    if (sale.status === 'refunded') return <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700">Reembolsado</span>;
    
    return (
        <div className="flex items-center gap-2">
            <AdminAuthDialog actionType="deleteSales" onAuthorized={() => setIsConfirmOpen(true)}>
                <Button variant="outline" size="sm" className="h-8 rounded-lg border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reembolsar
                </Button>
            </AdminAuthDialog>
            <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                <AlertDialogContent className="w-[calc(100%-1.5rem)] sm:max-w-[440px] p-0 sm:p-0 gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                    <div className="px-4 py-4 sm:px-5 border-b border-slate-100 bg-white">
                        <AlertDialogHeader className="text-left space-y-0">
                            <div className="flex items-center gap-2.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 border border-rose-200 text-rose-600">
                                    <Undo2 className="h-4 w-4" />
                                </span>
                                <AlertDialogTitle className="text-sm sm:text-base font-semibold text-slate-900">Procesar Reembolso</AlertDialogTitle>
                            </div>
                        </AlertDialogHeader>
                    </div>
                    <div className="px-4 py-4 sm:px-5 space-y-3.5 bg-white">
                        <div className="space-y-1">
                            <Label className="text-[11px] font-medium text-slate-500">Método de devolución</Label>
                            <Select value={refundMethod} onValueChange={(v: any) => setRefundMethod(v)}>
                                <SelectTrigger className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs font-medium"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                <SelectContent>{REFUND_METHODS.map(m => (<SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>))}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] font-medium text-slate-500">Motivo</Label>
                            <Textarea placeholder="Indica el motivo del reembolso..." value={refundReason} onChange={(e) => setRefundReason(e.target.value.toUpperCase())} className="rounded-lg border-slate-200 bg-white uppercase text-xs placeholder:normal-case" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[11px] font-medium text-slate-500">Acción de stock</Label>
                            <RadioGroup value={stockAction} onValueChange={(v: any) => setStockAction(v)} className="grid grid-cols-1 gap-2">
                                <div className={cn("flex items-center space-x-2.5 p-2.5 rounded-xl border transition-colors", stockAction === 'return' ? "bg-emerald-50/70 border-emerald-200" : "bg-white border-slate-200")}>
                                    <RadioGroupItem value="return" id="r1" /><Label htmlFor="r1" className="font-medium text-xs text-slate-800 cursor-pointer">Devolver a stock disponible</Label>
                                </div>
                                <div className={cn("flex items-center space-x-2.5 p-2.5 rounded-xl border transition-colors", stockAction === 'damage' ? "bg-rose-50/70 border-rose-200" : "bg-white border-slate-200")}>
                                    <RadioGroupItem value="damage" id="r2" /><Label htmlFor="r2" className="font-medium text-xs text-slate-800 cursor-pointer">Enviar a dañado / garantía</Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </div>
                    <AlertDialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-5 sm:py-3">
                        <AlertDialogCancel disabled={isProcessing} className="mt-0 h-10 sm:h-9 flex-1 sm:flex-none rounded-xl sm:rounded-lg border-slate-200 text-xs font-medium">Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRefund} disabled={!refundReason.trim() || !refundMethod || isProcessing} className="h-10 sm:h-9 flex-1 sm:flex-none rounded-xl sm:rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-medium text-white">
                            {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Undo2 className="w-3.5 h-3.5 mr-1.5" />} Confirmar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export function TransactionList({ sales, isLoading, hasMore, isLoadingMore, onLoadMore }: TransactionListProps) {
    const { firestore, user } = useFirebase();
    const { format: formatCurrency, getSymbol, convert, bcvRate: currentBcvRate } = useCurrency();
    const { toast } = useToast();

    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'ALL'>('ALL');
    const [searchRef, setSearchRef] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
    const { profile } = useDashboardStore();

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

    if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>

    const hasActiveFilters = Boolean(dateRange?.from || methodFilter !== 'ALL' || searchRef.trim());

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 p-3 rounded-xl border border-slate-200/80 bg-slate-50/60">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("h-10 sm:h-9 w-full justify-start text-left text-xs font-medium rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50", !dateRange && "text-slate-500")}>
                            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-blue-600 shrink-0" />
                            {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}` : format(dateRange.from, "dd/MM/yy")) : "Rango de fecha"}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 rounded-xl border-slate-200 bg-white shadow-xl" align="start">
                        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                    </PopoverContent>
                </Popover>

                <Select value={methodFilter} onValueChange={(v: any) => setMethodFilter(v)}>
                    <SelectTrigger className="h-10 sm:h-9 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700">
                        <SelectValue placeholder="Todos los métodos" />
                    </SelectTrigger>
                    <SelectContent>{PAYMENT_METHODS.map(m => (<SelectItem key={m} value={m} className="text-xs">{m === 'ALL' ? 'Todos los métodos' : m}</SelectItem>))}</SelectContent>
                </Select>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                        placeholder="Cliente, ID o referencia..."
                        className="h-10 sm:h-9 rounded-xl border-slate-200 bg-white pl-8 text-xs uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500"
                        value={searchRef}
                        onChange={(e) => setSearchRef(e.target.value.toUpperCase())}
                    />
                </div>

                <Button
                    variant="outline"
                    onClick={resetFilters}
                    disabled={!hasActiveFilters}
                    className="h-10 sm:h-9 w-full rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                >
                    <ClearIcon className="mr-1.5 h-3.5 w-3.5" /> Limpiar filtros
                </Button>
            </div>

            <div className="space-y-2.5">
                {paginatedSales.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                        <p className="text-xs text-slate-400">No se encontraron transacciones con estos filtros.</p>
                    </div>
                ) : (
                    paginatedSales.map((sale) => {
                        const isOpen = expandedSaleId === sale.id;
                        return (
                            <div key={sale.id} className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs transition-colors">
                                <button
                                    type="button"
                                    aria-expanded={isOpen}
                                    onClick={() => setExpandedSaleId(isOpen ? null : (sale.id || null))}
                                    className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-slate-50/70 transition-colors cursor-pointer"
                                >
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-xs font-semibold tabular-nums text-slate-900">
                                                {sale.transactionDate ? format(parseISO(sale.transactionDate), "dd/MM/yy · hh:mm a", { locale: es }) : 'S/F'}
                                            </span>
                                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                                                {sale.id}
                                            </span>
                                            {sale.cashierName && (
                                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-[10px] font-medium text-slate-600">
                                                    {sale.cashierName}
                                                </span>
                                            )}
                                            {sale.status === 'refunded' && (
                                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-px text-[10px] font-medium text-rose-700">Reembolsado</span>
                                            )}
                                            {sale.isRefund && (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-px text-[10px] font-medium text-amber-700">Devolución</span>
                                            )}
                                            {sale.reconciliationId && (
                                                <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px text-[10px] font-medium text-emerald-700">
                                                    <CheckCircle2 className="w-2.5 h-2.5" /> Cerrada
                                                </span>
                                            )}
                                        </div>
                                        {(sale.customerName || sale.customerID) && (
                                            <div className="flex items-center gap-1 text-[11px] font-medium text-blue-700">
                                                <User className="w-3 h-3 shrink-0" />
                                                <span className="truncate">{sale.customerName || 'Cliente general'}</span>
                                                {sale.customerID && <span className="text-slate-400 font-mono text-[10px]">({sale.customerID})</span>}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2.5 shrink-0">
                                        <div className="text-right">
                                            <p className={cn("text-sm sm:text-base font-semibold leading-none tabular-nums text-slate-900", sale.status === 'refunded' && "text-slate-400 line-through")}>
                                                {getSymbol()}{formatCurrency(sale.actualPaidAmount ?? sale.totalAmount)}
                                            </p>
                                            <p className="mt-1 text-[10px] text-slate-400 truncate max-w-[120px] sm:max-w-[180px]">{sale.paymentMethod}</p>
                                        </div>
                                        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")} />
                                    </div>
                                </button>

                                <SmoothCollapse open={isOpen} collapseMargin={false}>
                                    <div className="border-t border-slate-100 bg-slate-50/50 p-3.5 sm:p-4 space-y-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3">
                                            <div>
                                                <span className="text-[11px] font-medium text-slate-500">Resumen neto</span>
                                                <div className="flex items-baseline gap-2">
                                                    <p className="text-lg font-semibold tabular-nums text-slate-900">${formatCurrency(sale.actualPaidAmount ?? sale.totalAmount)}</p>
                                                    <span className="text-[11px] tabular-nums text-emerald-700 font-medium">BCV {(sale.bcvRateAtTime || currentBcvRate).toFixed(2)} Bs</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="sm" className="h-8 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => onReprint(sale)}>
                                                    <Printer className="mr-1.5 h-3.5 w-3.5 text-blue-600" /> Ticket
                                                </Button>
                                                <RefundButton sale={sale} />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                                <ShoppingBag className="w-3.5 h-3.5 text-blue-600" /> Artículos en esta venta
                                            </h4>
                                            <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden">
                                                <Table>
                                                    <TableHeader className="bg-slate-50/80">
                                                        <TableRow className="border-slate-100 hover:bg-transparent">
                                                            <TableHead className="h-8 text-[11px] font-medium text-slate-500">Producto / Concepto</TableHead>
                                                            <TableHead className="h-8 text-center text-[11px] font-medium text-slate-500">Cant.</TableHead>
                                                            <TableHead className="h-8 text-right text-[11px] font-medium text-slate-500">P. Unit</TableHead>
                                                            <TableHead className="h-8 text-right text-[11px] font-medium text-slate-500">Subtotal</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {sale.items.map((item, idx) => (
                                                            <TableRow key={idx} className="border-slate-100">
                                                                <TableCell className="py-2 text-xs font-medium text-slate-800">
                                                                    {item.name}
                                                                    {item.isPromo && <span className="ml-1.5 rounded-full bg-blue-50 border border-blue-200 px-1.5 py-px text-[9px] font-medium text-blue-700">Oferta</span>}
                                                                    {item.isWarranty && <span className="ml-1.5 rounded-full bg-orange-50 border border-orange-200 px-1.5 py-px text-[9px] font-medium text-orange-700">Garantía</span>}
                                                                </TableCell>
                                                                <TableCell className="py-2 text-center text-xs font-medium tabular-nums text-slate-600">x{item.quantity}</TableCell>
                                                                <TableCell className="py-2 text-right text-xs tabular-nums text-slate-500">${formatCurrency(item.price)}</TableCell>
                                                                <TableCell className="py-2 text-right text-xs font-semibold tabular-nums text-slate-900">${formatCurrency(item.price * item.quantity)}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                                    <Coins className="w-3.5 h-3.5 text-emerald-600" /> Detalle de pagos
                                                </h4>
                                                <div className="space-y-1.5">
                                                    {sale.payments.map((p, idx) => {
                                                        const Icon = methodIcons[p.method] || Landmark;
                                                        const isUSD = p.method === 'Efectivo USD' || p.method === 'USDT / Crypto';
                                                        return (
                                                            <div key={idx} className="flex justify-between items-center p-2.5 rounded-xl border border-slate-200/80 bg-white">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="p-1.5 bg-slate-100 rounded-lg shrink-0"><Icon className="w-3.5 h-3.5 text-slate-600" /></span>
                                                                    <div className="flex flex-col min-w-0">
                                                                        <span className="text-xs font-medium text-slate-800 truncate">{p.method}</span>
                                                                        {p.reference && <span className="text-[10px] font-mono text-slate-400 truncate max-w-[140px]">Ref: {p.reference}</span>}
                                                                    </div>
                                                                </div>
                                                                <span className="font-semibold text-xs tabular-nums text-slate-900 shrink-0">{isUSD ? '$' : 'Bs'} {formatCurrency(p.amount)}</span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>

                                            {sale.changeGiven && sale.changeGiven.length > 0 && (
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                                                        <Undo2 className="w-3.5 h-3.5" /> Vueltos entregados
                                                    </h4>
                                                    <div className="space-y-1.5">
                                                        {sale.changeGiven.map((c, idx) => {
                                                            const Icon = methodIcons[c.method] || Landmark;
                                                            const isUSD = c.method === 'Efectivo USD';
                                                            return (
                                                                <div key={idx} className="flex justify-between items-center p-2.5 rounded-xl border border-amber-200/80 bg-amber-50/50">
                                                                    <div className="flex items-center gap-2">
                                                                        <Icon className="w-3.5 h-3.5 text-amber-600" />
                                                                        <span className="text-xs font-medium text-amber-800">{c.method}</span>
                                                                    </div>
                                                                    <span className="font-semibold text-xs tabular-nums text-amber-800">-{isUSD ? '$' : 'Bs'} {formatCurrency(c.amount)}</span>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {sale.status === 'refunded' && (
                                            <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 space-y-1">
                                                <div className="flex items-center gap-1.5 text-rose-700 font-semibold text-xs">
                                                    <AlertTriangle className="w-3.5 h-3.5" /> Detalles del reembolso
                                                </div>
                                                <p className="text-xs text-slate-800"><span className="text-slate-500">Motivo:</span> {sale.refundReason}</p>
                                                <p className="text-xs text-slate-800"><span className="text-slate-500">Devuelto por:</span> {sale.refundPaymentMethod}</p>
                                                <p className="text-[11px] text-slate-500">Fecha: {sale.refundedAt ? format(parseISO(sale.refundedAt), "dd/MM/yy HH:mm", { locale: es }) : 'S/F'}</p>
                                            </div>
                                        )}
                                    </div>
                                </SmoothCollapse>
                            </div>
                        );
                    })
                )}

                {(totalPages > 1 || (onLoadMore && hasMore)) && (
                    <TablePaginationBar
                        page={currentPage}
                        totalPages={totalPages}
                        totalItems={filteredSales.length}
                        rangeStart={filteredSales.length === 0 ? 0 : ((currentPage - 1) * ITEMS_PER_PAGE) + 1}
                        rangeEnd={Math.min(currentPage * ITEMS_PER_PAGE, filteredSales.length)}
                        itemLabel="ventas"
                        actions={onLoadMore && hasMore ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onLoadMore}
                                disabled={isLoadingMore}
                                className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                                {isLoadingMore && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin text-blue-600" />}
                                <span className="hidden sm:inline">Cargar 100 más</span>
                                <span className="sm:hidden">+100</span>
                            </Button>
                        ) : undefined}
                        onPrevious={() => setCurrentPage(p => Math.max(1, p - 1))}
                        onNext={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        canPrevious={currentPage > 1}
                        canNext={currentPage < totalPages}
                    />
                )}
            </div>
        </div>
    )
}
