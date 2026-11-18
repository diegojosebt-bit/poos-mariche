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
import { canOperatorPerform, hasCashierSystemActive } from "@/lib/cashiers";
import {
  clearLockoutState,
  readLockoutState,
  recordFailedAttempt,
  verifyPin,
} from "@/lib/security";
import { Lock, ShieldAlert, Eye, EyeOff, AlertTriangle } from "lucide-react";

const ADMIN_PIN_LOCKOUT_KEY = "mm_pin_lockout_admin_action";
const ADMIN_PIN_LOCKOUT_CONFIG = {
  maxAttempts: 3,
  durationsSeconds: [30, 120, 300],
};

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
    desc: "Ingresa el PIN de Administrador para modificar precios y stock del inventario."
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
  const [isVerifying, setIsVerifying] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const { toast } = useToast();
  const router = useRouter();
  
  // Consumimos el perfil y operador activo del Store Global
  const { profile, activeOperator } = useDashboardStore();
  const cashierMode = hasCashierSystemActive(profile);

  // Solo se exige PIN para editar si:
  // - En modo cajeros: el operador es un cajero SIN permiso `canEditProducts`
  // - En modo legado (sin cajeros): el dueño activó `requirePinForProductEdit` y tiene PIN
  const editNeedsPin = cashierMode
    ? Boolean(
        actionType === 'editProducts' &&
        activeOperator &&
        !activeOperator.isOwner &&
        !canOperatorPerform(activeOperator, 'canEditProducts')
      )
    : actionType === 'editProducts' &&
      profile?.requirePinForProductEdit === true &&
      !!profile?.securityPin;

  // Comprobación de seguridad: ¿Esta acción requiere PIN de gerente?
  const isProtected = () => {
    if (!profile) return false;

    // MODO CAJEROS ACTIVO: el dueño ya inició con su rol; el cajero necesita PIN de gerente solo si no tiene el permiso
    if (cashierMode) {
      if (!activeOperator || activeOperator.isOwner) return false;
      if (actionType === 'editProducts') {
        return !canOperatorPerform(activeOperator, 'canEditProducts');
      }
      if (actionType.startsWith('delete') || actionType === 'general') {
        return !canOperatorPerform(activeOperator, 'canDeleteRecords');
      }
      return false;
    }

    // Compatibilidad legado (negocios sin cajeros aún)
    if (actionType === 'editProducts') return editNeedsPin;
    if (!profile.securityPin) return false;
    if (profile.isPinRequired === true) return true;
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

  // Sincronización y temporizador de bloqueo persistente anti-fuerza bruta
  useEffect(() => {
    if (!open) return;
    const state = readLockoutState(ADMIN_PIN_LOCKOUT_KEY);
    setRemainingSeconds(state.remainingSeconds);
    setFailedAttempts(state.attempts);
  }, [open]);

  useEffect(() => {
    if (remainingSeconds <= 0) return;
    const interval = window.setInterval(() => {
      const state = readLockoutState(ADMIN_PIN_LOCKOUT_KEY);
      setRemainingSeconds(state.remainingSeconds);
      if (state.remainingSeconds <= 0) {
        setFailedAttempts(0);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [remainingSeconds]);

  // Editar un producto NO es una acción destructiva: si no se exigió PIN,
  // solo se advierte. Si se exigió PIN (y existe), cae en el diálogo de abajo.
  if (actionType === 'editProducts' && !editNeedsPin) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[400px] sm:p-0">
          <div className="px-5 py-5 pr-11">
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <DialogTitle className="text-base font-semibold text-slate-900">
                  Edición de producto
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs leading-relaxed text-slate-500">
                Vas a modificar precios, stock o datos del producto. Los cambios se guardan al confirmar y quedan
                registrados con tu usuario.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-9 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-4 text-xs font-semibold text-white shadow-sm hover:opacity-95"
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

  const handleAuth = async () => {
    if (isVerifying) return;

    const currentLock = readLockoutState(ADMIN_PIN_LOCKOUT_KEY);
    if (currentLock.remainingSeconds > 0) {
      setRemainingSeconds(currentLock.remainingSeconds);
      toast({
        variant: "destructive",
        title: "Sistema bloqueado temporalmente",
        description: `Espera ${currentLock.remainingSeconds} segundos antes de volver a intentar.`,
      });
      return;
    }

    if (!profile?.securityPin) {
      toast({
        variant: "destructive",
        title: "PIN no configurado",
        description: "Aún no has configurado tu PIN de Administrador. Ve a Configuración para definirlo.",
      });
      return;
    }

    setIsVerifying(true);
    try {
      const isValid = await verifyPin(password, profile.securityPin, profile.uid || "mm_default");
      if (isValid) {
        clearLockoutState(ADMIN_PIN_LOCKOUT_KEY);
        setOpen(false);
        setPassword("");
        setFailedAttempts(0);
        setRemainingSeconds(0);
        onAuthorized();
      } else {
        setPassword("");
        const result = recordFailedAttempt(ADMIN_PIN_LOCKOUT_KEY, ADMIN_PIN_LOCKOUT_CONFIG);
        if (result.locked) {
          setRemainingSeconds(result.lockoutSeconds);
          setFailedAttempts(0);
          toast({
            variant: "destructive",
            title: `Bloqueo temporal (${result.lockoutSeconds}s)`,
            description: `Demasiados intentos erróneos. Espera ${result.lockoutSeconds} segundos antes de volver a intentar.`,
          });
        } else {
          setFailedAttempts(result.attempts);
          toast({
            variant: "destructive",
            title: "PIN incorrecto",
            description: `Te quedan ${result.remainingAttempts} intento(s) antes del bloqueo temporal.`,
          });
        }
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleAuth();
    }
  };

  const isDestructive = actionType.startsWith('delete');

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (!v) setPassword("");
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[400px] sm:p-0">
        <div className="border-b border-slate-100 bg-white px-5 py-4 pr-11">
          <DialogHeader className="space-y-1.5 text-left">
            <div className="flex items-center gap-3">
              <div className={isDestructive
                ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600"
                : "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600"
              }>
                <ShieldAlert className="h-4 w-4" />
              </div>
              <DialogTitle className="text-base font-semibold text-slate-900">
                {title || currentInfo.title}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs leading-relaxed text-slate-500">
              {description || currentInfo.desc}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-5 py-4">
          {isLockedOut ? (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-rose-700">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold">Bloqueo de seguridad activo</p>
                <p className="text-xs text-rose-600">
                  Reintenta en <strong className="font-semibold tabular-nums">{remainingSeconds}s</strong>
                </p>
              </div>
            </div>
          ) : !profile?.securityPin ? (
            <div className="space-y-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-amber-900">
              <p className="text-xs font-semibold">PIN de administrador no configurado</p>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Aún no has configurado tu PIN de seguridad. Ve a <strong>Configuración &gt; Bloqueo de Datos</strong> para crear tu clave antes de autorizar acciones protegidas.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-50"
                onClick={() => { setOpen(false); router.push('/dashboard/settings'); }}
              >
                Ir a Configuración
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="admin-security-pin" className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Lock className="h-3.5 w-3.5 text-slate-400" /> PIN de administrador
                </Label>
                {failedAttempts > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">
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
                  className="h-12 rounded-xl border-slate-200 bg-slate-50/60 pr-10 text-center text-xl font-semibold tracking-[0.3em] text-slate-900 focus:bg-white"
                  placeholder="••••"
                  autoFocus
                  disabled={isLockedOut || isVerifying}
                  maxLength={8}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg p-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-center text-[11px] text-slate-400">
                Acción protegida contra borrado accidental o no autorizado.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            className="h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleAuth}
            disabled={isLockedOut || isVerifying || !profile?.securityPin || !password.trim()}
            className={isDestructive
              ? "h-9 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
              : "h-9 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-4 text-xs font-semibold text-white shadow-sm hover:opacity-95"
            }
          >
            {isLockedOut
              ? `Bloqueado (${remainingSeconds}s)`
              : isDestructive
                ? 'Autorizar eliminación'
                : 'Autorizar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
