
"use client";

import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-50/50">
      <div className="flex flex-col items-center gap-4">
        <div className="p-4 bg-white rounded-full shadow-sm border">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
        <div className="text-center space-y-1">
            <p className="text-sm font-bold text-slate-700 tracking-tight">Cargando Sistema...</p>
            <p className="text-[10px] text-muted-foreground uppercase font-medium animate-pulse">Sincronizando Base de Datos</p>
        </div>
      </div>
    </div>
  );
}
