"use client";

import { useState, useMemo } from "react";
import type { Sale, PaymentMethod, DailyReconciliation, ReconciliationPaymentMethodSummary, UserProfile } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useCurrency } from "@/hooks/use-currency";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { collection, doc, writeBatch } from "firebase/firestore";
import { format as formatDate, parseISO, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { DoorClosed, Loader2, Printer, StickyNote, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { cn } from "@/lib/utils";
import { ReconciliationTicket, handlePrintReconciliation } from "./reconciliation-ticket";
import { useDashboardStore } from "@/contexts/dashboard-context";

type CashReconciliationDialogProps = {
  openSales: Sale[];
};

const paymentMethodsOrder: PaymentMethod[] = ['Efectivo USD', 'Efectivo Bs', 'Tarjeta', 'Pago Móvil', 'Transferencia', 'USDT / Crypto'];

export function CashReconciliationDialog({ openSales }: CashReconciliationDialogProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { updateCachedItem, addItemToCache, setSettings, settings } = useDashboardStore();
  const currency = useCurrency();
  const { format: formatCurrency, getSymbol, convert } = currency;
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [completedReconciliation, setCompletedReconciliation] = useState<DailyReconciliation | null>(null);
  const [notes, setNotes] = useState("");
  const [countedAmounts, setCountedAmounts] = useState<Record<PaymentMethod, number>>({
    'Efectivo USD': 0,
    'Efectivo Bs': 0,
    'Tarjeta': 0,
    'Pago Móvil': 0,
    'Transferencia': 0,
    'USDT / Crypto': 0,
  });

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const {
    expectedAmounts,
    totalPaymentsInUSD,
    totalChangeGivenInUSD,
    netExpectedInUSD,
    hasOldSales
  } = useMemo(() => {
    const totals: Record<PaymentMethod, number> = {
      'Efectivo USD': 0,
      'Efectivo Bs': 0,
      'Tarjeta': 0,
      'Pago Móvil': 0,
      'Transferencia': 0,
      'USDT / Crypto': 0,
    };
    let paymentsUSD = 0;
    let changeUSD = 0;
    let hasSalesFromBeforeToday = false;
    
    openSales.forEach(sale => {
      if (sale.transactionDate && !isToday(parseISO(sale.transactionDate))) {
          hasSalesFromBeforeToday = true;
      }

      sale.payments.forEach(payment => {
        if (totals[payment.method] !== undefined) {
          totals[payment.method] += payment.amount;
        }
        // Usamos tasa de reposición (true) para la reconciliación del cajón
        paymentsUSD += (payment.method === 'Efectivo USD' || payment.method === 'USDT / Crypto') ? payment.amount : convert(payment.amount, 'Bs', 'USD', true);
      });
      if (sale.changeGiven) {
          sale.changeGiven.forEach(change => {
              if (totals[change.method] !== undefined) {
                  totals[change.method] -= change.amount;
              }
              changeUSD += (change.method === 'Efectivo USD' || change.method === 'USDT / Crypto') ? change.amount : convert(change.amount, 'Bs', 'USD', true);
          });
      }
    });

    return { 
      expectedAmounts: totals,
      totalPaymentsInUSD: paymentsUSD,
      totalChangeGivenInUSD: changeUSD,
      netExpectedInUSD: paymentsUSD - changeUSD,
      hasOldSales: hasSalesFromBeforeToday
    };
  }, [openSales, convert]);

  const differences = useMemo(() => {
    return paymentMethodsOrder.reduce((acc, method) => {
        acc[method] = countedAmounts[method] - expectedAmounts[method];
        return acc;
    }, {} as Record<PaymentMethod, number>);
  }, [countedAmounts, expectedAmounts]);

  const totalSalesValue = openSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  
  const totalCountedInUSD = useMemo(() => {
     return Object.entries(countedAmounts).reduce((acc, [method, amount]) => {
        const typedMethod = method as PaymentMethod;
        if (typedMethod === 'Efectivo USD' || typedMethod === 'USDT / Crypto') {
            return acc + amount;
        }
        // Valuamos lo contado físicamente contra la tasa de reposición
        return acc + convert(amount, 'Bs', 'USD', true);
     }, 0)
  }, [countedAmounts, convert]);

  const totalDifference = totalCountedInUSD - netExpectedInUSD;
  const transactionCount = openSales.length;

  const handleAmountChange = (method: PaymentMethod, value: string) => {
    setCountedAmounts(prev => ({ ...prev, [method]: parseFloat(value) || 0 }));
  };

  const handleFinishAndReset = () => {
    setIsOpen(false);
    setCompletedReconciliation(null);
    setNotes("");
    setCountedAmounts({
      'Efectivo USD': 0,
      'Efectivo Bs': 0,
      'Tarjeta': 0,
      'Pago Móvil': 0,
      'Transferencia': 0,
      'USDT / Crypto': 0,
    });
  };
  
  const onPrint = () => {
    if (!completedReconciliation) return;
    handlePrintReconciliation({ 
        reconciliation: completedReconciliation, 
        currency,
        businessName: profile?.businessName
    }, (error) => {
      toast({ variant: "destructive", title: "Error de Impresión", description: error });
    });
  };

  const handleCloseDay = async () => {
    if (!firestore || !user || transactionCount === 0) return;
    setIsClosing(true);

    const now = new Date();
    const todayStr = formatDate(now, 'yyyy-MM-dd');
    const reconciliationId = `RECON-${todayStr}-${now.getTime()}`;
    
    const batch = writeBatch(firestore);
    const reconciliationRef = doc(firestore, 'users', user.uid, 'daily_reconciliations', reconciliationId);
    
    const paymentMethodDetails = paymentMethodsOrder.reduce((acc, method) => {
        if (expectedAmounts[method] !== 0 || countedAmounts[method] !== 0) {
            acc[method] = {
                expected: expectedAmounts[method],
                counted: countedAmounts[method],
                difference: differences[method],
            };
        }
        return acc;
    }, {} as { [key in PaymentMethod]?: ReconciliationPaymentMethodSummary });

    const newReconciliation: DailyReconciliation = {
      id: reconciliationId,
      date: todayStr,
      totalSales: totalSalesValue,
      totalTransactions: transactionCount,
      closedAt: now.toISOString(),
      paymentMethods: paymentMethodDetails,
      totalExpected: netExpectedInUSD,
      totalCounted: totalCountedInUSD,
      totalDifference: totalDifference,
      totalPaymentsReceived: totalPaymentsInUSD,
      totalChangeGiven: totalChangeGivenInUSD,
      notes: notes.trim() || "", 
    };
    batch.set(reconciliationRef, newReconciliation);

    openSales.forEach(sale => {
      const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', sale.id!);
      batch.update(saleRef, { reconciliationId: reconciliationId });
    });

    const nowIso = now.toISOString();
    const updatedInitialBalances = {
      'Efectivo USD': countedAmounts['Efectivo USD'] || 0,
      'Efectivo Bs': countedAmounts['Efectivo Bs'] || 0,
      'Tarjeta / Pago Móvil': (countedAmounts['Tarjeta'] || 0) + (countedAmounts['Pago Móvil'] || 0),
      'Transferencia': countedAmounts['Transferencia'] || 0,
    };

    const settingsRef = doc(firestore, 'users', user.uid, 'app-settings', 'main');
    batch.set(settingsRef, {
      balancesUpdatedAt: nowIso,
      initialBalances: updatedInitialBalances,
    }, { merge: true });

    try {
      await batch.commit();

      // INYECCIÓN ATÓMICA EN MEMORIA (Reactividad Instantánea 0ms - Sin lecturas)
      // 1. Marcamos las ventas como conciliadas en el caché global para que desaparezcan de la vista "Abierta"
      openSales.forEach(sale => {
          updateCachedItem(sale.id!, { reconciliationId: reconciliationId });
      });
      // 2. Añadimos el nuevo reporte de cierre al historial en memoria
      addItemToCache('daily_reconciliations', newReconciliation);

      // 3. Actualizamos las configuraciones y los saldos iniciales en el estado global de la app
      if (settings) {
          setSettings({
              ...settings,
              balancesUpdatedAt: nowIso,
              initialBalances: updatedInitialBalances,
          });
      }

      toast({ title: "Caja Cerrada", description: `Se procesaron ${transactionCount} transacciones.` });
      setCompletedReconciliation(newReconciliation);
    } catch (error) {
      toast({ variant: "destructive", title: "Error al cerrar", description: "Ocurrió un error al guardar el cierre." });
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(val) => !val ? handleFinishAndReset() : setIsOpen(true)}>
      <Card className="border-primary/20 shadow-md">
        <CardHeader><CardTitle className="text-primary flex items-center gap-2"><DoorClosed className="w-5 h-5"/> Cierre de Caja</CardTitle></CardHeader>
        <CardContent className="space-y-3">
           <div className="p-4 rounded-xl bg-muted/50 border space-y-3">
                 <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase text-muted-foreground tracking-tighter">Ventas por Procesar</p>
                    <p className="text-xl font-black text-slate-800">{transactionCount}</p>
                </div>
                {hasOldSales && (
                    <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-amber-700 text-[10px] font-bold">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>TIENES VENTAS PENDIENTES DE DÍAS ANTERIORES.</span>
                    </div>
                )}
                <div className="flex items-center justify-between font-black text-lg border-t border-muted-foreground/10 pt-2 mt-2">
                    <p className="text-xs uppercase tracking-widest text-primary">Saldo Estimado ($):</p>
                    <p className="text-primary">${formatCurrency(netExpectedInUSD)}</p>
                </div>
            </div>
          <DialogTrigger asChild>
            <Button className="w-full h-12 text-base font-bold shadow-lg" disabled={transactionCount === 0}>
              <DoorClosed className="mr-2 h-5 w-5" />
              Realizar Corte de Caja
            </Button>
          </DialogTrigger>
        </CardContent>
      </Card>
      <DialogContent className="max-w-3xl max-h-[95vh] flex flex-col p-0 overflow-hidden">
        {completedReconciliation ? (
            <div className="flex flex-col h-full overflow-hidden">
                <div className="p-6 border-b">
                    <DialogTitle className="text-2xl font-black">Cierre de Caja Completado</DialogTitle>
                </div>
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="max-w-sm mx-auto border-2 border-dashed p-4 rounded-xl bg-slate-50">
                        <ReconciliationTicket 
                            reconciliation={completedReconciliation} 
                            currency={currency} 
                            businessName={profile?.businessName}
                        />
                    </div>
                </div>
                <div className="p-6 border-t bg-white flex flex-col sm:flex-row gap-3">
                    <Button onClick={onPrint} variant="outline" className="flex-1 h-12 font-bold"><Printer className="mr-2 h-4 w-4" /> Imprimir Ticket</Button>
                    <Button onClick={handleFinishAndReset} className="flex-1 h-12 font-black">Finalizar y Salir</Button>
                </div>
            </div>
        ) : (
            <div className="flex flex-col h-full overflow-hidden">
                <div className="p-6 border-b">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black">Cuadre de Caja (Corte de Turno)</DialogTitle>
                        <DialogDescription className="font-bold text-slate-600">
                            ID: {transactionCount} ventas acumuladas hasta {formatDate(new Date(), "p", { locale: es })}
                        </DialogDescription>
                    </DialogHeader>
                </div>
                
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-6">
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="font-black text-xs uppercase tracking-widest text-primary flex items-center gap-2">
                                    <DoorClosed className="w-4 h-4"/> 1. Cuenta el Dinero Físico
                                </h3>
                                <div className="grid grid-cols-1 gap-3">
                                    {paymentMethodsOrder.map(method => (
                                        <div key={method} className="space-y-1.5 p-3 rounded-lg bg-slate-50 border transition-all focus-within:border-primary/50">
                                            <Label htmlFor={`counted-${method}`} className="text-[10px] font-black uppercase text-muted-foreground">{method}</Label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 font-black text-slate-400 text-sm">{(method === 'Efectivo USD' || method === 'USDT / Crypto') ? '$' : 'Bs'}</span>
                                                <Input 
                                                    id={`counted-${method}`} 
                                                    type="number" 
                                                    step="any"
                                                    value={countedAmounts[method] || ''} 
                                                    onChange={(e) => handleAmountChange(method, e.target.value)} 
                                                    className="h-10 font-black text-lg pl-8 border-none bg-transparent shadow-none focus-visible:ring-0" 
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/10">
                                <Label className="text-[10px] font-black uppercase text-primary flex items-center gap-2">
                                    <StickyNote className="w-3.5 h-3.5" /> 2. Identifica este Cierre (Opcional)
                                </Label>
                                <Input 
                                    value={notes} 
                                    onChange={(e) => setNotes(e.target.value)} 
                                    placeholder="Ej: Turno Mañana, Corte Parcial..." 
                                    className="bg-white font-bold"
                                />
                            </div>
                        </div>

                        <div className="space-y-6">
                            <h3 className="font-black text-xs uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4"/> 3. Resultado del Cuadre
                            </h3>
                            <div className="space-y-3 p-5 bg-white rounded-2xl border-2 shadow-sm">
                                {paymentMethodsOrder.map(method => {
                                    if (expectedAmounts[method] === 0 && countedAmounts[method] === 0) return null;
                                    const diff = differences[method];
                                    const symbol = (method === 'Efectivo USD' || method === 'USDT / Crypto') ? '$' : 'Bs';
                                    
                                    let statusLabel = "";
                                    if (diff > 0.01) statusLabel = "(SOBRANTE)";
                                    else if (diff < -0.01) statusLabel = "(FALTANTE)";
                                    else statusLabel = "(CUADRADO)";

                                    return (
                                        <div key={method} className="flex justify-between items-center text-sm border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">{method}</span>
                                                <span className={cn("text-[8px] font-black uppercase", diff < -0.01 ? "text-destructive" : diff > 0.01 ? "text-green-600" : "text-slate-400")}>
                                                    {statusLabel}
                                                </span>
                                            </div>
                                            <span className={cn("font-black tabular-nums", diff < -0.01 ? "text-destructive" : diff > 0.01 ? "text-green-600" : "text-slate-800")}>
                                                {diff > 0.01 ? '+' : ''}{symbol}{formatCurrency(diff)}
                                            </span>
                                        </div>
                                    );
                                })}
                                
                                <div className={cn(
                                    "p-4 rounded-xl mt-4 flex flex-col items-center justify-center space-y-1 transition-colors bg-slate-900 text-white"
                                )}>
                                    <span className="text-[10px] font-black uppercase tracking-widest opacity-70">Diferencia Total ($)</span>
                                    <p className="text-3xl font-black tabular-nums">
                                        {totalDifference > 0.01 ? '+' : ''}{formatCurrency(totalDifference)}
                                    </p>
                                    <p className="text-[10px] font-bold uppercase">
                                        {totalDifference < -0.01 ? "Faltante Detectado" : totalDifference > 0.01 ? "Sobrante Detectado" : "Caja Cuadrada Perfecta"}
                                    </p>
                                </div>
                            </div>

                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <div className="text-[11px] leading-tight text-amber-900 font-medium">
                                    <p className="font-black uppercase mb-1">Guía rápida de saldos:</p>
                                    <p className="mb-1"><span className="text-green-700 font-black">POSITIVO (+):</span> Significa que tienes **MÁS** dinero físico del que el sistema registró. (Sobrante)</p>
                                    <p><span className="text-destructive font-black">NEGATIVO (-):</span> Significa que tienes **MENOS** dinero físico del que el sistema esperaba. (Faltante)</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t bg-white flex flex-col sm:flex-row gap-3">
                    <Button variant="outline" onClick={() => setIsOpen(false)} className="h-12 flex-1 font-bold">Continuar Vendiendo</Button>
                    <Button onClick={handleCloseDay} disabled={isClosing} className="h-12 flex-1 font-black shadow-xl">
                        {isClosing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                        PROCESAR CIERRE AHORA
                    </Button>
                </div>
            </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
