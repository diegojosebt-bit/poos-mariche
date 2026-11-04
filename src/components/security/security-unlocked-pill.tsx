"use client";

import { useDashboardStore } from "@/contexts/dashboard-context";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Unlock, Lock, ShieldCheck } from "lucide-react";

export function SecurityUnlockedPill() {
    const { profile, isSecurityUnlocked, lockSecurity } = useDashboardStore();
    const pathname = usePathname();
    const router = useRouter();
    const { toast } = useToast();

    // Solo se muestra si el negocio tiene la seguridad PIN activa y la sesión está actualmente desbloqueada
    if (!profile || profile.isPinRequired !== true || !profile.securityPin || !isSecurityUnlocked) {
        return null;
    }

    const handleLock = () => {
        lockSecurity();

        // Si estamos en una ruta protegida (Ajustes, Admin o módulo bloqueado), redirigir al POS
        const protectedRoutes = ['/dashboard/settings', '/dashboard/admin'];
        const activeLockedModules = profile.lockedModules || [];
        const isCurrentRouteLocked = 
            protectedRoutes.some(route => pathname.startsWith(route)) ||
            activeLockedModules.some(mod => pathname.startsWith(`/dashboard/${mod}`));

        if (isCurrentRouteLocked) {
            router.push('/dashboard/pos');
        }

        toast({
            title: "Modo Administrador Bloqueado",
            description: "Modo Administrador bloqueado exitosamente.",
        });
    };

    return (
        <div className="w-full bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border-b border-amber-500/30 px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2 shadow-2xs z-30 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-950 dark:text-amber-200">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <Unlock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="tracking-tight">Modo Admin Activo</span>
                <span className="hidden md:inline text-[10px] font-normal text-amber-800/80 dark:text-amber-300/80">
                    (PIN verificado en esta sesión)
                </span>
            </div>

            <Button
                size="sm"
                variant="outline"
                onClick={handleLock}
                className="h-6 sm:h-7 px-2 sm:px-3 text-[10px] sm:text-xs font-black bg-white hover:bg-red-50 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 shadow-2xs transition-all gap-1.5 shrink-0"
            >
                <Lock className="w-3 h-3 text-red-600" />
                <span>Bloquear 🔒</span>
            </Button>
        </div>
    );
}
