"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Package,
  Wrench,
  ShoppingCart,
  BarChart2,
  Settings,
  ShieldCheck,
  Lock,
  Download,
  Receipt,
  TrendingUp,
  HandCoins,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar
} from '@/components/ui/sidebar';
import { BrandLockup } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useDashboardStore } from '@/contexts/dashboard-context';
import type { UserProfile, UserModule } from '@/lib/types';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

type NavItem = {
    href: string;
    icon: any;
    label: string;
    module?: UserModule;
};

const navItems: NavItem[] = [
  { href: '/dashboard/pos', icon: ShoppingCart, label: 'Punto de Venta', module: 'pos' },
  { href: '/dashboard/inventory', icon: Package, label: 'Inventario', module: 'inventory' },
  { href: '/dashboard/repairs', icon: Wrench, label: 'Reparaciones', module: 'repairs' },
  { href: '/dashboard/expenses', icon: Receipt, label: 'Gastos / Egresos', module: 'expenses' },
  { href: '/dashboard/fiados', icon: HandCoins, label: 'Fiados / Créditos', module: 'fiados' },
  { href: '/dashboard/reports', icon: BarChart2, label: 'Reportes', module: 'reports' },
  { href: '/dashboard/analysis', icon: TrendingUp, label: 'Análisis de Negocio', module: 'analysis' },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { state, toggleSidebar } = useSidebar();
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: any) => {
        event.preventDefault();
        setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const { profile, isSecurityUnlocked, lockSecurity } = useDashboardStore();
  const router = useRouter();
  const { toast } = useToast();

  // Precarga los payloads de las rutas mientras hay internet. Así, al pasar
  // offline, cambiar de módulo no espera una petición RSC de Next.
  useEffect(() => {
    const prefetchRoutes = () => {
      if (typeof navigator === 'undefined' || !navigator.onLine) return;
      navItems.forEach((item) => router.prefetch(item.href));
      router.prefetch('/dashboard/settings');
    };

    prefetchRoutes();
    window.addEventListener('online', prefetchRoutes);
    return () => window.removeEventListener('online', prefetchRoutes);
  }, [router]);

  const isAdmin = !!profile?.isAdmin;
  
  const handleLockManager = () => {
    lockSecurity();

    // Si la ruta actual es una zona protegida, redirigir inmediatamente al POS
    const protectedRoutes = ['/dashboard/settings', '/dashboard/admin'];
    const activeLockedModules = profile?.lockedModules || [];
    const isCurrentRouteLocked = 
      protectedRoutes.some(route => pathname.startsWith(route)) ||
      activeLockedModules.some(mod => pathname.startsWith(`/dashboard/${mod}`));

    if (isCurrentRouteLocked) {
      router.push('/dashboard/pos');
    }

    toast({
      title: "Modo Administrador Bloqueado",
      description: "Modo Administrador bloqueado exitosamente.",
    });
  };
  
  const filteredNavItems = navItems.filter(item => {
      if (!item.module) return true;
      if (!profile) return false;
      const enabledModules = profile.enabledModules || [];
      return enabledModules.includes(item.module);
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex h-16 shrink-0 flex-row items-center border-b border-sidebar-border/60 px-3 py-0 group-data-[collapsible=icon]:px-2">
        <div className="flex h-full w-full items-center justify-between gap-2 group-data-[collapsible=icon]:gap-0">
          <Link
            href="/dashboard/pos"
            scroll={false}
            className="flex min-w-0 items-center gap-2 overflow-hidden opacity-100 transition-[width,opacity] duration-200 ease-out group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0"
          >
              <BrandLockup size="sm" className="text-sidebar-foreground" />
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            title={state === 'collapsed' ? 'Mostrar menú' : 'Ocultar menú'}
            aria-label={state === 'collapsed' ? 'Mostrar menú' : 'Ocultar menú'}
            className="h-8 w-8 shrink-0 p-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:mx-auto"
          >
            {state === 'collapsed'
              ? <PanelLeftOpen className="h-4 w-4" />
              : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent className="mt-2 transition-[padding] duration-200 ease-out group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          {filteredNavItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))}
                tooltip={{ children: item.label }}
              >
                <Link href={item.href} scroll={false}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/dashboard/admin')}
                tooltip={{ children: 'Administración' }}
                className="text-amber-500 hover:text-amber-600"
              >
                <Link href="/dashboard/admin" scroll={false}>
                  <ShieldCheck />
                  <span>Administración</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className='mt-auto p-3 group-data-[collapsible=icon]:p-2 space-y-2'>
        <Separator className="my-1 bg-sidebar-border/50"/>
        
        {profile?.isPinRequired === true && isSecurityUnlocked && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={handleLockManager}
                tooltip={{ children: 'Bloquear Modo Gerente' }}
                className="bg-red-500/10 text-red-600 hover:bg-red-600 hover:text-white font-bold transition-all border border-red-500/20 h-9"
              >
                <Lock className="w-4 h-4 shrink-0 text-red-600 group-hover:text-white" />
                <span className="truncate group-data-[collapsible=icon]:hidden">Bloquear Modo Gerente</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}

        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={{children: 'Configuración'}} isActive={pathname === '/dashboard/settings'}>
                    <Link href="/dashboard/settings" scroll={false}>
                        <Settings />
                        <span className="truncate group-data-[collapsible=icon]:hidden">Configuración</span>
                    </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
