"use client";

import { useId, type ImgHTMLAttributes, type SVGProps } from "react";
import { cn } from "@/lib/utils";

type AppLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">;

/**
 * Marca de la app: se usa `public/logo.png` tal cual (sin recortes).
 * Los iconos derivados (favicon, PWA, iOS) se generan con
 * `scripts/generate-brand-assets.py`.
 */
export function AppLogo({ className, ...props }: AppLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- asset local, sin optimizacion necesaria
    <img
      src="/logo.png"
      alt="Cobranza Online"
      width={512}
      height={512}
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
      {...props}
    />
  );
}

type BrandLockupProps = {
  size?: "sm" | "md" | "lg";
  orientation?: "horizontal" | "vertical";
  showTagline?: boolean;
  className?: string;
  textClassName?: string;
  /** Nombre visible */
  label?: string;
};

const SIZES = {
  sm: { icon: "w-8 h-8", text: "text-base" },
  md: { icon: "w-10 h-10", text: "text-xl" },
  lg: { icon: "w-16 h-16", text: "text-3xl" },
} as const;

export function BrandLockup({
  size = "md",
  orientation = "horizontal",
  showTagline = false,
  className,
  textClassName,
  label = "Cobranza Online",
}: BrandLockupProps) {
  const s = SIZES[size];
  const vertical = orientation === "vertical";

  return (
    <div
      className={cn(
        "flex",
        vertical ? "flex-col items-center gap-3 text-center" : "items-center gap-2.5",
        className,
      )}
    >
      <AppLogo className={s.icon} />
      <div className="group-data-[collapsible=icon]:hidden">
        <span
          className={cn(
            "block whitespace-nowrap font-semibold leading-none tracking-tight",
            s.text,
            textClassName,
          )}
        >
          {label}
        </span>
        {showTagline && (
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Gestión de negocio
          </p>
        )}
      </div>
    </div>
  );
}

/** Avatar de cuenta 2026: círculo con degradado azul/índigo de la app y silueta blanca refinada. */
export function UserAvatarIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `avatar-bg-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="Cuenta"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="50%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
      </defs>

      <circle cx="20" cy="20" r="20" fill={`url(#${gradientId})`} />
      <circle cx="20" cy="14" r="5.5" fill="#FFFFFF" />
      <path
        d="M9.5 33C9.5 27.5 14 23 20 23C26 23 30.5 27.5 30.5 33C30.5 34.2 29.8 35.3 28.8 35.8C26.2 37.2 23.2 38 20 38C16.8 38 13.8 37.2 11.2 35.8C10.2 35.3 9.5 34.2 9.5 33Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
