"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { Lock, Loader2 } from "lucide-react";

const FALLBACK_PIN = "2026";

type AdminAuthDialogProps = {
  children: ReactNode;
  onAuthorized: () => void;
};

export function AdminAuthDialog({ children, onAuthorized }: AdminAuthDialogProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const { toast } = useToast();
  
  // BLINDAJE DE COSTOS: Consumimos el perfil del Store Global (0 lecturas)
  const { profile } = useDashboardStore();

  // REGLA DE ORO: Si la seguridad está apagada, saltamos el PIN directamente.
  if (profile && (profile.isPinRequired !== true || !profile.securityPin)) {
      return (
          <div 
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAuthorized();
            }}
            className="contents cursor-pointer"
          >
              {children}
          </div>
      );
  }

  const handleAuth = () => {
    const requiredPin = profile?.securityPin || FALLBACK_PIN;

    if (password === requiredPin) {
      setOpen(false);
      onAuthorized();
    } else {
      toast({
        variant: "destructive",
        title: "PIN Incorrecto",
        description: "Operación no autorizada.",
      });
    }
    setPassword("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleAuth();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase font-black text-primary flex items-center gap-2">
            <Lock className="w-5 h-5" /> Validación de Gerente
          </DialogTitle>
          <DialogDescription className="font-bold">
            Confirma tu PIN para realizar esta acción.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="admin-password" className="text-[10px] font-black uppercase text-muted-foreground">PIN de Seguridad</Label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-center text-2xl font-black h-12"
              placeholder="••••"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" onClick={handleAuth} className="font-bold">Autorizar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
