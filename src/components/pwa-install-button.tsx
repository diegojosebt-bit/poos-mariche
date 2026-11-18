"use client";

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { usePwaInstall } from '@/contexts/pwa-install-context';

export function PwaInstallButton() {
  const { shouldShowInstall, triggerInstall } = usePwaInstall();

  if (!shouldShowInstall) {
    return null;
  }

  return (
    <Button
      type="button"
      onClick={() => { void triggerInstall(); }}
      variant="default"
      className="h-10 w-full justify-start rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm hover:opacity-95"
    >
      <Download className="mr-2 h-4 w-4" />
      Instalar aplicación
    </Button>
  );
}
