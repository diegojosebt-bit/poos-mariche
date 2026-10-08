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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aparcar Venta</DialogTitle>
          <DialogDescription>
            Dale un nombre a esta venta para identificarla más tarde.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label htmlFor="sale-name">Nombre de la Venta</Label>
          <Input
            id="sale-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Cliente camisa azul"
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" onClick={handleConfirm} disabled={!name.trim()}>
            Aparcar Venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
