
"use client";

import type { CartItem, Payment, PaymentMethod, Sale, Product, UserProfile, RepairJob } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useState, type ReactNode, useMemo, useEffect } from "react";
import { CreditCard, Landmark, Smartphone, DollarSign, Printer, Trash2, Banknote, AlertTriangle, Loader2, Coins, FileText, Building2, Wallet, CheckCircle2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReceiptView, handlePrintReceipt } from "./receipt-view";
import { useCurrency } from "@/hooks/use-currency";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { Progress } from "../ui/progress";
import { SeniatInvoiceTemplate } from "../invoice/seniat-invoice-template";

type CheckoutDialogProps = {
  cart: CartItem[];
  allProducts: Product[];
  total: number;
  children: ReactNode;
  onCheckout: (payments: Payment[], changeGiven: Payment[], totalChangeInUSD: number, isFiscal: boolean) => Promise<Sale | null>;
  onClearCart: () => void;
  isRepairSale?: boolean;
  repairData?: RepairJob | null;
  customerName?: string;
  customerID?: string;
};

const paymentMethodOptions: { value: PaymentMethod, label: string, icon: ReactNode, hasReference: boolean, isBs: boolean, color: string }[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: <DollarSign className="w-4 h-4 text-emerald-500"/>, hasReference: false, isBs: false, color: 'text-emerald-500' },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: <Landmark className="w-4 h-4 text-blue-500"/>, hasReference: false, isBs: true, color: 'text-blue-500' },
    { value: 'Pago Móvil', label: 'Pago Móvil', icon: <Smartphone className="w-4 h-4 text-orange-500"/>, hasReference: true, isBs: true, color: 'text-orange-500' },
    { value: 'Tarjeta', label: 'Punto / Tarjeta', icon: <CreditCard className="w-4 h-4 text-indigo-500"/>, hasReference: true, isBs: true, color: 'text-indigo-500' },
    { value: 'Transferencia', label: 'Transferencia', icon: <Banknote className="w-4 h-4 text-cyan-500"/>, hasReference: true, isBs: true, color: 'text-cyan-500' },
    { value: 'USDT / Crypto', label: 'USDT / Crypto', icon: <Coins className="w-4 h-4 text-purple-500"/>, hasReference: true, isBs: false, color: 'text-purple-500' },
];

type TempPayment = Payment & { id: number };

export function CheckoutDialog({ cart, allProducts, total, children, onCheckout, onClearCart, isRepairSale, repairData, customerName, customerID }: CheckoutDialogProps) {
  const [open, setOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { format: formatCurrency, getSymbol, convert, bcvRate, parallelRate, isLoading: currencyLoading } = useCurrency();
  const [payments, setPayments] = useState<TempPayment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFiscal, setIsFiscal] = useState(false);
  const router = useRouter();

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);
  
  const hasPromo = useMemo(() => cart.some(item => item.isPromo), [cart]);

  useEffect(() => {
    if (open && !completedSale) {
      setPayments([]);
      setIsSubmitting(false);
      setIsFiscal(false);
    }
  }, [open, completedSale]);

  const totalPaidInUSD = useMemo(() => {
    if (currencyLoading) return 0;
    return payments.reduce((acc, p) => {
      if (p.method === 'Efectivo USD' || p.method === 'USDT / Crypto') {
        return acc + p.amount;
      }
      return acc + convert(p.amount, 'Bs', 'USD', hasPromo);
    }, 0);
  }, [payments, convert, currencyLoading, hasPromo]);

  const remainingToPayInUSD = useMemo(() => Math.max(0, total - totalPaidInUSD), [total, totalPaidInUSD]);
  const isComplete = totalPaidInUSD >= total - 0.01;
  const progressValue = Math.min(100, (totalPaidInUSD / total) * 100);

  const isCustomerAssigned = !!(customerName?.trim() || customerID?.trim());
  const isFiscalViolation = isFiscal && !isCustomerAssigned;

  const canConfirm = useMemo(() => {
    if (total <= 0 || payments.length === 0 || currencyLoading || isSubmitting) return false;
    if (isFiscalViolation) return false;
    return totalPaidInUSD > 0;
  }, [total, totalPaidInUSD, payments, currencyLoading, isSubmitting, isFiscalViolation]);

  const togglePaymentMethod = (method: PaymentMethod) => {
    const existingIndex = payments.findIndex(p => p.method === method);
    if (existingIndex !== -1) {
        setPayments(prev => prev.filter(p => p.method !== method));
    } else {
        const option = paymentMethodOptions.find(o => o.value === method)!;
        const remainingInCurrency = option.isBs ? convert(remainingToPayInUSD, 'USD', 'Bs', hasPromo) : remainingToPayInUSD;
        setPayments(prev => [...prev, { 
            id: Date.now(), 
            method, 
            amount: parseFloat(remainingInCurrency.toFixed(2)) || 0, 
            reference: '' 
        }]);
    }
  };

  const handleUpdatePayment = (id: number, field: 'amount' | 'reference', value: string | number) => {
    setPayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleRemovePayment = (id: number) => {
    setPayments(prev => prev.filter(p => p.id !== id));
  };

  const handleConfirm = async () => {
    if (!canConfirm || isSubmitting || isFiscalViolation) return;
    
    setIsSubmitting(true);
    
    // Si hay vuelto, calculamos cuánto es en USD para pasarlo al backend
    const potentialChangeUSD = totalPaidInUSD > total ? totalPaidInUSD - total : 0;
    
    try {
        const sale = await onCheckout(
            payments.map(({ id, ...rest }) => rest),
            [], // Los vueltos se gestionan ahora por simplicidad como crédito o efectivo si el usuario lo registra como egreso
            potentialChangeUSD,
            isFiscal
        );
        
        if(sale) {
            setCompletedSale(sale);
        }
    } catch (e) {
        toast({ variant: "destructive", title: "Error al procesar" });
    } finally {
        setIsSubmitting(false);
    }
  }

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
  }

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
            "transition-all duration-300 flex flex-col p-0 bg-slate-50 border-none shadow-2xl",
            completedSale ? (completedSale.isFiscal ? "max-w-[900px] h-[95vh]" : "max-w-md") : "max-w-2xl"
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {completedSale ? (
            <div className="flex flex-col h-full overflow-hidden">
               <div className="p-4 border-b shrink-0 flex justify-between items-center bg-white">
                  <DialogTitle className="uppercase font-black flex items-center gap-2">
                    {completedSale.isFiscal ? <Building2 className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5" />}
                    {completedSale.isFiscal ? 'FACTURA FISCAL GENERADA' : 'VENTA COMPLETADA'}
                  </DialogTitle>
                </div>
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                {completedSale.isFiscal && profile ? (
                    <SeniatInvoiceTemplate 
                        sale={completedSale} 
                        profile={profile} 
                        fiscalData={completedSale.fiscalMetadata as any} 
                    />
                ) : (
                    <div className="max-w-[300px] mx-auto border-2 border-dashed p-4 rounded-xl bg-white shadow-sm">
                        <ReceiptView 
                            sale={completedSale} 
                            currency={{ format: formatCurrency, getSymbol, convert }}
                            businessName={profile?.businessName}
                            profile={profile}
                            repairData={repairData}
                        />
                    </div>
                )}
              </div>
              <div className="mt-auto p-6 bg-white border-t flex gap-3 shrink-0 no-print">
                   <Button onClick={() => window.print()} variant="outline" className="flex-1 h-12 font-bold">
                      <Printer className="mr-2 h-4 w-4" />
                      IMPRIMIR
                  </Button>
                  <Button onClick={handleCloseAndReset} className="flex-1 h-12 font-black uppercase">Finalizar</Button>
              </div>
          </div>
        ) : (
            <>
            {/* HEADER */}
            <div className="p-4 border-b flex justify-between items-center bg-white">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-slate-100 rounded-lg">
                        <Wallet className="w-5 h-5 text-slate-600" />
                    </div>
                    <DialogTitle className="text-xl font-black text-slate-800">Procesar Pago</DialogTitle>
                    <Badge variant="outline" className="ml-2 bg-slate-50 text-slate-500 border-slate-200 text-[10px] font-bold py-1">
                        Tasa: Bs {formatCurrency(bcvRate)}
                    </Badge>
                </div>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
                {/* SUMMARY CARD (DARK) */}
                <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-2xl relative overflow-hidden">
                    <div className="flex justify-between items-start mb-6">
                        <div className="space-y-1">
                            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total a cobrar</p>
                            <h2 className="text-4xl font-black">${formatCurrency(total)}</h2>
                        </div>
                        <div className="text-right space-y-2">
                            {isComplete ? (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-black text-[10px] py-1 px-3">
                                    <CheckCircle2 className="w-3 h-3 mr-1.5" /> Pago completo
                                </Badge>
                            ) : (
                                <div className="h-6" />
                            )}
                            <p className="text-slate-400 font-bold text-sm">≈ Bs {formatCurrency(convert(total, 'USD', 'Bs', hasPromo))}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Progress value={progressValue} className="h-1.5 bg-slate-800" indicatorClassName="bg-emerald-500" />
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-tighter">
                            <span className="text-slate-500">Abonado: <span className="text-white">${formatCurrency(totalPaidInUSD)}</span></span>
                            {isComplete && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5"/> Total cubierto</span>}
                        </div>
                    </div>
                </div>

                {/* PAYMENT METHODS GRID */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                        <Label className="text-xs font-black uppercase text-slate-500 tracking-tighter">Métodos de pago</Label>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">{payments.length} seleccionados</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {paymentMethodOptions.map((opt) => {
                            const isSelected = payments.some(p => p.method === opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => togglePaymentMethod(opt.value)}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left group",
                                        isSelected 
                                            ? "bg-white border-primary shadow-sm" 
                                            : "bg-white border-transparent hover:border-slate-200"
                                    )}
                                >
                                    <div className={cn("p-2 rounded-lg bg-slate-50 group-hover:bg-slate-100 transition-colors", isSelected && "bg-primary/5")}>
                                        {opt.icon}
                                    </div>
                                    <span className={cn("text-xs font-black uppercase text-slate-600", isSelected && "text-slate-900")}>
                                        {opt.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* PAYMENTS BREAKDOWN */}
                {payments.length > 0 && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <Label className="text-xs font-black uppercase text-slate-500 tracking-tighter">Desglose de pagos recibidos</Label>
                        <div className="space-y-2">
                            {payments.map((p) => {
                                const opt = paymentMethodOptions.find(o => o.value === p.method)!;
                                return (
                                    <div key={p.id} className="bg-white border rounded-xl p-2 flex items-center gap-3 shadow-sm">
                                        <div className="flex items-center gap-2 min-w-[130px] pl-2 border-r pr-3">
                                            {opt.icon}
                                            <span className="text-[10px] font-black uppercase text-slate-700 truncate">{opt.label}</span>
                                        </div>
                                        
                                        <div className="flex-1 flex gap-2">
                                            <div className="relative flex-1">
                                                <span className="absolute left-2.5 top-2.5 text-slate-400 font-bold text-[10px] uppercase">{opt.isBs ? 'Bs' : '$'}</span>
                                                <input 
                                                    type="number"
                                                    value={p.amount || ''}
                                                    onChange={(e) => handleUpdatePayment(p.id, 'amount', parseFloat(e.target.value) || 0)}
                                                    placeholder="0.00"
                                                    className="w-full bg-slate-50 border-none rounded-lg h-9 pl-8 pr-2 font-black text-xs text-slate-800 focus:ring-1 focus:ring-primary/20 outline-none"
                                                />
                                            </div>
                                            {opt.hasReference && (
                                                <input 
                                                    type="text"
                                                    value={p.reference || ''}
                                                    onChange={(e) => handleUpdatePayment(p.id, 'reference', e.target.value.toUpperCase())}
                                                    placeholder="NRO. REFERENCIA / RECIBO"
                                                    className="flex-[1.5] bg-slate-50 border-none rounded-lg h-9 px-3 font-mono text-[9px] font-bold text-slate-600 focus:ring-1 focus:ring-primary/20 outline-none uppercase"
                                                />
                                            )}
                                        </div>

                                        <button 
                                            onClick={() => handleRemovePayment(p.id)}
                                            className="p-2 text-slate-300 hover:text-destructive transition-colors mr-1"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* FOOTER BUTTON */}
            <div className="p-6 bg-white border-t shrink-0">
                {isFiscalViolation && (
                    <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl mb-4 flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                        <AlertTriangle className="w-4 h-4" />
                        <p className="text-[10px] font-black uppercase tracking-tighter">Debe asignar un cliente para emitir Factura Fiscal</p>
                    </div>
                )}
                <Button 
                    size="lg" 
                    onClick={handleConfirm} 
                    disabled={!canConfirm || isSubmitting || isFiscalViolation} 
                    className="w-full h-14 text-base font-black shadow-xl bg-slate-900 hover:bg-black text-white rounded-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                >
                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                    Registrar y finalizar venta
                    {!isSubmitting && <ArrowRight className="w-5 h-5" />}
                </Button>
            </div>
            </>
        )}
      </DialogContent>
    </Dialog>
  );
}
