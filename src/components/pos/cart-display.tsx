"use client";

import { cleanObject } from "@/lib/json-guard";
import type { CartItem, Payment, Product, Sale, RepairJob, ReservedPart } from "@/lib/types";
import { Button } from "../ui/button";
import { Trash2, TicketPercent, Gift, ParkingSquare, UserPlus, UserX, UserCheck, User, Search, BadgePercent, Tag, ShoppingCart, ArrowRight, ArrowLeft } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { CheckoutDialog } from "./checkout-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { ScrollArea } from "../ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useFirebase, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { doc, writeBatch, runTransaction, collection, query, orderBy, increment, serverTimestamp, getDocs, where, limit } from "firebase/firestore";
import { getEffectivePlanLimits, OWNER_OPERATOR_ID } from "@/lib/cashiers";
import { fetchDocsByIds } from '@/lib/firestore/fetch-by-ids';
import { dailyRef, monthlyRef, saleStatsWrites } from '@/lib/firestore/rollups';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import { invalidateStatsRange } from '@/lib/firestore/stats-range';
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { HoldSaleDialog } from "./hold-sale-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { enqueueOfflineOperation } from "@/lib/offline-sync-manager";
import { SmoothCollapse } from "@/components/ui/smooth-collapse";

function generateSaleId() {
    const date = new Date();
    return `S-${format(date, "yyMMdd")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function CustomerDialog({ onSave, currentName, currentID }: { onSave: (name: string, id: string) => void, currentName: string, currentID: string }) {
    const { firestore, user } = useFirebase();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(currentName);
    const [id, setId] = useState(currentID);
    const [foundCustomer, setFoundCustomer] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            setName(currentName);
            setId(currentID);
            setFoundCustomer(null);
        }
    }, [open, currentName, currentID]);

    useEffect(() => {
        if (!id || id.length < 5 || !firestore || !user || !open) {
            setFoundCustomer(null);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const q = query(
                    collection(firestore, 'users', user.uid, 'sale_transactions'),
                    where('customerID', '==', id.toUpperCase().trim()),
                    limit(1)
                );
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const data = snap.docs[0].data();
                    if (data?.customerName) {
                        setFoundCustomer(data.customerName);
                    }
                }
            } catch (e) {}
        }, 400);
        return () => clearTimeout(timer);
    }, [id, firestore, user, open]);

    const handleApplyCustomerData = () => {
        if (foundCustomer) {
            setName(foundCustomer.toUpperCase());
            toast({ title: "Datos cargados", description: `Se aplicó el nombre guardado para el ID ${id}` });
        }
    };

    const handleSave = () => {
        onSave(name.toUpperCase().trim(), id.toUpperCase().trim());
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm" 
                    className={cn(
                        "h-8 text-xs font-medium flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 px-2.5 transition-colors shadow-2xs", 
                        (currentName || currentID) ? "text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100" : "text-slate-700"
                    )}
                >
                    {(currentName || currentID) ? <UserCheck className="w-3.5 h-3.5 text-emerald-600" /> : <UserPlus className="w-3.5 h-3.5 text-slate-500" />}
                    {(currentName || currentID) ? "Cliente Asignado" : "Asignar Cliente"}
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-[400px] p-0 sm:p-0 gap-0 overflow-hidden rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-2xl">
                <div className="px-4 py-3 sm:px-5 border-b border-slate-100 bg-white">
                    <DialogHeader className="space-y-0 pr-10 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-sm sm:text-[15px] font-semibold text-slate-900 leading-none sm:leading-tight">
                                    Datos del Cliente
                                </DialogTitle>
                                <DialogDescription className="sr-only sm:not-sr-only sm:block sm:mt-0.5 text-slate-500 text-[11px] font-normal">
                                    Aparecerán en la nota de venta y el comprobante.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>
                <div className="px-4 py-3.5 sm:px-5 space-y-3 bg-white">
                    <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-600">Cédula / RIF</Label>
                        <Input 
                            name="mm-customer-id"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            value={id} 
                            onChange={(e) => setId(e.target.value.toUpperCase())} 
                            placeholder="Ej: V-12345678" 
                            className="h-10 sm:h-9 uppercase font-mono text-xs rounded-lg bg-white border-slate-200 text-slate-900 placeholder:normal-case placeholder:font-sans placeholder:text-slate-400 focus-visible:border-blue-500" 
                        />
                    </div>

                    <SmoothCollapse open={Boolean(foundCustomer && name.toUpperCase() !== foundCustomer.toUpperCase())}>
                        <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1.5 font-medium w-full border border-emerald-200 rounded-lg"
                            onClick={handleApplyCustomerData}
                        >
                            <Search className="w-3.5 h-3.5" />
                            Cargar: {foundCustomer}
                        </Button>
                    </SmoothCollapse>

                    <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-600">Nombre y Apellido</Label>
                        <Input 
                            name="mm-customer-name"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            value={name} 
                            onChange={(e) => setName(e.target.value.toUpperCase())} 
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (id.trim() || name.trim())) handleSave();
                            }}
                            placeholder="Ej: Juan Pérez" 
                            className="h-10 sm:h-9 uppercase text-xs rounded-lg bg-white border-slate-200 text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500" 
                        />
                    </div>
                </div>
                <div className="px-4 py-3 sm:px-5 border-t border-slate-100 bg-white">
                    <Button onClick={handleSave} className="w-full h-10 rounded-xl text-xs sm:text-sm font-medium bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm" disabled={!id.trim() && !name.trim()}>
                        Guardar Datos
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function PreCheckoutCustomerDialog({
    open,
    onOpenChange,
    onContinueGeneral,
    onAssignAndContinue,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onContinueGeneral: () => void;
    onAssignAndContinue: (name: string, id: string) => void;
}) {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [mode, setMode] = useState<'ask' | 'assign'>('ask');
    const [name, setName] = useState("");
    const [id, setId] = useState("");
    const [foundCustomer, setFoundCustomer] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setMode('ask');
            setName("");
            setId("");
            setFoundCustomer(null);
        }
    }, [open]);

    useEffect(() => {
        if (!id || id.length < 5 || !firestore || !user || !open || mode !== 'assign') {
            setFoundCustomer(null);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const q = query(
                    collection(firestore, 'users', user.uid, 'sale_transactions'),
                    where('customerID', '==', id.toUpperCase().trim()),
                    limit(1)
                );
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const data = snap.docs[0].data();
                    if (data?.customerName) {
                        setFoundCustomer(data.customerName);
                    }
                }
            } catch (e) {}
        }, 400);
        return () => clearTimeout(timer);
    }, [id, firestore, user, open, mode]);

    const handleApplyCustomerData = () => {
        if (foundCustomer) {
            setName(foundCustomer.toUpperCase());
            toast({ title: "Datos cargados", description: `Se aplicó el nombre guardado para el ID ${id}` });
        }
    };

    const handleSaveAndPay = () => {
        if (!id.trim() && !name.trim()) return;
        onAssignAndContinue(name.toUpperCase().trim(), id.toUpperCase().trim());
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-[390px] p-0 sm:p-0 gap-0 overflow-hidden rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-2xl">
                <div className="px-4 py-3 sm:px-5 border-b border-slate-100 bg-white">
                    <DialogHeader className="space-y-0 pr-10 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-sm sm:text-[15px] font-semibold text-slate-900 leading-none sm:leading-tight">
                                    {mode === 'ask' ? '¿Asignar cliente?' : 'Asignar cliente'}
                                </DialogTitle>
                                <DialogDescription className="sr-only">
                                    {mode === 'ask'
                                        ? 'Elige si continuar como cliente general o asignar datos del cliente antes de pagar.'
                                        : 'Ingresa la cédula o nombre del cliente antes de continuar al cobro.'}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                {mode === 'ask' ? (
                    <div className="px-4 py-4 sm:px-5 space-y-3 bg-white">
                        <p className="text-xs leading-relaxed text-slate-500">
                            No has asignado un cliente a esta venta. Puedes continuar como <span className="font-medium text-slate-700">Cliente General</span> o registrar sus datos antes de cobrar.
                        </p>

                        <div className="flex flex-col gap-2 pt-0.5">
                            <Button
                                type="button"
                                onClick={() => setMode('assign')}
                                className="w-full h-10 rounded-xl text-xs sm:text-sm font-medium bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm shadow-blue-500/20 flex items-center justify-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                <span>Asignar cliente</span>
                            </Button>

                            <Button
                                type="button"
                                variant="outline"
                                onClick={onContinueGeneral}
                                className="w-full h-10 rounded-xl text-xs sm:text-sm font-medium border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center justify-center gap-2"
                            >
                                <User className="w-4 h-4 text-slate-500" />
                                <span>Continuar como Cliente General</span>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="px-4 py-3.5 sm:px-5 space-y-3 bg-white">
                            <div className="space-y-1">
                                <Label className="text-xs font-medium text-slate-600">Cédula / RIF</Label>
                                <Input
                                    name="mm-precheckout-customer-id"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="characters"
                                    spellCheck={false}
                                    autoFocus
                                    value={id}
                                    onChange={(e) => setId(e.target.value.toUpperCase())}
                                    placeholder="Ej: V-12345678"
                                    className="h-10 sm:h-9 uppercase font-mono text-xs rounded-lg bg-white border-slate-200 text-slate-900 placeholder:normal-case placeholder:font-sans placeholder:text-slate-400 focus-visible:border-blue-500"
                                />
                            </div>

                            <SmoothCollapse open={Boolean(foundCustomer && name.toUpperCase() !== foundCustomer.toUpperCase())}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1.5 font-medium w-full border border-emerald-200 rounded-lg"
                                    onClick={handleApplyCustomerData}
                                >
                                    <Search className="w-3.5 h-3.5" />
                                    Cargar: {foundCustomer}
                                </Button>
                            </SmoothCollapse>

                            <div className="space-y-1">
                                <Label className="text-xs font-medium text-slate-600">Nombre y Apellido</Label>
                                <Input
                                    name="mm-precheckout-customer-name"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="characters"
                                    spellCheck={false}
                                    value={name}
                                    onChange={(e) => setName(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && (id.trim() || name.trim())) {
                                            handleSaveAndPay();
                                        }
                                    }}
                                    placeholder="Ej: Juan Pérez"
                                    className="h-10 sm:h-9 uppercase text-xs rounded-lg bg-white border-slate-200 text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="px-4 py-3 sm:px-5 border-t border-slate-100 bg-white flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setMode('ask')}
                                className="h-10 sm:h-9 px-3 rounded-xl sm:rounded-lg text-xs font-medium border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            >
                                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                                Volver
                            </Button>
                            <Button
                                type="button"
                                onClick={handleSaveAndPay}
                                disabled={!id.trim() && !name.trim()}
                                className="flex-1 h-10 sm:h-9 rounded-xl sm:rounded-lg text-xs sm:text-sm font-medium bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm flex items-center justify-center gap-1.5"
                            >
                                <span>Guardar y cobrar</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function DiscountItemControl({ productId, currentDiscount, onApply }: { productId: string, currentDiscount: number, onApply: (id: string, d: number) => void }) {
    const [tempVal, setTempVal] = useState(currentDiscount > 0 ? currentDiscount.toString() : "");
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setTempVal(currentDiscount > 0 ? currentDiscount.toString() : "");
        }
    }, [isOpen, currentDiscount]);

    const handleConfirm = () => {
        const d = Math.max(0, parseFloat(tempVal) || 0);
        onApply(productId, d);
        setIsOpen(false);
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button 
                    type="button"
                    variant="ghost" 
                    size="icon" 
                    className={cn("h-8 w-8 sm:h-7 sm:w-7", currentDiscount > 0 ? "text-amber-700 bg-amber-100" : "text-slate-400 hover:text-slate-700")}
                >
                    <BadgePercent className="h-3.5 w-3.5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3 bg-white border-slate-200 shadow-xl text-slate-900" align="end">
                <div className="space-y-3">
                    <Label className="text-xs font-medium text-slate-600">Descuento ($/un)</Label>
                    <Input 
                        type="number" 
                        name="mm-item-discount"
                        autoComplete="off"
                        step="0.01" 
                        value={tempVal} 
                        onChange={(e) => setTempVal(e.target.value)}
                        className="h-9 rounded-lg text-xs font-medium bg-white border-slate-200 text-slate-900 shadow-2xs"
                        placeholder="0.00"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                    />
                    <Button onClick={handleConfirm} className="w-full h-8 rounded-lg text-xs font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                        Aplicar
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/** Acciones de una línea del carrito (compartidas por tabla y tarjeta móvil). */
function CartLineActions({
    item,
    hasPromoAvailable,
    onTogglePromo,
    onToggleGift,
    onRemoveItem,
    onUpdateDiscount,
    touch = false,
}: {
    item: CartItem;
    hasPromoAvailable: boolean;
    onTogglePromo: (productId: string) => void;
    onToggleGift: (productId: string) => void;
    onRemoveItem: (productId: string, isRepair?: boolean) => void;
    onUpdateDiscount: (productId: string, discount: number) => void;
    touch?: boolean;
}) {
    const sizeClass = touch ? "h-9 w-9" : "h-8 w-8 sm:h-7 sm:w-7";

    return (
        <div className="flex items-center gap-0.5">
            <TooltipProvider>
                {hasPromoAvailable && !item.isCustom && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(sizeClass, item.isPromo ? "text-blue-600 bg-blue-100" : "text-slate-400 hover:text-slate-700")}
                                onClick={() => onTogglePromo(item.productId)}
                            >
                                <TicketPercent className="h-3.5 w-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>Activar Tasa de Reposición (Oferta)</p></TooltipContent>
                    </Tooltip>
                )}

                {!item.isRepair && (
                    <>
                        <DiscountItemControl
                            productId={item.productId}
                            currentDiscount={item.discount || 0}
                            onApply={onUpdateDiscount}
                        />

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn(sizeClass, item.isGift ? "text-emerald-600 bg-emerald-100" : "text-slate-400 hover:text-slate-700")}
                                    onClick={() => onToggleGift(item.productId)}
                                >
                                    <Gift className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Marcar como Obsequio</p></TooltipContent>
                        </Tooltip>
                    </>
                )}

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(sizeClass, "text-slate-400 hover:text-rose-600 hover:bg-rose-50")}
                            onClick={() => onRemoveItem(item.productId, item.isRepair)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Quitar del carrito</p></TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
}

export interface CartDisplayProps {
  cart: CartItem[];
  allProducts: Product[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateDiscount: (productId: string, discount: number) => void;
  onRemoveItem: (productId: string, isRepair?: boolean) => void;
  onClearCart: () => void;
  onTogglePromo: (productId: string) => void;
  onToggleGift: (productId: string) => void;
  onHoldSale?: (name: string, customerName?: string, customerID?: string) => void;
  onCheckoutSuccess?: (sale: Sale, consumedParts?: ReservedPart[]) => void;
  repairJobId?: string | null;
  /** En móvil: vuelve a la pestaña de productos. */
  onBrowseProducts?: () => void;
}

export function CartDisplay({ cart, allProducts, onUpdateQuantity, onUpdateDiscount, onRemoveItem, onClearCart, repairJobId, onTogglePromo, onToggleGift, onHoldSale, onCheckoutSuccess, onBrowseProducts }: CartDisplayProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { format: formatCurrency, getFinalPrice, getSymbol, convert, bcvRate, parallelRate } = useCurrency();
  const { updateCachedItem, addItemToCache, profile, activeOperator, registerName } = useDashboardStore();
  
  const [customerName, setCustomerName] = useState("");
  const [customerID, setCustomerID] = useState("");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCustomerPromptOpen, setIsCustomerPromptOpen] = useState(false);

  const repairJobRef = useMemoFirebase(() => 
    (repairJobId && firestore && user) ? doc(firestore, 'users', user.uid, 'repair_jobs', repairJobId) : null,
    [repairJobId, firestore, user?.uid]
  );
  const { data: activeRepairJob } = useDoc<RepairJob>(repairJobRef);


  const getPrice = (item: CartItem, catalog: Product[] = allProducts) => {
    if (item.isGift || item.isWarranty) return 0;
    
    let base = 0;
    if (item.isRepair) {
        if (!activeRepairJob) return 0;
        base = Math.max(0, activeRepairJob.estimatedCost - (activeRepairJob.amountPaid || 0));
        
        if (item.isPromo && activeRepairJob.reservedParts && activeRepairJob.reservedParts.length > 0) {
            let totalAdditionalDiscount = 0;
            activeRepairJob.reservedParts.forEach(part => {
                if (!part.isPromo) {
                    const product = catalog.find(p => p.id === part.productId);
                    if (product && product.promoPrice && product.promoPrice > 0) {
                        const retailPriceOfPart = getFinalPrice(product);
                        const diff = Math.max(0, retailPriceOfPart - product.promoPrice);
                        totalAdditionalDiscount += diff * part.quantity;
                    }
                }
            });
            base = Math.max(0, base - totalAdditionalDiscount);
        }
    } else if (item.isCustom) {
        base = item.customPrice || 0;
    } else {
        const product = catalog.find(p => p.id === item.productId);
        if (!product) {
            // Producto fuera de la página y ya no está en RAM: usar el precio
            // congelado al añadirlo, en lugar de cobrar 0.
            return Math.max(0, (item.basePrice || 0) - (item.discount || 0));
        }
        
        base = (item.isPromo && typeof product.promoPrice === 'number' && product.promoPrice > 0) 
            ? product.promoPrice 
            : getFinalPrice(product);
    }

    return Math.max(0, base - (item.discount || 0));
  };
  
  const total = cart.reduce((acc, item) => acc + getPrice(item) * item.quantity, 0);

  const hasPromo = cart.some(i => i.isPromo);
  const cartCount = cart.reduce((acc, item) => acc + (item.quantity || 0), 0);

  const handleCheckout = async (payments: Payment[], changeGiven: Payment[], totalChangeInUSD: number): Promise<Sale | null> => {
      if (!firestore || !user) return null;

      // Catálogo paginado: si algún artículo no está en RAM, se trae por id
      // para no registrar costo 0 ni saltarse la validación de stock.
      let catalog = allProducts;
      const missingIds = cart
          .filter((item) => !item.isCustom && !item.isRepair && !catalog.some((p) => p.id === item.productId))
          .map((item) => item.productId);

      if (missingIds.length > 0) {
          const fetched = await fetchDocsByIds<Product>(firestore, user.uid, 'products', missingIds);
          if (fetched.length > 0) catalog = [...catalog, ...fetched];
      }

      const saleId = generateSaleId();
      
      const cartWithPrices = cart.map(item => {
          const product = catalog.find(p => p.id === item.productId);
          const finalCost = item.isCustom ? (item.customCostPrice || 0) : (item.costPrice ?? product?.costPrice ?? 0);
          return { 
              ...item, 
              price: getPrice(item, catalog),
              costPrice: finalCost
          };
      });

      const hasRepairInCart = cartWithPrices.some(i => i.isRepair);

      const totalPaidInUSD = payments.reduce((acc, p) => {
          return acc + (p.method === 'Efectivo USD' || p.method === 'USDT / Crypto' ? p.amount : convert(p.amount, 'Bs', 'USD', true));
      }, 0);
      const actualNetPaidInUSD = totalPaidInUSD - totalChangeInUSD;
      // Valoracion del mismo cobro en la base del dialogo (BCV). El cliente paga
      // los Bs que el sistema le pide, asi que la reparacion debe quedar saldada
      // aunque su valor real en dolares (a reposicion) sea menor.
      const settledPaidInUSD = payments.reduce((acc, p) => {
          return acc + (p.method === 'Efectivo USD' || p.method === 'USDT / Crypto' ? p.amount : convert(p.amount, 'Bs', 'USD', hasPromo));
      }, 0) - totalChangeInUSD;
      const realIncomeUSD = actualNetPaidInUSD;

      try {
        const partsToNotify = activeRepairJob?.reservedParts || [];
        let repairUpdateForCache: any = null;
        let repairPartsCost = 0;
        let totalCostUSD = 0;
        const stockDeductions = new Map<string, { stock: number, reserved: number, salesCount: number }>();

        // 1. Validar y acumular costos de repuestos de reparación si aplica
        if (activeRepairJob && hasRepairInCart) {
            if (activeRepairJob.reservedParts) {
                for (const part of activeRepairJob.reservedParts) {
                    const partCost = (part.costPrice * part.quantity);
                    repairPartsCost += partCost;
                    totalCostUSD += partCost;
                    if (part.isManual) continue;
                    const current = stockDeductions.get(part.productId) || { stock: 0, reserved: 0, salesCount: 0 };
                    stockDeductions.set(part.productId, { 
                        stock: current.stock + part.quantity, 
                        reserved: current.reserved + part.quantity,
                        salesCount: current.salesCount + part.quantity
                    });
                }
            }
            if (repairPartsCost === 0 && activeRepairJob.consumedParts && activeRepairJob.consumedParts.length > 0 && !activeRepairJob.partsConsumed) {
                for (const part of activeRepairJob.consumedParts) {
                    repairPartsCost += (part.costPrice * part.quantity);
                }
            }
        }

        // 2. Procesar productos regulares desde memoria RAM (allProducts)
        for (const item of cartWithPrices) {
            if (item.isRepair) continue;
            if (item.isCustom) {
                totalCostUSD += (item.customCostPrice || 0) * item.quantity;
                continue;
            }
            const product = catalog.find(p => p.id === item.productId);
            totalCostUSD += (item.costPrice ?? product?.costPrice ?? 0) * item.quantity;

            const current = stockDeductions.get(item.productId) || { stock: 0, reserved: 0, salesCount: 0 };
            stockDeductions.set(item.productId, { 
                stock: current.stock + item.quantity, 
                reserved: current.reserved,
                salesCount: current.salesCount + item.quantity
            });
        }

        // 3. Verificación de stock disponible en memoria RAM (0ms de latencia, 0 lecturas)
        for (const [pid, ded] of Array.from(stockDeductions.entries())) {
            const product = catalog.find(p => p.id === pid);
            if (product && product.stockLevel < ded.stock) {
                throw new Error(`¡Inventario Bloqueado! Solo quedan ${product.stockLevel} ${product.unit || 'un.'} de "${product.name}".`);
            }
        }

        const profitUSD = realIncomeUSD - totalCostUSD;

        // 4. Congelación precisa de costo unitario por artículo
        const itemsWithPreciseCost = cartWithPrices.map(item => {
            if (item.isRepair) {
                return {
                    ...item,
                    costPrice: Number((repairPartsCost / (item.quantity || 1)).toFixed(2))
                };
            }
            if (item.isCustom) {
                return {
                    ...item,
                    costPrice: Number((item.customCostPrice || 0).toFixed(2))
                };
            }
            const product = catalog.find(p => p.id === item.productId);
            const unitCost = item.costPrice ?? product?.costPrice ?? 0;
            return {
                ...item,
                costPrice: Number(unitCost.toFixed(2))
            };
        });

        // 5. Preparar actualización de reparación si aplica
        if (repairJobId && activeRepairJob && hasRepairInCart) {
            const otherItemsTotal = cartWithPrices
                .filter(i => !i.isRepair)
                .reduce((sum, i) => sum + (i.price * i.quantity), 0);
            
            const paidToRepair = Math.max(0, settledPaidInUSD - otherItemsTotal);
            
            let additionalDiscountToApply = 0;
            const repairItem = cartWithPrices.find(i => i.isRepair);
            if (repairItem?.isPromo && activeRepairJob.reservedParts) {
                activeRepairJob.reservedParts.forEach(part => {
                    if (!part.isPromo) {
                        const product = catalog.find(p => p.id === part.productId);
                        if (product && product.promoPrice && product.promoPrice > 0) {
                            additionalDiscountToApply += (getFinalPrice(product) - product.promoPrice) * part.quantity;
                        }
                    }
                });
            }

            const newEstimatedCost = activeRepairJob.estimatedCost - additionalDiscountToApply;
            const newPaidTotal = (activeRepairJob.amountPaid || 0) + paidToRepair;
            const isFullyPaid = newPaidTotal >= (newEstimatedCost - 0.01);

            repairUpdateForCache = { 
                estimatedCost: Number(newEstimatedCost.toFixed(2)),
                amountPaid: Number(newPaidTotal.toFixed(2)), 
                isPaid: isFullyPaid,
                status: isFullyPaid ? 'Pagado' : activeRepairJob.status,
                partsConsumed: true,
                consumedParts: [...(activeRepairJob.consumedParts || []), ...(activeRepairJob.reservedParts || [])],
                reservedParts: []
            };
        }

        const cashierId = activeOperator?.id || OWNER_OPERATOR_ID;
        const cashierName = activeOperator?.name || profile?.accountName || 'Dueño';
        const limits = getEffectivePlanLimits(profile);
        const isMultiRegister = limits.isMultiRegister;

        // 6. Construir objeto limpio de la venta
        const saleData = cleanObject({
            id: saleId,
            items: itemsWithPreciseCost,
            customerName: customerName || null,
            customerID: customerID || null,
            subtotal: total, 
            discount: 0, 
            totalAmount: total,
            costPrice: Number(totalCostUSD.toFixed(2)), 
            paymentMethod: payments.map(p => p.method).join(', '),
            transactionDate: new Date().toISOString(),
            payments, 
            status: 'completed',
            repairJobId: (repairJobId && hasRepairInCart) ? repairJobId : null,
            ...(changeGiven.length > 0 && { changeGiven, totalChangeInUSD }),
            actualPaidAmount: actualNetPaidInUSD,
            bcvRateAtTime: bcvRate,
            parallelRateAtTime: parallelRate,
            cashierId,
            cashierName,
            registerName,
        });

        const stockDeductionsList = Array.from(stockDeductions.entries()).map(([productId, ded]) => ({
            productId,
            stock: ded.stock,
            reserved: ded.reserved,
            salesCount: ded.salesCount
        }));

        const resultSale = { 
            id: saleId, 
            items: itemsWithPreciseCost, 
            customerName: customerName || undefined,
            customerID: customerID || undefined,
            subtotal: total, 
            discount: 0, 
            totalAmount: total, 
            costPrice: totalCostUSD, 
            payments, 
            transactionDate: new Date().toISOString(), 
            status: 'completed',
            changeGiven,
            totalChangeInUSD,
            // Sin esto, los agregados de Reportes calculaban la ganancia con el
            // precio de lista (totalAmount) en vez de con lo realmente cobrado.
            actualPaidAmount: actualNetPaidInUSD,
            repairJobId: (repairJobId && hasRepairInCart) ? repairJobId : null,
            bcvRateAtTime: bcvRate,
            parallelRateAtTime: parallelRate,
            cashierId,
            cashierName,
            registerName,
        } as Sale;

        const applyOptimisticCacheUpdates = () => {
            for (const ded of stockDeductionsList) {
                const product = catalog.find(p => p.id === ded.productId);
                if (product) {
                    const nextStock = Math.max(0, (product.stockLevel || 0) - ded.stock);
                    const nextReserved = Math.max(0, (product.reservedStock || 0) - ded.reserved);
                    const nextSalesCount = (product.salesCount || 0) + ded.salesCount;
                    updateCachedItem(ded.productId, {
                        stockLevel: nextStock,
                        reservedStock: nextReserved,
                        salesCount: nextSalesCount
                    });
                    queryCache.patchItem(user.uid, 'products', ded.productId, {
                        stockLevel: nextStock,
                        reservedStock: nextReserved,
                        salesCount: nextSalesCount
                    });
                }
            }

            if (repairJobId && repairUpdateForCache) {
                updateCachedItem(repairJobId, repairUpdateForCache);
                // La lista paginada de Reparaciones debe reflejar el pago sin recargar.
                queryCache.patchItem(user.uid, 'repair_jobs', repairJobId, repairUpdateForCache);
            }

            addItemToCache('sale_transactions', resultSale);
            // La lista paginada de Reportes también debe ver la venta sin recargar.
            queryCache.mergeIntoCatalog(user.uid, 'sale_transactions', [resultSale as WithId<Sale>]);
            invalidateStatsRange(user.uid);
        };

        // 7 y 8. DESPACHO:
        // - En Multi-Caja (`maxRegisters > 1`): exige internet y usa `runTransaction` atómico
        //   para verificar stock real en el servidor y evitar doble venta entre cajas.
        // - En Plan 1 Caja: mantiene `writeBatch` optimista (0 lecturas) + cola offline.
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

        if (isMultiRegister) {
            if (!isOnline) {
                throw new Error("Sin conexión a internet. En modo Multi-Caja el cobro está bloqueado hasta que regrese la conexión para evitar ventas duplicadas.");
            }

            const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', saleId);
            const statsRef = doc(firestore, 'users', user.uid, 'system', 'estadisticas_actuales');
            const jobRef = (repairJobId && repairUpdateForCache)
                ? doc(firestore, 'users', user.uid, 'repair_jobs', repairJobId)
                : null;

            await runTransaction(firestore, async (tx) => {
                // Fase de lectura atómica: solo productos en este carrito (1 lectura por producto)
                const verifiedProducts: { ref: ReturnType<typeof doc>; ded: typeof stockDeductionsList[number] }[] = [];
                for (const ded of stockDeductionsList) {
                    const pRef = doc(firestore, 'users', user.uid, 'products', ded.productId);
                    const pSnap = await tx.get(pRef);
                    if (!pSnap.exists()) {
                        throw new Error("Uno de los productos del carrito ya no existe en el inventario.");
                    }
                    const pData = pSnap.data() as Product;
                    const serverStock = Number(pData.stockLevel || 0);
                    const serverReserved = Number(pData.reservedStock || 0);
                    const availableForSale = serverStock - Math.max(0, serverReserved - ded.reserved);

                    if (serverStock < ded.stock || availableForSale < ded.stock) {
                        // Sincronizar de inmediato la caché local con el stock real del servidor
                        updateCachedItem(ded.productId, {
                            stockLevel: serverStock,
                            reservedStock: serverReserved,
                        });
                        queryCache.patchItem(user.uid, 'products', ded.productId, {
                            stockLevel: serverStock,
                            reservedStock: serverReserved,
                        });
                        throw new Error(
                            `Stock insuficiente para "${pData.name}": solo quedan ${Math.max(0, availableForSale)} ${pData.unit || 'un.'} disponibles (otra caja pudo haberlo vendido).`
                        );
                    }
                    verifiedProducts.push({ ref: pRef, ded });
                }

                if (jobRef) {
                    const jobSnap = await tx.get(jobRef);
                    if (jobSnap.exists() && jobSnap.data()?.isPaid === true) {
                        throw new Error("Esta reparación ya fue cobrada en otra caja.");
                    }
                }

                // Fase de escritura atómica
                tx.set(saleRef, saleData);

                for (const { ref, ded } of verifiedProducts) {
                    tx.update(ref, {
                        stockLevel: increment(-ded.stock),
                        reservedStock: increment(-ded.reserved),
                        salesCount: increment(ded.salesCount),
                        updatedAt: serverTimestamp()
                    });
                }

                tx.set(statsRef, {
                    totalRealSales30d: increment(realIncomeUSD),
                    totalRealProfit30d: increment(profitUSD),
                    updatedAt: serverTimestamp()
                }, { merge: true });

                try {
                    const stats = saleStatsWrites(resultSale);
                    tx.set(dailyRef(firestore, user.uid, stats.day), stats.daily, { merge: true });
                    tx.set(monthlyRef(firestore, user.uid, stats.day.slice(0, 7)), stats.monthly, { merge: true });
                } catch (statsError) {
                    console.warn('[POS] No se pudieron preparar los agregados:', statsError);
                }

                if (jobRef && repairUpdateForCache) {
                    tx.update(jobRef, repairUpdateForCache);
                }
            });

            applyOptimisticCacheUpdates();
            toast({ title: "Venta Registrada con Éxito" });
        } else {
            // PLAN 1 CAJA: Optimista inmediato + 0 lecturas + cola offline
            applyOptimisticCacheUpdates();

            if (isOnline) {
                try {
                    const batch = writeBatch(firestore);

                    const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', saleId);
                    batch.set(saleRef, saleData);

                    for (const ded of stockDeductionsList) {
                        const pRef = doc(firestore, 'users', user.uid, 'products', ded.productId);
                        batch.update(pRef, {
                            stockLevel: increment(-ded.stock),
                            reservedStock: increment(-ded.reserved),
                            salesCount: increment(ded.salesCount),
                            updatedAt: serverTimestamp()
                        });
                    }

                    const statsRef = doc(firestore, 'users', user.uid, 'system', 'estadisticas_actuales');
                    batch.set(statsRef, {
                        totalRealSales30d: increment(realIncomeUSD),
                        totalRealProfit30d: increment(profitUSD),
                        updatedAt: serverTimestamp()
                    }, { merge: true });

                    try {
                        const stats = saleStatsWrites(resultSale);
                        batch.set(dailyRef(firestore, user.uid, stats.day), stats.daily, { merge: true });
                        batch.set(monthlyRef(firestore, user.uid, stats.day.slice(0, 7)), stats.monthly, { merge: true });
                    } catch (statsError) {
                        console.warn('[POS] No se pudieron preparar los agregados:', statsError);
                    }

                    if (repairJobId && repairUpdateForCache) {
                        const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', repairJobId);
                        batch.update(jobRef, repairUpdateForCache);
                    }

                    await batch.commit();
                    toast({ title: "Venta Registrada con Éxito" });
                } catch (networkOrWriteErr) {
                    console.warn("[POS] Falló escritura remota directa, guardando en cola offline:", networkOrWriteErr);
                    enqueueOfflineOperation(user.uid, {
                        id: saleId,
                        type: 'SALE_CHECKOUT',
                        payload: {
                            saleId,
                            saleData,
                            stockDeductions: stockDeductionsList,
                            repairUpdate: (repairJobId && repairUpdateForCache) ? { repairJobId, data: repairUpdateForCache } : null,
                            statsUpdate: { incomeUSD: realIncomeUSD, profitUSD }
                        }
                    });
                    toast({ 
                        title: "Venta Guardada Localmente", 
                        description: "Se guardó en memoria y se sincronizará automáticamente al regresar la conexión." 
                    });
                }
            } else {
                enqueueOfflineOperation(user.uid, {
                    id: saleId,
                    type: 'SALE_CHECKOUT',
                    payload: {
                        saleId,
                        saleData,
                        stockDeductions: stockDeductionsList,
                        repairUpdate: (repairJobId && repairUpdateForCache) ? { repairJobId, data: repairUpdateForCache } : null,
                        statsUpdate: { incomeUSD: realIncomeUSD, profitUSD }
                    }
                });
                toast({ 
                    title: "Venta Guardada Localmente (Modo Offline)", 
                    description: "Se guardó en memoria y se sincronizará automáticamente al regresar el internet." 
                });
            }
        }

        if (onCheckoutSuccess) {
            onCheckoutSuccess(resultSale, partsToNotify);
        }

        setCustomerName("");
        setCustomerID("");
        return resultSale;
      } catch (e: any) {
        console.error("Operación fallida:", e);
        toast({ 
            variant: "destructive", 
            title: "Error en Venta", 
            description: e.message || "No se pudo completar la operación." 
        });
        return null;
      }
  };

  const handleClearCart = () => {
    onClearCart();
    setCustomerName("");
    setCustomerID("");
  };

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 border-r border-slate-200/90">
        <div className="px-3.5 py-2.5 sm:px-4 border-b border-slate-200/90 bg-slate-50/80 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <ShoppingCart className="w-3.5 h-3.5 text-blue-600" />
                    Artículos en Caja
                </span>
                {cart.length > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                        {cartCount}
                    </span>
                )}
            </div>
            <CustomerDialog 
                onSave={(name, id) => { setCustomerName(name); setCustomerID(id); }} 
                currentName={customerName} 
                currentID={customerID} 
            />
        </div>
        <SmoothCollapse open={Boolean(customerName || customerID)} collapseMargin={false} className="shrink-0">
            <div className="bg-emerald-50/80 px-4 py-2 border-b border-emerald-100 flex justify-between items-center group">
                <div className="flex items-center gap-2">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-slate-900 leading-tight">{customerName || 'Sin nombre'}</span>
                        <span className="text-[10px] font-normal text-slate-500">{customerID || 'Sin cédula'}</span>
                    </div>
                </div>
                <button type="button" className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-rose-600" onClick={() => { setCustomerName(""); setCustomerID(""); }}>
                    <UserX className="w-3.5 h-3.5" />
                </button>
            </div>
        </SmoothCollapse>
      {cart.length === 0 ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 px-6 py-8 text-center bg-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 border border-slate-200/90 text-slate-400 shadow-sm">
                <Search className="h-5 w-5" />
            </div>
            <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-800">El carrito está vacío</p>
                <p className="max-w-[230px] text-xs leading-relaxed text-slate-500">
                    Busca un producto o escanea su código para empezar la venta.
                </p>
            </div>
            {onBrowseProducts && (
                <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 h-9 md:hidden rounded-lg border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 font-medium shadow-sm"
                    onClick={onBrowseProducts}
                >
                    Ver productos
                </Button>
            )}
        </div>
      ) : (
      <ScrollArea className="flex-1 bg-white">
        {/* Móvil: una tarjeta por artículo (la tabla no cabe en 375px) */}
        <div className="divide-y divide-slate-100 md:hidden">
            {cart.map((item) => {
                const productData = allProducts.find(p => p.id === item.productId);
                const unitLabel = productData?.unit && productData.unit !== 'unit' ? productData.unit : '';

                let hasPromoAvailable = false;
                if (item.isRepair) {
                    hasPromoAvailable = !!activeRepairJob?.reservedParts?.some(part => {
                        const p = allProducts.find(prod => prod.id === part.productId);
                        return p && p.promoPrice && p.promoPrice > 0;
                    });
                } else {
                    hasPromoAvailable = !!(productData?.promoPrice && productData.promoPrice > 0);
                }

                return (
                    <div
                        key={`m-${item.productId}${item.isRepair ? '-rep' : ''}`}
                        className={cn(
                            "p-3 transition-colors hover:bg-slate-50/70",
                            item.isGift && "bg-emerald-50/50",
                            item.isWarranty && "bg-amber-50/50",
                            item.isPromo && "bg-blue-50/50"
                        )}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <p className={cn(
                                "min-w-0 flex-1 line-clamp-2 text-xs font-medium leading-snug text-slate-800",
                                (item.isGift || item.isWarranty) && "line-through text-slate-400"
                            )}>
                                {item.name}
                            </p>
                            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-900">
                                {getSymbol()}{formatCurrency(getPrice(item) * item.quantity)}
                            </span>
                        </div>

                        <div className="mt-1 flex flex-wrap gap-1">
                            {item.isPromo && <Badge className="bg-blue-600 text-white text-[10px] h-4 px-1.5 font-medium">Oferta</Badge>}
                            {(item.discount || 0) > 0 && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-300 bg-amber-50 text-amber-700 font-medium">-${(item.discount ?? 0).toFixed(2)}</Badge>}
                            {item.isGift && <Badge className="bg-emerald-600 text-white text-[10px] h-4 px-1.5 font-medium">Obsequio</Badge>}
                            {item.isWarranty && <Badge className="bg-amber-600 text-white text-[10px] h-4 px-1.5 font-medium">Garantía</Badge>}
                            {item.isRepair && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-blue-300 bg-blue-50 text-blue-700 font-medium">Reparación</Badge>}
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                            <input
                                type="number"
                                step="any"
                                inputMode="decimal"
                                enterKeyHint="done"
                                value={item.quantity}
                                onChange={(e) => onUpdateQuantity(item.productId, Math.max(0.001, parseFloat(e.target.value) || 0))}
                                className="h-8 w-14 rounded-lg border border-slate-200 bg-white text-slate-800 text-center text-xs font-medium shadow-2xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                disabled={item.isRepair}
                                aria-label={`Cantidad de ${item.name}`}
                            />
                            {unitLabel && <span className="text-[10px] font-normal text-slate-500">{unitLabel}</span>}
                            <div className="ml-auto">
                                <CartLineActions
                                    item={item}
                                    hasPromoAvailable={hasPromoAvailable}
                                    onTogglePromo={onTogglePromo}
                                    onToggleGift={onToggleGift}
                                    onRemoveItem={onRemoveItem}
                                    onUpdateDiscount={onUpdateDiscount}
                                    touch
                                />
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>

        <div className="hidden md:block">
        <Table>
            <TableHeader className="bg-slate-50/90 border-b border-slate-200/90">
                <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                    <TableHead className="w-[50%] text-[11px] font-medium text-slate-500">Producto</TableHead>
                    <TableHead className="text-center text-[11px] font-medium text-slate-500">Cant / Peso</TableHead>
                    <TableHead className="text-right text-[11px] font-medium text-slate-500">Total</TableHead>
                    <TableHead className="w-[100px] text-right text-[11px] font-medium text-slate-500">Acciones</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {cart.map((item) => {
                    const productData = allProducts.find(p => p.id === item.productId);
                    const unitLabel = productData?.unit && productData.unit !== 'unit' ? productData.unit : '';
                    
                    let hasPromoAvailable = false;
                    if (item.isRepair) {
                        hasPromoAvailable = !!activeRepairJob?.reservedParts?.some(part => {
                            const p = allProducts.find(prod => prod.id === part.productId);
                            return p && p.promoPrice && p.promoPrice > 0;
                        });
                    } else {
                        hasPromoAvailable = !!(productData?.promoPrice && productData.promoPrice > 0);
                    }

                    return (
                        <TableRow key={item.productId + (item.isRepair ? '-rep' : '')} className={cn(
                            "border-b border-slate-100 hover:bg-slate-50/70 transition-colors",
                            item.isGift && "bg-emerald-50/50",
                            item.isWarranty && "bg-amber-50/50",
                            item.isPromo && "bg-blue-50/50"
                        )}>
                            <TableCell className="text-xs py-2.5">
                                <div className="flex flex-col gap-1">
                                    <span className={cn("text-slate-800 font-medium leading-snug", (item.isGift || item.isWarranty) && "line-through text-slate-400")}>{item.name}</span>
                                    <div className="flex flex-wrap gap-1">
                                        {item.isPromo && <Badge className="bg-blue-600 text-white text-[10px] h-4 px-1.5 font-medium">Oferta</Badge>}
                                        {(item.discount || 0) > 0 && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-300 bg-amber-50 text-amber-700 font-medium">-${(item.discount ?? 0).toFixed(2)}</Badge>}
                                        {item.isGift && <Badge className="bg-emerald-600 text-white text-[10px] h-4 px-1.5 font-medium">Obsequio</Badge>}
                                        {item.isWarranty && <Badge className="bg-amber-600 text-white text-[10px] h-4 px-1.5 font-medium">Garantía</Badge>}
                                        {item.isRepair && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-blue-300 bg-blue-50 text-blue-700 font-medium">Reparación</Badge>}
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-center">
                                <div className="flex flex-col items-center gap-0.5">
                                    <input 
                                        type="number" 
                                        step="any"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        value={item.quantity} 
                                        onChange={(e) => onUpdateQuantity(item.productId, Math.max(0.001, parseFloat(e.target.value) || 0))} 
                                        className="w-16 border border-slate-200 bg-white text-slate-800 font-medium rounded-lg text-center text-xs h-7 shadow-2xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500" 
                                        disabled={item.isRepair} 
                                    />
                                    {unitLabel && <span className="text-[10px] font-normal text-slate-500">{unitLabel}</span>}
                                </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-xs tabular-nums text-slate-800">
                                {getSymbol()}{formatCurrency(getPrice(item) * item.quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end">
                                    <CartLineActions
                                        item={item}
                                        hasPromoAvailable={hasPromoAvailable}
                                        onTogglePromo={onTogglePromo}
                                        onToggleGift={onToggleGift}
                                        onRemoveItem={onRemoveItem}
                                        onUpdateDiscount={onUpdateDiscount}
                                    />
                                </div>
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
        </div>
      </ScrollArea>
      )}
      <div className="space-y-3 border-t border-slate-200/90 bg-slate-50/90 p-3.5 sm:p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white rounded-xl border border-slate-200/90 shadow-2xs">
            <span className="text-xs font-medium text-slate-500">Total a Pagar</span>
            <div className="flex flex-col items-end text-right">
                <div className="text-lg font-semibold leading-none tabular-nums text-slate-900 sm:text-xl">
                    {getSymbol('USD')}{formatCurrency(total, 'USD')}
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    <span>Bs</span>
                    <span>{formatCurrency(convert(total, 'USD', 'Bs', hasPromo), 'Bs')}</span>
                </div>
            </div>
        </div>

        <Button 
            type="button"
            size="lg" 
            onClick={() => {
                if (cart.length === 0) return;
                const hasAssignedCustomer = Boolean(customerName.trim() || customerID.trim());
                const isRepairWithCustomer = Boolean(repairJobId && cart.some(i => i.isRepair) && activeRepairJob?.customerName);
                if (hasAssignedCustomer || isRepairWithCustomer) {
                    setIsCheckoutOpen(true);
                } else {
                    setIsCustomerPromptOpen(true);
                }
            }}
            className="h-11 w-full text-sm font-medium rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-sm shadow-emerald-500/25 active:scale-[0.99] transition-all flex items-center justify-center gap-2" 
            disabled={cart.length === 0}
        >
            <span>Pagar Compra</span>
            <span className="text-xs font-normal opacity-90">({cartCount} {cartCount === 1 ? 'artículo' : 'artículos'})</span>
        </Button>

        <PreCheckoutCustomerDialog
            open={isCustomerPromptOpen}
            onOpenChange={setIsCustomerPromptOpen}
            onContinueGeneral={() => {
                setIsCustomerPromptOpen(false);
                setIsCheckoutOpen(true);
            }}
            onAssignAndContinue={(name, id) => {
                setCustomerName(name);
                setCustomerID(id);
                setIsCustomerPromptOpen(false);
                setIsCheckoutOpen(true);
            }}
        />

        <CheckoutDialog 
            open={isCheckoutOpen}
            onOpenChange={setIsCheckoutOpen}
            cart={cart} 
            allProducts={allProducts} 
            total={total} 
            onCheckout={handleCheckout} 
            onClearCart={handleClearCart} 
            isRepairSale={!!repairJobId && cart.some(i => i.isRepair)} 
            repairData={activeRepairJob}
            customerName={customerName}
            customerID={customerID}
        />
        
        <div className="grid grid-cols-2 gap-2">
            {onHoldSale && (
                <HoldSaleDialog onHoldSale={onHoldSale} disabled={cart.length === 0 || cart.some(c => c.isRepair)}>
                    <Button variant="outline" size="sm" className="w-full text-xs h-8 rounded-lg border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium shadow-2xs">
                        <ParkingSquare className="mr-1.5 h-3.5 w-3.5 text-blue-600" /> Aparcar Venta
                    </Button>
                </HoldSaleDialog>
            )}
            <Button variant="ghost" size="sm" className="w-full text-xs text-slate-500 hover:text-rose-600 hover:bg-rose-50 h-8 rounded-lg font-normal transition-colors" onClick={handleClearCart} disabled={cart.length === 0}>
                Vaciar Carrito
            </Button>
        </div>
      </div>
    </div>
  );
}
