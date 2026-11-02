"use client";

import { useState, useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PlusCircle, CalendarIcon, X as ClearIcon, Clock, DollarSign, LayoutGrid, ShieldCheck } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FilterFn } from "@tanstack/react-table";
import { SecurityGate } from "@/components/security-gate";

const repairFilterFn: FilterFn<RepairJob> = (row, columnId, value) => {
    const term = String(value).toLowerCase();
    const r = row.original;
    return (
        (r.customerName || "").toLowerCase().includes(term) ||
        (r.customerPhone || "").toLowerCase().includes(term) ||
        (r.customerID || "").toLowerCase().includes(term) ||
        (r.deviceMake || "").toLowerCase().includes(term) ||
        (r.deviceModel || "").toLowerCase().includes(term) ||
        (r.reportedIssue || "").toLowerCase().includes(term) ||
        (r.id || "").toLowerCase().includes(term)
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
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    // ACOTE DE SEGURIDAD (Blindaje de Costos): Limitamos a 100 registros recientes.
    const repairJobsQuery = useMemoFirebase(() =>
        (firestore && user) 
            ? query(collection(firestore, 'users', user.uid, 'repair_jobs'), orderBy('createdAt', 'desc'), limit(100)) 
            : null,
        [firestore, user?.uid]
    );
    const { data: repairJobs, isLoading, mutate: mutateRepairs } = useCollection<RepairJob>(repairJobsQuery);

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
                    meta={{ mutate: mutateRepairs }}
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
            </main>
        </>
    )
}
