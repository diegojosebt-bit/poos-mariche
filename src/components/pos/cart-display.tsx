"use client";

import { cleanObject } from "@/lib/json-guard";
import type { CartItem, Payment, Product, Sale, RepairJob, ReservedPart } from "@/lib/types";
import { Button } from "../ui/button";
import { Trash2, TicketPercent, Gift, ParkingSquare, UserPlus, UserX, UserCheck, Search, BadgePercent, Tag } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { CheckoutDialog } from "./checkout-dialog";
import { useCurrency } from "@/hooks/use-currency";
import { ScrollArea } from "../ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useFirebase, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { doc, runTransaction, type DocumentSnapshot, collection, query, orderBy, increment } from "firebase/firestore";
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

function generateSaleId() {
    const date = new Date();
    return `S-${format(date, "yyMMdd")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function CustomerDialog({ onSave, currentName, currentID, sales }: { onSave: (name: string, id: string) => void, currentName: string, currentID: string, sales: Sale[] }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(currentName);
    const [id, setId] = useState(currentID);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            setName(currentName);
            setId(currentID);
        }
    }, [open, currentName, currentID]);

    const foundCustomer = useMemo(() => {
        if (!id || id.length < 5 || !sales) return null;
        const match = sales.find(s => s.customerID?.toUpperCase().trim() === id.toUpperCase().trim());
        if (match && match.customerName) return match.customerName;
        return null;
    }, [id, sales]);

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
                <Button variant="ghost" size="sm" className={cn("h-8 text-[10px] font-black uppercase flex items-center gap-1.5", (currentName || currentID) ? "text-primary bg-primary/10" : "text-muted-foreground")}>
                    {(currentName || currentID) ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                    {(currentName || currentID) ? "Cliente Asignado" : "Asignar Cliente"}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="uppercase font-bold">Datos del Cliente</DialogTitle>
                    <DialogDescription>Estos datos aparecerán en la nota de venta y el comprobante.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase">Cédula / RIF</Label>
                        <Input 
                            value={id} 
                            onChange={(e) => setId(e.target.value.toUpperCase())} 
                            placeholder="EJ: V-12345678" 
                            className="uppercase font-mono" 
                        />
                    </div>

                    {foundCustomer && (name.toUpperCase() !== foundCustomer.toUpperCase()) && (
                        <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 flex items-center gap-1.5 font-bold w-full border border-blue-200"
                            onClick={handleApplyCustomerData}
                        >
                            <Search className="w-3.5 h-3.5" />
                            CARGAR NOMBRE: {foundCustomer.toUpperCase()}
                        </Button>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase">Nombre y Apellido</Label>
                        <Input 
                            value={name} 
                            onChange={(e) => setName(e.target.value.toUpperCase())} 
                            placeholder="EJ: JUAN PEREZ" 
                            className="uppercase" 
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave} className="w-full h-11 uppercase font-bold" disabled={!id.trim() && !name.trim()}>
                        Guardar Datos
                    </Button>
                </DialogFooter>
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
                    className={cn("h-7 w-7", currentDiscount > 0 ? "text-amber-600 bg-amber-100" : "text-muted-foreground")}
                >
                    <BadgePercent className="h-3.5 w-3.5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" align="end">
                <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Descuento ($/un)</Label>
                    <Input 
                        type="number" 
                        step="0.01" 
                        value={tempVal} 
                        onChange={(e) => setTempVal(e.target.value)}
                        className="h-9 text-xs font-bold"
                        placeholder="0.00"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                    />
                    <Button onClick={handleConfirm} className="w-full h-8 text-[10px] font-black uppercase">
                        Aplicar
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
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
}

export function CartDisplay({ cart, allProducts, onUpdateQuantity, onUpdateDiscount, onRemoveItem, onClearCart, repairJobId, onTogglePromo, onToggleGift, onHoldSale, onCheckoutSuccess }: CartDisplayProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { format: formatCurrency, getFinalPrice, getSymbol, convert, bcvRate, parallelRate } = useCurrency();
  const { updateCachedItem } = useDashboardStore();
  
  const [customerName, setCustomerName] = useState("");
  const [customerID, setCustomerID] = useState("");

  const repairJobRef = useMemoFirebase(() => 
    (repairJobId && firestore && user) ? doc(firestore, 'users', user.uid, 'repair_jobs', repairJobId) : null,
    [repairJobId, firestore, user?.uid]
  );
  const { data: activeRepairJob } = useDoc<RepairJob>(repairJobRef);

  const salesCol = useMemoFirebase(() => 
    (firestore && user) ? query(collection(firestore, "users", user.uid, "sale_transactions"), orderBy("transactionDate", "desc")) : null, 
    [firestore, user?.uid]
  );
  const { data: sales } = useCollection<Sale>(salesCol);

  const getPrice = (item: CartItem) => {
    if (item.isGift || item.isWarranty) return 0;
    
    let base = 0;
    if (item.isRepair) {
        if (!activeRepairJob) return 0;
        base = Math.max(0, activeRepairJob.estimatedCost - (activeRepairJob.amountPaid || 0));
        
        if (item.isPromo && activeRepairJob.reservedParts && activeRepairJob.reservedParts.length > 0) {
            let totalAdditionalDiscount = 0;
            activeRepairJob.reservedParts.forEach(part => {
                if (!part.isPromo) {
                    const product = allProducts.find(p => p.id === part.productId);
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
        const product = allProducts.find(p => p.id === item.productId);
        if (!product) return 0;
        
        base = (item.isPromo && typeof product.promoPrice === 'number' && product.promoPrice > 0) 
            ? product.promoPrice 
            : getFinalPrice(product);
    }

    return Math.max(0, base - (item.discount || 0));
  };
  
  const total = cart.reduce((acc, item) => acc + getPrice(item) * item.quantity, 0);

  const hasPromo = cart.some(i => i.isPromo);

  const handleCheckout = async (payments: Payment[], changeGiven: Payment[], totalChangeInUSD: number): Promise<Sale | null> => {
      if (!firestore || !user) return null;

      const saleId = generateSaleId();
      
      const cartWithPrices = cart.map(item => {
          const product = allProducts.find(p => p.id === item.productId);
          const finalCost = item.isCustom ? (item.customCostPrice || 0) : (product?.costPrice || 0);
          return { 
              ...item, 
              price: getPrice(item),
              costPrice: finalCost
          };
      });

      const hasRepairInCart = cartWithPrices.some(i => i.isRepair);

      const totalPaidInUSD = payments.reduce((acc, p) => {
          return acc + (p.method === 'Efectivo USD' || p.method === 'USDT / Crypto' ? p.amount : convert(p.amount, 'Bs', 'USD', hasPromo));
      }, 0);
      const actualNetPaidInUSD = totalPaidInUSD - totalChangeInUSD;

      const rateFactor = hasPromo ? 1 : (bcvRate / parallelRate);
      const realIncomeUSD = actualNetPaidInUSD * rateFactor;

      try {
        const partsToNotify = activeRepairJob?.reservedParts || [];
        let repairUpdateForCache: any = null;
        let finalGlobalTransactionCost = 0;

        await runTransaction(firestore, async (transaction) => {
            const productIdsToGet = new Set<string>();
            const currentRepairJobSnap = (repairJobId && hasRepairInCart) ? await transaction.get(repairJobRef!) : null;
            const currentRepairJob = currentRepairJobSnap?.exists() ? currentRepairJobSnap.data() as RepairJob : null;

            if (currentRepairJob?.reservedParts && hasRepairInCart) {
                currentRepairJob.reservedParts.forEach(p => { if(!p.isManual) productIdsToGet.add(p.productId) });
            }
            cartWithPrices.filter(i => !i.isRepair && !i.isCustom).forEach(i => productIdsToGet.add(i.productId));

            const productSnapshots = new Map<string, DocumentSnapshot>();
            for (const id of Array.from(productIdsToGet)) {
                const snap = await transaction.get(doc(firestore, 'users', user.uid, 'products', id));
                productSnapshots.set(id, snap);
            }

            const statsRef = doc(firestore, 'users', user.uid, 'system', 'estadisticas_actuales');
            const statsSnap = await transaction.get(statsRef);
            const currentStats = statsSnap.exists() ? statsSnap.data() : { totalRealSales30d: 0, totalRealProfit30d: 0 };

            let totalCostUSD = 0;
            const stockDeductions = new Map<string, { stock: number, reserved: number, salesCount: number }>();

            if (currentRepairJob?.reservedParts && hasRepairInCart) {
                for (const part of currentRepairJob.reservedParts) {
                    totalCostUSD += (part.costPrice * part.quantity);
                    if (part.isManual) continue;
                    const current = stockDeductions.get(part.productId) || { stock: 0, reserved: 0, salesCount: 0 };
                    stockDeductions.set(part.productId, { 
                        stock: current.stock + part.quantity, 
                        reserved: current.reserved + part.quantity,
                        salesCount: current.salesCount + part.quantity
                    });
                }
            }

            for (const item of cartWithPrices) {
                if (item.isRepair) continue;
                if (item.isCustom) {
                    totalCostUSD += (item.customCostPrice || 0) * item.quantity;
                    continue;
                }
                const pSnap = productSnapshots.get(item.productId);
                if (pSnap?.exists()) {
                    totalCostUSD += (pSnap.data() as Product).costPrice * item.quantity;
                }

                const current = stockDeductions.get(item.productId) || { stock: 0, reserved: 0, salesCount: 0 };
                stockDeductions.set(item.productId, { 
                    stock: current.stock + item.quantity, 
                    reserved: current.reserved,
                    salesCount: current.salesCount + item.quantity
                });
            }

            finalGlobalTransactionCost = totalCostUSD;
            const profitUSD = realIncomeUSD - totalCostUSD;

            for (const [pid, ded] of Array.from(stockDeductions.entries())) {
                const pSnap = productSnapshots.get(pid);
                if (pSnap?.exists()) {
                    const data = pSnap.data() as Product;
                    if (data.stockLevel < ded.stock) {
                        throw new Error(`¡Inventario Bloqueado! Solo quedan ${data.stockLevel} ${data.unit || 'un.'} de "${data.name}".`);
                    }

                    transaction.update(pSnap.ref, { 
                        stockLevel: data.stockLevel - ded.stock,
                        reservedStock: Math.max(0, (data.reservedStock || 0) - ded.reserved),
                        salesCount: increment(ded.salesCount)
                    });
                }
            }

            if (repairJobId && currentRepairJob && hasRepairInCart) {
                const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', repairJobId);
                const otherItemsTotal = cartWithPrices
                    .filter(i => !i.isRepair)
                    .reduce((sum, i) => sum + (i.price * i.quantity), 0);
                
                const paidToRepair = Math.max(0, actualNetPaidInUSD - otherItemsTotal);
                
                let additionalDiscountToApply = 0;
                const repairItem = cartWithPrices.find(i => i.isRepair);
                if (repairItem?.isPromo && currentRepairJob.reservedParts) {
                    currentRepairJob.reservedParts.forEach(part => {
                        if (!part.isPromo) {
                            const product = allProducts.find(p => p.id === part.productId);
                            if (product && product.promoPrice && product.promoPrice > 0) {
                                additionalDiscountToApply += (getFinalPrice(product) - product.promoPrice) * part.quantity;
                            }
                        }
                    });
                }

                const newEstimatedCost = currentRepairJob.estimatedCost - additionalDiscountToApply;
                const newPaidTotal = (currentRepairJob.amountPaid || 0) + paidToRepair;
                const isFullyPaid = newPaidTotal >= (newEstimatedCost - 0.01);

                repairUpdateForCache = { 
                    estimatedCost: Number(newEstimatedCost.toFixed(2)),
                    amountPaid: Number(newPaidTotal.toFixed(2)), 
                    isPaid: isFullyPaid,
                    status: isFullyPaid ? 'Pagado' : currentRepairJob.status,
                    partsConsumed: true,
                    consumedParts: [...(currentRepairJob.consumedParts || []), ...(currentRepairJob.reservedParts || [])],
                    reservedParts: []
                };

                transaction.update(jobRef, repairUpdateForCache);
            }

            transaction.set(statsRef, {
                totalRealSales30d: (currentStats.totalRealSales30d || 0) + realIncomeUSD,
                totalRealProfit30d: (currentStats.totalRealProfit30d || 0) + profitUSD,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', saleId);
            const saleData = cleanObject({
                id: saleId,
                items: cartWithPrices,
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
            });

            transaction.set(saleRef, saleData);

            const guardianRef = doc(firestore, 'users', user.uid, 'metadata', 'inventory_status');
            transaction.set(guardianRef, {
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        });

        if (repairJobId && repairUpdateForCache) {
            updateCachedItem(repairJobId, repairUpdateForCache);
        }

        toast({ title: "Venta Registrada con Éxito" });
        
        const resultSale = { 
            id: saleId, 
            items: cartWithPrices, 
            customerName: customerName || undefined,
            customerID: customerID || undefined,
            subtotal: total, 
            discount: 0, 
            totalAmount: total, 
            costPrice: finalGlobalTransactionCost, 
            payments, 
            transactionDate: new Date().toISOString(), 
            status: 'completed',
            changeGiven,
            totalChangeInUSD,
            repairJobId: (repairJobId && hasRepairInCart) ? repairJobId : null,
            bcvRateAtTime: bcvRate,
            parallelRateAtTime: parallelRate,
        } as Sale;

        if (onCheckoutSuccess) {
            onCheckoutSuccess(resultSale, partsToNotify);
        }

        setCustomerName("");
        setCustomerID("");
        return resultSale;
      } catch (e: any) {
        console.error("Transacción mixta fallida:", e);
        toast({ 
            variant: "destructive", 
            title: "Error de Sincronización", 
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
    <div className="flex flex-col h-full bg-slate-50">
        <div className="p-4 border-b bg-white flex justify-between items-center">
            <h2 className="text-lg font-semibold">Carrito de Ventas</h2>
            <CustomerDialog 
                onSave={(name, id) => { setCustomerName(name); setCustomerID(id); }} 
                currentName={customerName} 
                currentID={customerID} 
                sales={sales || []}
            />
        </div>
      <ScrollArea className="flex-1 bg-white">
        {(customerName || customerID) && (
            <div className="bg-primary/5 px-4 py-2 border-b flex justify-between items-center group">
                <div className="flex items-center gap-2">
                    <UserCheck className="w-3 h-3 text-primary" />
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-primary uppercase leading-tight">{customerName || 'SIN NOMBRE'}</span>
                        <span className="text-[8px] font-bold text-muted-foreground uppercase">{customerID || 'SIN CÉDULA'}</span>
                    </div>
                </div>
                <button type="button" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setCustomerName(""); setCustomerID(""); }}>
                    <UserX className="w-3 h-3 text-destructive" />
                </button>
            </div>
        )}
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[50%] text-[10px] uppercase">PRODUCTO</TableHead>
                    <TableHead className="text-center text-[10px] uppercase">CANT/PESO</TableHead>
                    <TableHead className="text-right text-[10px] uppercase">TOTAL</TableHead>
                    <TableHead className="w-[100px] text-right text-[10px] uppercase">ACCIONES</TableHead>
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
                            item.isGift && "bg-green-50/50",
                            item.isWarranty && "bg-orange-50/50",
                            item.isPromo && "bg-blue-50/50"
                        )}>
                            <TableCell className="font-medium text-xs py-3">
                                <div className="flex flex-col gap-1">
                                    <span className={cn((item.isGift || item.isWarranty) && "line-through text-muted-foreground")}>{item.name}</span>
                                    <div className="flex flex-wrap gap-1">
                                        {item.isPromo && <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">OFERTA</Badge>}
                                        {(item.discount || 0) > 0 && <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-200 text-amber-700 font-bold">-${item.discount.toFixed(2)} DESC</Badge>}
                                        {item.isGift && <Badge className="bg-green-600 text-white text-[9px] h-4 px-1">OBSEQUIO</Badge>}
                                        {item.isWarranty && <Badge className="bg-orange-600 text-white text-[9px] h-4 px-1">GARANTÍA</Badge>}
                                        {item.isRepair && <Badge variant="outline" className="text-[9px] h-4 px-1">REPARACIÓN</Badge>}
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-center">
                                <div className="flex flex-col items-center gap-0.5">
                                    <input 
                                        type="number" 
                                        step="any"
                                        value={item.quantity} 
                                        onChange={(e) => onUpdateQuantity(item.productId, Math.max(0.001, parseFloat(e.target.value) || 0))} 
                                        className="w-16 border rounded text-center text-xs h-7" 
                                        disabled={item.isRepair} 
                                    />
                                    {unitLabel && <span className="text-[8px] font-bold text-muted-foreground uppercase">{unitLabel}</span>}
                                </div>
                            </TableCell>
                            <TableCell className="text-right font-bold text-xs">
                                {getSymbol()}{formatCurrency(getPrice(item) * item.quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end items-center gap-0.5">
                                    <TooltipProvider>
                                        {hasPromoAvailable && !item.isCustom && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button 
                                                        type="button"
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className={cn("h-7 w-7", item.isPromo ? "text-blue-600 bg-blue-100" : "text-muted-foreground")}
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
                                                            className={cn("h-7 w-7", item.isGift ? "text-green-600 bg-green-100" : "text-muted-foreground")}
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
                                                    className="h-7 w-7 text-destructive hover:bg-destructive/10" 
                                                    onClick={() => onRemoveItem(item.productId, item.isRepair)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent><p>Quitar del carrito</p></TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </TableCell>
                        </TableRow>
                    );
                })}
                {cart.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={4} className="h-32 text-center text-muted-foreground italic">
                            El carrito está vacío
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
      </ScrollArea>
      <div className="p-4 border-t bg-gray-50 space-y-3">
        <div className="flex justify-between items-center px-1">
            <span className="text-sm text-muted-foreground font-medium uppercase tracking-tight">Total a Pagar:</span>
            <div className="text-right flex flex-col items-end">
                <span className="font-black text-2xl text-primary leading-none">
                    {getSymbol('USD')}{formatCurrency(total, 'USD')}
                </span>
                <span className="text-sm font-bold text-muted-foreground mt-1">
                    Bs {formatCurrency(convert(total, 'USD', 'Bs', hasPromo), 'Bs')}
                </span>
            </div>
        </div>

        <CheckoutDialog 
            cart={cart} 
            allProducts={allProducts} 
            total={total} 
            onCheckout={handleCheckout} 
            onClearCart={handleClearCart} 
            isRepairSale={!!repairJobId && cart.some(i => i.isRepair)} 
            repairData={activeRepairJob}
            customerName={customerName}
            customerID={customerID}
        >
            <Button size="lg" className="w-full h-12 text-lg font-black shadow-lg" disabled={cart.length === 0}>
                PAGAR COMPRA
            </Button>
        </CheckoutDialog>
        
        <div className="grid grid-cols-2 gap-2">
            {onHoldSale && (
                <HoldSaleDialog onHoldSale={onHoldSale} disabled={cart.length === 0 || cart.some(c => c.isRepair)}>
                    <Button variant="outline" size="sm" className="w-full text-xs h-8">
                        <ParkingSquare className="mr-2 h-3.5 w-3.5" /> Aparcar Venta
                    </Button>
                </HoldSaleDialog>
            )}
            <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground h-8" onClick={handleClearCart} disabled={cart.length === 0}>
                Vaciar Carrito
            </Button>
        </div>
      </div>
    </div>
  );
}
