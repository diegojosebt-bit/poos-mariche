"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
    Settings,
    PiggyBank,
    DownloadCloud,
    RefreshCw,
    Receipt,
    Wrench,
    Loader2,
    Store,
    FileSpreadsheet,
    Save,
    Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useFirebase, setDocumentNonBlocking, useMemoFirebase } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { doc, collection, getDocs, query, orderBy, startAfter, limit, documentId } from "firebase/firestore";
import { useEffect, useState, useMemo } from "react";
import type { Product } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { Textarea } from "@/components/ui/textarea";
import { SecurityGate } from "@/components/security-gate";
import { ensureOnline } from "@/lib/offline-guard";
import { CashiersManager } from "@/components/settings/cashiers-manager";
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

const settingsSchema = z.object({
    bcvRate: z.coerce.number().positive("La tasa debe ser mayor a 0"),
    parallelRate: z.coerce.number().positive("La tasa debe ser mayor a 0"),
    profitMargin: z.coerce.number().min(0, "El margen no puede ser negativo"),
    autoUpdateBcv: z.boolean().default(false),
    lastUpdated: z.string().optional(),
    weeklyRent: z.coerce.number().min(0, "Mínimo 0"),
    investmentPercentage: z.coerce.number().min(0).max(100, "Máximo 100%"),
    partnersCount: z.coerce.number().min(1, "Al menos 1 socio"),
    repairInputMode: z.enum(['inventory', 'manual', 'both']).default('both'),
    largeText: z.boolean().default(false),
});

const profileSchema = z.object({
    businessName: z.string().min(2, "Mínimo 2 caracteres"),
    businessAddress: z.string().optional(),
    businessRIF: z.string().optional(),
    businessPhone: z.string().optional(),
    showInfoOnReceipt: z.boolean().default(false),
    showRateOnReceipt: z.boolean().default(true),
    showTermsOnReceipt: z.boolean().default(true),
    printLeftMargin: z.coerce.number().min(0).max(10).default(0),
    repairWarrantyPolicy: z.string().optional(),
    repairPickupPolicy: z.string().optional(),
    repairDisclaimer: z.string().optional(),
});

type SettingsTab = 'business' | 'finance' | 'team';

export default function SettingsPage() {
    return (
        <SecurityGate module="settings">
            <SettingsContent />
        </SecurityGate>
    );
}

function SettingsContent() {
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const [activeTab, setActiveTab] = useState<SettingsTab>('business');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [isFetchingOfficialRate, setIsFetchingOfficialRate] = useState(false);
    const [isExportingInventory, setIsExportingInventory] = useState(false);
    const [exportInventoryConfirmOpen, setExportInventoryConfirmOpen] = useState(false);

    const settingsRef = useMemoFirebase(
        () => (firestore && user ? doc(firestore, 'users', user.uid, 'app-settings', 'main') : null),
        [firestore, user?.uid]
    );

    const userProfileRef = useMemoFirebase(
        () => (firestore && user ? doc(firestore, 'users', user.uid) : null),
        [firestore, user?.uid]
    );

    const handleFetchOfficialRateInSettings = async () => {
        setIsFetchingOfficialRate(true);
        try {
            const res = await fetch(`/api/bcv-rate?t=${Date.now()}`);
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();
            if (data && typeof data.bcvRate === 'number' && data.bcvRate > 0) {
                settingsForm.setValue('bcvRate', parseFloat(data.bcvRate.toFixed(4)), { shouldDirty: true });
                toast({
                    title: "Tasa oficial obtenida",
                    description: `BCV: ${data.bcvRate.toFixed(2)} Bs.`,
                });
            } else {
                toast({ title: "No se pudo obtener la tasa oficial", variant: "destructive" });
            }
        } catch {
            toast({ title: "Error al consultar la tasa oficial", variant: "destructive" });
        } finally {
            setIsFetchingOfficialRate(false);
        }
    };

    const { settings, profile } = useDashboardStore();

    const settingsForm = useForm<z.infer<typeof settingsSchema>>({
        resolver: zodResolver(settingsSchema),
        defaultValues: {
            bcvRate: 1,
            parallelRate: 1,
            profitMargin: 100,
            autoUpdateBcv: false,
            weeklyRent: 40,
            investmentPercentage: 30,
            partnersCount: 2,
            repairInputMode: 'both',
            largeText: false,
        },
    });

    const profileForm = useForm<z.infer<typeof profileSchema>>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            businessName: "",
            businessAddress: "",
            businessRIF: "",
            businessPhone: "",
            showInfoOnReceipt: false,
            showRateOnReceipt: true,
            showTermsOnReceipt: true,
            printLeftMargin: 0,
            repairWarrantyPolicy: "",
            repairPickupPolicy: "",
            repairDisclaimer: "",
        },
    });

    useEffect(() => {
        if (settings) {
            settingsForm.reset({
                bcvRate: settings.bcvRate,
                parallelRate: settings.parallelRate,
                profitMargin: settings.profitMargin,
                autoUpdateBcv: settings.autoUpdateBcv || false,
                lastUpdated: settings.lastUpdated,
                weeklyRent: settings.weeklyRent ?? 40,
                investmentPercentage: settings.investmentPercentage ?? 30,
                partnersCount: settings.partnersCount ?? 2,
                repairInputMode: settings.repairInputMode || 'both',
                largeText: settings.largeText || false,
            });
        }
    }, [settings, settingsForm]);

    useEffect(() => {
        if (profile) {
            profileForm.reset({
                businessName: (profile.businessName || "").toUpperCase(),
                businessAddress: (profile.businessAddress || "").toUpperCase(),
                businessRIF: (profile.businessRIF || "").toUpperCase(),
                businessPhone: (profile.businessPhone || "").toUpperCase(),
                showInfoOnReceipt: profile.showInfoOnReceipt || false,
                showRateOnReceipt: profile.showRateOnReceipt !== false,
                showTermsOnReceipt: profile.showTermsOnReceipt !== false,
                printLeftMargin: profile.printLeftMargin || 0,
                repairWarrantyPolicy: profile.repairWarrantyPolicy || "4 días por el servicio realizado.",
                repairPickupPolicy: profile.repairPickupPolicy || "7 días máximo una vez notificado...",
                repairDisclaimer: profile.repairDisclaimer || "No nos hacemos responsables...",
            });
        }
    }, [profile, profileForm]);

    const isRepairsEnabled = useMemo(
        () => profile?.enabledModules?.includes('repairs') ?? false,
        [profile?.enabledModules]
    );

    const handleSaveSettings = async (values: z.infer<typeof settingsSchema>) => {
        if (!settingsRef) return;
        setIsSavingSettings(true);
        try {
            await setDocumentNonBlocking(
                settingsRef,
                { ...values, lastUpdated: new Date().toISOString() },
                { merge: true }
            );
            settingsForm.reset(values);
            toast({ title: "Parámetros guardados" });
        } catch {
            toast({ variant: "destructive", title: "Error al guardar parámetros" });
        } finally {
            setIsSavingSettings(false);
        }
    };

    const handleSaveProfile = async (values: z.infer<typeof profileSchema>) => {
        if (!userProfileRef || isSavingProfile) return;
        setIsSavingProfile(true);
        try {
            await setDocumentNonBlocking(userProfileRef, values, { merge: true });
            profileForm.reset(values);
            toast({ title: "Datos del negocio y tickets guardados" });
        } catch {
            toast({ variant: "destructive", title: "No se pudieron guardar los datos" });
        } finally {
            setIsSavingProfile(false);
        }
    };

    const runExportInventory = async () => {
        if (!firestore || !user || isExportingInventory) return;
        if (!ensureOnline(toast, 'Exportar inventario')) return;
        setIsExportingInventory(true);
        try {
            const prods: Product[] = [];
            let last: any = null;

            for (;;) {
                const base = collection(firestore, 'users', user.uid, 'products');
                const pageQuery = last
                    ? query(base, orderBy(documentId()), startAfter(last), limit(300))
                    : query(base, orderBy(documentId()), limit(300));

                const snap = await getDocs(pageQuery);
                prods.push(...snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product));

                if (snap.size < 300) break;
                last = snap.docs[snap.docs.length - 1];
            }

            if (prods.length === 0) {
                toast({ title: "No hay productos para exportar" });
                return;
            }

            const worksheet = XLSX.utils.json_to_sheet(prods);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
            XLSX.writeFile(workbook, "inventario.xlsx");
            toast({ title: "Inventario exportado", description: `${prods.length} productos descargados en Excel.` });
        } catch {
            toast({ variant: "destructive", title: "Error al exportar inventario" });
        } finally {
            setIsExportingInventory(false);
        }
    };

    const handleExportSettings = () => {
        if (!settings) return;
        const worksheet = XLSX.utils.json_to_sheet([settings]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Configuracion");
        XLSX.writeFile(workbook, "configuracion.xlsx");
        toast({ title: "Configuración exportada" });
    };

    const tabs: { id: SettingsTab; label: string; shortLabel: string; icon: typeof Store }[] = [
        { id: 'business', label: 'Negocio y Tickets', shortLabel: 'Negocio', icon: Store },
        { id: 'finance', label: 'Finanzas y Respaldo', shortLabel: 'Finanzas', icon: PiggyBank },
        { id: 'team', label: 'Equipo y Cajeros', shortLabel: 'Cajeros', icon: Users },
    ];

    return (
        <div className="min-h-0 flex-1 bg-slate-100/70">
            <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3.5 py-3.5 pb-20 sm:px-6 sm:py-5">
                {/* Encabezado ejecutivo compacto */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm">
                            <Settings className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                                Configuración
                            </h1>
                            <p className="text-[11px] text-slate-500">
                                Negocio, tickets, tasas, cajeros y respaldos
                            </p>
                        </div>
                    </div>

                    {/* Navegación segmentada tipo píldora */}
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm sm:inline-flex">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const active = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all sm:px-3",
                                        active
                                            ? "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm"
                                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                    )}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="sm:hidden">{tab.shortLabel}</span>
                                    <span className="hidden sm:inline">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* TAB 1: NEGOCIO Y TICKETS */}
                {activeTab === 'business' && (
                    <Form {...profileForm}>
                        <form onSubmit={profileForm.handleSubmit(handleSaveProfile)} className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
                                {/* Columna izquierda: Datos del negocio + preferencias de ticket */}
                                <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                                    <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
                                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                                            <Store className="h-3.5 w-3.5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h2 className="text-[13px] font-semibold text-slate-900">Datos del negocio</h2>
                                            <p className="text-[11px] text-slate-500">
                                                Información impresa en notas de venta y tickets
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-3.5 p-4">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <FormField
                                                control={profileForm.control}
                                                name="businessName"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Nombre del negocio
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                placeholder="Mi Negocio C.A."
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={profileForm.control}
                                                name="businessRIF"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            RIF / Identificación fiscal
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                placeholder="J-12345678-0"
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={profileForm.control}
                                                name="businessPhone"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Teléfono de contacto
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="tel"
                                                                inputMode="tel"
                                                                placeholder="0412-0000000"
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-900"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={profileForm.control}
                                                name="businessAddress"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Dirección / Ubicación
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                placeholder="Av. Principal, Local 1"
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        {isRepairsEnabled && (
                                            <div className="space-y-2.5 border-t border-slate-100 pt-3">
                                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                                                    <Receipt className="h-3.5 w-3.5 text-blue-600" />
                                                    <span>Preferencias del ticket</span>
                                                </div>
                                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                                    <FormField
                                                        control={profileForm.control}
                                                        name="showRateOnReceipt"
                                                        render={({ field }) => (
                                                            <div className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2.5">
                                                                <div className="space-y-0.5">
                                                                    <Label className="text-xs font-medium text-slate-800">
                                                                        Mostrar tasa BCV
                                                                    </Label>
                                                                    <p className="text-[10px] text-slate-500">
                                                                        Imprime la tasa en el recibo.
                                                                    </p>
                                                                </div>
                                                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                            </div>
                                                        )}
                                                    />

                                                    <FormField
                                                        control={profileForm.control}
                                                        name="showInfoOnReceipt"
                                                        render={({ field }) => (
                                                            <div className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2.5">
                                                                <div className="space-y-0.5">
                                                                    <Label className="text-xs font-medium text-slate-800">
                                                                        Mostrar dirección y RIF
                                                                    </Label>
                                                                    <p className="text-[10px] text-slate-500">
                                                                        Incluye tus datos fiscales.
                                                                    </p>
                                                                </div>
                                                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                            </div>
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                {/* Columna derecha: Políticas de reparaciones o Preferencias de ticket */}
                                {isRepairsEnabled ? (
                                    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                                        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
                                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                                                <Wrench className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0">
                                                <h2 className="text-[13px] font-semibold text-slate-900">
                                                    Políticas para tickets de reparación
                                                </h2>
                                                <p className="text-[11px] text-slate-500">
                                                    Condiciones impresas al pie de la nota del cliente
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-3 p-4">
                                            <FormField
                                                control={profileForm.control}
                                                name="repairWarrantyPolicy"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Garantía del servicio
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Textarea
                                                                {...field}
                                                                rows={2}
                                                                placeholder="Ej: 4 días de garantía sobre el servicio realizado..."
                                                                className="min-h-[60px] resize-none rounded-lg border-slate-200 bg-white text-xs leading-relaxed text-slate-800"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={profileForm.control}
                                                name="repairPickupPolicy"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Política de retiro de equipos
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Textarea
                                                                {...field}
                                                                rows={2}
                                                                placeholder="Ej: 7 días máximo para retirar una vez notificado..."
                                                                className="min-h-[60px] resize-none rounded-lg border-slate-200 bg-white text-xs leading-relaxed text-slate-800"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </section>
                                ) : (
                                    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                                        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
                                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                                                <Receipt className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0">
                                                <h2 className="text-[13px] font-semibold text-slate-900">Preferencias del ticket</h2>
                                                <p className="text-[11px] text-slate-500">
                                                    Contenido visible en las notas de venta impresas
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-2.5 p-4">
                                            <FormField
                                                control={profileForm.control}
                                                name="showRateOnReceipt"
                                                render={({ field }) => (
                                                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2.5">
                                                        <div className="space-y-0.5">
                                                            <Label className="text-xs font-medium text-slate-800">
                                                                Mostrar tasa BCV en ticket
                                                            </Label>
                                                            <p className="text-[10px] text-slate-500">
                                                                Imprime la tasa aplicada en el recibo.
                                                            </p>
                                                        </div>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                    </div>
                                                )}
                                            />

                                            <FormField
                                                control={profileForm.control}
                                                name="showInfoOnReceipt"
                                                render={({ field }) => (
                                                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2.5">
                                                        <div className="space-y-0.5">
                                                            <Label className="text-xs font-medium text-slate-800">
                                                                Mostrar dirección y RIF
                                                            </Label>
                                                            <p className="text-[10px] text-slate-500">
                                                                Incluye tus datos fiscales en el encabezado.
                                                            </p>
                                                        </div>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    </section>
                                )}
                            </div>

                            <div className="flex items-center justify-end">
                                <Button
                                    type="submit"
                                    disabled={!profileForm.formState.isDirty || isSavingProfile}
                                    className="h-9 w-full rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50 sm:w-auto"
                                >
                                    {isSavingProfile ? (
                                        <>
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                            Guardando...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="mr-1.5 h-3.5 w-3.5" />
                                            Guardar negocio y tickets
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    </Form>
                )}

                {/* TAB 2: FINANZAS Y RESPALDO */}
                {activeTab === 'finance' && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
                        <Form {...settingsForm}>
                            <form onSubmit={settingsForm.handleSubmit(handleSaveSettings)} className="lg:col-span-7">
                                <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                                    <div className="flex flex-col gap-2.5 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-200/80 bg-emerald-50 text-emerald-600">
                                                <PiggyBank className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0">
                                                <h2 className="text-[13px] font-semibold text-slate-900">
                                                    Parámetros financieros
                                                </h2>
                                                <p className="text-[11px] text-slate-500">
                                                    Tasa BCV, reposición y margen global
                                                </p>
                                            </div>
                                        </div>

                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleFetchOfficialRateInSettings}
                                            disabled={isFetchingOfficialRate}
                                            className="h-8 w-full rounded-lg border-blue-200/80 bg-blue-50/50 px-2.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 sm:w-auto"
                                        >
                                            <RefreshCw className={cn("mr-1.5 h-3 w-3", isFetchingOfficialRate && "animate-spin")} />
                                            {isFetchingOfficialRate ? "Consultando..." : "Consultar BCV"}
                                        </Button>
                                    </div>

                                    <div className="space-y-3 p-4">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <FormField
                                                control={settingsForm.control}
                                                name="bcvRate"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Tasa BCV (Bs.)
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="number"
                                                                step="0.0001"
                                                                {...field}
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold tabular-nums text-emerald-700"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={settingsForm.control}
                                                name="parallelRate"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Reposición (Bs.)
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="number"
                                                                step="0.0001"
                                                                {...field}
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold tabular-nums text-slate-900"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={settingsForm.control}
                                                name="profitMargin"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[11px] font-medium text-slate-600">
                                                            Margen global (%)
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="number"
                                                                {...field}
                                                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-semibold tabular-nums text-blue-700"
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <FormField
                                            control={settingsForm.control}
                                            name="autoUpdateBcv"
                                            render={({ field }) => (
                                                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2.5">
                                                    <div className="space-y-0.5">
                                                        <Label className="text-xs font-medium text-slate-800">
                                                            Sincronización automática BCV
                                                        </Label>
                                                        <p className="text-[10px] text-slate-500">
                                                            Se actualiza sola a las 7:00, 15:00 y 20:00.
                                                        </p>
                                                    </div>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                </div>
                                            )}
                                        />
                                    </div>

                                    <div className="flex items-center justify-end border-t border-slate-100 bg-white px-4 py-2.5">
                                        <Button
                                            type="submit"
                                            disabled={isSavingSettings || !settingsForm.formState.isDirty}
                                            className="h-8 w-full rounded-lg bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50 sm:w-auto"
                                        >
                                            {isSavingSettings ? (
                                                <>
                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                    Guardando...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="mr-1.5 h-3.5 w-3.5" />
                                                    Guardar parámetros
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </section>
                            </form>
                        </Form>

                        {/* Exportación y respaldo */}
                        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm lg:col-span-5">
                            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200/80 bg-blue-50 text-blue-600">
                                    <FileSpreadsheet className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-[13px] font-semibold text-slate-900">Respaldo y exportación</h2>
                                    <p className="text-[11px] text-slate-500">
                                        Copia en Excel de tu catálogo o ajustes
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2 lg:grid-cols-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setExportInventoryConfirmOpen(true)}
                                    disabled={isExportingInventory}
                                    className="h-9 justify-start rounded-lg border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    {isExportingInventory ? (
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-blue-600" />
                                    ) : (
                                        <DownloadCloud className="mr-2 h-3.5 w-3.5 text-blue-600" />
                                    )}
                                    <span className="truncate">
                                        {isExportingInventory ? "Exportando inventario..." : "Exportar inventario (.xlsx)"}
                                    </span>
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleExportSettings}
                                    className="h-9 justify-start rounded-lg border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    <DownloadCloud className="mr-2 h-3.5 w-3.5 text-emerald-600" />
                                    <span className="truncate">Exportar configuraciones (.xlsx)</span>
                                </Button>
                            </div>
                        </section>
                    </div>
                )}

                {/* TAB 3: EQUIPO Y CAJEROS */}
                {activeTab === 'team' && <CashiersManager />}
            </main>

            {/* Confirmación limpia para exportar inventario completo */}
            <AlertDialog open={exportInventoryConfirmOpen} onOpenChange={setExportInventoryConfirmOpen}>
                <AlertDialogContent className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-0 shadow-xl sm:max-w-[400px] sm:p-0">
                    <div className="px-5 py-5">
                        <AlertDialogHeader className="space-y-2 text-left">
                            <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600">
                                    <DownloadCloud className="h-4 w-4" />
                                </div>
                                <AlertDialogTitle className="text-base font-semibold text-slate-900">
                                    ¿Exportar inventario completo?
                                </AlertDialogTitle>
                            </div>
                            <AlertDialogDescription className="text-xs leading-relaxed text-slate-500">
                                Se leerán todos los productos del inventario desde Firestore para generar el archivo Excel. ¿Deseas continuar?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                    </div>
                    <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
                        <AlertDialogCancel className="mt-0 h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setExportInventoryConfirmOpen(false);
                                void runExportInventory();
                            }}
                            className="h-9 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-semibold text-white hover:opacity-95"
                        >
                            Exportar Excel
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
