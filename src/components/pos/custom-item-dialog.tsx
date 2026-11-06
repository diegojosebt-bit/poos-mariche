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
import { Plus } from "lucide-react";
import { useCurrency } from "@/hooks/use-currency";

type CustomItemDialogProps = {
  onAddCustomItem: (name: string, price: number, costPrice: number) => void;
};

export function CustomItemDialog({ onAddCustomItem }: CustomItemDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [costPrice, setCostPrice] = useState<string>("");
  const [priceBs, setPriceBs] = useState<string>("");

  const { format, bcvRate } = useCurrency();

  const costUsd = parseFloat(costPrice) || 0;
  const priceBsNum = parseFloat(priceBs);
  const priceUsd = !isNaN(priceBsNum) && bcvRate > 0 ? priceBsNum / bcvRate : 0;
  const profit = priceUsd - costUsd;
  const margin = priceUsd > 0 ? (profit / priceUsd) * 100 : 0;
  const hasPrice = !isNaN(priceBsNum) && priceUsd > 0;

  const handleAdd = () => {
    if (!name.trim() || !hasPrice) return;

    onAddCustomItem(
      name.trim().toUpperCase(),
      // Se guarda con precisión para que al volver a Bs no se pierdan céntimos.
      Number(priceUsd.toFixed(6)),
      Number(costUsd.toFixed(2)),
    );

    setName("");
    setCostPrice("");
    setPriceBs("");
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
            Costo en dólares y precio en bolívares. Se convierte a USD con la tasa BCV.
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
              <Label htmlFor="custom-cost" className="text-[10px] font-bold uppercase">
                Costo ($)
              </Label>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-price" className="text-[10px] font-bold uppercase">
                Venta (Bs)
              </Label>
              <Input
                id="custom-price"
                name="mm-custom-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoComplete="off"
                placeholder="0,00"
                value={priceBs}
                onChange={(e) => setPriceBs(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="h-10 font-mono"
              />
              {hasPrice && (
                <p className="text-[10px] font-bold text-primary text-right">
                  ≈ ${format(priceUsd)}
                </p>
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
            Tasa BCV: Bs {format(bcvRate)} por USD
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
