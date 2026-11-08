"use client";

import { useState, useEffect } from "react";
import { useFirebase, initiateEmailSignIn, initiateEmailSignUp } from "@/firebase";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { BrandLockup } from "./icons";
import { Loader2, Mail, Lock, AlertTriangle, UserRound, Building2, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ensureOnline } from "@/lib/offline-guard";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { deleteUser } from "firebase/auth";

const SESSION_KEY = 'mm_session_id';

export function AuthView() {
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  
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
    if (!ensureOnline(toast, 'Iniciar sesión o registrarse')) return;

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

    if (!isLogin) {
      if (accountName.trim().length < 2) {
        toast({ variant: "destructive", title: "Nombre requerido", description: "Ingresa el nombre del propietario o de la cuenta." });
        return;
      }
      if (businessName.trim().length < 2) {
        toast({ variant: "destructive", title: "Negocio requerido", description: "Ingresa el nombre del negocio." });
        return;
      }
      if (businessPhone.replace(/\D/g, "").length < 7) {
        toast({ variant: "destructive", title: "Teléfono inválido", description: "Ingresa un número de teléfono válido." });
        return;
      }
      if (password.length < 6) {
        toast({ variant: "destructive", title: "Contraseña débil", description: "Debe tener al menos 6 caracteres." });
        return;
      }
      if (password !== confirmPassword) {
        toast({ variant: "destructive", title: "Las contraseñas no coinciden", description: "Verifica la confirmación de contraseña." });
        return;
      }
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

      const profileRef = doc(firestore, 'users', user.uid);
      const sessionUpdate = {
        lastSessionId: newSessionId,
        updatedAt: new Date().toISOString(),
      };

      if (isLogin) {
        // El login no bloquea la UI por la sincronización de sesión.
        updateDoc(profileRef, sessionUpdate).catch(err => console.warn("Background session sync error:", err));
      } else {
        try {
          await setDoc(profileRef, {
            uid: user.uid,
            email: user.email,
            accountName: accountName.trim(),
            businessName: businessName.trim(),
            businessPhone: businessPhone.trim(),
            lastSessionId: newSessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            licenseStatus: 'pending',
            licenseExpiry: '',
            enabledModules: ['inventory', 'pos', 'repairs', 'reports', 'expenses', 'analysis', 'fiados', 'inventory_aging'],
            lockedModules: [],
            isPinRequired: false,
          }, { merge: true });
        } catch (profileError) {
          // Si no se crea el perfil, no dejamos una cuenta huérfana.
          try { await deleteUser(user); } catch {}
          throw profileError;
        }
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
          <div className="flex justify-center mb-3">
            <BrandLockup
              size="lg"
              orientation="vertical"
              showTagline={isLogin}
              className="text-foreground"
            />
          </div>
          {!isLogin && (
            <CardTitle className="text-xl font-black uppercase tracking-tight">
              Registro de Negocio
            </CardTitle>
          )}
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

            {!isLogin && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="accountName" className="text-xs font-bold uppercase text-muted-foreground">Nombre para la cuenta</Label>
                  <div className="relative">
                    <UserRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="accountName"
                      placeholder="Ej: María Pérez"
                      className="pl-10"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      autoComplete="name"
                      disabled={isLoading || lockoutTimer > 0}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="businessName" className="text-xs font-bold uppercase text-muted-foreground">Nombre del negocio</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="businessName"
                        placeholder="Mi negocio"
                        className="pl-10"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        autoComplete="organization"
                        disabled={isLoading || lockoutTimer > 0}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessPhone" className="text-xs font-bold uppercase text-muted-foreground">Teléfono</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="businessPhone"
                        type="tel"
                        placeholder="0412-0000000"
                        className="pl-10"
                        value={businessPhone}
                        onChange={(e) => setBusinessPhone(e.target.value)}
                        autoComplete="tel"
                        disabled={isLoading || lockoutTimer > 0}
                        required
                      />
                    </div>
                  </div>
                </div>
              </>
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
                  autoComplete="email"
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
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                />
              </div>
            </div>
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-xs font-bold uppercase text-muted-foreground">Confirmar contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isLoading || lockoutTimer > 0}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            )}
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
