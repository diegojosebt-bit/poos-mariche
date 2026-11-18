"use client";

import { useState } from "react";
import { Check, ChevronDown, Clock, PackageCheck } from "lucide-react";

import type { RepairJob, RepairStatus } from "@/lib/types";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { ActionsCell, ServiceTimer, StatusCell } from "@/components/repairs/columns";

type MobileRepairCardProps = {
  job: RepairJob;
  table: any;
};

/**
 * Tarjeta de reparación para móvil.
 *
 * Fila compacta (cliente, equipo, total y estado de 2 pasos) y detalle desplegable
 * con el flujo interactivo Cobro → Entrega, desglose de dinero y duración.
 */
export function MobileRepairCard({ job, table }: MobileRepairCardProps) {
  const { format, getSymbol } = useCurrency();
  const [expanded, setExpanded] = useState(false);

  const estimated = parseFloat(String(job.estimatedCost || 0)) || 0;
  const paid = parseFloat(String(job.amountPaid || 0)) || 0;
  const debt = Math.max(0, estimated - paid);
  const isUpToDate = job.isPaid || debt <= 0.009;
  const isDelivered = job.status === "Completado";
  const isDeleted = job.isDeleted === true;

  const toggle = () => setExpanded((value) => !value);

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-colors">
      {/* Fila compacta */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${job.customerName}. ${isDelivered ? "Entregado" : isUpToDate ? "Pagado, listo para entregar" : "Pendiente de cobro"}. Toca para ver el detalle`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 p-3 transition-colors active:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{job.customerName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-normal text-slate-500">
            <span className="truncate">{[job.deviceMake, job.deviceModel].filter(Boolean).join(" ") || "Sin equipo"}</span>
            <span className="shrink-0 font-mono text-[10px] text-slate-400">{job.id}</span>
            {isDeleted ? (
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-[10px] font-medium text-slate-400 line-through">
                Eliminada
              </span>
            ) : isDelivered ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/90 bg-white px-2 py-px text-[10px] font-medium text-slate-700 shadow-2xs">
                <Check className="h-2.5 w-2.5 text-emerald-600" strokeWidth={2.5} />
                Entregado
              </span>
            ) : isUpToDate ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-200/90 bg-white px-2 py-px text-[10px] font-medium text-slate-700 shadow-2xs">
                <PackageCheck className="h-2.5 w-2.5 text-blue-600" />
                Por entregar
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/90 bg-white px-2 py-px text-[10px] font-medium text-slate-700 shadow-2xs">
                <Clock className="h-2.5 w-2.5 text-amber-500" />
                Pendiente
              </span>
            )}
          </p>
        </div>

        <span className="shrink-0 text-xs font-semibold leading-none tabular-nums text-slate-900">
          {getSymbol()}{format(estimated)}
        </span>

        <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
          {!isDeleted && <ActionsCell repairJob={job} table={table} />}
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
            expanded && "rotate-180"
          )}
          aria-hidden
        />
      </div>

      {/* Detalle desplegable */}
      <div
        aria-hidden={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-2.5 border-t border-slate-100 bg-slate-50/70 px-3 py-2.5">
            {isDeleted ? (
              <div className="space-y-0.5">
                <span className="text-[11px] font-medium text-rose-600">Motivo de eliminación</span>
                <p className="text-xs leading-snug text-slate-700">{job.deletionReason || "Sin motivo registrado"}</p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">Estado</span>
                <StatusCell repairJob={job} table={table} />
              </div>
            )}

            <dl className="grid grid-cols-3 gap-2 border-t border-slate-200/70 pt-2 text-xs">
              <div>
                <dt className="text-[11px] text-slate-500">Total</dt>
                <dd className="font-medium tabular-nums text-slate-900">{getSymbol()}{format(estimated)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Pagado</dt>
                <dd className="font-medium tabular-nums text-emerald-700">{getSymbol()}{format(paid)}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[11px] text-slate-500">Saldo</dt>
                <dd className={cn("font-medium tabular-nums", isUpToDate ? "text-emerald-700" : "text-rose-600")}>
                  {isUpToDate ? "Al día" : `${getSymbol()}${format(debt)}`}
                </dd>
              </div>
            </dl>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 pt-2">
              <span className="font-mono text-[10px] text-slate-400">{job.id}</span>
              <ServiceTimer createdAt={job.createdAt} completedAt={job.completedAt} status={job.status as RepairStatus} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
