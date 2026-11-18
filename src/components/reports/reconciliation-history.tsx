
"use client";

import type { DailyReconciliation, PaymentMethod } from "@/lib/types";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useCurrency } from "@/hooks/use-currency";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Printer, CalendarIcon, X as ClearIcon, ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import { handlePrintReconciliation } from "./reconciliation-ticket";
import { TablePaginationBar } from "../table-pagination-bar";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { SmoothCollapse } from "../ui/smooth-collapse";

type ReconciliationHistoryProps = {
  reconciliations: DailyReconciliation[];
  isLoading?: boolean;
};

const ITEMS_PER_PAGE = 20;
const paymentMethodsOrder: PaymentMethod[] = ['Efectivo USD', 'Efectivo Bs', 'Tarjeta', 'Pago Móvil', 'Transferencia'];

export function ReconciliationHistory({ reconciliations, isLoading }: ReconciliationHistoryProps) {
  const currency = useCurrency();
  const { format: formatCurrency } = currency;
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { profile } = useDashboardStore();

  const onPrint = (reconciliation: DailyReconciliation) => {
    handlePrintReconciliation({ 
        reconciliation, 
        currency,
        businessName: profile?.businessName
    }, (error) => {
      toast({
        variant: "destructive",
        title: "Error de Impresión",
        description: error,
      });
    });
  };

  const filteredReconciliations = useMemo(() => {
    if (!reconciliations) return [];
    
    let filtered = reconciliations;

    if (dateRange?.from) {
        const start = startOfDay(dateRange.from);
        const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
        
        filtered = filtered.filter(recon => {
            const reconDate = parseISO(recon.closedAt);
            return isWithinInterval(reconDate, { start, end });
        });
    }

    return [...filtered].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
  }, [reconciliations, dateRange]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange]);

  const totalPages = Math.ceil(filteredReconciliations.length / ITEMS_PER_PAGE);
  const paginatedReconciliations = useMemo(() => {
      const start = (currentPage - 1) * ITEMS_PER_PAGE;
      return filteredReconciliations.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredReconciliations, currentPage]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-3">
        <Skeleton className="h-6 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
     <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Historial de cierres de caja</h2>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                  {filteredReconciliations.length}
                </span>
              </div>
              <p className="text-xs text-slate-500">Consulta el detalle y reimprime el comprobante de cada cierre.</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
              <Popover>
                  <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("h-10 sm:h-9 w-full sm:w-[215px] justify-start text-left text-xs font-medium rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm", !dateRange && "text-slate-500")}>
                          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-blue-600 shrink-0" />
                          {dateRange?.from ? (
                              dateRange.to ? (
                                  `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}`
                              ) : format(dateRange.from, "dd/MM/yy")
                          ) : "Filtrar fecha"}
                      </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 rounded-xl border-slate-200 bg-white shadow-xl" align="end">
                      <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                  </PopoverContent>
              </Popover>
              {dateRange && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDateRange(undefined)}
                  className="h-9 w-9 shrink-0 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Limpiar filtro de fecha"
                >
                  <ClearIcon className="h-4 w-4" />
                </Button>
              )}
          </div>
        </div>

        <div className="p-3.5 sm:p-5">
            {paginatedReconciliations.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                    <p className="text-xs text-slate-400">Sin cierres registrados en este periodo.</p>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {paginatedReconciliations.map(recon => {
                        const isOpen = expandedId === recon.id;
                        const diffIsNeg = recon.totalDifference < -0.01;
                        const diffIsPos = recon.totalDifference > 0.01;

                        return (
                            <div key={recon.id} className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs transition-colors">
                                <button
                                    type="button"
                                    aria-expanded={isOpen}
                                    onClick={() => setExpandedId(isOpen ? null : recon.id)}
                                    className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-slate-50/70 transition-colors cursor-pointer"
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <p className="text-xs font-semibold text-slate-900 tabular-nums">
                                                {format(parseISO(recon.closedAt), "dd/MM/yy · HH:mm", { locale: es })}
                                            </p>
                                            {recon.cashierName && (
                                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                                    {recon.cashierName}
                                                </span>
                                            )}
                                        </div>
                                        {recon.notes && (
                                            <p className="mt-0.5 truncate text-[11px] text-slate-500">{recon.notes}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2.5 shrink-0">
                                        <span className={cn(
                                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                                            diffIsNeg
                                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                                : diffIsPos
                                                    ? "border-blue-200 bg-blue-50 text-blue-700"
                                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        )}>
                                            {recon.totalDifference >= 0 ? '+' : ''}${formatCurrency(recon.totalDifference, 'USD')}
                                        </span>
                                        <span className="text-xs sm:text-sm font-semibold tabular-nums text-slate-900">
                                            ${formatCurrency(recon.totalSales)}
                                        </span>
                                        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")} />
                                    </div>
                                </button>

                                <SmoothCollapse open={isOpen} collapseMargin={false}>
                                    <div className="border-t border-slate-100 bg-slate-50/60 p-3.5 space-y-3">
                                        <div className="flex justify-end">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => onPrint(recon)}
                                                className="h-8 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 w-full sm:w-auto"
                                            >
                                                <Printer className="mr-1.5 h-3.5 w-3.5 text-blue-600" /> Imprimir ticket
                                            </Button>
                                        </div>
                                        <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden">
                                            <Table>
                                                <TableHeader className="bg-slate-50/80">
                                                    <TableRow className="border-slate-100 hover:bg-transparent">
                                                        <TableHead className="h-8 text-[11px] font-medium text-slate-500">Método</TableHead>
                                                        <TableHead className="h-8 text-right text-[11px] font-medium text-slate-500">Esperado</TableHead>
                                                        <TableHead className="h-8 text-right text-[11px] font-medium text-slate-500">Contado</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {paymentMethodsOrder.map(method => {
                                                        if (!recon.paymentMethods || !recon.paymentMethods[method]) return null;
                                                        const details = recon.paymentMethods[method]!;
                                                        const symbol = (method === 'Efectivo USD' || method === 'USDT / Crypto') ? '$' : 'Bs';
                                                        return (
                                                            <TableRow key={method} className="border-slate-100">
                                                                <TableCell className="py-2 text-xs font-medium text-slate-800">{method}</TableCell>
                                                                <TableCell className="py-2 text-right text-xs tabular-nums text-slate-500">{symbol}{formatCurrency(details.expected)}</TableCell>
                                                                <TableCell className="py-2 text-right text-xs font-semibold tabular-nums text-slate-900">{symbol}{formatCurrency(details.counted)}</TableCell>
                                                            </TableRow>
                                                        )
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>
                                </SmoothCollapse>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>

        {totalPages > 1 && (
            <TablePaginationBar
                page={currentPage}
                totalPages={totalPages}
                totalItems={filteredReconciliations.length}
                rangeStart={filteredReconciliations.length === 0 ? 0 : ((currentPage - 1) * ITEMS_PER_PAGE) + 1}
                rangeEnd={Math.min(currentPage * ITEMS_PER_PAGE, filteredReconciliations.length)}
                itemLabel="cierres"
                onPrevious={() => setCurrentPage(p => Math.max(1, p - 1))}
                onNext={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                canPrevious={currentPage > 1}
                canNext={currentPage < totalPages}
            />
        )}
     </div>
  );
}
