"use client";

import { cleanObject } from "@/lib/json-guard";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { RepairJob, RepairStatus, Product, UserProfile, ReservedPart, AppSettings } from "@/lib/types";
import { useState, useEffect, ReactNode, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { Label } from "../ui/label";
import { useFirebase, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { doc, runTransaction, type DocumentSnapshot, collection, query, orderBy, limit, increment, getDoc, where, getDocs } from "firebase/firestore";
import { handlePrintAllTickets } from "./repair-ticket";
import { User, Smartphone, Package, Search, Plus, Trash2, Loader2, DollarSign, Calculator, UserCheck, Hammer, TicketPercent, Landmark, X } from "lucide-react";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { ProductFormDialog } from "../inventory/product-form-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Switch } from "@/components/ui/switch";

const formSchema = z.object({
  customerName: z.string().min(2, "Nombre obligatorio"),
  customerPhone: z.string().min(10, "Teléfono inválido"),
  customerID: z.string().min(5, "Cédula requerida"),
  customerAddress: z.string().default(""),
  deviceMake: z.string().min(2, "Marca obligatoria"),
  deviceModel: z.string().min(1, "Modelo obligatorio"),
  reportedIssue: z.string().min(5, "Detalla la falla del equipo"),
  status: z.enum(['Pendiente', 'Pagado', 'Completado', 'Garantía']),
  notes: z.string().default(""),
  reservedParts: z.array(z.any()).default([]),
  isPromo: z.boolean().default(false),
});

/**
 * MODAL MANUAl REPLICA EXACTA: Implementación de diseño pixel-perfect y lógica de doble tasa.
 */
function ManualPartDialog({ onAdd, open, onOpenChange }: { onAdd: (part: any) => void, open: boolean, onOpenChange: (v: boolean) => void }) {
    const { getDynamicPrice, bcvRate, parallelRate, profitMargin, format: formatCurrency } = useCurrency();
    
    const [description, setDescription] = useState("");
    const [cost, setCost] = useState("");
    const [priceBcv, setPriceBcv] = useState("");
    const [priceOferta, setPriceOferta] = useState("");
    const [useReposicion, setUseReposicion] = useState(false);

    // Lógica reactiva de sugerencia automática al escribir el costo
    const handleCostChange = (val: string) => {
        setCost(val);
        const numCost = parseFloat(val);
        if (!isNaN(numCost) && numCost > 0) {
            // Sugerencia BCV: Protege capital con tasa de reposición pero expresa en $ BCV
            const bcvSug = getDynamicPrice(numCost);
            setPriceBcv(bcvSug.toFixed(2));
            
            // Sugerencia Oferta: Costo + Margen de ganancia directo (precio de calle)
            const offerSug = numCost * (1 + profitMargin / 100);
            setPriceOferta(offerSug.toFixed(2));
        } else {
            setPriceBcv("");
            setPriceOferta("");
        }
    };

    const handleAdd = () => {
        if (!description || !priceBcv || !priceOferta) return;
        
        onAdd({
            productId: `manual-${Date.now()}`,
            productName: description.toUpperCase(),
            quantity: 1,
            costPrice: parseFloat(cost) || 0,
            manualPrice: parseFloat(priceBcv) || 0,
            manualPriceOffer: parseFloat(priceOferta) || 0,
            isManual: true,
            isPromo: useReposicion,
            isWarranty: false,
            isConsumed: false
        });

        // Limpiar estados
        setDescription(""); setCost(""); setPriceBcv(""); setPriceOferta(""); setUseReposicion(false);
        onOpenChange(false);
    };

    // Cálculos de equivalencia en Bs para visualización en tiempo real
    const eqBsBcv = (parseFloat(priceBcv) || 0) * bcvRate;
    const eqBsOferta = (parseFloat(priceOferta) || 0) * parallelRate;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-0 bg-slate-50 border-none overflow-hidden shadow-2xl">
                <div className="p-6 space-y-6">
                    <DialogHeader className="flex flex-row items-center justify-between">
                        <DialogTitle className="font-black text-xl text-slate-800 uppercase tracking-tight">REPUESTO MANUAL</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* FILA 1: DESCRIPCIÓN */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-tighter">DESCRIPCIÓN DEL SERVICIO/PIEZA</Label>
                            <Input 
                                value={description} 
                                onChange={(e) => setDescription(e.target.value.toUpperCase())} 
                                placeholder="EJ: DESCRIPCIÓN DEL ARTÍCULO..." 
                                className="w-full bg-white h-11 border-slate-200 focus-visible:ring-primary/10 font-bold uppercase"
                            />
                        </div>

                        {/* FILA 2: COSTO */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-tighter">COSTO INVERSIÓN ($)</Label>
                            <Input 
                                type="number"
                                step="any"
                                value={cost} 
                                onChange={(e) => handleCostChange(e.target.value)} 
                                placeholder="0.00" 
                                className="w-full bg-white h-11 border-slate-200 focus-visible:ring-primary/10 font-bold"
                            />
                        </div>

                        {/* FILA 3: TARJETAS DE PRECIOS */}
                        <div className="grid grid-cols-2 gap-4 mt-2">
                            {/* TARJETA 1: SUGERIDO BCV */}
                            <div className="bg-white rounded-xl shadow-sm p-3 border border-slate-100 flex flex-col gap-2 transition-all">
                                <span className="text-[10px] font-black text-blue-500 uppercase tracking-wider">SUGERIDO BCV</span>
                                <div className="bg-slate-50 border border-slate-200 rounded-md flex items-center px-2 h-9">
                                    <span className="text-blue-500 font-bold mr-1">$</span>
                                    <input 
                                        type="number"
                                        step="any"
                                        value={priceBcv}
                                        onChange={(e) => setPriceBcv(e.target.value)}
                                        className="bg-transparent border-none focus:ring-0 text-slate-700 font-bold w-full outline-none p-0 h-full text-sm"
                                        placeholder="0.00"
                                    />
                                </div>
                                <span className="text-[9px] font-bold text-blue-500 italic">Eq: Bs {formatCurrency(eqBsBcv)}</span>
                            </div>

                            {/* TARJETA 2: SUGERIDO OFERTA */}
                            <div className="bg-green-50/50 rounded-xl border border-green-200 p-3 flex flex-col gap-2 transition-all">
                                <span className="text-[10px] font-black text-green-700 uppercase tracking-wider">SUGERIDO OFERTA</span>
                                <div className="bg-green-100/50 border border-green-200 rounded-md flex items-center px-2 h-9">
                                    <span className="text-green-600 font-bold mr-1">$</span>
                                    <input 
                                        type="number"
                                        step="any"
                                        value={priceOferta}
                                        onChange={(e) => setPriceOferta(e.target.value)}
                                        className="bg-transparent border-none focus:ring-0 text-slate-800 font-bold w-full outline-none p-0 h-full text-sm"
                                        placeholder="0.00"
                                    />
                                </div>
                                <span className="text-[9px] font-bold text-green-600 italic">Eq: Bs {formatCurrency(eqBsOferta)}</span>
                            </div>
                        </div>

                        {/* FILA 4: TOGGLE ESTRATEGIA */}
                        <div className="bg-slate-100 border border-slate-200 rounded-lg p-3 mt-4 flex items-center justify-between shadow-inner">
                            <div className="flex items-center gap-2">
                                <TicketPercent className="w-4 h-4 text-blue-500" />
                                <span className="font-black text-slate-800 text-xs uppercase tracking-tighter">USAR TASA DE REPOSICIÓN</span>
                            </div>
                            <Switch 
                                checked={useReposicion} 
                                onCheckedChange={setUseReposicion}
                                className="data-[state=checked]:bg-slate-700"
                            />
                        </div>
                    </div>

                    {/* FILA 5: SUBMIT */}
                    <Button 
                        onClick={handleAdd} 
                        disabled={!description || !priceBcv || !priceOferta} 
                        className="w-full bg-slate-500 hover:bg-slate-600 text-white font-bold uppercase h-14 mt-2 rounded-lg text-sm shadow-md transition-all active:scale-[0.98]"
                    >
                        CONFIRMAR AÑADIDO
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function RepairFormDialog({ repairJob, children, isOpen, onOpenChange, onSaved }: { repairJob?: RepairJob | null, children?: ReactNode, isOpen?: boolean, onOpenChange?: (v: boolean) => void, onSaved?: (job: RepairJob) => void }) {
  const { firestore, user } = useFirebase();
  const [internalOpen, setInternalOpen] = useState(false);
  const [partsPopoverOpen, setPartsPopoverOpen] = useState(false);
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [manualQuickAddOpen, setManualQuickAddOpen] = useState(false);
  
  const [productSearch, setProductSearch] = useState("");
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const { toast } = useToast();
  const { getFinalPrice, getDynamicPrice, format: formatCurrency, bcvRate, parallelRate } = useCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lookedUpCustomer, setLookedUpCustomer] = useState<any>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: "", customerPhone: "", customerID: "", customerAddress: "",
      deviceMake: "", deviceModel: "", reportedIssue: "",
      status: "Pendiente", reservedParts: [],
      isPromo: false, notes: "",
    },
  });

  const productsQuery = useMemoFirebase(() => 
    (firestore && user && open) ? query(collection(firestore, 'users', user.uid, 'products'), orderBy('name'), limit(200)) : null,
    [firestore, user?.uid, open]
  );
  const { data: allProducts, isLoading: productsLoading } = useCollection<Product>(productsQuery);

  const searchResults = useMemo(() => {
    if (!allProducts) return [];
    const term = productSearch.toLowerCase().trim();
    if (!term) return allProducts.slice(0, 15);
    
    return allProducts.filter(p => 
        p.name.toLowerCase().includes(term) || 
        p.sku?.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term) ||
        (p.compatibleModels && p.compatibleModels.some(m => m.toLowerCase().includes(term)))
    ).slice(0, 20);
  }, [allProducts, productSearch]);

  const { profile } = useDashboardStore();

  const reservedParts = form.watch("reservedParts") as (ReservedPart & { isPromo?: boolean, isWarranty?: boolean, isManual?: boolean, isConsumed?: boolean, manualPriceBs?: number, manualPriceOffer?: number })[];
  const watchedID = form.watch("customerID");
  const watchedName = form.watch("customerName");

  useEffect(() => {
    const fetchCustomer = async () => {
      if (!open || !firestore || !user || !watchedID || watchedID.length < 5) {
        setLookedUpCustomer(null);
        return;
      }
      const q = query(collection(firestore, 'users', user.uid, 'repair_jobs'), where('customerID', '==', watchedID.toUpperCase().trim()), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) setLookedUpCustomer(snap.docs[0].data());
      else setLookedUpCustomer(null);
    };
    const debounce = setTimeout(fetchCustomer, 600);
    return () => clearTimeout(debounce);
  }, [watchedID, firestore, user, open]);

  const handleApplyCustomerData = () => {
    if (lookedUpCustomer) {
        form.setValue("customerName", lookedUpCustomer.customerName.toUpperCase());
        form.setValue("customerPhone", lookedUpCustomer.customerPhone);
        form.setValue("customerAddress", (lookedUpCustomer.customerAddress || "").toUpperCase());
        toast({ title: "Datos cargados" });
    }
  };
  
  const effectiveIsPromo = useMemo(() => reservedParts.some(p => p.isPromo && !p.isWarranty), [reservedParts]);

  useEffect(() => {
    form.setValue("isPromo", effectiveIsPromo);
  }, [effectiveIsPromo, form]);

  const partsTotalForClient = useMemo(() => {
    return reservedParts.reduce((sum, part) => {
        if (part.isWarranty) return sum;
        let price = 0;
        if (part.isManual) {
            price = part.isPromo ? (part.manualPriceOffer || 0) : (part.manualPrice || 0);
            if (price === 0) price = getDynamicPrice(part.costPrice);
        } else {
            const product = allProducts?.find(p => p.id === part.productId);
            if (product) {
                price = (part.isPromo && product.promoPrice) ? product.promoPrice : getFinalPrice(product);
            } else {
                price = getDynamicPrice(part.costPrice);
            }
        }
        return sum + (price * part.quantity);
    }, 0);
  }, [reservedParts, allProducts, getFinalPrice, getDynamicPrice]);

  const estimatedTotal = partsTotalForClient;
  const currentPaid = repairJob?.amountPaid || 0;

  useEffect(() => {
    if (open) {
        if (repairJob) {
            const allParts = [
                ...(repairJob.consumedParts || []).map(p => ({ ...p, isConsumed: true })),
                ...(repairJob.reservedParts || []).map(p => ({ ...p, isConsumed: false }))
            ];
            form.reset({ ...repairJob, status: repairJob.status as any, reservedParts: allParts });
        } else {
            form.reset({ customerName: "", customerPhone: "", customerID: "", customerAddress: "", deviceMake: "", deviceModel: "", reportedIssue: "", status: "Pendiente", reservedParts: [], isPromo: false, notes: "" });
        }
    }
  }, [repairJob, open, form]);

  const handleAddPartFromInventory = async (p: Product) => {
      let freshProduct = p;
      if (firestore && user) {
          const snap = await getDoc(doc(firestore, 'users', user.uid, 'products', p.id!));
          if (snap.exists()) freshProduct = { ...snap.data(), id: snap.id } as Product;
      }
      const existing = reservedParts.find(item => item.productId === freshProduct.id);
      const qtyInForm = existing ? existing.quantity : 0;
      const originalInJob = repairJob?.reservedParts?.find(rp => rp.productId === freshProduct.id)?.quantity || 0;
      const available = (freshProduct.stockLevel - (freshProduct.reservedStock || 0) - (freshProduct.damagedStock || 0)) + originalInJob;
      
      if (available < qtyInForm + 1) {
          setReplenishProduct(freshProduct);
          setPartsPopoverOpen(false);
          return;
      }
      if (existing) {
          form.setValue('reservedParts', reservedParts.map(item => item.productId === freshProduct.id ? { ...item, quantity: item.quantity + 1 } : item));
      } else {
          form.setValue('reservedParts', [...reservedParts, { 
              productId: freshProduct.id!, 
              productName: freshProduct.name.toUpperCase(), 
              quantity: 1, costPrice: freshProduct.costPrice, 
              isPromo: false, isWarranty: false, isManual: false, isConsumed: false 
          }]);
      }
      setPartsPopoverOpen(false);
  };

  const handleAddManualPart = (part: any) => form.setValue('reservedParts', [...reservedParts, part]);
  const handleRemovePart = (productId: string) => form.setValue('reservedParts', reservedParts.filter(p => p.productId !== productId));
  const handleTogglePartPromo = (productId: string) => form.setValue('reservedParts', reservedParts.map(p => p.productId === productId ? { ...p, isPromo: !p.isPromo } : p));

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!firestore || !user || isSubmitting) return;
    setIsSubmitting(true);
    try {
        const finalJob = await runTransaction(firestore, async (transaction) => {
            const jobId = repairJob?.id || `R-${format(new Date(), "yyMMdd")}-${Math.floor(1000 + Math.random() * 9000)}`;
            const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', jobId);
            const allFormParts = values.reservedParts;
            const newReservedItems = allFormParts.filter(p => !p.isConsumed);
            const newConsumedItems = allFormParts.filter(p => p.isConsumed);
            const productIdsToRead = new Set<string>();
            allFormParts.filter(p => !p.isManual).forEach(p => productIdsToRead.add(p.productId));
            (repairJob?.reservedParts || []).filter(p => !p.isManual).forEach(p => productIdsToRead.add(p.productId));
            const productSnapshots = new Map<string, DocumentSnapshot>();
            for (const pid of Array.from(productIdsToRead)) productSnapshots.set(pid, await transaction.get(doc(firestore, 'users', user.uid, 'products', pid)));
            
            const reservedDeltas = new Map<string, { delta: number, name: string }>();
            (repairJob?.reservedParts || []).filter(p => !p.isManual).forEach(old => reservedDeltas.set(old.productId, { delta: -old.quantity, name: old.productName }));
            newReservedItems.filter(p => !p.isManual).forEach(updated => {
                const cur = reservedDeltas.get(updated.productId) || { delta: 0, name: updated.productName };
                reservedDeltas.set(updated.productId, { delta: cur.delta + updated.quantity, name: updated.productName });
            });
            for (const [pid, change] of Array.from(reservedDeltas.entries())) {
                if (change.delta === 0) continue;
                const pSnap = productSnapshots.get(pid);
                if (pSnap?.exists()) {
                    const data = pSnap.data() as Product;
                    if (change.delta > 0 && ((data.stockLevel - (data.reservedStock || 0) - (data.damagedStock || 0)) < change.delta)) throw new Error(`Stock insuficiente: ${change.name}`);
                    transaction.update(pSnap.ref, { reservedStock: increment(change.delta) });
                }
            }

            let finalReservedParts = [...newReservedItems];
            let finalConsumedParts = [...newConsumedItems];
            let completionData: any = {};
            if (values.status === 'Completado') {
                for (const part of newReservedItems.filter(p => !p.isManual)) {
                    const pSnap = productSnapshots.get(part.productId);
                    if (pSnap?.exists()) transaction.update(pSnap.ref, { stockLevel: increment(-part.quantity), reservedStock: increment(-part.quantity) });
                }
                const completionDate = new Date();
                completionData = { completedAt: completionDate.toISOString(), warrantyEndDate: addDays(completionDate, 4).toISOString() };
                finalConsumedParts = [...finalConsumedParts, ...newReservedItems];
                finalReservedParts = [];
            }

            const finalData = cleanObject({ 
                ...values, id: jobId, 
                estimatedCost: Number(estimatedTotal.toFixed(2)),
                amountPaid: currentPaid, isPaid: currentPaid >= (estimatedTotal - 0.01),
                status: (currentPaid >= (estimatedTotal - 0.01) && values.status === 'Pendiente') ? 'Pagado' : values.status,
                createdAt: repairJob?.createdAt || new Date().toISOString(),
                reservedParts: finalReservedParts.map(({isConsumed, ...p}) => p), 
                consumedParts: finalConsumedParts.map(({isConsumed, ...p}) => p), 
                partsConsumed: values.status === 'Completado', isPromo: effectiveIsPromo, ...completionData
            });
            transaction.set(jobRef, finalData, { merge: true });
            return finalData as RepairJob;
        });
        if (onSaved) onSaved(finalJob);
        toast({ title: "Orden Guardada" });
        if (!repairJob) handlePrintAllTickets({ repairJob: finalJob, businessName: profile?.businessName, profile, bcvRate, parallelRate }, () => {});
        setOpen(false);
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); } 
    finally { setIsSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="p-4 sm:p-6 pb-2 shrink-0">
            <DialogHeader>
                <DialogTitle className="uppercase font-bold text-base sm:text-lg">{repairJob ? 'Gestionar Trabajo' : 'Nueva Recepción Técnica'}</DialogTitle>
                <DialogDescription>Completa los datos del cliente y el equipo.</DialogDescription>
            </DialogHeader>
        </div>
        
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-6 pb-6">
                    <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2 border-b pb-1"><User className="w-3 h-3" /> Información del Cliente</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="customerID" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Cédula / RIF</FormLabel><FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="V-12345678" className="uppercase h-9" /></FormControl><FormMessage /></FormItem>} />
                            <FormField control={form.control} name="customerPhone" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Teléfono</FormLabel><FormControl><Input {...field} placeholder="0412-0000000" className="h-9" /></FormControl><FormMessage /></FormItem>} />
                        </div>
                        {lookedUpCustomer && (watchedName.toUpperCase() !== lookedUpCustomer.customerName.toUpperCase()) && <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 flex items-center gap-1 font-bold w-full" onClick={handleApplyCustomerData}><UserCheck className="w-3.5 h-3.5" /> ¿CARGAR DATOS?</Button>}
                        <FormField control={form.control} name="customerName" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Nombre Completo</FormLabel><FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="JUAN PÉREZ" className="uppercase h-9" /></FormControl><FormMessage /></FormItem>} />
                    </div>

                    <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2 border-b pb-1"><Smartphone className="w-3 h-3" /> Detalles del Equipo</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="deviceMake" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Marca</FormLabel><FormControl><Input {...field} className="uppercase h-9" placeholder="SAMSUNG..." /></FormControl></FormItem>} />
                            <FormField control={form.control} name="deviceModel" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Modelo</FormLabel><FormControl><Input {...field} className="uppercase h-9" placeholder="A51..." /></FormControl></FormItem>} />
                        </div>
                        <FormField control={form.control} name="reportedIssue" render={({field}) => <FormItem><FormLabel className="text-[10px] font-bold uppercase">Falla</FormLabel><FormControl><Input {...field} className="uppercase h-9" placeholder="EJ: PANTALLA ROTA..." /></FormControl></FormItem>} />
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b pb-1">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2"><Package className="w-3 h-3" /> Repuestos y Servicios</span>
                            <div className="flex gap-1.5">
                                <Popover open={partsPopoverOpen} onOpenChange={setPartsPopoverOpen}>
                                    <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-7 text-[9px] font-black px-2"><Search className="w-3 h-3 mr-1" /> AÑADIR (+)</Button></PopoverTrigger>
                                    <PopoverContent className="p-0 w-[280px] sm:w-[350px]" align="end">
                                        <Command shouldFilter={false}><CommandInput placeholder="BUSCAR..." className="h-9" value={productSearch} onValueChange={setProductSearch} /><CommandList>
                                            {productsLoading && <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-primary" /></div>}
                                            <CommandEmpty>{!productsLoading && "Sin resultados."}</CommandEmpty><CommandGroup>
                                                {searchResults.map((p) => (
                                                    <CommandItem key={p.id} onSelect={() => handleAddPartFromInventory(p)} className="flex justify-between items-center text-xs">
                                                        <span className="font-bold uppercase truncate max-w-[150px]">{p.name}</span><Badge variant="secondary" className="text-[8px] h-4">{p.stockLevel - (p.reservedStock || 0)} DISP.</Badge>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup></CommandList></Command>
                                    </PopoverContent>
                                </Popover>
                                <Button type="button" variant="outline" size="sm" className="h-7 text-[9px] font-black px-2 border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => setManualQuickAddOpen(true)}><Plus className="w-3 h-3 mr-1" /> MANUAL (+)</Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {reservedParts.length === 0 && <p className="text-center text-[10px] text-muted-foreground italic py-4 bg-muted/20 rounded-md border border-dashed">Sin materiales añadidos.</p>}
                            {reservedParts.map((part) => {
                                const pData = allProducts?.find(p => p.id === part.productId);
                                let price = part.isWarranty ? 0 : (part.isManual ? (part.isPromo ? (part.manualPriceOffer || 0) : (part.manualPrice || 0)) : (part.isPromo && pData?.promoPrice ? pData.promoPrice : getFinalPrice(pData || { costPrice: part.costPrice } as Product)));
                                return (
                                    <div key={part.productId} className={cn("flex justify-between items-center p-2 rounded-md border transition-colors", part.isConsumed ? "bg-green-50" : "bg-slate-50")}>
                                        <div className="flex flex-col"><div className="flex items-center gap-1.5">{part.isManual && <Badge variant="outline" className="text-[7px] h-3 px-1 border-blue-300 text-blue-600 font-black">MANUAL</Badge>}<span className="font-bold text-[11px] uppercase truncate max-w-[180px]">{part.productName}</span></div>
                                        <div className="flex items-center gap-2 flex-wrap"><span className="text-[10px] text-muted-foreground">1x ${price.toFixed(2)}</span>{part.isConsumed && <Badge className="bg-green-600 text-[8px] h-4">COBRADO</Badge>}{part.isPromo && !part.isWarranty && <Badge className="text-[8px] h-3 bg-blue-600">OFERTA</Badge>}</div></div>
                                        <div className="flex items-center gap-1">
                                            <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className={cn("h-7 w-7", part.isPromo ? "text-blue-600 bg-blue-100" : "text-muted-foreground")} onClick={() => handleTogglePartPromo(part.productId)} disabled={part.isConsumed}><TicketPercent className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent><p>Oferta</p></TooltipContent></Tooltip></TooltipProvider>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemovePart(part.productId)} disabled={part.isConsumed}><Trash2 className="w-3.5 h-3.5" /></Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2 shadow-lg border-t-4 border-primary">
                        <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-tighter"><span>Monto Total Orden:</span><span>Eq: Bs {formatCurrency(estimatedTotal * (effectiveIsPromo ? parallelRate : bcvRate))}</span></div>
                        <div className="flex justify-between items-end"><div className="flex flex-col"><span className="text-[10px] font-bold text-primary uppercase">Total Estimado</span>{currentPaid > 0 && <span className="text-[9px] text-green-400 font-bold">ABONADO: -${currentPaid.toFixed(2)}</span>}</div>
                        <div className="text-right"><span className="text-2xl sm:text-3xl font-black text-white leading-none">${(estimatedTotal - currentPaid).toFixed(2)}</span><p className="text-[10px] text-slate-500 font-bold uppercase">Saldo Pendiente</p></div></div>
                    </div>
                </div>
                <DialogFooter className="p-4 sm:p-6 border-t bg-white shrink-0"><Button type="submit" disabled={isSubmitting} className="w-full h-11 font-bold shadow-lg uppercase">{isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : (repairJob ? "GUARDAR CAMBIOS" : "REGISTRAR Y GENERAR TICKET")}</Button></DialogFooter>
            </form>
        </Form>
        <ManualPartDialog open={manualQuickAddOpen} onOpenChange={setManualQuickAddOpen} onAdd={handleAddManualPart} />
        {replenishProduct && <ProductFormDialog product={replenishProduct} isOpen={!!replenishProduct} onOpenChange={(v) => !v && setReplenishProduct(null)} onSaved={handleAddPartFromInventory} />}
      </DialogContent>
    </Dialog>
  );
}
