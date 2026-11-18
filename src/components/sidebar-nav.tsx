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
import { canOperatorAccessModule, hasCashierSystemActive } from '@/lib/cashiers';
import type { UserModule } from '@/lib/types';
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
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();

  // En movil el panel es una hoja: al elegir un modulo se cierra sola.
  const closeMobileNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  const {
    profile,
    activeOperator,
    isSecurityUnlocked,
    lockSecurity,
  } = useDashboardStore();
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

  const cashierMode = hasCashierSystemActive(profile);
  const isOwnerOperator = !activeOperator || activeOperator.isOwner;
  const isAdmin = !!profile?.isAdmin && isOwnerOperator;
  
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
      if (!enabledModules.includes(item.module)) return false;
      if (cashierMode) {
        return canOperatorAccessModule(activeOperator, item.module);
      }
      return true;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex h-16 shrink-0 flex-row items-center border-b border-blue-900/30 px-4 py-0 group-data-[collapsible=icon]:px-2">
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
      <SidebarContent className="mt-1 px-3 py-3 transition-[padding] duration-200 ease-out group-data-[collapsible=icon]:px-2">
        <SidebarMenu className="gap-1.5">
          {filteredNavItems.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={{ children: item.label }}
                  className={cn(
                    "h-10 rounded-xl px-3 transition-all font-medium",
                    active
                      ? "!bg-gradient-to-r !from-blue-600 !via-blue-500 !to-indigo-600 !text-white !shadow-md !shadow-blue-600/30 font-semibold hover:!from-blue-500 hover:!to-indigo-500 hover:!text-white"
                      : "text-slate-300 hover:bg-white/[0.08] hover:text-white"
                  )}
                >
                  <Link href={item.href} scroll={false} onClick={closeMobileNav}>
                    <item.icon className={cn("transition-colors", active ? "text-white" : "text-slate-400 group-hover:text-blue-400")} />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}

          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/dashboard/admin')}
                tooltip={{ children: 'Administración' }}
                className={cn(
                  "h-10 rounded-xl px-3 transition-all font-medium",
                  pathname.startsWith('/dashboard/admin')
                    ? "!bg-gradient-to-r !from-blue-600 !via-blue-500 !to-indigo-600 !text-white !shadow-md !shadow-blue-600/30 font-semibold"
                    : "text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                )}
              >
                <Link href="/dashboard/admin" scroll={false} onClick={closeMobileNav}>
                  <ShieldCheck className={cn(pathname.startsWith('/dashboard/admin') ? "text-white" : "text-emerald-400")} />
                  <span>Administración</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className='mt-auto p-3.5 group-data-[collapsible=icon]:p-2 space-y-2'>
        <Separator className="my-1 bg-slate-800/80"/>

        {!cashierMode && profile?.isPinRequired === true && isSecurityUnlocked && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={handleLockManager}
                tooltip={{ children: 'Bloquear Modo Gerente' }}
                className="bg-red-500/10 text-red-400 hover:bg-red-600 hover:text-white font-semibold transition-all border border-red-500/20 h-10 px-3 rounded-xl"
              >
                <Lock className="w-4 h-4 shrink-0 text-red-400 group-hover:text-white" />
                <span className="truncate group-data-[collapsible=icon]:hidden">Bloquear Modo Gerente</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}

        {(!cashierMode || isOwnerOperator) && (
          <SidebarMenu>
              <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    tooltip={{children: 'Configuración'}} 
                    isActive={pathname === '/dashboard/settings'}
                    className={cn(
                      "h-10 rounded-xl px-3 transition-all font-medium",
                      pathname === '/dashboard/settings'
                        ? "!bg-gradient-to-r !from-blue-600 !via-blue-500 !to-indigo-600 !text-white !shadow-md !shadow-blue-600/30 font-semibold hover:!text-white"
                        : "text-slate-300 hover:bg-white/[0.08] hover:text-white"
                    )}
                  >
                      <Link href="/dashboard/settings" scroll={false} onClick={closeMobileNav}>
                          <Settings className={cn(pathname === '/dashboard/settings' ? "text-white" : "text-slate-400 group-hover:text-blue-400")} />
                          <span className="truncate group-data-[collapsible=icon]:hidden">Configuración</span>
                      </Link>
                  </SidebarMenuButton>
              </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
