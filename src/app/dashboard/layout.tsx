"use client";

import type { ActiveOperator, ActiveRegisterSession, UserProfile, AppSettings } from '@/lib/types';
import { SidebarNav } from '@/components/sidebar-nav';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { useFirebase } from '@/firebase';
import { doc, onSnapshot, getDocFromServer, updateDoc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock, Lock, LogOut, MessageCircle, RefreshCw, Loader2, MonitorSmartphone } from 'lucide-react';
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
import { getEffectivePlanLimits } from '@/lib/cashiers';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { ExchangeRateReminder } from '@/components/dashboard/exchange-rate-reminder';

const SESSION_KEY = 'mm_session_id';
const DEVICE_ID_KEY = 'mm_device_id';

function getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') return 'server';
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

function buildDeviceSession(
    deviceId: string,
    deviceName: string,
    operator: ActiveOperator | null,
): ActiveRegisterSession {
    const session: ActiveRegisterSession = {
        deviceId,
        deviceName: deviceName || 'Caja Principal',
        lastSeenAt: new Date().toISOString(),
    };
    if (operator?.id) session.cashierId = operator.id;
    if (operator?.name) session.cashierName = operator.name;
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
    onTakeSlot,
    onSignOut,
}: {
    profile: UserProfile;
    activeSessions: ActiveRegisterSession[];
    maxRegisters: number;
    onTakeSlot: (replaceDeviceId: string) => void;
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
                        {maxRegisters === 1 ? "caja abierta" : "cajas abiertas"} al mismo tiempo. Libera una caja inactiva para usar este equipo o amplía tu plan.
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
    );
}

/**
 * Componente interno que maneja los listeners de Firebase centralizados
 */
function DashboardInitializer({ children }: { children: ReactNode }) {
    const { firestore, user, auth } = useFirebase();
    const { setSettings, setProfile, profile, settings, registerName, activeOperator } = useDashboardStore();
    const [isSessionValidating, setIsSessionValidating] = useState(true);
    const [isSettingsLoading, setIsSettingsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [registerLimitBlocked, setRegisterLimitBlocked] = useState<{
        sessions: ActiveRegisterSession[];
        maxRegisters: number;
    } | null>(null);
    const registeredSlotRef = useRef(false);

    // 1. LISTENER ÚNICO DE PERFIL Y SESIÓN (Blindaje Máximo: 1 sola suscripción para toda la App)
    useEffect(() => {
        if (!firestore || !user || !auth) return;
        registeredSlotRef.current = false;
        const pRef = doc(firestore, 'users', user.uid);
        const deviceId = getOrCreateDeviceId();

        const unsubscribe = onSnapshot(pRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                const nextProfile = { ...data, id: snap.id } as UserProfile;
                setProfile(nextProfile);

                if (!snap.metadata.hasPendingWrites) {
                    const limits = getEffectivePlanLimits(nextProfile);

                    if (limits.isMultiRegister) {
                        // MODO MULTI-CAJA: gestiona cupos simultáneos (`activeSessions`) hasta `maxRegisters`
                        const fresh = getFreshSessions(nextProfile.activeSessions);
                        const hasMySlot = Boolean(fresh[deviceId]);
                        const count = Object.keys(fresh).length;

                        if (hasMySlot) {
                            setRegisterLimitBlocked(null);
                            if (!registeredSlotRef.current) {
                                registeredSlotRef.current = true;
                                void updateDoc(pRef, {
                                    activeSessions: {
                                        ...fresh,
                                        [deviceId]: buildDeviceSession(deviceId, registerName, activeOperator),
                                    },
                                }).catch((err) => {
                                    console.warn('[Multi-Caja] No se pudo actualizar la sesión:', err);
                                });
                            }
                        } else if (count < limits.maxRegisters) {
                            setRegisterLimitBlocked(null);
                            registeredSlotRef.current = true;
                            void updateDoc(pRef, {
                                activeSessions: {
                                    ...fresh,
                                    [deviceId]: buildDeviceSession(deviceId, registerName, activeOperator),
                                },
                            }).catch((err) => {
                                console.warn('[Multi-Caja] No se pudo registrar la sesión:', err);
                            });
                        } else {
                            setRegisterLimitBlocked({
                                sessions: Object.values(fresh),
                                maxRegisters: limits.maxRegisters,
                            });
                        }
                    } else {
                        // MODO 1 CAJA: mantiene el blindaje de sesión única (`lastSessionId`)
                        setRegisterLimitBlocked(null);
                        const localSessionId = localStorage.getItem(SESSION_KEY);
                        if (!localSessionId && data.lastSessionId) {
                            localStorage.setItem(SESSION_KEY, data.lastSessionId);
                        } else if (localSessionId && data.lastSessionId && localSessionId !== data.lastSessionId) {
                            localStorage.removeItem(SESSION_KEY);
                            sessionStorage.removeItem('mm_security_unlocked');
                            sessionStorage.removeItem('mm_active_operator_id');
                            await signOut(auth);
                            window.location.href = '/';
                            return;
                        }
                    }
                }
            }
            setIsProfileLoading(false);
            setIsSessionValidating(false);
        }, (err) => {
            console.error("Profile & session sync error:", err);
            setIsProfileLoading(false);
            setIsSessionValidating(false);
        });
        return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firestore, user, auth, setProfile]);

    const handleTakeRegisterSlot = (replaceDeviceId: string) => {
        if (!firestore || !user || !profile) return;
        const pRef = doc(firestore, 'users', user.uid);
        const deviceId = getOrCreateDeviceId();
        const fresh = getFreshSessions(profile.activeSessions);
        delete fresh[replaceDeviceId];
        fresh[deviceId] = buildDeviceSession(deviceId, registerName, activeOperator);
        registeredSlotRef.current = true;
        setRegisterLimitBlocked(null);
        void updateDoc(pRef, { activeSessions: fresh }).catch((err) => {
            console.warn('[Multi-Caja] No se pudo reclamar el cupo de caja:', err);
        });
    };

    const handleSignOutFromLimit = async () => {
        localStorage.removeItem(SESSION_KEY);
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

    if (isProfileLoading || isSessionValidating || isSettingsLoading) {
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
                onTakeSlot={handleTakeRegisterSlot}
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
