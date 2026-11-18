"use client";

import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy, setDoc } from "firebase/firestore";
import { dailyRef, expenseStatsWrites, monthlyRef } from '@/lib/firestore/rollups';
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import type { QueryFilter } from '@/lib/firestore/cache-policy';
import { useDailyStatsRange, invalidateStatsRange } from '@/lib/firestore/stats-range';
import { useIsMobile } from "@/hooks/use-mobile";
import { TablePaginationBar } from '@/components/table-pagination-bar';
import { useFeatureFlag } from '@/lib/features';
import { useDashboardStore } from '@/contexts/dashboard-context';
import type { Expense, PaymentMethod, ExpenseCategory } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, PlusCircle, Trash2, Receipt, Search, Calendar as CalendarIcon, ArrowDownCircle, DollarSign, Landmark, Loader2 } from "lucide-react";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmoothCollapse } from "@/components/ui/smooth-collapse";

const CATEGORIES: ExpenseCategory[] = ["Mercancía", "Servicios", "Alquiler", "Retiro Personal", "Otros"];
const BS_PAYMENT_METHODS: PaymentMethod[] = ['Efectivo Bs', 'Tarjeta / Pago Móvil', 'Transferencia'];

export default function ExpensesPage() {
    return (
        <SecurityGate module="expenses">
            <ExpensesContent />
        </SecurityGate>
    );
}

function ExpensesContent() {
    const isMobile = useIsMobile();
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, convert, bcvRate } = useCurrency();
    const { profile } = useDashboardStore();
    const uid = user?.uid ?? '';
    const usePaged = useFeatureFlag(profile, 'pagedData');
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
    });
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    const fromIso = dateRange?.from ? startOfDay(dateRange.from).toISOString() : undefined;
    const toIso = dateRange?.to
        ? endOfDay(dateRange.to).toISOString()
        : dateRange?.from
            ? endOfDay(dateRange.from).toISOString()
            : undefined;

    // LEGACY (bandera apagada): todos los gastos, como hasta ahora.
    const expensesCollection = useMemoFirebase(() => 
        (firestore && user && !usePaged) ? query(collection(firestore, "users", user.uid, "expenses"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid, usePaged]
    );
    const legacy = useCollection<Expense>(expensesCollection);

    // FASE 2: solo el rango seleccionado, 50 por página.
    const rangeFilters: QueryFilter[] = fromIso && toIso
        ? [['createdAt', '>=', fromIso], ['createdAt', '<=', toIso]]
        : [];

    const paged = usePagedQuery<Expense>({
        collectionName: 'expenses',
        filters: rangeFilters,
        orderField: 'createdAt',
        orderDir: 'desc',
        pageSize: 50,
        enabled: usePaged,
    });

    const expenses = usePaged ? paged.items : legacy.data;
    const isLoading = usePaged ? paged.isLoading : legacy.isLoading;

    /** Sustituye al `mutate` del hook legacy cuando la bandera está activa. */
    const mutateExpenses = useCallback((updater: WithId<Expense>[] | ((prev: WithId<Expense>[] | null) => WithId<Expense>[] | null)) => {
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
                queryCache.mergeIntoCatalog(uid, 'expenses', [item]);
            } else if (previous !== item) {
                queryCache.patchItem(uid, 'expenses', item.id, item);
            }
        });

        current.forEach((item) => {
            if (item.id && !nextIds.has(item.id)) {
                queryCache.removeItem(uid, 'expenses', item.id);
            }
        });
    }, [usePaged, uid, paged.items, legacy.mutate]);

    const filteredExpenses = useMemo(() => {
        if (!expenses) return [];
        return expenses.filter(ex => {
            const matchesSearch = ex.description.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = categoryFilter === "ALL" || ex.category === categoryFilter;
            
            let matchesDate = true;
            if (dateRange?.from) {
                const date = parseISO(ex.createdAt);
                const from = startOfDay(dateRange.from);
                const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
                matchesDate = isValid(date) && isWithinInterval(date, { start: from, end: to });
            }

            return matchesSearch && matchesCategory && matchesDate;
        });
    }, [expenses, searchTerm, categoryFilter, dateRange]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, categoryFilter, dateRange]);

    const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / ITEMS_PER_PAGE));

    const paginatedExpenses = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredExpenses.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredExpenses, currentPage, ITEMS_PER_PAGE]);

    const { stats: rangeStats, hasData: hasRangeStats } = useDailyStatsRange(
        usePaged ? dateRange?.from : undefined,
        usePaged ? (dateRange?.to || dateRange?.from) : undefined,
    );

    const stats = useMemo(() => {
        if (usePaged && hasRangeStats && rangeStats) {
            const usd = rangeStats.expensesUSD;
            const bs = rangeStats.expensesBs;
            return { usd, bs, totalUSD: usd + convert(bs, 'Bs', 'USD') };
        }

        let usd = 0;
        let bs = 0;
        filteredExpenses.forEach(ex => {
            usd += ex.amountUSD || 0;
            bs += ex.amountBs || 0;
        });
        return { usd, bs, totalUSD: usd + convert(bs, 'Bs', 'USD') };
    }, [usePaged, hasRangeStats, rangeStats, filteredExpenses, convert]);

    /** Fase 1: agrega/revierte un gasto sin lecturas (best-effort). */
    const applyExpenseStats = (expense: Expense, sign: 1 | -1) => {
        if (!firestore || !user) return;

        try {
            const stats = expenseStatsWrites(expense, sign);
            void setDoc(dailyRef(firestore, user.uid, stats.day), stats.daily, { merge: true }).catch(() => {});
            void setDoc(monthlyRef(firestore, user.uid, stats.day.slice(0, 7)), stats.monthly, { merge: true }).catch(() => {});
            invalidateStatsRange(user.uid);
        } catch (error) {
            console.warn('[gastos] No se pudieron preparar los agregados:', error);
        }
    };

    const handleDelete = async (id: string) => {
        if (!firestore || !user || !id) return;

        const expense = expenses?.find(ex => ex.id === id);

        try {
            // Primero Firestore; si falla, la fila no desaparece falsamente.
            await deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'expenses', id));

            mutateExpenses((prev) => prev?.filter(ex => ex.id !== id) || null);

            // Fase 1: revertir el agregado del gasto (0 lecturas, best-effort).
            if (expense) applyExpenseStats(expense, -1);

            toast({ title: "Gasto eliminado", variant: "destructive" });
        } catch (error) {
            toast({ title: "Error", description: "No se pudo eliminar el gasto.", variant: "destructive" });
        }
    };

    const handleExpenseAdded = (newExpense: Expense) => {
        mutateExpenses((prev) => [newExpense as any, ...(prev || [])]);
        // Fase 1: agregar el gasto a los agregados diarios/mensuales.
        applyExpenseStats(newExpense, 1);
        setIsAddOpen(false);
    };

    return (
        <div className="flex-1 bg-slate-100/70 min-h-0">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-3 sm:p-6">
                {/* Encabezado ejecutivo integrado */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-200/80 bg-rose-50 text-rose-600 shadow-sm">
                            <Receipt className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Gastos y Egresos
                            </h1>
                            <p className="text-xs text-slate-500">
                                Control de salidas operativas, compras y retiros
                            </p>
                        </div>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                        "h-10 sm:h-9 shrink-0 justify-start gap-1.5 rounded-xl border-slate-200 bg-white px-3 text-left text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900",
                                        !dateRange && "text-slate-400"
                                    )}
                                >
                                    <CalendarIcon className="h-4 w-4 text-blue-600 shrink-0" />
                                    <span>
                                        {dateRange?.from ? (
                                            dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime()
                                                ? `${format(dateRange.from, "dd/MM")} - ${format(dateRange.to, "dd/MM")}`
                                                : format(dateRange.from, "dd/MM/yy")
                                        ) : "Fecha"}
                                    </span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 bg-white border-slate-200 rounded-xl shadow-xl" align="end">
                                <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={isMobile ? 1 : 2} locale={es} />
                            </PopoverContent>
                        </Popover>

                        <AddExpenseDialog onAdded={handleExpenseAdded} isOpen={isAddOpen} setIsOpen={setIsAddOpen}>
                            <Button
                                size="sm"
                                className="h-10 flex-1 gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 text-xs font-semibold text-white shadow-sm shadow-emerald-500/25 transition-all hover:from-emerald-500 hover:to-teal-400 sm:h-9 sm:flex-none"
                            >
                                <Plus className="h-4 w-4" />
                                <span>Registrar Gasto</span>
                            </Button>
                        </AddExpenseDialog>
                    </div>
                </div>

                {/* KPIs compactos del periodo */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
                    <div className="col-span-2 sm:col-span-1 flex items-center justify-between gap-3 rounded-xl border border-rose-200/80 bg-white px-3 py-2 shadow-sm sm:min-w-[210px]">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                                <ArrowDownCircle className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 leading-tight">
                                <p className="truncate text-[11px] font-medium text-slate-600">Total gastos</p>
                                <p className="text-[10px] text-slate-400">Ref. USD</p>
                            </div>
                        </div>
                        <span className="text-sm sm:text-base font-semibold tracking-tight tabular-nums text-rose-600 shrink-0">
                            ${formatCurrency(stats.totalUSD)}
                        </span>
                    </div>

                    <div className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3 py-2 shadow-sm sm:min-w-[180px]">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                <DollarSign className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">En USD</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-slate-900 shrink-0">
                            ${formatCurrency(stats.usd)}
                        </span>
                    </div>

                    <div className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3 py-2 shadow-sm sm:min-w-[205px]">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                                <Landmark className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 leading-tight">
                                <p className="truncate text-xs font-medium text-slate-600">En Bs</p>
                                <p className="text-[10px] text-slate-400 tabular-nums">≈ ${formatCurrency(convert(stats.bs, 'Bs', 'USD'))}</p>
                            </div>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-emerald-700 shrink-0">
                            Bs {formatCurrency(stats.bs)}
                        </span>
                    </div>
                </div>

                {/* Tabla / Lista de transacciones */}
                <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-slate-900">Historial de egresos</h2>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                                {filteredExpenses.length}
                            </span>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="relative w-full sm:w-60">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    placeholder="Buscar descripción..."
                                    className="h-10 sm:h-9 rounded-xl border-slate-200 bg-white pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                <SelectTrigger className="h-10 sm:h-9 w-full sm:w-44 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700">
                                    <SelectValue placeholder="Categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Todas las categorías</SelectItem>
                                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Móvil: tarjetas limpias */}
                    <div className="space-y-2.5 p-3 md:hidden">
                        {isLoading ? (
                            <div className="py-10 text-center text-xs text-slate-500">Cargando gastos...</div>
                        ) : paginatedExpenses.length === 0 ? (
                            <div className="py-10 text-center text-xs text-slate-400">No hay gastos registrados en este periodo.</div>
                        ) : paginatedExpenses.map((ex) => {
                            const date = parseISO(ex.createdAt);
                            return (
                                <div key={`m-${ex.id}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <p className="truncate text-xs font-semibold text-slate-900">{ex.description}</p>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                                {ex.category}
                                            </span>
                                            <span className="text-[11px] text-slate-500">
                                                {ex.amountUSD > 0 ? ex.methodUSD : ex.methodBs}
                                            </span>
                                            <span className="text-[11px] text-slate-400 tabular-nums">
                                                · {isValid(date) ? format(date, "dd/MM/yy") : 'N/A'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <div className="flex flex-col items-end tabular-nums">
                                            {ex.amountUSD > 0 && <span className="text-xs font-semibold text-rose-600">-${formatCurrency(ex.amountUSD)}</span>}
                                            {ex.amountBs > 0 && <span className="text-[11px] font-medium text-emerald-700">Bs {formatCurrency(ex.amountBs)}</span>}
                                        </div>
                                        <AdminAuthDialog actionType="deleteExpenses" onAuthorized={() => handleDelete(ex.id!)}>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Eliminar gasto">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </AdminAuthDialog>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Escritorio: tabla limpia */}
                    <div className="hidden md:block">
                        <Table>
                            <TableHeader className="bg-slate-50/80 border-b border-slate-100">
                                <TableRow className="hover:bg-transparent border-slate-100">
                                    <TableHead className="text-[11px] font-medium text-slate-500">Fecha</TableHead>
                                    <TableHead className="text-[11px] font-medium text-slate-500">Descripción</TableHead>
                                    <TableHead className="text-[11px] font-medium text-slate-500">Categoría</TableHead>
                                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Monto salida</TableHead>
                                    <TableHead className="text-[11px] font-medium text-slate-500">Método</TableHead>
                                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-xs text-slate-500">Cargando gastos...</TableCell></TableRow>
                                ) : paginatedExpenses.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-xs text-slate-400">No hay gastos registrados en este periodo.</TableCell></TableRow>
                                ) : paginatedExpenses.map((ex) => {
                                    const date = parseISO(ex.createdAt);
                                    return (
                                        <TableRow key={ex.id} className="border-slate-100 hover:bg-slate-50/60 transition-colors">
                                            <TableCell className="text-xs text-slate-500 tabular-nums">
                                                {isValid(date) ? format(date, "dd/MM/yy hh:mm a") : 'N/A'}
                                            </TableCell>
                                            <TableCell className="text-xs font-medium text-slate-900">{ex.description}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                                                    {ex.category}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex flex-col items-end tabular-nums">
                                                    {ex.amountUSD > 0 && <span className="text-xs font-semibold text-rose-600">-${formatCurrency(ex.amountUSD)}</span>}
                                                    {ex.amountBs > 0 && <span className="text-[11px] font-medium text-emerald-700">Bs {formatCurrency(ex.amountBs)}</span>}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-slate-600">{ex.amountUSD > 0 ? ex.methodUSD : ex.methodBs}</span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <AdminAuthDialog actionType="deleteExpenses" onAuthorized={() => handleDelete(ex.id!)}>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AdminAuthDialog>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {(filteredExpenses.length > 0 || usePaged) && (
                        <TablePaginationBar
                            page={currentPage}
                            totalPages={totalPages}
                            totalItems={filteredExpenses.length}
                            rangeStart={filteredExpenses.length === 0 ? 0 : ((currentPage - 1) * ITEMS_PER_PAGE) + 1}
                            rangeEnd={Math.min(currentPage * ITEMS_PER_PAGE, filteredExpenses.length)}
                            itemLabel="gastos"
                            info={usePaged ? `Cargados: ${expenses?.length || 0}` : undefined}
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
                                    <span className="hidden sm:inline">{paged.hasMore ? 'Cargar 50 más' : 'Rango completo'}</span>
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

function AddExpenseDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: (expense: Expense) => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { activeOperator, profile } = useDashboardStore();
    const { toast } = useToast();
    const [description, setDescription] = useState("");
    const [amountUSD, setAmountUSD] = useState("");
    const [amountBs, setAmountBs] = useState("");
    const [methodBs, setMethodBs] = useState<PaymentMethod>("Tarjeta / Pago Móvil");
    const [category, setCategory] = useState<ExpenseCategory>("Mercancía");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !description.trim()) return;
        setLoading(true);
        try {
            const expensesRef = collection(firestore, 'users', user.uid, 'expenses');
            const newDoc = doc(expensesRef);
            const data: Expense = {
                id: newDoc.id,
                description: description.trim().toUpperCase(),
                category,
                amountUSD: parseFloat(amountUSD) || 0,
                amountBs: parseFloat(amountBs) || 0,
                methodUSD: 'Efectivo USD',
                methodBs: methodBs,
                createdAt: new Date().toISOString(),
                cashierId: activeOperator?.id || 'owner',
                cashierName: activeOperator?.name || profile?.accountName || 'Dueño',
            };
            await setDocumentNonBlocking(newDoc, data, { merge: true });
            toast({ title: "Gasto Registrado" });
            setDescription(""); setAmountUSD(""); setAmountBs("");
            onAdded(data);
        } catch (e) {
            toast({ title: "Error al registrar", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-[440px] max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 sm:p-0 shadow-2xl">
                <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
                    <DialogHeader className="space-y-0 pr-12 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-sm">
                                <Receipt className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 text-left">
                                <DialogTitle className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900 sm:text-base sm:leading-tight">
                                    Registrar Egreso
                                </DialogTitle>
                                <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                                    Indica el concepto y el monto para descontarlo de tu saldo real.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <form onSubmit={handleSubmit} autoComplete="off" className="flex min-h-0 flex-1 flex-col bg-white">
                    <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:px-5">
                        <div className="space-y-1">
                            <Label className="text-[11px] font-medium text-slate-500">Concepto del gasto</Label>
                            <Input
                                value={description}
                                onChange={(e) => setDescription(e.target.value.toUpperCase())}
                                placeholder="Ej: Compra de pantallas, alquiler..."
                                className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900 placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus-visible:border-blue-500"
                                required
                                autoFocus
                            />
                        </div>

                        <div className="space-y-1">
                            <Label className="text-[11px] font-medium text-slate-500">Categoría</Label>
                            <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                                <SelectTrigger className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-800">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-xl border border-blue-200/80 bg-blue-50/35 px-3 py-2.5 focus-within:border-blue-400">
                                <Label className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                                    <DollarSign className="h-3 w-3 text-blue-600" /> En Dólares ($)
                                </Label>
                                <div className="mt-1 flex items-center">
                                    <span className="mr-1 text-sm font-medium text-blue-600">$</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        value={amountUSD}
                                        onChange={(e) => setAmountUSD(e.target.value)}
                                        placeholder="0.00"
                                        className="h-7 w-full min-w-0 bg-transparent p-0 text-base font-semibold tabular-nums text-slate-900 outline-none placeholder:text-slate-400"
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/35 px-3 py-2.5 focus-within:border-emerald-400">
                                <Label className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                                    <Landmark className="h-3 w-3 text-emerald-600" /> En Bolívares (Bs)
                                </Label>
                                <div className="mt-1 flex items-center">
                                    <span className="mr-1 text-xs font-medium text-emerald-700">Bs</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        value={amountBs}
                                        onChange={(e) => setAmountBs(e.target.value)}
                                        placeholder="0.00"
                                        className="h-7 w-full min-w-0 bg-transparent p-0 text-base font-semibold tabular-nums text-emerald-700 outline-none placeholder:text-slate-400"
                                    />
                                </div>
                            </div>
                        </div>

                        <SmoothCollapse open={parseFloat(amountBs) > 0}>
                            <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-blue-700">¿De qué cuenta salen los Bolívares?</Label>
                                <Select value={methodBs} onValueChange={(v: any) => setMethodBs(v)}>
                                    <SelectTrigger className="h-10 sm:h-9 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-800">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {BS_PAYMENT_METHODS.map(m => (
                                            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </SmoothCollapse>
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
                            disabled={loading || !description.trim()}
                        >
                            {loading ? "Procesando..." : "Confirmar salida"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
