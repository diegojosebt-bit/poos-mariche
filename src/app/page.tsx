"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/pos');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0F1D] text-slate-200">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-xs text-slate-400 font-medium">Abriendo punto de venta...</p>
      </div>
    </div>
  );
}
