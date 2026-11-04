"use client";

import { useState, useMemo, useCallback } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PlusCircle, CalendarIcon, X as ClearIcon, Clock, DollarSign, LayoutGrid, ShieldCheck, Loader2 } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { columns } from "@/components/repairs/columns";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, query, orderBy, limit } from "firebase/firestore";
import type { RepairJob } from "@/lib/types";
import { format, isWithinInterval, startOfDay, endOfDay, isAfter, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { RepairFormDialog } from "@/components/repairs/repair-form-dialog";
import { ExportRepairsDialog } from "@/components/repairs/export-repairs-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FilterFn } from "@tanstack/react-table";
import { SecurityGate } from "@/components/security-gate";
import { useDashboardStore } from "@/contexts/dashboard-context";
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

type StatusFilter = 'all' | 'unpaid' | 'undelivered' | 'warranty';

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

    const [editingJob, setEditingJob] = useState<RepairJob | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const filteredRepairJobs = useMemo(() => {
        if (!repairJobs) return [];
        let temp = repairJobs;

        if (dateRange?.from) {
            const from = startOfDay(dateRange.from);
            const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
            temp = temp.filter(job => job.createdAt && isWithinInterval(new Date(job.createdAt), { start: from, end: to }));
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
    }, [repairJobs, dateRange, statusFilter]);

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
        <>
            <PageHeader title="Reparaciones">
                <RepairFormDialog onSaved={handleOptimisticUpdate}>
                    <Button size="sm" className="sm:h-10 px-2 sm:px-4"><PlusCircle className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Registrar</span> Reparación</Button>
                </RepairFormDialog>
            </PageHeader>
            <main className="flex-1 p-2 sm:p-6 space-y-4 max-w-7xl mx-auto w-full">
                <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1 bg-muted/50">
                        <TabsTrigger value="all" className="text-[10px] sm:text-sm py-2">Todas</TabsTrigger>
                        <TabsTrigger value="unpaid" className="text-[10px] sm:text-sm py-2 text-destructive font-bold">Por Cobrar</TabsTrigger>
                        <TabsTrigger value="undelivered" className="text-[10px] sm:text-sm py-2 text-amber-600 font-bold">Por Entregar</TabsTrigger>
                        <TabsTrigger value="warranty" className="text-[10px] sm:text-sm py-2 text-blue-600 font-bold">Garantía</TabsTrigger>
                    </TabsList>
                </Tabs>

                <DataTable 
                    columns={columns} 
                    data={filteredRepairJobs || []}
                    isLoading={isLoading}
                    filterPlaceholder="Buscar cliente o equipo..."
                    globalFilterFn={repairFilterFn}
                    onGlobalFilterChange={handleSearchChange}
                    isServerSearching={usePaged && serverSearchFlag && serverSearch.isSearching}
                    searchAddon={<ExportRepairsDialog repairs={repairJobs || []} />}
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
                                <Button variant="outline" className={cn("flex-1 sm:w-[240px] justify-start text-xs", !dateRange && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                    {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "dd/MM")} - ${format(dateRange.to, "dd/MM")}` : format(dateRange.from, "dd/MM")) : "Filtrar fecha"}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                                </PopoverContent>
                            </Popover>
                            {dateRange && <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setDateRange(undefined)}><ClearIcon className="h-4 w-4" /></Button>}
                        </div>
                    )}
                </DataTable>

                {usePaged && (
                    <div className="flex items-center justify-center gap-3 pt-1">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">
                            {repairJobs?.length || 0} reparaciones cargadas
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { void paged.loadMore(); }}
                            disabled={!paged.hasMore || paged.isLoadingMore}
                            className="h-8 text-xs font-semibold gap-1.5"
                        >
                            {paged.isLoadingMore
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <PlusCircle className="w-3.5 h-3.5" />}
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
                    />
                )}
            </main>
        </>
    )
}
