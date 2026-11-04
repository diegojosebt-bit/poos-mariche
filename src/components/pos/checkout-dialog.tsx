"use client";

import type { CartItem, Payment, PaymentMethod, Sale, Product, UserProfile, RepairJob } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useState, type ReactNode, useMemo, useEffect } from "react";
import { 
    CreditCard, 
    Landmark, 
    Smartphone, 
    DollarSign, 
    Printer, 
    Trash2, 
    Banknote, 
    Loader2, 
    Coins, 
    Receipt, 
    CheckCircle2, 
    ArrowRight, 
    RotateCcw,
    User,
    Wallet,
    AlertCircle,
    Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReceiptView, handlePrintReceipt } from "./receipt-view";
import { useCurrency } from "@/hooks/use-currency";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Checkbox } from "../ui/checkbox";
import { useFirebase } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { Badge } from "../ui/badge";

type CheckoutDialogProps = {
  cart: CartItem[];
  allProducts: Product[];
  total: number;
  children: ReactNode;
  onCheckout: (payments: Payment[], changeGiven: Payment[], totalChangeInUSD: number) => Promise<Sale | null>;
  onClearCart: () => void;
  isRepairSale?: boolean;
  repairData?: RepairJob | null;
  customerName?: string;
  customerID?: string;
};

const PAYMENT_METHODS: { 
    value: PaymentMethod; 
    label: string; 
    icon: typeof DollarSign; 
    hasReference: boolean; 
    isBs: boolean;
    color: string;
}[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: DollarSign, hasReference: false, isBs: false, color: 'text-emerald-500 hover:border-emerald-500/50' },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: Landmark, hasReference: false, isBs: true, color: 'text-blue-500 hover:border-blue-500/50' },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: Smartphone, hasReference: true, isBs: true, color: 'text-amber-500 hover:border-amber-500/50' },
    { value: 'Tarjeta', label: 'Punto / Tarjeta', icon: CreditCard, hasReference: true, isBs: true, color: 'text-indigo-500 hover:border-indigo-500/50' },
    { value: 'Transferencia', label: 'Transferencia', icon: Banknote, hasReference: true, isBs: true, color: 'text-cyan-500 hover:border-cyan-500/50' },
    { value: 'USDT / Crypto', label: 'USDT / Crypto', icon: Coins, hasReference: true, isBs: false, color: 'text-violet-500 hover:border-violet-500/50' },
];

const CHANGE_METHODS: { value: PaymentMethod; label: string; icon: typeof DollarSign; isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'USD Efectivo', icon: DollarSign, isBs: false },
    { value: 'Efectivo Bs', label: 'Bs Efectivo', icon: Landmark, isBs: true },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: Smartphone, isBs: true },
];

type TempPayment = Payment & { id: number };

export function CheckoutDialog({ 
    cart, 
    total, 
    children, 
    onCheckout, 
    onClearCart, 
    isRepairSale, 
    repairData, 
    customerName, 
    customerID 
}: CheckoutDialogProps) {
  const [open, setOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { format: formatCurrency, getSymbol, convert, bcvRate, isLoading: currencyLoading } = useCurrency();
  const [payments, setPayments] = useState<TempPayment[]>([]);
  const [changePayments, setChangePayments] = useState<TempPayment[]>([]);
  const [isGivingChange, setIsGivingChange] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { profile } = useDashboardStore();
  
  const hasPromo = useMemo(() => cart.some(item => item.isPromo), [cart]);

  useEffect(() => {
    if (open && !completedSale) {
      setPayments([]);
      setChangePayments([]);
      setIsGivingChange(false);
      setIsSubmitting(false);
    }
  }, [open, completedSale]);

  const totalPaid = useMemo(() => {
    if (currencyLoading) return 0;
    return payments.reduce((acc, payment) => {
      if (payment.method === 'Efectivo USD' || payment.method === 'USDT / Crypto') {
        return acc + (Number(payment.amount) || 0);
      }
      return acc + convert(Number(payment.amount) || 0, 'Bs', 'USD', hasPromo);
    }, 0);
  }, [payments, convert, currencyLoading, hasPromo]);

  const totalGivenInUSD = useMemo(() => {
      if (currencyLoading) return 0;
      return changePayments.reduce((acc, payment) => {
          if (payment.method === 'Efectivo USD' || payment.method === 'USDT / Crypto') {
              return acc + (Number(payment.amount) || 0);
          }
          return acc + convert(Number(payment.amount) || 0, 'Bs', 'USD', hasPromo);
      }, 0);
  }, [changePayments, convert, currencyLoading, hasPromo]);

  const remainingToPayInUSD = useMemo(() => Math.max(0, total - totalPaid), [total, totalPaid]);
  const potentialChangeInUSD = useMemo(() => (totalPaid > total + 0.001 ? totalPaid - total : 0), [totalPaid, total]);
  const isPaidInFull = totalPaid >= total - 0.01;
  const paymentProgress = useMemo(() => {
      if (total <= 0) return 100;
      return Math.min(100, Math.round((totalPaid / total) * 100));
  }, [totalPaid, total]);

  const requiredChangeInUSD = isGivingChange ? potentialChangeInUSD : 0;
  const changeDifference = useMemo(() => requiredChangeInUSD - totalGivenInUSD, [requiredChangeInUSD, totalGivenInUSD]);

  const canConfirm = useMemo(() => {
    if (total <= 0 || payments.length === 0 || currencyLoading || isSubmitting) return false;
    return totalPaid > 0;
  }, [total, totalPaid, payments, currencyLoading, isSubmitting]);

  const handleAddPayment = (method: PaymentMethod) => {
    const option = PAYMENT_METHODS.find(m => m.value === method);
    const isBs = option?.isBs ?? false;
    const remaining = isBs ? convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo) : remainingToPayInUSD;
    const autoAmount = remaining > 0 ? Number(remaining.toFixed(2)) : 0;

    setPayments(prev => [
        ...prev, 
        { 
            id: Date.now() + Math.random(), 
            method, 
            amount: autoAmount, 
            reference: '' 
        }
    ]);
  };

  const handleUpdatePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
    setPayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleRemovePayment = (id: number) => {
    setPayments(prev => prev.filter(p => p.id !== id));
  };
  
  const handleAddChangePayment = (method: PaymentMethod) => {
    const option = CHANGE_METHODS.find(m => m.value === method);
    const isBs = option?.isBs ?? false;
    const remainingChange = Math.max(0, requiredChangeInUSD - totalGivenInUSD);
    const autoAmount = isBs ? convert(remainingChange, 'USD', 'Bs', hasPromo) : remainingChange;

    setChangePayments(prev => [
        ...prev, 
        { 
            id: Date.now() + Math.random(), 
            method, 
            amount: autoAmount > 0 ? Number(autoAmount.toFixed(2)) : 0, 
            reference: '' 
        }
    ]);
  };

  const handleUpdateChangePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
    setChangePayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleRemoveChangePayment = (id: number) => {
    setChangePayments(prev => prev.filter(p => p.id !== id));
  };

  const handleConfirm = async () => {
    if (!canConfirm || isSubmitting) return;
    
    setIsSubmitting(true);
    const finalChangeGiven = isGivingChange ? changePayments.map(({ id, ...rest }) => rest) : [];
    const finalTotalChangeUSD = isGivingChange ? potentialChangeInUSD : 0;
    
    try {
        const sale = await onCheckout(
            payments.map(({ id, ...rest }) => rest),
            finalChangeGiven,
            finalTotalChangeUSD
        );
        
        if(sale) {
            setCompletedSale(sale);
        }
    } catch (e) {
        toast({ variant: "destructive", title: "Error al registrar la venta" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleCloseAndReset = () => {
      if (completedSale) {
          if (isRepairSale) {
            router.push('/dashboard/repairs');
          } else {
            onClearCart();
          }
      }
      setCompletedSale(null);
      setOpen(false);
  };

  const onPrint = () => {
    if (!completedSale) return;
    const receiptProps = {
      sale: completedSale,
      currency: { format: formatCurrency, getSymbol, convert },
      businessName: profile?.businessName,
      profile: profile,
      repairData: repairData
    };
    handlePrintReceipt(receiptProps, (error) => {
      toast({ variant: "destructive", title: "Error al imprimir", description: error });
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) {
            if (completedSale) handleCloseAndReset();
            else setOpen(false);
        } else {
            setOpen(true);
        }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent 
        className={cn(
            "transition-all duration-300 overflow-hidden flex flex-col p-0 gap-0 max-h-[88vh] border border-border/80 shadow-2xl rounded-2xl",
            completedSale ? "sm:max-w-md" : (isGivingChange ? "sm:max-w-3xl" : "sm:max-w-xl md:max-w-2xl")
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {completedSale ? (
            /* Vista de Éxito / Post-Venta */
            <div className="flex flex-col h-full overflow-hidden bg-background">
               <div className="p-3.5 sm:p-4 border-b shrink-0 flex items-center justify-between bg-emerald-500/10 pr-12 sm:pr-14">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold">
                        <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                        <DialogTitle className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
                            ¡Venta procesada con éxito!
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground font-normal">
                            Comprobante #{completedSale.id}
                        </DialogDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-background text-emerald-600 border-emerald-500/30 text-xs font-medium px-2.5 py-0.5">
                      Completada
                  </Badge>
                </div>

              <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-muted/20 space-y-3">
                <div className="max-w-xs mx-auto border border-border rounded-xl bg-card shadow-xs p-3 text-card-foreground">
                    <ReceiptView 
                        sale={completedSale} 
                        currency={{ format: formatCurrency, getSymbol, convert }}
                        businessName={profile?.businessName}
                        profile={profile}
                        repairData={repairData}
                    />
                </div>
              </div>

              <div className="p-3 sm:p-3.5 bg-card border-t flex flex-col sm:flex-row gap-2 shrink-0 no-print">
                   <Button onClick={onPrint} variant="outline" className="flex-1 h-10 font-medium text-xs border-primary/30 hover:bg-primary/5">
                      <Printer className="mr-1.5 h-4 w-4 text-primary" />
                      Imprimir comprobante
                  </Button>
                  <Button onClick={handleCloseAndReset} className="flex-1 h-10 font-semibold text-xs shadow-sm">
                      <RotateCcw className="mr-1.5 h-4 w-4" />
                      Nueva venta
                  </Button>
              </div>
          </div>
        ) : (
            /* Modal de Cobro Moderno Compacto */
            <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* Header del Modal */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b shrink-0 bg-muted/20 flex items-center justify-between pr-12 sm:pr-14">
                <DialogHeader className="space-y-0.5 text-left">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                            <Wallet className="w-4 h-4" />
                        </div>
                        <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                            Procesar Pago
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            Ventana de cobro para seleccionar métodos de pago y procesar la venta
                        </DialogDescription>
                        <Badge variant="outline" className="text-xs font-medium py-0.5 px-2.5 bg-background border-border text-muted-foreground ml-1 shadow-2xs">
                            Tasa: <span className="font-semibold text-primary ml-1">Bs {formatCurrency(bcvRate)}</span>
                        </Badge>
                    </div>
                    {customerName && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                            <User className="w-3.5 h-3.5 text-primary" />
                            <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[280px]">{customerName}</span>
                            {customerID && <span className="text-[11px] text-muted-foreground font-mono">({customerID})</span>}
                        </div>
                    )}
                </DialogHeader>
            </div>
            
            {/* Contenido Principal */}
            <div className={cn("grid grid-cols-1 gap-3 sm:gap-3.5 p-3.5 sm:p-4 overflow-y-auto max-h-[calc(85vh-130px)]", isGivingChange && "md:grid-cols-2")}>
                <div className="space-y-3">
                    {/* Hero Card: Total a Cobrar */}
                    <div className="relative overflow-hidden p-4 rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white shadow-md border border-slate-700/60">
                        <div className="flex justify-between items-center mb-1.5">
                            <span className="text-xs text-slate-400 font-medium tracking-wide">
                                Total a cobrar
                            </span>
                            {isPaidInFull && (
                                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" /> Pago completo
                                </span>
                            )}
                            {!isPaidInFull && totalPaid > 0 && (
                                <span className="bg-rose-500/20 text-rose-300 border border-rose-500/35 text-xs font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                                    Abonado ({paymentProgress}%)
                                </span>
                            )}
                            {totalPaid === 0 && (
                                <span className="bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                                    Pendiente
                                </span>
                            )}
                        </div>

                        <div className="flex flex-row items-baseline justify-between gap-2">
                            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                                ${formatCurrency(total)}
                            </div>
                            <div className="text-xs sm:text-sm font-medium text-slate-300">
                                ≈ Bs {formatCurrency(convert(total, 'USD', 'Bs', hasPromo))}
                            </div>
                        </div>

                        {/* Barra de progreso de pago */}
                        <div className="mt-2.5 pt-2 border-t border-slate-700/60">
                            <div className="w-full bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                                <div 
                                    className={cn(
                                        "h-full transition-all duration-300 rounded-full",
                                        isPaidInFull ? "bg-emerald-400" : "bg-primary"
                                    )}
                                    style={{ width: `${paymentProgress}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center text-xs font-normal text-slate-400 mt-1.5">
                                <span>Abonado: <span className="font-semibold text-white">${formatCurrency(totalPaid)}</span></span>
                                {remainingToPayInUSD > 0.009 ? (
                                    <span className="text-rose-300 font-medium flex items-center gap-1">
                                        Falta: <span className="font-semibold text-rose-400">${formatCurrency(remainingToPayInUSD)}</span>
                                    </span>
                                ) : (
                                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                                        <Check className="w-3.5 h-3.5" /> Total cubierto
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Banner amigable para monto faltante */}
                    {remainingToPayInUSD > 0.009 && (
                        <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-300 transition-all">
                            <div className="flex items-center gap-2">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                                </span>
                                <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                                    Resta por cobrar:
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-sm font-bold text-rose-600 dark:text-rose-300">
                                    ${formatCurrency(remainingToPayInUSD)}
                                </span>
                                <span className="text-xs text-rose-500/80 dark:text-rose-400/80 ml-1.5 font-medium">
                                    (≈ Bs {formatCurrency(convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo))})
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Selector Rápido de Métodos de Pago */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold text-foreground/80 tracking-normal">
                                Métodos de pago
                            </Label>
                            <span className="text-xs text-muted-foreground font-normal">
                                {payments.length} seleccionado{payments.length === 1 ? '' : 's'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {PAYMENT_METHODS.map(method => {
                                const Icon = method.icon;
                                return (
                                    <button
                                        key={method.value}
                                        type="button"
                                        onClick={() => handleAddPayment(method.value)}
                                        disabled={isSubmitting}
                                        className={cn(
                                            "flex items-center gap-2.5 p-2.5 rounded-xl border bg-card hover:bg-muted/60 active:scale-[0.98] transition-all text-left shadow-2xs group cursor-pointer",
                                            method.color
                                        )}
                                    >
                                        <div className="p-1.5 rounded-lg bg-muted group-hover:bg-background transition-colors shrink-0">
                                            <Icon className="w-4 h-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold truncate text-card-foreground">
                                                {method.label}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Lista de Pagos Ingresados en Fila Lineal */}
                    {payments.length > 0 ? (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-foreground/80 tracking-normal">
                                Desglose de pagos recibidos
                            </Label>
                            <ScrollArea className="max-h-[170px] pr-2">
                                <div className="space-y-1.5">
                                    {payments.map(p => {
                                        const option = PAYMENT_METHODS.find(o => o.value === p.method)!;
                                        const Icon = option.icon;
                                        const symbol = option.isBs ? 'Bs' : '$';
                                        const remainingInCurrency = option.isBs 
                                            ? convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo) 
                                            : remainingToPayInUSD;

                                        return (
                                        <div 
                                            key={p.id} 
                                            className="p-2 sm:px-3 sm:py-2 border rounded-xl bg-card shadow-2xs flex flex-wrap sm:flex-nowrap items-center gap-2 transition-all hover:border-primary/40"
                                        >
                                            {/* Nombre e Ícono del Método de Pago */}
                                            <div className="flex items-center gap-2 w-32 sm:w-36 shrink-0">
                                                <div className="p-1 rounded-md bg-muted text-primary shrink-0">
                                                    <Icon className="w-3.5 h-3.5" />
                                                </div>
                                                <span className="text-xs font-semibold text-foreground truncate" title={p.method}>
                                                    {p.method}
                                                </span>
                                            </div>

                                            {/* Campo para ingresar el monto */}
                                            <div className="relative w-28 sm:w-32 shrink-0">
                                                <span className="absolute left-2.5 top-2 font-semibold text-muted-foreground text-xs">{symbol}</span>
                                                <Input 
                                                    type="number" 
                                                    step="any"
                                                    value={p.amount || ''} 
                                                    onChange={(e) => handleUpdatePayment(p.id, 'amount', parseFloat(e.target.value) || 0)} 
                                                    className="h-8 pl-7 font-semibold text-xs" 
                                                    disabled={isSubmitting} 
                                                    placeholder="0.00" 
                                                />
                                            </div>

                                            {/* Botón rápido para autocompletar restante si queda saldo */}
                                            {remainingToPayInUSD > 0.009 && (
                                                <Button 
                                                    type="button" 
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleUpdatePayment(p.id, 'amount', Number(((Number(p.amount) || 0) + remainingInCurrency).toFixed(2)))} 
                                                    className="h-8 px-2 text-xs font-medium text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:hover:bg-rose-950/40 rounded-lg shrink-0 cursor-pointer"
                                                    title={`Completar faltante: ${symbol}${formatCurrency(remainingInCurrency)}`}
                                                >
                                                    + Restante
                                                </Button>
                                            )}

                                            {/* Campo de Referencia o espacio flexible */}
                                            {option.hasReference ? (
                                                <Input 
                                                    type="text" 
                                                    value={p.reference || ''} 
                                                    onChange={(e) => handleUpdatePayment(p.id, 'reference', e.target.value)} 
                                                    placeholder="Nro. Referencia / Recibo" 
                                                    className="flex-1 min-w-[120px] h-8 font-mono font-medium uppercase text-xs" 
                                                    disabled={isSubmitting} 
                                                />
                                            ) : (
                                                <div className="flex-1 min-w-0" />
                                            )}

                                            {/* Ícono de Eliminar al lado derecho */}
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="w-7 h-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg" 
                                                onClick={() => handleRemovePayment(p.id)} 
                                                disabled={isSubmitting} 
                                                title="Eliminar método"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </div>
                    ) : (
                        <div className="text-center py-4 px-3 rounded-xl border border-dashed border-border/80 bg-muted/20">
                            <Receipt className="w-6 h-6 text-muted-foreground/50 mx-auto mb-1.5" />
                            <p className="text-xs font-medium text-muted-foreground">
                                Ningún método de pago agregado aún
                            </p>
                            <p className="text-[11px] text-muted-foreground/70">
                                Selecciona un método arriba para registrar el cobro
                            </p>
                        </div>
                    )}

                    {/* Resumen de Vuelto / Saldo */}
                    {potentialChangeInUSD > 0.009 && (
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1.5">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                                    Vuelto a favor del cliente:
                                </span>
                                <div className="text-right">
                                    <p className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-tight">
                                        ${formatCurrency(potentialChangeInUSD)}
                                    </p>
                                    <p className="text-xs font-medium text-emerald-700/80 dark:text-emerald-400/80">
                                        ≈ Bs {formatCurrency(convert(potentialChangeInUSD, 'USD', 'Bs', hasPromo))}
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center space-x-2 pt-1.5 border-t border-emerald-500/20">
                                <Checkbox 
                                    id="give-change-checkbox" 
                                    checked={isGivingChange} 
                                    onCheckedChange={(checked) => { 
                                        setIsGivingChange(!!checked); 
                                        if (!checked) setChangePayments([]); 
                                    }} 
                                    disabled={isSubmitting} 
                                />
                                <Label htmlFor="give-change-checkbox" className="cursor-pointer font-medium text-xs text-emerald-700 dark:text-emerald-300">
                                    Desglosar entrega de vuelto en caja
                                </Label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Panel de Gestión de Vueltos */}
                {isGivingChange && (
                    <div className="space-y-3 md:border-l md:pl-4 animate-in slide-in-from-right-4 duration-300">
                        <div className="text-center p-3 rounded-xl bg-primary/10 border border-primary/20">
                            <p className="text-xs font-medium text-primary tracking-wide">
                                Total vuelto a entregar
                            </p>
                            <p className="text-2xl font-bold text-primary">
                                ${formatCurrency(requiredChangeInUSD)}
                            </p>
                            <p className="text-xs font-medium text-primary/70">
                                ≈ Bs {formatCurrency(convert(requiredChangeInUSD, 'USD', 'Bs', hasPromo))}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-foreground/80">
                                Moneda o método de entrega
                            </Label>
                            <div className="flex flex-wrap gap-1.5">
                                {CHANGE_METHODS.map(method => {
                                    const Icon = method.icon;
                                    return (
                                        <Button 
                                            key={method.value} 
                                            variant="outline" 
                                            size="sm" 
                                            className="h-7 text-xs font-medium rounded-lg px-2.5" 
                                            onClick={() => handleAddChangePayment(method.value)} 
                                            disabled={isSubmitting}
                                        >
                                            <Icon className="w-3.5 h-3.5 mr-1.5" /> {method.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>

                        <ScrollArea className="max-h-[160px] pr-2">
                            <div className="space-y-1.5">
                                {changePayments.map(p => {
                                    const option = CHANGE_METHODS.find(o => o.value === p.method)!;
                                    const symbol = option.isBs ? 'Bs' : '$';
                                    return (
                                    <div key={p.id} className="p-2 border rounded-lg bg-card flex gap-1.5 items-center shadow-2xs">
                                        <span className="text-xs font-medium text-muted-foreground w-20 truncate">{p.method}</span>
                                        <div className="relative flex-1">
                                            <span className="absolute left-2 top-1.5 text-muted-foreground text-xs font-medium">{symbol}</span>
                                            <Input 
                                                type="number" 
                                                step="any"
                                                value={p.amount || ''} 
                                                onChange={(e) => handleUpdateChangePayment(p.id, 'amount', parseFloat(e.target.value) || 0)} 
                                                className="pl-6 h-7 text-xs font-semibold" 
                                                disabled={isSubmitting} 
                                                placeholder="0.00" 
                                            />
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="w-7 h-7 text-destructive" 
                                            onClick={() => handleRemoveChangePayment(p.id)} 
                                            disabled={isSubmitting}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                        
                        <div className={cn(
                            "text-center font-medium text-xs p-2.5 rounded-lg border transition-colors",
                            Math.abs(changeDifference) > 0.01 
                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/25" 
                                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                        )}>
                            {Math.abs(changeDifference) > 0.01 
                            ? `Falta por desglosar en vuelto: $${formatCurrency(Math.abs(changeDifference))} (≈ Bs ${formatCurrency(convert(Math.abs(changeDifference), 'USD', 'Bs', hasPromo))})`
                            : "Desglose de vuelto cuadrado correctamente ✓"}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer con Botón de Confirmación */}
            <div className="p-3.5 sm:p-4 border-t shrink-0 bg-card no-print">
                <Button 
                    size="default" 
                    onClick={handleConfirm} 
                    disabled={!canConfirm || isSubmitting} 
                    className="w-full h-11 text-sm font-semibold shadow-md rounded-xl bg-primary hover:bg-primary/90 transition-all"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Procesando venta...
                        </>
                    ) : (
                        <div className="flex items-center justify-center gap-2">
                            <span>
                                {remainingToPayInUSD > 0.009 && totalPaid > 0 
                                    ? "Registrar venta (Abono parcial)" 
                                    : "Registrar y finalizar venta"}
                            </span>
                            <ArrowRight className="w-4 h-4" />
                        </div>
                    )}
                </Button>
            </div>
            </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
