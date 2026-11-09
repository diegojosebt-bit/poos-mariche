import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import { cn } from '@/lib/utils';
import './globals.css';

export const metadata: Metadata = {
  title: 'MARICHE POS - Gestión de Negocio',
  description: 'Sistema de gestión integral para ventas, inventario, caja, reparaciones y reportes de transacciones.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: '/favicon.ico',
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
  themeColor: '#093751',
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

