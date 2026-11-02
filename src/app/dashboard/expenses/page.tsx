"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy } from "firebase/firestore";
import type { Expense, PaymentMethod, ExpenseCategory } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { PlusCircle, Trash2, Receipt, Search, Calendar as CalendarIcon, X as ClearIcon, ArrowDownCircle, DollarSign, Landmark } from "lucide-react";
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { SecurityGate } from "@/components/security-gate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES: ExpenseCategory[] = ["Mercancía", "Servicios", "Alquiler", "Retiro Personal", "Otros"];
const BS_PAYMENT_METHODS: PaymentMethod[] = ['Efectivo Bs', 'Tarjeta / Pago Móvil', 'Transferencia'];

export default function ExpensesPage() {
    return (
        <SecurityGate module="expenses">
            <ExpensesContent />
        </SecurityGate>
    );
}

function ExpensesContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, convert, bcvRate } = useCurrency();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
    });

    const expensesCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "expenses"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid]
    );
    const { data: expenses, isLoading, mutate: mutateExpenses } = useCollection<Expense>(expensesCollection);

    const filteredExpenses = useMemo(() => {
        if (!expenses) return [];
        return expenses.filter(ex => {
            const matchesSearch = ex.description.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = categoryFilter === "ALL" || ex.category === categoryFilter;
            
            let matchesDate = true;
            if (dateRange?.from) {
                const date = parseISO(ex.createdAt);
                const from = startOfDay(dateRange.from);
                const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
                matchesDate = isValid(date) && isWithinInterval(date, { start: from, end: to });
            }

            return matchesSearch && matchesCategory && matchesDate;
        });
    }, [expenses, searchTerm, categoryFilter, dateRange]);

    const stats = useMemo(() => {
        let usd = 0;
        let bs = 0;
        filteredExpenses.forEach(ex => {
            usd += ex.amountUSD || 0;
            bs += ex.amountBs || 0;
        });
        return { usd, bs, totalUSD: usd + convert(bs, 'Bs', 'USD') };
    }, [filteredExpenses, convert]);

    const handleDelete = (id: string) => {
        if (!firestore || !user || !id) return;
        
        // Optimistic delete
        mutateExpenses((prev) => prev?.filter(ex => ex.id !== id) || null);
        
        deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'expenses', id));
        toast({ title: "Gasto eliminado", variant: "destructive" });
    };

    const handleExpenseAdded = (newExpense: Expense) => {
        mutateExpenses((prev) => [newExpense as any, ...(prev || [])]);
        setIsAddOpen(false);
    };

    return (
        <>
            <PageHeader title="Control de Gastos">
                <div className="flex items-center gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className={cn("w-auto justify-start text-left font-normal bg-white", !dateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                <span className="hidden sm:inline">
                                    {dateRange?.from ? (
                                        dateRange.to ? `${format(dateRange.from, "dd/MM/yy")} - ${format(dateRange.to, "dd/MM/yy")}` : format(dateRange.from, "dd/MM/yy")
                                    ) : "Filtrar por fecha"}
                                </span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} locale={es} />
                        </PopoverContent>
                    </Popover>
                    
                    <AddExpenseDialog onAdded={handleExpenseAdded} isOpen={isAddOpen} setIsOpen={setIsAddOpen}>
                        <Button size="sm" className="shadow-lg"><PlusCircle className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Registrar</span> Gasto</Button>
                    </AddExpenseDialog>
                </div>
            </PageHeader>

            <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="bg-destructive/10 border-destructive/20 shadow-sm relative overflow-hidden">
                        <div className="absolute right-2 top-2 opacity-5"><ArrowDownCircle className="w-16 h-16 text-destructive" /></div>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-destructive tracking-widest">Total Gastos (Ref. USD)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-destructive">${formatCurrency(stats.totalUSD)}</div>
                            <p className="text-[9px] text-muted-foreground mt-1 uppercase font-bold">Consolidado del periodo</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-white border-2 border-primary/10 shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">En Dólares</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-slate-800">${formatCurrency(stats.usd)}</div>
                            <p className="text-[9px] text-muted-foreground mt-1 uppercase font-bold">Efectivo USD entregado</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-white border-2 border-primary/10 shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">En Bolívares</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-primary">Bs {formatCurrency(stats.bs)}</div>
                            <p className="text-[9px] text-muted-foreground mt-1 uppercase font-bold">Eq. ~${formatCurrency(convert(stats.bs, 'Bs', 'USD'))}</p>
                        </CardContent>
                    </Card>
                </div>

                <Card className="shadow-md">
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b bg-slate-50/50">
                        <div>
                            <CardTitle className="text-lg font-black uppercase flex items-center gap-2">
                                <Receipt className="w-5 h-5 text-primary"/> Bitácora de Gastos
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold uppercase">Control de egresos administrativos y operativos.</CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Buscar descripción..." 
                                    className="pl-8 h-9 text-xs uppercase" 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                <SelectTrigger className="w-full sm:w-40 h-9 text-xs">
                                    <SelectValue placeholder="Categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Todas las Categorías</SelectItem>
                                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30">
                                    <TableHead className="text-[10px] font-black uppercase">Fecha</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">Descripción</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">Categoría</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Monto Salida</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">Método</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10">Cargando...</TableCell></TableRow>
                                ) : filteredExpenses.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic uppercase font-bold text-xs opacity-50">No hay gastos en este periodo.</TableCell></TableRow>
                                ) : filteredExpenses.map((ex) => {
                                    const date = parseISO(ex.createdAt);
                                    return (
                                        <TableRow key={ex.id} className="hover:bg-muted/10">
                                            <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">
                                                {isValid(date) ? format(date, "dd/MM/yy hh:mm a") : 'N/A'}
                                            </TableCell>
                                            <TableCell className="font-black text-xs uppercase text-slate-800">{ex.description}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[8px] font-black uppercase px-2 border-primary/20">
                                                    {ex.category}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex flex-col items-end">
                                                    {ex.amountUSD > 0 && <span className="font-black text-destructive">-${formatCurrency(ex.amountUSD)}</span>}
                                                    {ex.amountBs > 0 && <span className="font-bold text-amber-600 text-[10px]">Bs {formatCurrency(ex.amountBs)}</span>}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-[10px] font-bold uppercase text-slate-600">{ex.amountUSD > 0 ? ex.methodUSD : ex.methodBs}</span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <AdminAuthDialog onAuthorized={() => handleDelete(ex.id!)}>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AdminAuthDialog>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </main>
        </>
    );
}

function AddExpenseDialog({ children, onAdded, isOpen, setIsOpen }: { children: React.ReactNode, onAdded: (expense: Expense) => void, isOpen: boolean, setIsOpen: (v: boolean) => void }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { bcvRate } = useCurrency();
    const [description, setDescription] = useState("");
    const [amountUSD, setAmountUSD] = useState("");
    const [amountBs, setAmountBs] = useState("");
    const [methodBs, setMethodBs] = useState<PaymentMethod>("Tarjeta / Pago Móvil");
    const [category, setCategory] = useState<ExpenseCategory>("Mercancía");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || !description.trim()) return;
        setLoading(true);
        try {
            const expensesRef = collection(firestore, 'users', user.uid, 'expenses');
            const newDoc = doc(expensesRef);
            const data: Expense = {
                id: newDoc.id,
                description: description.trim().toUpperCase(),
                category,
                amountUSD: parseFloat(amountUSD) || 0,
                amountBs: parseFloat(amountBs) || 0,
                methodUSD: 'Efectivo USD',
                methodBs: methodBs,
                createdAt: new Date().toISOString()
            };
            await setDocumentNonBlocking(newDoc, data, { merge: true });
            toast({ title: "Gasto Registrado" });
            setDescription(""); setAmountUSD(""); setAmountBs("");
            onAdded(data);
        } catch (e) {
            toast({ title: "Error al registrar", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-destructive"/> Registrar Egreso</DialogTitle>
                    <DialogDescription>Indica el concepto y el monto para descontarlo de tu saldo real.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase text-muted-foreground">Concepto del Gasto</Label>
                        <Input 
                            value={description} 
                            onChange={(e) => setDescription(e.target.value.toUpperCase())} 
                            placeholder="EJ: COMPRA DE PANTALLAS, ALQUILER..." 
                            className="uppercase h-11 font-bold" 
                            required 
                            autoFocus
                        />
                    </div>
                    
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase text-muted-foreground">Categoría</Label>
                        <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                            <SelectTrigger className="h-11">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-xl border border-dashed">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1"><DollarSign className="w-3 h-3"/> En Dólares ($)</Label>
                            <Input type="number" step="0.01" value={amountUSD} onChange={(e) => setAmountUSD(e.target.value)} placeholder="0.00" className="h-10 text-lg font-black" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1"><Landmark className="w-3 h-3"/> En Bolívares (Bs)</Label>
                            <Input type="number" step="0.01" value={amountBs} onChange={(e) => setAmountBs(e.target.value)} placeholder="0.00" className="h-10 text-lg font-black" />
                        </div>
                    </div>

                    {parseFloat(amountBs) > 0 && (
                        <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                            <Label className="text-[10px] font-black uppercase text-primary">¿De qué cuenta salen los Bolívares?</Label>
                            <Select value={methodBs} onValueChange={(v: any) => setMethodBs(v)}>
                                <SelectTrigger className="h-11 font-bold">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {BS_PAYMENT_METHODS.map(m => (
                                        <SelectItem key={m} value={m} className="uppercase text-xs font-bold">{m}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="submit" className="w-full h-12 text-base font-black shadow-md" disabled={loading || !description.trim()}>
                            {loading ? "PROCESANDO..." : "CONFIRMAR SALIDA"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
