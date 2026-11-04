
"use client";

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';

const SESSION_STORAGE_KEY = 'app_unlocked';

interface AppLockContextType {
  isLocked: boolean;
  unlockApp: (password: string) => boolean;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const { firestore, user } = useFirebase();

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  useEffect(() => {
    // Only lock if profile explicitly requires PIN and a PIN is set
    if (profile?.isPinRequired && profile?.securityPin) {
      try {
        const isUnlockedInSession = sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
        if (!isUnlockedInSession) {
          setIsLocked(true);
        }
      } catch (error) {
        console.error("Could not access session storage:", error);
      }
    } else {
      setIsLocked(false);
    }
  }, [profile?.isPinRequired, profile?.securityPin]);

  const unlockApp = useCallback((password: string): boolean => {
    if (!profile?.securityPin) {
      setIsLocked(false);
      return true;
    }

    if (password === profile.securityPin) {
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
