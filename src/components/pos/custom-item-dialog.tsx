"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeftRight, Plus } from "lucide-react";
import { useCurrency } from "@/hooks/use-currency";

type CustomItemDialogProps = {
  onAddCustomItem: (name: string, price: number, costPrice: number) => void;
};

type CurrencyMode = "USD" | "Bs";

export function CustomItemDialog({ onAddCustomItem }: CustomItemDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [costPrice, setCostPrice] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [costCurrency, setCostCurrency] = useState<CurrencyMode>("USD");
  const [priceCurrency, setPriceCurrency] = useState<CurrencyMode>("Bs");

  const { format, convert, bcvRate, parallelRate } = useCurrency();

  const costNum = parseFloat(costPrice) || 0;
  const priceNum = parseFloat(price);

  // Costo: si viene en Bs se protege a tasa paralelo.
  // Venta: si viene en Bs se factura a BCV.
  const costUsd = costCurrency === "Bs"
    ? convert(costNum, "Bs", "USD", true)
    : costNum;

  const priceUsd = !isNaN(priceNum)
    ? (priceCurrency === "Bs" ? convert(priceNum, "Bs", "USD") : priceNum)
    : 0;

  const profit = priceUsd - costUsd;
  const margin = priceUsd > 0 ? (profit / priceUsd) * 100 : 0;
  const hasPrice = !isNaN(priceNum) && priceUsd > 0;

  const costEquivalent = costNum > 0
    ? costCurrency === "Bs"
      ? `≈ $${format(costUsd)}`
      : `≈ Bs ${format(convert(costNum, "USD", "Bs", true))}`
    : "";

  const priceEquivalent = hasPrice
    ? priceCurrency === "Bs"
      ? `≈ $${format(priceUsd)}`
      : `≈ Bs ${format(convert(priceNum, "USD", "Bs"))}`
    : "";

  const toggleCostCurrency = () => {
    const value = parseFloat(costPrice);
    if (!isNaN(value) && value > 0) {
      const next = costCurrency === "USD"
        ? convert(value, "USD", "Bs", true)
        : convert(value, "Bs", "USD", true);
      setCostPrice(next.toFixed(2));
    }
    setCostCurrency((current) => (current === "USD" ? "Bs" : "USD"));
  };

  const togglePriceCurrency = () => {
    const value = parseFloat(price);
    if (!isNaN(value) && value > 0) {
      const next = priceCurrency === "Bs"
        ? convert(value, "Bs", "USD")
        : convert(value, "USD", "Bs");
      // 6 decimales al pasar a USD para no perder Bs al volver.
      setPrice(next.toFixed(priceCurrency === "Bs" ? 6 : 2));
    }
    setPriceCurrency((current) => (current === "Bs" ? "USD" : "Bs"));
  };

  const handleAdd = () => {
    if (!name.trim() || !hasPrice) return;

    onAddCustomItem(
      name.trim().toUpperCase(),
      Number(priceUsd.toFixed(6)),
      Number(costUsd.toFixed(2)),
    );

    setName("");
    setCostPrice("");
    setPrice("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Añadir Artículo Manual">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="uppercase font-bold">Venta Rápida</DialogTitle>
          <DialogDescription className="text-xs">
            Toca el título de cada campo para cambiar entre $ y Bs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <Label htmlFor="custom-name" className="text-[10px] font-bold uppercase">
              Nombre
            </Label>
            <Input
              id="custom-name"
              name="mm-custom-name"
              autoComplete="off"
              spellCheck={false}
              placeholder="EJ: CABLE GENÉRICO, LIMPIEZA..."
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              className="uppercase h-10"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <button
                type="button"
                onClick={toggleCostCurrency}
                aria-label="Cambiar moneda del costo"
                className="flex w-full items-center gap-1 text-[10px] font-bold uppercase text-foreground hover:text-primary"
              >
                Costo ({costCurrency === "Bs" ? "Bs" : "$"})
                <ArrowLeftRight className="w-3 h-3 opacity-50" />
              </button>
              <Input
                id="custom-cost"
                name="mm-custom-cost"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoComplete="off"
                placeholder="0.00"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="h-10 font-mono"
              />
              {costEquivalent && (
                <p className="text-[10px] text-muted-foreground text-right">{costEquivalent}</p>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={togglePriceCurrency}
                aria-label="Cambiar moneda de la venta"
                className="flex w-full items-center gap-1 text-[10px] font-bold uppercase text-foreground hover:text-primary"
              >
                Venta ({priceCurrency === "Bs" ? "Bs" : "$"})
                <ArrowLeftRight className="w-3 h-3 opacity-50" />
              </button>
              <Input
                id="custom-price"
                name="mm-custom-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoComplete="off"
                placeholder={priceCurrency === "Bs" ? "0,00" : "0.00"}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="h-10 font-mono"
              />
              {priceEquivalent && (
                <p className="text-[10px] font-bold text-primary text-right">{priceEquivalent}</p>
              )}
            </div>
          </div>

          {hasPrice && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-[11px]">
              <span className="font-bold uppercase text-muted-foreground">Utilidad</span>
              <span className={`font-mono font-black ${profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                ${format(profit)}
                <span className="ml-1 text-[10px] font-bold opacity-70">
                  ({format(margin)}%)
                </span>
              </span>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            Costo en Bs: paralelo Bs {format(parallelRate)} · Venta en Bs: BCV Bs {format(bcvRate)}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="uppercase font-bold">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim() || !hasPrice}
            className="uppercase font-bold"
          >
            Añadir al Carrito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
