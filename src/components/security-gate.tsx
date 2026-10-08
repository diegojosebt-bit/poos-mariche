"use client";

import { useState, useMemo } from 'react';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Lock, Loader2, KeyRound } from 'lucide-react';
import type { UserProfile, UserModule } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const SESSION_KEY = 'mm_security_unlocked';

type SecurityGateProps = {
    children: React.ReactNode;
    module: UserModule | 'settings' | 'admin';
};

export function SecurityGate({ children, module }: SecurityGateProps) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [pin, setPin] = useState("");
    
    const profileRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid) : null,
        [firestore, user?.uid]
    );
    const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(profileRef);

    // EVALUACIÓN DE ACCESO EN TIEMPO REAL
    const isAuthorized = useMemo(() => {
        if (isProfileLoading || !profile) return null;

        // REGLA MAESTRA: Si la Seguridad Global está APAGADA, acceso total inmediato.
        // No hay excepciones para Admin o Ajustes si el dueño decidió apagarlo.
        if (profile.isPinRequired !== true) {
            return true;
        }

        // Si no hay PIN configurado (caso de cuenta nueva), no podemos bloquear.
        if (!profile.securityPin) {
            return true;
        }

        // Si la sesión ya fue desbloqueada manualmente.
        const sessionUnlocked = typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === 'true';
        if (sessionUnlocked) {
            return true;
        }

        // Si llegamos aquí y el módulo es sensible, bloqueamos para pedir el PIN.
        const activeLockedModules = profile.lockedModules || [];
        if (module === 'admin' || module === 'settings' || activeLockedModules.includes(module as UserModule)) {
            return false;
        }

        return true;
    }, [profile, isProfileLoading, module]);

    const handleUnlock = () => {
        if (!profile?.securityPin) return;

        if (pin === profile.securityPin) {
            sessionStorage.setItem(SESSION_KEY, 'true');
            window.location.reload(); // Recargamos para limpiar estados y validar todo el layout
            toast({ title: "Acceso Concedido" });
        } else {
            toast({ 
                variant: "destructive", 
                title: "PIN Incorrecto", 
                description: "Verifica tu clave de acceso." 
            });
            setPin("");
        }
    };

    if (isProfileLoading || isAuthorized === null) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 min-h-[400px]">
                <Loader2 className="w-10 h-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest animate-pulse">
                    Sincronizando Seguridad...
                </p>
            </div>
        );
    }

    if (isAuthorized) return <>{children}</>;

    return (
        <div className="flex-1 flex items-center justify-center p-4 bg-slate-100/50 backdrop-blur-sm">
            <Card className="max-w-sm w-full shadow-2xl border-t-4 border-primary animate-in fade-in zoom-in-95 duration-200">
                <CardHeader className="text-center">
                    <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                        <Lock className="text-primary w-8 h-8" />
                    </div>
                    <CardTitle className="text-xl font-black uppercase tracking-tight">Zona Protegida</CardTitle>
                    <CardDescription className="text-xs font-medium">
                        Introduce el PIN de Gerente para continuar.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <div className="relative">
                            <KeyRound className="absolute left-3 top-3 h-5 w-5 text-muted-foreground opacity-50" />
                            <Input 
                                type="password" 
                                placeholder="••••" 
                                value={pin} 
                                onChange={(e) => setPin(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                                className="text-center text-3xl tracking-[0.5em] font-black h-14 pl-10"
                                maxLength={8}
                                autoFocus
                            />
                        </div>
                    </div>
                    <Button className="w-full h-12 text-base font-bold shadow-lg" onClick={handleUnlock}>
                        DESBLOQUEAR AHORA
                    </Button>
                    <p className="text-[10px] text-center text-muted-foreground italic">
                        La seguridad global está activada en tus ajustes.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}