"use client";

import { useState } from "react";
import { Calculator, FolderClock, MoreHorizontal, Plus } from "lucide-react";

import type { HeldSale } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PriceCalculatorDialog } from "@/components/tools/price-calculator-dialog";
import { CustomItemDialog } from "@/components/pos/custom-item-dialog";
import { HeldSalesSheet } from "@/components/pos/held-sales-sheet";

/**
 * Acciones secundarias del punto de venta en móvil.
 *
 * Agrupa Ventas en espera, Calculadora y Venta rápida en un solo botón
 * para que la barra superior móvil no se apriete ni recorte elementos.
 */
export function POSActionsSheet({
  heldSales,
  onAddCustomItem,
}: {
  heldSales: HeldSale[];
  onAddCustomItem: (name: string, price: number, costPrice: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative h-8 w-8 rounded-full border-slate-200/90 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-2xs"
          aria-label={heldSales.length > 0 ? `Más acciones (${heldSales.length} en espera)` : "Más acciones"}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
          {heldSales.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold tabular-nums text-white ring-2 ring-white">
              {heldSales.length}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="top" className="rounded-b-2xl pb-4 bg-white border-slate-200 text-slate-900 shadow-xl">
        <SheetHeader>
          <SheetTitle className="text-sm font-black uppercase tracking-wide text-slate-900">Acciones rápidas</SheetTitle>
          <SheetDescription className="text-xs text-slate-500">Herramientas de mostrador.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          <HeldSalesSheet
            heldSales={heldSales}
            onSaleRestored={() => setOpen(false)}
            trigger={
              <Button variant="outline" className="h-12 w-full justify-between gap-3 text-sm font-semibold border-slate-200 bg-white text-slate-800 hover:text-slate-900 hover:bg-slate-50 shadow-2xs">
                <span className="flex items-center gap-3">
                  <FolderClock className="h-4 w-4 text-blue-600" />
                  Ventas en espera
                </span>
                <span className={heldSales.length > 0 ? "flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold tabular-nums text-white" : "text-xs font-medium text-slate-400 tabular-nums"}>
                  {heldSales.length}
                </span>
              </Button>
            }
          />

          <PriceCalculatorDialog>
            <Button variant="outline" className="h-12 w-full justify-start gap-3 text-sm font-semibold border-slate-200 bg-white text-slate-800 hover:text-slate-900 hover:bg-slate-50 shadow-2xs">
              <Calculator className="h-4 w-4 text-blue-600" />
              Calculadora de precios
            </Button>
          </PriceCalculatorDialog>

          <CustomItemDialog
            onAddCustomItem={onAddCustomItem}
            trigger={
              <Button variant="outline" className="h-12 w-full justify-start gap-3 text-sm font-semibold border-slate-200 bg-white text-slate-800 hover:text-slate-900 hover:bg-slate-50 shadow-2xs">
                <Plus className="h-4 w-4 text-emerald-600" />
                Venta rápida (artículo manual)
              </Button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
