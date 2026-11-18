
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/use-currency";
import { Info, Loader2 } from "lucide-react";
import { Skeleton } from "../ui/skeleton";

export function PriceCalculatorDialog({ children }: { children: React.ReactNode }) {
  const [cost, setCost] = useState<number | string>("");
  const { getDynamicPrice, convert, format, getSymbol, isLoading, profitMargin } = useCurrency();

  const costValue = typeof cost === 'string' ? parseFloat(cost) : cost;
  const retailPrice = costValue > 0 ? getDynamicPrice(costValue) : 0;
  const retailPriceBs = costValue > 0 ? convert(retailPrice, 'USD', 'Bs') : 0;
  const suggestedPromoPrice = costValue > 0 ? costValue * (1 + profitMargin / 100) : 0;

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md bg-white border-slate-200 text-slate-900 shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-slate-900 font-bold">Calculadora de Precios</DialogTitle>
          <DialogDescription className="text-slate-500 text-xs">
            Costo en dólares → precio de venta con tus tasas y margen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            {isLoading ? <Skeleton className="h-24 w-full bg-slate-100" /> : (
            <>
                <div>
                    <Label htmlFor="cost-price" className="text-xs font-bold text-slate-700">Costo del Producto en $</Label>
                    <Input
                      id="cost-price"
                      type="number"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      placeholder="0.00"
                      className="mt-1.5 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 shadow-2xs"
                    />
                </div>
                <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 text-sm space-y-3 shadow-2xs">
                    <div className="flex items-center gap-2 mb-2">
                        <Info className="w-4 h-4 text-blue-600"/>
                        <p className="font-bold text-slate-900 text-xs uppercase tracking-wide">Precios de Venta Calculados</p>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-slate-500 text-xs font-medium">Precio de Venta (USD):</span>
                        <span className="font-black text-lg text-slate-950">{getSymbol('USD')}{format(retailPrice, 'USD')}</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-slate-500 text-xs font-medium">Precio de Venta (Bs):</span>
                        <span className="font-black text-lg text-emerald-600">{getSymbol('Bs')}{format(retailPriceBs, 'Bs')}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-200 pt-3 mt-3">
                        <span className="text-slate-500 text-xs font-medium">Precio Oferta Sugerido (USD):</span>
                        <span className="font-black text-blue-600 text-lg">{getSymbol('USD')}{format(suggestedPromoPrice, 'USD')}</span>
                    </div>
                </div>
            </>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

