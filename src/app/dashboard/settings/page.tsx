"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogOut, ShieldCheck, UserCog, MoveHorizontal, PiggyBank, DownloadCloud, RefreshCw, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useDoc, useFirebase, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, useCollection } from "@/firebase";
import { doc, collection } from "firebase/firestore";
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
    
    const settingsRef = useMemoFirebase(() => 
        (firestore && user) ? doc(firestore, 'users', user.uid, 'app-settings', 'main') : null,
        [firestore, user?.uid]
    );
    const { data: settings } = useDoc<AppSettings>(settingsRef);

    const userProfileRef = useMemoFirebase(() =>
        (firestore && user) ? doc(firestore, 'users', user.uid) : null,
        [firestore, user?.uid]
    );
    const { data: profile } = useDoc<UserProfile>(userProfileRef);

    const productsCol = useMemoFirebase(() => (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null, [firestore, user?.uid]);
    const { data: products } = useCollection<Product>(productsCol);

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
        if (profile?.securityPin && currentPinVerify !== profile.securityPin) {
            toast({ variant: "destructive", title: "PIN Incorrecto" });
            return;
        }
        setIsUpdatingPin(true);
        try {
            const updateData: Partial<UserProfile> = { isPinRequired, lockedModules };
            if (newPin) updateData.securityPin = newPin;
            updateDocumentNonBlocking(userProfileRef, updateData);
            toast({ title: "Seguridad Actualizada" });
            setNewPin(""); setCurrentPinVerify("");
        } catch (e) { toast({ variant: "destructive", title: "Error" }); }
        finally { setIsUpdatingPin(false); }
    };

    const handleExportInventory = () => {
        if (!products) return;
        const worksheet = XLSX.utils.json_to_sheet(products);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
        XLSX.writeFile(workbook, "inventario.xlsx");
        toast({ title: "Inventario Exportado" });
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
                
                {/* 1. Seguridad de Gerente */}
                <Card className="shadow-md border-primary/20 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-primary uppercase font-bold text-sm">
                            <ShieldCheck className="w-5 h-5"/> Seguridad y Bloqueo de Módulos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                            <div className="space-y-0.5">
                                <Label className="text-base font-black uppercase">Seguridad por PIN</Label>
                                <p className="text-xs text-muted-foreground">Protege módulos sensibles con una clave de acceso.</p>
                            </div>
                            <Switch checked={isPinRequired} onCheckedChange={setIsPinRequired} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-white rounded-lg border space-y-3">
                                <Label className="text-xs font-black uppercase text-muted-foreground">Bloquear estas áreas:</Label>
                                {PROTECTABLE_MODULES.map(m => (
                                    <div key={m.id} className="flex items-center justify-between py-1 border-b last:border-0">
                                        <Label className="text-xs font-bold">{m.label}</Label>
                                        <Switch checked={lockedModules.includes(m.id)} onCheckedChange={() => setLockedModules(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])} disabled={!isPinRequired} />
                                    </div>
                                ))}
                            </div>
                            <div className="p-4 bg-white rounded-lg border space-y-4">
                                <Label className="text-[10px] font-black uppercase">Cambiar PIN</Label>
                                {profile?.securityPin && <Input type="password" value={currentPinVerify} onChange={(e) => setCurrentPinVerify(e.target.value)} placeholder="PIN Actual" className="h-10" />}
                                <Input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="Nuevo PIN (4-8 dígitos)" className="h-10" />
                                <Button className="w-full font-bold" onClick={handleUpdatePinSettings} disabled={isUpdatingPin}>Guardar PIN</Button>
                            </div>
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
        </>
    );
}
