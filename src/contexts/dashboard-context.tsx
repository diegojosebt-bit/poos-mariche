"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { AppSettings, UserProfile } from '@/lib/types';

/**
 * DashboardContext - Almacén de Memoria Global (RAM Cache)
 * Blindaje de Infraestructura: Evita lecturas redundantes a Firestore.
 */

type DashboardContextType = {
  dataCache: Record<string, any[] | null>;
  setCachedData: (key: string, data: any[] | null) => void;
  updateCachedItem: (id: string, partialData: any) => void;
  removeCachedItem: (id: string) => void;
  addItemToCache: (collectionPathPart: string, item: any) => void;
  
  // Blindaje Financiero: Un solo estado de settings para toda la App
  settings: AppSettings | null;
  setSettings: (settings: AppSettings | null) => void;

  // Blindaje de Perfil: Un solo listener para evitar lecturas de perfil duplicadas
  profile: UserProfile | null;
  setProfile: (profile: UserProfile | null) => void;

  // Gestión de Seguridad PIN (Modo Gerente)
  isSecurityUnlocked: boolean;
  unlockSecurity: () => void;
  lockSecurity: () => void;
};

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [dataCache, setDataCache] = useState<Record<string, any[] | null>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isSecurityUnlocked, setIsSecurityUnlocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('mm_security_unlocked') === 'true';
    }
    return false;
  });

  const unlockSecurity = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('mm_security_unlocked', 'true');
    }
    setIsSecurityUnlocked(true);
  }, []);

  const lockSecurity = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('mm_security_unlocked');
    }
    setIsSecurityUnlocked(false);
  }, []);

  const setCachedData = useCallback((key: string, data: any[] | null) => {
    setDataCache(prev => {
      if (prev[key] === data) return prev;
      return { ...prev, [key]: data };
    });
  }, []);

  const addItemToCache = useCallback((collectionPathPart: string, item: any) => {
    setDataCache(prev => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach(key => {
        if (key.includes(collectionPathPart)) {
          const list = nextCache[key];
          if (Array.isArray(list)) {
            if (!list.find(existing => existing.id === item.id)) {
              nextCache[key] = [item, ...list];
              hasChanged = true;
            }
          }
        }
      });

      return hasChanged ? nextCache : prev;
    });
  }, []);

  const updateCachedItem = useCallback((id: string, partialData: any) => {
    setDataCache(prev => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach(key => {
        const list = nextCache[key];
        if (Array.isArray(list)) {
          const index = list.findIndex(item => item.id === id);
          if (index !== -1) {
            const newList = [...list];
            newList[index] = { ...newList[index], ...partialData };
            nextCache[key] = newList;
            hasChanged = true;
          }
        }
      });

      return hasChanged ? nextCache : prev;
    });
  }, []);

  const removeCachedItem = useCallback((id: string) => {
    setDataCache(prev => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach(key => {
        const list = nextCache[key];
        if (Array.isArray(list)) {
          const newList = list.filter(item => item.id !== id);
          if (newList.length !== list.length) {
            nextCache[key] = newList;
            hasChanged = true;
          }
        }
      });

      return hasChanged ? nextCache : prev;
    });
  }, []);

  return (
    <DashboardContext.Provider value={{ 
      dataCache, 
      setCachedData, 
      updateCachedItem, 
      removeCachedItem, 
      addItemToCache,
      settings,
      setSettings,
      profile,
      setProfile,
      isSecurityUnlocked,
      unlockSecurity,
      lockSecurity
    }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardStore() {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboardStore must be used within a DashboardProvider');
  }
  return context;
}
