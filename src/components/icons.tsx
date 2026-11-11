import type { ImgHTMLAttributes, SVGProps } from "react";
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
      alt="COBRANZA ONLINE"
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
  /** Nombre visible; por defecto en mayusculas. */
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
  label = "COBRANZA ONLINE",
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
          {label}
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
