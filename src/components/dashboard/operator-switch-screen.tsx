"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Crown,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { useToast } from "@/hooks/use-toast";
import {
  CASHIER_ROLE_PRESETS,
  OWNER_OPERATOR_ID,
  buildCashierOperator,
  buildOwnerOperator,
  canOperatorAccessModule,
  getActiveCashiers,
  hasCashierSystemActive,
} from "@/lib/cashiers";
import {
  clearLockoutState,
  readLockoutState,
  recordFailedAttempt,
  verifyPin,
} from "@/lib/security";
import type { ActiveOperator, CashierProfile, UserModule } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPERATOR_PIN_LOCKOUT_KEY = "mm_pin_lockout_operator";
const OPERATOR_PIN_LOCKOUT_CONFIG = {
  maxAttempts: 3,
  durationsSeconds: [30, 120, 300],
};

const ROUTE_TO_MODULE: { prefix: string; module: UserModule | 'settings' | 'admin' }[] = [
  { prefix: '/dashboard/pos', module: 'pos' },
  { prefix: '/dashboard/inventory', module: 'inventory' },
  { prefix: '/dashboard/repairs', module: 'repairs' },
  { prefix: '/dashboard/expenses', module: 'expenses' },
  { prefix: '/dashboard/fiados', module: 'fiados' },
  { prefix: '/dashboard/reports', module: 'reports' },
  { prefix: '/dashboard/analysis', module: 'analysis' },
  { prefix: '/dashboard/settings', module: 'settings' },
  { prefix: '/dashboard/admin', module: 'admin' },
];

export function OperatorSwitchScreen() {
  const {
    profile,
    activeOperator,
    selectOperator,
    isOperatorPromptOpen,
    setIsOperatorPromptOpen,
    registerName,
  } = useDashboardStore();
  const { toast } = useToast();
  const pathname = usePathname();
  const router = useRouter();

  const cashierSystemEnabled = hasCashierSystemActive(profile);
  const activeCashiers = useMemo(() => getActiveCashiers(profile), [profile]);
  const isMandatory = cashierSystemEnabled && !activeOperator;
  const isVisible = isMandatory || (cashierSystemEnabled && isOperatorPromptOpen);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setSelectedId(null);
      setPin("");
      setShowPin(false);
      return;
    }
    const state = readLockoutState(OPERATOR_PIN_LOCKOUT_KEY);
    setLockoutSeconds(state.remainingSeconds);
    setFailedAttempts(state.attempts);
  }, [isVisible]);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setInterval(() => {
      const state = readLockoutState(OPERATOR_PIN_LOCKOUT_KEY);
      setLockoutSeconds(state.remainingSeconds);
      if (state.remainingSeconds <= 0) {
        setFailedAttempts(0);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  if (!isVisible || !profile) return null;

  const isLockedOut = lockoutSeconds > 0;
  const ownerName = profile.accountName?.trim() || "Dueño / Gerente";
  const hasOwnerPin = Boolean(profile.securityPin && profile.securityPin.trim().length > 0);
  const selectedCashier: CashierProfile | undefined = activeCashiers.find((c) => c.id === selectedId);
  const isOwnerSelected = selectedId === OWNER_OPERATOR_ID;

  const finishSwitch = (operator: ActiveOperator) => {
    clearLockoutState(OPERATOR_PIN_LOCKOUT_KEY);
    setLockoutSeconds(0);
    setFailedAttempts(0);
    selectOperator(operator);
    setSelectedId(null);
    setPin("");

    // Si el nuevo operador no tiene acceso a la pantalla actual, llevarlo a su primer módulo permitido
    const currentMatch = ROUTE_TO_MODULE.find((r) => pathname.startsWith(r.prefix));
    if (currentMatch && !canOperatorAccessModule(operator, currentMatch.module)) {
      const enabled = profile.enabledModules || ['pos'];
      const allowed = operator.isOwner
        ? enabled
        : operator.permissions.modules.filter((m) => enabled.includes(m));
      const targetModule = allowed.includes('pos') ? 'pos' : allowed[0] || 'pos';
      router.replace(`/dashboard/${targetModule}`);
    }

    toast({
      title: `Turno activo: ${operator.name}`,
      description: operator.isOwner ? "Acceso completo de gerente." : "Permisos de operador aplicados.",
    });
  };

  const handleSelectProfile = (id: string) => {
    setSelectedId(id);
    setPin("");
    setShowPin(false);

    // Si es el dueño y aún no ha configurado su PIN de gerente, entra directo sin trabarse
    if (id === OWNER_OPERATOR_ID && !hasOwnerPin) {
      finishSwitch(buildOwnerOperator(profile));
    }
  };

  const handleFailedPinAttempt = (label: string) => {
    setPin("");
    const result = recordFailedAttempt(OPERATOR_PIN_LOCKOUT_KEY, OPERATOR_PIN_LOCKOUT_CONFIG);
    if (result.locked) {
      setLockoutSeconds(result.lockoutSeconds);
      setFailedAttempts(0);
      toast({
        variant: "destructive",
        title: "Acceso bloqueado temporalmente",
        description: `Demasiados intentos erróneos. Espera ${result.lockoutSeconds} segundos para volver a intentar.`,
      });
    } else {
      setFailedAttempts(result.attempts);
      toast({
        variant: "destructive",
        title: "PIN incorrecto",
        description: `${label} Te quedan ${result.remainingAttempts} intento(s) antes del bloqueo temporal.`,
      });
    }
  };

  const handleVerifyPin = async () => {
    if (!selectedId || isVerifying) return;

    const currentLock = readLockoutState(OPERATOR_PIN_LOCKOUT_KEY);
    if (currentLock.remainingSeconds > 0) {
      setLockoutSeconds(currentLock.remainingSeconds);
      toast({
        variant: "destructive",
        title: "Acceso bloqueado temporalmente",
        description: `Espera ${currentLock.remainingSeconds} segundos antes de volver a intentar.`,
      });
      return;
    }

    setIsVerifying(true);
    try {
      const pinSalt = profile.uid || "mm_default";

      if (isOwnerSelected) {
        const isValid = !hasOwnerPin || (await verifyPin(pin, profile.securityPin, pinSalt));
        if (isValid) {
          finishSwitch(buildOwnerOperator(profile));
        } else {
          handleFailedPinAttempt("Verifica tu PIN de gerente.");
        }
        return;
      }

      if (selectedCashier) {
        const isValid = await verifyPin(pin, selectedCashier.pin, pinSalt);
        if (isValid) {
          finishSwitch(buildCashierOperator(selectedCashier));
        } else {
          handleFailedPinAttempt(`El PIN no coincide para ${selectedCashier.name}.`);
        }
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl">
        {/* Header puro blanco */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                ¿Quién atiende esta caja?
              </h2>
              <p className="truncate text-xs text-slate-500">
                {profile.businessName || "Mi negocio"} · {registerName}
              </p>
            </div>
          </div>

          {!isMandatory && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsOperatorPromptOpen(false)}
              className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Selección de operador o ingreso de PIN */}
        <div className="p-5">
          {!selectedId ? (
            <div className="space-y-2.5">
              {/* Tarjeta del Dueño / Gerente */}
              <button
                type="button"
                onClick={() => handleSelectProfile(OWNER_OPERATOR_ID)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all",
                  activeOperator?.isOwner
                    ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-200/70"
                    : "border-slate-200/80 bg-white hover:border-blue-200 hover:bg-slate-50/70"
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
                    <Crown className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {ownerName}
                      </span>
                      {activeOperator?.isOwner && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          Actual
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Gerente · Acceso completo {!hasOwnerPin && "(sin PIN)"}
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>

              {/* Lista de Cajeros Activos */}
              <div className="max-h-[280px] space-y-2 overflow-y-auto pt-1">
                {activeCashiers.map((cashier) => {
                  const isCurrent = activeOperator?.id === cashier.id;
                  const roleInfo = CASHIER_ROLE_PRESETS[cashier.role] || CASHIER_ROLE_PRESETS.cashier;
                  return (
                    <button
                      key={cashier.id}
                      type="button"
                      onClick={() => handleSelectProfile(cashier.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all",
                        isCurrent
                          ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200/70"
                          : "border-slate-200/80 bg-white hover:border-blue-200 hover:bg-slate-50/70"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-xs">
                          {cashier.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900">
                              {cashier.name}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                Actual
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {roleInfo.label} · {cashier.permissions.modules.length} módulos
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      isOwnerSelected
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700"
                    )}
                  >
                    {isOwnerSelected ? (
                      <ShieldCheck className="h-4 w-4" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">
                      {isOwnerSelected ? ownerName : selectedCashier?.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {isOwnerSelected ? "Ingresa tu PIN de gerente" : "Ingresa tu PIN de operador"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setPin("");
                  }}
                  className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Cambiar
                </button>
              </div>

              <div className="space-y-3">
                {isLockedOut ? (
                  <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-rose-700">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold">Bloqueo de seguridad activo</p>
                      <p className="text-xs text-rose-600">
                        Reintenta en <strong className="font-semibold tabular-nums">{lockoutSeconds}s</strong>
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {failedAttempts > 0 && (
                      <div className="flex justify-end">
                        <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-600">
                          Intentos: {failedAttempts} / {OPERATOR_PIN_LOCKOUT_CONFIG.maxAttempts}
                        </span>
                      </div>
                    )}
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type={showPin ? "text" : "password"}
                        name="mm-operator-pin"
                        autoComplete="new-password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="none"
                        placeholder="••••"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleVerifyPin();
                          }
                        }}
                        maxLength={8}
                        autoFocus
                        disabled={isVerifying}
                        className="h-12 rounded-xl border-slate-200 bg-slate-50/60 px-10 text-center text-2xl font-semibold tracking-[0.35em] text-slate-900 focus:bg-white"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPin((v) => !v)}
                        className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg p-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label={showPin ? "Ocultar PIN" : "Mostrar PIN"}
                      >
                        {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </>
                )}

                <Button
                  type="button"
                  onClick={handleVerifyPin}
                  disabled={isLockedOut || isVerifying || !pin.trim()}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95"
                >
                  {isLockedOut ? `Bloqueado (${lockoutSeconds}s)` : "Iniciar turno"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
