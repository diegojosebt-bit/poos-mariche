"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function getChunkReloadUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  return url.toString();
}

export function ChunkErrorFallback({
  error,
  reset,
}: {
  error?: Error & { digest?: string };
  reset?: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  const message = String(error?.message || "");
  const isChunkError = /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch/i.test(message);

  useEffect(() => {
    if (!isChunkError) return;
    const key = "mm_chunk_reload_once";
    if (sessionStorage.getItem(key)) return;

    // Recarga una sola vez para pedir el HTML y los chunks del deploy actual.
    sessionStorage.setItem(key, "1");
    setReloading(true);
    window.location.replace(getChunkReloadUrl());
  }, [isChunkError]);

  const handleReload = () => {
    sessionStorage.removeItem("mm_chunk_reload_once");
    setReloading(true);
    window.location.replace(getChunkReloadUrl());
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-7 w-7 text-amber-600" />
        </div>
        <h1 className="text-lg font-black uppercase text-slate-800">
          {isChunkError ? "Actualización pendiente" : "Ocurrió un error"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isChunkError
            ? "La app instalada tenía una versión anterior en caché. Vamos a cargar la versión más reciente."
            : "La aplicación encontró un problema inesperado. Puedes reintentar o actualizar."}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={handleReload} disabled={reloading} className="w-full font-bold uppercase">
            {reloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {reloading ? "Actualizando..." : "Actualizar aplicación"}
          </Button>
          {reset && (
            <Button variant="outline" onClick={reset} disabled={reloading} className="w-full font-bold uppercase">
              Reintentar
            </Button>
          )}
        </div>

        {!isChunkError && error?.message && (
          <p className="mt-4 break-words text-[10px] text-muted-foreground">{error.message}</p>
        )}
      </div>
    </div>
  );
}
