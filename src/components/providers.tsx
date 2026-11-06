"use client";

import React, { useState, useEffect } from 'react';
import { SWRConfig } from 'swr';
import { FirebaseClientProvider, useFirebase } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { Toaster } from '@/components/ui/toaster';
import { ReadMeterPill } from '@/components/debug/read-meter-pill';
import { SplashScreen } from '@/components/splash-screen';

function AppContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useFirebase();
  const [mounted, setMounted] = useState(false);
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [hideSplash, setHideSplash] = useState(false);

  useEffect(() => {
    setMounted(true);
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setMinSplashDone(true), reduced ? 450 : 2300);
    return () => clearTimeout(timer);
  }, []);

  const appReady = mounted && !isUserLoading;

  useEffect(() => {
    if (!appReady || !minSplashDone) return;
    const timer = setTimeout(() => setHideSplash(true), 400);
    return () => clearTimeout(timer);
  }, [appReady, minSplashDone]);

  return (
    <>
      {appReady ? (user ? <>{children}</> : <AuthView />) : null}
      {!hideSplash && <SplashScreen exiting={appReady && minSplashDone} />}
    </>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false,
        dedupingInterval: 600000,
      }}
    >
      <FirebaseClientProvider>
        <AppContent>{children}</AppContent>
        <Toaster />
        <ReadMeterPill />
      </FirebaseClientProvider>
    </SWRConfig>
  );
}
