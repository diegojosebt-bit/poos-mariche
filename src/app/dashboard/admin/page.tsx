
"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, setDocumentNonBlocking, useDoc, deleteDocumentNonBlocking, sendResetEmail } from "@/firebase";
import { collection, doc, query, limit, orderBy } from "firebase/firestore";
import type { UserProfile, UserModule } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, parseISO, isAfter, subMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useMemo, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Megaphone, Save, Trash2, Loader2, Users, LayoutGrid, ShieldOff, KeyRound, LockKeyhole, ShieldCheck, Briefcase, Activity, Database, Zap, Globe, Ban, CheckCircle2, CalendarDays, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";

const ALL_MODULES: { id: UserModule, label: string }[] = [
    { id: 'inventory', label: 'Inventario' },
    { id: 'pos', label: 'Punto de Venta' },
    { id: 'repairs', label: 'Reparaciones' },
    { id: 'expenses', label: 'Gastos / Egresos' },
    { id: 'fiados', label: 'Control de Fiados' },
    { id: 'reports', label: 'Reportes' },
    { id: 'analysis', label: 'Análisis de Negocio' },
];

export default function AdminPage() {
    return (
        <SecurityGate module="admin">
            <AdminContent />
        </SecurityGate>
    );
}

function AnnouncementEditor() {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const announcementRef = useMemoFirebase(() => 
        firestore ? doc(firestore, 'system', 'announcements') : null, 
        [firestore]
    );
    const { data: announcement, isLoading: isDocLoading } = useDoc<any>(announcementRef);
    
    // Estados locales para edición
    const [message, setMessage] = useState("");
    const [type, setType] = useState("info");
    const [active, setActive] = useState(false);
    
    // Estado crítico para controlar la carga inicial
    const [hasInitialized, setHasInitialized] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Efecto de inicialización única (Solo corre cuando llegan los datos por primera vez)
    useEffect(() => {
        if (!isDocLoading && !hasInitialized) {
            if (announcement) {
                setMessage(announcement.message || "");
                setType(announcement.type || "info");
                setActive(announcement.active || false);
            }
            setHasInitialized(true);
        }
    }, [announcement, isDocLoading, hasInitialized]);

    const handleSave = async () => {
        if (!announcementRef) return;
        
        setIsSaving(true);
        const newData = {
            message: message.trim(),
            type,
            active,
            updatedAt: new Date().toISOString()
        };

        try {
            await setDocumentNonBlocking(announcementRef, newData, { merge: true });
            toast({ title: "Comunicado Publicado", description: "Todos los negocios verán este mensaje ahora." });
        } catch (e) {
            toast({ variant: "destructive", title: "Error al publicar" });
        } finally {
            setIsSaving(false);
        }
    };

    if (!hasInitialized) {
        return (
            <Card className="h-full border-dashed flex items-center justify-center py-10">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary opacity-30" />
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Cargando Sistema...</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="border-primary/20 shadow-lg h-full overflow-hidden">
            <CardHeader className="bg-primary/5 pb-3">
                <CardTitle className="flex items-center gap-2 text-primary text-sm uppercase font-black">
                    <Megaphone className="w-4 h-4"/> Comunicado Global
                </CardTitle>
                <CardDescription className="text-[10px] font-bold">EMISIÓN DE ALERTAS DEL SISTEMA</CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
                <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">Mensaje del Administrador</Label>
                    <Input 
                        value={message} 
                        onChange={(e) => setMessage(e.target.value)} 
                        placeholder="Ej: Mantenimiento programado para hoy a las 8PM..." 
                        className="text-xs h-10 border-2"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Nivel de Alerta</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger className="h-9 text-xs font-bold uppercase"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="info" className="text-xs">Información (Azul)</SelectItem>
                                <SelectItem value="warning" className="text-xs">Advertencia (Amarillo)</SelectItem>
                                <SelectItem value="critical" className="text-xs">Crítico (Rojo)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                        <Switch checked={active} onCheckedChange={setActive} id="ann-active" />
                        <Label className="text-[10px] font-black uppercase cursor-pointer" htmlFor="ann-active">Visible</Label>
                    </div>
                </div>
                <Button 
                    className="w-full h-11 text-xs font-black uppercase tracking-widest shadow-xl" 
                    onClick={handleSave} 
                    disabled={isSaving}
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>} 
                    {isSaving ? "PUBLICANDO..." : "PUBLICAR COMUNICADO"}
                </Button>
            </CardContent>
        </Card>
    );
}

function UserEditDialog({ 
    user, 
    onSave, 
    onResetPin, 
    onSendResetEmail,
    isOpen, 
    onOpenChange 
}: { 
    user: UserProfile, 
    onSave: (data: Partial<UserProfile>) => void, 
    onResetPin: (userId: string) => void, 
    onSendResetEmail: (email: string) => void,
    isOpen: boolean, 
    onOpenChange: (val: boolean) => void 
}) {
    const [businessName, setBusinessName] = useState(user.businessName || "");
    const [email, setEmail] = useState(user.email || "");
    const [status, setStatus] = useState(user.licenseStatus);
    const [expiry, setExpiry] = useState(user.licenseExpiry?.split('T')[0] || "");
    const [enabledModules, setEnabledModules] = useState<UserModule[]>(user.enabledModules || ALL_MODULES.map(m => m.id));
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

    const handleToggleModule = (moduleId: UserModule) => {
        setEnabledModules(prev => prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]);
    };

    const handleSave = () => {
        onSave({ businessName, email, licenseStatus: status, licenseExpiry: expiry ? new Date(expiry).toISOString() : user.licenseExpiry, enabledModules });
        onOpenChange(false);
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0 border-none shadow-2xl">
                    <div className={cn("text-white p-6", status === 'expired' ? "bg-red-600" : "bg-slate-900")}>
                        <DialogHeader>
                            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2">
                                {status === 'expired' ? <Ban className="w-6 h-6" /> : <Briefcase className="w-6 h-6 text-primary-foreground" />} 
                                Gestión de Negocio
                            </DialogTitle>
                            <DialogDescription className="text-white/60 font-bold">
                                Perfil del Cliente: {user.email}
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    
                    <div className="p-6 space-y-8 bg-white">
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b pb-2 flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4" /> 1. Estatus de Licencia y Acceso
                            </h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2 p-4 rounded-xl border-2 bg-slate-50">
                                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Estado de Cuenta</Label>
                                    <Select value={status} onValueChange={(val: any) => setStatus(val)}>
                                        <SelectTrigger className={cn("font-black h-12", status === 'active' ? "text-green-600 border-green-200" : "text-red-600 border-red-200")}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active" className="text-green-600 font-black uppercase">Activa / Pagada</SelectItem>
                                            <SelectItem value="trial" className="text-blue-600 font-black uppercase">Periodo de Prueba</SelectItem>
                                            <SelectItem value="expired" className="text-red-600 font-black uppercase">Suspendida / Vencida</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-[9px] text-muted-foreground italic">Si seleccionas "Suspendida", el usuario perderá acceso al sistema de inmediato.</p>
                                </div>
                                <div className="space-y-2 p-4 rounded-xl border-2 bg-slate-50">
                                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Fecha de Vencimiento</Label>
                                    <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="font-black h-12" />
                                    <p className="text-[9px] text-muted-foreground italic">El sistema bloqueará el acceso automáticamente al pasar esta fecha.</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b pb-2 flex items-center gap-2">
                                <Users className="w-4 h-4" /> 2. Información Comercial
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold">Nombre del Establecimiento</Label>
                                    <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="uppercase font-bold" />
                                </div>
                                <div className="space-y-2 opacity-60">
                                    <Label className="text-xs font-bold">Correo de Acceso (ID)</Label>
                                    <Input value={email} disabled className="bg-slate-50" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 p-5 rounded-2xl bg-blue-50 border-2 border-blue-100 shadow-sm">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-700 flex items-center gap-2">
                                <KeyRound className="w-4 h-4" /> 3. Seguridad de Acceso
                            </h3>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-white p-3 rounded-xl border border-blue-200 flex flex-col justify-between gap-3">
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-800 uppercase">Contraseña</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">Envía link de recuperación.</p>
                                    </div>
                                    <Button 
                                        type="button" 
                                        variant="outline"
                                        className="h-9 font-black text-[10px] uppercase tracking-widest border-blue-600 text-blue-600"
                                        onClick={() => onSendResetEmail(user.email)}
                                    >
                                        Enviar Comando
                                    </Button>
                                </div>

                                <div className="bg-white p-3 rounded-xl border border-blue-200 flex flex-col justify-between gap-3">
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-800 uppercase">PIN Local</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">Borra el PIN de gerente olvidado.</p>
                                    </div>
                                    <Button 
                                        type="button" 
                                        variant="outline"
                                        className="h-9 font-black text-[10px] border-destructive/20 text-destructive hover:bg-destructive/5 uppercase tracking-widest"
                                        onClick={() => setIsResetConfirmOpen(true)}
                                    >
                                        Borrar PIN
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b pb-2 flex items-center gap-2">
                                <LayoutGrid className="w-4 h-4" /> 4. Módulos Habilitados
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {ALL_MODULES.map((m) => (
                                    <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border bg-slate-50 transition-all hover:border-primary/20">
                                        <Label className="text-xs font-bold uppercase text-slate-600">{m.label}</Label>
                                        <Switch checked={enabledModules.includes(m.id)} onCheckedChange={() => handleToggleModule(m.id)} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 bg-slate-50 border-t flex justify-between items-center">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="font-bold text-slate-500 uppercase">Cerrar</Button>
                        <Button 
                            onClick={handleSave} 
                            className={cn("h-12 px-10 font-black shadow-xl uppercase tracking-tighter", status === 'expired' ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-black")}
                        >
                            Confirmar Cambios
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 uppercase font-black">
                            <KeyRound className="text-destructive w-6 h-6" /> ¿Eliminar PIN?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600">
                            Esta acción borrará la clave actual de <span className="font-bold text-slate-900">{user.businessName}</span>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { onResetPin(user.uid); setIsResetConfirmOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 uppercase font-black">Confirmar</AlertDialogAction>
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

    // GATILLO DE SEGURIDAD Y CACHE (0 Lecturas al navegar gracias al useCollection global)
    const usersCollection = useMemoFirebase(() => 
        (firestore && currentUser) ? query(collection(firestore, "users"), limit(100)) : null, 
        [firestore, currentUser?.uid]
    );
    const { data: users, isLoading } = useCollection<UserProfile>(usersCollection);

    const activeUsers = useMemo(() => {
        if (!users) return 0;
        const fiveMinsAgo = subMinutes(new Date(), 5);
        return users.filter(u => u.updatedAt && isAfter(parseISO(u.updatedAt), fiveMinsAgo)).length;
    }, [users]);

    const handleUpdateUser = (userId: string, data: Partial<UserProfile>) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', userId);
        updateDocumentNonBlocking(userRef, data);
        toast({ title: "Cambios guardados" });
    };

    const handleSendPasswordReset = async (email: string) => {
        if (!auth) return;
        try {
            await sendResetEmail(auth, email);
            toast({ title: "Enlace enviado a " + email });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error al enviar" });
        }
    };

    const handleResetPin = (userId: string) => {
        if (!firestore) return;
        const userRef = doc(firestore, 'users', userId);
        updateDocumentNonBlocking(userRef, { securityPin: "", isPinRequired: false });
        toast({ title: "PIN Eliminado" });
    };

    const handleDeleteUser = () => {
        if (!firestore || !userToDelete) return;
        if (userToDelete.uid === currentUser?.uid) {
            toast({ title: "Acción Denegada", variant: "destructive" });
            setUserToDelete(null);
            return;
        }
        deleteDocumentNonBlocking(doc(firestore, 'users', userToDelete.uid));
        toast({ title: "Cuenta Eliminada" });
        setUserToDelete(null);
    };

    const sortedUsers = useMemo(() => {
        if (!users) return [];
        return [...users].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }, [users]);

    if (isLoading) {
        return (
            <div className="p-20 text-center">
                <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary opacity-20" />
            </div>
        );
    }

    return (
        <>
            <PageHeader title="Administración Central" />
            <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
                <div className="grid gap-6 md:grid-cols-2">
                    <Card className="shadow-sm border-primary/10">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-muted-foreground flex items-center gap-1.5">
                                <Globe className="w-3 h-3"/> Total Negocios Registrados
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-slate-800">{users?.length || 0}</div>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-green-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-green-600 flex items-center gap-1.5">
                                <Activity className="w-3 h-3"/> Negocios en Línea
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-green-600">{activeUsers}</div>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                    <div className="md:col-span-2">
                        <Card className="shadow-lg h-full">
                            <CardHeader className="flex flex-row items-center justify-between border-b bg-slate-50/50">
                                <div>
                                    <CardTitle className="text-lg font-black uppercase">Directorio de Clientes</CardTitle>
                                    <CardDescription className="text-[10px] font-bold uppercase">Gestión de accesos y licencias.</CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/30">
                                            <TableHead className="text-[10px] font-black uppercase">Negocio / Cliente</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Estado</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Registro</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Última Actividad</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {sortedUsers.map((u) => {
                                            const isOnline = u.updatedAt && isAfter(parseISO(u.updatedAt), subMinutes(new Date(), 5));
                                            const isActuallyExpired = u.licenseStatus === 'expired' || (u.licenseExpiry && isAfter(new Date(), parseISO(u.licenseExpiry)));

                                            return (
                                                <TableRow key={u.uid} className={cn("hover:bg-muted/10", isActuallyExpired && "bg-red-50/50")}>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn("w-2 h-2 rounded-full", isOnline ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" : "bg-slate-300")} />
                                                            <div className="flex flex-col">
                                                                <div className="font-black text-xs uppercase text-slate-800">{u.businessName || "SIN NOMBRE"}</div>
                                                                <div className="text-[9px] text-muted-foreground font-medium">{u.email}</div>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className={cn("text-[8px] font-black uppercase tracking-tighter px-1.5 py-0", !isActuallyExpired ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200")}>
                                                            {!isActuallyExpired ? 'ACTIVA' : 'SUSPENDIDA'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">
                                                        {u.createdAt ? format(parseISO(u.createdAt), "dd/MM/yy", { locale: es }) : 'N/A'}
                                                    </TableCell>
                                                    <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">
                                                        {u.updatedAt ? format(parseISO(u.updatedAt), "dd/MM/yy HH:mm", { locale: es }) : 'N/A'}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-1">
                                                            <Button 
                                                                variant={isActuallyExpired ? "destructive" : "outline"} 
                                                                size="sm" 
                                                                className="h-7 text-[9px] font-black uppercase" 
                                                                onClick={() => setEditingUser(u)}
                                                            >
                                                                Gestionar
                                                            </Button>
                                                            <Button variant="ghost" size="sm" className="h-7 w-7 text-destructive" onClick={() => setUserToDelete(u)}>
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                    <div className="md:col-span-1 space-y-6">
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
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-black uppercase">¿Eliminar este negocio?</AlertDialogTitle>
                        <AlertDialogDescription>Esta acción revocará el acceso permanentemente. No se puede deshacer.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-black">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
