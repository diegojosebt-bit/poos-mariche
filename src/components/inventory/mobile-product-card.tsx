"use client";

import { useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { ChevronDown, Clock } from "lucide-react";

import type { Product } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrency } from "@/hooks/use-currency";
import { getAvailableStock, getStockLevel, formatCategoryName } from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";
import { ActionsCell } from "@/components/inventory/columns";

type MobileProductCardProps = {
  product: Product;
  table: any;
};

/**
 * Tarjeta de producto para móvil (<768px).
 *
 * Fila compacta con lo esencial (nombre · categoría, precio y disponible) y
 * detalle desplegable con costo, stock físico, reservado, dañado y código.
 * El escritorio sigue usando la tabla completa.
 */
export function MobileProductCard({ product, table }: MobileProductCardProps) {
  const { format, convert, getFinalPrice, getSymbol } = useCurrency();
  const [expanded, setExpanded] = useState(false);

  const meta = (table?.options?.meta ?? {}) as {
    allProducts?: Product[];
    showAging?: boolean;
  };

  const available = getAvailableStock(product, meta.allProducts ?? []);
  const level = getStockLevel(available, product.lowStockThreshold || 1);

  const unitLabel = product.unit && product.unit !== "unit" ? product.unit : "";
  const price = getFinalPrice(product);
  const priceBs = convert(price, "USD", "Bs");
  const cost = Number(product.costPrice) || 0;

  const physical = Number(product.stockLevel) || 0;
  const reserved = Number(product.reservedStock) || 0;
  const damaged = Number(product.damagedStock) || 0;

  const ageDays = product.createdAt ? differenceInDays(new Date(), parseISO(product.createdAt)) : null;
  const showAging = meta.showAging && ageDays !== null;

  const row = (table?.getRowModel?.().rows ?? []).find((r: any) => r.original?.id === product.id);
  const selected = row?.getIsSelected?.() ?? false;

  const stockStyles = {
    out: "border-rose-200/90 bg-rose-50 text-rose-700 font-semibold",
    low: "border-amber-200/90 bg-amber-50 text-amber-700 font-semibold",
    ok: "border-emerald-200/90 bg-emerald-50 text-emerald-700 font-semibold",
  } as const;

  const toggle = () => setExpanded((value) => !value);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs transition-colors",
        selected && "border-blue-400 bg-blue-50/30"
      )}
    >
      {/* Fila compacta */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${product.name}. ${available} disponibles. Toca para ver el detalle`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 p-3 transition-colors active:bg-slate-50"
      >
        <div className="-m-1 shrink-0 p-1" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            className="h-4 w-4 rounded-[4px] border-slate-300"
            checked={selected}
            onCheckedChange={(value: boolean) => row?.toggleSelected?.(!!value)}
            aria-label={`Seleccionar ${product.name}`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {product.name}
          </p>
          {product.category ? (
            <p className="truncate text-[11px] font-medium text-slate-500">{formatCategoryName(product.category)}</p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <span className="block text-xs font-semibold leading-none tabular-nums text-slate-900">
            {getSymbol("USD")}{format(price, "USD")}
          </span>
          <span className="mt-0.5 block text-[10px] font-medium leading-none tabular-nums text-emerald-700">
            Bs {format(priceBs, "Bs")}
          </span>
        </div>

        <span className={cn("inline-flex min-w-[30px] shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[11px] tabular-nums", stockStyles[level])}>
          {product.isCombo ? "—" : available}
        </span>

        <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
          <ActionsCell product={product} table={table} />
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
          <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2.5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Costo</dt>
                <dd className="font-medium tabular-nums text-slate-800">{getSymbol("USD")}{format(cost, "USD")}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Físico</dt>
                <dd className="font-medium tabular-nums text-slate-800">{physical}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Reservado</dt>
                <dd className="font-medium tabular-nums text-amber-700">{reserved}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Dañado</dt>
                <dd className="font-medium tabular-nums text-rose-600">{damaged}</dd>
              </div>

              {unitLabel ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Medida</dt>
                  <dd className="font-medium uppercase text-slate-800">{unitLabel}</dd>
                </div>
              ) : null}

              {product.barcode ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">Código</dt>
                  <dd className="min-w-0 truncate font-mono text-[11px] text-slate-700">{product.barcode}</dd>
                </div>
              ) : null}

              {showAging && (
                <div className="col-span-2 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-1.5">
                  <dt className="text-slate-500">Antigüedad</dt>
                  <dd
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      ageDays! > 30
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : ageDays! > 15
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-white text-slate-600"
                    )}
                  >
                    <Clock className="h-3 w-3" />
                    {ageDays === 0 ? "Hoy" : `${ageDays} días`}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </article>
  );
}
