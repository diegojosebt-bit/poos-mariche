"use client";

import { useState, useEffect } from "react";
import { useFirebase, initiateEmailSignIn, initiateEmailSignUp } from "@/firebase";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { AppLogo } from "./icons";
import { Loader2, Mail, Lock, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const SESSION_KEY = 'mm_session_id';

export function AuthView() {
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // Security states
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimer, setLockoutTimer] = useState(0);

  // Lockout countdown timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (lockoutTimer > 0) {
      interval = setInterval(() => {
        setLockoutTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [lockoutTimer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !firestore) return;
    if (lockoutTimer > 0) return;

    // 1. Strict Email Syntax Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast({
        variant: "destructive",
        title: "Correo Inválido",
        description: "Por favor, ingresa un formato de correo electrónico válido.",
      });
      return;
    }

    setIsLoading(true);
    try {
      let userCredential;
      if (isLogin) {
        userCredential = await initiateEmailSignIn(auth, email, password);
      } else {
        userCredential = await initiateEmailSignUp(auth, email, password);
      }

      const user = userCredential.user;
      
      // 2. Instant Identity Generation (0ms)
      const newSessionId = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, newSessionId);

      // Reset security counter on success
      setFailedAttempts(0);

      // 3. Background Sync (Non-blocking)
      const profileRef = doc(firestore, 'users', user.uid);
      const sessionUpdate = {
        lastSessionId: newSessionId,
        updatedAt: new Date().toISOString(),
      };

      if (isLogin) {
          updateDoc(profileRef, sessionUpdate).catch(err => console.warn("Background session sync error:", err));
      } else {
          setDoc(profileRef, {
            uid: user.uid,
            email: user.email,
            lastSessionId: newSessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            licenseStatus: 'expired',
            enabledModules: ['inventory', 'pos', 'repairs', 'reports', 'expenses', 'analysis', 'fiados', 'inventory_aging', 'loans', 'exchange', 'payroll', 'treasury'],
            lockedModules: [],
            isPinRequired: false,
          }, { merge: true }).catch(err => console.warn("Background profile creation error:", err));
      }

      // 4. Instant UI Response
      // Navigation happens naturally via FirebaseProvider state update
      
    } catch (error: any) {
      console.error("Auth error:", error);
      setIsLoading(false);
      
      // Security Logic: Anti Brute-Force
      if (isLogin) {
        const newFailCount = failedAttempts + 1;
        setFailedAttempts(newFailCount);
        
        if (newFailCount >= 5) {
          setLockoutTimer(60);
          setFailedAttempts(0); // Reset count but trigger timer
          toast({
            variant: "destructive",
            title: "Acceso Bloqueado",
            description: "Demasiados intentos fallidos. Por seguridad, el sistema se ha bloqueado por 60 segundos.",
          });
          return;
        }
      }

      let message = "Ha ocurrido un error inesperado.";
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        const remaining = 5 - (isLogin ? (failedAttempts + 1) : 0);
        message = `Correo o contraseña incorrectos. Intentos restantes: ${remaining}`;
      } else if (error.code === 'auth/email-already-in-use') {
        message = "Este correo electrónico ya está registrado.";
      } else if (error.code === 'auth/weak-password') {
        message = "La contraseña debe ser de al menos 6 caracteres.";
      }

      toast({
        variant: "destructive",
        title: "Error de Acceso",
        description: message,
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-xl border-t-4 border-primary">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <AppLogo className="w-16 h-16 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {isLogin ? "POS Mariche" : "Registro de Negocio"}
          </CardTitle>
          <CardDescription>
            {isLogin 
              ? "Ingresa tus credenciales para acceder." 
              : "Crea tu cuenta corporativa para empezar."}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {lockoutTimer > 0 && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3 animate-in fade-in zoom-in-95 duration-300">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                <p className="text-xs font-black text-destructive uppercase tracking-tighter">
                  Sistema Bloqueado por {lockoutTimer} segundos.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-bold uppercase text-muted-foreground">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@posmariche.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading || lockoutTimer > 0}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-bold uppercase text-muted-foreground">Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading || lockoutTimer > 0}
                  required
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button 
              className="w-full h-11 text-base font-bold shadow-md" 
              disabled={isLoading || lockoutTimer > 0}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {lockoutTimer > 0 ? `ESPERE ${lockoutTimer}s` : (isLogin ? "INICIAR SESIÓN" : "CREAR MI TIENDA")}
            </Button>
            <div className="text-center text-sm">
              <span className="text-muted-foreground">
                {isLogin ? "¿No tienes una cuenta?" : "¿Ya tienes una cuenta?"}
              </span>
              <button
                type="button"
                className="ml-1 text-primary font-semibold hover:underline"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setIsLoading(false);
                }}
                disabled={isLoading || lockoutTimer > 0}
              >
                {isLogin ? "Registrar negocio" : "Iniciar sesión"}
              </button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
