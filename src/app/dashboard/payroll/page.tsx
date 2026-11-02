"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy } from "firebase/firestore";
import type { PayrollPayment, Worker, PaymentMethod } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { PlusCircle, Wallet, Trash2, Calendar, User, DollarSign, Landmark, History, Users, UserPlus } from "lucide-react";
import { format, parseISO, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SecurityGate } from "@/components/security-gate";

const BS_PAYMENT_METHODS: PaymentMethod[] = ['Efectivo Bs', 'Tarjeta / Pago Móvil', 'Transferencia'];

export default function PayrollPage() {
    return (
        <SecurityGate module="payroll">
            <PayrollContent />
        </SecurityGate>
    );
}

function PayrollContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency } = useCurrency();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isWorkerOpen, setIsWorkerOpen] = useState(false);

    const payrollCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "payroll_payments"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid]
    );
    const { data: payments, isLoading } = useCollection<PayrollPayment>(payrollCollection);

    const workersCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "workers"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid]
    );
    const { data: workers, isLoading: workersLoading } = useCollection<Worker>(workersCollection);

    const workerSummaries = useMemo(() => {
        if (!payments) return [];
        const summaries: Record<string, { usd: number, bs: number, count: number }> = {};
        
        payments.forEach(p => {
            const name = p.workerName.trim().toUpperCase();
            if (!summaries[name]) summaries[name] = { usd: 0, bs: 0, count: 0 };
            summaries[name].usd += p.amountUSD || 0;
            summaries[name].bs += p.amountBs || 0;
            summaries[name].count += 1;
        });

        return Object.entries(summaries).map(([name, data]) => ({ name, ...data }));
    }, [payments]);

    const handleDelete = (id: string) => {
        if (!firestore || !user) return;
        deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'payroll_payments', id));
        toast({ title: "Registro de pago eliminado", variant: "destructive" });
    };

    const handleDeleteWorker = (id: string) => {
        if (!firestore || !user) return;
        deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'workers', id));
        toast({ title: "Trabajador eliminado" });
    };

    return (
        <>
            <PageHeader title="Registro de Pagos al Personal" />
            <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
                <Tabs defaultValue="payments">
                    <TabsList className="bg-muted/50 p-1">
                        <TabsTrigger value="payments">Historial de Pagos</TabsTrigger>
                        <TabsTrigger value="workers">Lista de Personal</TabsTrigger>
                    </TabsList>

                    <TabsContent value="payments" className="space-y-6 mt-4">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <Card className="bg-primary/5 border-primary/20 shadow-sm">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-[10px] uppercase font-black text-muted-foreground flex items-center gap-2 tracking-widest">
                                        <Wallet className="w-3.5 h-3.5" /> Acumulado Pagado
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 pt-2">
                                    {workerSummaries.length === 0 ? (
                                        <p className="text-[10px] text-muted-foreground italic uppercase font-bold text-center py-4">Sin registros de pagos.</p>
                                    ) : workerSummaries.map(w => (
                                        <div key={w.name} className="flex justify-between items-center border-b border-primary/10 pb-2 last:border-0">
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black uppercase text-slate-700">{w.name}</span>
                                                <span className="text-[9px] text-muted-foreground font-bold">{w.count} registros</span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-black text-primary">${formatCurrency(w.usd)}</p>
                                                <p className="text-[9px] font-bold text-muted-foreground uppercase">Bs {formatCurrency(w.bs)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </div>

                        <Card className="shadow-md">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="flex items-center gap-2"><History className="w-5 h-5 text-primary"/> Bitácora de Pagos</CardTitle>
                                    <CardDescription>Registro histórico de cuánto, cómo y cuándo se pagó al personal.</CardDescription>
                                </div>
                                <AddPaymentDialog workers={workers || []} onAdded={() => setIsAddOpen(false)} isOpen={isAddOpen} setIsOpen={setIsAddOpen}>
                                    <Button className="shadow-lg"><PlusCircle className="mr-2 h-4 w-4" /> Registrar Nuevo Pago</Button>
                                </AddPaymentDialog>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/30">
                                            <TableHead className="text-[10px] font-black uppercase">Fecha Registro</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Trabajador</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Periodo Laborado</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase">Entrega USD</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase">Entrega Bs</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow><TableCell colSpan={6} className="text-center py-10">Cargando bitácora...</TableCell></TableRow>
                                        ) : !payments || payments.length === 0 ? (
                                            <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground uppercase font-black text-xs opacity-50">No hay pagos registrados aún.</TableCell></TableRow>
                                        ) : payments.map((p) => (
                                            <TableRow key={p.id} className="hover:bg-muted/20">
                                                <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">
                                                    {format(parseISO(p.createdAt), "dd/MM/yy hh:mm a")}
                                                </TableCell>
                                                <TableCell className="font-black text-xs uppercase text-slate-800">{p.workerName}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                                                        <span>{format(parseISO(p.dateFrom), "dd/MM/yy")}</span>
                                                        <span className="opacity-50">-</span>
                                                        <span>{format(parseISO(p.dateTo), "dd/MM/yy")}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-black text-primary">${formatCurrency(p.amountUSD)}</TableCell>
                                                <TableCell className="text-right font-bold text-slate-600 text-xs">Bs {formatCurrency(p.amountBs)}</TableCell>
                                                <TableCell className="text-right">
                                                    <AdminAuthDialog onAuthorized={() => handleDelete(p.id!)}>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AdminAuthDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="workers" className="mt-4">
                        <Card className="shadow-md">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary"/> Directorio de Personal</CardTitle>
                                    <CardDescription>Gestiona los nombres que aparecen en el registro de pagos.</CardDescription>
                                </div>
                                <AddWorkerDialog onAdded={() => setIsWorkerOpen(false)} isOpen={isWorkerOpen} setIsOpen={setIsWorkerOpen}>
                                    <Button variant="outline"><UserPlus className="mr-2 h-4 w-4" /> Nuevo Trabajador</Button>
                                </AddWorkerDialog>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="bg-muted/30">
                                        <TableRow>
                                            <TableHead className="text-[10px] font-black uppercase">Nombre del Trabajador</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Teléfono</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase">Fecha de Alta</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {workersLoading ? (
                                            <TableRow><TableCell colSpan={4} className="text-center py-10">Cargando...</TableCell></TableRow>
                                        ) : !workers || workers.length === 0 ? (
                                            <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground uppercase font-black text-xs opacity-50">Lista de personal vacía.</TableCell></TableRow>
                                        ) : workers.map((w) => (
                                            <TableRow key={w.id}>
                                                <TableCell className="font-black text-xs uppercase">{w.name}</TableCell>
                                                <TableCell className="text-xs font-bold text-muted-foreground">{w.phone || 'SIN TÉLF.'}</TableCell>
                                                <TableCell className="text-[10px] font-bold text-muted-foreground">{format(parseISO(w.createdAt), "dd/MM/yyyy")}</TableCell>
                                                <TableCell className="text-right">
                                                    <AdminAuthDialog onAuthorized={() => handleDeleteWorker(w.id!)}>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AdminAuthDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </main>
        </>
    );
}

function AddWorkerDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !name.trim()) return;

        setLoading(true);
        try {
            const workersRef = collection(firestore, 'users', user.uid, 'workers');
            const newDoc = doc(workersRef);
            await setDocumentNonBlocking(newDoc, {
                id: newDoc.id,
                name: name.trim().toUpperCase(),
                phone: phone.trim(),
                active: true,
                createdAt: new Date().toISOString()
            }, { merge: true });
            
            toast({ title: "Personal registrado" });
            setName(""); setPhone("");
            onAdded();
        } catch (e) {
            toast({ title: "Error al guardar", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Alta de Personal</DialogTitle>
                    <DialogDescription>Añade un trabajador o socio para poder registrar sus pagos.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-tighter">Nombre Completo</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="EJ: CARLOS RODRIGUEZ" className="uppercase" required />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-tighter">Teléfono</Label>
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0412-..." />
                    </div>
                    <DialogFooter>
                        <Button type="submit" className="w-full h-12 text-sm font-black" disabled={loading || !name.trim()}>
                            {loading ? "GUARDANDO..." : "REGISTRAR EN DIRECTORIO"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AddPaymentDialog({ children, onAdded, isOpen, setIsOpen, workers }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void, workers: Worker[] }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { bcvRate } = useCurrency();
    const [loading, setLoading] = useState(false);
    
    const [selectedWorkerId, setSelectedWorkerId] = useState("");
    const [amountUSD, setAmountUSD] = useState("");
    const [amountBs, setAmountBs] = useState("");
    const [methodBs, setMethodBs] = useState<PaymentMethod>("Tarjeta / Pago Móvil");
    
    const [dateFrom, setDateFrom] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
    const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
    const [notes, setNotes] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || loading || !selectedWorkerId) return;

        const worker = workers.find(w => w.id === selectedWorkerId);
        if (!worker) return;

        setLoading(true);
        try {
            const payrollRef = collection(firestore, 'users', user.uid, 'payroll_payments');
            const newPaymentDoc = doc(payrollRef);
            
            const data: PayrollPayment = {
                id: newPaymentDoc.id,
                workerId: worker.id,
                workerName: worker.name,
                amountUSD: parseFloat(amountUSD) || 0,
                amountBs: parseFloat(amountBs) || 0,
                methodUSD: 'Efectivo USD',
                methodBs: methodBs,
                dateFrom,
                dateTo,
                notes: notes.trim().toUpperCase(),
                createdAt: new Date().toISOString()
            };

            await setDocumentNonBlocking(newPaymentDoc, data, { merge: true });

            toast({ title: "Pago registrado correctamente" });
            setIsOpen(false);
            setAmountUSD(""); setAmountBs(""); setNotes(""); setSelectedWorkerId("");
            onAdded();
        } catch (e: any) {
            toast({ title: "Error al registrar", description: e.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Registrar Pago Manual</DialogTitle>
                    <DialogDescription>Indica cuánto dinero (USD/Bs) estás entregando al personal.</DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                    <div className="space-y-6">
                        <div className="space-y-4 p-4 bg-muted/50 rounded-xl border border-primary/5">
                            <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                                <Calendar className="w-3" /> Periodo a Liquidar
                            </Label>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold">Desde</Label>
                                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-xs" />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold">Hasta</Label>
                                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-xs" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label className="flex items-center gap-2 font-black text-xs uppercase tracking-tighter"><User className="w-4 h-4 text-primary"/> Beneficiario del Pago</Label>
                            <Select value={selectedWorkerId} onValueChange={setSelectedWorkerId}>
                                <SelectTrigger className="h-12 text-sm border-2 uppercase">
                                    <SelectValue placeholder="Seleccionar personal..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {workers.map(w => (
                                        <SelectItem key={w.id} value={w.id!} className="uppercase text-xs">{w.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="space-y-4">
                            <Label className="text-[10px] font-black uppercase text-primary tracking-widest">Montos Entregados</Label>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold text-slate-600">En Dólares ($)</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-3 h-4 w-4 text-primary" />
                                        <Input type="number" step="0.01" value={amountUSD} onChange={(e) => setAmountUSD(e.target.value)} className="pl-9 h-12 text-lg" placeholder="0.00" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold text-slate-600">En Bolívares (Bs)</Label>
                                    <div className="relative">
                                        <Landmark className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input type="number" step="0.01" value={amountBs} onChange={(e) => setAmountBs(e.target.value)} className="pl-9 h-12 text-lg" placeholder="0.00" />
                                    </div>
                                    <div className="flex justify-between items-center mt-1">
                                        <Select value={methodBs} onValueChange={(v: any) => setMethodBs(v)}>
                                            <SelectTrigger className="h-7 text-[9px] w-[150px] uppercase font-bold">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {BS_PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="text-[9px]">{m}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[9px] text-muted-foreground italic font-bold uppercase">Tasa Ref: {bcvRate.toFixed(2)} Bs</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Notas / Referencia</Label>
                            <Input value={notes} onChange={(e) => setNotes(e.target.value.toUpperCase())} placeholder="EJ: PAGO SEMANA 15, EFECTIVO CAJA..." className="uppercase text-xs" />
                        </div>

                        <Button type="submit" className="w-full h-14 text-lg font-black shadow-xl" disabled={loading || !selectedWorkerId}>
                            {loading ? "PROCESANDO..." : "CONFIRMAR Y REGISTRAR"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}