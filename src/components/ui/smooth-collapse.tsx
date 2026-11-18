"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SmoothCollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** En contenedores con `space-y-*`, colapsa también el margen superior al cerrarse (default: true). */
  collapseMargin?: boolean;
}

/**
 * Transición fluida de apertura/cierre usando CSS Grid (`grid-rows-[0fr]` ↔ `grid-rows-[1fr]`)
 * combinada con opacidad y margen en 200ms ease-out. Evita saltos bruscos de layout.
 */
export function SmoothCollapse({
  open,
  children,
  className,
  innerClassName,
  collapseMargin = true,
}: SmoothCollapseProps) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "grid-rows-[1fr] opacity-100"
          : cn(
              "grid-rows-[0fr] opacity-0 pointer-events-none",
              collapseMargin && "!mt-0"
            ),
        className
      )}
    >
      <div className={cn("overflow-hidden min-h-0", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
