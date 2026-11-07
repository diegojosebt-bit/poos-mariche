"use client";

export function SplashScreen({ exiting = false }: { exiting?: boolean }) {
  return (
    <div
      className={`mm-splash-shell fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-[#070B1A]${exiting ? " is-exiting" : ""}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(43,58,224,0.35),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/40 to-transparent" />

      <div className="relative flex flex-col items-center px-6">
        <svg
          viewBox="0 0 160 100"
          className="w-36 sm:w-44"
          role="img"
          aria-label="MARICHE POS"
          shapeRendering="geometricPrecision"
        >
          <g transform="translate(80 50) skewX(-10) translate(-80 -50)">
            {/* M geométrica inclinada */}
            <path
              pathLength={100}
              d="M25 78 V28 L60 64 L95 28 V78"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mm-splash-stroke mm-splash-m"
            />
            {/* P: comparte el palo derecho de la M */}
            <path
              pathLength={100}
              d="M95 28 H120 C138 28 138 56 120 56 H95"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mm-splash-stroke mm-splash-p"
            />
          </g>
        </svg>

        <div className="mm-splash-word mt-6 text-center">
          <p className="text-lg font-black uppercase tracking-[0.22em] text-white">
            MARICHE POS
          </p>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.35em] text-white/45">
            Gestión de negocio
          </p>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        Cargando MARICHE POS
      </span>
    </div>
  );
}
