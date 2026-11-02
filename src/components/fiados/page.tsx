"use client";

import { PageHeader } from "@/components/page-header";
import { useCollection, useFirebase, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, orderBy, runTransaction } from "firebase/firestore";
import type { Fiado, Sale, Payment, Product, FiadoItem, RepairJob, PaymentMethod } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import { PlusCircle, HandCoins, DollarSign, Trash2, Search, PackageSearch, X, Plus, ShoppingCart, List, Clock, AlertTriangle, UserCheck, Calendar as CalendarIcon, Smartphone, CreditCard, Landmark, Banknote, TicketPercent } from "lucide-react";
import { format, parseISO, differenceInDays, isBefore, isToday, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { AdminAuthDialog } from "@/components/admin-auth-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { SecurityGate } from "@/components/security-gate";

const paymentMethodOptions: { value: PaymentMethod, label: string, icon: any, hasReference: boolean, isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: DollarSign, hasReference: false, isBs: false },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: Landmark, hasReference: false, isBs: true },
    { value: 'Tarjeta', label: 'Tarjeta', icon: CreditCard, hasReference: true, isBs: true },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: Smartphone, hasReference: true, isBs: true },
    { value: 'Transferencia', label: 'Transferencia', icon: Banknote, hasReference: true, isBs: true },
];

const changeMethodOptions: { value: PaymentMethod, label: string, icon: any, isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'Vuelto en USD', icon: DollarSign, isBs: false },
    { value: 'Efectivo Bs', label: 'Vuelto en Bs', icon: Landmark, isBs: true },
    { value: 'Pago Móvil', label: 'Vuelto por P. Móvil', icon: Smartphone, isBs: true },
];

export default function FiadosPage() {
    return (
        <SecurityGate module="fiados">
            <FiadosContent />
        </SecurityGate>
    );
}

function FiadosContent() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, getSymbol } = useCurrency();
    const [searchTerm, setSearchTerm] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);

    const fiadosCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, "users", user.uid, "fiados"), orderBy("createdAt", "desc")) : null,
        [firestore, user?.uid]
    );
    const { data: fiados, isLoading } = useCollection<Fiado>(fiadosCollection);

    const filteredFiados = useMemo(() => {
        if (!fiados) return [];
        const term = searchTerm.toLowerCase();
        return fiados.filter(f => 
            f.customerName.toLowerCase().includes(term) || 
            f.customerID.toLowerCase().includes(term) ||
            f.concept.toLowerCase().includes(term)
        );
    }, [fiados, searchTerm]);

    const activeDebt = useMemo(() => {
        if (!fiados) return 0;
        return fiados.filter(f => f.status === 'Pendiente').reduce((sum, f) => sum + (f.totalAmount - f.amountPaid), 0);
    }, [fiados]);

    const handleDeleteFiado = (id: string) => {
        if (!firestore || !user) return;
        deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'fiados', id));
        toast({ title: "Registro eliminado", variant: "destructive" });
    };

    return (
        <>
            <PageHeader title="Control de Fiados / Créditos">
                <AddFiadoDialog onAdded={() => setIsAddOpen(false)} isOpen={isAddOpen} setIsOpen={setIsAddOpen} existingFiados={fiados || []}>
                    <Button><PlusCircle className="mr-2 h-4 w-4" /> Nuevo Fiado</Button>
                </AddFiadoDialog>
            </PageHeader>
            <main className="flex-1 p-4 sm:p-6 space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs uppercase font-bold text-muted-foreground">Total en la Calle</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-primary">{getSymbol()}{formatCurrency(activeDebt)}</div>
                            <p className="text-[10px] text-muted-foreground mt-1">Monto pendiente por cobrar.</p>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Cartera de Clientes</CardTitle>
                            <CardDescription>Gestión de deudas y abonos.</CardDescription>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Buscar cliente o concepto..." 
                                className="pl-8" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Antigüedad</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Artículos</TableHead>
                                    <TableHead className="text-right">Total ($)</TableHead>
                                    <TableHead className="text-right">Abonado ($)</TableHead>
                                    <TableHead className="text-right">Pendiente ($)</TableHead>
                                    <TableHead className="text-center">Estado / Alerta</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow><TableCell colSpan={8} className="text-center py-10">Cargando créditos...</TableCell></TableRow>
                                ) : filteredFiados.length === 0 ? (
                                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No hay registros que coincidan.</TableCell></TableRow>
                                ) : filteredFiados.map((fiado) => {
                                    const pending = fiado.totalAmount - fiado.amountPaid;
                                    const daysOld = differenceInDays(new Date(), parseISO(fiado.createdAt));
                                    
                                    const today = startOfDay(new Date());
                                    const isOverdue = fiado.dueDate && fiado.status === 'Pendiente' && 
                                        (isBefore(parseISO(fiado.dueDate), today) || isToday(parseISO(fiado.dueDate)));

                                    const dueDateParsed = fiado.dueDate ? parseISO(fiado.dueDate) : null;
                                    const daysDiff = dueDateParsed ? differenceInDays(dueDateParsed, today) : null;

                                    return (
                                        <TableRow key={fiado.id} className={cn(isOverdue && "bg-destructive/5")}>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className={cn("text-xs font-bold", daysOld > 15 ? "text-destructive" : "text-muted-foreground")}>
                                                        {daysOld === 0 ? 'Hoy' : `Hace ${daysOld} días`}
                                                    </span>
                                                    <span className="text-[9px] text-muted-foreground">{format(parseISO(fiado.createdAt), "dd/MM/yy")}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-sm">{fiado.customerName}</span>
                                                        {fiado.isPromo && <Badge className="bg-blue-600 text-[8px] h-3 px-1">PROMO</Badge>}
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground">{fiado.customerID}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="h-7 text-primary hover:bg-primary/10 gap-1.5 px-2">
                                                            <List className="h-3.5 w-3.5" />
                                                            <span className="text-[10px] font-bold">VER ({fiado.items?.length || 0})</span>
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-72 p-3">
                                                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2 border-b pb-1">Artículos en Deuda</p>
                                                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                                            {fiado.items?.map((item, idx) => (
                                                                <div key={idx} className="flex justify-between text-xs items-start gap-4">
                                                                    <span className="font-medium text-slate-700">{item.quantity}x {item.productName}</span>
                                                                    <span className="font-bold text-slate-900 shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="mt-3 pt-2 border-t flex justify-between font-black text-sm">
                                                            <span>VALOR TOTAL:</span>
                                                            <span className="text-primary">${fiado.totalAmount.toFixed(2)}</span>
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">${fiado.totalAmount.toFixed(2)}</TableCell>
                                            <TableCell className="text-right text-green-600 font-medium">${fiado.amountPaid.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-black text-primary">${pending.toFixed(2)}</TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center gap-1">
                                                    <Badge variant={fiado.status === 'Pagado' ? 'secondary' : 'destructive'} className={cn(fiado.status === 'Pagado' && "bg-green-100 text-green-700")}>
                                                        {fiado.status.toUpperCase()}
                                                    </Badge>
                                                    
                                                    {fiado.status === 'Pendiente' && fiado.dueDate && (
                                                        <div className="flex flex-col items-center gap-0.5 mt-1">
                                                            {isOverdue ? (
                                                                <>
                                                                    <div className="flex items-center gap-1 text-[9px] font-black text-destructive animate-pulse uppercase">
                                                                        <AlertTriangle className="w-2.5 h-2.5" /> VENCIDO
                                                                    </div>
                                                                    <span className="text-[9px] font-bold text-destructive">
                                                                        {isToday(dueDateParsed!) ? "Vence Hoy" : `Atrasado ${Math.abs(daysDiff!)} días`}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <span className="text-[9px] font-bold text-amber-600">
                                                                    Faltan {daysDiff} días
                                                                </span>
                                                            )}
                                                            <span className="text-[8px] text-muted-foreground font-medium">Límite: {format(parseISO(fiado.dueDate), "dd/MM/yy")}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1.5">
                                                    {fiado.status === 'Pendiente' && (
                                                        <>
                                                            <SetDeadlineDialog fiado={fiado} />
                                                            <AddItemsToFiadoDialog fiado={fiado} />
                                                            <CobrarFiadoDialog fiado={fiado} />
                                                        </>
                                                    )}
                                                    <AdminAuthDialog onAuthorized={() => handleDeleteFiado(fiado.id!)}>
                                                        <Button size="sm" variant="ghost" className="h-8 text-destructive">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </AdminAuthDialog>
                                                </div>
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

function SetDeadlineDialog({ fiado }: { fiado: Fiado }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState(fiado.dueDate || "");

    const handleSave = () => {
        if (!firestore || !user || !fiado.id) return;
        updateDocumentNonBlocking(doc(firestore, 'users', user.uid, 'fiados', fiado.id), {
            dueDate: date || null
        });
        toast({ title: "Fecha de pago guardada" });
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className={cn("h-8 px-2", fiado.dueDate ? "text-amber-600 border-amber-200" : "text-muted-foreground")} title="Establecer alerta de pago">
                    <Clock className="w-4 h-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Establecer Fecha Límite de Pago</DialogTitle>
                    <DialogDescription>El sistema te alertará visualmente cuando llegue esta fecha.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label>Fecha de Pago Acordada</Label>
                        <div className="relative">
                            <CalendarIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input 
                                type="date" 
                                className="pl-10" 
                                value={date} 
                                onChange={(e) => setDate(e.target.value)} 
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button onClick={handleSave}>Guardar Alerta</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function AddFiadoDialog({ children, onAdded, isOpen, setIsOpen, existingFiados }: { children: React.ReactNode, onAdded: () => void, isOpen: boolean, setIsOpen: (v: boolean) => void, existingFiados: Fiado[] }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { getFinalPrice } = useCurrency();
    const [loading, setLoading] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    
    const [customerID, setCustomerID] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [concept, setConcept] = useState("");
    const [totalAmount, setTotalAmount] = useState("");
    const [selectedItems, setSelectedItems] = useState<FiadoItem[]>([]);
    const [isPromo, setIsPromo] = useState(false);

    const productsCollection = useMemoFirebase(() => 
        (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null, 
        [firestore, user?.uid]
    );
    const { data: products } = useCollection<Product>(productsCollection);

    const repairJobsCollection = useMemoFirebase(() => 
        (firestore && user) ? collection(firestore, 'users', user.uid, 'repair_jobs') : null, 
        [firestore, user?.uid]
    );
    const { data: repairJobs } = useCollection<RepairJob>(repairJobsCollection);

    const handleAddItem = (p: Product) => {
        const price = getFinalPrice(p);
        setSelectedItems(prev => {
            const existing = prev.find(i => i.productId === p.id);
            if (existing) {
                return prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { 
                productId: p.id!, 
                productName: p.name, 
                quantity: 1, 
                price, 
                costPrice: p.costPrice,
                isPromo: !!(p.promoPrice && p.promoPrice > 0)
            }];
        });
        setSearchOpen(false);
    };

    const handleRemoveItem = (id: string) => {
        setSelectedItems(prev => prev.filter(i => i.productId !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !user || loading) return;

        setLoading(true);
        try {
            await runTransaction(firestore, async (transaction) => {
                const productSnaps = new Map();
                for(const item of selectedItems) {
                    if (!productSnaps.has(item.productId)) {
                        const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', item.productId));
                        productSnaps.set(item.productId, snap);
                    }
                }

                for (const item of selectedItems) {
                    const pDoc = productSnaps.get(item.productId);
                    if (pDoc?.exists()) {
                        const currentStock = pDoc.data().stockLevel || 0;
                        if (currentStock < item.quantity) {
                            throw new Error(`Stock insuficiente para "${item.productName}".`);
                        }
                        transaction.update(pDoc.ref, { stockLevel: currentStock - item.quantity });
                    }
                }

                const totalCost = selectedItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0);
                const fiadosRef = collection(firestore, 'users', user.uid, 'fiados');
                const newDoc = doc(fiadosRef);
                const data: Fiado = {
                    id: newDoc.id,
                    customerID,
                    customerName,
                    customerPhone,
                    concept,
                    totalAmount: parseFloat(totalAmount) || 0,
                    amountPaid: 0,
                    totalCost: totalCost,
                    status: 'Pendiente',
                    createdAt: new Date().toISOString(),
                    items: selectedItems,
                    isPromo: isPromo || selectedItems.some(i => i.isPromo)
                };
                transaction.set(newDoc, data);
            });

            toast({ title: "Fiado registrado" });
            setIsOpen(false);
            setCustomerID(""); setCustomerName(""); setCustomerPhone(""); setConcept(""); setTotalAmount(""); setSelectedItems([]);
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle>Registrar Nuevo Crédito</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Cédula / RIF</Label><Input value={customerID} onChange={(e) => setCustomerID(e.target.value)} placeholder="V-12345678" required /></div>
                        <div className="space-y-2"><Label>Nombre y Apellido</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Juan Perez" required /></div>
                    </div>

                    <div className="space-y-2">
                        <Label>Añadir Productos</Label>
                        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                            <PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start text-muted-foreground"><PackageSearch className="mr-2 h-4 w-4" /> Buscar producto...</Button></PopoverTrigger>
                            <PopoverContent className="p-0 w-[400px]" align="start">
                                <Command><CommandInput placeholder="Nombre o SKU..." /><CommandList><CommandEmpty>Sin resultados.</CommandEmpty><CommandGroup>
                                    {(products || []).filter(p => !p.isCombo && p.stockLevel > 0).map(p => (
                                        <CommandItem key={p.id} onSelect={() => handleAddItem(p)} className="flex justify-between items-center">
                                            <span>{p.name}</span>
                                            <Badge variant="secondary">{p.stockLevel} disp.</Badge>
                                        </CommandItem>
                                    ))}
                                </CommandGroup></CommandList></Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex items-center space-x-2 p-2 bg-blue-50 border border-blue-100 rounded-md">
                        <Checkbox id="promo-fiado" checked={isPromo} onCheckedChange={(v) => setIsPromo(!!v)} />
                        <Label htmlFor="promo-fiado" className="font-bold text-[10px] uppercase text-blue-700 flex items-center gap-1.5 cursor-pointer">
                            <TicketPercent className="w-3.5 h-3.5" /> Aplicar Tasa de Reposición (Oferta)
                        </Label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Teléfono</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0414-..." required /></div>
                        <div className="space-y-2"><Label>Monto Total ($)</Label><Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0.00" required /></div>
                    </div>
                    <DialogFooter><Button type="submit" className="w-full" disabled={loading}>{loading ? "PROCESANDO..." : "Crear Fiado"}</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AddItemsToFiadoDialog({ fiado }: { fiado: Fiado }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { getFinalPrice } = useCurrency();
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [selectedItems, setSelectedItems] = useState<FiadoItem[]>([]);

    const productsCollection = useMemoFirebase(() => 
        (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null, 
        [firestore, user?.uid]
    );
    const { data: products } = useCollection<Product>(productsCollection);

    const handleAddItem = (p: Product) => {
        const price = getFinalPrice(p);
        setSelectedItems(prev => {
            const existing = prev.find(i => i.productId === p.id);
            if (existing) {
                return prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { productId: p.id!, productName: p.name, quantity: 1, price, costPrice: p.costPrice }];
        });
        setSearchOpen(false);
    };

    const handleRemoveItem = (id: string) => {
        setSelectedItems(prev => prev.filter(i => i.productId !== id));
    };

    const handleUpdate = async () => {
        if (!firestore || !user || loading || selectedItems.length === 0) return;

        setLoading(true);
        try {
            await runTransaction(firestore, async (transaction) => {
                const fiadoRef = doc(firestore, 'users', user.uid, 'fiados', fiado.id!);
                const fiadoSnap = await transaction.get(fiadoRef);
                if (!fiadoSnap.exists()) throw new Error("El registro ya no existe.");
                const currentFiadoData = fiadoSnap.data() as Fiado;

                const productSnaps = new Map();
                for (const item of selectedItems) {
                    if (!productSnaps.has(item.productId)) {
                        const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', item.productId));
                        productSnaps.set(item.productId, snap);
                    }
                }

                for (const item of selectedItems) {
                    const pDoc = productSnaps.get(item.productId);
                    if (pDoc?.exists()) {
                        const currentStock = pDoc.data().stockLevel || 0;
                        if (currentStock < item.quantity) {
                            throw new Error(`No hay stock suficiente para "${item.productName}".`);
                        }
                        transaction.update(pDoc.ref, { stockLevel: currentStock - item.quantity });
                    }
                }

                const addedTotal = selectedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                const addedCost = selectedItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0);
                
                transaction.update(fiadoRef, {
                    totalAmount: currentFiadoData.totalAmount + addedTotal,
                    totalCost: (currentFiadoData.totalCost || 0) + addedCost,
                    items: [...(currentFiadoData.items || []), ...selectedItems],
                    concept: currentFiadoData.concept + ", " + selectedItems.map(i => `${i.quantity}x ${i.productName}`).join(", ")
                });
            });

            toast({ title: "Cuenta actualizada" });
            setOpen(false);
            setSelectedItems([]);
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" className="h-8 px-2"><ShoppingCart className="w-4 h-4" /></Button></DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>Añadir a la cuenta de {fiado.customerName}</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                        <PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start text-muted-foreground"><PackageSearch className="mr-2 h-4 w-4" /> Buscar producto...</Button></PopoverTrigger>
                        <PopoverContent className="p-0 w-[400px]" align="start">
                            <Command><CommandInput placeholder="Nombre o SKU..." /><CommandList><CommandEmpty>Sin resultados.</CommandEmpty><CommandGroup>
                                {(products || []).filter(p => !p.isCombo && p.stockLevel > 0).map(p => (
                                    <CommandItem key={p.id} onSelect={() => handleAddItem(p)} className="flex justify-between items-center">
                                        <span>{p.name}</span><Badge variant="secondary">{p.stockLevel} disp.</Badge>
                                    </CommandItem>
                                ))}
                            </CommandGroup></CommandList></Command>
                        </PopoverContent>
                    </Popover>
                </div>
                <DialogFooter><Button onClick={handleUpdate} className="w-full" disabled={loading || selectedItems.length === 0}>{loading ? "GUARDANDO..." : "Confirmar y Añadir"}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CobrarFiadoDialog({ fiado }: { fiado: Fiado }) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const { format: formatCurrency, bcvRate, parallelRate, convert } = useCurrency();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [payments, setPayments] = useState<(Payment & { id: number })[]>([]);
    const [changePayments, setChangePayments] = useState<(Payment & { id: number })[]>([]);
    const [isGivingChange, setIsGivingChange] = useState(false);

    const pending = fiado.totalAmount - fiado.amountPaid;
    const hasPromo = !!fiado.isPromo;

    const totalAbonoInUSD = useMemo(() => {
        return payments.reduce((acc, p) => {
            // CRITICAL: Usamos tasa de reposición (hasPromo) SOLO si el fiado tiene promociones
            return acc + (p.method === 'Efectivo USD' ? p.amount : convert(p.amount, 'Bs', 'USD', hasPromo));
        }, 0);
    }, [payments, convert, hasPromo]);

    const remainingToPayInUSD = useMemo(() => Math.max(0, pending - totalAbonoInUSD), [pending, totalAbonoInUSD]);
    const potentialChangeInUSD = useMemo(() => (totalAbonoInUSD > pending ? totalAbonoInUSD - pending : 0), [totalAbonoInUSD, pending]);
    const requiredChangeInUSD = isGivingChange ? potentialChangeInUSD : 0;

    const totalChangeGivenInUSD = useMemo(() => {
        return changePayments.reduce((acc, p) => {
            return acc + (p.method === 'Efectivo USD' ? p.amount : convert(p.amount, 'Bs', 'USD', hasPromo));
        }, 0);
    }, [changePayments, convert, hasPromo]);

    const changeDifference = requiredChangeInUSD - totalChangeGivenInUSD;
    const remainingInUSD = Math.max(0, pending - (totalAbonoInUSD - totalChangeGivenInUSD));

    const handleAddPayment = (method: PaymentMethod) => {
        setPayments(prev => [...prev, { id: Date.now(), method, amount: 0, reference: '' }]);
    };

    const handleUpdatePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
        setPayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    const handleRemovePayment = (id: number) => {
        setPayments(prev => prev.filter(p => p.id !== id));
    };

    const handleAddChangePayment = (method: PaymentMethod) => {
        setChangePayments(prev => [...prev, { id: Date.now(), method, amount: 0, reference: '' }]);
    };

    const handleUpdateChangePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
        setChangePayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    const handleRemoveChangePayment = (id: number) => {
        setChangePayments(prev => prev.filter(p => p.id !== id));
    };

    const handleAbono = async () => {
        if (!firestore || !user || payments.length === 0 || loading) return;
        
        const finalNetAbonoInUSD = totalAbonoInUSD - totalChangeGivenInUSD;
        
        if (finalNetAbonoInUSD <= 0) {
            toast({ title: "Monto inválido", variant: "destructive" });
            return;
        }

        setLoading(true);
        try {
            await runTransaction(firestore, async (transaction) => {
                const fiadoRef = doc(firestore, 'users', user.uid, 'fiados', fiado.id!);
                const fiadoSnap = await transaction.get(fiadoRef);
                if (!fiadoSnap.exists()) return;

                const currentFiado = fiadoSnap.data() as Fiado;
                const saleId = `S-FIA-${Date.now()}`;
                const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', saleId);

                const newPaid = currentFiado.amountPaid + finalNetAbonoInUSD;
                const isFullyPaid = newPaid >= (currentFiado.totalAmount - 0.01);

                const saleData: Sale = {
                    id: saleId,
                    fiadoId: fiado.id,
                    items: [{ productId: fiado.id!, name: `Abono: ${currentFiado.customerName}`, quantity: 1, price: finalNetAbonoInUSD }],
                    totalAmount: finalNetAbonoInUSD,
                    subtotal: finalNetAbonoInUSD,
                    discount: 0,
                    paymentMethod: payments.map(p => p.method).join(', '),
                    transactionDate: new Date().toISOString(),
                    status: 'completed',
                    payments: payments.map(({id, ...rest}) => rest),
                    actualPaidAmount: finalNetAbonoInUSD,
                    changeGiven: isGivingChange ? changePayments.map(({id, ...rest}) => rest) : [],
                    totalChangeInUSD: isGivingChange ? totalChangeGivenInUSD : 0,
                    bcvRateAtTime: bcvRate,
                    parallelRateAtTime: parallelRate
                };

                transaction.set(saleRef, saleData);
                transaction.update(fiadoRef, {
                    amountPaid: Number(newPaid.toFixed(2)),
                    status: isFullyPaid ? 'Pagado' : 'Pendiente'
                });
            });
            
            toast({ title: "Abono Registrado" });
            setOpen(false);
            setPayments([]); setChangePayments([]); setIsGivingChange(false);
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" className="h-8 text-green-600 border-green-200 hover:bg-green-50"><DollarSign className="w-3.5 h-3.5 mr-1" /> Abonar</Button></DialogTrigger>
            <DialogContent className={cn("transition-all", isGivingChange ? "sm:max-w-4xl" : "sm:max-w-md")}>
                <DialogHeader><DialogTitle>Registrar Pago: {fiado.customerName}</DialogTitle><DialogDescription>Deuda: <span className="font-bold text-primary">${pending.toFixed(2)}</span> {hasPromo && <Badge className="ml-2 bg-blue-600 text-[8px]">OFERTA</Badge>}</DialogDescription></DialogHeader>
                
                <div className={cn("grid grid-cols-1 gap-6 py-2", isGivingChange && "md:grid-cols-2")}>
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            {paymentMethodOptions.map(option => (
                                <Button key={option.value} variant="outline" size="sm" className="h-8 text-[10px]" onClick={() => handleAddPayment(option.value)}>
                                    <option.icon className="w-3.5 h-3.5 mr-1.5" /> {option.label}
                                </Button>
                            ))}
                        </div>

                        {payments.length > 0 && (
                            <ScrollArea className="h-[200px] pr-2"><div className="space-y-3">
                                {payments.map(p => {
                                    const option = paymentMethodOptions.find(o => o.value === p.method)!;
                                    const symbol = option.isBs ? 'Bs' : '$';
                                    const remainingInCurrency = option.isBs ? convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo) : remainingToPayInUSD;
                                    return (
                                        <div key={p.id} className="bg-white p-3 rounded-lg border shadow-sm space-y-2">
                                            <div className="flex justify-between items-center"><span className="text-xs font-bold flex items-center gap-1.5"><option.icon className="w-3.5 h-3.5" /> {p.method}</span><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemovePayment(p.id)}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                                            <div className="flex gap-2">
                                                <div className="relative flex-1"><span className="absolute left-2.5 top-2.5 text-muted-foreground text-xs">{symbol}</span><Input type="number" placeholder="0.00" className="h-9 pl-7 text-xs font-bold" value={p.amount || ''} onChange={(e) => handleUpdatePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}/></div>
                                                {option.hasReference && <Input placeholder="Ref." className="h-9 text-xs font-mono font-bold flex-1" value={p.reference} onChange={(e) => handleUpdatePayment(p.id, 'reference', e.target.value)}/>}
                                            </div>
                                            {remainingToPayInUSD > 0 && <button type="button" onClick={() => handleUpdatePayment(p.id, 'amount', parseFloat(remainingInCurrency.toFixed(2)))} className="text-[9px] font-black uppercase text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">PAGAR RESTANTE: {symbol}{formatCurrency(remainingInCurrency)}</button>}
                                        </div>
                                    );
                                })}
                            </div></ScrollArea>
                        )}

                        <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
                            <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground font-bold uppercase text-[10px]">Total Recibido:</span><span className="font-black text-primary text-lg">${totalAbonoInUSD.toFixed(2)}</span></div>
                        </div>

                        {potentialChangeInUSD > 0.001 && <div className="flex items-center space-x-2 pt-2 border-t"><Checkbox id="give-change-fiados" checked={isGivingChange} onCheckedChange={(checked) => setIsGivingChange(!!checked)} /><Label htmlFor="give-change-fiados" className="cursor-pointer font-black text-xs text-primary uppercase">Registrar Vuelto</Label></div>}
                    </div>

                    {isGivingChange && (
                        <div className="space-y-4 md:border-l md:pl-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="text-center p-3 rounded-lg bg-primary/10 border border-primary/20"><p className="text-[10px] text-primary font-bold uppercase">Vuelto Requerido</p><p className="text-3xl font-black text-primary">${potentialChangeInUSD.toFixed(2)}</p></div>
                            <div className="flex flex-wrap gap-2">
                                {changeMethodOptions.map(method => (
                                    <Button key={method.value} variant="outline" size="sm" className="h-7 text-[9px]" onClick={() => handleAddChangePayment(method.value)}><method.icon className="w-3 h-3 mr-1.5" /> {method.label}</Button>
                                ))}
                            </div>
                            <ScrollArea className="h-[180px] pr-2"><div className="space-y-2">
                                {changePayments.map(p => {
                                    const option = changeMethodOptions.find(o => o.value === p.method)!;
                                    const symbol = option.isBs ? 'Bs' : '$';
                                    return (
                                        <div key={p.id} className="bg-white p-2 rounded-lg border flex gap-2 items-center shadow-sm">
                                            <span className="text-[10px] font-bold text-muted-foreground w-20 truncate">{p.method}</span>
                                            <div className="relative flex-1"><span className="absolute left-2.5 top-2 text-muted-foreground text-[10px] font-bold">{symbol}</span><Input type="number" className="h-8 pl-7 text-xs font-bold" value={p.amount || ''} onChange={(e) => handleUpdateChangePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}/></div>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemovePayment(p.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                        </div>
                                    );
                                })}
                            </div></ScrollArea>
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-4"><Button onClick={handleAbono} className="w-full h-12 text-base font-black shadow-md" disabled={payments.length === 0 || loading}>{loading ? "PROCESANDO..." : "CONFIRMAR ABONO"}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}