"use client";

import { useState, type ReactNode } from "react";
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

type HoldSaleDialogProps = {
  children: ReactNode;
  onHoldSale: (name: string) => void;
  disabled?: boolean;
};

export function HoldSaleDialog({ children, onHoldSale, disabled }: HoldSaleDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const handleConfirm = () => {
    if (name.trim()) {
      onHoldSale(name);
      setOpen(false);
      setName("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild disabled={disabled}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md bg-white border-slate-200 text-slate-900 shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-slate-900 font-bold">Aparcar Venta</DialogTitle>
          <DialogDescription className="text-slate-500 text-xs">
            Dale un nombre a esta venta para identificarla más tarde.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label htmlFor="sale-name" className="text-xs font-bold text-slate-700">Nombre de la Venta</Label>
          <Input
            id="sale-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Cliente camisa azul"
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 shadow-2xs"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" onClick={handleConfirm} disabled={!name.trim()} className="bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold shadow-md shadow-blue-500/25">
            Aparcar Venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
