"use client";

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

type ToastFn = (options: {
  variant?: "default" | "destructive";
  title: string;
  description?: string;
}) => void;

/**
 * Devuelve true si se puede continuar. Si no hay internet, avisa y devuelve false.
 * Se usa antes de transacciones, exportaciones y acciones que exigen servidor.
 */
export function ensureOnline(toast: ToastFn, action: string): boolean {
  if (!isOffline()) return true;

  toast({
    variant: "destructive",
    title: "Sin conexión",
    description: `${action} necesita conexión a internet.`,
  });
  return false;
}
