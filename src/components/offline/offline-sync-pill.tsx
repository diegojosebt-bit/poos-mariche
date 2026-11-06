'use client';

import { useEffect, useState, useCallback } from 'react';
import { useFirebase } from '@/firebase';
import { 
  getOfflineQueue, 
  syncOfflineQueue, 
  OFFLINE_QUEUE_EVENT,
  OfflineSaleOperation 
} from '@/lib/offline-sync-manager';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ensureOnline } from '@/lib/offline-guard';

export function OfflineSyncPill() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [justSynced, setJustSynced] = useState<boolean>(false);

  // Comprobar estado de conexión inicial
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
    }
  }, []);

  // Cargar estado de la cola del usuario activo
  const refreshQueueCount = useCallback(() => {
    if (!user) {
      setQueueCount(0);
      return;
    }
    const queue = getOfflineQueue(user.uid);
    setQueueCount(queue.length);
  }, [user]);

  useEffect(() => {
    refreshQueueCount();
  }, [refreshQueueCount]);

  // Manejar sincronización
  const handleSync = useCallback(async () => {
    if (!firestore || !user || isSyncing) return;
    
    const count = getOfflineQueue(user.uid).length;
    if (count === 0) return;
    if (!ensureOnline(toast, 'Sincronizar ventas pendientes')) return;

    setIsSyncing(true);
    try {
      const { syncedCount, errors } = await syncOfflineQueue(firestore, user.uid);
      if (syncedCount > 0) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 4000);
        toast({
          title: "Sincronización Exitosa",
          description: `Se sincronizaron ${syncedCount} operaciones pendientes a la nube (0 lecturas a Firebase).`,
        });
      }
      if (errors.length > 0) {
        toast({
          variant: "destructive",
          title: "Sincronización parcial",
          description: "Algunas operaciones permanecen en cola y se reintentarán.",
        });
      }
    } catch (err) {
      console.error("Error al sincronizar cola offline:", err);
    } finally {
      setIsSyncing(false);
      refreshQueueCount();
    }
  }, [firestore, user, isSyncing, toast, refreshQueueCount]);

  // Escuchar eventos de red (online / offline) y eventos de cola
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sincronizar inmediatamente al reconectar
      handleSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    const handleQueueEvent = (e: any) => {
      if (!user) return;
      if (e.detail?.userId === user.uid) {
        setQueueCount(e.detail.count ?? getOfflineQueue(user.uid).length);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(OFFLINE_QUEUE_EVENT, handleQueueEvent);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, handleQueueEvent);
    };
  }, [user, handleSync]);

  // Protección antes de cerrar la pestaña si hay operaciones pendientes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (queueCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [queueCount]);

  // Si está online y no hay nada en cola ni recién sincronizado, mostramos solo si se desea o nada
  if (isOnline && queueCount === 0 && !justSynced && !isSyncing) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {justSynced ? (
        <div className="flex items-center gap-2 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg border border-emerald-500">
          <CheckCircle2 className="w-4 h-4" />
          <span>Sincronizado con la nube</span>
        </div>
      ) : !isOnline ? (
        <div className="flex items-center gap-2 bg-amber-500 text-slate-950 text-xs font-bold px-3.5 py-1.5 rounded-full shadow-xl border border-amber-400">
          <WifiOff className="w-4 h-4 animate-pulse" />
          <span>Modo Offline</span>
          {queueCount > 0 && (
            <span className="bg-slate-950 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full ml-1">
              {queueCount} {queueCount === 1 ? 'pendiente' : 'pendientes'}
            </span>
          )}
        </div>
      ) : isSyncing ? (
        <div className="flex items-center gap-2 bg-sky-600 text-white text-xs font-bold px-3.5 py-1.5 rounded-full shadow-xl border border-sky-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Sincronizando {queueCount} op...</span>
        </div>
      ) : queueCount > 0 ? (
        <div className="flex items-center gap-2 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-xl border border-blue-500">
          <Wifi className="w-4 h-4 text-emerald-300" />
          <span>{queueCount} en cola</span>
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={handleSync}
            className="h-6 px-2 text-[10px] text-white hover:bg-white/20 uppercase font-black ml-1 rounded-full"
          >
            Sincronizar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
