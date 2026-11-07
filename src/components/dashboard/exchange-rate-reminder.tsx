"use client";

import { useCurrency } from "@/hooks/use-currency";
import { Loader2, TrendingUp, RefreshCw, RotateCcw, Wifi, WifiOff, Download, LogOut } from "lucide-react";
import { Button } from "../ui/button";
import { useState, useEffect, useRef } from "react";
import { useFirebase, setDocumentNonBlocking } from "@/firebase";
import { doc } from "firebase/firestore";
import type { AppSettings } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { UserAvatarIcon } from "@/components/icons";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { useDashboardStore } from "@/contexts/dashboard-context";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VENEZUELA_OFFSET_MS = 4 * 60 * 60 * 1000;
const BCV_SYNC_HOURS = [7, 15, 20];

function getVenezuelaDayParts(now: number) {
    const local = new Date(now - VENEZUELA_OFFSET_MS);
    return {
        year: local.getUTCFullYear(),
        month: local.getUTCMonth(),
        day: local.getUTCDate(),
    };
}

/** Próxima ejecución: 7:00, 15:00 o 20:00 hora Venezuela. */
function getNextBcvSyncAt(now = Date.now()): number {
    const { year, month, day } = getVenezuelaDayParts(now);
    const todaySlots = BCV_SYNC_HOURS.map(
        (hour) => Date.UTC(year, month, day, hour) + VENEZUELA_OFFSET_MS,
    );
    const nextToday = todaySlots.find((slot) => slot > now);
    return nextToday ?? Date.UTC(year, month, day + 1, 7) + VENEZUELA_OFFSET_MS;
}

/** Última ejecución que ya debería haber ocurrido. */
function getLastBcvSlot(now = Date.now()): number {
    const { year, month, day } = getVenezuelaDayParts(now);
    const todaySlots = BCV_SYNC_HOURS.map(
        (hour) => Date.UTC(year, month, day, hour) + VENEZUELA_OFFSET_MS,
    );
    const passed = todaySlots.filter((slot) => slot <= now);
    return passed.length > 0
        ? passed[passed.length - 1]
        : Date.UTC(year, month, day - 1, 20) + VENEZUELA_OFFSET_MS;
}

export function ExchangeRateReminder() {
    const { settings, isLoading, bcvRate, parallelRate } = useCurrency();
    const { firestore, user, auth } = useFirebase();
    const { profile } = useDashboardStore();
    const { toast } = useToast();
    const router = useRouter();

    const handleSignOut = async () => {
        try {
            localStorage.removeItem('mm_session_id');
            sessionStorage.removeItem('mm_security_unlocked');
            if (auth) await signOut(auth);
        } finally {
            router.replace('/');
        }
    };
    
    const [isUpdating, setIsUpdating] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [installPrompt, setInstallPrompt] = useState<any>(null);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const handleOnline = () => { setIsOnline(true); toast({ title: "Conexión Restaurada" }); };
        const handleOffline = () => { setIsOnline(false); };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const handleBeforeInstallPrompt = (event: any) => {
            event.preventDefault();
            setInstallPrompt(event);
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => { 
            window.removeEventListener('online', handleOnline); 
            window.removeEventListener('offline', handleOffline); 
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, [toast]);

    // Sincronización automática: 7:00, 15:00 y 20:00 (hora Venezuela).
    // Compara contra la tasa ya cargada en memoria; si no cambió, no escribe nada.
    const autoSyncLastSlotRef = useRef(0);
    useEffect(() => {
        if (!settings?.autoUpdateBcv || !settings || !firestore || !user) return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let running = false;

        const syncRate = async () => {
            if (running || cancelled || !navigator.onLine) return;
            running = true;
            try {
                const response = await fetch(`/api/bcv-rate?t=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) return;
                const data = await response.json();
                if (typeof data?.bcvRate !== "number" || data.bcvRate <= 0) return;

                const currentRate = Number(settings.bcvRate || 0);
                const liveRate = parseFloat(data.bcvRate.toFixed(4));
                if (currentRate > 0 && Math.abs(liveRate - currentRate) < 0.00005) {
                    return; // Sin cambios: 0 escrituras y 0 lecturas de Firestore.
                }

                const settingsRef = doc(firestore, "users", user.uid, "app-settings", "main");
                await setDocumentNonBlocking(settingsRef, {
                    bcvRate: liveRate,
                    lastUpdated: new Date().toISOString(),
                }, { merge: true });
            } catch {
                // Sin conexión o API caída: se reintenta en el próximo horario.
            } finally {
                running = false;
            }
        };

        const scheduleNext = () => {
            if (cancelled) return;
            const delay = Math.max(1_000, getNextBcvSyncAt() - Date.now());
            timer = setTimeout(async () => {
                await syncRate();
                scheduleNext();
            }, delay);
        };

        // Recupera una ejecución perdida si la app estaba cerrada a esa hora.
        const lastSlot = getLastBcvSlot();
        const lastUpdated = settings.lastUpdated ? new Date(settings.lastUpdated).getTime() : 0;
        if (
            lastSlot > autoSyncLastSlotRef.current &&
            (!lastUpdated || lastUpdated < lastSlot)
        ) {
            autoSyncLastSlotRef.current = lastSlot;
            void syncRate();
        }

        scheduleNext();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [settings?.autoUpdateBcv, settings?.bcvRate, settings?.lastUpdated, firestore, user?.uid]);

    // Manual reload only when requested by the user clicking the icon button
    const handleReloadRate = async () => {
        if (!navigator.onLine) {
            toast({ title: "Sin conexión a Internet", variant: "destructive" });
            return;
        }
        setIsUpdating(true);
        try {
            const response = await fetch(`/api/bcv-rate?t=${Date.now()}`);
            if (!response.ok) throw new Error('Error al consultar la tasa');
            const data = await response.json();
            
            if (data && typeof data.bcvRate === 'number' && data.bcvRate > 0) {
                const liveRate = data.bcvRate;
                if (settings && firestore && user) {
                    const settingsRef = doc(firestore, 'users', user.uid, 'app-settings', 'main');
                    const newSettings: AppSettings = {
                        ...settings,
                        bcvRate: liveRate,
                        lastUpdated: new Date().toISOString(),
                    };
                    await setDocumentNonBlocking(settingsRef, newSettings, { merge: true });
                    toast({
                        title: "Tasa BCV Actualizada",
                        description: `Sincronizada a ${liveRate.toFixed(2)} Bs.`
                    });
                }
            } else {
                toast({
                    title: "No se pudo obtener la tasa oficial",
                    description: "Inténtalo de nuevo en unos momentos.",
                    variant: "destructive"
                });
            }
        } catch (e) {
            console.error("Error al recargar tasa oficial:", e);
            toast({ title: "Error al actualizar la tasa", variant: "destructive" });
        } finally {
            setIsUpdating(false);
        }
    };

    const handleInstallClick = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            toast({ title: '¡Instalación Exitosa!', description: 'La app ya está en tu escritorio.' });
        }
        setInstallPrompt(null);
    };

    if (isLoading) return <div className="p-2 border-b bg-muted/20 text-xs animate-pulse">Cargando tasas...</div>;

    return (
        <div className="flex flex-col border-b sticky top-0 z-[40] bg-white shadow-sm">
            <div className="bg-primary/5 px-4 py-2 flex flex-wrap items-center justify-between gap-y-2">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-primary hover:bg-primary/10 shrink-0 border border-primary/10" 
                        onClick={() => window.location.reload()}
                        title="Actualizar aplicación"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </Button>

                    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md border shrink-0", isOnline ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200")}>
                        {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                        <span className="text-[10px] font-black uppercase tracking-wider">{isOnline ? "En Línea" : "Sin Internet"}</span>
                    </div>

                    {installPrompt && (
                        <Button 
                            variant="default" 
                            size="sm" 
                            onClick={handleInstallClick}
                            className="h-8 px-4 text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white shadow-md shrink-0 animate-in fade-in zoom-in-95 duration-300"
                        >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            INSTALAR EN ESCRITORIO
                        </Button>
                    )}

                    {/* Tasa BCV Unificada */}
                    <div className="flex items-center gap-2 border-l pl-3 border-slate-200 shrink-0">
                        <TrendingUp className="w-4 h-4 text-primary" />
                        <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold leading-none">Tasa BCV</span>
                            <span className="font-bold text-sm text-primary">
                                {bcvRate.toFixed(2)} Bs
                            </span>
                        </div>
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleReloadRate}
                            disabled={isUpdating}
                            className="h-7 w-7 text-primary hover:bg-primary/10 shrink-0 border border-primary/10 rounded-full ml-1"
                            title="Recargar tasa oficial BCV"
                        >
                            <RefreshCw className={cn("w-3.5 h-3.5", isUpdating && "animate-spin")} />
                        </Button>
                    </div>

                    {/* Tasa Reposición */}
                    <div className="flex items-center gap-2 border-l pl-3 border-slate-200 shrink-0">
                        <TrendingUp className="w-4 h-4 text-amber-600" />
                        <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold leading-none">Reposición</span>
                            <span className="font-bold text-sm text-amber-600">{parallelRate.toFixed(2)} Bs</span>
                        </div>
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {isUpdating && (
                        <div className="text-primary animate-pulse text-xs font-bold flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Actualizando tasa BCV...
                        </div>
                    )}

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-full !bg-transparent text-slate-900 hover:!bg-transparent hover:!text-slate-900 active:!bg-transparent data-[state=open]:!bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                                style={{ width: 34, height: 34 }}
                                title="Cuenta"
                            >
                                <UserAvatarIcon style={{ width: 25, height: 25 }} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuLabel className="font-normal">
                                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                                    Cuenta
                                </p>
                                <p className="mt-1 truncate text-xs font-bold">
                                    {profile?.email || user?.email || 'Mi cuenta'}
                                </p>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onSelect={(event) => {
                                    event.preventDefault();
                                    void handleSignOut();
                                }}
                                className="cursor-pointer text-destructive data-[highlighted]:bg-primary data-[highlighted]:text-white focus:bg-primary focus:text-white"
                            >
                                <LogOut className="mr-2 h-4 w-4" />
                                Cerrar sesión
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
}
