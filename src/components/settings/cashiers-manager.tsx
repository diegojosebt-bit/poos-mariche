"use client";

import { useState, useMemo } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { doc } from "firebase/firestore";
import {
  CheckCircle2,
  Crown,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  MonitorSmartphone,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SmoothCollapse } from "@/components/ui/smooth-collapse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { useFirebase, updateDocumentNonBlocking } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { ensureOnline } from "@/lib/offline-guard";
import { hashPin, isHashedPin, verifyPin } from "@/lib/security";
import {
  CASHIER_ASSIGNABLE_MODULES,
  CASHIER_ROLE_PRESETS,
  createCashierId,
  getEffectivePlanLimits,
} from "@/lib/cashiers";
import type {
  CashierPermissions,
  CashierProfile,
  CashierRolePreset,
  UserModule,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type CashierFormState = {
  id?: string;
  name: string;
  pin: string;
  existingPin?: string;
  role: CashierRolePreset;
  active: boolean;
  permissions: CashierPermissions;
};

function buildInitialCashierForm(enabledModules: UserModule[]): CashierFormState {
  const preset = CASHIER_ROLE_PRESETS.cashier;
  const filteredModules = preset.permissions.modules.filter((m) =>
    enabledModules.length === 0 ? true : enabledModules.includes(m)
  );
  return {
    name: "",
    pin: "",
    role: "cashier",
    active: true,
    permissions: {
      ...preset.permissions,
      modules: filteredModules.length > 0 ? filteredModules : ["pos"],
    },
  };
}

export function CashiersManager() {
  const { firestore, user, auth } = useFirebase();
  const { profile, registerName, setRegisterName } = useDashboardStore();
  const { toast } = useToast();

  // Estado PIN de Gerente (Dueño)
  const [showOwnerPinEditor, setShowOwnerPinEditor] = useState(false);
  const [showPinRecovery, setShowPinRecovery] = useState(false);
  const [currentOwnerPin, setCurrentOwnerPin] = useState("");
  const [newOwnerPin, setNewOwnerPin] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isSavingOwnerPin, setIsSavingOwnerPin] = useState(false);
  const [isRecoveringPin, setIsRecoveringPin] = useState(false);

  // Nombre local de esta caja
  const [localRegisterInput, setLocalRegisterInput] = useState(registerName);

  // Estado CRUD de Cajeros
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showCashierPin, setShowCashierPin] = useState(false);
  const [isSavingCashier, setIsSavingCashier] = useState(false);
  const [cashierToDelete, setCashierToDelete] = useState<CashierProfile | null>(null);

  const enabledModules = useMemo<UserModule[]>(
    () => profile?.enabledModules || ["pos", "inventory", "repairs", "fiados", "expenses", "reports", "analysis"],
    [profile?.enabledModules]
  );

  const [formState, setFormState] = useState<CashierFormState>(() =>
    buildInitialCashierForm(enabledModules)
  );

  const limits = getEffectivePlanLimits(profile);
  const cashiers = profile?.cashiers || [];
  const activeCashiersCount = cashiers.filter((c) => c.active).length;
  const hasOwnerPin = Boolean(profile?.securityPin && profile.securityPin.trim().length > 0);
  const reachedCashierLimit = cashiers.length >= limits.maxCashiers;

  const userProfileRef = firestore && user ? doc(firestore, "users", user.uid) : null;

  const assignableModules = useMemo(
    () => CASHIER_ASSIGNABLE_MODULES.filter((m) => enabledModules.includes(m.id)),
    [enabledModules]
  );

  const pinSalt = profile?.uid || user?.uid || "mm_default";

  // Guardar PIN de Gerente (Dueño) con hash SHA-256
  const handleSaveOwnerPin = async () => {
    if (!userProfileRef) return;
    const cleanNew = newOwnerPin.trim();
    if (!cleanNew || cleanNew.length < 4 || cleanNew.length > 8) {
      toast({
        variant: "destructive",
        title: "PIN inválido",
        description: "El PIN de gerente debe tener entre 4 y 8 dígitos.",
      });
      return;
    }

    if (hasOwnerPin) {
      if (!currentOwnerPin) {
        toast({
          variant: "destructive",
          title: "PIN actual requerido",
          description: "Ingresa tu PIN de gerente actual para cambiarlo.",
        });
        return;
      }
      const matchesCurrent = await verifyPin(currentOwnerPin, profile?.securityPin, pinSalt);
      if (!matchesCurrent) {
        toast({
          variant: "destructive",
          title: "PIN actual incorrecto",
          description: "El PIN ingresado no coincide con tu PIN actual.",
        });
        return;
      }
    }

    for (const c of cashiers) {
      if (await verifyPin(cleanNew, c.pin, pinSalt)) {
        toast({
          variant: "destructive",
          title: "PIN en uso",
          description: "Ese PIN ya pertenece a un cajero. Elige uno distinto para Gerente.",
        });
        return;
      }
    }

    setIsSavingOwnerPin(true);
    try {
      const hashed = await hashPin(cleanNew, pinSalt);
      updateDocumentNonBlocking(userProfileRef, {
        securityPin: hashed,
        isPinRequired: false,
      });
      setNewOwnerPin("");
      setCurrentOwnerPin("");
      setShowOwnerPinEditor(false);
      setShowPinRecovery(false);
      toast({ title: "PIN de gerente actualizado" });
    } catch {
      toast({ variant: "destructive", title: "No se pudo guardar el PIN" });
    } finally {
      setIsSavingOwnerPin(false);
    }
  };

  // Recuperar PIN de Gerente con contraseña Firebase
  const handleRecoverOwnerPin = async () => {
    if (!userProfileRef || !auth?.currentUser) return;
    if (!ensureOnline(toast, "Recuperar PIN")) return;
    const cleanNew = newOwnerPin.trim();
    if (!cleanNew || cleanNew.length < 4 || cleanNew.length > 8) {
      toast({
        variant: "destructive",
        title: "PIN inválido",
        description: "Escribe primero un PIN nuevo de 4 a 8 dígitos arriba.",
      });
      return;
    }
    if (!loginPassword.trim()) {
      toast({
        variant: "destructive",
        title: "Contraseña requerida",
        description: "Ingresa la contraseña con la que inicias sesión.",
      });
      return;
    }

    setIsRecoveringPin(true);
    try {
      const email = auth.currentUser.email;
      if (!email) throw new Error("Sin correo asociado");
      const credential = EmailAuthProvider.credential(email, loginPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      const hashed = await hashPin(cleanNew, pinSalt);
      updateDocumentNonBlocking(userProfileRef, { securityPin: hashed });
      setNewOwnerPin("");
      setCurrentOwnerPin("");
      setLoginPassword("");
      setShowPinRecovery(false);
      setShowOwnerPinEditor(false);
      toast({
        title: "PIN recuperado",
        description: "Tu PIN de gerente fue actualizado correctamente.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "No se pudo recuperar el PIN",
        description: "La contraseña no es correcta o no hay conexión.",
      });
    } finally {
      setIsRecoveringPin(false);
    }
  };

  // Abrir modal para crear o editar cajero
  const openCreateCashier = () => {
    if (reachedCashierLimit) {
      toast({
        variant: "destructive",
        title: `Cupo alcanzado (${cashiers.length}/${limits.maxCashiers})`,
        description: "Solicita ampliar tu plan para agregar más cajeros.",
      });
      return;
    }
    setFormState(buildInitialCashierForm(enabledModules));
    setShowCashierPin(false);
    setDialogOpen(true);
  };

  const openEditCashier = (cashier: CashierProfile) => {
    setFormState({
      id: cashier.id,
      name: cashier.name,
      pin: isHashedPin(cashier.pin) ? "" : cashier.pin,
      existingPin: cashier.pin,
      role: cashier.role,
      active: cashier.active,
      permissions: { ...cashier.permissions },
    });
    setShowCashierPin(false);
    setDialogOpen(true);
  };

  const handleSelectRolePreset = (role: CashierRolePreset) => {
    const preset = CASHIER_ROLE_PRESETS[role];
    const allowedMods = preset.permissions.modules.filter((m) => enabledModules.includes(m));
    setFormState((prev) => ({
      ...prev,
      role,
      permissions: {
        ...preset.permissions,
        modules: allowedMods.length > 0 ? allowedMods : ["pos"],
      },
    }));
  };

  const toggleCashierModule = (moduleId: UserModule) => {
    setFormState((prev) => {
      const exists = prev.permissions.modules.includes(moduleId);
      const nextModules = exists
        ? prev.permissions.modules.filter((m) => m !== moduleId)
        : [...prev.permissions.modules, moduleId];
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          modules: nextModules,
        },
      };
    });
  };

  const handleSaveCashier = async () => {
    if (!userProfileRef) return;
    const cleanName = formState.name.trim().slice(0, 60);
    const cleanPin = formState.pin.trim();
    const keepingExistingPin = Boolean(formState.id && !cleanPin && formState.existingPin);

    if (cleanName.length < 2) {
      toast({
        variant: "destructive",
        title: "Nombre requerido",
        description: "Escribe el nombre del cajero (mínimo 2 letras).",
      });
      return;
    }
    if (!keepingExistingPin && (cleanPin.length < 4 || cleanPin.length > 8)) {
      toast({
        variant: "destructive",
        title: "PIN inválido",
        description: "El PIN del cajero debe tener entre 4 y 8 dígitos.",
      });
      return;
    }
    if (!keepingExistingPin) {
      if (hasOwnerPin && (await verifyPin(cleanPin, profile?.securityPin, pinSalt))) {
        toast({
          variant: "destructive",
          title: "PIN duplicado",
          description: "Ese PIN ya corresponde al Gerente. Usa uno diferente.",
        });
        return;
      }
      for (const c of cashiers) {
        if (c.id !== formState.id && (await verifyPin(cleanPin, c.pin, pinSalt))) {
          toast({
            variant: "destructive",
            title: "PIN en uso",
            description: "Otro cajero ya usa ese PIN. Asigna uno único.",
          });
          return;
        }
      }
    }
    if (formState.permissions.modules.length === 0) {
      toast({
        variant: "destructive",
        title: "Sin módulos",
        description: "Selecciona al menos un módulo (por ejemplo Punto de Venta).",
      });
      return;
    }

    setIsSavingCashier(true);
    try {
      const finalPin = keepingExistingPin
        ? formState.existingPin!
        : await hashPin(cleanPin, pinSalt);

      let nextList: CashierProfile[];
      if (formState.id) {
        nextList = cashiers.map((c) =>
          c.id === formState.id
            ? {
                ...c,
                name: cleanName,
                pin: finalPin,
                role: formState.role,
                active: formState.active,
                permissions: formState.permissions,
              }
            : c
        );
      } else {
        if (cashiers.length >= limits.maxCashiers) {
          toast({
            variant: "destructive",
            title: "Cupo de cajeros lleno",
            description: `Tu plan permite máximo ${limits.maxCashiers} cajeros.`,
          });
          return;
        }
        const newItem: CashierProfile = {
          id: createCashierId(),
          name: cleanName,
          pin: finalPin,
          role: formState.role,
          active: true,
          permissions: formState.permissions,
          createdAt: new Date().toISOString(),
        };
        nextList = [...cashiers, newItem];
      }

      // Al pasar al modelo de cajeros desactivamos el bloqueo legado para evitar doble barrera
      updateDocumentNonBlocking(userProfileRef, {
        cashiers: nextList,
        isPinRequired: false,
      });

      toast({
        title: formState.id ? "Cajero actualizado" : "Cajero creado",
        description: !hasOwnerPin
          ? "Recuerda definir tu PIN de Gerente para proteger Configuración y Reportes."
          : `${cleanName} ya puede iniciar turno con su PIN.`,
      });
      setDialogOpen(false);
    } finally {
      setIsSavingCashier(false);
    }
  };

  const handleToggleCashierActive = (cashier: CashierProfile, active: boolean) => {
    if (!userProfileRef) return;
    const nextList = cashiers.map((c) => (c.id === cashier.id ? { ...c, active } : c));
    updateDocumentNonBlocking(userProfileRef, { cashiers: nextList });
    toast({
      title: active ? `${cashier.name} reactivado` : `${cashier.name} pausado`,
    });
  };

  const handleConfirmDeleteCashier = () => {
    if (!userProfileRef || !cashierToDelete) return;
    const nextList = cashiers.filter((c) => c.id !== cashierToDelete.id);
    updateDocumentNonBlocking(userProfileRef, { cashiers: nextList });
    toast({ title: `Cajero ${cashierToDelete.name} eliminado` });
    setCashierToDelete(null);
  };

  const handleSaveRegisterName = () => {
    setRegisterName(localRegisterInput);
    toast({
      title: "Nombre de caja guardado",
      description: `Este equipo se identificará como "${localRegisterInput.trim() || "Caja Principal"}".`,
    });
  };

  const quotaPct = limits.maxCashiers > 0 ? Math.min(100, (cashiers.length / limits.maxCashiers) * 100) : 100;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
        {/* Columna izquierda: Plan + PIN de Gerente */}
        <div className="space-y-4 lg:col-span-5">
          {/* Plan contratado y nombre de esta caja */}
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                  <MonitorSmartphone className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold text-slate-900">Plan y cajas</h2>
                  <p className="text-[11px] text-slate-500">Cupos de tu suscripción</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-blue-200/80 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                Plan {limits.planLabel}
              </span>
            </div>

            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-2.5">
                  <p className="text-[10px] text-slate-500">Cajas simultáneas</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
                    {limits.maxRegisters}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {limits.isMultiRegister ? "Multi-caja activo" : "1 equipo a la vez"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-2.5">
                  <p className="text-[10px] text-slate-500">Cajeros usados</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
                    {cashiers.length} / {limits.maxCashiers}
                  </p>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        reachedCashierLimit ? "bg-amber-500" : "bg-blue-600"
                      )}
                      style={{ width: `${quotaPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1 border-t border-slate-100 pt-3">
                <Label className="text-[11px] font-medium text-slate-600">Nombre de esta caja</Label>
                <div className="flex gap-2">
                  <Input
                    value={localRegisterInput}
                    onChange={(e) => setLocalRegisterInput(e.target.value)}
                    placeholder="Ej: Caja Principal, Caja 2..."
                    className="h-8 rounded-lg border-slate-200 bg-white text-xs text-slate-900"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSaveRegisterName}
                    disabled={localRegisterInput.trim() === registerName}
                    className="h-8 shrink-0 rounded-lg border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Guardar
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* PIN de Gerente (Dueño) */}
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                  <Crown className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold text-slate-900">PIN de Gerente</h2>
                  <p className="text-[11px] text-slate-500">Clave maestra del dueño</p>
                </div>
              </div>
              {hasOwnerPin ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Activo
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Sin PIN
                </span>
              )}
            </div>

            <div className="space-y-3 p-4">
              {hasOwnerPin && !showOwnerPinEditor && (
                <div className="flex flex-col gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-emerald-900">PIN de gerente configurado</p>
                    <p className="text-[11px] text-emerald-700/90">
                      Se pide para entrar como Dueño o autorizar acciones restringidas.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowOwnerPinEditor(true)}
                    className="h-8 w-full shrink-0 rounded-lg border-emerald-200 bg-white px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-50 sm:w-auto"
                  >
                    Cambiar PIN
                  </Button>
                </div>
              )}

              <SmoothCollapse open={!hasOwnerPin || showOwnerPinEditor}>
                <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
                  {hasOwnerPin && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Actualizar PIN de gerente</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowOwnerPinEditor(false);
                          setShowPinRecovery(false);
                          setNewOwnerPin("");
                          setCurrentOwnerPin("");
                          setLoginPassword("");
                        }}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  <div className={cn("grid grid-cols-1 gap-3", hasOwnerPin && "sm:grid-cols-2")}>
                    {hasOwnerPin && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-slate-600">PIN actual</Label>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={currentOwnerPin}
                          onChange={(e) => setCurrentOwnerPin(e.target.value)}
                          placeholder="••••"
                          className="h-10 rounded-xl border-slate-200 bg-white text-center font-mono text-sm tracking-[0.25em]"
                          maxLength={8}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-600">
                        {hasOwnerPin ? "Nuevo PIN (4 a 8 dígitos)" : "Crear PIN de gerente"}
                      </Label>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={newOwnerPin}
                        onChange={(e) => setNewOwnerPin(e.target.value)}
                        placeholder="4 a 8 dígitos"
                        className="h-10 rounded-xl border-slate-200 bg-white text-center font-mono text-sm font-semibold tracking-[0.25em]"
                        maxLength={8}
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={handleSaveOwnerPin}
                    disabled={isSavingOwnerPin || !newOwnerPin.trim()}
                    className="h-9 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm hover:opacity-95"
                  >
                    {isSavingOwnerPin ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Guardar PIN de gerente
                      </>
                    )}
                  </Button>

                  {hasOwnerPin && (
                    <div className="border-t border-slate-200/80 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPinRecovery((prev) => {
                            if (prev) setLoginPassword("");
                            return !prev;
                          });
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        ¿Olvidaste tu PIN? Recuperar con contraseña
                      </button>

                      <SmoothCollapse open={showPinRecovery}>
                        <div className="mt-3 space-y-2.5 rounded-xl border border-slate-200/80 bg-white p-3.5">
                          <Label className="text-xs font-medium text-slate-700">
                            Contraseña de inicio de sesión
                          </Label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              type="password"
                              autoComplete="current-password"
                              value={loginPassword}
                              onChange={(event) => setLoginPassword(event.target.value)}
                              placeholder="Tu contraseña de Cobranza Online"
                              className="h-9 rounded-xl border-slate-200 text-xs"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleRecoverOwnerPin}
                              disabled={isRecoveringPin || !newOwnerPin || !loginPassword.trim()}
                              className="h-9 shrink-0 rounded-xl border-blue-200 bg-blue-50/50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              {isRecoveringPin ? "Verificando..." : "Recuperar"}
                            </Button>
                          </div>
                        </div>
                      </SmoothCollapse>
                    </div>
                  )}
                </div>
              </SmoothCollapse>
            </div>
          </section>
        </div>

        {/* Columna derecha: Lista y administración de Cajeros */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm lg:col-span-7">
          <div className="flex flex-col gap-2.5 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                <Users className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-slate-900">Equipo de cajeros</h2>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-slate-600">
                    {activeCashiersCount} activo{activeCashiersCount === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Turnos con PIN, permisos propios y cierre individual
                </p>
              </div>
            </div>

            <Button
              type="button"
              onClick={openCreateCashier}
              disabled={reachedCashierLimit}
              className="h-8 w-full rounded-lg bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-3 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50 sm:w-auto"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {reachedCashierLimit ? `Cupo lleno (${cashiers.length}/${limits.maxCashiers})` : "Nuevo cajero"}
            </Button>
          </div>

          <div className="space-y-2.5 p-4">
            {!hasOwnerPin && cashiers.length > 0 && (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-800">
                <strong>Recomendación:</strong> define tu <strong>PIN de Gerente</strong> a la izquierda para evitar que un cajero cambie al perfil de Dueño sin clave.
              </div>
            )}

            {cashiers.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-200/80 bg-blue-50 text-blue-600">
                  <UserCheck className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-slate-800">Sin cajeros registrados</p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
                  Mientras no crees cajeros, el sistema opera directamente como Dueño. Crea tu primer cajero para activar turnos con PIN y cierres individuales.
                </p>
                {limits.maxCashiers > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openCreateCashier}
                    className="mt-4 h-9 rounded-xl border-blue-200 bg-white px-4 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Crear primer cajero
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {cashiers.map((cashier) => {
                  const roleInfo = CASHIER_ROLE_PRESETS[cashier.role] || CASHIER_ROLE_PRESETS.cashier;
                  return (
                    <div
                      key={cashier.id}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between",
                        cashier.active
                          ? "border-slate-200/80 bg-white"
                          : "border-slate-200/60 bg-slate-50/60 opacity-70"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold",
                            cashier.active
                              ? "border border-blue-200/80 bg-blue-50 text-blue-700"
                              : "border border-slate-200 bg-slate-100 text-slate-500"
                          )}
                        >
                          {cashier.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-slate-900">
                              {cashier.name}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {roleInfo.label}
                            </span>
                            {!cashier.active && (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Pausado
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[11px] text-slate-500">
                            {cashier.permissions.modules.length} módulos
                            {cashier.permissions.canEditProducts ? " · Edita productos" : ""}
                            {cashier.permissions.canDeleteRecords ? " · Puede anular" : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5 sm:border-t-0 sm:pt-0">
                        <Switch
                          checked={cashier.active}
                          onCheckedChange={(val) => handleToggleCashierActive(cashier, val)}
                          aria-label={cashier.active ? "Pausar cajero" : "Activar cajero"}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditCashier(cashier)}
                          className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Edit3 className="mr-1 h-3.5 w-3.5" />
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setCashierToDelete(cashier)}
                          className="h-8 w-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Eliminar cajero"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Modal Crear / Editar Cajero */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[540px] sm:p-0">
          <div className="border-b border-slate-100 bg-white px-5 py-4 pr-11">
            <DialogHeader className="space-y-0 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-slate-900">
                    {formState.id ? "Editar cajero" : "Nuevo cajero"}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    Define su PIN de acceso rápido, rol y módulos visibles
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* Nombre y PIN */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-700">Nombre del cajero</Label>
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Ej: María Pérez"
                  className="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-900"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-700">
                  {formState.id && isHashedPin(formState.existingPin)
                    ? "Nuevo PIN (opcional)"
                    : "PIN de acceso (4 a 8 dígitos)"}
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    type={showCashierPin ? "text" : "password"}
                    autoComplete="new-password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={formState.pin}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        pin: e.target.value.replace(/\D/g, "").slice(0, 8),
                      }))
                    }
                    placeholder={formState.id && isHashedPin(formState.existingPin) ? "Dejar vacío para mantener" : "Ej: 1234"}
                    maxLength={8}
                    className="h-10 rounded-xl border-slate-200 bg-white pl-9 pr-9 font-mono text-sm font-semibold tracking-[0.2em] text-slate-900"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCashierPin((v) => !v)}
                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg p-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    {showCashierPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Plantilla rápida de rol */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-700">Plantilla rápida de rol</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["cashier", "technician", "manager"] as CashierRolePreset[]).map((roleId) => {
                  const preset = CASHIER_ROLE_PRESETS[roleId];
                  const active = formState.role === roleId;
                  return (
                    <button
                      key={roleId}
                      type="button"
                      onClick={() => handleSelectRolePreset(roleId)}
                      className={cn(
                        "rounded-xl border px-2.5 py-2 text-left transition-all",
                        active
                          ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-500/25"
                          : "border-slate-200/80 bg-white hover:bg-slate-50"
                      )}
                    >
                      <p className={cn("text-xs font-semibold", active ? "text-blue-700" : "text-slate-800")}>
                        {preset.label}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Módulos permitidos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-slate-700">Módulos permitidos</Label>
                <span className="text-[11px] tabular-nums text-slate-500">
                  {formState.permissions.modules.length} seleccionados
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {assignableModules.map((mod) => {
                  const active = formState.permissions.modules.includes(mod.id);
                  return (
                    <div
                      key={mod.id}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-3 py-2 transition-colors",
                        active ? "border-blue-200/80 bg-blue-50/20" : "border-slate-200/70 bg-slate-50/40"
                      )}
                    >
                      <Label
                        htmlFor={`cmod-${mod.id}`}
                        className={cn(
                          "cursor-pointer text-xs font-medium",
                          active ? "text-slate-800" : "text-slate-500"
                        )}
                      >
                        {mod.label}
                      </Label>
                      <Switch
                        id={`cmod-${mod.id}`}
                        checked={active}
                        onCheckedChange={() => toggleCashierModule(mod.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Permisos operativos */}
            <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5">
              <Label className="text-xs font-semibold text-slate-700">Permisos especiales</Label>
              <div className="space-y-2.5 pt-1">
                {[
                  {
                    key: "canEditProducts" as const,
                    label: "Editar precios y stock en Inventario",
                    hint: "Sin esto, necesita PIN de Gerente para editar productos.",
                  },
                  {
                    key: "canDeleteRecords" as const,
                    label: "Anular ventas o eliminar registros",
                    hint: "Sin esto, necesita PIN de Gerente para reembolsos o borrados.",
                  },
                  {
                    key: "canViewAllCashiersReports" as const,
                    label: "Ver ventas y cierres de otros cajeros",
                    hint: "Sin esto, en Reportes solo ve y cuadra su propia caja.",
                  },
                ].map((perm) => (
                  <div key={perm.key} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800">{perm.label}</p>
                      <p className="text-[11px] text-slate-500">{perm.hint}</p>
                    </div>
                    <Switch
                      checked={formState.permissions[perm.key] === true}
                      onCheckedChange={(val) =>
                        setFormState((prev) => ({
                          ...prev,
                          permissions: { ...prev.permissions, [perm.key]: val },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveCashier}
              disabled={isSavingCashier}
              className="h-9 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-5 text-xs font-semibold text-white shadow-sm hover:opacity-95"
            >
              {isSavingCashier ? "Guardando..." : formState.id ? "Guardar cajero" : "Crear cajero"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación para eliminar cajero */}
      <AlertDialog open={!!cashierToDelete} onOpenChange={(o) => !o && setCashierToDelete(null)}>
        <AlertDialogContent className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[400px] sm:p-0">
          <div className="px-5 py-5">
            <AlertDialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </div>
                <AlertDialogTitle className="text-base font-semibold text-slate-900">
                  ¿Eliminar a {cashierToDelete?.name}?
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription className="text-xs leading-relaxed text-slate-500">
                Se liberará su cupo para crear otro cajero. Sus ventas y cierres anteriores se conservarán intactos en el historial.
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
            <AlertDialogCancel className="mt-0 h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteCashier}
              className="h-9 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
