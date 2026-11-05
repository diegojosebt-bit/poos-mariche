"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isClient, setIsClient] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsClient(true);
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) {
      return;
    }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    
    if (outcome === 'accepted') {
      toast({
        title: '¡Instalación Exitosa!',
        description: 'La app ya está disponible en tu escritorio.',
      });
    }
    setInstallPrompt(null);
  };

  if (!isClient || !installPrompt) {
    return null;
  }

  return (
    <Button 
      onClick={handleInstallClick} 
      variant="default" 
      className="w-full justify-start h-10 text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white animate-in fade-in slide-in-from-bottom-2 shadow-lg"
    >
      <Download className="mr-2 h-3.5 w-3.5" />
      INSTALAR EN ESCRITORIO
    </Button>
  );
}