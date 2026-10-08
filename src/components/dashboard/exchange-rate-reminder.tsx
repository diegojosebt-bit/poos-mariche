"use client";

import { useCurrency } from "@/hooks/use-currency";
import { Loader2, TrendingUp, RefreshCw, RotateCcw, Wifi, WifiOff, Download } from "lucide-react";
import { Button } from "../ui/button";
import { useState, useEffect } from "react";
import { useFirebase, setDocumentNonBlocking } from "@/firebase";
import { doc } from "firebase/firestore";
import type { AppSettings } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ExchangeRateReminder() {
    const { settings, isLoading, bcvRate, parallelRate } = useCurrency();
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    
    const [isUpdating, setIsUpdating] = useState(false);
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
                {isUpdating && <div className="text-primary animate-pulse text-xs font-bold flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Actualizando tasa BCV...</div>}
            </div>
        </div>
    );
}
