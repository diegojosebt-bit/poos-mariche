
"use client";

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';
import { verifyPin } from '@/lib/security';

const SESSION_STORAGE_KEY = 'app_unlocked';

interface AppLockContextType {
  isLocked: boolean;
  unlockApp: (password: string) => Promise<boolean>;
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

  const unlockApp = useCallback(async (password: string): Promise<boolean> => {
    if (!profile?.securityPin) {
      setIsLocked(false);
      return true;
    }

    const isValid = await verifyPin(password, profile.securityPin, profile.uid || "mm_default");
    if (isValid) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
      } catch (error) {
         console.error("Could not access session storage:", error);
      }
      setIsLocked(false);
      return true;
    }
    return false;
  }, [profile?.securityPin, profile?.uid]);

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
