
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Calculadora de Precios</DialogTitle>
          <DialogDescription>
            Calcula el precio de venta final de un producto basándote en su costo en dólares y la configuración actual de tasas y margen de ganancia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            {isLoading ? <Skeleton className="h-24 w-full" /> : (
            <>
                <div>
                    <Label htmlFor="cost-price">Costo del Producto en $</Label>
                    <Input
                    id="cost-price"
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="0.00"
                    className="mt-1"
                    />
                </div>
                <div className="p-4 rounded-md bg-muted/50 text-sm space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                        <Info className="w-4 h-4 text-muted-foreground"/>
                        <p className="font-semibold">Precios de Venta Calculados</p>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Precio de Venta (USD):</span>
                        <span className="font-bold text-lg">{getSymbol('USD')}{format(retailPrice, 'USD')}</span>
                    </div>
                     <div className="flex justify-between">
                        <span className="text-muted-foreground">Precio de Venta (Bs):</span>
                        <span className="font-bold text-lg">{getSymbol('Bs')}{format(retailPriceBs, 'Bs')}</span>
                    </div>
                    <div className="flex justify-between border-t pt-3 mt-3">
                        <span className="text-muted-foreground">Precio Oferta Sugerido (USD):</span>
                        <span className="font-bold text-green-600 text-lg">{getSymbol('USD')}{format(suggestedPromoPrice, 'USD')}</span>
                    </div>
                </div>
            </>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

