"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart2, Menu, Package, ShoppingCart, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useSidebar } from "@/components/ui/sidebar";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { canOperatorAccessModule, hasCashierSystemActive } from "@/lib/cashiers";
import type { UserModule } from "@/lib/types";
import { cn } from "@/lib/utils";

type MobileNavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  module: UserModule;
};

/**
 * Accesos rápidos del mostrador. El resto de módulos (gastos, fiados,
 * análisis, configuración y administración) siguen viviendo en el menú
 * lateral, que se abre desde "Más".
 *
 * Sólo es presentación: no crea rutas ni consultas nuevas.
 */
const ITEMS: MobileNavItem[] = [
  { href: "/dashboard/pos", icon: ShoppingCart, label: "Vender", module: "pos" },
  { href: "/dashboard/inventory", icon: Package, label: "Inventario", module: "inventory" },
  { href: "/dashboard/repairs", icon: Wrench, label: "Reparar", module: "repairs" },
  { href: "/dashboard/reports", icon: BarChart2, label: "Reportes", module: "reports" },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { setOpenMobile, openMobile } = useSidebar();
  const { profile, activeOperator } = useDashboardStore();
  const cashierMode = hasCashierSystemActive(profile);

  const items = ITEMS.filter((item) => {
    if (!profile) return false;
    if (!(profile.enabledModules || []).includes(item.module)) return false;
    if (cashierMode) return canOperatorAccessModule(activeOperator, item.module);
    return true;
  });

  // Sin módulos habilitados no hay nada que mostrar.
  if (items.length === 0) return null;

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Navegación principal"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-blue-900/30 bg-gradient-to-r from-[#0A1329] via-[#0E1E3D] to-[#0A1329] shadow-[0_-4px_25px_rgba(0,0,0,0.5)] md:hidden text-white"
    >
      <ul className="flex items-stretch py-2.5">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors active:bg-white/[0.05]",
                  active ? "text-white" : "text-slate-400 hover:text-white"
                )}
              >
                <div className="relative">
                  <Icon className={cn("h-5 w-5 transition-transform duration-150", active ? "text-white scale-105" : "text-slate-400")} aria-hidden />
                </div>
                <span className={cn("truncate leading-none text-[11px]", active ? "text-white font-medium" : "text-slate-400 font-normal")}>{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={() => setOpenMobile(!openMobile)}
            aria-expanded={openMobile}
            aria-label="Abrir el menú de módulos"
            className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-xs font-semibold text-slate-400 hover:text-white transition-colors active:bg-white/[0.05]"
          >
            <Menu className="h-5 w-5 text-slate-400" aria-hidden />
            <span className="leading-none text-[11px]">Más</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
