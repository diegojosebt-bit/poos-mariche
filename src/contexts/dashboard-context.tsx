"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ActiveOperator, AppSettings, UserProfile } from '@/lib/types';
import {
  OWNER_OPERATOR_ID,
  buildCashierOperator,
  buildOwnerOperator,
  hasCashierSystemActive,
} from '@/lib/cashiers';

const ACTIVE_OPERATOR_KEY = 'mm_active_operator_id';
const REGISTER_NAME_KEY = 'mm_register_name';

/**
 * DashboardContext - Almacén de Memoria Global (RAM Cache) + Operador Activo
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

  // Operador activo en esta caja (Dueño o Cajero seleccionado con PIN)
  activeOperator: ActiveOperator | null;
  selectOperator: (operator: ActiveOperator) => void;
  clearActiveOperator: () => void;
  isOperatorPromptOpen: boolean;
  setIsOperatorPromptOpen: (open: boolean) => void;
  registerName: string;
  setRegisterName: (name: string) => void;

  // Gestión de Seguridad PIN (compatibilidad Modo Gerente)
  isSecurityUnlocked: boolean;
  unlockSecurity: () => void;
  lockSecurity: () => void;

  // Slots de barra superior unificada (para acciones contextuales como POS)
  desktopTopBarHost: HTMLDivElement | null;
  setDesktopTopBarHost: (el: HTMLDivElement | null) => void;
  mobileTopBarHost: HTMLDivElement | null;
  setMobileTopBarHost: (el: HTMLDivElement | null) => void;
};

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [dataCache, setDataCache] = useState<Record<string, any[] | null>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeOperator, setActiveOperator] = useState<ActiveOperator | null>(null);
  const [isOperatorPromptOpen, setIsOperatorPromptOpen] = useState(false);
  const [registerName, setRegisterNameState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(REGISTER_NAME_KEY) || 'Caja Principal';
    }
    return 'Caja Principal';
  });
  const [desktopTopBarHost, setDesktopTopBarHost] = useState<HTMLDivElement | null>(null);
  const [mobileTopBarHost, setMobileTopBarHost] = useState<HTMLDivElement | null>(null);
  const [isSecurityUnlocked, setIsSecurityUnlocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('mm_security_unlocked') === 'true';
    }
    return false;
  });

  const setRegisterName = useCallback((name: string) => {
    const clean = name.trim() || 'Caja Principal';
    setRegisterNameState(clean);
    if (typeof window !== 'undefined') {
      localStorage.setItem(REGISTER_NAME_KEY, clean);
    }
  }, []);

  const selectOperator = useCallback((operator: ActiveOperator) => {
    setActiveOperator(operator);
    setIsOperatorPromptOpen(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(ACTIVE_OPERATOR_KEY, operator.id);
      if (operator.isOwner) {
        sessionStorage.setItem('mm_security_unlocked', 'true');
      } else {
        sessionStorage.removeItem('mm_security_unlocked');
      }
    }
    setIsSecurityUnlocked(operator.isOwner);
  }, []);

  const clearActiveOperator = useCallback(() => {
    setActiveOperator(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(ACTIVE_OPERATOR_KEY);
      sessionStorage.removeItem('mm_security_unlocked');
    }
    setIsSecurityUnlocked(false);
  }, []);

  // Sincroniza operador activo en tiempo real cuando llega o cambia `profile`
  useEffect(() => {
    if (!profile) return;

    // Sin cajeros activos: el dueño opera directamente sin pantalla intermedia.
    if (!hasCashierSystemActive(profile)) {
      const owner = buildOwnerOperator(profile);
      setActiveOperator((prev) =>
        prev && prev.isOwner && prev.name === owner.name ? prev : owner
      );
      return;
    }

    const storedId =
      typeof window !== 'undefined' ? sessionStorage.getItem(ACTIVE_OPERATOR_KEY) : null;

    if (!storedId) {
      setActiveOperator(null);
      return;
    }

    if (storedId === OWNER_OPERATOR_ID) {
      const owner = buildOwnerOperator(profile);
      setActiveOperator((prev) =>
        prev && prev.isOwner && prev.name === owner.name ? prev : owner
      );
      setIsSecurityUnlocked(true);
      return;
    }

    // Buscar cajero activo y refrescar sus permisos en vivo
    const matched = (profile.cashiers || []).find((c) => c.id === storedId && c.active);
    if (matched) {
      setActiveOperator(buildCashierOperator(matched));
      setIsSecurityUnlocked(false);
    } else {
      // El cajero fue pausado o eliminado: pedir nuevo operador inmediatamente
      clearActiveOperator();
    }
  }, [profile, clearActiveOperator]);

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
    setDataCache((prev) => {
      if (prev[key] === data) return prev;
      return { ...prev, [key]: data };
    });
  }, []);

  const addItemToCache = useCallback((collectionPathPart: string, item: any) => {
    setDataCache((prev) => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach((key) => {
        if (key.includes(collectionPathPart)) {
          const list = nextCache[key];
          if (Array.isArray(list)) {
            if (!list.find((existing) => existing.id === item.id)) {
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
    setDataCache((prev) => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach((key) => {
        const list = nextCache[key];
        if (Array.isArray(list)) {
          const index = list.findIndex((item) => item.id === id);
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
    setDataCache((prev) => {
      const nextCache = { ...prev };
      let hasChanged = false;

      Object.keys(nextCache).forEach((key) => {
        const list = nextCache[key];
        if (Array.isArray(list)) {
          const newList = list.filter((item) => item.id !== id);
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
    <DashboardContext.Provider
      value={{
        dataCache,
        setCachedData,
        updateCachedItem,
        removeCachedItem,
        addItemToCache,
        settings,
        setSettings,
        profile,
        setProfile,
        activeOperator,
        selectOperator,
        clearActiveOperator,
        isOperatorPromptOpen,
        setIsOperatorPromptOpen,
        registerName,
        setRegisterName,
        isSecurityUnlocked,
        unlockSecurity,
        lockSecurity,
        desktopTopBarHost,
        setDesktopTopBarHost,
        mobileTopBarHost,
        setMobileTopBarHost,
      }}
    >
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
