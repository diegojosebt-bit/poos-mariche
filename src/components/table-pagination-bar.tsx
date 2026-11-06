"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TablePaginationBarProps = {
  page: number;
  totalPages: number;
  totalItems?: number;
  rangeStart?: number;
  rangeEnd?: number;
  itemLabel?: string;
  info?: ReactNode;
  actions?: ReactNode;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  className?: string;
};

export function TablePaginationBar({
  page,
  totalPages,
  totalItems,
  rangeStart,
  rangeEnd,
  itemLabel = "registros",
  info,
  actions,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  className,
}: TablePaginationBarProps) {
  const pages = Math.max(1, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      {/* Fila 1 en móvil: una sola línea compacta */}
      <div className="min-w-0 text-[9px] font-black uppercase leading-tight text-muted-foreground sm:text-[10px]">
        <span className="block truncate whitespace-nowrap sm:hidden">
          Pág. {page}/{pages} · {totalItems ?? rangeEnd ?? 0} {itemLabel}
        </span>

        <span className="hidden flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex">
          <span className="whitespace-nowrap">Página {page} de {pages} ({totalItems ?? 0} total)</span>
          {typeof rangeStart === "number" && typeof rangeEnd === "number" && (
            <>
              <span className="text-muted-foreground/30">•</span>
              <span className="whitespace-nowrap">
                Mostrando {rangeStart}–{rangeEnd} de {totalItems ?? rangeEnd} {itemLabel}
              </span>
            </>
          )}
          {info && (
            <>
              <span className="text-muted-foreground/30">•</span>
              <span className="whitespace-nowrap">{info}</span>
            </>
          )}
        </span>
      </div>

      {/* Fila 2 en móvil: controles */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:justify-end">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onPrevious}
            disabled={!canPrevious}
            aria-label="Página anterior"
            className="h-7 px-2 text-[9px] font-black uppercase sm:h-8 sm:px-2.5 sm:text-[10px]"
          >
            <ChevronLeft className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Anterior</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onNext}
            disabled={!canNext}
            aria-label="Página siguiente"
            className="h-7 px-2 text-[9px] font-black uppercase sm:h-8 sm:px-2.5 sm:text-[10px]"
          >
            <span className="hidden sm:inline">Siguiente</span>
            <ChevronRight className="h-3.5 w-3.5 sm:ml-1" />
          </Button>
        </div>

        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
