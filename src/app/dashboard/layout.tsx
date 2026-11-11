"use client";

import type { UserProfile, AppSettings } from '@/lib/types';
import { SidebarNav } from '@/components/sidebar-nav';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, onSnapshot, getDocFromServer } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock, Lock, LogOut, MessageCircle, RefreshCw, Loader2 } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { isAfter, parseISO, differenceInMinutes } from 'date-fns';
import { GlobalAnnouncement } from '@/components/dashboard/global-announcement';
import { AppLogo } from '@/components/icons';
import { SecurityUnlockedPill } from '@/components/security/security-unlocked-pill';
import { RepairDraftPill } from '@/components/repairs/repair-draft-pill';
import { OfflineSyncPill } from '@/components/offline/offline-sync-pill';
import { DashboardProvider, useDashboardStore } from '@/contexts/dashboard-context';
import { DraftModalsProvider, DraftRestorePill } from '@/contexts/draft-modals-context';
import { type ReactNode, useEffect, useState } from 'react';

import { ExchangeRateReminder } from '@/components/dashboard/exchange-rate-reminder';

const SESSION_KEY = 'mm_session_id';

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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
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

/**
 * Componente interno que maneja los listeners de Firebase centralizados
 */
function DashboardInitializer({ children }: { children: ReactNode }) {
    const { firestore, user, auth } = useFirebase();
    const { setSettings, setProfile, profile } = useDashboardStore();
    const [isSessionValidating, setIsSessionValidating] = useState(true);
    const [isSettingsLoading, setIsSettingsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);

    // 1. LISTENER ÚNICO DE PERFIL Y SESIÓN (Blindaje Máximo: 1 sola suscripción para toda la App)
    useEffect(() => {
        if (!firestore || !user || !auth) return;
        const pRef = doc(firestore, 'users', user.uid);
        const unsubscribe = onSnapshot(pRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setProfile({ ...data, id: snap.id } as UserProfile);

                if (!snap.metadata.hasPendingWrites) {
                    const localSessionId = localStorage.getItem(SESSION_KEY);
                    if (!localSessionId && data.lastSessionId) {
                        localStorage.setItem(SESSION_KEY, data.lastSessionId);
                    } else if (localSessionId && data.lastSessionId && localSessionId !== data.lastSessionId) {
                        localStorage.removeItem(SESSION_KEY);
                        sessionStorage.removeItem('mm_security_unlocked');
                        await signOut(auth);
                        window.location.href = '/';
                        return;
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
    }, [firestore, user, auth, setProfile]);

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

    if (isProfileLoading || isSessionValidating || isSettingsLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50">
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

    return (
        <DraftModalsProvider>
            <SidebarProvider>
                <SidebarNav />
                <SidebarInset>
                    <GlobalAnnouncement />
                    <SecurityUnlockedPill />
                    <ExchangeRateReminder />
                    {children}
                    <RepairDraftPill />
                    <OfflineSyncPill />
                    <DraftRestorePill />
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
