"use client";

import type { ActiveOperator, ActiveRegisterSession, UserProfile, AppSettings } from '@/lib/types';
import { SidebarNav } from '@/components/sidebar-nav';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { useFirebase } from '@/firebase';
import { doc, onSnapshot, getDocFromServer, updateDoc, deleteField } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock, Lock, LogOut, MessageCircle, RefreshCw, Loader2, MonitorSmartphone, Users } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { isAfter, parseISO, differenceInMinutes, differenceInHours, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { GlobalAnnouncement } from '@/components/dashboard/global-announcement';
import { OperatorSwitchScreen } from '@/components/dashboard/operator-switch-screen';
import { AppLogo } from '@/components/icons';
import { SecurityUnlockedPill } from '@/components/security/security-unlocked-pill';
import { RepairDraftPill } from '@/components/repairs/repair-draft-pill';
import { OfflineSyncPill } from '@/components/offline/offline-sync-pill';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { DashboardProvider, useDashboardStore } from '@/contexts/dashboard-context';
import { DraftModalsProvider, DraftRestorePill } from '@/contexts/draft-modals-context';
import { getEffectivePlanLimits, hasCashierSystemActive } from '@/lib/cashiers';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { ExchangeRateReminder } from '@/components/dashboard/exchange-rate-reminder';

const SESSION_KEY = 'mm_session_id';
const DEVICE_ID_KEY = 'mm_device_id';

const VALID_DEVICE_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

function getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') return 'server';
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !VALID_DEVICE_ID_RE.test(id)) {
        id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

function buildDeviceSession(
    deviceId: string,
    deviceName: string,
    operator: ActiveOperator | null,
    mode: 'register' | 'supervisor' = 'register',
): ActiveRegisterSession {
    const session: ActiveRegisterSession = {
        deviceId,
        deviceName: deviceName || 'Caja Principal',
        mode,
        lastSeenAt: new Date().toISOString(),
    };
    if (operator?.id) session.cashierId = operator.id;
    if (operator?.name) session.cashierName = operator.name;
    if (operator) session.isOwner = operator.isOwner;
    return session;
}

function getFreshSessions(
    raw: Record<string, ActiveRegisterSession> | undefined,
): Record<string, ActiveRegisterSession> {
    if (!raw) return {};
    const now = new Date();
    const fresh: Record<string, ActiveRegisterSession> = {};
    for (const [key, session] of Object.entries(raw)) {
        if (!session?.lastSeenAt) continue;
        try {
            if (differenceInHours(now, parseISO(session.lastSeenAt)) < 24) {
                const cleaned: ActiveRegisterSession = {
                    deviceId: session.deviceId || key,
                    lastSeenAt: session.lastSeenAt,
                };
                if (session.deviceName) cleaned.deviceName = session.deviceName;
                if (session.cashierId) cleaned.cashierId = session.cashierId;
                if (session.cashierName) cleaned.cashierName = session.cashierName;
                if (typeof session.isOwner === 'boolean') cleaned.isOwner = session.isOwner;
                if (session.mode === 'register' || session.mode === 'supervisor') cleaned.mode = session.mode;
                fresh[key] = cleaned;
            }
        } catch {
            // ignorar fecha inválida
        }
    }
    return fresh;
}

function LicenseExpiredScreen({ profile }: { profile: UserProfile | null }) {
    const { auth, firestore } = useFirebase();
    const { setProfile } = useDashboardStore();
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const whatsappNumber = "584241765136";
    
    const isPending = profile && (
        profile.licenseStatus === 'pending' ||
        (profile.createdAt &&
            differenceInMinutes(new Date(), parseISO(profile.createdAt)) < 1440 &&
            profile.licenseStatus === 'expired')
    );

    const message = encodeURIComponent(
        isPending
        ? `Hola, acabo de registrar mi negocio (${profile?.email}) en COBRANZA ONLINE. Deseo activar mi cuenta.`
        : `Hola, mi cuenta de COBRANZA ONLINE (${profile?.email}) ha sido suspendida o la licencia ha expirado. Deseo gestionar la renovación de mi acceso.`
    );
    
    const handleSignOut = () => {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('mm_active_operator_id');
        sessionStorage.removeItem('mm_active_operator_id');
        sessionStorage.removeItem('mm_security_unlocked');
        auth && signOut(auth);
    };

    const handleRefreshStatus = async () => {
        if (!firestore || !profile?.uid || isCheckingStatus) return;
        setIsCheckingStatus(true);
        try {
            const snap = await getDocFromServer(doc(firestore, 'users', profile.uid));
            if (snap.exists()) {
                setProfile({ ...snap.data(), id: snap.id } as UserProfile);
            }
        } catch {
            // Sin conexión: el listener se encargará cuando vuelva.
        } finally {
            setIsCheckingStatus(false);
        }
    };

    return (
        <div className="min-h-app flex items-center justify-center bg-slate-50 p-4">
            <Card className={`max-w-md w-full shadow-2xl border-t-8 ${isPending ? 'border-amber-500' : 'border-destructive'}`}>
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className={`p-4 rounded-full ${isPending ? 'bg-amber-100' : 'bg-destructive/10'}`}>
                            {isPending ? <Clock className="w-12 h-12 text-amber-600" /> : <Lock className="w-12 h-12 text-destructive" />}
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-black uppercase tracking-tight text-slate-800">
                        {isPending ? "Solicitud Pendiente" : "Acceso Suspendido"}
                    </CardTitle>
                    <CardDescription className="font-bold text-slate-500">
                        {isPending 
                            ? "Tu cuenta fue creada y está esperando activación." 
                            : "Tu acceso al sistema ha sido revocado temporalmente."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-center">
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-left space-y-2">
                        <div className="flex items-center gap-2 text-amber-700 font-black text-[10px] uppercase">
                            <AlertTriangle className="w-4 h-4" /> Activación manual
                        </div>
                        <p className="text-xs text-amber-900 leading-relaxed font-medium">
                            {isPending 
                                ? `Tu solicitud quedó registrada${profile?.businessName ? ` para ${profile.businessName}` : ''}. El administrador debe activar tu cuenta antes de que puedas entrar.`
                                : "Tu licencia ha expirado o el administrador ha suspendido tu acceso por falta de pago o incumplimiento de términos."}
                        </p>
                    </div>

                    <div className="space-y-3">
                        <Button 
                            className="w-full bg-green-600 hover:bg-[#008f39] h-14 text-base font-black shadow-xl" 
                            onClick={() => window.open(`https://wa.me/${whatsappNumber}?text=${message}`, '_blank')}
                        >
                            <MessageCircle className="mr-2 h-5 w-5 fill-white" />
                            {isPending ? "SOLICITAR ACTIVACIÓN" : "CONTACTAR PARA ACTIVAR"}
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full font-bold uppercase"
                            onClick={handleRefreshStatus}
                            disabled={isCheckingStatus}
                        >
                            {isCheckingStatus
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                : <RefreshCw className="w-4 h-4 mr-2" />}
                            {isCheckingStatus ? "Actualizando..." : "Ya me activaron"}
                        </Button>
                        <Button variant="ghost" className="w-full text-slate-400 font-bold" onClick={handleSignOut}>
                            <LogOut className="w-4 h-4 mr-2" /> Cerrar Sesión
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function RegisterLimitScreen({
    profile,
    activeSessions,
    maxRegisters,
    canSwitchToOwner,
    onTakeSlot,
    onSwitchOperator,
    onSignOut,
}: {
    profile: UserProfile;
    activeSessions: ActiveRegisterSession[];
    maxRegisters: number;
    canSwitchToOwner: boolean;
    onTakeSlot: (replaceDeviceId: string) => void;
    onSwitchOperator: () => void;
    onSignOut: () => void;
}) {
    return (
        <div className="flex min-h-app items-center justify-center bg-slate-100/70 p-4">
            <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
                            <MonitorSmartphone className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-slate-900">
                                Límite de cajas activas ({activeSessions.length}/{maxRegisters})
                            </h2>
                            <p className="text-xs text-slate-500">
                                {profile.businessName || profile.email}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 p-5">
                    <p className="text-xs leading-relaxed text-slate-600">
                        Tu plan actual permite hasta <strong>{maxRegisters}</strong>{" "}
                        {maxRegisters === 1 ? "equipo cobrando" : "equipos cobrando"} al mismo tiempo.{" "}
                        {canSwitchToOwner
                            ? "Si eres el administrador, puedes entrar en Modo Supervisor sin cerrar la caja activa, o liberar un cupo."
                            : "Libera una caja inactiva para usar este equipo o amplía tu plan."}
                    </p>

                    <div className="space-y-2">
                        {activeSessions.map((session) => (
                            <div
                                key={session.deviceId}
                                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-slate-800">
                                        {session.deviceName || "Caja conectada"}
                                    </p>
                                    <p className="truncate text-[11px] text-slate-500">
                                        {session.cashierName ? `Operador: ${session.cashierName} · ` : ""}
                                        {session.lastSeenAt
                                            ? format(parseISO(session.lastSeenAt), "dd/MM HH:mm", { locale: es })
                                            : "Activa"}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onTakeSlot(session.deviceId)}
                                    className="h-8 shrink-0 rounded-lg border-blue-200 bg-white px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                                >
                                    Usar este cupo
                                </Button>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-2 pt-1">
                        {canSwitchToOwner && (
                            <Button
                                type="button"
                                onClick={onSwitchOperator}
                                className="h-9 w-full rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 text-xs font-semibold text-white shadow-sm hover:opacity-95"
                            >
                                <Users className="mr-2 h-4 w-4" />
                                Cambiar a Dueño / Cajero
                            </Button>
                        )}

                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onSignOut}
                            className="h-9 w-full rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Cerrar sesión
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Componente interno que maneja los listeners de Firebase centralizados
 */
function DashboardInitializer({ children }: { children: ReactNode }) {
    const { firestore, user, auth } = useFirebase();
    const {
        setSettings,
        setProfile,
        profile,
        settings,
        registerName,
        activeOperator,
        clearActiveOperator,
        setIsSupervisorMode,
        setSupervisorRegisterHolder,
    } = useDashboardStore();
    const [isSettingsLoading, setIsSettingsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [registerLimitBlocked, setRegisterLimitBlocked] = useState<{
        sessions: ActiveRegisterSession[];
        maxRegisters: number;
    } | null>(null);
    const lastSyncedSlotSigRef = useRef<string | null>(null);

    // 1. LISTENER ÚNICO DE PERFIL (1 sola suscripción para toda la App; nunca expulsa antes de elegir operador)
    useEffect(() => {
        if (!firestore || !user) return;
        lastSyncedSlotSigRef.current = null;
        const pRef = doc(firestore, 'users', user.uid);

        const unsubscribe = onSnapshot(pRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setProfile({ ...data, id: snap.id } as UserProfile);
            }
            setIsProfileLoading(false);
        }, (err) => {
            console.error("Profile sync error:", err);
            setIsProfileLoading(false);
        });
        return () => unsubscribe();
    }, [firestore, user, setProfile]);

    // 1B. GESTIÓN DE SESIONES POR DISPOSITIVO (Camino 2 Híbrido: Modo Caja + Modo Supervisor del Dueño)
    useEffect(() => {
        if (!firestore || !user || !profile) return;

        const cashierMode = hasCashierSystemActive(profile);
        // Esperar primero a que el usuario seleccione Dueño o Cajero (nunca cerrar ni bloquear antes)
        if (cashierMode && !activeOperator) {
            lastSyncedSlotSigRef.current = null;
            setRegisterLimitBlocked(null);
            setIsSupervisorMode(false);
            setSupervisorRegisterHolder(null);
            return;
        }

        const effectiveOperator = activeOperator;
        if (!effectiveOperator) return;

        const pRef = doc(firestore, 'users', user.uid);
        const deviceId = getOrCreateDeviceId();
        const limits = getEffectivePlanLimits(profile);
        const rawSessions = profile.activeSessions || {};
        const fresh = getFreshSessions(rawSessions);
        const staleSessionKeys = Object.keys(rawSessions).filter((k) => !fresh[k]);
        const otherRegisters = Object.values(fresh).filter(
            (s) => s.deviceId !== deviceId && s.mode !== 'supervisor',
        );

        const syncMySession = (
            mode: 'register' | 'supervisor',
            extraPatch?: Record<string, any>,
        ) => {
            const extraSig = extraPatch ? Object.keys(extraPatch).sort().join(',') : '';
            const sig = `${deviceId}|${mode}|${effectiveOperator.id}|${effectiveOperator.name}|${registerName}|${extraSig}`;
            const currentOnServer = fresh[deviceId];
            const serverMatches =
                Boolean(currentOnServer) &&
                (currentOnServer.mode || 'register') === mode &&
                currentOnServer.cashierId === effectiveOperator.id &&
                currentOnServer.cashierName === effectiveOperator.name &&
                (currentOnServer.deviceName || 'Caja Principal') === (registerName || 'Caja Principal') &&
                !extraPatch;

            if (serverMatches) {
                lastSyncedSlotSigRef.current = sig;
                return;
            }
            if (lastSyncedSlotSigRef.current === sig) return;

            // Blindaje Multi-Caja: actualiza solo la clave de este dispositivo (`activeSessions.${deviceId}`)
            // para no pisar sesiones de otras cajas que abran en el mismo instante.
            const patch: Record<string, any> = {
                [`activeSessions.${deviceId}`]: buildDeviceSession(deviceId, registerName, effectiveOperator, mode),
                ...(extraPatch || {}),
            };
            for (const staleKey of staleSessionKeys) {
                if (staleKey !== deviceId) {
                    patch[`activeSessions.${staleKey}`] = deleteField();
                }
            }

            lastSyncedSlotSigRef.current = sig;
            void updateDoc(pRef, patch).catch((err) => {
                lastSyncedSlotSigRef.current = null;
                console.warn('[Sesiones] No se pudo sincronizar la sesión del dispositivo:', err);
            });
        };

        // Caso A: Hay cupo disponible en maxRegisters → este dispositivo opera como Caja completa
        if (otherRegisters.length < limits.maxRegisters) {
            setRegisterLimitBlocked(null);
            setIsSupervisorMode(false);
            setSupervisorRegisterHolder(null);
            syncMySession('register');
            return;
        }

        // Caso B: Cupo de cajas lleno, pero este equipo es el Dueño (con cajeros activos) → Modo Supervisor
        if (effectiveOperator.isOwner && cashierMode) {
            const holderLabel = otherRegisters
                .map((s) => s.cashierName || s.deviceName || 'Caja activa')
                .join(', ');
            setRegisterLimitBlocked(null);
            setIsSupervisorMode(true);
            setSupervisorRegisterHolder(holderLabel || 'Cajero activo');
            syncMySession('supervisor');
            return;
        }

        // Caso C: Cupo lleno, entra un Cajero y uno de los cupos lo ocupaba el Dueño →
        // el Dueño pasa automáticamente a Modo Supervisor (sigue abierto) y el Cajero toma la caja
        const ownerHeldRegister = otherRegisters.find((s) => s.isOwner);
        if (!effectiveOperator.isOwner && cashierMode && ownerHeldRegister) {
            setRegisterLimitBlocked(null);
            setIsSupervisorMode(false);
            setSupervisorRegisterHolder(null);
            syncMySession('register', {
                [`activeSessions.${ownerHeldRegister.deviceId}.mode`]: 'supervisor',
            });
            return;
        }

        // Caso D: Todos los cupos de caja están ocupados por otros cajeros (o sin sistema de cajeros)
        lastSyncedSlotSigRef.current = null;
        setIsSupervisorMode(false);
        setSupervisorRegisterHolder(null);
        setRegisterLimitBlocked({
            sessions: otherRegisters,
            maxRegisters: limits.maxRegisters,
        });
    }, [
        firestore,
        user,
        profile,
        activeOperator,
        registerName,
        setIsSupervisorMode,
        setSupervisorRegisterHolder,
    ]);

    const handleTakeRegisterSlot = (replaceDeviceId: string) => {
        if (!firestore || !user || !profile) return;
        const pRef = doc(firestore, 'users', user.uid);
        const deviceId = getOrCreateDeviceId();
        const rawSessions = profile.activeSessions || {};
        const fresh = getFreshSessions(rawSessions);
        const replaced = fresh[replaceDeviceId];
        const patch: Record<string, any> = {
            [`activeSessions.${deviceId}`]: buildDeviceSession(deviceId, registerName, activeOperator, 'register'),
        };
        if (replaced?.isOwner && hasCashierSystemActive(profile)) {
            patch[`activeSessions.${replaceDeviceId}.mode`] = 'supervisor';
        } else if (replaceDeviceId !== deviceId) {
            patch[`activeSessions.${replaceDeviceId}`] = deleteField();
        }
        for (const staleKey of Object.keys(rawSessions)) {
            if (!fresh[staleKey] && staleKey !== deviceId) {
                patch[`activeSessions.${staleKey}`] = deleteField();
            }
        }
        lastSyncedSlotSigRef.current = activeOperator
            ? `${deviceId}|register|${activeOperator.id}|${activeOperator.name}|${registerName}|`
            : null;
        setRegisterLimitBlocked(null);
        setIsSupervisorMode(false);
        setSupervisorRegisterHolder(null);
        void updateDoc(pRef, patch).catch((err) => {
            lastSyncedSlotSigRef.current = null;
            console.warn('[Sesiones] No se pudo reclamar el cupo de caja:', err);
        });
    };

    const handleSwitchFromLimit = () => {
        clearActiveOperator();
        setRegisterLimitBlocked(null);
    };

    const handleSignOutFromLimit = async () => {
        const deviceId = getOrCreateDeviceId();
        if (firestore && user) {
            try {
                await updateDoc(doc(firestore, 'users', user.uid), {
                    [`activeSessions.${deviceId}`]: deleteField(),
                });
            } catch {}
        }
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('mm_active_operator_id');
        sessionStorage.removeItem('mm_security_unlocked');
        sessionStorage.removeItem('mm_active_operator_id');
        if (auth) await signOut(auth);
        window.location.href = '/';
    };

    // 2. LISTENER DE CONFIGURACIÓN GLOBAL (Tasas/Márgenes)
    useEffect(() => {
        if (!firestore || !user) return;
        const sRef = doc(firestore, 'users', user.uid, 'app-settings', 'main');
        const unsubscribe = onSnapshot(sRef, (snap) => {
            if (snap.exists()) {
                setSettings(snap.data() as AppSettings);
            }
            setIsSettingsLoading(false);
        });
        return () => unsubscribe();
    }, [firestore, user, setSettings]);

    // 3. MODO TEXTO GRANDE (accesibilidad): sólo cambia una clase en <html>.
    useEffect(() => {
        const root = document.documentElement;
        if (settings?.largeText) root.setAttribute('data-text-scale', 'lg');
        else root.removeAttribute('data-text-scale');
        return () => root.removeAttribute('data-text-scale');
    }, [settings?.largeText]);

    if (isProfileLoading || isSettingsLoading) {
        return (
            <div className="flex h-app items-center justify-center bg-slate-50">
                <AppLogo className="h-16 w-16 animate-pulse opacity-80" />
            </div>
        );
    }

    const isExpired = profile && 
                      !profile.isAdmin && 
                      (profile.licenseStatus === 'expired' || profile.licenseStatus === 'pending' || (profile.licenseExpiry && isAfter(new Date(), parseISO(profile.licenseExpiry))));

    if (isExpired) {
        return <LicenseExpiredScreen profile={profile} />;
    }

    if (registerLimitBlocked && profile) {
        return (
            <RegisterLimitScreen
                profile={profile}
                activeSessions={registerLimitBlocked.sessions}
                maxRegisters={registerLimitBlocked.maxRegisters}
                canSwitchToOwner={hasCashierSystemActive(profile)}
                onTakeSlot={handleTakeRegisterSlot}
                onSwitchOperator={handleSwitchFromLimit}
                onSignOut={handleSignOutFromLimit}
            />
        );
    }

    return (
        <DraftModalsProvider>
            <SidebarProvider>
                <SidebarNav />
                <SidebarInset className="pb-mobile-nav md:pb-0">
                    <GlobalAnnouncement />
                    <OperatorSwitchScreen />
                    <SecurityUnlockedPill />
                    <ExchangeRateReminder />
                    {children}
                    <RepairDraftPill />
                    <OfflineSyncPill />
                    <DraftRestorePill />
                    <MobileBottomNav />
                </SidebarInset>
            </SidebarProvider>
        </DraftModalsProvider>
    );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
        <DashboardInitializer>
            {children}
        </DashboardInitializer>
    </DashboardProvider>
  );
}
