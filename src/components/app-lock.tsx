
"use client";

import { useState } from 'react';
import { useAppLock } from '@/contexts/app-lock-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { AppLogo } from './icons';
import { ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AppLock() {
  const { isLocked, unlockApp } = useAppLock();
  const [password, setPassword] = useState('');
  const { toast } = useToast();

  const handleUnlock = () => {
    if (!unlockApp(password)) {
      toast({
        variant: 'destructive',
        title: 'Contraseña Incorrecta',
        description: 'El acceso al sistema ha sido denegado.',
      });
      setPassword('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleUnlock();
    }
  }

  if (!isLocked) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <AppLogo className="w-16 h-16 text-primary" />
          </div>
          <CardTitle className="text-2xl">Acceso Protegido</CardTitle>
          <CardDescription>
            Introduce la contraseña de administrador para desbloquear el sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              id="system-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Contraseña"
              className="pl-10"
            />
          </div>
          <Button onClick={handleUnlock} className="w-full">
            Desbloquear Sistema
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
