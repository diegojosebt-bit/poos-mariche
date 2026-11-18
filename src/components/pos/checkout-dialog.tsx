"use client";
import { computePaymentTotals } from "@/lib/payments";

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
import { SmoothCollapse } from "@/components/ui/smooth-collapse";

type CheckoutDialogProps = {
  cart: CartItem[];
  allProducts: Product[];
  total: number;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
    iconBg: string;
    color: string;
}[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: DollarSign, hasReference: false, isBs: false, iconBg: 'bg-emerald-50 text-emerald-600', color: 'hover:border-emerald-300 hover:bg-emerald-50/30' },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: Landmark, hasReference: false, isBs: true, iconBg: 'bg-blue-50 text-blue-600', color: 'hover:border-blue-300 hover:bg-blue-50/30' },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: Smartphone, hasReference: true, isBs: true, iconBg: 'bg-indigo-50 text-indigo-600', color: 'hover:border-indigo-300 hover:bg-indigo-50/30' },
    { value: 'Tarjeta', label: 'Punto / Tarjeta', icon: CreditCard, hasReference: true, isBs: true, iconBg: 'bg-sky-50 text-sky-600', color: 'hover:border-sky-300 hover:bg-sky-50/30' },
    { value: 'Transferencia', label: 'Transferencia', icon: Banknote, hasReference: true, isBs: true, iconBg: 'bg-teal-50 text-teal-600', color: 'hover:border-teal-300 hover:bg-teal-50/30' },
    { value: 'USDT / Crypto', label: 'USDT / Crypto', icon: Coins, hasReference: true, isBs: false, iconBg: 'bg-violet-50 text-violet-600', color: 'hover:border-violet-300 hover:bg-violet-50/30' },
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
    open: controlledOpen,
    onOpenChange,
    onCheckout, 
    onClearCart, 
    isRepairSale, 
    repairData, 
    customerName, 
    customerID 
}: CheckoutDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (!isControlled) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [completedRepairData, setCompletedRepairData] = useState<RepairJob | null | undefined>(null);
  const [wasRepairSale, setWasRepairSale] = useState(false);
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

  // Motor de cobro compartido con Fiados: una sola matemática.
  const totals = useMemo(
    () =>
      computePaymentTotals({
        payments,
        changePayments,
        total,
        useParallelRate: hasPromo,
        convert,
        isGivingChange,
        currencyLoading,
      }),
    [payments, changePayments, total, hasPromo, convert, isGivingChange, currencyLoading],
  );

  const totalPaid = totals.paidUSD;
  const totalGivenInUSD = totals.changeGivenUSD;
  const remainingToPayInUSD = totals.remainingUSD;
  const potentialChangeInUSD = totals.potentialChangeUSD;
  const isPaidInFull = totals.isPaidInFull;
  const paymentProgress = totals.progress;
  const requiredChangeInUSD = totals.requiredChangeUSD;
  const changeDifference = totals.changeDifference;

  const canConfirm = useMemo(() => !isSubmitting && totals.canConfirm, [totals, isSubmitting]);

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
    
    const saleIsRepair = Boolean(isRepairSale || cart.some((item) => item.isRepair));
    const repairSnapshot = repairData;

    try {
        const sale = await onCheckout(
            payments.map(({ id, ...rest }) => rest),
            finalChangeGiven,
            finalTotalChangeUSD
        );
        
        if(sale) {
            setWasRepairSale(Boolean(saleIsRepair || sale.repairJobId || sale.items?.some((item) => item.isRepair)));
            setCompletedRepairData(repairSnapshot);
            setCompletedSale(sale);
        }
    } catch (e) {
        toast({ variant: "destructive", title: "Error al registrar la venta" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleCloseAndReset = () => {
      const shouldReturnToRepairs = Boolean(
          wasRepairSale ||
          isRepairSale ||
          completedSale?.repairJobId ||
          completedSale?.items?.some((item) => item.isRepair)
      );
      if (completedSale) {
          onClearCart();
      }
      setCompletedSale(null);
      setCompletedRepairData(null);
      setWasRepairSale(false);
      setOpen(false);
      if (completedSale && shouldReturnToRepairs) {
          router.push('/dashboard/repairs');
      }
  };

  const onPrint = () => {
    if (!completedSale) return;
    const receiptProps = {
      sale: completedSale,
      currency: { format: formatCurrency, getSymbol, convert },
      businessName: profile?.businessName,
      profile: profile,
      repairData: completedRepairData ?? repairData
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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent 
        className={cn(
            "w-[calc(100%-1.5rem)] max-w-[440px] transition-all duration-300 overflow-hidden flex flex-col p-0 sm:p-0 gap-0 max-h-[88dvh] border border-slate-200 bg-white shadow-2xl rounded-2xl",
            completedSale ? "sm:max-w-[420px]" : (isGivingChange ? "sm:max-w-[720px]" : "sm:max-w-[500px]")
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {completedSale ? (
            /* Vista de Éxito / Post-Venta */
            <div className="flex flex-col max-h-[88dvh] overflow-hidden bg-white">
               <div className="px-4 py-3 sm:px-5 border-b border-slate-100 shrink-0 flex items-center justify-between bg-white pr-14">
                  <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 text-left">
                        <DialogTitle className="text-sm font-semibold text-slate-900 tracking-tight leading-none sm:leading-tight">
                            <span className="sm:hidden">Venta exitosa</span>
                            <span className="hidden sm:inline">¡Venta procesada con éxito!</span>
                        </DialogTitle>
                        <DialogDescription className="mt-0.5 text-[11px] text-slate-500 font-normal">
                            Comprobante #{completedSale.id}
                        </DialogDescription>
                    </div>
                  </div>
                </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:px-5 bg-white space-y-2.5">
                <div className="max-w-xs mx-auto border border-slate-200 rounded-xl bg-white shadow-sm p-3 text-slate-900">
                    <ReceiptView 
                        sale={completedSale} 
                        currency={{ format: formatCurrency, getSymbol, convert }}
                        businessName={profile?.businessName}
                        profile={profile}
                        repairData={completedRepairData ?? repairData}
                    />
                </div>
              </div>

              <div className="px-4 py-3 sm:px-5 bg-white border-t border-slate-100 flex flex-col sm:flex-row gap-2 shrink-0 no-print">
                   <Button onClick={onPrint} variant="outline" className="flex-1 h-9 rounded-xl sm:rounded-lg font-medium text-xs border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                      <Printer className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                      Imprimir comprobante
                  </Button>
                  <Button onClick={handleCloseAndReset} className="flex-1 h-9 rounded-xl sm:rounded-lg font-medium text-xs bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm">
                      {wasRepairSale ? (
                        <>
                          <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                          Volver a Reparaciones
                        </>
                      ) : (
                        <>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Nueva venta
                        </>
                      )}
                  </Button>
              </div>
          </div>
        ) : (
            /* Modal de Cobro 2026 Compacto y Elegante */
            <div className="flex flex-col max-h-[88dvh] overflow-hidden bg-white">
            {/* Header del Modal */}
            <div className="px-4 py-3 sm:px-5 border-b border-slate-100 shrink-0 bg-white">
                <DialogHeader className="space-y-0 pr-12 text-left">
                    <div className="flex h-11 items-center gap-2 sm:h-auto flex-wrap">
                        <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        </div>
                        <DialogTitle className="text-sm sm:text-[15px] font-semibold tracking-tight text-slate-900 leading-none sm:leading-tight">
                            Procesar Pago
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            Ventana de cobro para seleccionar métodos de pago y procesar la venta
                        </DialogDescription>
                        <Badge variant="outline" className="rounded-full text-[10px] sm:text-[11px] font-medium py-0.5 px-2 bg-emerald-50 border-emerald-200 text-emerald-700">
                            BCV <span className="font-semibold tabular-nums ml-1">{formatCurrency(bcvRate)} Bs</span>
                        </Badge>
                    </div>
                    {customerName && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
                            <User className="w-3 h-3 text-blue-600 shrink-0" />
                            <span className="font-medium text-slate-800 truncate max-w-[190px] sm:max-w-[260px]">{customerName}</span>
                            {customerID && <span className="text-[10px] text-slate-400 font-mono">({customerID})</span>}
                        </div>
                    )}
                </DialogHeader>
            </div>
            
            {/* Contenido Principal */}
            <div className={cn("grid grid-cols-1 gap-3 px-4 py-3 sm:px-5 sm:py-3.5 flex-1 min-h-0 overflow-y-auto bg-white", isGivingChange && "md:grid-cols-2")}>
                <div className="space-y-2.5">
                    {/* Hero Card Luminoso: Total a Cobrar */}
                    <div className="relative overflow-hidden p-3 sm:p-3.5 rounded-xl bg-gradient-to-br from-blue-50/60 via-white to-emerald-50/45 border border-blue-200/80 shadow-sm">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[11px] text-slate-500 font-medium">
                                Total a cobrar
                            </span>
                            {isPaidInFull && (
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Check className="w-2.5 h-2.5" /> Pago completo
                                </span>
                            )}
                            {!isPaidInFull && totalPaid > 0 && (
                                <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                                    Abonado ({paymentProgress}%)
                                </span>
                            )}
                            {totalPaid === 0 && (
                                <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-rose-600" />
                                    Pendiente
                                </span>
                            )}
                        </div>

                        <div className="flex flex-row items-baseline justify-between gap-2">
                            <div className="text-xl sm:text-2xl font-semibold tracking-tight tabular-nums text-slate-900">
                                ${formatCurrency(total)}
                            </div>
                            <div className="text-xs font-medium tabular-nums text-emerald-700">
                                ≈ Bs {formatCurrency(convert(total, 'USD', 'Bs', hasPromo))}
                            </div>
                        </div>

                        {/* Barra de progreso de pago */}
                        <div className="mt-2 pt-2 border-t border-slate-200/70">
                            <div className="w-full bg-slate-200/70 rounded-full h-1.5 overflow-hidden">
                                <div 
                                    className={cn(
                                        "h-full transition-all duration-300 rounded-full",
                                        isPaidInFull ? "bg-emerald-500" : "bg-gradient-to-r from-blue-600 to-indigo-500"
                                    )}
                                    style={{ width: `${paymentProgress}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center text-[11px] font-normal text-slate-500 mt-1">
                                <span>Abonado: <span className="font-medium tabular-nums text-slate-800">${formatCurrency(totalPaid)}</span></span>
                                {remainingToPayInUSD > 0.009 ? (
                                    <span className="text-rose-600 font-medium flex items-center gap-1 tabular-nums">
                                        Falta: <span>${formatCurrency(remainingToPayInUSD)}</span>
                                    </span>
                                ) : (
                                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                                        <Check className="w-3 h-3" /> Total cubierto
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Banner compacto para monto restante (solo visible en pagos parciales) */}
                    <SmoothCollapse open={totalPaid > 0 && remainingToPayInUSD > 0.009}>
                        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-rose-50/80 border border-rose-200/80 text-rose-700 transition-all">
                            <span className="text-[11px] font-medium text-rose-700">
                                Resta por cobrar
                            </span>
                            <div className="text-right tabular-nums">
                                <span className="text-xs font-semibold text-rose-700">
                                    ${formatCurrency(remainingToPayInUSD)}
                                </span>
                                <span className="text-[10px] text-rose-600/80 ml-1 font-normal">
                                    (≈ Bs {formatCurrency(convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo))})
                                </span>
                            </div>
                        </div>
                    </SmoothCollapse>

                    {/* Selector Rápido de Métodos de Pago */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label className="text-[11px] font-semibold text-slate-800">
                                Métodos de pago
                            </Label>
                            <span className="text-[10px] text-slate-400 font-normal">
                                {payments.length} seleccionado{payments.length === 1 ? '' : 's'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {PAYMENT_METHODS.map(method => {
                                const Icon = method.icon;
                                return (
                                    <button
                                        key={method.value}
                                        type="button"
                                        onClick={() => handleAddPayment(method.value)}
                                        disabled={isSubmitting}
                                        className={cn(
                                            "flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200/90 bg-white active:scale-[0.98] transition-all text-left group cursor-pointer",
                                            method.color
                                        )}
                                    >
                                        <div className={cn("p-1.5 rounded-md transition-colors shrink-0", method.iconBg)}>
                                            <Icon className="w-3.5 h-3.5" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[11px] sm:text-xs font-medium truncate text-slate-800">
                                                {method.label}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Lista de Pagos Ingresados */}
                    {payments.length > 0 ? (
                        <div className="space-y-1.5">
                            <Label className="text-[11px] font-semibold text-slate-800">
                                Desglose de pagos recibidos
                            </Label>
                            <ScrollArea className="max-h-[145px] pr-1">
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
                                            className="p-2 border border-slate-200/90 rounded-lg bg-white flex flex-wrap items-center gap-1.5"
                                        >
                                            {/* Nombre e Ícono del Método de Pago */}
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-none sm:w-[116px]">
                                                <div className={cn("p-1 rounded-md shrink-0", option.iconBg)}>
                                                    <Icon className="w-3 h-3" />
                                                </div>
                                                <span className="text-[11px] sm:text-xs font-medium text-slate-800 truncate" title={p.method}>
                                                    {p.method}
                                                </span>
                                            </div>

                                            {/* Campo para ingresar el monto */}
                                            <div className="relative w-24 sm:w-28 shrink-0">
                                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-medium text-slate-400 text-[11px]">{symbol}</span>
                                                <Input 
                                                    type="number" 
                                                    step="any"
                                                    value={p.amount || ''} 
                                                    onChange={(e) => handleUpdatePayment(p.id, 'amount', parseFloat(e.target.value) || 0)} 
                                                    className="h-8 rounded-md border-slate-200 bg-white pl-6 pr-2 font-medium tabular-nums text-xs text-slate-900 focus-visible:border-blue-500" 
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
                                                    className="h-8 px-2 text-[10px] sm:text-[11px] font-medium text-blue-700 border-blue-200 bg-blue-50/70 hover:bg-blue-100 rounded-md shrink-0 cursor-pointer"
                                                    title={`Completar faltante: ${symbol}${formatCurrency(remainingInCurrency)}`}
                                                >
                                                    + Restante
                                                </Button>
                                            )}

                                            {/* Campo de Referencia */}
                                            {option.hasReference && (
                                                <Input 
                                                    type="text" 
                                                    value={p.reference || ''} 
                                                    onChange={(e) => handleUpdatePayment(p.id, 'reference', e.target.value)} 
                                                    placeholder="Referencia" 
                                                    className="flex-1 min-w-[100px] h-8 rounded-md border-slate-200 bg-white font-mono font-normal uppercase text-xs text-slate-800 placeholder:normal-case placeholder:font-sans placeholder:text-slate-400" 
                                                    disabled={isSubmitting} 
                                                />
                                            )}

                                            {/* Ícono de Eliminar al lado derecho */}
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="w-7 h-7 ml-auto shrink-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md" 
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
                        <div className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/40">
                            <Receipt className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <p className="text-[11px] font-medium text-slate-500">
                                Selecciona un método arriba para registrar el cobro
                            </p>
                        </div>
                    )}

                    {/* Resumen de Vuelto / Saldo */}
                    <SmoothCollapse open={potentialChangeInUSD > 0.009}>
                        <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/90 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] font-medium text-emerald-800">
                                    Vuelto a favor del cliente
                                </span>
                                <div className="text-right tabular-nums">
                                    <p className="text-sm sm:text-base font-semibold text-emerald-700 leading-tight">
                                        ${formatCurrency(potentialChangeInUSD)}
                                    </p>
                                    <p className="text-[10px] font-medium text-emerald-700/80">
                                        ≈ Bs {formatCurrency(convert(potentialChangeInUSD, 'USD', 'Bs', hasPromo))}
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center space-x-2 pt-1.5 border-t border-emerald-200/70">
                                <Checkbox 
                                    id="give-change-checkbox" 
                                    checked={isGivingChange} 
                                    onCheckedChange={(checked) => { 
                                        setIsGivingChange(!!checked); 
                                        if (!checked) setChangePayments([]); 
                                    }} 
                                    disabled={isSubmitting} 
                                />
                                <Label htmlFor="give-change-checkbox" className="cursor-pointer font-medium text-[11px] text-emerald-800">
                                    Desglosar entrega de vuelto en caja
                                </Label>
                            </div>
                        </div>
                    </SmoothCollapse>
                </div>

                {/* Panel de Gestión de Vueltos */}
                {isGivingChange && (
                    <div className="space-y-2.5 md:border-l md:border-slate-100 md:pl-3.5 animate-in slide-in-from-right-4 duration-300">
                        <div className="text-center p-3 rounded-xl bg-blue-50/60 border border-blue-200/80">
                            <p className="text-[10px] font-medium text-slate-500">
                                Total vuelto a entregar
                            </p>
                            <p className="text-xl font-semibold tabular-nums text-blue-700">
                                ${formatCurrency(requiredChangeInUSD)}
                            </p>
                            <p className="text-[11px] font-medium tabular-nums text-emerald-700">
                                ≈ Bs {formatCurrency(convert(requiredChangeInUSD, 'USD', 'Bs', hasPromo))}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-[11px] font-semibold text-slate-800">
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
                                            className="h-7 text-[11px] font-medium rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-2" 
                                            onClick={() => handleAddChangePayment(method.value)} 
                                            disabled={isSubmitting}
                                        >
                                            <Icon className="w-3 h-3 mr-1 text-blue-600" /> {method.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>

                        <ScrollArea className="max-h-[140px] pr-1">
                            <div className="space-y-1.5">
                                {changePayments.map(p => {
                                    const option = CHANGE_METHODS.find(o => o.value === p.method)!;
                                    const symbol = option.isBs ? 'Bs' : '$';
                                    return (
                                    <div key={p.id} className="p-2 border border-slate-200/90 rounded-lg bg-white flex gap-1.5 items-center">
                                        <span className="text-[11px] font-medium text-slate-700 w-24 truncate">{p.method}</span>
                                        <div className="relative flex-1">
                                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] font-medium">{symbol}</span>
                                            <Input 
                                                type="number" 
                                                step="any"
                                                value={p.amount || ''} 
                                                onChange={(e) => handleUpdateChangePayment(p.id, 'amount', parseFloat(e.target.value) || 0)} 
                                                className="pl-6 h-8 rounded-md border-slate-200 bg-white text-xs font-medium tabular-nums" 
                                                disabled={isSubmitting} 
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="w-7 h-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50" 
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
                            "text-center font-medium text-[11px] p-2 rounded-lg border transition-colors",
                            Math.abs(changeDifference) > 0.01 
                                ? "bg-rose-50 text-rose-700 border-rose-200" 
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        )}>
                            {Math.abs(changeDifference) > 0.01 
                            ? `Falta por desglosar: $${formatCurrency(Math.abs(changeDifference))} (≈ Bs ${formatCurrency(convert(Math.abs(changeDifference), 'USD', 'Bs', hasPromo))})`
                            : "Desglose de vuelto cuadrado ✓"}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer con Botón de Confirmación */}
            <div className="px-4 py-3 sm:px-5 border-t border-slate-100 shrink-0 bg-white no-print">
                <Button 
                    size="default" 
                    onClick={handleConfirm} 
                    disabled={!canConfirm || isSubmitting} 
                    className="w-full h-10 text-xs sm:text-sm font-medium rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm shadow-blue-500/25 transition-all"
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
