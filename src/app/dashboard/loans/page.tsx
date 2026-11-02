
"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy, runTransaction } from "firebase/firestore";
import type { Loan, Currency, PaymentMethod, Sale, PayrollPayment, Expense } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { PlusCircle, HandHelping, Trash2, Wallet, Landmark, DollarSign, Calculator, ArrowDownCircle, CreditCard, Smartphone, Banknote } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { SecurityGate } from "@/components/security-gate";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const paymentMethodOptions: { value: PaymentMethod, label: string, icon: any, isBs: boolean, hasReference: boolean }[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: DollarSign, isBs: false, hasReference: false },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: Landmark, isBs: true, hasReference: false },
    { value: 'Tarjeta / Pago Móvil', label: 'Tarjeta / Pago Móvil', icon: Smartphone, isBs: true, hasReference: true },
    { value: 'Transferencia', label: 'Transferencia', icon: Banknote, isBs: true, hasReference: true },
];

export default function LoansPage() {
    return (
        <SecurityGate module="loans">
            <LoansContent />
        </SecurityGate>
    );
}

function LoansContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, convert } = useCurrency();
    const [isAddOpen, setIsAddOpen] = useState(false);

    const loansCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "loans"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid]
    );
    const { data: loans, isLoading } = useCollection<Loan>(loansCollection);

    const activeLoansTotalUSD = useMemo(() => {
        if (!loans) return 0;
        return loans.filter(l => l.status === 'active').reduce((sum, l) => {
            // Evaluamos la deuda acumulada usando la tasa BCV estándar para reportes
            const amountUSD = l.currency === 'USD' ? l.remainingAmount : convert(l.remainingAmount, 'Bs', 'USD', false);
            return sum + amountUSD;
        }, 0);
    }, [loans, convert]);

    const handleDelete = (id: string) => {
        if (!firestore || !user) return;
        deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'loans', id));
        toast({ title: "Registro eliminado", variant: "destructive" });
    };

    return (
        <>
            <PageHeader title="Préstamos">
                <AddLoanDialog onAdded={() => setIsAddOpen(false)} isOpen={isAddOpen} setIsOpen={setIsAddOpen}>
                    <Button><PlusCircle className="mr-2 h-4 w-4" /> Nuevo Préstamo</Button>
                </AddLoanDialog>
            </PageHeader>
            <main className="flex-1 p-4 sm:p-6 space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="bg-primary/5 border-primary/20 shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-muted-foreground flex items-center gap-2">
                                <Wallet className="w-3.5 h-3.5" /> Deuda Total (Ref. USD)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-primary">${formatCurrency(activeLoansTotalUSD)}</div>
                            <p className="text-[10px] text-muted-foreground mt-1">Suma consolidada de todos los préstamos activos.</p>
                        </CardContent>
                    </Card>
                </div>

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><HandHelping className="w-5 h-5"/> Registro de Préstamos</CardTitle>
                        <CardDescription>Gestión de capital entregado a socios y modalidades de pago.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Socio</TableHead>
                                    <TableHead className="text-right">Monto Inicial</TableHead>
                                    <TableHead className="text-right">Saldo Restante</TableHead>
                                    <TableHead className="text-right text-primary">Cobro Semanal</TableHead>
                                    <TableHead className="text-center">Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={7} className="text-center py-10">Cargando préstamos...</TableCell></TableRow>
                                ) : !loans || loans.length === 0 ? (
                                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No hay préstamos registrados aún.</TableCell></TableRow>
                                ) : loans.map((loan) => (
                                    <TableRow key={loan.id}>
                                        <TableCell className="text-xs font-medium">
                                            {format(parseISO(loan.createdAt), "dd/MM/yy")}
                                        </TableCell>
                                        <TableCell className="font-bold">{loan.partnerName}</TableCell>
                                        <TableCell className="text-right font-medium">
                                            {loan.currency === 'USD' ? '$' : 'Bs'}{formatCurrency(loan.totalAmount)}
                                        </TableCell>
                                        <TableCell className="text-right font-black text-primary">
                                            {loan.currency === 'USD' ? '$' : 'Bs'}{formatCurrency(loan.remainingAmount)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end">
                                                {loan.hasWeeklyDeduction ? (
                                                    <>
                                                        <span className="font-bold text-primary">-{loan.currency === 'USD' ? '$' : 'Bs'}{formatCurrency(loan.weeklyDeduction)}</span>
                                                        <span className="text-[9px] text-muted-foreground uppercase font-bold">Autodescuento</span>
                                                    </>
                                                ) : (
                                                    <span className="text-[9px] text-muted-foreground italic">Sin descuento semanal</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={loan.status === 'active' ? 'destructive' : 'secondary'} className={cn(loan.status === 'paid' && "bg-green-100 text-green-700")}>
                                                {loan.status === 'active' ? 'PENDIENTE' : 'LIQUIDADO'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                {loan.status === 'active' && (
                                                    <ManualPaymentDialog loan={loan}>
                                                        <Button size="sm" variant="outline" className="h-8 text-green-600 border-green-200">
                                                            Abonar
                                                        </Button>
                                                    </ManualPaymentDialog>
                                                )}
                                                <AdminAuthDialog onAuthorized={() => handleDelete(loan.id!)}>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AdminAuthDialog>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </main>
        </>
    );
}

function AddLoanDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [partnerName, setPartnerName] = useState("");
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState<Currency>("USD");
    const [sourceMethod, setSourceMethod] = useState<PaymentMethod>("Efectivo USD");
    const [hasWeeklyDeduction, setHasWeeklyDeduction] = useState(true);
    const [deduction, setDeduction] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !partnerName.trim() || !amount) return;

        setLoading(true);
        try {
            const loansRef = collection(firestore, 'users', user.uid, 'loans');
            const newDoc = doc(loansRef);
            const data: Loan = {
                id: newDoc.id,
                partnerName: partnerName.trim(),
                totalAmount: parseFloat(amount),
                remainingAmount: parseFloat(amount),
                currency,
                sourceMethod,
                hasWeeklyDeduction,
                weeklyDeduction: hasWeeklyDeduction ? (parseFloat(deduction) || 0) : 0,
                status: 'active',
                createdAt: new Date().toISOString()
            };

            await setDocumentNonBlocking(newDoc, data, { merge: true });
            toast({ title: "Préstamo registrado exitosamente" });
            setPartnerName(""); setAmount(""); setDeduction(""); setHasWeeklyDeduction(true);
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
                    <DialogTitle>Registrar Nuevo Préstamo</DialogTitle>
                    <DialogDescription>Configura el monto y la modalidad de cobro del préstamo.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label>Nombre del Socio</Label>
                        <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="Ej: Socio 1" required />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Moneda</Label>
                            <Select value={currency} onValueChange={(v: any) => setCurrency(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="USD">Dólares ($)</SelectItem>
                                    <SelectItem value="Bs">Bolívares (Bs)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Monto Prestado</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-3 text-muted-foreground text-xs font-bold">{currency === 'USD' ? '$' : 'Bs'}</span>
                                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-8" placeholder="0.00" required />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>¿De dónde sale el dinero? (Para Saldo Real)</Label>
                        <Select value={sourceMethod} onValueChange={(v: any) => setSourceMethod(v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {paymentMethodOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="p-4 bg-muted/30 rounded-lg space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold">Descuento Semanal Automático</Label>
                                <p className="text-[10px] text-muted-foreground">Habilita esta opción para que Tesorería cobre la cuota cada semana.</p>
                            </div>
                            <Switch checked={hasWeeklyDeduction} onCheckedChange={setHasWeeklyDeduction} />
                        </div>

                        {hasWeeklyDeduction && (
                            <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                <Label className="text-xs uppercase font-black text-primary">Cuota Semanal a Descontar ({currency === 'USD' ? '$' : 'Bs'})</Label>
                                <Input type="number" step="0.01" value={deduction} onChange={(e) => setAddDeduction(e.target.value)} placeholder="0.00" required={hasWeeklyDeduction} />
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button type="submit" className="w-full h-12 text-base font-bold shadow-md" disabled={loading}>
                            {loading ? "Registrando..." : "Confirmar Préstamo"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function ManualPaymentDialog({ loan, children }: { loan: Loan, children: React.ReactNode }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { bcvRate, parallelRate, format: formatCurrency, convert } = useCurrency();
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState<PaymentMethod>("Efectivo USD");
    const [reference, setReference] = useState("");
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const selectedOption = paymentMethodOptions.find(o => o.value === method)!;

    // CRITICAL: Usamos tasa de reposición (true) para valuar abonos de deuda de socios
    const discountInLoanCurrency = useMemo(() => {
        const val = parseFloat(amount) || 0;
        if (loan.currency === 'USD') {
            return selectedOption.isBs ? convert(val, 'Bs', 'USD', true) : val;
        } else {
            return selectedOption.isBs ? val : convert(val, 'USD', 'Bs', true);
        }
    }, [amount, method, loan.currency, convert, selectedOption.isBs]);

    // Cuánto falta por pagar expresado en la moneda del MÉTODO DE PAGO elegido (Tasa Reposición)
    const remainingInSelectedMethod = useMemo(() => {
        const rem = loan.remainingAmount;
        if (loan.currency === 'USD') {
            return selectedOption.isBs ? convert(rem, 'USD', 'Bs', true) : rem;
        } else {
            return selectedOption.isBs ? rem : convert(rem, 'Bs', 'USD', true);
        }
    }, [loan.remainingAmount, loan.currency, selectedOption.isBs, convert]);

    const handleAbono = async () => {
        if (!firestore || !user || !amount || loading) return;
        
        setLoading(true);
        try {
            await runTransaction(firestore, async (transaction) => {
                const loanRef = doc(firestore, 'users', user.uid, 'loans', loan.id!);
                const loanSnap = await transaction.get(loanRef);
                if (!loanSnap.exists()) throw new Error("El préstamo ya no existe.");
                
                const currentLoan = loanSnap.data() as Loan;
                const newRemaining = Math.max(0, currentLoan.remainingAmount - discountInLoanCurrency);
                const isPaid = newRemaining <= 0.01;

                transaction.update(loanRef, {
                    remainingAmount: Number(newRemaining.toFixed(2)),
                    status: isPaid ? 'paid' : 'active'
                });

                const saleId = `S-LOAN-${Date.now()}`;
                const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', saleId);
                const finalNetAbonoInUSD = loan.currency === 'USD' ? discountInLoanCurrency : convert(discountInLoanCurrency, 'Bs', 'USD', true);

                const saleData: Sale = {
                    id: saleId,
                    items: [{ productId: loan.id!, name: `Abono Préstamo: ${loan.partnerName}`, quantity: 1, price: finalNetAbonoInUSD }],
                    totalAmount: finalNetAbonoInUSD,
                    subtotal: finalNetAbonoInUSD,
                    discount: 0,
                    paymentMethod: method,
                    transactionDate: new Date().toISOString(),
                    status: 'completed',
                    payments: [{ method, amount: parseFloat(amount), reference }],
                    actualPaidAmount: finalNetAbonoInUSD,
                    bcvRateAtTime: bcvRate,
                    parallelRateAtTime: parallelRate
                };
                transaction.set(saleRef, saleData);
            });

            toast({ title: "Abono registrado", description: "El saldo ha sido actualizado y el dinero entró a caja." });
            setOpen(false);
            setAmount("");
            setReference("");
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Registrar Abono al Préstamo</DialogTitle>
                    <DialogDescription>
                        Deuda pendiente de {loan.partnerName}: <span className="font-bold text-primary">{loan.currency === 'USD' ? '$' : 'Bs'}{formatCurrency(loan.remainingAmount)}</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label className="text-xs uppercase font-black text-muted-foreground">¿Cómo paga el socio?</Label>
                        <Select value={method} onValueChange={(v: any) => setMethod(v)}>
                            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {paymentMethodOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        <div className="flex items-center gap-2"><opt.icon className="w-4 h-4" /><span>{opt.label}</span></div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs uppercase font-black text-muted-foreground">Monto entregado por el socio ({selectedOption.isBs ? 'Bolívares' : 'Dólares'})</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-3 text-muted-foreground text-xs font-bold">{selectedOption.isBs ? 'Bs' : '$'}</span>
                                <Input 
                                    type="number" 
                                    step="0.01" 
                                    value={amount} 
                                    onChange={(e) => setAmount(e.target.value)} 
                                    placeholder="0.00" 
                                    className="pl-9 h-11 text-lg font-black" 
                                />
                            </div>
                            {loan.remainingAmount > 0 && (
                                <button 
                                    type="button"
                                    onClick={() => setAmount(remainingInSelectedMethod.toFixed(2))}
                                    className="text-[10px] font-black uppercase text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                                >
                                    PAGAR RESTANTE: {selectedOption.isBs ? 'Bs' : '$'}{formatCurrency(remainingInSelectedMethod)}
                                </button>
                            )}
                        </div>

                        {selectedOption.hasReference && (
                            <div className="space-y-2 animate-in fade-in duration-300">
                                <Label className="text-xs uppercase font-black text-muted-foreground">Referencia / Confirmación</Label>
                                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Nro. de Operación" className="h-11 font-mono" />
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Resumen del Descuento</p>
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground">Se restará a la deuda:</span>
                            <span className="text-lg font-black text-primary">
                                {loan.currency === 'USD' ? '$' : 'Bs'}{formatCurrency(discountInLoanCurrency)}
                            </span>
                        </div>
                    </div>

                    <Button className="w-full h-12 text-base font-black shadow-lg" onClick={handleAbono} disabled={!amount || parseFloat(amount) <= 0 || loading}>
                        {loading ? "PROCESANDO..." : "Confirmar y Aplicar Abono"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
