"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogOut, ShieldCheck, UserCog, MoveHorizontal, PiggyBank, DownloadCloud, RefreshCw, Receipt, ShieldAlert, Lock, Trash2, Wrench, KeyRound, Package, HandCoins, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, useMemoFirebase } from "@/firebase";import { useDashboardStore } from "@/contexts/dashboard-context";
import { doc, collection, getDocs, query, orderBy, startAfter, limit, documentId } from "firebase/firestore";
import { useEffect, useState, useMemo } from "react";
import type { AppSettings, UserProfile, Product, UserModule } from "@/lib/types";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { Textarea } from "@/components/ui/textarea";
import { SecurityGate } from "@/components/security-gate";
import { ensureOnline } from "@/lib/offline-guard";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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

const PROTECTABLE_MODULES: { id: UserModule, label: string }[] = [
    { id: 'inventory', label: 'Inventario' },
    { id: 'pos', label: 'Punto de Venta' },
    { id: 'repairs', label: 'Reparaciones' },
    { id: 'expenses', label: 'Gastos / Egresos' },
    { id: 'fiados', label: 'Control de Fiados' },
    { id: 'reports', label: 'Reportes' },
    { id: 'analysis', label: 'Análisis de Negocio' },
];

export default function SettingsPage() {
    return (
        <SecurityGate module="settings">
            <SettingsContent />
        </SecurityGate>
    );
}

function SettingsContent() {
    const { toast } = useToast();
    const { firestore, user, auth } = useFirebase();
    const [isUpdatingPin, setIsUpdatingPin] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [ticketPrefsDirty, setTicketPrefsDirty] = useState(false);
    const [isRecoveringPin, setIsRecoveringPin] = useState(false);
    const [showPinRecovery, setShowPinRecovery] = useState(false);
    const [showPinEditor, setShowPinEditor] = useState(false);
    const [loginPassword, setLoginPassword] = useState("");
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [isFetchingOfficialRate, setIsFetchingOfficialRate] = useState(false);

    const settingsRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid, 'app-settings', 'main') : null, 
        [firestore, user?.uid]
    );

    const userProfileRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid) : null, 
        [firestore, user?.uid]
    );

    const handleFetchOfficialRateInSettings = async () => {
        setIsFetchingOfficialRate(true);
        try {
            const res = await fetch(`/api/bcv-rate?t=${Date.now()}`);
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();
            if (data && typeof data.bcvRate === 'number' && data.bcvRate > 0) {
                settingsForm.setValue('bcvRate', parseFloat(data.bcvRate.toFixed(4)));
                toast({
                    title: "Tasa Oficial Obtenida",
                    description: `BCV: ${data.bcvRate.toFixed(2)} Bs.`
                });
            } else {
                toast({ title: "No se pudo obtener la tasa oficial", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error al consultar la tasa oficial", variant: "destructive" });
        } finally {
            setIsFetchingOfficialRate(false);
        }
    };
    
    const { settings, profile, dataCache } = useDashboardStore();
    const hasSecurityPin = Boolean(profile?.securityPin && profile.securityPin.trim().length > 0);

    const settingsForm = useForm<z.infer<typeof settingsSchema>>({
        resolver: zodResolver(settingsSchema),
        defaultValues: { 
            bcvRate: 1, parallelRate: 1, profitMargin: 100, autoUpdateBcv: false,
            weeklyRent: 40, investmentPercentage: 30, partnersCount: 2, repairInputMode: 'both',
        }
    });

    const profileForm = useForm<z.infer<typeof profileSchema>>({
        resolver: zodResolver(profileSchema),
        defaultValues: { 
            businessName: "", businessAddress: "", businessRIF: "", businessPhone: "",
            showInfoOnReceipt: false, showRateOnReceipt: true, showTermsOnReceipt: true,
            printLeftMargin: 0, repairWarrantyPolicy: "", repairPickupPolicy: "", repairDisclaimer: ""
        }
    });

    const [newPin, setNewPin] = useState("");
    const [currentPinVerify, setCurrentPinVerify] = useState("");
    const [isPinRequired, setIsPinRequired] = useState(false);
    const [lockedModules, setLockedModules] = useState<UserModule[]>([]);
    const [isDataDeletionLocked, setIsDataDeletionLocked] = useState(true);
    const [requirePinForProductEdit, setRequirePinForProductEdit] = useState(false);
    const [protectedDataActions, setProtectedDataActions] = useState({
        deleteSales: true,
        deleteRepairs: true,
        deleteProducts: true,
        deleteFiados: true,
        deleteExpenses: true,
    });

    const securityDirty = useMemo(() => {
        if (newPin.trim() || currentPinVerify.trim()) return true;
        const profileLocked = profile?.isDataDeletionLocked !== false;
        const currentModules = [...lockedModules].sort().join(",");
        const savedModules = [...(profile?.lockedModules || [])].sort().join(",");
        return (
            isPinRequired !== Boolean(profile?.isPinRequired) ||
            isDataDeletionLocked !== profileLocked ||
            currentModules !== savedModules
        );
    }, [newPin, currentPinVerify, isPinRequired, isDataDeletionLocked, lockedModules, profile]);

    const [pinVerifyModal, setPinVerifyModal] = useState<{
        open: boolean;
        title: string;
        description: string;
        action: () => void;
    }>({
        open: false,
        title: "",
        description: "",
        action: () => {},
    });
    const [modalPinInput, setModalPinInput] = useState("");

    const requestAdminAuthorization = (title: string, description: string, action: () => void) => {
        if (!profile?.securityPin) {
            action();
            return;
        }
        setModalPinInput("");
        setPinVerifyModal({
            open: true,
            title,
            description,
            action,
        });
    };

    const handleConfirmModalPin = () => {
        if (!profile?.securityPin) {
            pinVerifyModal.action();
            setPinVerifyModal(prev => ({ ...prev, open: false }));
            return;
        }
        if (modalPinInput === profile.securityPin) {
            pinVerifyModal.action();
            setPinVerifyModal(prev => ({ ...prev, open: false }));
            setModalPinInput("");
            toast({ title: "Autorizado", description: "Identidad de Administrador verificada." });
        } else {
            toast({
                variant: "destructive",
                title: "PIN Incorrecto",
                description: "El PIN de Administrador no coincide. Acción denegada.",
            });
            setModalPinInput("");
        }
    };

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
                repairWarrantyPolicy: (profile.repairWarrantyPolicy || "4 DÍAS POR EL SERVICIO REALIZADO.").toUpperCase(),
                repairPickupPolicy: (profile.repairPickupPolicy || "7 DÍAS MÁXIMO UNA VEZ NOTIFICADO...").toUpperCase(),
                repairDisclaimer: (profile.repairDisclaimer || "NO NOS HACEMOS RESPONSABLES...").toUpperCase()
            });
            setIsPinRequired(profile.isPinRequired === true);
            setLockedModules(profile.lockedModules || ['reports', 'analysis']);
            setIsDataDeletionLocked(profile.isDataDeletionLocked ?? true);
            setRequirePinForProductEdit(profile.requirePinForProductEdit === true);
            setProtectedDataActions({
                deleteSales: profile.protectedDataActions?.deleteSales ?? true,
                deleteRepairs: profile.protectedDataActions?.deleteRepairs ?? true,
                deleteProducts: profile.protectedDataActions?.deleteProducts ?? true,
                deleteFiados: profile.protectedDataActions?.deleteFiados ?? true,
                deleteExpenses: profile.protectedDataActions?.deleteExpenses ?? true,
            });
        }
    }, [profile, profileForm]);

    const isRepairsEnabled = useMemo(() => profile?.enabledModules?.includes('repairs') ?? false, [profile?.enabledModules]);

    const handleSaveSettings = async (values: z.infer<typeof settingsSchema>) => {
        if (!settingsRef) return;
        setIsSavingSettings(true);
        try {
            await setDocumentNonBlocking(settingsRef, { ...values, lastUpdated: new Date().toISOString() }, { merge: true });
            if (userProfileRef) {
                await setDocumentNonBlocking(userProfileRef, {
                    showInfoOnReceipt: profileForm.getValues("showInfoOnReceipt"),
                    showRateOnReceipt: profileForm.getValues("showRateOnReceipt"),
                }, { merge: true });
            }
            settingsForm.reset(values);
            setTicketPrefsDirty(false);
            toast({ title: "Configuración Guardada" });
        } catch (e) { toast({ variant: "destructive", title: "Error" }); }
        finally { setIsSavingSettings(false); }
    };

    const handleSaveProfile = async (values: z.infer<typeof profileSchema>) => {
        if (!userProfileRef || isSavingProfile) return;
        setIsSavingProfile(true);
        try {
            await setDocumentNonBlocking(userProfileRef, values, { merge: true });
            profileForm.reset(values);
            setTicketPrefsDirty(false);
            toast({ title: "Perfil y Datos de Ticket Guardados" });
        } catch {
            toast({ variant: "destructive", title: "No se pudieron guardar los datos" });
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleRecoverPinWithPassword = async () => {
        if (!userProfileRef || !auth?.currentUser) return;
        if (!ensureOnline(toast, "Recuperar PIN")) return;
        if (!newPin || newPin.length < 4 || newPin.length > 8) {
            toast({ variant: "destructive", title: "PIN inválido", description: "Define primero un PIN nuevo de 4 a 8 dígitos." });
            return;
        }
        if (!loginPassword.trim()) {
            toast({ variant: "destructive", title: "Contraseña requerida", description: "Ingresa la contraseña con la que inicias sesión." });
            return;
        }

        setIsRecoveringPin(true);
        try {
            const email = auth.currentUser.email;
            if (!email) throw new Error("La cuenta no tiene correo asociado.");

            // Reautenticación real con Firebase: no se guarda ni se envía la contraseña a Firestore.
            const credential = EmailAuthProvider.credential(email, loginPassword);
            await reauthenticateWithCredential(auth.currentUser, credential);
            await updateDocumentNonBlocking(userProfileRef, { securityPin: newPin });

            setNewPin("");
            setCurrentPinVerify("");
            setLoginPassword("");
            setShowPinRecovery(false);
            toast({ title: "PIN recuperado", description: "La contraseña fue verificada y el PIN quedó actualizado." });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "No se pudo recuperar el PIN",
                description: "La contraseña de inicio de sesión no es correcta o no hay conexión.",
            });
        } finally {
            setIsRecoveringPin(false);
        }
    };

    const handleUpdatePinSettings = async () => {
        if (!userProfileRef) return;
        
        // Solo se exige el PIN actual si se va a cambiar el PIN.
        if (profile?.securityPin && newPin) {
            if (!currentPinVerify) {
                toast({ 
                    variant: "destructive", 
                    title: "PIN Actual Obligatorio", 
                    description: "Debes ingresar tu PIN de Administrador actual para cambiar el PIN." 
                });
                return;
            }
            if (currentPinVerify !== profile.securityPin) {
                toast({ 
                    variant: "destructive", 
                    title: "PIN Actual Incorrecto", 
                    description: "El PIN ingresado no coincide con tu PIN actual." 
                });
                return;
            }
        }
        
        if (newPin && (newPin.length < 4 || newPin.length > 8)) {
            toast({ variant: "destructive", title: "PIN Inválido", description: "El PIN debe tener entre 4 y 8 dígitos." });
            return;
        }
        if ((isDataDeletionLocked || isPinRequired || requirePinForProductEdit) && !profile?.securityPin && !newPin) {
            toast({ variant: "destructive", title: "PIN Requerido", description: "Define un PIN de Administrador (4 a 8 dígitos) para proteger los datos." });
            return;
        }

        setIsUpdatingPin(true);
        try {
            const unifiedProtected = {
                deleteSales: isDataDeletionLocked,
                deleteRepairs: isDataDeletionLocked,
                deleteProducts: isDataDeletionLocked,
                deleteFiados: isDataDeletionLocked,
                deleteExpenses: isDataDeletionLocked,
            };
            const updateData: Partial<UserProfile> = { 
                isPinRequired, 
                lockedModules,
                isDataDeletionLocked,
                requirePinForProductEdit: isDataDeletionLocked,
                protectedDataActions: unifiedProtected
            };
            if (newPin) updateData.securityPin = newPin;
            updateDocumentNonBlocking(userProfileRef, updateData);
            toast({ title: "Seguridad y Bloqueo de Datos Actualizados", description: "Reglas de protección de datos guardadas correctamente." });
            setNewPin(""); setCurrentPinVerify("");
        } catch (e) { toast({ variant: "destructive", title: "Error" }); }
        finally { setIsUpdatingPin(false); }
    };

    const handleExportInventory = async () => {
        if (!firestore || !user) return;
        if (!ensureOnline(toast, 'Exportar inventario')) return;
        try {
            const confirmed = window.confirm(
                'Se leerán todos los productos del inventario (puede consumir lecturas). ¿Continuar?',
            );
            if (!confirmed) return;

            // Paginado: la caché puede tener solo 100 productos (catálogo paginado).
            const prods: Product[] = [];
            let last: any = null;

            for (;;) {
                const base = collection(firestore, 'users', user.uid, 'products');
                const pageQuery = last
                    ? query(base, orderBy(documentId()), startAfter(last), limit(300))
                    : query(base, orderBy(documentId()), limit(300));

                const snap = await getDocs(pageQuery);
                prods.push(...snap.docs.map(d => ({ ...d.data(), id: d.id }) as Product));

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
            toast({ title: "Inventario Exportado" });
        } catch (e) {
            toast({ variant: "destructive", title: "Error al exportar inventario" });
        }
    };

    const handleExportSettings = () => {
        if (!settings) return;
        const worksheet = XLSX.utils.json_to_sheet([settings]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Configuracion");
        XLSX.writeFile(workbook, "configuracion.xlsx");
        toast({ title: "Configuración Exportada" });
    };

    return (
        <>
            <PageHeader title="Configuración" />
            <main className="flex flex-1 flex-col gap-8 p-4 sm:p-6 max-w-4xl mx-auto w-full pb-20">
                
                {/* 1. Bloqueo de Datos y Acciones Críticas */}
                <Card className="shadow-md border-destructive/20 bg-destructive/[0.02] overflow-hidden order-5">
                    <CardHeader className="border-b bg-destructive/5 py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2 text-destructive uppercase font-black text-sm">
                                <ShieldAlert className="w-5 h-5"/> Bloqueo de Datos
                            </CardTitle>
                            <Badge variant={isDataDeletionLocked ? "destructive" : "outline"} className="text-[10px] font-bold">
                                {isDataDeletionLocked ? "PROTECCIÓN ACTIVA" : "DESACTIVADO"}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs">
                            Protege con PIN ventas, reparaciones, productos, fiados, gastos y edición de productos.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div className="flex items-center justify-between p-4 rounded-xl border bg-white shadow-sm">
                            <div className="space-y-0.5 max-w-[80%]">
                                <Label className="text-sm font-black uppercase text-foreground flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-destructive" /> Protección con PIN
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Un solo interruptor protege todos los registros de la lista.
                                </p>
                            </div>
                            <Switch 
                                checked={isDataDeletionLocked} 
                                onCheckedChange={(val) => {
                                    if (val) {
                                        setIsDataDeletionLocked(true);
                                        setRequirePinForProductEdit(true);
                                        setProtectedDataActions({
                                            deleteSales: true,
                                            deleteRepairs: true,
                                            deleteProducts: true,
                                            deleteFiados: true,
                                            deleteExpenses: true,
                                        });
                                        if (!profile?.securityPin && !newPin) {
                                            toast({
                                                title: "Define tu PIN",
                                                description: "Ingresa un PIN de 4 dígitos abajo para activar la protección de datos."
                                            });
                                        }
                                    } else {
                                        requestAdminAuthorization(
                                            "Desactivar Bloqueo de Eliminación",
                                            "Introduce el PIN de Administrador para desactivar la protección contra eliminación de registros.",
                                            () => {
                                                setIsDataDeletionLocked(false);
                                                setRequirePinForProductEdit(false);
                                                const unprotected = {
                                                    deleteSales: false,
                                                    deleteRepairs: false,
                                                    deleteProducts: false,
                                                    deleteFiados: false,
                                                    deleteExpenses: false,
                                                };
                                                setProtectedDataActions(unprotected);
                                                // Persistir de inmediato: no depende del botón Guardar.
                                                if (userProfileRef) {
                                                    updateDocumentNonBlocking(userProfileRef, {
                                                        isDataDeletionLocked: false,
                                                        requirePinForProductEdit: false,
                                                        protectedDataActions: unprotected,
                                                    });
                                                }
                                            }
                                        );
                                    }
                                }} 
                            />
                        </div>

                        <div className="rounded-xl border bg-white p-4 shadow-sm">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {[
                                    { title: "Reembolsos y Anulación de Ventas", detail: "Facturas y tickets", icon: Receipt },
                                    { title: "Eliminación de Reparaciones", detail: "Órdenes de servicio técnico", icon: Wrench },
                                    { title: "Eliminación de Productos", detail: "Catálogo e inventario", icon: Package },
                                    { title: "Edición de Productos", detail: "Precios, stock y datos", icon: Lock },
                                    { title: "Eliminación de Fiados", detail: "Deudas y créditos", icon: HandCoins },
                                    { title: "Eliminación de Gastos", detail: "Egresos de caja", icon: DownloadCloud },
                                ].map((item) => (
                                    <div key={item.title} className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                                        <item.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                                        <div>
                                            <p className="text-[10px] font-black uppercase leading-tight">{item.title}</p>
                                            <p className="text-[9px] text-muted-foreground">{item.detail}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Button
                            type="button"
                            className="w-full font-bold uppercase"
                            onClick={handleUpdatePinSettings}
                            disabled={!securityDirty || isUpdatingPin}
                        >
                            {isUpdatingPin ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : "Guardar Bloqueo de Datos"}
                        </Button>
                        </CardContent>
                    </Card>

                    <Card className="shadow-md border-primary/20 order-3">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm">
                                <Lock className="w-5 h-5" /> Seguridad y PIN
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Crea o actualiza el PIN de Administrador. El bloqueo de módulos se habilita después de configurarlo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1">

                            <div className="p-4 bg-white rounded-xl border space-y-4 shadow-sm flex flex-col justify-between">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <Label className="text-xs font-black uppercase text-muted-foreground flex items-center gap-1.5">
                                            <Lock className="w-3.5 h-3.5 text-primary" /> PIN de Administrador
                                        </Label>
                                        {hasSecurityPin ? (
                                            <Badge variant="secondary" className="text-[9px] bg-green-50 text-green-700 border-green-200">
                                                PIN Configurado
                                            </Badge>
                                        ) : (
                                            <Badge variant="destructive" className="text-[9px]">
                                                Sin PIN Configurado
                                            </Badge>
                                        )}
                                    </div>

                                    {hasSecurityPin && !showPinEditor && (
                                        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                                            <span className="text-[10px] font-black uppercase text-green-700">
                                                PIN activo
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setShowPinEditor(true)}
                                                className="text-[10px] font-black uppercase text-primary hover:underline"
                                            >
                                                Cambiar PIN
                                            </button>
                                        </div>
                                    )}

                                    {(!hasSecurityPin || showPinEditor) && (
                                        <>
                                    {hasSecurityPin && (
                                        <div className="flex justify-end">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowPinEditor(false);
                                                    setShowPinRecovery(false);
                                                    setNewPin("");
                                                    setCurrentPinVerify("");
                                                    setLoginPassword("");
                                                }}
                                                className="text-[10px] font-black uppercase text-destructive transition-colors hover:text-green-600"
                                            >
                                                Cancelar cambio de PIN
                                            </button>
                                        </div>
                                    )}
                                    {hasSecurityPin && (
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-bold uppercase text-muted-foreground">PIN Actual</Label>
                                            <Input 
                                                type="password" 
                                                value={currentPinVerify} 
                                                onChange={(e) => setCurrentPinVerify(e.target.value)} 
                                                placeholder="PIN Actual" 
                                                className="h-10 text-center font-mono tracking-widest" 
                                                maxLength={8}
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-1">
                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                                            {hasSecurityPin ? "Nuevo PIN (Opcional)" : "Crear PIN de Administrador"}
                                        </Label>
                                        <Input 
                                            type="password" 
                                            value={newPin} 
                                            onChange={(e) => setNewPin(e.target.value)} 
                                            placeholder="4 a 8 dígitos" 
                                            className="h-10 text-center font-mono tracking-widest text-lg font-black" 
                                            maxLength={8}
                                        />
                                        <p className="text-[10px] text-muted-foreground">
                                            PIN único para autorizar eliminaciones y desbloquear módulos.
                                        </p>
                                    </div>

                                    {hasSecurityPin && (
                                        <div className="border-t pt-3 space-y-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowPinRecovery((prev) => {
                                                        if (prev) setLoginPassword("");
                                                        return !prev;
                                                    });
                                                }}
                                                className="flex items-center gap-1.5 text-[10px] font-black uppercase text-primary hover:underline"
                                            >
                                                <KeyRound className="w-3.5 h-3.5" />
                                                ¿Olvidaste tu PIN? Recuperar con contraseña
                                            </button>
                                            {showPinRecovery && (
                                                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                                                        Contraseña de inicio de sesión
                                                    </Label>
                                                    <Input
                                                        type="password"
                                                        autoComplete="current-password"
                                                        value={loginPassword}
                                                        onChange={(event) => setLoginPassword(event.target.value)}
                                                        placeholder="Tu contraseña de COBRANZA ONLINE"
                                                        className="h-9"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        className="w-full font-bold uppercase"
                                                        onClick={handleRecoverPinWithPassword}
                                                        disabled={isRecoveringPin || !newPin || !loginPassword.trim()}
                                                    >
                                                        {isRecoveringPin ? "Verificando..." : "Verificar y recuperar PIN"}
                                                    </Button>
                                                    <p className="text-[9px] text-muted-foreground">
                                                        La contraseña se verifica directamente con Firebase y no se guarda. Escribe arriba el nuevo PIN antes de recuperar.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                        </>
                                    )}

                                    {hasSecurityPin && (
                                        <div className="space-y-3 border-t pt-4">
                                            <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                                                <div className="space-y-0.5">
                                                    <Label className="text-xs font-black uppercase">Bloqueo de Pestañas con PIN</Label>
                                                    <p className="text-[10px] text-muted-foreground">Oculta o bloquea los módulos seleccionados abajo.</p>
                                                </div>
                                                <Switch checked={isPinRequired} onCheckedChange={setIsPinRequired} />
                                            </div>
                                            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                                                <Label className="text-[10px] font-black uppercase text-muted-foreground">Bloquear acceso a:</Label>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                    {PROTECTABLE_MODULES.map(m => (
                                                        <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2">
                                                            <Label className="text-xs font-bold">{m.label}</Label>
                                                            <Switch checked={lockedModules.includes(m.id)} onCheckedChange={() => setLockedModules(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])} disabled={!isPinRequired} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <Button 
                                    className="w-full font-bold shadow-md uppercase" 
                                    onClick={handleUpdatePinSettings} 
                                    disabled={!securityDirty || isUpdatingPin}
                                >
                                    {isUpdatingPin ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : hasSecurityPin ? "Guardar Bloqueo de Módulos" : "Guardar PIN y Seguridad"}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Políticas y Reparaciones */}
                <Card className="shadow-md order-6">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm">
                            <Wrench className="w-5 h-5" /> Políticas y Reparaciones
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Calibración de impresión y políticas que se incluyen en los tickets de reparación.
                        </CardDescription>
                    </CardHeader>
                    <Form {...profileForm}>
                        <form onSubmit={profileForm.handleSubmit(handleSaveProfile)}>
                            <CardContent className="space-y-6">
                                <div className="p-4 rounded-xl border bg-muted/20 space-y-4">
                                    <div className="flex items-center gap-3"><MoveHorizontal className="w-5 h-5 text-primary" /><Label className="text-sm font-black uppercase">Calibración Margen Impresora Térmica (mm)</Label></div>
                                    <FormField control={profileForm.control} name="printLeftMargin" render={({ field }) => (
                                        <FormItem className="space-y-4">
                                            <div className="flex justify-between items-center">
                                                <FormLabel className="text-[10px] font-bold uppercase">Margen Izquierdo</FormLabel>
                                                <Badge>{field.value}mm</Badge>
                                            </div>
                                            <FormControl>
                                                <Slider value={[field.value]} max={10} step={1} onValueChange={(vals) => field.onChange(vals[0])} />
                                            </FormControl>
                                        </FormItem>
                                    )} />
                                </div>

                                {isRepairsEnabled && (
                                    <div className="space-y-4 border-t pt-4">
                                        <Label className="text-xs font-black uppercase text-primary">Políticas de Reparaciones para Tickets</Label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <FormField control={profileForm.control} name="repairWarrantyPolicy" render={({ field }) => (
                                                <FormItem><FormLabel className="text-[10px] font-bold uppercase">Garantía del Servicio</FormLabel><FormControl><Textarea {...field} className="h-16 uppercase text-xs" /></FormControl></FormItem>
                                            )} />
                                            <FormField control={profileForm.control} name="repairPickupPolicy" render={({ field }) => (
                                                <FormItem><FormLabel className="text-[10px] font-bold uppercase">Política de Retiro de Equipos</FormLabel><FormControl><Textarea {...field} className="h-16 uppercase text-xs" /></FormControl></FormItem>
                                            )} />
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="border-t pt-4">
                                <Button type="submit" disabled={!profileForm.formState.isDirty || isSavingProfile} className="uppercase font-bold">
                                    {isSavingProfile ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : "Guardar Políticas"}
                                </Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                {/* 2. Perfil y Tickets */}
                <Card className="shadow-md order-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 uppercase font-bold text-sm">
                            <Receipt className="w-5 h-5 text-primary"/> Datos del Negocio y Tickets
                        </CardTitle>
                        <CardDescription>
                            Información que se imprime en las notas de venta y tickets térmicos.
                        </CardDescription>
                    </CardHeader>
                    <Form {...profileForm}>
                        <form onSubmit={profileForm.handleSubmit(handleSaveProfile)}>
                            <CardContent className="space-y-6">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <FormField control={profileForm.control} name="businessName" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase">Nombre del Negocio</FormLabel>
                                            <FormControl><Input {...field} className="uppercase" placeholder="MI NEGOCIO C.A." /></FormControl>
                                        </FormItem>
                                    )} />
                                    <FormField control={profileForm.control} name="businessRIF" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase">RIF / Identificación Fiscal</FormLabel>
                                            <FormControl><Input {...field} className="uppercase" placeholder="J-12345678-0" /></FormControl>
                                        </FormItem>
                                    )} />
                                    <FormField control={profileForm.control} name="businessPhone" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase">Teléfono</FormLabel>
                                            <FormControl><Input {...field} type="tel" inputMode="tel" placeholder="0412-0000000" /></FormControl>
                                        </FormItem>
                                    )} />
                                    <FormField control={profileForm.control} name="businessAddress" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase">Dirección / Ubicación</FormLabel>
                                            <FormControl><Input {...field} className="uppercase" placeholder="Av. Principal, Local 1" /></FormControl>
                                        </FormItem>
                                    )} />
                                </div>
                            </CardContent>
                            <CardFooter className="border-t pt-4">
                                <Button type="submit" disabled={!profileForm.formState.isDirty || isSavingProfile} className="uppercase font-bold">
                                    {isSavingProfile ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : "Guardar Datos de Ticket"}
                                </Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                {/* 3. Parámetros Financieros & Tasas */}
                <Card className="shadow-md order-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm"><PiggyBank className="w-5 h-5" /> Parámetros Financieros</CardTitle>
                            <CardDescription>Configura la tasa oficial BCV, tasa de reposición y margen de ganancia.</CardDescription>
                        </div>
                        <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            onClick={handleFetchOfficialRateInSettings} 
                            disabled={isFetchingOfficialRate}
                            className="font-bold text-xs uppercase border-primary/20 text-primary hover:bg-primary/5 hover:text-primary gap-1.5"
                        >
                            <RefreshCw className={cn("w-3.5 h-3.5", isFetchingOfficialRate && "animate-spin")} />
                            {isFetchingOfficialRate ? "Consultando..." : "Consultar BCV Oficial"}
                        </Button>
                    </CardHeader>
                    <Form {...settingsForm}>
                        <form onSubmit={settingsForm.handleSubmit(handleSaveSettings)}>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <FormField control={settingsForm.control} name="bcvRate" render={({ field }) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Tasa BCV</FormLabel><FormControl><Input type="number" step="0.0001" {...field} /></FormControl></FormItem>} />
                                    <FormField control={settingsForm.control} name="parallelRate" render={({ field }) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Tasa Reposición</FormLabel><FormControl><Input type="number" step="0.0001" {...field} /></FormControl></FormItem>} />
                                    <FormField control={settingsForm.control} name="profitMargin" render={({ field }) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Margen Global (%)</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>} />
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                                    <div className="space-y-0.5">
                                        <Label className="text-xs font-black uppercase">Sincronización Automática BCV</Label>
                                        <p className="text-[11px] text-muted-foreground">Actualiza automáticamente la tasa del sistema cuando cambie la tasa oficial BCV.</p>
                                    </div>
                                    <FormField control={settingsForm.control} name="autoUpdateBcv" render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                            </FormControl>
                                        </FormItem>
                                    )} />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                                        <div className="space-y-0.5">
                                            <Label className="text-xs font-bold uppercase">Mostrar Tasa BCV en Ticket</Label>
                                            <p className="text-[10px] text-muted-foreground">Imprime la tasa aplicada en el recibo.</p>
                                        </div>
                                        <Switch
                                            checked={profileForm.watch("showRateOnReceipt")}
                                            onCheckedChange={(value) => {
                                                profileForm.setValue("showRateOnReceipt", value, { shouldDirty: true });
                                                setTicketPrefsDirty(true);
                                            }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                                        <div className="space-y-0.5">
                                            <Label className="text-xs font-bold uppercase">Mostrar Dirección en Ticket</Label>
                                            <p className="text-[10px] text-muted-foreground">Incluye RIF y dirección del negocio.</p>
                                        </div>
                                        <Switch
                                            checked={profileForm.watch("showInfoOnReceipt")}
                                            onCheckedChange={(value) => {
                                                profileForm.setValue("showInfoOnReceipt", value, { shouldDirty: true });
                                                setTicketPrefsDirty(true);
                                            }}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="border-t pt-4">
                                <Button type="submit" disabled={isSavingSettings || (!settingsForm.formState.isDirty && !ticketPrefsDirty)} className="uppercase font-bold">
                                    {isSavingSettings ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : "Guardar Parámetros"}
                                </Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                {/* 4. Exportar Datos */}
                <Card className="shadow-md p-6 order-7">
                    <h3 className="text-sm font-bold uppercase mb-4">Exportar Datos</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Button onClick={handleExportInventory} variant="outline" className="w-full"><DownloadCloud className="mr-2 h-4 w-4" /> Exportar Inventario</Button>
                        <Button onClick={handleExportSettings} variant="outline" className="w-full"><DownloadCloud className="mr-2 h-4 w-4" /> Exportar Configuraciones</Button>
                    </div>
                </Card>
            </main>

            <Dialog
                open={pinVerifyModal.open}
                onOpenChange={(open) => {
                    setPinVerifyModal(prev => ({ ...prev, open }));
                    if (!open) setModalPinInput("");
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="uppercase font-black text-sm">{pinVerifyModal.title}</DialogTitle>
                        <DialogDescription className="text-xs">{pinVerifyModal.description}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-3">
                        <Label className="text-[10px] font-black uppercase">PIN de Administrador</Label>
                        <Input
                            type="password"
                            name="mm-settings-admin-pin"
                            autoComplete="new-password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            spellCheck={false}
                            autoCorrect="off"
                            autoCapitalize="none"
                            value={modalPinInput}
                            onChange={(e) => setModalPinInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleConfirmModalPin();
                                }
                            }}
                            autoFocus
                            maxLength={8}
                            placeholder="••••"
                            className="text-center text-xl font-black tracking-widest h-12"
                        />
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setPinVerifyModal(prev => ({ ...prev, open: false }));
                                setModalPinInput("");
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button onClick={handleConfirmModalPin} disabled={!modalPinInput.trim()}>
                            Autorizar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
