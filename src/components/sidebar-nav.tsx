"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Package,
  Wrench,
  ShoppingCart,
  BarChart2,
  User,
  ShieldCheck,
  Lock,
  Download,
  Receipt,
  TrendingUp,
  HandCoins
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter
} from '@/components/ui/sidebar';
import { AppLogo } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useFirebase } from '@/firebase';
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
  const { firestore, user, auth } = useFirebase();
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
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard/pos" scroll={false} className="flex items-center gap-2">
            <AppLogo className="w-8 h-8 text-sidebar-primary" />
            <span className={cn(
                "text-lg font-semibold text-sidebar-foreground",
                "group-data-[collapsible=icon]:hidden"
            )}>
                POS Mariche
            </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
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
      <SidebarFooter className='mt-auto p-4 space-y-2'>
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
                <SidebarMenuButton asChild tooltip={{children: 'Mi Perfil'}} isActive={pathname === '/dashboard/settings'}>
                    <Link href="/dashboard/settings" scroll={false}>
                        <User />
                        <span className="truncate">{profile?.email || user?.email || 'Mi Cuenta'}</span>
                    </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
