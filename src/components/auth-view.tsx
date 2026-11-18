"use client";

import { useState, useEffect, useRef } from "react";
import { useFirebase, initiateEmailSignIn, initiateEmailSignUp, sendResetEmail } from "@/firebase";
import {
  clearLockoutState,
  forceLockout,
  readLockoutState,
  recordFailedAttempt,
} from "@/lib/security";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { AppLogo } from "./icons";
import {
  Loader2,
  Mail,
  Lock,
  KeyRound,
  AlertTriangle,
  UserRound,
  Building2,
  Phone,
  Eye,
  EyeOff,
  Zap,
  Users,
  ShieldCheck,
  CheckCircle2,
  Circle,
  Sparkles,
  ArrowRight,
  MessageCircle,
  Receipt,
  Sun,
  Moon,
  Download
} from "lucide-react";
import { usePwaInstall } from "@/contexts/pwa-install-context";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ensureOnline } from "@/lib/offline-guard";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { deleteUser } from "firebase/auth";

const SESSION_KEY = 'mm_session_id';
const AUTH_THEME_KEY = 'mm_auth_theme';
const LOGIN_LOCKOUT_KEY = 'mm_auth_lockout_login';
const REGISTER_LOCKOUT_KEY = 'mm_auth_lockout_register';
const RESET_COOLDOWN_KEY = 'mm_auth_reset_cooldown';

const LOGIN_LOCKOUT_CONFIG = {
  maxAttempts: 5,
  durationsSeconds: [60, 300, 900],
};

const REGISTER_LOCKOUT_CONFIG = {
  maxAttempts: 3,
  durationsSeconds: [120, 600, 1800],
};

export function AuthView() {
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();
  const { shouldShowInstall, triggerInstall } = usePwaInstall();
  const [isLogin, setIsLogin] = useState(true);
  const [isDark, setIsDark] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(AUTH_THEME_KEY);
      if (saved === 'light') setIsDark(false);
    } catch {}
  }, []);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTH_THEME_KEY, next ? 'dark' : 'light');
      } catch {}
      return next;
    });
  };
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  // Honeypot anti-bots invisible (si un bot lo rellena, se rechaza sin llamar a Firebase)
  const [companyWebsite, setCompanyWebsite] = useState("");
  const registerOpenedAtRef = useRef<number>(Date.now());

  // Bloqueos persistentes (sobreviven recargas F5)
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSubmitted, setResetSubmitted] = useState(false);

  const activeLockoutKey = isLogin ? LOGIN_LOCKOUT_KEY : REGISTER_LOCKOUT_KEY;

  // Sincroniza estado de bloqueo persistido al cargar o cambiar entre Login y Registro
  useEffect(() => {
    const state = readLockoutState(activeLockoutKey);
    setLockoutTimer(state.remainingSeconds);
    const resetState = readLockoutState(RESET_COOLDOWN_KEY);
    setResetCooldown(resetState.remainingSeconds);
    if (!isLogin) {
      registerOpenedAtRef.current = Date.now();
    }
  }, [activeLockoutKey, isLogin]);

  // Cuenta regresiva sincronizada con el reloj real
  useEffect(() => {
    if (lockoutTimer <= 0 && resetCooldown <= 0) return;
    const interval = setInterval(() => {
      setLockoutTimer(readLockoutState(activeLockoutKey).remainingSeconds);
      setResetCooldown(readLockoutState(RESET_COOLDOWN_KEY).remainingSeconds);
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTimer, resetCooldown, activeLockoutKey]);

  const openResetModal = () => {
    setResetEmail(email.trim());
    setResetSubmitted(false);
    setResetCooldown(readLockoutState(RESET_COOLDOWN_KEY).remainingSeconds);
    setIsResetModalOpen(true);
  };

  const handleForgotPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!auth || isSendingReset) return;
    if (!ensureOnline(toast, 'Recuperar contraseña')) return;

    const cooldown = readLockoutState(RESET_COOLDOWN_KEY).remainingSeconds;
    if (cooldown > 0) {
      setResetCooldown(cooldown);
      toast({
        variant: "destructive",
        title: "Espera un momento",
        description: `Podrás solicitar otro enlace en ${cooldown}s.`,
      });
      return;
    }

    const cleanEmail = resetEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      toast({
        variant: "destructive",
        title: "Correo inválido",
        description: "Ingresa un correo electrónico válido (ej. usuario@negocio.com).",
      });
      return;
    }

    setIsSendingReset(true);
    try {
      await sendResetEmail(auth, cleanEmail);
    } catch {
      // Mensaje genérico siempre (anti-enumeración: no revelar si el correo existe)
    } finally {
      forceLockout(RESET_COOLDOWN_KEY, 60);
      setResetCooldown(60);
      setIsSendingReset(false);
      setResetSubmitted(true);
      toast({
        title: "Solicitud procesada",
        description: "Si el correo está registrado, recibirás un enlace de recuperación en unos instantes.",
      });
    }
  };

  const passwordChecks = [
    { id: "length", label: "Mínimo 8 caracteres", met: password.length >= 8 },
    { id: "upper", label: "Una mayúscula (A–Z)", met: /[A-Z]/.test(password) },
    { id: "number", label: "Un número (0–9)", met: /[0-9]/.test(password) },
    { id: "special", label: "Un carácter especial (!@#...)", met: /[^A-Za-z0-9]/.test(password) },
  ];
  const isPasswordStrong = passwordChecks.every((rule) => rule.met);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !firestore) return;

    const currentLock = readLockoutState(activeLockoutKey).remainingSeconds;
    if (currentLock > 0) {
      setLockoutTimer(currentLock);
      return;
    }
    if (!ensureOnline(toast, 'Iniciar sesión o registrarse')) return;

    // 0. Protección anti-bots en Registro (honeypot + tiempo mínimo humano)
    if (!isLogin) {
      if (companyWebsite.trim().length > 0) {
        return;
      }
      if (Date.now() - registerOpenedAtRef.current < 2000) {
        toast({
          variant: "destructive",
          title: "Espera un segundo",
          description: "Verifica los datos ingresados e intenta nuevamente.",
        });
        return;
      }
    }

    // 1. Limpieza y validación estricta de correo (evita falsos errores por espacios)
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      if (isLogin) {
        const res = recordFailedAttempt(LOGIN_LOCKOUT_KEY, LOGIN_LOCKOUT_CONFIG);
        if (res.locked) {
          setLockoutTimer(res.lockoutSeconds);
          toast({
            variant: "destructive",
            title: "Acceso bloqueado temporalmente",
            description: `Demasiados intentos inválidos. Espera ${res.lockoutSeconds}s.`,
          });
          return;
        }
      }
      toast({
        variant: "destructive",
        title: "Correo inválido",
        description: "Verifica que el correo tenga formato válido (ej. usuario@dominio.com).",
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
      if (!isPasswordStrong) {
        toast({
          variant: "destructive",
          title: "Contraseña insegura",
          description: "Debe tener al menos 8 caracteres, una mayúscula, un número y un carácter especial.",
        });
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
        userCredential = await initiateEmailSignIn(auth, cleanEmail, password);
      } else {
        userCredential = await initiateEmailSignUp(auth, cleanEmail, password);
      }

      const user = userCredential.user;

      // Instant Identity Generation
      const newSessionId = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, newSessionId);

      // Limpiar bloqueo tras acceso exitoso; aplicar cooldown breve tras registro exitoso
      if (isLogin) {
        clearLockoutState(LOGIN_LOCKOUT_KEY);
      } else {
        recordFailedAttempt(REGISTER_LOCKOUT_KEY, REGISTER_LOCKOUT_CONFIG);
      }

      const profileRef = doc(firestore, 'users', user.uid);
      const sessionUpdate = {
        lastSessionId: newSessionId,
        updatedAt: new Date().toISOString(),
      };

      if (isLogin) {
        updateDoc(profileRef, sessionUpdate).catch((err) => console.warn("Background session sync error:", err));
      } else {
        try {
          await setDoc(profileRef, {
            uid: user.uid,
            email: user.email,
            accountName: accountName.trim().slice(0, 80),
            businessName: businessName.trim().slice(0, 100),
            businessPhone: businessPhone.trim().slice(0, 25),
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
          try { await deleteUser(user); } catch {}
          throw profileError;
        }
      }
    } catch (error: any) {
      console.error("Auth error:", error);
      setIsLoading(false);

      // Si Firebase ya bloqueó por tasa de intentos, reflejarlo localmente
      if (error.code === 'auth/too-many-requests') {
        forceLockout(activeLockoutKey, 180);
        setLockoutTimer(180);
        toast({
          variant: "destructive",
          title: "Demasiados intentos",
          description: "El servidor bloqueó temporalmente el acceso por seguridad. Espera 3 minutos e intenta de nuevo.",
        });
        return;
      }

      // Anti Brute-Force persistente con backoff progresivo (Login y Registro)
      const lockResult = recordFailedAttempt(
        activeLockoutKey,
        isLogin ? LOGIN_LOCKOUT_CONFIG : REGISTER_LOCKOUT_CONFIG,
      );

      if (lockResult.locked) {
        setLockoutTimer(lockResult.lockoutSeconds);
        const mins = lockResult.lockoutSeconds >= 60 ? `${Math.ceil(lockResult.lockoutSeconds / 60)} min` : `${lockResult.lockoutSeconds}s`;
        toast({
          variant: "destructive",
          title: "Acceso bloqueado temporalmente",
          description: `Demasiados intentos fallidos. Por seguridad, espera ${mins} antes de volver a intentar.`,
        });
        return;
      }

      let message = "Ha ocurrido un error inesperado.";
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        message = `Correo o contraseña incorrectos. Intentos restantes: ${lockResult.remainingAttempts}`;
      } else if (error.code === 'auth/email-already-in-use') {
        message = "No se pudo completar el registro con este correo. Si ya tienes cuenta, inicia sesión.";
      } else if (error.code === 'auth/weak-password') {
        message = "La contraseña no cumple el nivel mínimo de seguridad.";
      } else if (error.code === 'auth/invalid-email') {
        message = "El formato del correo electrónico no es válido.";
      }

      toast({
        variant: "destructive",
        title: "Error de Acceso",
        description: message,
      });
    }
  };

  const baseInputStyle = isDark
    ? "dark-input [color-scheme:dark] !pl-11 h-11 w-full rounded-xl border border-slate-700/80 bg-[#070B16] text-white placeholder:text-slate-500 focus:bg-[#070B16] focus-visible:bg-[#070B16] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-sm shadow-inner transition-all"
    : "!pl-11 h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 focus:bg-white focus-visible:bg-white focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-sm transition-all";
  const passwordInputStyle = isDark
    ? "dark-input [color-scheme:dark] !pl-11 !pr-11 h-11 w-full rounded-xl border border-slate-700/80 bg-[#070B16] text-white placeholder:text-slate-500 focus:bg-[#070B16] focus-visible:bg-[#070B16] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-sm shadow-inner transition-all"
    : "!pl-11 !pr-11 h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 focus:bg-white focus-visible:bg-white focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-sm transition-all";
  const labelStyle = isDark ? "text-xs font-semibold text-slate-200" : "text-xs font-semibold text-slate-700";
  const eyeBtnStyle = isDark
    ? "absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
    : "absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer";

  return (
    <div className={cn(
      "min-h-screen relative overflow-hidden flex flex-col justify-between transition-colors duration-300 selection:bg-blue-600 selection:text-white",
      isDark ? "bg-[#0A0F1D] text-slate-100" : "bg-slate-50 text-slate-900"
    )}>
      {/* Atmósfera 2026 con Luces Aurora */}
      <div className={cn(
        "pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[850px] h-[450px] blur-3xl transition-opacity duration-300",
        isDark
          ? "bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.22),transparent_70%)]"
          : "bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.14),transparent_70%)]"
      )} />
      <div className={cn(
        "pointer-events-none absolute bottom-0 left-0 w-[500px] h-[400px] blur-3xl transition-opacity duration-300",
        isDark
          ? "bg-[radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.14),transparent_70%)]"
          : "bg-[radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.10),transparent_70%)]"
      )} />
      <div className={cn(
        "pointer-events-none absolute top-1/3 right-0 w-[450px] h-[450px] blur-3xl transition-opacity duration-300",
        isDark
          ? "bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),transparent_70%)]"
          : "bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.10),transparent_70%)]"
      )} />

      {/* Grid sutil */}
      <div 
        className={cn("pointer-events-none absolute inset-0", isDark ? "opacity-[0.03]" : "opacity-[0.05]")} 
        style={{
          backgroundImage: isDark
            ? `radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)`
            : `radial-gradient(rgba(15, 23, 42, 0.35) 1px, transparent 1px)`,
          backgroundSize: '24px 24px'
        }}
      />

      {/* Header Superior Limpio & Contrastado */}
      <header className={cn(
        "relative z-10 w-full border-b backdrop-blur-xl transition-colors duration-300",
        isDark ? "border-white/[0.08] bg-[#0A0F1D]/80" : "border-slate-200/80 bg-white/85"
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AppLogo className="w-8 h-8 sm:w-9 sm:h-9" />
            <span className={cn("font-black tracking-tight text-base sm:text-lg", isDark ? "text-white" : "text-slate-900")}>
              Cobranza Online
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {shouldShowInstall && (
              <button
                type="button"
                onClick={() => { void triggerInstall(); }}
                aria-label="Instalar aplicación"
                title="Instalar Cobranza Online"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-2.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span>Instalar</span>
              </button>
            )}

            {/* Botón cambio Oscuro <-> Claro solo para Login/Registro */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-200 cursor-pointer",
                isDark
                  ? "border-white/10 bg-white/[0.05] text-amber-300 hover:bg-white/[0.12]"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100 shadow-sm"
              )}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <a
              href="https://wa.me/584241765136?text=Hola,%20deseo%20información%20sobre%20Cobranza%20Online"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                isDark
                  ? "text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border-white/10"
                  : "text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border-slate-200 shadow-sm"
              )}
            >
              <MessageCircle className={cn("w-3.5 h-3.5", isDark ? "text-emerald-400" : "text-emerald-600")} />
              <span className="hidden xs:inline">Soporte WhatsApp</span>
              <span className="xs:hidden">Ayuda</span>
            </a>
          </div>
        </div>
      </header>

      {/* Contenedor Principal: Split-Screen Hero + Auth (en móvil muestra solo el login) */}
      <main className="relative z-10 flex-1 flex items-center">
        <div className={cn(
          "max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center",
          isLogin ? "lg:gap-14" : "lg:gap-10"
        )}>
          
          {/* Columna Izquierda: Showcase solo en escritorio (oculto en móvil) */}
          <div className={cn(
            "hidden lg:flex flex-col justify-center space-y-8 text-left",
            isLogin ? "lg:col-span-7" : "lg:col-span-6"
          )}>
            {/* Headline fresco, nítido y directo */}
            <h1 className={cn(
              "text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.14]",
              isDark ? "text-white" : "text-slate-900"
            )}>
              El sistema de cobro y caja que{" "}
              <span className={cn(
                "bg-clip-text text-transparent",
                isDark
                  ? "bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-300"
                  : "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600"
              )}>
                nunca se detiene.
              </span>
            </h1>

            {/* Bento Grid con Alto Contraste */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
              <div className={cn(
                "p-4 rounded-xl border text-left transition",
                isDark
                  ? "bg-slate-900/80 border-slate-700/60 shadow-lg hover:border-blue-500/40"
                  : "bg-white border-slate-200/80 shadow-sm hover:border-blue-300"
              )}>
                <div className={cn(
                  "w-8 h-8 rounded-lg border flex items-center justify-center mb-2.5",
                  isDark ? "bg-blue-500/20 border-blue-500/30" : "bg-blue-50 border-blue-200/80"
                )}>
                  <Users className={cn("w-4 h-4", isDark ? "text-blue-400" : "text-blue-600")} />
                </div>
                <h2 className={cn("text-xs font-bold uppercase tracking-wider mb-1", isDark ? "text-white" : "text-slate-900")}>
                  Múltiples Cajeros
                </h2>
                <p className={cn("text-xs leading-relaxed", isDark ? "text-slate-300" : "text-slate-600")}>
                  Asigna operadores con PIN propio, permisos por módulo y cierre individual por caja.
                </p>
              </div>

              <div className={cn(
                "p-4 rounded-xl border text-left transition",
                isDark
                  ? "bg-slate-900/80 border-slate-700/60 shadow-lg hover:border-emerald-500/40"
                  : "bg-white border-slate-200/80 shadow-sm hover:border-emerald-300"
              )}>
                <div className={cn(
                  "w-8 h-8 rounded-lg border flex items-center justify-center mb-2.5",
                  isDark ? "bg-emerald-500/20 border-emerald-500/30" : "bg-emerald-50 border-emerald-200/80"
                )}>
                  <Zap className={cn("w-4 h-4", isDark ? "text-emerald-400" : "text-emerald-600")} />
                </div>
                <h2 className={cn("text-xs font-bold uppercase tracking-wider mb-1", isDark ? "text-white" : "text-slate-900")}>
                  Tasa BCV en Vivo
                </h2>
                <p className={cn("text-xs leading-relaxed", isDark ? "text-slate-300" : "text-slate-600")}>
                  Conversión automática en USD y Bs. Cero cuentas a mano ni errores de caja.
                </p>
              </div>

              <div className={cn(
                "p-4 rounded-xl border text-left transition",
                isDark
                  ? "bg-slate-900/80 border-slate-700/60 shadow-lg hover:border-indigo-500/40"
                  : "bg-white border-slate-200/80 shadow-sm hover:border-indigo-300"
              )}>
                <div className={cn(
                  "w-8 h-8 rounded-lg border flex items-center justify-center mb-2.5",
                  isDark ? "bg-indigo-500/20 border-indigo-500/30" : "bg-indigo-50 border-indigo-200/80"
                )}>
                  <ShieldCheck className={cn("w-4 h-4", isDark ? "text-indigo-400" : "text-indigo-600")} />
                </div>
                <h2 className={cn("text-xs font-bold uppercase tracking-wider mb-1", isDark ? "text-white" : "text-slate-900")}>
                  Taller & Créditos
                </h2>
                <p className={cn("text-xs leading-relaxed", isDark ? "text-slate-300" : "text-slate-600")}>
                  Órdenes técnicas por folio y cuentas por cobrar con abonos y recordatorios.
                </p>
              </div>
            </div>
          </div>

          {/* Columna Derecha: Tarjeta de Acceso */}
          <div className={cn(
            "w-full mx-auto lg:max-w-none transition-all duration-300 ease-out motion-reduce:transition-none",
            isLogin ? "lg:col-span-5 max-w-md" : "lg:col-span-6 max-w-xl"
          )}>
            <div className={cn(
              "relative rounded-2xl backdrop-blur-2xl border overflow-hidden transition-all duration-300 ease-out",
              isDark
                ? "bg-slate-900/90 border-blue-500/35 ring-1 ring-blue-500/15 shadow-2xl shadow-black/60"
                : "bg-white border-blue-200/90 ring-1 ring-blue-100/80 shadow-xl shadow-slate-200/70"
            )}>
              <div className={cn("p-6 transition-all duration-300", isLogin ? "sm:p-8" : "sm:p-6")}>
                {/* Contenido con transición direccional suave */}
                <div
                  key={isLogin ? "login-view" : "register-view"}
                  className={cn(
                    "animate-in fade-in zoom-in-[0.985] duration-300 ease-out motion-reduce:animate-none",
                    isLogin ? "slide-in-from-left-3" : "slide-in-from-right-3"
                  )}
                >
                  <div className={cn("text-center", isLogin ? "mb-5" : "mb-4")}>
                    <h3 className={cn("text-xl sm:text-2xl font-black tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                      {isLogin ? "Acceso al Punto de Venta" : "Registro de Negocio"}
                    </h3>
                    <p className={cn("text-xs sm:text-sm mt-1", isDark ? "text-slate-400" : "text-slate-500")}>
                      {isLogin
                        ? "Ingresa tus credenciales para comenzar la jornada."
                        : "Crea tu cuenta corporativa en menos de 1 minuto."}
                    </p>
                  </div>

                  {/* Formulario */}
                  <form onSubmit={handleSubmit} className={cn(isLogin ? "space-y-4" : "space-y-3.5")}>
                  {/* Campo honeypot invisible anti-bots */}
                  {!isLogin && (
                    <div aria-hidden="true" className="hidden">
                      <input
                        type="text"
                        name="company_website"
                        tabIndex={-1}
                        autoComplete="off"
                        value={companyWebsite}
                        onChange={(e) => setCompanyWebsite(e.target.value)}
                      />
                    </div>
                  )}
                  {lockoutTimer > 0 && (
                    <div className={cn(
                      "p-3 border rounded-xl flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200",
                      isDark ? "bg-red-500/10 border-red-500/20" : "bg-rose-50 border-rose-200"
                    )}>
                      <AlertTriangle className={cn("w-5 h-5 shrink-0", isDark ? "text-red-400" : "text-rose-600")} />
                      <p className={cn("text-xs font-bold uppercase tracking-tight", isDark ? "text-red-300" : "text-rose-700")}>
                        Sistema bloqueado: espera {lockoutTimer}s
                      </p>
                    </div>
                  )}

                  {isLogin ? (
                    <>
                      {/* Login: Correo */}
                      <div className="space-y-1.5">
                        <Label htmlFor="email" className={labelStyle}>
                          Usuario / Correo Electrónico
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Mail className="h-4 w-4" />
                          </div>
                          <Input
                            id="email"
                            type="email"
                            placeholder="tu-correo@negocio.com"
                            className={baseInputStyle}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading || lockoutTimer > 0}
                            autoComplete="email"
                            maxLength={120}
                            required
                          />
                        </div>
                      </div>

                      {/* Login: Contraseña */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="password" className={labelStyle}>
                            Contraseña de Acceso
                          </Label>
                          <button
                            type="button"
                            onClick={openResetModal}
                            className={cn(
                              "text-[11px] font-medium transition-colors cursor-pointer",
                              isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"
                            )}
                          >
                            ¿Olvidaste tu contraseña?
                          </button>
                        </div>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Lock className="h-4 w-4" />
                          </div>
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className={passwordInputStyle}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading || lockoutTimer > 0}
                            autoComplete="current-password"
                            maxLength={128}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className={eyeBtnStyle}
                            tabIndex={-1}
                            aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Registro compacto: 2 columnas en PC/tablet (3 filas) y 1 columna en móvil */
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {/* 1: Titular */}
                      <div className="space-y-1">
                        <Label htmlFor="accountName" className={labelStyle}>
                          Titular / Responsable
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <UserRound className="h-4 w-4" />
                          </div>
                          <Input
                            id="accountName"
                            placeholder="Ej: Carlos Silva"
                            className={baseInputStyle}
                            value={accountName}
                            onChange={(e) => setAccountName(e.target.value)}
                            autoComplete="name"
                            maxLength={80}
                            disabled={isLoading || lockoutTimer > 0}
                            required
                          />
                        </div>
                      </div>

                      {/* 2: Negocio */}
                      <div className="space-y-1">
                        <Label htmlFor="businessName" className={labelStyle}>
                          Nombre del Negocio
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <Input
                            id="businessName"
                            placeholder="Ej: Inversiones C&S"
                            className={baseInputStyle}
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            autoComplete="organization"
                            maxLength={100}
                            disabled={isLoading || lockoutTimer > 0}
                            required
                          />
                        </div>
                      </div>

                      {/* 3: Teléfono */}
                      <div className="space-y-1">
                        <Label htmlFor="businessPhone" className={labelStyle}>
                          Teléfono de Contacto
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Phone className="h-4 w-4" />
                          </div>
                          <Input
                            id="businessPhone"
                            type="tel"
                            placeholder="0412-1234567"
                            className={baseInputStyle}
                            value={businessPhone}
                            onChange={(e) => setBusinessPhone(e.target.value)}
                            autoComplete="tel"
                            maxLength={25}
                            disabled={isLoading || lockoutTimer > 0}
                            required
                          />
                        </div>
                      </div>

                      {/* 4: Correo */}
                      <div className="space-y-1">
                        <Label htmlFor="email" className={labelStyle}>
                          Correo Electrónico
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Mail className="h-4 w-4" />
                          </div>
                          <Input
                            id="email"
                            type="email"
                            placeholder="correo@negocio.com"
                            className={baseInputStyle}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading || lockoutTimer > 0}
                            autoComplete="email"
                            maxLength={120}
                            required
                          />
                        </div>
                      </div>

                      {/* 5: Contraseña */}
                      <div className="space-y-1">
                        <Label htmlFor="password" className={labelStyle}>
                          Contraseña
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Lock className="h-4 w-4" />
                          </div>
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className={passwordInputStyle}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading || lockoutTimer > 0}
                            autoComplete="new-password"
                            maxLength={128}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className={eyeBtnStyle}
                            tabIndex={-1}
                            aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      {/* 6: Confirmar Contraseña */}
                      <div className="space-y-1">
                        <Label htmlFor="confirmPassword" className={labelStyle}>
                          Confirmar Contraseña
                        </Label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <Lock className="h-4 w-4" />
                          </div>
                          <Input
                            id="confirmPassword"
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className={passwordInputStyle}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={isLoading || lockoutTimer > 0}
                            autoComplete="new-password"
                            maxLength={128}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className={eyeBtnStyle}
                            tabIndex={-1}
                            aria-label={showConfirmPassword ? "Ocultar confirmación" : "Ver confirmación"}
                          >
                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Requisitos de contraseña en vivo */}
                      <div className={cn(
                        "sm:col-span-2 rounded-xl border px-3.5 py-2.5 transition-colors",
                        isDark ? "border-slate-800/90 bg-slate-950/60" : "border-slate-200/80 bg-slate-50"
                      )}>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {passwordChecks.map((rule) => (
                            <div
                              key={rule.id}
                              className={cn(
                                "flex items-center gap-1.5 text-[11px] transition-colors duration-200",
                                rule.met
                                  ? (isDark ? "text-emerald-400 font-medium" : "text-emerald-700 font-medium")
                                  : (isDark ? "text-slate-400" : "text-slate-500")
                              )}
                            >
                              {rule.met ? (
                                <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200 scale-105", isDark ? "text-emerald-400" : "text-emerald-600")} />
                              ) : (
                                <Circle className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-slate-600" : "text-slate-300")} />
                              )}
                              <span className="truncate">{rule.label}</span>
                            </div>
                          ))}
                        </div>
                        {confirmPassword.length > 0 && (
                          <div
                            className={cn(
                              "mt-2 flex items-center gap-1.5 border-t pt-2 text-[11px] transition-colors duration-200",
                              isDark ? "border-slate-800/80" : "border-slate-200/80",
                              passwordsMatch
                                ? (isDark ? "text-emerald-400 font-medium" : "text-emerald-700 font-medium")
                                : (isDark ? "text-rose-400" : "text-rose-600")
                            )}
                          >
                            {passwordsMatch ? (
                              <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-emerald-400" : "text-emerald-600")} />
                            ) : (
                              <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-rose-400" : "text-rose-600")} />
                            )}
                            <span>{passwordsMatch ? "Las contraseñas coinciden" : "Las contraseñas no coinciden"}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <Button
                      type="submit"
                      className="w-full h-11 text-sm font-bold bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-600/30 rounded-xl transition-all duration-200 active:scale-[0.99] flex items-center justify-center gap-2"
                      disabled={isLoading || lockoutTimer > 0}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Procesando...</span>
                        </>
                      ) : (
                        <>
                          <span>
                            {lockoutTimer > 0
                              ? `ESPERE ${lockoutTimer}s`
                              : isLogin
                              ? "Iniciar Sesión"
                              : "Crear mi Negocio"}
                          </span>
                          <ArrowRight className="w-4 h-4 shrink-0" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
                </div>

                <div className="mt-5 text-center text-xs">
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>
                    {isLogin ? "¿Nuevo en la plataforma?" : "¿Ya tienes cuenta?"}
                  </span>
                  <button
                    type="button"
                    className={cn(
                      "ml-1.5 font-bold underline underline-offset-4 transition-colors",
                      isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"
                    )}
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setIsLoading(false);
                    }}
                    disabled={isLoading || lockoutTimer > 0}
                  >
                    {isLogin ? "Registrar negocio aquí" : "Iniciar sesión"}
                  </button>
                </div>
              </div>

              {/* Pie de seguridad en la tarjeta */}
              <div className={cn(
                "py-2.5 px-6 border-t flex items-center justify-center gap-2 text-[11px] font-medium transition-colors",
                isDark
                  ? "bg-slate-950/60 border-slate-800/80 text-slate-400"
                  : "bg-slate-50/80 border-slate-100 text-slate-500"
              )}>
                <CheckCircle2 className={cn("w-3.5 h-3.5", isDark ? "text-emerald-400" : "text-emerald-600")} />
                <span>Acceso seguro protegido por cifrado SSL</span>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Footer Minimalista & Limpio */}
      <footer className={cn(
        "relative z-10 w-full border-t py-4 text-center text-xs transition-colors duration-300",
        isDark
          ? "border-white/[0.08] bg-[#0A0F1D]/90 text-slate-400"
          : "border-slate-200/80 bg-white/90 text-slate-500"
      )}>
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© {new Date().getFullYear()} Cobranza Online · Gestión de Negocio.</p>
          <div className={cn("hidden sm:flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]", isDark ? "text-slate-400" : "text-slate-500")}>
            <span>Arquitectura 0 Lecturas Innecesarias</span>
            <span>·</span>
            <span>PWA Lista</span>
            <span>·</span>
            <span>Alta Disponibilidad</span>
          </div>
        </div>
      </footer>

      {/* Modal aparte: Recuperación de Contraseña */}
      <Dialog
        open={isResetModalOpen}
        onOpenChange={(open) => {
          setIsResetModalOpen(open);
          if (!open) setResetSubmitted(false);
        }}
      >
        <DialogContent
          className={cn(
            "w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border p-0 shadow-2xl sm:max-w-[420px] sm:p-0",
            isDark
              ? "border-blue-500/35 bg-slate-900 text-slate-100 [&>button]:text-slate-400 [&>button]:hover:text-white"
              : "border-blue-200/90 bg-white text-slate-900"
          )}
        >
          <div className={cn("border-b px-5 py-4 pr-11", isDark ? "border-slate-800" : "border-slate-100")}>
            <DialogHeader className="space-y-1.5 text-left">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                    isDark
                      ? "border-blue-500/30 bg-blue-500/15 text-blue-400"
                      : "border-blue-200/80 bg-blue-50 text-blue-600"
                  )}
                >
                  <KeyRound className="h-4 w-4" />
                </div>
                <DialogTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
                  Recuperar contraseña
                </DialogTitle>
              </div>
              <DialogDescription className={cn("text-xs leading-relaxed", isDark ? "text-slate-400" : "text-slate-500")}>
                Ingresa el correo asociado a tu negocio y te enviaremos un enlace seguro para crear una nueva contraseña.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={(e) => { void handleForgotPassword(e); }}>
            <div className="space-y-4 px-5 py-4">
              {resetSubmitted ? (
                <div
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5",
                    isDark
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                  )}
                >
                  <CheckCircle2 className={cn("mt-0.5 h-5 w-5 shrink-0", isDark ? "text-emerald-400" : "text-emerald-600")} />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">Revisa tu bandeja de entrada</p>
                    <p className={cn("text-xs leading-relaxed", isDark ? "text-emerald-200/80" : "text-emerald-800/90")}>
                      Si <strong className="font-semibold">{resetEmail.trim().toLowerCase()}</strong> está registrado, recibirás el enlace en unos instantes. Revisa también la carpeta de spam.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email" className={labelStyle}>
                    Correo electrónico registrado
                  </Label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                      <Mail className="h-4 w-4" />
                    </div>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="tu-correo@negocio.com"
                      className={baseInputStyle}
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      disabled={isSendingReset}
                      autoComplete="email"
                      maxLength={120}
                      autoFocus
                      required
                    />
                  </div>
                </div>
              )}

              {resetCooldown > 0 && (
                <p className={cn("text-[11px]", isDark ? "text-slate-400" : "text-slate-500")}>
                  Por seguridad, podrás solicitar otro envío en{" "}
                  <strong className="font-semibold tabular-nums">{resetCooldown}s</strong>.
                </p>
              )}
            </div>

            <DialogFooter
              className={cn(
                "flex-row justify-end gap-2 border-t px-5 py-3.5",
                isDark ? "border-slate-800 bg-slate-900/80" : "border-slate-100 bg-white"
              )}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsResetModalOpen(false)}
                className={cn(
                  "h-9 rounded-xl text-xs font-medium",
                  isDark
                    ? "border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                {resetSubmitted ? "Cerrar" : "Cancelar"}
              </Button>
              {!resetSubmitted && (
                <Button
                  type="submit"
                  disabled={isSendingReset || resetCooldown > 0 || !resetEmail.trim()}
                  className="h-9 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 text-xs font-semibold text-white shadow-sm hover:opacity-95"
                >
                  {isSendingReset ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Enviando...
                    </>
                  ) : resetCooldown > 0 ? (
                    `Espera ${resetCooldown}s`
                  ) : (
                    "Enviar enlace"
                  )}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
