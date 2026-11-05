"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogOut, ShieldCheck, UserCog, MoveHorizontal, PiggyBank, DownloadCloud, RefreshCw, Receipt, ShieldAlert, Lock, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, useMemoFirebase } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { doc, collection, getDocs, query, orderBy, startAfter, limit, documentId } from "firebase/firestore";
import { useEffect, useState, useMemo } from "react";
import type { AppSettings, UserProfile, Product, UserModule } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { signOut } from "firebase/auth";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { Textarea } from "@/components/ui/textarea";
import { SecurityGate } from "@/components/security-gate";
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
    const { firestore, auth, user } = useFirebase();
    const [isUpdatingPin, setIsUpdatingPin] = useState(false);
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
            businessName: "", businessAddress: "", businessRIF: "", 
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
            toast({ title: "Configuración Guardada" });
        } catch (e) { toast({ variant: "destructive", title: "Error" }); }
        finally { setIsSavingSettings(false); }
    };

    const handleSaveProfile = (values: z.infer<typeof profileSchema>) => {
        if (!userProfileRef) return;
        setDocumentNonBlocking(userProfileRef, values, { merge: true });
        toast({ title: "Perfil y Datos de Ticket Guardados" });
    };

    const handleUpdatePinSettings = async () => {
        if (!userProfileRef) return;
        
        // Si ya hay un PIN configurado, EXIGIR SIEMPRE el PIN actual para guardar cambios
        if (profile?.securityPin) {
            if (!currentPinVerify) {
                toast({ 
                    variant: "destructive", 
                    title: "PIN Actual Obligatorio", 
                    description: "Debes ingresar tu PIN de Administrador actual para guardar o modificar las reglas de seguridad." 
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
            const updateData: Partial<UserProfile> = { 
                isPinRequired, 
                lockedModules,
                isDataDeletionLocked,
                requirePinForProductEdit,
                protectedDataActions
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
            <main className="flex-1 p-4 sm:p-6 space-y-8 max-w-4xl mx-auto w-full pb-20">
                
                {/* 1. Bloqueo de Datos y Acciones Críticas */}
                <Card className="shadow-md border-destructive/20 bg-destructive/[0.02] overflow-hidden">
                    <CardHeader className="border-b bg-destructive/5 py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2 text-destructive uppercase font-black text-sm">
                                <ShieldAlert className="w-5 h-5"/> Bloqueo de Datos (Protección contra Eliminaciones)
                            </CardTitle>
                            <Badge variant={isDataDeletionLocked ? "destructive" : "outline"} className="text-[10px] font-bold">
                                {isDataDeletionLocked ? "PROTECCIÓN ACTIVA" : "DESACTIVADO"}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs">
                            Exige obligatoriamente el PIN de Administrador para anular ventas, eliminar reparaciones, productos o cuentas fiadas.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div className="flex items-center justify-between p-4 rounded-xl border bg-white shadow-sm">
                            <div className="space-y-0.5 max-w-[80%]">
                                <Label className="text-sm font-black uppercase text-foreground flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-destructive" /> Bloqueo de Eliminación de Registros
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Impide que empleados o cajeros borren información sensible sin autorización de Gerente.
                                </p>
                            </div>
                            <Switch 
                                checked={isDataDeletionLocked} 
                                onCheckedChange={(val) => {
                                    if (val) {
                                        setIsDataDeletionLocked(true);
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
                                                // Persistir de inmediato: no depende del botón Guardar.
                                                if (userProfileRef) {
                                                    updateDocumentNonBlocking(userProfileRef, { isDataDeletionLocked: false });
                                                }
                                            }
                                        );
                                    }
                                }} 
                            />
                        </div>

                        <div className="flex items-center justify-between p-4 rounded-xl border bg-white shadow-sm">
                            <div className="space-y-0.5 max-w-[80%]">
                                <Label className="text-sm font-black uppercase text-foreground flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-primary" /> Exigir PIN para editar productos
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Protege cambios de precio, stock y datos del producto. Si no hay PIN configurado,
                                    la edición solo muestra una advertencia (nunca un modal sin salida).
                                </p>
                                {!profile?.securityPin && (
                                    <p className="text-[10px] font-bold text-amber-600 uppercase">
                                        Crea un PIN abajo para poder activarlo.
                                    </p>
                                )}
                            </div>
                            <Switch
                                checked={requirePinForProductEdit}
                                disabled={!profile?.securityPin && !newPin}
                                onCheckedChange={(val) => {
                                    if (val && !profile?.securityPin && !newPin) {
                                        toast({
                                            title: "Define tu PIN",
                                            description: "Ingresa un PIN de 4 a 8 dígitos abajo para exigirlo al editar productos.",
                                        });
                                        return;
                                    }
                                    setRequirePinForProductEdit(val);
                                }}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-white rounded-xl border space-y-3 shadow-sm">
                                <div className="flex items-center justify-between border-b pb-2">
                                    <Label className="text-xs font-black uppercase text-muted-foreground flex items-center gap-1.5">
                                        <Trash2 className="w-3.5 h-3.5 text-destructive" /> Registros protegidos con PIN:
                                    </Label>
                                </div>
                                
                                <div className="flex items-center justify-between py-1.5 border-b">
                                    <div>
                                        <Label className="text-xs font-bold block">Reembolsos y Anulación de Ventas</Label>
                                        <span className="text-[10px] text-muted-foreground">Facturas y tickets</span>
                                    </div>
                                    <Switch 
                                        checked={protectedDataActions.deleteSales} 
                                        onCheckedChange={(v) => {
                                            if (v) {
                                                setProtectedDataActions(prev => ({ ...prev, deleteSales: true }));
                                            } else {
                                                requestAdminAuthorization(
                                                    "Desproteger Reembolsos y Ventas",
                                                    "Introduce el PIN de Administrador para permitir anular ventas sin contraseña.",
                                                    () => setProtectedDataActions(prev => ({ ...prev, deleteSales: false }))
                                                );
                                            }
                                        }} 
                                        disabled={!isDataDeletionLocked} 
                                    />
                                </div>

                                <div className="flex items-center justify-between py-1.5 border-b">
                                    <div>
                                        <Label className="text-xs font-bold block">Eliminación de Reparaciones</Label>
                                        <span className="text-[10px] text-muted-foreground">Órdenes de servicio técnico</span>
                                    </div>
                                    <Switch 
                                        checked={protectedDataActions.deleteRepairs} 
                                        onCheckedChange={(v) => {
                                            if (v) {
                                                setProtectedDataActions(prev => ({ ...prev, deleteRepairs: true }));
                                            } else {
                                                requestAdminAuthorization(
                                                    "Desproteger Reparaciones",
                                                    "Introduce el PIN de Administrador para permitir eliminar órdenes de servicio sin contraseña.",
                                                    () => setProtectedDataActions(prev => ({ ...prev, deleteRepairs: false }))
                                                );
                                            }
                                        }} 
                                        disabled={!isDataDeletionLocked} 
                                    />
                                </div>

                                <div className="flex items-center justify-between py-1.5 border-b">
                                    <div>
                                        <Label className="text-xs font-bold block">Eliminación de Productos</Label>
                                        <span className="text-[10px] text-muted-foreground">Catálogo e inventario de stock</span>
                                    </div>
                                    <Switch 
                                        checked={protectedDataActions.deleteProducts} 
                                        onCheckedChange={(v) => {
                                            if (v) {
                                                setProtectedDataActions(prev => ({ ...prev, deleteProducts: true }));
                                            } else {
                                                requestAdminAuthorization(
                                                    "Desproteger Catálogo de Productos",
                                                    "Introduce el PIN de Administrador para permitir eliminar productos sin contraseña.",
                                                    () => setProtectedDataActions(prev => ({ ...prev, deleteProducts: false }))
                                                );
                                            }
                                        }} 
                                        disabled={!isDataDeletionLocked} 
                                    />
                                </div>

                                <div className="flex items-center justify-between py-1.5 border-b">
                                    <div>
                                        <Label className="text-xs font-bold block">Eliminación de Fiados</Label>
                                        <span className="text-[10px] text-muted-foreground">Deudas y créditos de clientes</span>
                                    </div>
                                    <Switch 
                                        checked={protectedDataActions.deleteFiados} 
                                        onCheckedChange={(v) => {
                                            if (v) {
                                                setProtectedDataActions(prev => ({ ...prev, deleteFiados: true }));
                                            } else {
                                                requestAdminAuthorization(
                                                    "Desproteger Cuentas Fiadas",
                                                    "Introduce el PIN de Administrador para permitir eliminar deudas sin contraseña.",
                                                    () => setProtectedDataActions(prev => ({ ...prev, deleteFiados: false }))
                                                );
                                            }
                                        }} 
                                        disabled={!isDataDeletionLocked} 
                                    />
                                </div>

                                <div className="flex items-center justify-between py-1.5">
                                    <div>
                                        <Label className="text-xs font-bold block">Eliminación de Gastos</Label>
                                        <span className="text-[10px] text-muted-foreground">Egresos registrados de caja</span>
                                    </div>
                                    <Switch 
                                        checked={protectedDataActions.deleteExpenses} 
                                        onCheckedChange={(v) => {
                                            if (v) {
                                                setProtectedDataActions(prev => ({ ...prev, deleteExpenses: true }));
                                            } else {
                                                requestAdminAuthorization(
                                                    "Desproteger Gastos y Egresos",
                                                    "Introduce el PIN de Administrador para permitir eliminar egresos sin contraseña.",
                                                    () => setProtectedDataActions(prev => ({ ...prev, deleteExpenses: false }))
                                                );
                                            }
                                        }} 
                                        disabled={!isDataDeletionLocked} 
                                    />
                                </div>
                            </div>

                            <div className="p-4 bg-white rounded-xl border space-y-4 shadow-sm flex flex-col justify-between">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <Label className="text-xs font-black uppercase text-muted-foreground flex items-center gap-1.5">
                                            <Lock className="w-3.5 h-3.5 text-primary" /> PIN de Administrador
                                        </Label>
                                        {profile?.securityPin ? (
                                            <Badge variant="secondary" className="text-[9px] bg-green-50 text-green-700 border-green-200">
                                                PIN Configurado
                                            </Badge>
                                        ) : (
                                            <Badge variant="destructive" className="text-[9px]">
                                                Sin PIN Configurado
                                            </Badge>
                                        )}
                                    </div>

                                    {profile?.securityPin && (
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
                                            {profile?.securityPin ? "Nuevo PIN (Opcional)" : "Crear PIN de Administrador"}
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
                                </div>

                                <Button 
                                    className="w-full font-bold shadow-md uppercase" 
                                    onClick={handleUpdatePinSettings} 
                                    disabled={isUpdatingPin}
                                >
                                    {isUpdatingPin ? "Guardando..." : "Guardar Seguridad y PIN"}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Seguridad y Bloqueo de Módulos (Navegación) */}
                <Card className="shadow-md border-primary/20 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm">
                            <ShieldCheck className="w-5 h-5"/> Seguridad y Bloqueo de Módulos (Navegación)
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Controla qué áreas del menú lateral quedan ocultas o requieren PIN para abrirse.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-black uppercase">Bloqueo de Pestañas con PIN</Label>
                                <p className="text-xs text-muted-foreground">Oculta o bloquea los módulos seleccionados abajo.</p>
                            </div>
                            <Switch checked={isPinRequired} onCheckedChange={setIsPinRequired} />
                        </div>
                        <div className="p-4 bg-white rounded-lg border space-y-3">
                            <Label className="text-xs font-black uppercase text-muted-foreground">Bloquear acceso a:</Label>
                            {PROTECTABLE_MODULES.map(m => (
                                <div key={m.id} className="flex items-center justify-between py-1 border-b last:border-0">
                                    <Label className="text-xs font-bold">{m.label}</Label>
                                    <Switch checked={lockedModules.includes(m.id)} onCheckedChange={() => setLockedModules(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])} disabled={!isPinRequired} />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Perfil y Tickets */}
                <Card className="shadow-md">
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
                                </div>
                                <FormField control={profileForm.control} name="businessAddress" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-bold uppercase">Dirección / Ubicación</FormLabel>
                                        <FormControl><Input {...field} className="uppercase" placeholder="Av. Principal, Local 1" /></FormControl>
                                    </FormItem>
                                )} />

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                                        <div className="space-y-0.5">
                                            <Label className="text-xs font-bold uppercase">Mostrar RIF y Dirección en Ticket</Label>
                                            <p className="text-[10px] text-muted-foreground">Imprime encabezado completo en recibos.</p>
                                        </div>
                                        <FormField control={profileForm.control} name="showInfoOnReceipt" render={({ field }) => (
                                            <FormItem><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                                        )} />
                                    </div>
                                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                                        <div className="space-y-0.5">
                                            <Label className="text-xs font-bold uppercase">Mostrar Tasa en Ticket</Label>
                                            <p className="text-[10px] text-muted-foreground">Muestra la tasa de cambio aplicada.</p>
                                        </div>
                                        <FormField control={profileForm.control} name="showRateOnReceipt" render={({ field }) => (
                                            <FormItem><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
                                        )} />
                                    </div>
                                </div>

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
                                <Button type="submit" className="uppercase font-bold">Guardar Datos de Ticket</Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>

                {/* 3. Parámetros Financieros & Tasas */}
                <Card className="shadow-md">
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
                            className="font-bold text-xs uppercase border-primary/20 text-primary hover:bg-primary/5 gap-1.5"
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
                            </CardContent>
                            <CardFooter className="border-t pt-4"><Button type="submit" disabled={isSavingSettings} className="uppercase font-bold">Guardar Tasas</Button></CardFooter>
                        </form>
                    </Form>
                </Card>

                {/* 4. Exportar Datos */}
                <Card className="shadow-md p-6">
                    <h3 className="text-sm font-bold uppercase mb-4">Exportar Datos</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Button onClick={handleExportInventory} variant="outline" className="w-full"><DownloadCloud className="mr-2 h-4 w-4" /> Exportar Inventario</Button>
                        <Button onClick={handleExportSettings} variant="outline" className="w-full"><DownloadCloud className="mr-2 h-4 w-4" /> Exportar Configuraciones</Button>
                    </div>
                </Card>

                <div className="flex flex-col items-center gap-4 pt-8">
                    <Button variant="destructive" onClick={() => signOut(auth)} size="lg" className="uppercase font-bold w-full max-w-xs shadow-xl"><LogOut className="mr-2 h-5 w-5" /> Cerrar Sesión</Button>
                </div>
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
