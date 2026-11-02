"use client";

import { useCurrency } from "@/hooks/use-currency";
import { AlertCircle, Loader2, TrendingUp, Clock, RefreshCw, RotateCcw, Wifi, WifiOff, Download } from "lucide-react";
import { differenceInHours } from "date-fns";
import { Button } from "../ui/button";
import { useState, useEffect } from "react";
import { useFirebase, setDocumentNonBlocking } from "@/firebase";
import { doc } from "firebase/firestore";
import type { AppSettings } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const UPDATE_THRESHOLD_HOURS = 4;

export function ExchangeRateReminder() {
    const { settings, isLoading, bcvRate, parallelRate } = useCurrency();
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    
    const [isAutoUpdating, setIsAutoUpdating] = useState(false);
    const [apiBcvRate, setApiBcvRate] = useState<number | null>(null);
    const [isFetchingApi, setIsFetchingApi] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [installPrompt, setInstallPrompt] = useState<any>(null);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const handleOnline = () => { setIsOnline(true); toast({ title: "Conexión Restaurada" }); };
        const handleOffline = () => { setIsOnline(false); toast({ title: "Sin Conexión", variant: "destructive" }); };
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

    const fetchApiRate = async () => {
        if (typeof window === 'undefined' || !navigator.onLine) return null;
        setIsFetchingApi(true);
        try {
            const response = await fetch('https://ve.dolarapi.com/v1/dolares/bcv');
            if (!response.ok) throw new Error('API Error');
            const data = await response.json();
            if (data && data.promedio) {
                setApiBcvRate(data.promedio);
                return data.promedio;
            }
        } catch (error) {
            console.error("Failed to fetch API rate:", error);
        } finally {
            setIsFetchingApi(false);
        }
        return null;
    };

    useEffect(() => {
        const checkAndSync = async () => {
            if (isLoading || !settings || !firestore || !user || !navigator.onLine) return;

            const liveRate = await fetchApiRate();
            if (!liveRate) return;

            if (settings.autoUpdateBcv) {
                const hoursSinceUpdate = settings.lastUpdated
                    ? differenceInHours(new Date(), new Date(settings.lastUpdated))
                    : Infinity;

                const isSignificantDiff = Math.abs(liveRate - settings.bcvRate) > 0.05;

                if (hoursSinceUpdate >= UPDATE_THRESHOLD_HOURS || isSignificantDiff) {
                    setIsAutoUpdating(true);
                    try {
                        const settingsRef = doc(firestore, 'users', user.uid, 'app-settings', 'main');
                        const newSettings: AppSettings = {
                            ...settings,
                            bcvRate: liveRate,
                            lastUpdated: new Date().toISOString(),
                        };
                        setDocumentNonBlocking(settingsRef, newSettings, { merge: true });
                        toast({ title: "Tasa Actualizada", description: `BCV sincronizado a ${liveRate} Bs.` });
                    } catch (e) {
                        console.error("Auto-sync failed:", e);
                    } finally {
                        setIsAutoUpdating(false);
                    }
                }
            }
        };

        checkAndSync();
        const interval = setInterval(checkAndSync, 3600000); 
        return () => clearInterval(interval);
    }, [settings?.autoUpdateBcv, isLoading, firestore, user?.uid, toast]);

    const handleManualSync = async () => {
        if (!apiBcvRate || !settings || !firestore || !user) return;
        setIsAutoUpdating(true);
        const settingsRef = doc(firestore, 'users', user.uid, 'app-settings', 'main');
        const newSettings: AppSettings = { ...settings, bcvRate: apiBcvRate, lastUpdated: new Date().toISOString() };
        setDocumentNonBlocking(settingsRef, newSettings, { merge: true });
        toast({ title: "Sincronización Manual Exitosa" });
        setIsAutoUpdating(false);
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
    
    const needsSync = apiBcvRate && Math.abs(apiBcvRate - bcvRate) > 0.01;

    return (
        <div className="flex flex-col border-b sticky top-0 z-[40] bg-white shadow-sm">
            <div className="bg-primary/5 px-4 py-2 flex flex-wrap items-center justify-between gap-y-2">
                <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
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

                    <div className="flex items-center gap-2 border-l pl-4 border-slate-200 shrink-0">
                        <TrendingUp className="w-4 h-4 text-primary" />
                        <div className="flex flex-col"><span className="text-[10px] text-muted-foreground uppercase font-bold leading-none">BCV Sistema</span><span className="font-bold text-sm text-primary">{bcvRate.toFixed(2)} Bs</span></div>
                    </div>

                    <div className="flex items-center gap-2 border-l pl-4 border-slate-200 shrink-0">
                        <TrendingUp className="w-4 h-4 text-amber-600" />
                        <div className="flex flex-col"><span className="text-[10px] text-muted-foreground uppercase font-bold leading-none">Reposición</span><span className="font-bold text-sm text-amber-600">{parallelRate.toFixed(2)} Bs</span></div>
                    </div>

                    <div className={cn("flex items-center gap-2 px-3 py-1 rounded-md shrink-0", needsSync ? "bg-amber-100" : "bg-green-50")}>
                        {isFetchingApi ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className={cn("w-2 h-2 rounded-full", needsSync ? "bg-amber-500 animate-pulse" : "bg-green-500")} />}
                        <div className="flex flex-col"><span className="text-[10px] text-muted-foreground uppercase font-bold leading-none">BCV API</span><span className="font-bold text-sm">{apiBcvRate ? `${apiBcvRate.toFixed(2)} Bs` : "..."}</span></div>
                        {needsSync && !settings?.autoUpdateBcv && isOnline && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 ml-1" onClick={handleManualSync} disabled={isAutoUpdating}><RefreshCw className={cn("w-3 h-3", isAutoUpdating && "animate-spin")} /></Button>
                        )}
                    </div>
                </div>
                {isAutoUpdating && <div className="text-primary animate-pulse text-xs font-bold flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Sincronizando...</div>}
            </div>
        </div>
    );
}