"use client";

export function SplashScreen({ exiting = false }: { exiting?: boolean }) {
  return (
    <div
      className={`mm-splash-shell fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-[#070B1A]${exiting ? " is-exiting" : ""}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(11,97,193,0.45),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/40 to-transparent" />

      <div className="relative flex flex-col items-center px-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
        <img
          src="/logo.png"
          alt=""
          width={512}
          height={512}
          className="mm-splash-logo w-28 sm:w-32"
          draggable={false}
        />

        <div className="mm-splash-word mt-6 text-center">
          <p className="text-lg font-black uppercase tracking-[0.22em] text-white">
            COBRANZA ONLINE
          </p>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.35em] text-white/45">
            Gestión de negocio
          </p>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        Cargando COBRANZA ONLINE
      </span>
    </div>
  );
}
