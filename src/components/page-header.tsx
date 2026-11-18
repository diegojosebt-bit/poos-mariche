"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /** Título completo (desktop). En móvil se recorta con puntos suspensivos. */
  title: string;
  /** Título corto alternativo para pantallas pequeñas. */
  shortTitle?: string;
  /** Acciones de la derecha. Se mantienen compactas y sin scroll horizontal. */
  children?: ReactNode;
};

/**
 * Cabecera de página.
 *
 * En móvil no incluye botón de menú: la navegación vive en la barra inferior
 * (Vender · Inventario · Reparar · Reportes · Más), así el título y las
 * acciones tienen todo el ancho disponible.
 */
export function PageHeader({ title, shortTitle, children }: PageHeaderProps) {
  return (
    <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md text-slate-900">
      <div className="flex h-14 min-w-0 items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg md:text-xl">
          {shortTitle ? (
            <>
              <span className="sm:hidden">{shortTitle}</span>
              <span className="hidden sm:inline">{title}</span>
            </>
          ) : (
            title
          )}
        </h1>

        {children ? (
          <div className={cn("flex shrink-0 items-center gap-1.5 sm:gap-2")}>{children}</div>
        ) : null}
      </div>
    </header>
  );
}
