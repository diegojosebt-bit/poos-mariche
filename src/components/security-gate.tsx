"use client";

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardStore } from '@/contexts/dashboard-context';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Lock, Loader2, Eye, EyeOff, Users, ArrowLeft, AlertTriangle } from 'lucide-react';
import type { UserModule } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { canOperatorAccessModule, hasCashierSystemActive } from '@/lib/cashiers';
import {
    clearLockoutState,
    readLockoutState,
    recordFailedAttempt,
    verifyPin,
} from '@/lib/security';

const GATE_PIN_LOCKOUT_KEY = 'mm_pin_lockout_gate';
const GATE_PIN_LOCKOUT_CONFIG = {
    maxAttempts: 3,
    durationsSeconds: [30, 120, 300],
};

type SecurityGateProps = {
    children: React.ReactNode;
    module: UserModule | 'settings' | 'admin';
};

export function SecurityGate({ children, module }: SecurityGateProps) {
    const { toast } = useToast();
    const router = useRouter();
    const {
        profile,
        activeOperator,
        setIsOperatorPromptOpen,
        isSecurityUnlocked,
        unlockSecurity,
    } = useDashboardStore();
    const isProfileLoading = !profile;
    const [pin, setPin] = useState("");
    const [showPin, setShowPin] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [lockoutSeconds, setLockoutSeconds] = useState(0);
    const [failedAttempts, setFailedAttempts] = useState(0);

    const cashierMode = hasCashierSystemActive(profile);

    useEffect(() => {
        const state = readLockoutState(GATE_PIN_LOCKOUT_KEY);
        setLockoutSeconds(state.remainingSeconds);
        setFailedAttempts(state.attempts);
    }, []);

    useEffect(() => {
        if (lockoutSeconds <= 0) return;
        const timer = window.setInterval(() => {
            const state = readLockoutState(GATE_PIN_LOCKOUT_KEY);
            setLockoutSeconds(state.remainingSeconds);
            if (state.remainingSeconds <= 0) {
                setFailedAttempts(0);
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [lockoutSeconds]);

    // EVALUACIÓN DE ACCESO EN TIEMPO REAL
    const isAuthorized = useMemo(() => {
        if (isProfileLoading || !profile) return null;

        // MODO CAJEROS ACTIVO: el acceso depende del operador seleccionado en esta caja
        if (cashierMode) {
            if (!activeOperator) return false;
            return canOperatorAccessModule(activeOperator, module);
        }

        // Compatibilidad legado: si no hay cajeros creados, respeta bloqueo anterior por PIN si estaba encendido
        if (profile.isPinRequired !== true) return true;
        if (!profile.securityPin) return true;
        if (isSecurityUnlocked) return true;

        const activeLockedModules = profile.lockedModules || [];
        if (module === 'admin' || module === 'settings' || activeLockedModules.includes(module as UserModule)) {
            return false;
        }

        return true;
    }, [profile, isProfileLoading, cashierMode, activeOperator, module, isSecurityUnlocked]);

    const isLockedOut = lockoutSeconds > 0;

    const handleUnlock = async () => {
        if (!profile?.securityPin || isVerifying) return;

        const currentLock = readLockoutState(GATE_PIN_LOCKOUT_KEY);
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
            const isValid = await verifyPin(pin, profile.securityPin, profile.uid || "mm_default");
            if (isValid) {
                clearLockoutState(GATE_PIN_LOCKOUT_KEY);
                setLockoutSeconds(0);
                setFailedAttempts(0);
                unlockSecurity();
                toast({ title: "Acceso concedido", description: "Modo administrador activado." });
                setPin("");
            } else {
                setPin("");
                const result = recordFailedAttempt(GATE_PIN_LOCKOUT_KEY, GATE_PIN_LOCKOUT_CONFIG);
                if (result.locked) {
                    setLockoutSeconds(result.lockoutSeconds);
                    setFailedAttempts(0);
                    toast({
                        variant: "destructive",
                        title: "Acceso bloqueado temporalmente",
                        description: `Demasiados intentos erróneos. Espera ${result.lockoutSeconds} segundos.`,
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

    if (isProfileLoading || isAuthorized === null) {
        return (
            <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center gap-3 bg-slate-100/70 p-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600/50" />
                <p className="text-xs font-medium text-slate-500">
                    Verificando acceso...
                </p>
            </div>
        );
    }

    if (isAuthorized) return <>{children}</>;

    // Vista de acceso restringido cuando un cajero intenta entrar a un módulo fuera de sus permisos
    if (cashierMode) {
        return (
            <div className="flex flex-1 items-center justify-center bg-slate-100/70 p-4">
                <div className="w-full max-w-[390px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl">
                    <div className="border-b border-slate-100 px-6 py-5 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200/80 bg-amber-50 text-amber-600 shadow-sm">
                            <Lock className="h-5 w-5" />
                        </div>
                        <h2 className="text-base font-semibold tracking-tight text-slate-900">
                            Sección restringida
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            El perfil activo (<span className="font-semibold text-slate-700">{activeOperator?.name || "Operador"}</span>) no tiene permiso para abrir este módulo.
                        </p>
                    </div>

                    <div className="space-y-2.5 p-5">
                        <Button
                            type="button"
                            onClick={() => setIsOperatorPromptOpen(true)}
                            className="h-10 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm hover:opacity-95"
                        >
                            <Users className="mr-2 h-4 w-4" />
                            Cambiar a gerente / cajero
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => router.replace('/dashboard/pos')}
                            className="h-10 w-full rounded-xl border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver al Punto de Venta
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-1 items-center justify-center bg-slate-100/70 p-4">
            <div className="w-full max-w-[380px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-200">
                <div className="border-b border-slate-100 px-6 py-5 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                        <Lock className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-semibold tracking-tight text-slate-900">
                        Zona protegida
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        Introduce el PIN de gerente para continuar.
                    </p>
                </div>

                <div className="space-y-4 p-6">
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
                                        Intentos: {failedAttempts} / {GATE_PIN_LOCKOUT_CONFIG.maxAttempts}
                                    </span>
                                </div>
                            )}
                            <div className="relative">
                                <Input
                                    type={showPin ? "text" : "password"}
                                    name="mm-gate-pin"
                                    autoComplete="new-password"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    spellCheck={false}
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    placeholder="••••"
                                    value={pin}
                                    onChange={(e) => setPin(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                                    className="h-12 rounded-xl border-slate-200 bg-slate-50/60 pr-10 text-center text-2xl font-semibold tracking-[0.35em] text-slate-900 focus:bg-white"
                                    maxLength={8}
                                    autoFocus
                                    disabled={isVerifying}
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
                        className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95"
                        onClick={handleUnlock}
                        disabled={isLockedOut || isVerifying || !pin.trim()}
                    >
                        {isLockedOut ? `Bloqueado (${lockoutSeconds}s)` : "Desbloquear acceso"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
