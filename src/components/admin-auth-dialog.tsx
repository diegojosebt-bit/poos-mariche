"use client";

import { useState, type ReactNode, useEffect } from "react";
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
import { Lock, ShieldAlert, Eye, EyeOff, AlertTriangle } from "lucide-react";

import { useRouter } from "next/navigation";

export type AdminActionType = 
  | 'deleteSales'
  | 'deleteRepairs'
  | 'deleteProducts'
  | 'deleteFiados'
  | 'deleteExpenses'
  | 'editProducts'
  | 'general';

type AdminAuthDialogProps = {
  children: ReactNode;
  onAuthorized: () => void;
  actionType?: AdminActionType;
  title?: string;
  description?: string;
};

const ACTION_DESCRIPTIONS: Record<AdminActionType, { title: string; desc: string }> = {
  deleteSales: {
    title: "Anulación / Reembolso de Venta",
    desc: "Ingresa el PIN de Administrador para autorizar el reembolso y ajuste de caja/stock."
  },
  deleteRepairs: {
    title: "Eliminación de Reparación",
    desc: "Ingresa el PIN de Administrador para eliminar permanentemente esta orden de servicio."
  },
  deleteProducts: {
    title: "Eliminación de Producto",
    desc: "Ingresa el PIN de Administrador para retirar este producto del catálogo e inventario."
  },
  deleteFiados: {
    title: "Eliminación de Cuenta Fiada",
    desc: "Ingresa el PIN de Administrador para cancelar o eliminar la deuda de este cliente."
  },
  deleteExpenses: {
    title: "Eliminación de Gasto",
    desc: "Ingresa el PIN de Administrador para anular este egreso de caja."
  },
  editProducts: {
    title: "Edición de Producto",
    desc: "Vas a modificar precios o stock del inventario. Confirma para continuar."
  },
  general: {
    title: "Validación de Administrador",
    desc: "Ingresa el PIN de Administrador para autorizar esta acción sensible."
  }
};

export function AdminAuthDialog({ children, onAuthorized, actionType = 'general', title, description }: AdminAuthDialogProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const { toast } = useToast();
  const router = useRouter();
  
  // Consumimos el perfil del Store Global
  const { profile } = useDashboardStore();

  // Comprobación de seguridad: ¿Esta acción requiere PIN?
  const isProtected = () => {
    if (!profile) return false;
    // Sin PIN configurado no hay nada que validar: se permite con advertencia.
    if (!profile.securityPin) return false;
    // Si la seguridad global por PIN está activa
    if (profile.isPinRequired === true) return true;
    // Si el bloqueo específico de datos está activo
    if (profile.isDataDeletionLocked === true) {
      if (actionType === 'general') return true;
      if (profile.protectedDataActions) {
        const isGranularProtected = (profile.protectedDataActions as any)[actionType];
        return isGranularProtected !== false;
      }
      return true;
    }
    return false;
  };

  // Manejo de temporizador de bloqueo anti-fuerza bruta
  useEffect(() => {
    if (!lockoutUntil) {
      setRemainingSeconds(0);
      return;
    }

    const updateTimer = () => {
      const diff = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (diff <= 0) {
        setLockoutUntil(null);
        setRemainingSeconds(0);
        setFailedAttempts(0);
      } else {
        setRemainingSeconds(diff);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  // Editar un producto NO es una acción destructiva: solo se advierte.
  // (Antes se pedía el PIN de eliminación y, sin PIN configurado, era un callejón sin salida.)
  if (actionType === 'editProducts') {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="uppercase font-black flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              Edición de Producto
            </DialogTitle>
            <DialogDescription className="font-medium text-xs text-muted-foreground pt-1">
              Vas a modificar precios, stock o datos del producto. Los cambios se guardan al confirmar y quedan
              registrados con tu usuario.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="font-bold"
              onClick={() => {
                setOpen(false);
                onAuthorized();
              }}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Si no está protegido, pasa directamente sin modal
  if (!isProtected()) {
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

  const isLockedOut = remainingSeconds > 0;
  const currentInfo = ACTION_DESCRIPTIONS[actionType] || ACTION_DESCRIPTIONS.general;

  const handleAuth = () => {
    if (isLockedOut) {
      toast({
        variant: "destructive",
        title: "Sistema Bloqueado Temporalmente",
        description: `Espera ${remainingSeconds} segundos antes de volver a intentar.`
      });
      return;
    }

    if (!profile?.securityPin) {
      toast({
        variant: "destructive",
        title: "PIN No Configurado",
        description: "Aún no has configurado tu PIN de Administrador. Ve a Configuración para definirlo.",
      });
      return;
    }

    if (password === profile.securityPin) {
      setOpen(false);
      setPassword("");
      setFailedAttempts(0);
      onAuthorized();
    } else {
      const nextFailed = failedAttempts + 1;
      setFailedAttempts(nextFailed);
      setPassword("");

      if (nextFailed >= 3) {
        const lockoutTime = Date.now() + 30000; // 30 segundos de penalización
        setLockoutUntil(lockoutTime);
        setRemainingSeconds(30);
        toast({
          variant: "destructive",
          title: "¡Alerta de Seguridad: Bloqueo de 30s!",
          description: "Demasiados intentos erróneos. El diálogo ha sido bloqueado por 30 segundos.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "PIN Incorrecto",
          description: `Te quedan ${3 - nextFailed} intento(s) antes del bloqueo temporal.`,
        });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleAuth();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!isLockedOut) {
        setOpen(v);
        if (!v) setPassword("");
      }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md border-destructive/20 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="uppercase font-black text-destructive flex items-center gap-2 text-base">
            <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
            {title || currentInfo.title}
          </DialogTitle>
          <DialogDescription className="font-medium text-xs text-muted-foreground pt-1">
            {description || currentInfo.desc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {isLockedOut ? (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 shrink-0 animate-bounce" />
              <div>
                <p className="font-bold text-xs uppercase">Bloqueo de Seguridad Activo</p>
                <p className="text-xs">
                  Reintenta en <strong className="font-black text-sm">{remainingSeconds}s</strong>
                </p>
              </div>
            </div>
          ) : !profile?.securityPin ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs space-y-2">
              <p className="font-bold">⚠️ PIN de Administrador no configurado</p>
              <p className="text-[11px] text-amber-800">
                Aún no has configurado tu PIN de seguridad. Ve a <strong>Configuración &gt; Bloqueo de Datos</strong> para crear tu clave de Administrador antes de autorizar eliminaciones.
              </p>
              <Button 
                type="button" 
                size="sm" 
                variant="outline" 
                className="h-8 text-xs border-amber-300 text-amber-900 font-bold"
                onClick={() => { setOpen(false); router.push('/dashboard/settings'); }}
              >
                Ir a Configuración
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="admin-security-pin" className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1.5">
                  <Lock className="w-3 h-3" /> PIN de Administrador
                </Label>
                {failedAttempts > 0 && (
                  <span className="text-[10px] font-bold text-destructive">
                    Intentos: {failedAttempts} / 3
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="admin-security-pin"
                  name="mm-admin-pin"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="text-center text-2xl font-black h-12 tracking-widest pr-10"
                  placeholder="••••"
                  autoFocus
                  disabled={isLockedOut}
                  maxLength={8}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Acción protegida contra borrado accidental o no autorizado.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => setOpen(false)}
            disabled={isLockedOut}
          >
            Cancelar
          </Button>
          <Button 
            type="submit" 
            onClick={handleAuth} 
            disabled={isLockedOut || !profile?.securityPin || !password.trim()}
            className="font-bold bg-destructive hover:bg-destructive/90 text-white shadow-md"
          >
            {actionType.startsWith('delete') ? 'Autorizar Eliminación' : 'Autorizar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
