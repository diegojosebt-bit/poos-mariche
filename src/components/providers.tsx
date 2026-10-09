"use client";

import React, { useState, useEffect } from 'react';
import { SWRConfig } from 'swr';
import { FirebaseClientProvider, useFirebase } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { Toaster } from '@/components/ui/toaster';

function AppContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useFirebase();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isUserLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <p className="text-sm text-muted-foreground animate-pulse font-medium uppercase tracking-widest">
            Sincronizando...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  return <>{children}</>;
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
      </FirebaseClientProvider>
    </SWRConfig>
  );
}
