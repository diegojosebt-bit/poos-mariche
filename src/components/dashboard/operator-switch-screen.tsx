"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { useFirebase } from "@/firebase";
import { signOut } from "firebase/auth";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import {
  OWNER_OPERATOR_ID,
  buildCashierOperator,
  buildOwnerOperator,
  canOperatorAccessModule,
  getActiveCashiers,
  getEffectivePlanLimits,
  hasCashierSystemActive,
} from "@/lib/cashiers";
import { getFreshSessions, getOrCreateDeviceId } from "@/lib/device-session";
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
  const { auth, firestore, user } = useFirebase();
  const { toast } = useToast();
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();

  const cashierSystemEnabled = hasCashierSystemActive(profile);
  const activeCashiers = useMemo(() => getActiveCashiers(profile), [profile]);
  const isMandatory = cashierSystemEnabled && !activeOperator;
  const isVisible = isMandatory || (cashierSystemEnabled && isOperatorPromptOpen);

  const currentDeviceId = getOrCreateDeviceId();
  const limits = useMemo(() => getEffectivePlanLimits(profile), [profile]);
  const freshSessions = useMemo(
    () => getFreshSessions(profile?.activeSessions),
    [profile?.activeSessions],
  );

  const activeCashierMap = useMemo(() => {
    const map = new Map<string, { deviceId: string; deviceName: string }>();
    for (const s of Object.values(freshSessions)) {
      if (s.cashierId && s.mode !== 'supervisor') {
        map.set(s.cashierId, {
          deviceId: s.deviceId,
          deviceName: s.deviceName || 'Otra caja',
        });
      }
    }
    return map;
  }, [freshSessions]);

  const otherActiveRegisters = useMemo(() => {
    return Object.values(freshSessions).filter(
      (s) => s.deviceId !== currentDeviceId && s.mode !== 'supervisor',
    );
  }, [freshSessions, currentDeviceId]);

  const isRegisterLimitReached = otherActiveRegisters.length >= limits.maxRegisters;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      if (firestore && user && currentDeviceId && currentDeviceId !== 'server') {
        try {
          await updateDoc(doc(firestore, 'users', user.uid), {
            [`activeSessions.${currentDeviceId}`]: deleteField(),
          });
        } catch {}
      }
      localStorage.removeItem('mm_session_id');
      localStorage.removeItem('mm_active_operator_id');
      sessionStorage.removeItem('mm_active_operator_id');
      sessionStorage.removeItem('mm_security_unlocked');
      sessionStorage.removeItem('mm_device_id');
      if (auth) await signOut(auth);
    } finally {
      window.location.href = '/';
    }
  };

  useEffect(() => {
    if (!isVisible) {
      setSelectedId(null);
      setPin("");
      setShowPin(false);
      return;
    }
    // En móvil, cerrar el drawer del menú lateral si estaba abierto para no bloquear toques
    setOpenMobile(false);
    const state = readLockoutState(OPERATOR_PIN_LOCKOUT_KEY);
    setLockoutSeconds(state.remainingSeconds);
    setFailedAttempts(state.attempts);
  }, [isVisible, setOpenMobile]);

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
  const ownerName = profile.accountName?.trim() || "Administrador";
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
      description: operator.isOwner ? "Acceso completo de administrador." : "Permisos de cajero aplicados.",
    });
  };

  const handleSelectProfile = (id: string) => {
    // Si no es el dueño y se alcanzó el límite de cajas simultáneas
    // y este cajero no tiene ya un turno abierto en otra caja que vaya a transferir:
    if (id !== OWNER_OPERATOR_ID && isRegisterLimitReached && !activeCashierMap.has(id)) {
      toast({
        variant: "destructive",
        title: "Límite de cajas alcanzado",
        description: `Ya hay ${otherActiveRegisters.length} de ${limits.maxRegisters} cajas cobrando simultáneamente. El administrador debe entrar para liberar un equipo o ampliar el plan.`,
      });
      return;
    }

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Seleccionar operador de caja"
      className="pointer-events-auto fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-900/45 p-4 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="my-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl">
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
              {isRegisterLimitReached && (
                <div className="mb-2 flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold text-amber-900">
                      Límite de cajas cobrando ({otherActiveRegisters.length}/{limits.maxRegisters})
                    </p>
                    <p className="text-[11px] text-amber-700/90 leading-relaxed">
                      Todos los cupos de cobro están en uso. Entra como Administrador para supervisar o liberar una caja inactiva.
                    </p>
                  </div>
                </div>
              )}

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
                      {isRegisterLimitReached && !activeOperator?.isOwner && (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          Modo Supervisor
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Administrador · Acceso completo {!hasOwnerPin && "(sin PIN)"}
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>

              {/* Lista de Cajeros Activos */}
              <div className="max-h-[280px] space-y-2 overflow-y-auto pt-1">
                {activeCashiers.map((cashier) => {
                  const isCurrent = activeOperator?.id === cashier.id;
                  const activeOnOther = activeCashierMap.get(cashier.id);
                  const isBlockedByLimit = isRegisterLimitReached && !activeOnOther;
                  return (
                    <button
                      key={cashier.id}
                      type="button"
                      onClick={() => handleSelectProfile(cashier.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all",
                        isCurrent
                          ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200/70"
                          : isBlockedByLimit
                            ? "border-slate-200/60 bg-slate-50/40 opacity-70 hover:bg-slate-100/60"
                            : "border-slate-200/80 bg-white hover:border-blue-200 hover:bg-slate-50/70"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-xs">
                          {cashier.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-slate-900">
                              {cashier.name}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                Actual
                              </span>
                            )}
                            {activeOnOther && !isCurrent && (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                En turno: {activeOnOther.deviceName}
                              </span>
                            )}
                            {isBlockedByLimit && (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                Sin cupo
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Cajero · {cashier.permissions.modules.length} módulos
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-slate-100 pt-3 mt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="h-9 w-full rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  {isSigningOut ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  {isSigningOut ? "Cerrando sesión..." : "Cerrar sesión / Salir al inicio"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedCashier && activeCashierMap.has(selectedCashier.id) && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-[11px] leading-tight">
                    Este cajero está activo en <strong>{activeCashierMap.get(selectedCashier.id)?.deviceName}</strong>. Al entrar aquí, la otra caja se cerrará de inmediato.
                  </p>
                </div>
              )}
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
                      {isOwnerSelected ? "Ingresa tu PIN de administrador" : "Ingresa tu PIN de cajero"}
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
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95"
                >
                  {isLockedOut ? `Bloqueado (${lockoutSeconds}s)` : "Iniciar turno"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="h-8 w-full rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  Salir al inicio de sesión
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
