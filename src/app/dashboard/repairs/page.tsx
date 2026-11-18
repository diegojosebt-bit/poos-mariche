"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Plus, PlusCircle, CalendarIcon, X as ClearIcon, Clock, DollarSign, ShieldCheck, Loader2, Wrench, Trash2, Layers } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { columns } from "@/components/repairs/columns";
import { MobileRepairCard } from "@/components/repairs/mobile-repair-card";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, query, orderBy, limit, doc, getDoc } from "firebase/firestore";
import type { RepairJob } from "@/lib/types";
import { format, isWithinInterval, startOfDay, endOfDay, isAfter, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { RepairFormDialog } from "@/components/repairs/repair-form-dialog";
import { ExportRepairsDialog } from "@/components/repairs/export-repairs-dialog";
import type { FilterFn } from "@tanstack/react-table";
import { SecurityGate } from "@/components/security-gate";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { useDraftModals } from "@/contexts/draft-modals-context";
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { useServerSearch } from '@/lib/firestore/use-server-search';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import { useFeatureFlag } from '@/lib/features';
import { normalizeText } from '@/lib/search-index';

const repairFilterFn: FilterFn<RepairJob> = (row, columnId, value) => {
    const term = normalizeText(String(value));
    const r = row.original;
    return (
        normalizeText(r.customerName).includes(term) ||
        normalizeText(r.customerPhone).includes(term) ||
        normalizeText(r.customerID).includes(term) ||
        normalizeText(r.deviceMake).includes(term) ||
        normalizeText(r.deviceModel).includes(term) ||
        normalizeText(r.reportedIssue).includes(term) ||
        normalizeText(r.id).includes(term)
    );
};

/**
 * Reconoce un folio completo (`R-261115-4821`, con o sin guiones).
 * Sirve para ir directo al documento: 1 lectura y aparece aunque no esté
 * en la página cargada.
 */
function parseFolio(term: string): string | null {
    const raw = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw.startsWith('R')) return null;

    const digits = raw.slice(1);
    // Sólo el folio completo (R-YYMMDD-XXXX) dispara la consulta:
    // así escribir a medias no consume lecturas.
    if (digits.length !== 10) return null;
    return `R-${digits.slice(0, 6)}-${digits.slice(6)}`;
}

type StatusFilter = 'all' | 'unpaid' | 'undelivered' | 'warranty' | 'deleted';

export default function RepairsPage() {
    return (
        <SecurityGate module="repairs">
            <RepairsContent />
        </SecurityGate>
    );
}

function RepairsContent() {
    const { firestore, user } = useFirebase();
    const { profile } = useDashboardStore();
    const uid = user?.uid ?? '';
    const usePaged = useFeatureFlag(profile, 'pagedData');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const { drafts, saveDraft, clearDraft, setFormOpen } = useDraftModals();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [restoreDraftOpen, setRestoreDraftOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const handledRestoreRef = useRef<string | null>(null);
    const keepDraftRef = useRef(false);

    useEffect(() => {
        setFormOpen(createOpen || restoreDraftOpen);
    }, [createOpen, restoreDraftOpen, setFormOpen]);

    useEffect(() => () => setFormOpen(false), [setFormOpen]);

    const handleRepairMinimize = (values: any) => {
        keepDraftRef.current = true;
        saveDraft('repair', values);
    };

    const handleRepairOpenChange = (open: boolean, setOpen: (value: boolean) => void) => {
        setOpen(open);
        if (!open) {
            if (!keepDraftRef.current) clearDraft('repair');
            keepDraftRef.current = false;
        }
    };

    const restoreToken = searchParams.get('restoreDraft') === 'repair'
        ? (searchParams.get('t') || 'legacy')
        : null;

    useEffect(() => {
        if (!restoreToken || !drafts.repair) return;
        if (handledRestoreRef.current === restoreToken) return;

        handledRestoreRef.current = restoreToken;
        setRestoreDraftOpen(true);
        // Limpiar la URL sin permitir que el efecto vuelva a abrir el modal.
        router.replace('/dashboard/repairs', { scroll: false });
    }, [restoreToken, drafts.repair, router]);

    // LEGACY (bandera apagada): 100 registros recientes, como hasta ahora.
    const repairJobsQuery = useMemoFirebase(() =>
        (firestore && user && !usePaged) 
            ? query(collection(firestore, 'users', user.uid, 'repair_jobs'), orderBy('createdAt', 'desc'), limit(100)) 
            : null,
        [firestore, user?.uid, usePaged]
    );
    const legacy = useCollection<RepairJob>(repairJobsQuery);

    // FASE 2 (bandera encendida): 100 por página + "Cargar 100 más".
    const paged = usePagedQuery<RepairJob>({
        collectionName: 'repair_jobs',
        orderField: 'createdAt',
        orderDir: 'desc',
        pageSize: 100,
        enabled: usePaged,
    });

    const repairJobs = usePaged ? paged.items : legacy.data;
    const isLoading = usePaged ? paged.isLoading : legacy.isLoading;

    /** Sustituye al `mutate` del hook legacy cuando la bandera está activa. */
    const mutateRepairs = useCallback((updater: WithId<RepairJob>[] | ((prev: WithId<RepairJob>[] | null) => WithId<RepairJob>[] | null)) => {
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
                queryCache.mergeIntoCatalog(uid, 'repair_jobs', [item]);
            } else if (previous !== item) {
                queryCache.patchItem(uid, 'repair_jobs', item.id, item);
            }
        });

        current.forEach((item) => {
            if (item.id && !nextIds.has(item.id)) {
                queryCache.removeItem(uid, 'repair_jobs', item.id);
            }
        });
    }, [usePaged, uid, paged.items, legacy.mutate]);

    // Búsqueda en servidor: los resultados se fusionan a la caché de reparaciones.
    const [searchTerm, setSearchTerm] = useState('');
    const serverSearchFlag = useFeatureFlag(profile, 'serverSearch');
    const serverSearch = useServerSearch<RepairJob>({
        collectionName: 'repair_jobs',
        term: searchTerm,
        orderField: 'createdAt',
        orderDir: 'desc',
        pageSize: 20,
        enabled: usePaged && serverSearchFlag,
        onResults: (found) => queryCache.mergeIntoCatalog(uid, 'repair_jobs', found),
    });
    const handleSearchChange = useCallback((value: string) => setSearchTerm(value), []);

    // Búsqueda directa por folio: 1 lectura y trae órdenes que no están en la página.
    const [folioHit, setFolioHit] = useState<WithId<RepairJob> | null>(null);
    useEffect(() => {
        const folio = parseFolio(searchTerm);
        if (!folio || !firestore || !uid || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            setFolioHit(null);
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const snap = await getDoc(doc(firestore, 'users', uid, 'repair_jobs', folio));
                if (cancelled) return;
                setFolioHit(snap.exists() ? ({ ...(snap.data() as RepairJob), id: snap.id } as WithId<RepairJob>) : null);
            } catch {
                if (!cancelled) setFolioHit(null);
            }
        }, 400);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [searchTerm, firestore, uid]);

    const jobsWithFolio = useMemo(() => {
        const base = repairJobs ?? [];
        if (!folioHit) return base;
        if (base.some((job) => job.id === folioHit.id)) return base;
        return [folioHit, ...base];
    }, [repairJobs, folioHit]);

    const [editingJob, setEditingJob] = useState<RepairJob | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const statusCounts = useMemo(() => {
        const now = new Date();
        let all = 0;
        let unpaid = 0;
        let undelivered = 0;
        let warranty = 0;
        let deleted = 0;

        for (const job of jobsWithFolio) {
            if (job.isDeleted === true) {
                deleted++;
                continue;
            }
            all++;
            if (!job.isPaid) unpaid++;
            if (job.status !== 'Completado') undelivered++;
            if (job.status === 'Completado' && job.warrantyEndDate && isAfter(parseISO(job.warrantyEndDate), now)) {
                warranty++;
            }
        }

        return { all, unpaid, undelivered, warranty, deleted };
    }, [jobsWithFolio]);

    // Top 4 fallas más reportadas (calculadas en RAM, 0 lecturas extra a Firestore)
    const topReportedIssues = useMemo(() => {
        const counts = new Map<string, number>();
        for (const job of jobsWithFolio) {
            const raw = (job.reportedIssue || "").trim().replace(/\s+/g, " ");
            if (raw.length < 3) continue;
            const key = raw.toLowerCase();
            counts.set(key, (counts.get(key) || 0) + 1);
        }

        const formatIssue = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
        const top = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([key]) => formatIssue(key));

        const defaults = ["Pantalla rota", "Pin de carga", "Cambio de batería", "No enciende"];
        for (const fallback of defaults) {
            if (top.length >= 4) break;
            if (!top.some((item) => item.toLowerCase() === fallback.toLowerCase())) {
                top.push(fallback);
            }
        }
        return top;
    }, [jobsWithFolio]);

    const filteredRepairJobs = useMemo(() => {
        if (!jobsWithFolio.length) return [];
        let temp = jobsWithFolio;

        if (dateRange?.from) {
            const from = startOfDay(dateRange.from);
            const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
            temp = temp.filter(job => job.createdAt && isWithinInterval(new Date(job.createdAt), { start: from, end: to }));
        }

        if (statusFilter === 'deleted') {
            temp = temp.filter(job => job.isDeleted === true);
        } else {
            temp = temp.filter(job => job.isDeleted !== true);
        }

        if (statusFilter === 'unpaid') {
            temp = temp.filter(job => !job.isPaid);
        } else if (statusFilter === 'undelivered') {
            temp = temp.filter(job => job.status !== 'Completado');
        } else if (statusFilter === 'warranty') {
            const now = new Date();
            temp = temp.filter(job => {
                if (job.status !== 'Completado' || !job.warrantyEndDate) return false;
                return isAfter(parseISO(job.warrantyEndDate), now);
            });
        }

        return temp;
    }, [jobsWithFolio, dateRange, statusFilter]);

    const handleOptimisticUpdate = (updatedJob: RepairJob) => {
        mutateRepairs((prev) => {
            if (!prev) return [updatedJob as any];
            const exists = prev.find(j => j.id === updatedJob.id);
            if (exists) {
                return prev.map(j => j.id === updatedJob.id ? (updatedJob as any) : j);
            }
            return [updatedJob as any, ...prev];
        });
    };

    return (
        <div className="flex-1 bg-slate-100/70 min-h-0">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-3 sm:p-6">
                {/* Encabezado ejecutivo integrado (sin doble barra superior) */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                            <Wrench className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Reparaciones
                            </h1>
                            <p className="text-xs text-slate-500">
                                Recepción técnica, seguimiento de órdenes y garantías
                            </p>
                        </div>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <ExportRepairsDialog repairs={repairJobs || []} />
                        <Button
                            size="sm"
                            className="h-10 flex-1 gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-emerald-500/25 transition-all hover:from-emerald-500 hover:to-teal-400 sm:h-9 sm:flex-none sm:px-4"
                            aria-label="Nueva reparación"
                            title="Nueva reparación"
                            onClick={() => {
                                if (drafts.repair) setRestoreDraftOpen(true);
                                else setCreateOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4" />
                            <span>Nueva Reparación</span>
                        </Button>
                    </div>
                </div>

                {/* Tarjetas KPI compactas (mismo estilo de Inventario, 0 lecturas extra) */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
                    <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[140px] sm:px-3",
                            statusFilter === 'all'
                                ? "border-blue-500 ring-2 ring-blue-500/15"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                statusFilter === 'all' ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                            )}>
                                <Layers className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Todas</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                            {statusCounts.all}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setStatusFilter('unpaid')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[140px] sm:px-3",
                            statusFilter === 'unpaid'
                                ? "border-rose-400 ring-2 ring-rose-400/20"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                statusFilter === 'unpaid' ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-600"
                            )}>
                                <DollarSign className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Por Cobrar</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-rose-600">
                            {statusCounts.unpaid}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setStatusFilter('undelivered')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[140px] sm:px-3",
                            statusFilter === 'undelivered'
                                ? "border-amber-400 ring-2 ring-amber-400/20"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                statusFilter === 'undelivered' ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-600"
                            )}>
                                <Clock className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Por Entregar</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-amber-600">
                            {statusCounts.undelivered}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setStatusFilter('warranty')}
                        className={cn(
                            "group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:min-w-[140px] sm:px-3",
                            statusFilter === 'warranty'
                                ? "border-emerald-400 ring-2 ring-emerald-400/20"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                statusFilter === 'warranty' ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600"
                            )}>
                                <ShieldCheck className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Garantía</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-emerald-700">
                            {statusCounts.warranty}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setStatusFilter('deleted')}
                        className={cn(
                            "col-span-2 group flex items-center justify-between gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all sm:col-span-1 sm:min-w-[140px] sm:px-3",
                            statusFilter === 'deleted'
                                ? "border-slate-400 ring-2 ring-slate-400/20"
                                : "border-slate-200/90 hover:border-slate-300"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                "hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex",
                                statusFilter === 'deleted' ? "bg-slate-600 text-white" : "bg-slate-100 text-slate-500"
                            )}>
                                <Trash2 className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-xs font-medium text-slate-600">Eliminados</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-slate-500">
                            {statusCounts.deleted}
                        </span>
                    </button>
                </div>

                <DataTable 
                    columns={columns} 
                    data={filteredRepairJobs || []}
                    isLoading={isLoading}
                    filterPlaceholder="Buscar cliente, equipo o folio..."
                    globalFilterFn={repairFilterFn}
                    onGlobalFilterChange={handleSearchChange}
                    isServerSearching={usePaged && serverSearchFlag && serverSearch.isSearching}
                    mobileCardRender={(job, table) => <MobileRepairCard job={job} table={table} />}
                    meta={{ 
                        mutate: mutateRepairs,
                        onEditRepair: (job: RepairJob) => {
                            setEditingJob(job);
                            setIsEditDialogOpen(true);
                        }
                    }}
                >
                    {(table) => (
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                             <Popover>
                                <PopoverTrigger asChild>
                                <Button variant="outline" className={cn("h-10 sm:h-9 flex-1 sm:w-[220px] justify-start rounded-xl border-slate-200 bg-white text-xs font-medium shadow-sm hover:bg-slate-50", !dateRange ? "text-slate-500" : "text-slate-800")}>
                                    <CalendarIcon className="mr-2 h-3.5 w-3.5 text-blue-600" />
                                    {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "dd/MM")} - ${format(dateRange.to, "dd/MM")}` : format(dateRange.from, "dd/MM")) : "Filtrar por fecha"}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 rounded-xl border-slate-200 bg-white shadow-xl" align="start">
                                    <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                                </PopoverContent>
                            </Popover>
                            {dateRange && (
                                <Button variant="outline" size="icon" className="h-10 w-10 sm:h-9 sm:w-9 shrink-0 rounded-xl border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 shadow-sm" onClick={() => setDateRange(undefined)} aria-label="Limpiar filtro de fecha">
                                    <ClearIcon className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    )}
                </DataTable>

                {usePaged && (
                    <div className="flex items-center justify-center gap-3 pt-1">
                        <span className="text-xs font-medium text-slate-500">
                            {repairJobs?.length || 0} reparaciones cargadas
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { void paged.loadMore(); }}
                            disabled={!paged.hasMore || paged.isLoadingMore}
                            className="h-8 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 gap-1.5 shadow-sm"
                        >
                            {paged.isLoadingMore
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                : <PlusCircle className="w-3.5 h-3.5 text-blue-600" />}
                            {paged.hasMore ? 'Cargar 100 más' : 'Historial completo'}
                        </Button>
                    </div>
                )}

                {editingJob && (
                    <RepairFormDialog 
                        repairJob={editingJob} 
                        isOpen={isEditDialogOpen} 
                        onOpenChange={(open) => {
                            setIsEditDialogOpen(open);
                            if (!open) setEditingJob(null);
                        }} 
                        onSaved={handleOptimisticUpdate} 
                        suggestedIssues={topReportedIssues}
                    />
                )}
                {drafts.repair && (
                    <RepairFormDialog
                        isOpen={restoreDraftOpen}
                        onOpenChange={(open) => handleRepairOpenChange(open, setRestoreDraftOpen)}
                        initialDraft={drafts.repair.values as any}
                        onMinimize={handleRepairMinimize}
                        suggestedIssues={topReportedIssues}
                        onSaved={(job) => {
                            handleOptimisticUpdate(job);
                            clearDraft('repair');
                            setRestoreDraftOpen(false);
                        }}
                    />
                )}

                <RepairFormDialog
                    isOpen={createOpen}
                    onOpenChange={(open) => handleRepairOpenChange(open, setCreateOpen)}
                    onSaved={handleOptimisticUpdate}
                    onMinimize={handleRepairMinimize}
                    suggestedIssues={topReportedIssues}
                />
            </main>
        </div>
    )
}
