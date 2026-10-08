"use client";

import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { FirebaseClientProvider, useFirebase } from '@/firebase';
import { AuthView } from '@/components/auth-view';
import { SWRConfig } from 'swr';
import './globals.css';

/**
 * RootLayout simplificado. 
 * La lógica de vigilancia de sesión se ha movido al DashboardLayout
 * para evitar interferencias durante el proceso de inicio de sesión.
 */
function AppContent({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useFirebase();

  if (isUserLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <p className="text-sm text-muted-foreground animate-pulse font-medium uppercase tracking-widest">Sincronizando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  return <>{children}</>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#2532c2" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <title>POS MARICHE - Gestión de Negocio</title>
      </head>
      <body className={cn("font-sans antialiased", process.env.NODE_ENV === 'development' ? 'debug-screens' : '')}>
        <SWRConfig 
          value={{
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            revalidateIfStale: false,
            dedupingInterval: 600000,
          }}
        >
          <FirebaseClientProvider>
            <AppContent>
              {children}
            </AppContent>
            <Toaster />
          </FirebaseClientProvider>
        </SWRConfig>
      </body>
    </html>
  );
}
