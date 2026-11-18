"use client";

import { cleanObject } from "@/lib/json-guard";
import { computePaymentTotals } from "@/lib/payments";
import { InlineProductPicker } from "@/components/fiados/inline-product-picker";
import { useCollection, useDoc, useFirebase, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy, limit, runTransaction, setDoc, increment, serverTimestamp } from "firebase/firestore";
import { fiadoOverviewWrites, overviewRef, saleStatsWrites, dailyRef, monthlyRef } from '@/lib/firestore/rollups';
import { invalidateStatsRange } from '@/lib/firestore/stats-range';
import { ensureOnline } from '@/lib/offline-guard';
import { TablePaginationBar } from '@/components/table-pagination-bar';
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import { useFeatureFlag } from '@/lib/features';
import { useDashboardStore } from '@/contexts/dashboard-context';
import type { Fiado, Sale, Payment, Product, FiadoItem, RepairJob, PaymentMethod } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Coins, PlusCircle, HandCoins, DollarSign, Trash2, Search, X, Plus, Minus, ShoppingCart, List, Clock, AlertTriangle, UserCheck, Calendar as CalendarIcon, Smartphone, CreditCard, Landmark, Banknote, ChevronDown, Loader2, Check, AlertCircle, ArrowRight, Receipt, Layers } from "lucide-react";
import { format, parseISO, differenceInDays, isBefore, isToday, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { SecurityGate } from "@/components/security-gate";
import { SmoothCollapse } from "@/components/ui/smooth-collapse";

const paymentMethodOptions: { value: PaymentMethod, label: string, icon: any, hasReference: boolean, isBs: boolean, iconBg: string, color: string }[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: DollarSign, hasReference: false, isBs: false, iconBg: 'bg-emerald-50 text-emerald-600', color: 'hover:border-emerald-300 hover:bg-emerald-50/30' },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: Landmark, hasReference: false, isBs: true, iconBg: 'bg-blue-50 text-blue-600', color: 'hover:border-blue-300 hover:bg-blue-50/30' },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: Smartphone, hasReference: true, isBs: true, iconBg: 'bg-indigo-50 text-indigo-600', color: 'hover:border-indigo-300 hover:bg-indigo-50/30' },
    { value: 'Tarjeta', label: 'Punto / Tarjeta', icon: CreditCard, hasReference: true, isBs: true, iconBg: 'bg-sky-50 text-sky-600', color: 'hover:border-sky-300 hover:bg-sky-50/30' },
    { value: 'Transferencia', label: 'Transferencia', icon: Banknote, hasReference: true, isBs: true, iconBg: 'bg-teal-50 text-teal-600', color: 'hover:border-teal-300 hover:bg-teal-50/30' },
    { value: 'USDT / Crypto', label: 'USDT / Crypto', icon: Coins, hasReference: true, isBs: false, iconBg: 'bg-violet-50 text-violet-600', color: 'hover:border-violet-300 hover:bg-violet-50/30' },
];

const changeMethodOptions: { value: PaymentMethod, label: string, icon: any, isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'USD Efectivo', icon: DollarSign, isBs: false },
    { value: 'Efectivo Bs', label: 'Bs Efectivo', icon: Landmark, isBs: true },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: Smartphone, isBs: true },
];

export default function FiadosPage() {
    return (
        <SecurityGate module="fiados">
            <FiadosContent />
        </SecurityGate>
    );
}

function FiadosContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, getSymbol, convert } = useCurrency();
    const { profile, addItemToCache } = useDashboardStore();
    const uid = user?.uid ?? '';
    const usePaged = useFeatureFlag(profile, 'pagedData');
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'overdue' | 'paid'>('all');
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedFiados, setExpandedFiados] = useState<Record<string, boolean>>({});
    const ITEMS_PER_PAGE = 20;

    // LEGACY (bandera apagada): todos los fiados, como hasta ahora.
    const fiadosCollection = useMemoFirebase(() => 
        (firestore && user && !usePaged) ? query(collection(firestore, "users", user.uid, "fiados"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid, usePaged]
    );
    const legacy = useCollection<Fiado>(fiadosCollection);

    // FASE 2: 50 por página + "Cargar 50 más".
    const paged = usePagedQuery<Fiado>({
        collectionName: 'fiados',
        orderField: 'createdAt',
        orderDir: 'desc',
        pageSize: 50,
        enabled: usePaged,
    });

    const fiados = usePaged ? paged.items : legacy.data;
    const isLoading = usePaged ? paged.isLoading : legacy.isLoading;

    // El "total en la calle" sale de stats/overview (1 lectura), no de la lista.
    const overviewDocRef = useMemoFirebase(() =>
        (firestore && user && usePaged) ? doc(firestore, 'users', user.uid, 'stats', 'overview') : null,
        [firestore, user?.uid, usePaged]
    );
    const { data: overview } = useDoc<{ fiados?: { pendingAmount?: number } }>(overviewDocRef);

    /** Sustituye al `mutate` del hook legacy cuando la bandera está activa. */
    const mutateFiados = useCallback((updater: WithId<Fiado>[] | ((prev: WithId<Fiado>[] | null) => WithId<Fiado>[] | null)) => {
        if (!usePaged || !uid) {
            legacy.mutate(updater);
            return;
        }

        const current = paged.items;
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (!Array.isArray(next)) return;

        const currentById = new Map(current.map((item) => [item.id, item]));
        const nextIds = new Set(next.map((item) => item.id));

        next.forEach((item) => {
            if (!item?.id) return;
            const previous = currentById.get(item.id);
            if (!previous) {
                queryCache.mergeIntoCatalog(uid, 'fiados', [item]);
            } else if (previous !== item) {
                queryCache.patchItem(uid, 'fiados', item.id, item);
            }
        });

        current.forEach((item) => {
            if (item.id && !nextIds.has(item.id)) {
                queryCache.removeItem(uid, 'fiados', item.id);
            }
        });
    }, [usePaged, uid, paged.items, legacy.mutate]);

    const fiadoCounts = useMemo(() => {
        const list = fiados || [];
        const today = startOfDay(new Date());
        let pending = 0;
        let overdue = 0;
        let paid = 0;
        for (const f of list) {
            if (f.status === 'Pagado') {
                paid++;
            } else {
                pending++;
                if (f.dueDate && (isBefore(parseISO(f.dueDate), today) || isToday(parseISO(f.dueDate)))) {
                    overdue++;
                }
            }
        }
        return { all: list.length, pending, overdue, paid };
    }, [fiados]);

    const filteredFiados = useMemo(() => {
        if (!fiados) return [];
        const term = searchTerm.toLowerCase().trim();
        const today = startOfDay(new Date());

        return fiados.filter(f => {
            if (statusFilter === 'pending' && f.status !== 'Pendiente') return false;
            if (statusFilter === 'paid' && f.status !== 'Pagado') return false;
            if (statusFilter === 'overdue') {
                const isOverdue = f.status === 'Pendiente' && !!f.dueDate &&
                    (isBefore(parseISO(f.dueDate), today) || isToday(parseISO(f.dueDate)));
                if (!isOverdue) return false;
            }
            if (!term) return true;
            return (
                f.customerName.toLowerCase().includes(term) ||
                f.customerID.toLowerCase().includes(term) ||
                f.concept.toLowerCase().includes(term)
            );
        });
    }, [fiados, searchTerm, statusFilter]);

    // Reset to first page when search or filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter]);

    const totalPages = Math.max(1, Math.ceil(filteredFiados.length / ITEMS_PER_PAGE));

    const paginatedFiados = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredFiados.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredFiados, currentPage, ITEMS_PER_PAGE]);

    const activeDebt = useMemo(() => {
        if (usePaged && typeof overview?.fiados?.pendingAmount === 'number') {
            return overview.fiados.pendingAmount;
        }
        if (!fiados) return 0;
        return fiados.filter(f => f.status === 'Pendiente').reduce((sum, f) => sum + (f.totalAmount - f.amountPaid), 0);
    }, [fiados, usePaged, overview]);

    const pendingOf = (fiado: Fiado) => Math.max(0, (fiado.totalAmount || 0) - (fiado.amountPaid || 0));

    /** Fase 1: mantiene el pendiente total en `stats/overview` (0 lecturas). */
    const applyFiadoStats = (prevPending: number, nextPending: number) => {
        if (!firestore || !user) return;
        try {
            void setDoc(
                overviewRef(firestore, user.uid),
                fiadoOverviewWrites(prevPending, nextPending),
                { merge: true },
            ).catch(() => {});
        } catch (error) {
            console.warn('[fiados] No se pudieron preparar los agregados:', error);
        }
    };

    const handleDeleteFiado = async (id: string) => {
        if (!firestore || !user) return;

        const fiado = fiados?.find(f => f.id === id);

        try {
            // Primero Firestore; si falla, la fila no desaparece falsamente.
            await deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'fiados', id));

            mutateFiados((prev) => prev?.filter(f => f.id !== id) || null);
            if (fiado) applyFiadoStats(pendingOf(fiado), 0);

            toast({ title: "Registro eliminado", variant: "destructive" });
        } catch (error) {
            toast({ title: "Error", description: "No se pudo eliminar el fiado.", variant: "destructive" });
        }
    };

    const handleFiadoAdded = (newFiado: Fiado) => {
        mutateFiados((prev) => [newFiado as any, ...(prev || [])]);
        applyFiadoStats(0, pendingOf(newFiado));
        setIsAddOpen(false);
    };

    const handleFiadoUpdated = (updatedFiado: Fiado) => {
        const previous = fiados?.find(f => f.id === updatedFiado.id);
        mutateFiados((prev) => prev?.map(f => f.id === updatedFiado.id ? { ...f, ...updatedFiado } : f) || null);
        if (previous) applyFiadoStats(pendingOf(previous), pendingOf(updatedFiado));
    };

    return (
        <div className="flex-1 bg-slate-100/70 min-h-0">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-3 sm:p-6">
                {/* Encabezado ejecutivo integrado */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                            <HandCoins className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Fiados y Créditos
                            </h1>
                            <p className="text-xs text-slate-500">
                                Cartera de clientes, abonos parciales y alertas de vencimiento
                            </p>
                        </div>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <AddFiadoDialog onAdded={handleFiadoAdded} isOpen={isAddOpen} setIsOpen={setIsAddOpen} existingFiados={fiados || []}>
                            <Button
                                size="sm"
                                className="h-10 w-full gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 text-xs font-semibold text-white shadow-sm shadow-emerald-500/25 transition-all hover:from-emerald-500 hover:to-teal-400 sm:h-9 sm:w-auto"
                            >
                                <Plus className="h-4 w-4" />
                                <span>Nuevo Fiado</span>
                            </Button>
                        </AddFiadoDialog>
                    </div>
                </div>

                {/* Resumen compacto + filtros KPI (mismo estilo compacto de Inventario/Reparaciones) */}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-50/60 via-white to-emerald-50/40 px-3 py-2 shadow-sm sm:min-w-[235px]">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white border border-blue-200/70 text-blue-600 shadow-sm">
                                <Coins className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 leading-tight">
                                <p className="truncate text-[11px] font-medium text-slate-600">En la calle</p>
                                <p className="text-[10px] font-medium tabular-nums text-emerald-700">
                                    Bs {formatCurrency(convert(activeDebt, 'USD', 'Bs', true))}
                                </p>
                            </div>
                        </div>
                        <span className="text-sm sm:text-base font-semibold tracking-tight tabular-nums text-slate-900 shrink-0">
                            {getSymbol()}{formatCurrency(activeDebt)}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
                        <button
                            type="button"
                            onClick={() => setStatusFilter('all')}
                            className={cn(
                                "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[120px] sm:px-3",
                                statusFilter === 'all'
                                    ? "border-blue-500 ring-2 ring-blue-500/15"
                                    : "border-slate-200/90 hover:border-slate-300"
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className={cn(
                                    "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                    statusFilter === 'all' ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                                )}>
                                    <Layers className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate text-xs font-medium text-slate-600">Todos</span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-slate-900">{fiadoCounts.all}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter('pending')}
                            className={cn(
                                "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[135px] sm:px-3",
                                statusFilter === 'pending'
                                    ? "border-amber-400 ring-2 ring-amber-400/20"
                                    : "border-slate-200/90 hover:border-slate-300"
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className={cn(
                                    "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                    statusFilter === 'pending' ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-600"
                                )}>
                                    <Clock className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate text-xs font-medium text-slate-600">Pendientes</span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-amber-600">{fiadoCounts.pending}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter('overdue')}
                            className={cn(
                                "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[130px] sm:px-3",
                                statusFilter === 'overdue'
                                    ? "border-rose-400 ring-2 ring-rose-400/20"
                                    : "border-slate-200/90 hover:border-slate-300"
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className={cn(
                                    "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                    statusFilter === 'overdue' ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-600"
                                )}>
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate text-xs font-medium text-slate-600">Vencidos</span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-rose-600">{fiadoCounts.overdue}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter('paid')}
                            className={cn(
                                "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[125px] sm:px-3",
                                statusFilter === 'paid'
                                    ? "border-emerald-400 ring-2 ring-emerald-400/20"
                                    : "border-slate-200/90 hover:border-slate-300"
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className={cn(
                                    "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                    statusFilter === 'paid' ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600"
                                )}>
                                    <Check className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate text-xs font-medium text-slate-600">Pagados</span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-emerald-600">{fiadoCounts.paid}</span>
                        </button>
                    </div>
                </div>

                {/* Cartera de clientes */}
                <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-slate-900">Cartera de clientes</h2>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                                {filteredFiados.length}
                            </span>
                        </div>
                        <div className="relative w-full sm:w-64">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                placeholder="Buscar cliente o concepto..."
                                className="h-10 sm:h-9 rounded-xl border-slate-200 bg-white pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Móvil: tarjetas plegables limpias */}
                    <div className="space-y-2.5 p-3 md:hidden">
                        {isLoading ? (
                            <div className="py-10 text-center text-xs text-slate-500">Cargando créditos...</div>
                        ) : paginatedFiados.length === 0 ? (
                            <div className="py-10 text-center text-xs text-slate-400">No hay registros que coincidan.</div>
                        ) : paginatedFiados.map((fiado) => {
                            const pending = fiado.totalAmount - fiado.amountPaid;
                            const daysOld = differenceInDays(new Date(), parseISO(fiado.createdAt));
                            const today = startOfDay(new Date());
                            const isOverdue = fiado.dueDate && fiado.status === 'Pendiente' &&
                                (isBefore(parseISO(fiado.dueDate), today) || isToday(parseISO(fiado.dueDate)));
                            const dueDateParsed = fiado.dueDate ? parseISO(fiado.dueDate) : null;
                            const daysDiff = dueDateParsed ? differenceInDays(dueDateParsed, today) : null;

                            const isOpen = !!expandedFiados[fiado.id!];
                            const toggleOpen = () => setExpandedFiados(prev => ({ ...prev, [fiado.id!]: !prev[fiado.id!] }));

                            return (
                                <div key={`m-${fiado.id}`} className={cn("overflow-hidden rounded-xl border bg-white shadow-sm", isOverdue ? "border-rose-200 bg-rose-50/20" : "border-slate-200/90")}>
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={toggleOpen}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                toggleOpen();
                                            }
                                        }}
                                        className="flex cursor-pointer items-center gap-2 p-3"
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className="truncate text-xs font-semibold text-slate-900">{fiado.customerName}</span>
                                            {fiado.isPromo && <span className="shrink-0 rounded-full bg-blue-50 border border-blue-200 px-1.5 py-px text-[9px] font-medium text-blue-700">Promo</span>}
                                            <span className={cn(
                                                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                                fiado.status === 'Pagado'
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : isOverdue
                                                        ? "border-rose-200 bg-rose-50 text-rose-700"
                                                        : "border-amber-200 bg-amber-50 text-amber-700"
                                            )}>
                                                {fiado.status}
                                            </span>
                                        </div>
                                        <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-700">${pending.toFixed(2)}</span>
                                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} />
                                    </div>

                                    <SmoothCollapse open={isOpen} collapseMargin={false}>
                                        <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-2.5">
                                            <div className="text-[11px] text-slate-500">
                                                {fiado.customerID} · {format(parseISO(fiado.createdAt), "dd/MM/yy")} ·{" "}
                                                <span className={cn("font-medium", daysOld > 15 ? "text-rose-600" : "text-slate-600")}>
                                                    {daysOld === 0 ? 'Hoy' : `Hace ${daysOld} días`}
                                                </span>
                                            </div>

                                            <div className="flex items-end justify-between gap-2">
                                                <div className="text-[11px] text-slate-500 tabular-nums">
                                                    Total <span className="font-semibold text-slate-800">${fiado.totalAmount.toFixed(2)}</span>
                                                    {" · "}Abonado <span className="font-semibold text-emerald-700">${fiado.amountPaid.toFixed(2)}</span>
                                                </div>
                                                <div className="text-right tabular-nums">
                                                    <div className="text-[10px] font-medium text-slate-400">Pendiente</div>
                                                    <div className="text-xs font-semibold leading-tight text-blue-700">${pending.toFixed(2)}</div>
                                                </div>
                                            </div>

                                            {fiado.status === 'Pendiente' && fiado.dueDate && (
                                                <div className={cn("flex items-center gap-1 text-[11px] font-medium", isOverdue ? "text-rose-600" : "text-amber-700")}>
                                                    {isOverdue ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                                                    <span>
                                                        {isOverdue
                                                            ? (isToday(dueDateParsed!) ? "Vence hoy" : `Atrasado ${Math.abs(daysDiff!)} días`)
                                                            : `Faltan ${daysDiff} días`}
                                                    </span>
                                                    <span className="font-normal text-slate-400">· Límite {format(parseISO(fiado.dueDate), "dd/MM/yy")}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-2.5 py-2" onClick={(event) => event.stopPropagation()}>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-blue-700 hover:bg-blue-50 hover:text-blue-800 rounded-lg">
                                                        <List className="h-3.5 w-3.5" />
                                                        <span className="text-[11px] font-medium">Ver ({fiado.items?.length || 0})</span>
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-72 p-3 rounded-xl border-slate-200 bg-white shadow-xl">
                                                    <p className="text-[11px] font-semibold text-slate-500 mb-2 border-b border-slate-100 pb-1.5">Artículos en deuda</p>
                                                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                                        {fiado.items?.map((item, idx) => (
                                                            <div key={idx} className="flex justify-between text-xs items-start gap-4">
                                                                <span className="font-medium text-slate-700">{item.quantity}x {item.productName}</span>
                                                                <span className="font-semibold text-slate-900 shrink-0 tabular-nums">${(item.price * item.quantity).toFixed(2)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between font-semibold text-xs">
                                                        <span className="text-slate-500">Valor total</span>
                                                        <span className="text-blue-700 tabular-nums">${fiado.totalAmount.toFixed(2)}</span>
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                            <div className="flex items-center gap-1.5">
                                                {fiado.status === 'Pendiente' && (
                                                    <>
                                                        <SetDeadlineDialog fiado={fiado} onUpdated={handleFiadoUpdated} />
                                                        <AddItemsToFiadoDialog fiado={fiado} onUpdated={handleFiadoUpdated} />
                                                        <CobrarFiadoDialog fiado={fiado} onUpdated={handleFiadoUpdated} />
                                                    </>
                                                )}
                                                <AdminAuthDialog actionType="deleteFiados" onAuthorized={() => handleDeleteFiado(fiado.id!)}>
                                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar fiado">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </AdminAuthDialog>
                                            </div>
                                        </div>
                                    </SmoothCollapse>
                                </div>
                            );
                        })}
                    </div>

                    {/* Escritorio: tabla limpia */}
                    <div className="hidden md:block">
                        <Table>
                            <TableHeader className="bg-slate-50/80 border-b border-slate-100">
                                <TableRow className="hover:bg-transparent border-slate-100">
                                    <TableHead className="text-[11px] font-medium text-slate-500">Antigüedad</TableHead>
                                    <TableHead className="text-[11px] font-medium text-slate-500">Cliente</TableHead>
                                    <TableHead className="text-[11px] font-medium text-slate-500">Artículos</TableHead>
                                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Total ($)</TableHead>
                                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Abonado ($)</TableHead>
                                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Pendiente ($)</TableHead>
                                    <TableHead className="text-center text-[11px] font-medium text-slate-500">Estado / Alerta</TableHead>
                                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-xs text-slate-500">Cargando créditos...</TableCell></TableRow>
                                ) : paginatedFiados.length === 0 ? (
                                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-xs text-slate-400">No hay registros que coincidan.</TableCell></TableRow>
                                ) : paginatedFiados.map((fiado) => {
                                    const pending = fiado.totalAmount - fiado.amountPaid;
                                    const daysOld = differenceInDays(new Date(), parseISO(fiado.createdAt));

                                    const today = startOfDay(new Date());
                                    const isOverdue = fiado.dueDate && fiado.status === 'Pendiente' &&
                                        (isBefore(parseISO(fiado.dueDate), today) || isToday(parseISO(fiado.dueDate)));

                                    const dueDateParsed = fiado.dueDate ? parseISO(fiado.dueDate) : null;
                                    const daysDiff = dueDateParsed ? differenceInDays(dueDateParsed, today) : null;

                                    return (
                                        <TableRow key={fiado.id} className={cn("border-slate-100 hover:bg-slate-50/60 transition-colors", isOverdue && "bg-rose-50/30 hover:bg-rose-50/50")}>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className={cn("text-xs font-medium", daysOld > 15 ? "text-rose-600" : "text-slate-700")}>
                                                        {daysOld === 0 ? 'Hoy' : `Hace ${daysOld} días`}
                                                    </span>
                                                    <span className="text-[11px] text-slate-400 tabular-nums">{format(parseISO(fiado.createdAt), "dd/MM/yy")}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-semibold text-xs text-slate-900">{fiado.customerName}</span>
                                                        {fiado.isPromo && <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-px text-[9px] font-medium text-blue-700">Promo</span>}
                                                    </div>
                                                    <span className="text-[11px] text-slate-400 font-mono">{fiado.customerID}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="h-7 rounded-lg text-blue-700 hover:bg-blue-50 hover:text-blue-800 gap-1.5 px-2">
                                                            <List className="h-3.5 w-3.5" />
                                                            <span className="text-[11px] font-medium">Ver ({fiado.items?.length || 0})</span>
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-72 p-3 rounded-xl border-slate-200 bg-white shadow-xl">
                                                        <p className="text-[11px] font-semibold text-slate-500 mb-2 border-b border-slate-100 pb-1.5">Artículos en deuda</p>
                                                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                                            {fiado.items?.map((item, idx) => (
                                                                <div key={idx} className="flex justify-between text-xs items-start gap-4">
                                                                    <span className="font-medium text-slate-700">{item.quantity}x {item.productName}</span>
                                                                    <span className="font-semibold text-slate-900 shrink-0 tabular-nums">${(item.price * item.quantity).toFixed(2)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between font-semibold text-xs">
                                                            <span className="text-slate-500">Valor total</span>
                                                            <span className="text-blue-700 tabular-nums">${fiado.totalAmount.toFixed(2)}</span>
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </TableCell>
                                            <TableCell className="text-right text-xs font-medium tabular-nums text-slate-700">${fiado.totalAmount.toFixed(2)}</TableCell>
                                            <TableCell className="text-right text-xs font-medium tabular-nums text-emerald-700">${fiado.amountPaid.toFixed(2)}</TableCell>
                                            <TableCell className="text-right text-xs font-semibold tabular-nums text-blue-700">${pending.toFixed(2)}</TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className={cn(
                                                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                                                        fiado.status === 'Pagado'
                                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                            : isOverdue
                                                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                                                : "border-amber-200 bg-amber-50 text-amber-700"
                                                    )}>
                                                        {fiado.status}
                                                    </span>

                                                    {fiado.status === 'Pendiente' && fiado.dueDate && (
                                                        <div className="flex flex-col items-center gap-0.5 mt-0.5">
                                                            {isOverdue ? (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600">
                                                                    <AlertTriangle className="w-3 h-3" />
                                                                    {isToday(dueDateParsed!) ? "Vence hoy" : `Atrasado ${Math.abs(daysDiff!)}d`}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] font-medium text-amber-700">
                                                                    Faltan {daysDiff}d
                                                                </span>
                                                            )}
                                                            <span className="text-[10px] text-slate-400 tabular-nums">Límite: {format(parseISO(fiado.dueDate), "dd/MM/yy")}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end items-center gap-1">
                                                    {fiado.status === 'Pendiente' && (
                                                        <>
                                                            <SetDeadlineDialog fiado={fiado} onUpdated={handleFiadoUpdated} />
                                                            <AddItemsToFiadoDialog fiado={fiado} onUpdated={handleFiadoUpdated} />
                                                            <CobrarFiadoDialog fiado={fiado} onUpdated={handleFiadoUpdated} />
                                                        </>
                                                    )}
                                                    <AdminAuthDialog actionType="deleteFiados" onAuthorized={() => handleDeleteFiado(fiado.id!)}>
                                                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </AdminAuthDialog>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {filteredFiados.length > 0 && (
                        <TablePaginationBar
                            page={currentPage}
                            totalPages={totalPages}
                            totalItems={filteredFiados.length}
                            rangeStart={filteredFiados.length === 0 ? 0 : ((currentPage - 1) * ITEMS_PER_PAGE) + 1}
                            rangeEnd={Math.min(currentPage * ITEMS_PER_PAGE, filteredFiados.length)}
                            itemLabel="créditos"
                            info={usePaged ? `Cargados: ${fiados?.length || 0}` : undefined}
                            actions={usePaged ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2.5 text-xs font-medium gap-1.5 rounded-lg border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                    onClick={() => { void paged.loadMore(); }}
                                    disabled={!paged.hasMore || paged.isLoadingMore}
                                >
                                    {paged.isLoadingMore
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <PlusCircle className="h-3.5 w-3.5 text-blue-600" />}
                                    <span className="hidden sm:inline">{paged.hasMore ? 'Cargar 50 más' : 'Historial completo'}</span>
                                    <span className="sm:hidden">{paged.hasMore ? '+50' : 'Completo'}</span>
                                </Button>
                            ) : undefined}
                            onPrevious={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            onNext={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            canPrevious={currentPage > 1}
                            canNext={currentPage < totalPages}
                        />
                    )}
                </div>
            </main>
        </div>
    );
}

function SetDeadlineDialog({ fiado, onUpdated }: { fiado: Fiado, onUpdated: (f: Fiado) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState(fiado.dueDate || "");

    const handleSave = () => {
        if (!firestore || !user || !fiado.id) return;

        onUpdated({ ...fiado, dueDate: date || undefined });

        updateDocumentNonBlocking(doc(firestore, 'users', user.uid, 'fiados', fiado.id), {
            dueDate: date || null
        });
        toast({ title: "Fecha de pago guardada" });
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className={cn("h-8 w-8 p-0 rounded-lg border-slate-200 bg-white hover:bg-slate-50", fiado.dueDate ? "text-amber-600 border-amber-200 bg-amber-50/50 hover:bg-amber-50" : "text-slate-500")} title="Establecer alerta de pago">
                    <Clock className="h-3.5 w-3.5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-[390px] p-0 sm:p-0 gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="px-4 py-4 sm:px-5 border-b border-slate-100 bg-white">
                    <DialogHeader className="space-y-0 pr-12 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 border border-amber-200 text-amber-600">
                                <Clock className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 text-left">
                                <DialogTitle className="truncate text-sm font-semibold leading-none text-slate-900 sm:text-base sm:leading-tight">
                                    Fecha límite de pago
                                </DialogTitle>
                                <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                                    Te alertaremos visualmente al llegar la fecha.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>
                <div className="px-4 py-4 sm:px-5 space-y-2 bg-white">
                    <Label className="text-[11px] font-medium text-slate-500">Fecha de pago acordada</Label>
                    <div className="relative">
                        <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            type="date"
                            className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white pl-9 text-xs text-slate-900 focus-visible:border-blue-500"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter className="flex-row items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-5 sm:py-3">
                    <Button variant="outline" onClick={() => setOpen(false)} className="h-10 sm:h-9 flex-1 sm:flex-none rounded-xl sm:rounded-lg border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} className="h-10 sm:h-9 flex-1 sm:flex-none rounded-xl sm:rounded-lg bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-4 text-xs font-medium text-white shadow-sm hover:from-blue-500 hover:to-indigo-500">
                        Guardar alerta
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function AddFiadoDialog({ children, onAdded, isOpen, setIsOpen, existingFiados }: { children: React.ReactNode, onAdded: (f: Fiado) => void, isOpen: boolean, setIsOpen: (v: boolean) => void, existingFiados: Fiado[] }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { getFinalPrice } = useCurrency();
    const [loading, setLoading] = useState(false);

    const [customerID, setCustomerID] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [concept, setConcept] = useState("");
    const [totalAmount, setTotalAmount] = useState("");
    const [selectedItems, setSelectedItems] = useState<FiadoItem[]>([]);

    const productsCollection = useMemoFirebase(() => 
        (firestore && user && isOpen) ? query(collection(firestore, 'users', user.uid, 'products'), limit(50)) : null, 
        [firestore, user?.uid, isOpen]
    );
    const { data: products } = useCollection<Product>(productsCollection);

    const repairJobsCollection = useMemoFirebase(() => 
        (firestore && user && isOpen) ? query(collection(firestore, 'users', user.uid, 'repair_jobs'), orderBy('createdAt', 'desc'), limit(100)) : null, 
        [firestore, user?.uid, isOpen]
    );
    const { data: repairJobs } = useCollection<RepairJob>(repairJobsCollection);

    const foundCustomer = useMemo(() => {
        if (!customerID || customerID.length < 5) return null;
        
        const fiadoMatch = existingFiados.find(f => f.customerID.toLowerCase() === customerID.toLowerCase());
        if (fiadoMatch) return { name: fiadoMatch.customerName, phone: fiadoMatch.customerPhone };
        
        const repairMatch = repairJobs?.find(r => r.customerID?.toLowerCase() === customerID.toLowerCase());
        if (repairMatch) return { name: repairMatch.customerName, phone: repairMatch.customerPhone };
        
        return null;
    }, [customerID, existingFiados, repairJobs]);

    const handleApplyCustomerData = () => {
        if (foundCustomer) {
            setCustomerName(foundCustomer.name);
            setCustomerPhone(foundCustomer.phone);
            toast({ title: "Datos cargados", description: `Se han aplicado los datos de ${foundCustomer.name}` });
        }
    };

    useEffect(() => {
        if (selectedItems.length > 0) {
            const total = selectedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const desc = selectedItems.map(i => `${i.quantity}x ${i.productName}`).join(", ");
            setTotalAmount(total.toFixed(2));
            setConcept(desc);
        }
    }, [selectedItems]);

    const handleAddItem = (p: Product) => {
        const price = getFinalPrice(p);
        setSelectedItems(prev => {
            const existing = prev.find(i => i.productId === p.id);
            if (existing) {
                return prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { 
                productId: p.id!, 
                productName: p.name, 
                quantity: 1, 
                price, 
                costPrice: p.costPrice,
                isPromo: !!(p.promoPrice && p.promoPrice > 0)
            }];
        });
    };

    const handleUpdateItemQty = (id: string, delta: number) => {
        setSelectedItems(prev => prev
            .map(i => i.productId === id ? { ...i, quantity: i.quantity + delta } : i)
            .filter(i => i.quantity > 0)
        );
    };

    const handleRemoveItem = (id: string) => {
        setSelectedItems(prev => prev.filter(i => i.productId !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || loading) return;
        if (!ensureOnline(toast, 'Crear un fiado')) return;

        setLoading(true);
        try {
            const dataToSave: any = {};
            await runTransaction(firestore, async (transaction) => {
                const productSnaps = new Map();
                for(const item of selectedItems) {
                    if (!productSnaps.has(item.productId)) {
                        const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', item.productId));
                        productSnaps.set(item.productId, snap);
                    }
                }

                for (const item of selectedItems) {
                    const pDoc = productSnaps.get(item.productId);
                    if (pDoc?.exists()) {
                        const currentStock = pDoc.data().stockLevel || 0;
                        if (currentStock < item.quantity) {
                            throw new Error(`Stock insuficiente para "${item.productName}".`);
                        }
                        transaction.update(pDoc.ref, { stockLevel: currentStock - item.quantity });
                    }
                }

                const totalCost = selectedItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0);
                const fiadosRef = collection(firestore, 'users', user.uid, 'fiados');
                const newDoc = doc(fiadosRef);
                const finalData = cleanObject({
                    id: newDoc.id,
                    customerID,
                    customerName,
                    customerPhone,
                    concept,
                    totalAmount: parseFloat(totalAmount) || 0,
                    amountPaid: 0,
                    totalCost: totalCost,
                    status: 'Pendiente',
                    createdAt: new Date().toISOString(),
                    items: selectedItems,
                    isPromo: selectedItems.some(i => i.isPromo)
                });
                transaction.set(newDoc, finalData);
                Object.assign(dataToSave, finalData);
            });

            toast({ title: "Fiado registrado" });
            onAdded(dataToSave as Fiado);
            setCustomerID(""); setCustomerName(""); setCustomerPhone(""); setConcept(""); setTotalAmount(""); setSelectedItems([]);
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-[500px] max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 sm:p-0 shadow-2xl">
                <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
                    <DialogHeader className="space-y-0 pr-12 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                <HandCoins className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 text-left">
                                <DialogTitle className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900 sm:text-base sm:leading-tight">
                                    <span className="sm:hidden">Nuevo fiado</span>
                                    <span className="hidden sm:inline">Registrar Nuevo Crédito</span>
                                </DialogTitle>
                                <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                                    Los productos seleccionados se restarán del inventario inmediatamente.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <form onSubmit={handleSubmit} autoComplete="off" className="flex min-h-0 flex-1 flex-col bg-white">
                    <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:px-5">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500">Cédula / RIF</Label>
                                <Input
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={customerID}
                                    onChange={(e) => setCustomerID(e.target.value.toUpperCase())}
                                    placeholder="V-12345678"
                                    className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white font-mono text-xs uppercase text-slate-900 placeholder:font-sans placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500"
                                    required
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500">Nombre y apellido</Label>
                                <Input
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="Ej: Juan Pérez"
                                    className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500"
                                    required
                                />
                            </div>
                        </div>

                        <SmoothCollapse open={Boolean(foundCustomer && customerName !== foundCustomer.name)}>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 font-medium w-full"
                                onClick={handleApplyCustomerData}
                            >
                                <UserCheck className="w-3.5 h-3.5" />
                                Cargar datos de {foundCustomer?.name}
                            </Button>
                        </SmoothCollapse>

                        <div className="space-y-1.5 border-t border-slate-100 pt-3">
                            <Label className="text-[11px] font-medium text-slate-500">Añadir productos del inventario</Label>
                            <InlineProductPicker
                                products={products || []}
                                onPick={handleAddItem}
                                getPrice={getFinalPrice}
                                label="Buscar producto o SKU..."
                            />
                        </div>

                        {selectedItems.length > 0 && (
                            <div className="space-y-1.5">
                                {selectedItems.map(item => (
                                    <div key={item.productId} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2 text-xs">
                                        <span className="font-medium text-slate-800 flex-1 truncate">{item.productName}</span>
                                        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateItemQty(item.productId, -1)}
                                                className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                                                aria-label="Restar cantidad"
                                            >
                                                <Minus className="h-3 w-3" />
                                            </button>
                                            <span className="w-5 text-center text-[11px] font-semibold tabular-nums text-slate-800">{item.quantity}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateItemQty(item.productId, 1)}
                                                className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                                                aria-label="Sumar cantidad"
                                            >
                                                <Plus className="h-3 w-3" />
                                            </button>
                                        </div>
                                        <span className="font-semibold tabular-nums text-slate-900 w-14 text-right shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
                                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => handleRemoveItem(item.productId)}>
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="space-y-1">
                            <Label className="text-[11px] font-medium text-slate-500">Concepto (descripción final)</Label>
                            <Input
                                autoComplete="off"
                                spellCheck={false}
                                value={concept}
                                onChange={(e) => setConcept(e.target.value)}
                                placeholder="Ej: Pantalla Samsung A51"
                                className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500">Teléfono</Label>
                                <Input
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={customerPhone}
                                    onChange={(e) => setCustomerPhone(e.target.value)}
                                    placeholder="0414-0000000"
                                    className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500"
                                    required
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500">Monto total ($)</Label>
                                <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    value={totalAmount}
                                    onChange={(e) => setTotalAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold tabular-nums text-slate-900 focus-visible:border-blue-500"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-5 sm:py-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsOpen(false)}
                            disabled={loading}
                            className="h-10 flex-1 rounded-xl border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:h-9 sm:flex-none sm:rounded-lg"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            className="h-10 flex-1 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-5 text-xs font-medium text-white shadow-sm shadow-blue-500/20 hover:from-blue-500 hover:to-indigo-500 sm:h-9 sm:flex-none sm:rounded-lg"
                            disabled={loading || selectedItems.length === 0}
                        >
                            {loading ? "Procesando..." : "Crear fiado"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AddItemsToFiadoDialog({ fiado, onUpdated }: { fiado: Fiado, onUpdated: (f: Fiado) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { getFinalPrice } = useCurrency();
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [selectedItems, setSelectedItems] = useState<FiadoItem[]>([]);

    const productsCollection = useMemoFirebase(() => 
        (firestore && user && open) ? query(collection(firestore, 'users', user.uid, 'products'), limit(50)) : null, 
        [firestore, user?.uid, open]
    );
    const { data: products } = useCollection<Product>(productsCollection);

    const handleAddItem = (p: Product) => {
        const price = getFinalPrice(p);
        setSelectedItems(prev => {
            const existing = prev.find(i => i.productId === p.id);
            if (existing) {
                return prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { productId: p.id!, productName: p.name, quantity: 1, price, costPrice: p.costPrice }];
        });
    };

    const handleUpdateItemQty = (id: string, delta: number) => {
        setSelectedItems(prev => prev
            .map(i => i.productId === id ? { ...i, quantity: i.quantity + delta } : i)
            .filter(i => i.quantity > 0)
        );
    };

    const handleRemoveItem = (id: string) => {
        setSelectedItems(prev => prev.filter(i => i.productId !== id));
    };

    const handleUpdate = async () => {
        if (!firestore || !user || loading || selectedItems.length === 0) return;
        if (!ensureOnline(toast, 'Agregar productos al fiado')) return;

        setLoading(true);
        try {
            const updatedData: any = {};
            await runTransaction(firestore, async (transaction) => {
                const fiadoRef = doc(firestore, 'users', user.uid, 'fiados', fiado.id!);
                const fiadoSnap = await transaction.get(fiadoRef);
                if (!fiadoSnap.exists()) throw new Error("El registro de deuda ya no existe.");
                const currentFiadoData = fiadoSnap.data() as Fiado;

                const productSnaps = new Map();
                for (const item of selectedItems) {
                    if (!productSnaps.has(item.productId)) {
                        const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', item.productId));
                        productSnaps.set(item.productId, snap);
                    }
                }

                for (const item of selectedItems) {
                    const pDoc = productSnaps.get(item.productId);
                    if (pDoc?.exists()) {
                        const currentStock = pDoc.data().stockLevel || 0;
                        if (currentStock < item.quantity) {
                            throw new Error(`Stock insuficiente para "${item.productName}".`);
                        }
                        transaction.update(pDoc.ref, { stockLevel: currentStock - item.quantity });
                    }
                }

                const addedTotal = selectedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                const addedCost = selectedItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0);
                const newTotal = currentFiadoData.totalAmount + addedTotal;
                const newCost = (currentFiadoData.totalCost || 0) + addedCost;
                const newItems = [...(currentFiadoData.items || []), ...selectedItems];
                const newConcept = currentFiadoData.concept + ", " + selectedItems.map(i => `${i.quantity}x ${i.productName}`).join(", ");

                const changes = {
                    totalAmount: newTotal,
                    totalCost: newCost,
                    items: newItems,
                    concept: newConcept
                };
                transaction.update(fiadoRef, cleanObject(changes));
                Object.assign(updatedData, { ...currentFiadoData, ...changes });
            });

            toast({ title: "Cuenta actualizada correctamente" });
            onUpdated(updatedData as Fiado);
            setOpen(false);
            setSelectedItems([]);
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 rounded-lg border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-blue-600" title="Añadir más productos a esta cuenta">
                    <ShoppingCart className="h-3.5 w-3.5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-[460px] max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 sm:p-0 shadow-2xl">
                <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
                    <DialogHeader className="space-y-0 pr-12 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                <ShoppingCart className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 text-left">
                                <DialogTitle className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900 sm:text-base sm:leading-tight">
                                    Añadir a {fiado.customerName}
                                </DialogTitle>
                                <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                                    Se sumarán a la deuda actual y se descontarán del inventario.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:px-5 bg-white">
                    <InlineProductPicker
                        products={products || []}
                        onPick={handleAddItem}
                        getPrice={getFinalPrice}
                        label="Buscar producto para añadir..."
                    />

                    {selectedItems.length > 0 ? (
                        <div className="space-y-1.5">
                            {selectedItems.map(item => (
                                <div key={item.productId} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2 text-xs">
                                    <span className="font-medium text-slate-800 flex-1 truncate">{item.productName}</span>
                                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateItemQty(item.productId, -1)}
                                            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                                            aria-label="Restar cantidad"
                                        >
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span className="w-5 text-center text-[11px] font-semibold tabular-nums text-slate-800">{item.quantity}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateItemQty(item.productId, 1)}
                                            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                                            aria-label="Sumar cantidad"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                    <span className="font-semibold tabular-nums text-slate-900 w-14 text-right shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => handleRemoveItem(item.productId)}>
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-4 text-center text-xs text-slate-400">
                            Selecciona uno o más productos para añadir a la deuda.
                        </p>
                    )}
                </div>

                <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-5 sm:py-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOpen(false)}
                        disabled={loading}
                        className="h-10 flex-1 rounded-xl border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:h-9 sm:flex-none sm:rounded-lg"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleUpdate}
                        className="h-10 flex-1 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-5 text-xs font-medium text-white shadow-sm hover:from-blue-500 hover:to-indigo-500 sm:h-9 sm:flex-none sm:rounded-lg"
                        disabled={loading || selectedItems.length === 0}
                    >
                        {loading ? "Procesando..." : "Confirmar y añadir"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CobrarFiadoDialog({ fiado, onUpdated }: { fiado: Fiado, onUpdated: (f: Fiado) => void }) {
    const { firestore, user } = useFirebase();
    const { addItemToCache, activeOperator, profile, registerName } = useDashboardStore();
    const { toast } = useToast();
    const { format: formatCurrency, bcvRate, parallelRate, convert } = useCurrency();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [payments, setPayments] = useState<(Payment & { id: number })[]>([]);
    const [changePayments, setChangePayments] = useState<(Payment & { id: number })[]>([]);
    const [isGivingChange, setIsGivingChange] = useState(false);

    const pending = fiado.totalAmount - fiado.amountPaid;

    // Motor de cobro compartido con el POS.
    const totals = useMemo(
        () =>
            computePaymentTotals({
                payments,
                changePayments,
                total: pending,
                useParallelRate: true,
                convert,
                isGivingChange,
            }),
        [payments, changePayments, pending, convert, isGivingChange],
    );

    const totalAbonoInUSD = totals.paidUSD;
    const totalChangeGivenInUSD = totals.changeGivenUSD;
    const remainingToPayInUSD = totals.remainingUSD;
    const potentialChangeInUSD = totals.potentialChangeUSD;
    const requiredChangeInUSD = totals.requiredChangeUSD;
    const changeDifference = totals.changeDifference;
    const remainingInUSD = Math.max(0, pending - totals.netPaidUSD);

    useEffect(() => {
        if (potentialChangeInUSD <= 0.001) {
            setIsGivingChange(false);
            setChangePayments([]);
        }
    }, [potentialChangeInUSD]);

    const handleAddPayment = (method: PaymentMethod) => {
        setPayments(prev => [...prev, { id: Date.now(), method, amount: 0, reference: '' }]);
    };

    const handleUpdatePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
        setPayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    const handleRemovePayment = (id: number) => {
        setPayments(prev => prev.filter(p => p.id !== id));
    };

    const handleAddChangePayment = (method: PaymentMethod) => {
        setChangePayments(prev => [...prev, { id: Date.now(), method, amount: 0, reference: '' }]);
    };

    const handleUpdateChangePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
        setChangePayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    const handleRemoveChangePayment = (id: number) => {
        setChangePayments(prev => prev.filter(p => p.id !== id));
    };

    const handleAbono = async () => {
        if (!firestore || !user || payments.length === 0 || loading) return;
        
        const finalNetAbonoInUSD = totalAbonoInUSD - totalChangeGivenInUSD;
        
        if (finalNetAbonoInUSD <= 0) {
            toast({ title: "Monto inválido", variant: "destructive" });
            return;
        }

        setLoading(true);
        let saleDataForCache: Sale | null = null;
        if (!ensureOnline(toast, 'Registrar un abono')) {
            setLoading(false);
            return;
        }
        try {
            const updatedFiado: any = {};
            await runTransaction(firestore, async (transaction) => {
                const fiadoRef = doc(firestore, 'users', user.uid, 'fiados', fiado.id!);
                const fiadoSnap = await transaction.get(fiadoRef);
                
                if (!fiadoSnap.exists()) throw new Error("El registro de deuda ya no existe.");
                const currentFiado = fiadoSnap.data() as Fiado;
                if (currentFiado.status === 'Pagado') {
                    throw new Error("Esta cuenta ya fue saldada en otra caja.");
                }

                const saleId = `S-FIA-${Date.now()}`;
                const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', saleId);

                const newPaid = currentFiado.amountPaid + finalNetAbonoInUSD;
                const isFullyPaid = newPaid >= (currentFiado.totalAmount - 0.01);

                // El abono cobra deuda ya vendida: se le asigna su parte del costo
                // original y se marca como custom para que NO aparezca como "artículo".
                const costRatio = currentFiado.totalAmount > 0
                    ? Number(currentFiado.totalCost || 0) / currentFiado.totalAmount
                    : 0;
                const abonoCost = Number((finalNetAbonoInUSD * costRatio).toFixed(2));

                const saleData = cleanObject({
                    id: saleId,
                    fiadoId: fiado.id,
                    items: [{
                        productId: fiado.id!,
                        name: `Abono Fiado: ${currentFiado.customerName}`,
                        quantity: 1,
                        price: finalNetAbonoInUSD,
                        costPrice: abonoCost,
                        isCustom: true,
                    }],
                    totalAmount: finalNetAbonoInUSD,
                    subtotal: finalNetAbonoInUSD,
                    discount: 0,
                    costPrice: abonoCost,
                    paymentMethod: payments.map(p => p.method).join(', '),
                    transactionDate: new Date().toISOString(),
                    status: 'completed',
                    payments: payments.map(({id, ...rest}) => rest),
                    actualPaidAmount: finalNetAbonoInUSD,
                    changeGiven: isGivingChange ? changePayments.map(({id, ...rest}) => rest) : [],
                    totalChangeInUSD: isGivingChange ? totalChangeGivenInUSD : 0,
                    bcvRateAtTime: bcvRate,
                    parallelRateAtTime: parallelRate,
                    cashierId: activeOperator?.id || 'owner',
                    cashierName: activeOperator?.name || profile?.accountName || 'Dueño',
                    registerName,
                });

                transaction.set(saleRef, saleData);

                // El abono también debe entrar en los agregados: totales sí,
                // desglose por artículo no (su ítem es isCustom).
                const stats = saleStatsWrites(saleData as Sale);
                transaction.set(dailyRef(firestore, user.uid, stats.day), stats.daily, { merge: true });
                transaction.set(monthlyRef(firestore, user.uid, stats.day.slice(0, 7)), stats.monthly, { merge: true });
                transaction.set(
                    doc(firestore, 'users', user.uid, 'system', 'estadisticas_actuales'),
                    {
                        totalRealSales30d: increment(finalNetAbonoInUSD),
                        totalRealProfit30d: increment(finalNetAbonoInUSD - abonoCost),
                        updatedAt: serverTimestamp(),
                    },
                    { merge: true },
                );

                transaction.update(fiadoRef, {
                    amountPaid: Number(newPaid.toFixed(2)),
                    status: isFullyPaid ? 'Pagado' : 'Pendiente'
                });
                
                Object.assign(updatedFiado, {
                    ...currentFiado,
                    amountPaid: Number(newPaid.toFixed(2)),
                    status: isFullyPaid ? 'Pagado' : 'Pendiente'
                });

                saleDataForCache = saleData as Sale;
            });
            
            if (saleDataForCache) {
                addItemToCache('sale_transactions', saleDataForCache);
                queryCache.mergeIntoCatalog(user.uid, 'sale_transactions', [saleDataForCache]);
                invalidateStatsRange(user.uid);
            }

            toast({ title: "Abono Registrado" });
            onUpdated(updatedFiado as Fiado);
            setOpen(false);
            setPayments([]);
            setChangePayments([]);
            setIsGivingChange(false);
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const abonoProgress = Math.min(100, Math.round((totalAbonoInUSD / Math.max(pending, 0.01)) * 100));
    const isCovered = remainingToPayInUSD <= 0.009;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 rounded-lg border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800">
                    Abonar
                </Button>
            </DialogTrigger>
            <DialogContent className={cn(
                "w-[calc(100%-1.5rem)] max-w-[440px] transition-all duration-300 overflow-hidden flex flex-col p-0 sm:p-0 gap-0 max-h-[88dvh] border border-slate-200 bg-white shadow-2xl rounded-2xl",
                isGivingChange ? "sm:max-w-[720px]" : "sm:max-w-[500px]"
            )}>
                <div className="flex flex-col max-h-[88dvh] overflow-hidden bg-white">
                    {/* Header */}
                    <div className="px-4 py-3 sm:px-5 border-b border-slate-100 shrink-0 bg-white">
                        <DialogHeader className="space-y-0 pr-12 text-left">
                            <div className="flex h-11 items-center gap-2 sm:h-auto">
                                <span className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                    <HandCoins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                </span>
                                <div className="min-w-0 text-left">
                                    <DialogTitle className="truncate text-sm sm:text-[15px] font-semibold leading-none sm:leading-tight text-slate-900">
                                        Abono · {fiado.customerName}
                                    </DialogTitle>
                                    <DialogDescription className="sr-only">
                                        Registrar pago o abono parcial para la cuenta de {fiado.customerName}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                    </div>

                    {/* Contenido */}
                    <div className={cn("grid grid-cols-1 gap-3 px-4 py-3 sm:px-5 sm:py-3.5 flex-1 min-h-0 overflow-y-auto bg-white", isGivingChange && "md:grid-cols-2")}>
                        <div className="space-y-2.5">
                            {/* Hero Card Luminoso: Deuda pendiente */}
                            <div className="relative overflow-hidden p-3 sm:p-3.5 rounded-xl bg-gradient-to-br from-blue-50/60 via-white to-emerald-50/45 border border-blue-200/80 shadow-sm">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[11px] font-medium text-slate-500">Deuda pendiente</span>
                                    {isCovered ? (
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                                            <Check className="w-2.5 h-2.5" /> Cubierto
                                        </span>
                                    ) : totalAbonoInUSD > 0 ? (
                                        <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium px-2 py-0.5 rounded-full">
                                            Abono ({abonoProgress}%)
                                        </span>
                                    ) : (
                                        <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                                            <AlertCircle className="w-2.5 h-2.5 text-rose-600" /> Pendiente
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-row items-baseline justify-between gap-2">
                                    <div className="text-xl sm:text-2xl font-semibold tracking-tight tabular-nums text-slate-900">
                                        ${formatCurrency(pending)}
                                    </div>
                                    <div className="text-xs font-medium tabular-nums text-emerald-700">
                                        ≈ Bs {formatCurrency(convert(pending, 'USD', 'Bs', true))}
                                    </div>
                                </div>

                                <div className="mt-2 pt-2 border-t border-slate-200/70">
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
                                        <div
                                            className={cn("h-full rounded-full transition-all duration-300", isCovered ? "bg-emerald-500" : "bg-gradient-to-r from-blue-600 to-indigo-500")}
                                            style={{ width: `${abonoProgress}%` }}
                                        />
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                                        <span>Recibido: <span className="font-medium tabular-nums text-slate-800">${formatCurrency(totalAbonoInUSD)}</span></span>
                                        {remainingToPayInUSD > 0.009 ? (
                                            <span className="font-medium tabular-nums text-rose-600">Nuevo saldo: ${formatCurrency(remainingInUSD)}</span>
                                        ) : (
                                            <span className="font-medium text-emerald-700 flex items-center gap-1"><Check className="w-3 h-3" /> Total cubierto</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Métodos de pago */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label className="text-[11px] font-semibold text-slate-800">Métodos de pago</Label>
                                    <span className="text-[10px] font-normal text-slate-400">
                                        {payments.length} seleccionado{payments.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                                    {paymentMethodOptions.map(option => {
                                        const Icon = option.icon;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleAddPayment(option.value)}
                                                className={cn(
                                                    "flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 text-left transition-all active:scale-[0.98] cursor-pointer",
                                                    option.color,
                                                )}
                                            >
                                                <span className={cn("shrink-0 rounded-md p-1.5", option.iconBg)}>
                                                    <Icon className="h-3.5 w-3.5" />
                                                </span>
                                                <span className="truncate text-[11px] sm:text-xs font-medium text-slate-800">{option.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Lista de pagos */}
                            {payments.length > 0 ? (
                                <div className="space-y-1.5">
                                    <Label className="text-[11px] font-semibold text-slate-800">Desglose del abono</Label>
                                    <ScrollArea className="max-h-[150px] pr-1">
                                        <div className="space-y-1.5">
                                            {payments.map(p => {
                                                const option = paymentMethodOptions.find(o => o.value === p.method)!;
                                                const Icon = option.icon;
                                                const symbol = option.isBs ? 'Bs' : '$';
                                                const remainingInCurrency = option.isBs ? convert(remainingToPayInUSD, 'USD', 'Bs', true) : remainingToPayInUSD;

                                                return (
                                                <div
                                                    key={p.id}
                                                    className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white p-2"
                                                >
                                                    <div className="flex min-w-0 flex-1 sm:flex-none sm:w-[116px] items-center gap-1.5">
                                                        <div className={cn("shrink-0 rounded-md p-1", option.iconBg)}>
                                                            <Icon className="h-3 w-3" />
                                                        </div>
                                                        <span className="truncate text-[11px] sm:text-xs font-medium text-slate-800" title={p.method}>
                                                            {p.method}
                                                        </span>
                                                    </div>

                                                    <div className="relative w-24 sm:w-28 shrink-0">
                                                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400">{symbol}</span>
                                                        <Input
                                                            type="number"
                                                            step="any"
                                                            placeholder="0.00"
                                                            className="h-8 rounded-md border-slate-200 bg-white pl-6 pr-2 text-xs font-medium tabular-nums text-slate-900 focus-visible:border-blue-500"
                                                            value={p.amount || ''}
                                                            onChange={(e) => handleUpdatePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </div>

                                                    {remainingToPayInUSD > 0.009 && (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleUpdatePayment(p.id, 'amount', Number(((Number(p.amount) || 0) + remainingInCurrency).toFixed(2)))}
                                                            className="h-8 px-2 text-[10px] sm:text-[11px] font-medium text-blue-700 border-blue-200 bg-blue-50/70 hover:bg-blue-100 rounded-md shrink-0"
                                                            title="Completar monto restante"
                                                        >
                                                            + Restante
                                                        </Button>
                                                    )}

                                                    {option.hasReference && (
                                                        <Input
                                                            placeholder="Referencia"
                                                            className="h-8 flex-1 min-w-[100px] rounded-md border-slate-200 bg-white font-mono text-xs uppercase text-slate-800 placeholder:normal-case placeholder:font-sans placeholder:text-slate-400"
                                                            value={p.reference}
                                                            onChange={(e) => handleUpdatePayment(p.id, 'reference', e.target.value)}
                                                        />
                                                    )}

                                                    <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 shrink-0 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => handleRemovePayment(p.id)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/40">
                                    <Receipt className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <p className="text-[11px] font-medium text-slate-500">
                                        Selecciona un método arriba para registrar el abono
                                    </p>
                                </div>
                            )}

                            {/* Resumen de vuelto */}
                            <SmoothCollapse open={potentialChangeInUSD > 0.001}>
                                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/90 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[11px] font-medium text-emerald-800">Vuelto a favor del cliente</span>
                                        <div className="text-right tabular-nums">
                                            <p className="text-sm sm:text-base font-semibold text-emerald-700 leading-tight">${potentialChangeInUSD.toFixed(2)}</p>
                                            <p className="text-[10px] font-medium text-emerald-700/80">≈ Bs {formatCurrency(convert(potentialChangeInUSD, 'USD', 'Bs', true))}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-2 pt-1.5 border-t border-emerald-200/70">
                                        <Checkbox
                                            id="give-change-fiados"
                                            checked={isGivingChange}
                                            onCheckedChange={(checked) => {
                                                setIsGivingChange(!!checked);
                                                if (!checked) setChangePayments([]);
                                            }}
                                        />
                                        <Label htmlFor="give-change-fiados" className="cursor-pointer font-medium text-[11px] text-emerald-800">
                                            Desglosar entrega de vuelto en caja
                                        </Label>
                                    </div>
                                </div>
                            </SmoothCollapse>
                        </div>

                        {/* Panel de Gestión de Vueltos */}
                        {isGivingChange && (
                            <div className="space-y-2.5 md:border-l md:border-slate-100 md:pl-3.5 animate-in slide-in-from-right-4 duration-300">
                                <div className="text-center p-3 rounded-xl bg-blue-50/60 border border-blue-200/80">
                                    <p className="text-[10px] font-medium text-slate-500">Total vuelto a entregar</p>
                                    <p className="text-xl font-semibold tabular-nums text-blue-700">${requiredChangeInUSD.toFixed(2)}</p>
                                    <p className="text-[11px] font-medium tabular-nums text-emerald-700">≈ Bs {formatCurrency(convert(requiredChangeInUSD, 'USD', 'Bs', true))}</p>
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-[11px] font-semibold text-slate-800">Moneda o método de entrega</Label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {changeMethodOptions.map(method => (
                                            <Button
                                                key={method.value}
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[11px] font-medium rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-2"
                                                onClick={() => handleAddChangePayment(method.value)}
                                            >
                                                <method.icon className="w-3 h-3 mr-1 text-blue-600" /> {method.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>

                                <ScrollArea className="max-h-[140px] pr-1">
                                    <div className="space-y-1.5">
                                        {changePayments.map(p => {
                                            const option = changeMethodOptions.find(o => o.value === p.method)!;
                                            const symbol = option.isBs ? 'Bs' : '$';
                                            return (
                                                <div key={p.id} className="bg-white p-2 rounded-lg border border-slate-200/90 flex gap-1.5 items-center">
                                                    <span className="text-[11px] font-medium text-slate-700 w-24 truncate">{p.method}</span>
                                                    <div className="relative flex-1">
                                                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] font-medium">{symbol}</span>
                                                        <Input
                                                            type="number"
                                                            step="any"
                                                            className="h-8 rounded-md border-slate-200 bg-white pl-6 text-xs font-medium tabular-nums"
                                                            value={p.amount || ''}
                                                            placeholder="0.00"
                                                            onChange={(e) => handleUpdateChangePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => handleRemoveChangePayment(p.id)}>
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </ScrollArea>

                                <div className={cn(
                                    "text-center font-medium text-[11px] p-2 rounded-lg border transition-colors",
                                    Math.abs(changeDifference) > 0.01 ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                )}>
                                    {Math.abs(changeDifference) > 0.01
                                        ? `Falta por desglosar: $${Math.abs(changeDifference).toFixed(2)} (≈ Bs ${formatCurrency(convert(Math.abs(changeDifference), 'USD', 'Bs', true))})`
                                        : "Desglose de vuelto cuadrado ✓"}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="px-4 py-3 sm:px-5 border-t border-slate-100 shrink-0 bg-white">
                        <Button
                            onClick={handleAbono}
                            className="w-full h-10 text-xs sm:text-sm font-medium rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm shadow-blue-500/25 transition-all"
                            disabled={!totals.canConfirm || loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Procesando pago...
                                </>
                            ) : (
                                <div className="flex items-center justify-center gap-2">
                                    <span>Registrar abono</span>
                                    <ArrowRight className="w-4 h-4" />
                                </div>
                            )}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
