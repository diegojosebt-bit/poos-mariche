import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export function AppLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      role="img"
      aria-label="MARICHE POS"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id="logoAwningGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a5b4fc" />
        </linearGradient>
      </defs>

      {/* Base azul de la tienda */}
      <rect x="28" y="56" width="200" height="180" rx="32" fill="#2532c2" />

      {/* Toldo ondulado */}
      <g>
        <rect x="28" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="78" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="128" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="178" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="28" y="24" width="200" height="40" fill="url(#logoAwningGrad)" />
      </g>

      {/* Paneles frontales */}
      <rect x="60" y="145" width="60" height="75" rx="12" fill="#c7d2fe" />
      <rect x="136" y="145" width="60" height="50" rx="12" fill="#ffffff" />
    </svg>
  );
}

type BrandLockupProps = {
  size?: "sm" | "md" | "lg";
  orientation?: "horizontal" | "vertical";
  showTagline?: boolean;
  className?: string;
  textClassName?: string;
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
            "block whitespace-nowrap font-black uppercase leading-none tracking-[-0.03em]",
            s.text,
            textClassName,
          )}
        >
          MARICHE POS
        </span>
        {showTagline && (
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
            Gestión de negocio
          </p>
        )}
      </div>
    </div>
  );
}

/** Avatar circular: aro y cabeza oscuros, hombros azules. */
export function UserAvatarIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      role="img"
      aria-label="Cuenta"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <clipPath id="userAvatarClip">
          <circle cx="32" cy="32" r="28" />
        </clipPath>
      </defs>

      <circle cx="32" cy="32" r="28" fill="#ffffff" />

      <g clipPath="url(#userAvatarClip)">
        <path
          d="M10 54 C13 39 21 33 32 33 C43 33 51 39 54 54 Z"
          fill="#2563EB"
        />
      </g>

      <circle cx="32" cy="24" r="9.5" fill="#334155" />
      <circle cx="32" cy="32" r="28" fill="none" stroke="#334155" strokeWidth="3" />
    </svg>
  );
}
