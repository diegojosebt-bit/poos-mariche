"use client";

import { useCurrency } from "@/hooks/use-currency";
import { Loader2, RefreshCw, RotateCcw, Wifi, WifiOff, Download, LogOut, User, ChevronDown, Users, Lock, Landmark, TrendingUp } from "lucide-react";
import { hasCashierSystemActive } from "@/lib/cashiers";
import { usePwaInstall } from "@/contexts/pwa-install-context";
import { Button } from "../ui/button";
import { useState, useEffect, useRef } from "react";
import { useFirebase, setDocumentNonBlocking } from "@/firebase";
import { doc } from "firebase/firestore";
import type { AppSettings } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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

/** Menú de cuenta compartido por la barra móvil y la de escritorio. */
function AccountMenu({
    email,
    operatorName,
    operatorIsOwner,
    showCashierSwitch,
    onSwitchOperator,
    onLockScreen,
    onSignOut,
    onReloadApp,
    size = "desktop",
}: {
    email?: string | null;
    operatorName?: string | null;
    operatorIsOwner?: boolean;
    showCashierSwitch?: boolean;
    onSwitchOperator?: () => void;
    onLockScreen?: () => void;
    onSignOut: () => void | Promise<void>;
    onReloadApp: () => void;
    size?: "desktop" | "mobile";
}) {
    const displayLabel = showCashierSwitch && operatorName
        ? operatorName
        : (email?.split("@")[0] || "Mi Cuenta");

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className={cn(
                        "rounded-full border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition-all flex items-center group focus-visible:ring-0 focus-visible:ring-offset-0",
                        size === "desktop" ? "h-9 pl-1 pr-2.5 gap-2" : "h-8 w-8 justify-center p-0"
                    )}
                    aria-label="Menú de cuenta"
                    title="Menú de cuenta"
                >
                    <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-white shadow-sm shrink-0",
                        showCashierSwitch && !operatorIsOwner
                            ? "bg-emerald-600"
                            : "bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600"
                    )}>
                        <User className="w-3.5 h-3.5 text-white stroke-[2.2]" />
                    </div>
                    {size === "desktop" && (
                        <div className="hidden xl:flex items-center gap-1 text-left">
                            <span className="text-xs font-semibold text-slate-800 max-w-[110px] truncate">
                                {displayLabel}
                            </span>
                            <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition-colors" />
                        </div>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-64 bg-white border border-slate-200 text-slate-900 shadow-xl p-1.5 rounded-xl">
                <DropdownMenuLabel className="font-normal px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {showCashierSwitch
                            ? (operatorIsOwner ? "Turno · Gerente" : "Turno · Cajero")
                            : "Sesión Activa"}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-900">
                        {showCashierSwitch && operatorName ? operatorName : (email || "Mi cuenta")}
                    </p>
                    {showCashierSwitch && email && (
                        <p className="truncate text-[11px] text-slate-500">{email}</p>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-100 my-1" />
                {showCashierSwitch && onSwitchOperator && (
                    <>
                        <DropdownMenuItem
                            onSelect={() => onSwitchOperator()}
                            className="cursor-pointer text-blue-700 hover:text-blue-800 focus:bg-blue-50 rounded-lg px-2.5 py-2 text-xs font-semibold"
                        >
                            <Users className="mr-2 h-4 w-4 text-blue-600" />
                            Cambiar cajero
                        </DropdownMenuItem>
                        {onLockScreen && (
                            <DropdownMenuItem
                                onSelect={() => onLockScreen()}
                                className="cursor-pointer text-slate-700 hover:text-slate-900 focus:bg-slate-100 rounded-lg px-2.5 py-2 text-xs font-medium"
                            >
                                <Lock className="mr-2 h-4 w-4 text-slate-500" />
                                Bloquear caja
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-slate-100 my-1" />
                    </>
                )}
                <DropdownMenuItem onSelect={() => onReloadApp()} className="cursor-pointer text-slate-700 hover:text-slate-900 focus:bg-slate-100 rounded-lg px-2.5 py-2 text-xs font-semibold">
                    <RotateCcw className="mr-2 h-4 w-4 text-blue-600" />
                    Recargar aplicación
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-100 my-1" />
                <DropdownMenuItem
                    onSelect={(event) => {
                        event.preventDefault();
                        void onSignOut();
                    }}
                    className="cursor-pointer text-rose-600 hover:text-rose-700 focus:bg-rose-50 rounded-lg px-2.5 py-2 text-xs font-semibold"
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    Cerrar sesión
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function ExchangeRateReminder() {
    const { settings, isLoading, bcvRate, parallelRate } = useCurrency();
    const { firestore, user, auth } = useFirebase();
    const {
        profile,
        activeOperator,
        clearActiveOperator,
        setIsOperatorPromptOpen,
        setDesktopTopBarHost,
        setMobileTopBarHost,
    } = useDashboardStore();
    const cashierMode = hasCashierSystemActive(profile);
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
    
    const { shouldShowInstall, triggerInstall } = usePwaInstall();
    const [isUpdating, setIsUpdating] = useState(false);
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const handleOnline = () => { setIsOnline(true); toast({ title: "Conexión Restaurada" }); };
        const handleOffline = () => { setIsOnline(false); };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => { 
            window.removeEventListener('online', handleOnline); 
            window.removeEventListener('offline', handleOffline); 
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
            toast({ title: "Sin conexión a Internet", variant: "warning" });
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

    const handleInstallClick = () => {
        void triggerInstall();
    };

    if (isLoading) return <div className="p-2 border-b bg-muted/20 text-xs animate-pulse">Cargando tasas...</div>;

    return (
        <div className="sticky top-0 z-[40] border-b border-slate-200/90 bg-white/95 backdrop-blur-md text-slate-800 shadow-2xs">
            {/* ---------- Móvil: barra compacta con chips uniformes (h-8) ---------- */}
            <div className="flex h-12 items-center gap-1.5 px-3 md:hidden">
                <button
                    type="button"
                    onClick={handleReloadRate}
                    disabled={isUpdating}
                    aria-label="Recargar tasa BCV"
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/90 via-white to-white pl-1.5 pr-2 shadow-xs active:scale-[0.98] transition-all disabled:opacity-60"
                >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-2xs">
                        <Landmark className="h-3 w-3" />
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-700">BCV</span>
                    <span className="text-xs font-bold leading-none tabular-nums text-slate-900">
                        {isUpdating ? "…" : bcvRate.toFixed(2)}
                    </span>
                    <RefreshCw className={cn("h-3 w-3 text-emerald-600", isUpdating && "animate-spin")} />
                </button>

                <div className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-blue-200/90 bg-gradient-to-r from-blue-50/90 via-white to-white pl-1.5 pr-2.5 shadow-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-2xs">
                        <TrendingUp className="h-3 w-3" />
                    </span>
                    <span className="text-[10px] font-semibold text-blue-700">PAR</span>
                    <span className="text-xs font-bold leading-none tabular-nums text-slate-900">
                        {parallelRate.toFixed(2)}
                    </span>
                </div>

                {/* Host de acciones móviles (POS: En Espera + Menú rápido) */}
                <div 
                    id="top-bar-mobile-pos-actions" 
                    ref={setMobileTopBarHost} 
                    className="flex items-center gap-1.5 shrink-0 empty:hidden" 
                />

                <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                    <div className="hidden sm:inline-flex h-8 items-center gap-1.5 px-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xs">
                        {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-rose-500" />}
                        <span className={cn("text-[11px] font-semibold", isOnline ? "text-slate-700" : "text-rose-600")}>
                            {isOnline ? "Online" : "Offline"}
                        </span>
                    </div>

                    {shouldShowInstall && (
                        <button
                            type="button"
                            onClick={handleInstallClick}
                            aria-label="Instalar aplicación"
                            title="Instalar Cobranza Online"
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-white bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-sm transition-all"
                        >
                            <Download className="h-4 w-4" />
                        </button>
                    )}

                    <AccountMenu
                        email={profile?.email || user?.email}
                        operatorName={activeOperator?.name}
                        operatorIsOwner={activeOperator?.isOwner}
                        showCashierSwitch={cashierMode}
                        onSwitchOperator={() => setIsOperatorPromptOpen(true)}
                        onLockScreen={clearActiveOperator}
                        onSignOut={handleSignOut}
                        onReloadApp={() => window.location.reload()}
                        size="mobile"
                    />
                </div>
            </div>

            {/* ---------- Escritorio: barra financiera uniforme 2026 (h-9 en todos los items) ---------- */}
            <div className="hidden h-14 px-4 md:flex md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                    <div className={cn(
                        "inline-flex h-9 items-center gap-2 pl-1.5 pr-3 rounded-xl border text-xs font-semibold shadow-xs transition-colors shrink-0",
                        isOnline 
                            ? "border-slate-200/90 bg-gradient-to-r from-slate-50/90 via-white to-white text-slate-700" 
                            : "border-rose-200 bg-rose-50 text-rose-700"
                    )}>
                        <span className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border",
                            isOnline
                                ? "border-emerald-200/80 bg-emerald-50 text-emerald-600"
                                : "border-rose-200 bg-rose-100 text-rose-600"
                        )}>
                            {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                        </span>
                        <span className="tracking-tight">
                            {isOnline ? "En Línea" : "Sin Internet"}
                        </span>
                    </div>

                    {/* Widget BCV Oficial (h-9 con badge de icono esmeralda) */}
                    <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/90 via-white to-white pl-1.5 pr-1.5 shadow-xs transition-colors hover:border-emerald-300 shrink-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-2xs">
                            <Landmark className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[11px] font-semibold tracking-tight text-emerald-700">
                            BCV
                        </span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-[13px] font-bold tabular-nums text-slate-900">
                                {bcvRate.toFixed(2)}
                            </span>
                            <span className="text-[11px] font-medium text-emerald-700/80">Bs</span>
                        </div>
                        <div className="h-4 w-px bg-emerald-200/70" />
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleReloadRate}
                            disabled={isUpdating}
                            className="h-6 w-6 rounded-lg text-emerald-700 hover:bg-emerald-100/80 hover:text-emerald-800 transition-colors"
                            title="Actualizar tasa oficial BCV"
                        >
                            <RefreshCw className={cn("h-3 w-3", isUpdating && "animate-spin")} />
                        </Button>
                    </div>

                    {/* Widget Tasa Paralelo (h-9 con badge de icono azul) */}
                    <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-blue-200/90 bg-gradient-to-r from-blue-50/90 via-white to-white pl-1.5 pr-3 shadow-xs transition-colors hover:border-blue-300 shrink-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-2xs">
                            <TrendingUp className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[11px] font-semibold tracking-tight text-blue-700">
                            Paralelo
                        </span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-[13px] font-bold tabular-nums text-slate-900">
                                {parallelRate.toFixed(2)}
                            </span>
                            <span className="text-[11px] font-medium text-blue-700/80">Bs</span>
                        </div>
                    </div>

                    {shouldShowInstall && (
                        <Button 
                            variant="default" 
                            size="sm" 
                            onClick={handleInstallClick}
                            className="h-9 px-3 text-xs font-semibold bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white rounded-xl shadow-sm shadow-emerald-500/20 shrink-0"
                        >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Instalar App
                        </Button>
                    )}
                </div>

                {/* Right: Acciones contextuales unificadas (POS) + Cuenta */}
                <div className="ml-auto flex shrink-0 items-center gap-2.5">
                    {isUpdating && (
                        <div className="text-blue-700 animate-pulse text-xs font-semibold flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" /> Actualizando...
                        </div>
                    )}

                    {/* Host de acciones dinámicas (POS: Venta en espera, Calculadora, Venta Rápida) */}
                    <div 
                        id="top-bar-pos-actions" 
                        ref={setDesktopTopBarHost} 
                        className="flex items-center gap-2 shrink-0 empty:hidden" 
                    />

                    <AccountMenu
                        email={profile?.email || user?.email}
                        operatorName={activeOperator?.name}
                        operatorIsOwner={activeOperator?.isOwner}
                        showCashierSwitch={cashierMode}
                        onSwitchOperator={() => setIsOperatorPromptOpen(true)}
                        onLockScreen={clearActiveOperator}
                        onSignOut={handleSignOut}
                        onReloadApp={() => window.location.reload()}
                        size="desktop"
                    />
                </div>
            </div>
        </div>
    );
}
