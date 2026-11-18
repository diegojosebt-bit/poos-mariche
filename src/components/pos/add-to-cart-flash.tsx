"use client";

import { Check } from "lucide-react";

/**
 * Confirmación de "añadido al carrito".
 *
 * Píldora flotante que entra con un rebote corto y desaparece sola en 1,5 s.
 * Sin modal, sin bloquear el toque y sin mover el layout.
 */
export function AddToCartFlash({
  name,
  quantity,
  flashKey,
}: {
  name: string;
  quantity: number;
  /** Cambia en cada añadido para reiniciar la animación. */
  flashKey: number;
}) {
  return (
    <div
      key={flashKey}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 md:hidden"
    >
      <div className="mm-flash flex items-center gap-2 rounded-full bg-emerald-600 py-1.5 pl-1.5 pr-3 text-white shadow-lg shadow-emerald-900/25 ring-1 ring-white/25 backdrop-blur-sm">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
          <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
        </span>
        <span className="max-w-[170px] truncate text-xs font-bold">{name}</span>
        <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-black tabular-nums">×{quantity}</span>
      </div>
    </div>
  );
}
