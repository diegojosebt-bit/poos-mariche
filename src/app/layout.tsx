import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import { cn } from '@/lib/utils';
import './globals.css';

export const metadata: Metadata = {
  title: 'MARICHE POS - Gestión de Negocio',
  description: 'Sistema de gestión integral para ventas, inventario, caja, reparaciones y reportes de transacciones.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MARICHE POS',
  },
  openGraph: {
    title: 'MARICHE POS - Gestión de Negocio',
    description: 'Sistema de gestión integral para ventas, inventario, caja, reparaciones y reportes de transacciones.',
  },
};

export const viewport: Viewport = {
  themeColor: '#2532c2',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={cn("font-sans antialiased", process.env.NODE_ENV === 'development' ? 'debug-screens' : '')}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}

