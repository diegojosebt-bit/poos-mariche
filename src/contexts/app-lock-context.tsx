
"use client";

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';

const FALLBACK_PIN = "2026";
const SESSION_STORAGE_KEY = 'app_unlocked';

interface AppLockContextType {
  isLocked: boolean;
  unlockApp: (password: string) => boolean;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(true);
  const { firestore, user } = useFirebase();

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  useEffect(() => {
    // Check session storage on initial client-side load
    try {
      const isUnlockedInSession = sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
      if (isUnlockedInSession) {
        setIsLocked(false);
      }
    } catch (error) {
      console.error("Could not access session storage:", error);
    }
  }, []);

  const unlockApp = useCallback((password: string): boolean => {
    const requiredPin = profile?.securityPin || FALLBACK_PIN;

    if (password === requiredPin) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
      } catch (error) {
         console.error("Could not access session storage:", error);
      }
      setIsLocked(false);
      return true;
    }
    return false;
  }, [profile?.securityPin]);

  const value = { isLocked, unlockApp };

  return (
    <AppLockContext.Provider value={value}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const context = useContext(AppLockContext);
  if (context === undefined) {
    throw new Error('useAppLock must be used within an AppLockProvider');
  }
  return context;
}
