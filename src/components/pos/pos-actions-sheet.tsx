"use client";

import { useState } from "react";
import { Calculator, MoreHorizontal, Plus } from "lucide-react";

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

/**
 * Acciones secundarias del punto de venta.
 *
 * La cabecera móvil no puede sostener tres botones sin comerse el título,
 * así que sólo queda "Ventas en espera" (lo más usado) y este menú.
 */
export function POSActionsSheet({
  onAddCustomItem,
}: {
  onAddCustomItem: (name: string, price: number, costPrice: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-slate-200/90 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-2xs" aria-label="Más acciones">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="top" className="rounded-b-2xl pb-4 bg-white border-slate-200 text-slate-900 shadow-xl">
        <SheetHeader>
          <SheetTitle className="text-sm font-black uppercase tracking-wide text-slate-900">Acciones rápidas</SheetTitle>
          <SheetDescription className="text-xs text-slate-500">Herramientas de mostrador.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
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
                <Plus className="h-4 w-4 text-blue-600" />
                Venta rápida (artículo manual)
              </Button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
