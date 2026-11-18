"use client";

import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, setDocumentNonBlocking, useDoc, deleteDocumentNonBlocking, sendResetEmail } from "@/firebase";
import { collection, doc, query, limit } from "firebase/firestore";
import type { PlanTier, UserProfile, UserModule } from "@/lib/types";
import { getEffectivePlanLimits, PLAN_PRESETS } from "@/lib/cashiers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { format, parseISO, isAfter, subMinutes, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Megaphone,
  Save,
  Trash2,
  Loader2,
  Users,
  LayoutGrid,
  KeyRound,
  ShieldCheck,
  Briefcase,
  Globe,
  Ban,
  CheckCircle2,
  RefreshCw,
  PlusCircle,
  Wifi,
  Clock,
  Search,
  X,
  CalendarPlus,
  Mail,
  SlidersHorizontal,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";
import { ensureOnline } from "@/lib/offline-guard";
import { normalizeAnnouncements, newAnnouncement, type AnnouncementItem, type AnnouncementType } from "@/lib/announcements";

const ALL_MODULES: { id: UserModule; label: string }[] = [
    { id: 'inventory', label: 'Inventario' },
    { id: 'pos', label: 'Punto de Venta' },
    { id: 'repairs', label: 'Reparaciones' },
    { id: 'expenses', label: 'Gastos y Egresos' },
    { id: 'fiados', label: 'Control de Fiados' },
    { id: 'reports', label: 'Reportes' },
    { id: 'analysis', label: 'Análisis de Negocio' },
];

type StatusFilter = 'all' | 'online' | 'active' | 'pending' | 'expired';

function getUserComputedStatus(u: UserProfile) {
    const isOnline = !!(u.updatedAt && isAfter(parseISO(u.updatedAt), subMinutes(new Date(), 5)));
    const isPending = u.licenseStatus === 'pending';
    const isExpired =
        !isPending &&
        (u.licenseStatus === 'expired' || !!(u.licenseExpiry && isAfter(new Date(), parseISO(u.licenseExpiry))));
    const isTrial = !isPending && !isExpired && u.licenseStatus === 'trial';
    const isActive = !isPending && !isExpired;
    return { isOnline, isPending, isExpired, isTrial, isActive };
}

function LicenseStatusPill({ user }: { user: UserProfile }) {
    const { isPending, isExpired, isTrial } = getUserComputedStatus(user);

    if (isPending) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
                <Clock className="h-3 w-3 shrink-0" />
                Pendiente
            </span>
        );
    }
    if (isExpired) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/80 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700">
                <Ban className="h-3 w-3 shrink-0" />
                Suspendida
            </span>
        );
    }
    if (isTrial) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                <Clock className="h-3 w-3 shrink-0" />
                Prueba
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            Activa
        </span>
    );
}

export default function AdminPage() {
    return (
        <SecurityGate module="admin">
            <AdminContent />
        </SecurityGate>
    );
}

const ANNOUNCEMENT_TONE: Record<AnnouncementType, string> = {
    info: "border-blue-200/80 bg-blue-50/30",
    warning: "border-amber-200/80 bg-amber-50/30",
    critical: "border-rose-200/80 bg-rose-50/30",
};

function AnnouncementEditor() {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const announcementRef = useMemoFirebase(
        () => (firestore ? doc(firestore, 'system', 'announcements') : null),
        [firestore]
    );
    const { data: announcement, isLoading: isDocLoading } = useDoc<any>(announcementRef);

    const [items, setItems] = useState<AnnouncementItem[]>([]);
    const [hasInitialized, setHasInitialized] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isDocLoading && !hasInitialized) {
            setItems(normalizeAnnouncements(announcement));
            setHasInitialized(true);
        }
    }, [announcement, isDocLoading, hasInitialized]);

    const updateItem = (id: string, patch: Partial<AnnouncementItem>) => {
        setItems((prev) =>
            prev.map((item) => {
                if (item.id !== id) return item;
                const contentChanged =
                    patch.message !== undefined ||
                    patch.type !== undefined ||
                    (patch.active === true && item.active === false);
                return {
                    ...item,
                    ...patch,
                    updatedAt: contentChanged ? new Date().toISOString() : item.updatedAt,
                };
            })
        );
    };

    const addItem = () => setItems((prev) => [...prev, newAnnouncement()]);
    const removeItem = (id: string) => setItems((prev) => prev.filter((item) => item.id !== id));

    const handleSave = async () => {
        if (!announcementRef) return;

        const clean = items
            .map((item) => ({ ...item, message: item.message.trim() }))
            .filter((item) => item.message.length > 0);

        if (items.length > 0 && clean.length !== items.length) {
            toast({
                variant: "destructive",
                title: "Comunicado vacío",
                description: "Cada aviso debe tener un mensaje antes de guardar.",
            });
            return;
        }

        setIsSaving(true);
        try {
            await setDocumentNonBlocking(
                announcementRef,
                {
                    items: clean,
                    version: (announcement?.version || 0) + 1,
                    updatedAt: new Date().toISOString(),
                },
                { merge: true }
            );
            toast({
                title: "Comunicados guardados",
                description: "Los usuarios verán los avisos activos al instante.",
            });
        } catch {
            toast({ variant: "destructive", title: "Error al guardar" });
        } finally {
            setIsSaving(false);
        }
    };

    if (!hasInitialized) {
        return (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-8 shadow-sm">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600/60" />
                <p className="text-xs font-medium text-slate-500">Cargando comunicados...</p>
            </div>
        );
    }

    const activeCount = items.filter((item) => item.active).length;

    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                        <Megaphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-slate-900">Comunicados globales</h2>
                        <p className="truncate text-xs text-slate-500">Avisos visibles en todos los negocios</p>
                    </div>
                </div>
                <span
                    className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                        activeCount > 0
                            ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                    )}
                >
                    {activeCount} activo{activeCount === 1 ? "" : "s"}
                </span>
            </div>

            <div className="space-y-3 p-4">
                <div className="max-h-[400px] space-y-3 overflow-y-auto pr-0.5">
                    {items.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-7 text-center">
                            <Megaphone className="mx-auto mb-2 h-5 w-5 text-slate-400" />
                            <p className="text-xs font-medium text-slate-600">Sin comunicados registrados</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                                Crea un aviso para informar mantenimientos o novedades.
                            </p>
                        </div>
                    ) : (
                        items.map((item, index) => (
                            <div
                                key={item.id}
                                className={cn(
                                    "space-y-2.5 rounded-xl border p-3 transition-colors",
                                    item.active ? ANNOUNCEMENT_TONE[item.type] : "border-slate-200/80 bg-slate-50/40"
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-slate-700">
                                        Aviso {index + 1}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-1.5">
                                            <Switch
                                                checked={item.active}
                                                onCheckedChange={(value) => updateItem(item.id, { active: value })}
                                            />
                                            <span
                                                className={cn(
                                                    "text-[11px] font-medium",
                                                    item.active ? "text-emerald-700" : "text-slate-400"
                                                )}
                                            >
                                                {item.active ? "Visible" : "Oculto"}
                                            </span>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                            onClick={() => removeItem(item.id)}
                                            aria-label={`Eliminar aviso ${index + 1}`}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <Textarea
                                        value={item.message}
                                        onChange={(e) => updateItem(item.id, { message: e.target.value })}
                                        placeholder="Ej: Mantenimiento programado para hoy a las 8:00 PM..."
                                        rows={2}
                                        maxLength={280}
                                        className="min-h-[64px] resize-none rounded-lg border-slate-200 bg-white text-xs text-slate-800 placeholder:text-slate-400"
                                    />
                                    <div className="flex items-center justify-between gap-2 pt-0.5">
                                        <Select
                                            value={item.type}
                                            onValueChange={(value) => updateItem(item.id, { type: value as AnnouncementType })}
                                        >
                                            <SelectTrigger className="h-8 w-auto min-w-[165px] rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-700">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="info" className="text-xs">Información (Azul)</SelectItem>
                                                <SelectItem value="warning" className="text-xs">Advertencia (Ámbar)</SelectItem>
                                                <SelectItem value="critical" className="text-xs">Crítico (Rojo)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <span className="text-[10px] tabular-nums text-slate-400">
                                            {item.message.length}/280
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="space-y-2 pt-1">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9 w-full rounded-xl border-dashed border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={addItem}
                    >
                        <PlusCircle className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                        Añadir comunicado
                    </Button>

                    <Button
                        className="h-10 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {isSaving ? "Guardando..." : "Guardar comunicados"}
                    </Button>
                </div>
            </div>
        </section>
    );
}

function UserEditDialog({
    user,
    onSave,
    onResetPin,
    onSendResetEmail,
    isOpen,
    onOpenChange,
}: {
    user: UserProfile;
    onSave: (data: Partial<UserProfile>) => void;
    onResetPin: (userId: string) => void;
    onSendResetEmail: (email: string) => void;
    isOpen: boolean;
    onOpenChange: (val: boolean) => void;
}) {
    const initialLimits = getEffectivePlanLimits(user);
    const [businessName, setBusinessName] = useState(user.businessName || "");
    const [email, setEmail] = useState(user.email || "");
    const [status, setStatus] = useState(user.licenseStatus);
    const [expiry, setExpiry] = useState(user.licenseExpiry?.split('T')[0] || "");
    const [planTier, setPlanTier] = useState<PlanTier>(initialLimits.planTier);
    const [maxRegisters, setMaxRegisters] = useState<number>(initialLimits.maxRegisters);
    const [maxCashiers, setMaxCashiers] = useState<number>(initialLimits.maxCashiers);
    const [enabledModules, setEnabledModules] = useState<UserModule[]>(
        user.enabledModules || ALL_MODULES.map((m) => m.id)
    );
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

    useEffect(() => {
        const limits = getEffectivePlanLimits(user);
        setBusinessName(user.businessName || "");
        setEmail(user.email || "");
        setStatus(user.licenseStatus);
        setExpiry(user.licenseExpiry?.split('T')[0] || "");
        setPlanTier(limits.planTier);
        setMaxRegisters(limits.maxRegisters);
        setMaxCashiers(limits.maxCashiers);
        setEnabledModules(user.enabledModules || ALL_MODULES.map((m) => m.id));
    }, [user]);

    const handleSelectPlanPreset = (tier: PlanTier) => {
        const preset = PLAN_PRESETS[tier];
        setPlanTier(tier);
        setMaxRegisters(preset.maxRegisters);
        setMaxCashiers(preset.maxCashiers);
    };

    const handleToggleModule = (moduleId: UserModule) => {
        setEnabledModules((prev) =>
            prev.includes(moduleId) ? prev.filter((m) => m !== moduleId) : [...prev, moduleId]
        );
    };

    const handleExtend30Days = () => {
        const baseDate = expiry && isAfter(parseISO(expiry), new Date()) ? parseISO(expiry) : new Date();
        setExpiry(format(addDays(baseDate, 30), "yyyy-MM-dd"));
        if (status === 'pending' || status === 'expired') {
            setStatus('active');
        }
    };

    const handleSave = () => {
        onSave({
            businessName,
            email,
            licenseStatus: status,
            licenseExpiry: expiry ? new Date(expiry).toISOString() : user.licenseExpiry,
            planTier,
            maxRegisters: Math.max(1, Math.min(20, Math.floor(Number(maxRegisters) || 1))),
            maxCashiers: Math.max(0, Math.min(50, Math.floor(Number(maxCashiers) || 0))),
            enabledModules,
        });
        onOpenChange(false);
    };

    const isSuspended = status === 'expired';

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="flex max-h-[90vh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[600px] sm:p-0">
                    {/* Header puro blanco alineado en móvil */}
                    <div className="border-b border-slate-100 bg-white px-5 py-4 pr-11">
                        <DialogHeader className="space-y-0 text-left">
                            <div className="flex items-center gap-3">
                                <div
                                    className={cn(
                                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                                        isSuspended
                                            ? "border-rose-200 bg-rose-50 text-rose-600"
                                            : "border-blue-200/80 bg-blue-50 text-blue-600"
                                    )}
                                >
                                    {isSuspended ? <Ban className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                                </div>
                                <div className="min-w-0">
                                    <DialogTitle className="truncate text-base font-semibold text-slate-900">
                                        {user.businessName || "Gestión de negocio"}
                                    </DialogTitle>
                                    <DialogDescription className="truncate text-xs text-slate-500">
                                        {user.email}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                    </div>

                    {/* Body scrollable */}
                    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                        {/* 1. Licencia y acceso */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                <ShieldCheck className="h-4 w-4 text-blue-600" />
                                <span>Licencia y acceso</span>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                                    <Label className="text-xs font-medium text-slate-600">Estado de cuenta</Label>
                                    <Select value={status} onValueChange={(val: any) => setStatus(val)}>
                                        <SelectTrigger
                                            className={cn(
                                                "h-10 rounded-lg bg-white text-xs font-semibold",
                                                status === 'active' && "border-emerald-200 text-emerald-700",
                                                status === 'pending' && "border-amber-200 text-amber-700",
                                                status === 'trial' && "border-blue-200 text-blue-700",
                                                status === 'expired' && "border-rose-200 text-rose-700"
                                            )}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active" className="text-xs font-medium text-emerald-700">
                                                Activa / Pagada
                                            </SelectItem>
                                            <SelectItem value="pending" className="text-xs font-medium text-amber-700">
                                                Pendiente de activación
                                            </SelectItem>
                                            <SelectItem value="trial" className="text-xs font-medium text-blue-700">
                                                Periodo de prueba
                                            </SelectItem>
                                            <SelectItem value="expired" className="text-xs font-medium text-rose-700">
                                                Suspendida / Vencida
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-[11px] leading-snug text-slate-500">
                                        Si eliges Suspendida, el negocio pierde acceso al instante.
                                    </p>
                                </div>

                                <div className="space-y-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <Label className="text-xs font-medium text-slate-600">Vencimiento</Label>
                                        <button
                                            type="button"
                                            onClick={handleExtend30Days}
                                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                                        >
                                            <CalendarPlus className="h-3 w-3" />
                                            +30 días
                                        </button>
                                    </div>
                                    <Input
                                        type="date"
                                        value={expiry}
                                        onChange={(e) => setExpiry(e.target.value)}
                                        className="h-10 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-800"
                                    />
                                    <p className="text-[11px] leading-snug text-slate-500">
                                        El acceso se bloquea automáticamente al pasar esta fecha.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 2. Plan y cupos multi-caja */}
                        <div className="space-y-3 rounded-xl border border-blue-200/70 bg-blue-50/30 p-4">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                                    <SlidersHorizontal className="h-4 w-4 text-blue-600" />
                                    <span>Plan y cupos multi-caja</span>
                                </div>
                                <span className="rounded-full border border-blue-200/80 bg-white px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                                    {(user.cashiers || []).length} / {maxCashiers} cajeros creados
                                </span>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                {(['basic', 'multi', 'pro'] as PlanTier[]).map((tier) => {
                                    const preset = PLAN_PRESETS[tier];
                                    const active = planTier === tier;
                                    return (
                                        <button
                                            key={tier}
                                            type="button"
                                            onClick={() => handleSelectPlanPreset(tier)}
                                            className={cn(
                                                "rounded-xl border px-2.5 py-2 text-left transition-all",
                                                active
                                                    ? "border-blue-500 bg-white ring-1 ring-blue-500/30 shadow-sm"
                                                    : "border-slate-200/80 bg-white/70 hover:bg-white"
                                            )}
                                        >
                                            <p className={cn("text-xs font-semibold", active ? "text-blue-700" : "text-slate-800")}>
                                                {preset.label}
                                            </p>
                                            <p className="mt-0.5 text-[10px] text-slate-500">
                                                {preset.maxRegisters} {preset.maxRegisters === 1 ? "caja" : "cajas"} · {preset.maxCashiers} cajeros
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="grid grid-cols-2 gap-3 pt-1">
                                <div className="space-y-1">
                                    <Label className="text-xs font-medium text-slate-600">Máx. cajas simultáneas</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={maxRegisters}
                                        onChange={(e) => setMaxRegisters(Math.max(1, Number(e.target.value) || 1))}
                                        className="h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold tabular-nums text-slate-900"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs font-medium text-slate-600">Máx. cajeros permitidos</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={50}
                                        value={maxCashiers}
                                        onChange={(e) => setMaxCashiers(Math.max(0, Number(e.target.value) || 0))}
                                        className="h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold tabular-nums text-slate-900"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 3. Información comercial */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                <Users className="h-4 w-4 text-blue-600" />
                                <span>Información comercial</span>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-medium text-slate-600">Nombre del negocio</Label>
                                    <Input
                                        value={businessName}
                                        onChange={(e) => setBusinessName(e.target.value)}
                                        placeholder="Nombre comercial"
                                        className="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-900"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-medium text-slate-500">Correo de acceso (ID)</Label>
                                    <Input
                                        value={email}
                                        disabled
                                        className="h-10 rounded-xl border-slate-200 bg-slate-50 text-xs text-slate-500"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 3. Seguridad de acceso */}
                        <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                <KeyRound className="h-4 w-4 text-blue-600" />
                                <span>Seguridad de acceso</span>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3">
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-semibold text-slate-800">Contraseña de cuenta</p>
                                        <p className="text-[11px] leading-snug text-slate-500">
                                            Envía un enlace de recuperación al correo registrado.
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 w-full rounded-lg border-blue-200 bg-blue-50/50 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                                        onClick={() => onSendResetEmail(user.email)}
                                    >
                                        <Mail className="mr-1.5 h-3.5 w-3.5" />
                                        Enviar enlace
                                    </Button>
                                </div>

                                <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3">
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-semibold text-slate-800">PIN de administrador</p>
                                        <p className="text-[11px] leading-snug text-slate-500">
                                            Elimina el PIN local si el dueño lo olvidó.
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 w-full rounded-lg border-rose-200 bg-rose-50/40 text-xs font-medium text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                        onClick={() => setIsResetConfirmOpen(true)}
                                    >
                                        <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                                        Borrar PIN
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* 4. Módulos habilitados */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                    <LayoutGrid className="h-4 w-4 text-blue-600" />
                                    <span>Módulos habilitados</span>
                                </div>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                                    {enabledModules.length} / {ALL_MODULES.length}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {ALL_MODULES.map((m) => {
                                    const active = enabledModules.includes(m.id);
                                    return (
                                        <div
                                            key={m.id}
                                            className={cn(
                                                "flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors",
                                                active
                                                    ? "border-blue-200/70 bg-blue-50/20"
                                                    : "border-slate-200/80 bg-slate-50/40"
                                            )}
                                        >
                                            <Label
                                                htmlFor={`module-${m.id}`}
                                                className={cn(
                                                    "cursor-pointer text-xs font-medium",
                                                    active ? "text-slate-800" : "text-slate-500"
                                                )}
                                            >
                                                {m.label}
                                            </Label>
                                            <Switch
                                                id={`module-${m.id}`}
                                                checked={active}
                                                onCheckedChange={() => handleToggleModule(m.id)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Footer puro blanco */}
                    <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSave}
                            className={cn(
                                "h-9 rounded-xl px-5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95",
                                isSuspended
                                    ? "bg-rose-600 hover:bg-rose-700"
                                    : "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600"
                            )}
                        >
                            Guardar cambios
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
                <AlertDialogContent className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[400px] sm:p-0">
                    <div className="px-5 py-5">
                        <AlertDialogHeader className="space-y-2 text-left">
                            <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
                                    <KeyRound className="h-4 w-4" />
                                </div>
                                <AlertDialogTitle className="text-base font-semibold text-slate-900">
                                    ¿Eliminar PIN local?
                                </AlertDialogTitle>
                            </div>
                            <AlertDialogDescription className="text-xs leading-relaxed text-slate-500">
                                Esta acción borrará la clave de administrador actual de{" "}
                                <span className="font-semibold text-slate-800">
                                    {user.businessName || user.email}
                                </span>{" "}
                                y desactivará el bloqueo por PIN hasta que configure uno nuevo.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                    </div>
                    <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
                        <AlertDialogCancel className="mt-0 h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                onResetPin(user.uid);
                                setIsResetConfirmOpen(false);
                            }}
                            className="h-9 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700"
                        >
                            Confirmar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function AdminContent() {
    const { firestore, user: currentUser, auth } = useFirebase();
    const { toast } = useToast();
    const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
    const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [searchQuery, setSearchQuery] = useState("");

    // GATILLO DE SEGURIDAD Y CACHE (0 Lecturas al navegar gracias al useCollection global)
    const usersCollection = useMemoFirebase(
        () => (firestore && currentUser ? query(collection(firestore, "users"), limit(100)) : null),
        [firestore, currentUser?.uid]
    );
    const { data: users, isLoading, refetch, mutate } = useCollection<UserProfile>(usersCollection);

    // El panel de admin necesita la lista REAL de negocios, no la copia de
    // IndexedDB: se fuerza una lectura de servidor al entrar (5–100 docs).
    useEffect(() => {
        if (!currentUser) return;
        void refetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.uid]);

    // Métricas en RAM (0 lecturas extra)
    const stats = useMemo(() => {
        const list = users || [];
        let online = 0;
        let active = 0;
        let pending = 0;
        let expired = 0;
        for (const u of list) {
            const c = getUserComputedStatus(u);
            if (c.isOnline) online++;
            if (c.isPending) pending++;
            else if (c.isExpired) expired++;
            else active++;
        }
        return { total: list.length, online, active, pending, expired };
    }, [users]);

    const handleSyncUsers = async () => {
        if (isSyncing) return;
        if (!ensureOnline(toast, 'Sincronizar negocios')) return;
        setIsSyncing(true);
        try {
            await refetch();
            toast({
                title: "Panel sincronizado",
                description: "La lista de negocios se actualizó desde Firestore.",
            });
        } catch {
            toast({
                variant: "destructive",
                title: "No se pudo sincronizar",
                description: "Revisa la conexión o los permisos de administrador.",
            });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleUpdateUser = (userId: string, data: Partial<UserProfile>) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', userId);
        updateDocumentNonBlocking(userRef, data);
        mutate((current) => current?.map((u) => (u.uid === userId ? { ...u, ...data } : u)) || []);
        toast({ title: "Cambios guardados" });
    };

    const handleSendPasswordReset = async (email: string) => {
        if (!auth) return;
        if (!ensureOnline(toast, 'Enviar enlace de recuperación')) return;
        try {
            await sendResetEmail(auth, email);
            toast({ title: "Enlace enviado a " + email });
        } catch {
            toast({ variant: "destructive", title: "Error al enviar" });
        }
    };

    const handleResetPin = (userId: string) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', userId);
        updateDocumentNonBlocking(userRef, { securityPin: "", isPinRequired: false });
        mutate(
            (current) =>
                current?.map((u) =>
                    u.uid === userId ? { ...u, securityPin: "", isPinRequired: false } : u
                ) || []
        );
        toast({ title: "PIN eliminado" });
    };

    const handleQuickActivate = (target: UserProfile) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', target.uid);
        const activation = {
            licenseStatus: 'active' as const,
            licenseExpiry: addDays(new Date(), 30).toISOString(),
            updatedAt: new Date().toISOString(),
        };
        updateDocumentNonBlocking(userRef, activation);
        mutate((current) => current?.map((u) => (u.uid === target.uid ? { ...u, ...activation } : u)) || []);
        toast({ title: "Negocio activado", description: "Acceso activo por 30 días." });
    };

    const handleDeleteUser = () => {
        if (!firestore || !userToDelete) return;
        if (userToDelete.uid === currentUser?.uid) {
            toast({ title: "Acción denegada", variant: "destructive" });
            setUserToDelete(null);
            return;
        }
        deleteDocumentNonBlocking(doc(firestore, 'users', userToDelete.uid));
        mutate((current) => current?.filter((u) => u.uid !== userToDelete.uid) || []);
        toast({ title: "Cuenta eliminada" });
        setUserToDelete(null);
    };

    const filteredUsers = useMemo(() => {
        if (!users) return [];
        const sorted = [...users].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        const q = searchQuery.trim().toLowerCase();

        return sorted.filter((u) => {
            const c = getUserComputedStatus(u);
            if (statusFilter === 'online' && !c.isOnline) return false;
            if (statusFilter === 'active' && !c.isActive) return false;
            if (statusFilter === 'pending' && !c.isPending) return false;
            if (statusFilter === 'expired' && !c.isExpired) return false;

            if (!q) return true;
            const hay = `${u.businessName || ""} ${u.email || ""} ${u.accountName || ""} ${u.businessPhone || ""}`.toLowerCase();
            return hay.includes(q);
        });
    }, [users, statusFilter, searchQuery]);

    const toggleFilter = (target: StatusFilter) => {
        setStatusFilter((prev) => (prev === target ? 'all' : target));
    };

    if (isLoading) {
        return (
            <div className="flex flex-1 items-center justify-center bg-slate-100/70 p-16">
                <div className="flex flex-col items-center gap-2.5">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600/50" />
                    <p className="text-xs font-medium text-slate-500">Cargando panel de administración...</p>
                </div>
            </div>
        );
    }

    const kpiPills: {
        id: StatusFilter;
        label: string;
        count: number;
        icon: typeof Globe;
        tone: string;
        activeTone: string;
    }[] = [
        {
            id: 'all',
            label: 'Negocios',
            count: stats.total,
            icon: Globe,
            tone: 'text-slate-600',
            activeTone: 'border-blue-300 bg-blue-50/70 text-blue-700 ring-1 ring-blue-200/70',
        },
        {
            id: 'online',
            label: 'En línea',
            count: stats.online,
            icon: Wifi,
            tone: 'text-emerald-600',
            activeTone: 'border-emerald-300 bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-200/70',
        },
        {
            id: 'active',
            label: 'Activos',
            count: stats.active,
            icon: CheckCircle2,
            tone: 'text-emerald-600',
            activeTone: 'border-emerald-300 bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-200/70',
        },
        {
            id: 'pending',
            label: 'Pendientes',
            count: stats.pending,
            icon: Clock,
            tone: 'text-amber-600',
            activeTone: 'border-amber-300 bg-amber-50/80 text-amber-700 ring-1 ring-amber-200/70',
        },
        {
            id: 'expired',
            label: 'Suspendidos',
            count: stats.expired,
            icon: Ban,
            tone: 'text-rose-600',
            activeTone: 'border-rose-300 bg-rose-50/80 text-rose-700 ring-1 ring-rose-200/70',
        },
    ];

    return (
        <div className="min-h-0 flex-1 bg-slate-100/70">
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-3 sm:p-6">
                {/* Encabezado ejecutivo integrado */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                Administración Central
                            </h1>
                            <p className="text-xs text-slate-500">
                                Licencias, accesos, módulos activos y comunicados globales
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                void handleSyncUsers();
                            }}
                            disabled={isSyncing}
                            title="Vuelve a leer la lista real de negocios desde Firestore"
                            className="h-9 rounded-xl border-slate-200/80 bg-white px-3.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5 text-blue-600", isSyncing && "animate-spin")} />
                            {isSyncing ? "Sincronizando..." : "Sincronizar"}
                        </Button>
                    </div>
                </div>

                {/* Franja compacta de KPIs interactivos (0 lecturas extra) */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    {kpiPills.map((pill) => {
                        const Icon = pill.icon;
                        const isSelected = statusFilter === pill.id;
                        return (
                            <button
                                key={pill.id}
                                type="button"
                                onClick={() => toggleFilter(pill.id)}
                                className={cn(
                                    "flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left transition-all sm:justify-start",
                                    isSelected
                                        ? pill.activeTone
                                        : "border-slate-200/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50/70"
                                )}
                            >
                                <span className="flex items-center gap-1.5 text-xs font-medium">
                                    <Icon className={cn("h-3.5 w-3.5 shrink-0", !isSelected && pill.tone)} />
                                    <span>{pill.label}</span>
                                </span>
                                <span
                                    className={cn(
                                        "rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                                        isSelected ? "bg-white/80" : "bg-slate-100 text-slate-800"
                                    )}
                                >
                                    {pill.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Layout principal */}
                <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
                    {/* Directorio de Clientes */}
                    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm lg:col-span-2">
                        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-semibold text-slate-900">Directorio de clientes</h2>
                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                                        {filteredUsers.length}
                                    </span>
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    Gestión de accesos, vencimientos y módulos por negocio
                                </p>
                            </div>

                            <div className="relative w-full sm:w-64">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar negocio o correo..."
                                    className="h-9 rounded-xl border-slate-200 bg-slate-50/60 pl-8 pr-8 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery("")}
                                        aria-label="Limpiar búsqueda"
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Vista móvil: tarjetas limpias */}
                        <div className="space-y-2.5 p-3 md:hidden">
                            {filteredUsers.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-10 text-center">
                                    <p className="text-xs font-medium text-slate-600">
                                        {searchQuery || statusFilter !== 'all'
                                            ? "Sin negocios que coincidan con el filtro."
                                            : "Sin negocios registrados."}
                                    </p>
                                </div>
                            ) : (
                                filteredUsers.map((u) => {
                                    const { isOnline, isPending, isExpired } = getUserComputedStatus(u);
                                    const limits = getEffectivePlanLimits(u);
                                    return (
                                        <div
                                            key={u.uid}
                                            className={cn(
                                                "space-y-2.5 rounded-xl border bg-white p-3.5 shadow-sm",
                                                isPending
                                                    ? "border-amber-200/90 bg-amber-50/20"
                                                    : isExpired
                                                    ? "border-rose-200/90 bg-rose-50/20"
                                                    : "border-slate-200/80"
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 space-y-0.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="truncate text-sm font-semibold text-slate-900">
                                                            {u.businessName || "Sin nombre"}
                                                        </span>
                                                        {isOnline && (
                                                            <span
                                                                title="Activo en los últimos 5 min"
                                                                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                                                            >
                                                                <Wifi className="h-2.5 w-2.5" />
                                                                Online
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="truncate text-xs text-slate-500">{u.email}</p>
                                                    {(u.accountName || u.businessPhone) && (
                                                        <p className="truncate text-[11px] text-slate-400">
                                                            {u.accountName || "Sin contacto"}
                                                            {u.businessPhone ? ` · ${u.businessPhone}` : ""}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="shrink-0">
                                                    <LicenseStatusPill user={u} />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-[11px]">
                                                <div>
                                                    <span className="block text-[10px] text-slate-400">Plan</span>
                                                    <span className="font-medium text-blue-700">
                                                        {limits.maxRegisters}c · {limits.maxCashiers}u
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="block text-[10px] text-slate-400">Registro</span>
                                                    <span className="font-medium tabular-nums text-slate-700">
                                                        {u.createdAt ? format(parseISO(u.createdAt), "dd/MM/yy", { locale: es }) : "N/A"}
                                                    </span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="block text-[10px] text-slate-400">Actividad</span>
                                                    <span className="font-medium tabular-nums text-slate-700">
                                                        {u.updatedAt ? format(parseISO(u.updatedAt), "dd/MM HH:mm", { locale: es }) : "N/A"}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-1.5 pt-0.5">
                                                {isPending && (
                                                    <Button
                                                        size="sm"
                                                        className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700"
                                                        onClick={() => handleQuickActivate(u)}
                                                    >
                                                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                                        Activar 30d
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className={cn(
                                                        "h-8 rounded-lg px-3 text-xs font-medium",
                                                        isExpired
                                                            ? "border-rose-200 bg-rose-50/50 text-rose-700 hover:bg-rose-50"
                                                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                                    )}
                                                    onClick={() => setEditingUser(u)}
                                                >
                                                    <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                                                    Gestionar
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                                    onClick={() => setUserToDelete(u)}
                                                    aria-label="Eliminar negocio"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Vista escritorio: tabla limpia */}
                        <div className="hidden overflow-x-auto md:block">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-slate-100 bg-slate-50/70 hover:bg-slate-50/70">
                                        <TableHead className="pl-5 text-xs font-medium text-slate-500">
                                            Negocio / Cliente
                                        </TableHead>
                                        <TableHead className="text-xs font-medium text-slate-500">
                                            Estado
                                        </TableHead>
                                        <TableHead className="text-xs font-medium text-slate-500">
                                            Registro
                                        </TableHead>
                                        <TableHead className="text-xs font-medium text-slate-500">
                                            Última actividad
                                        </TableHead>
                                        <TableHead className="pr-5 text-right text-xs font-medium text-slate-500">
                                            Acciones
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredUsers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="py-12 text-center text-xs text-slate-500">
                                                {searchQuery || statusFilter !== 'all'
                                                    ? "No hay negocios que coincidan con el filtro aplicado."
                                                    : "Sin negocios registrados."}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredUsers.map((u) => {
                                            const { isOnline, isPending, isExpired } = getUserComputedStatus(u);
                                            const limits = getEffectivePlanLimits(u);

                                            return (
                                                <TableRow
                                                    key={u.uid}
                                                    className={cn(
                                                        "border-slate-100 transition-colors hover:bg-slate-50/70",
                                                        isPending && "bg-amber-50/25 hover:bg-amber-50/40",
                                                        isExpired && "bg-rose-50/25 hover:bg-rose-50/40"
                                                    )}
                                                >
                                                    <TableCell className="py-3 pl-5">
                                                        <div className="flex flex-col gap-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-semibold text-slate-900">
                                                                    {u.businessName || "Sin nombre"}
                                                                </span>
                                                                {isOnline && (
                                                                    <span
                                                                        title="Activo en los últimos 5 min"
                                                                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                                                                    >
                                                                        <Wifi className="h-2.5 w-2.5" />
                                                                        Online
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-[11px] text-slate-500">{u.email}</span>
                                                            {(u.accountName || u.businessPhone) && (
                                                                <span className="text-[11px] text-slate-400">
                                                                    {u.accountName || "Sin contacto"}
                                                                    {u.businessPhone ? ` · ${u.businessPhone}` : ""}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col items-start gap-1">
                                                            <LicenseStatusPill user={u} />
                                                            <span className="text-[10px] font-medium text-slate-500">
                                                                {limits.planLabel} · {limits.maxRegisters} {limits.maxRegisters === 1 ? "caja" : "cajas"} / {limits.maxCashiers} caj.
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-xs tabular-nums text-slate-500">
                                                        {u.createdAt ? format(parseISO(u.createdAt), "dd/MM/yy", { locale: es }) : "N/A"}
                                                    </TableCell>
                                                    <TableCell className="text-xs tabular-nums text-slate-500">
                                                        {u.updatedAt ? format(parseISO(u.updatedAt), "dd/MM/yy HH:mm", { locale: es }) : "N/A"}
                                                    </TableCell>
                                                    <TableCell className="pr-5 text-right">
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            {isPending && (
                                                                <Button
                                                                    size="sm"
                                                                    className="h-8 rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700"
                                                                    onClick={() => handleQuickActivate(u)}
                                                                >
                                                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                                                    Activar
                                                                </Button>
                                                            )}
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className={cn(
                                                                    "h-8 rounded-lg px-2.5 text-xs font-medium",
                                                                    isExpired
                                                                        ? "border-rose-200 bg-rose-50/50 text-rose-700 hover:bg-rose-50"
                                                                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                                                )}
                                                                onClick={() => setEditingUser(u)}
                                                            >
                                                                Gestionar
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                                                onClick={() => setUserToDelete(u)}
                                                                aria-label="Eliminar negocio"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </section>

                    {/* Comunicados Globales */}
                    <div className="lg:col-span-1">
                        <AnnouncementEditor />
                    </div>
                </div>
            </main>

            {editingUser && (
                <UserEditDialog
                    user={editingUser}
                    isOpen={!!editingUser}
                    onOpenChange={(o) => !o && setEditingUser(null)}
                    onSave={(d) => handleUpdateUser(editingUser.uid, d)}
                    onResetPin={handleResetPin}
                    onSendResetEmail={handleSendPasswordReset}
                />
            )}

            <AlertDialog open={!!userToDelete} onOpenChange={(o) => !o && setUserToDelete(null)}>
                <AlertDialogContent className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[400px] sm:p-0">
                    <div className="px-5 py-5">
                        <AlertDialogHeader className="space-y-2 text-left">
                            <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
                                    <Trash2 className="h-4 w-4" />
                                </div>
                                <AlertDialogTitle className="text-base font-semibold text-slate-900">
                                    ¿Eliminar este negocio?
                                </AlertDialogTitle>
                            </div>
                            <AlertDialogDescription className="text-xs leading-relaxed text-slate-500">
                                Se revocará permanentemente el acceso de{" "}
                                <span className="font-semibold text-slate-800">
                                    {userToDelete?.businessName || userToDelete?.email}
                                </span>
                                . Esta acción no se puede deshacer.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                    </div>
                    <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
                        <AlertDialogCancel className="mt-0 h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteUser}
                            className="h-9 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700"
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
