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
import { queryCache } from "@/lib/firestore/query-cache";
import { hasCashierSystemActive, OWNER_OPERATOR_ID } from "@/lib/cashiers";

type CashReconciliationDialogProps = {
  openSales: Sale[];
  targetCashierId?: string;
  targetCashierName?: string;
};

const paymentMethodsOrder: PaymentMethod[] = [
  'Efectivo USD',
  'Efectivo Bs',
  'Tarjeta',
  'Pago Móvil',
  'Transferencia',
  'Tarjeta / Pago Móvil',
  'USDT / Crypto',
];

export function CashReconciliationDialog({ openSales, targetCashierId, targetCashierName }: CashReconciliationDialogProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { updateCachedItem, addItemToCache, setSettings, settings, profile, activeOperator, registerName } = useDashboardStore();
  const cashierMode = hasCashierSystemActive(profile);
  const closingCashierId = targetCashierId || activeOperator?.id || OWNER_OPERATOR_ID;
  const closingCashierName = targetCashierName || activeOperator?.name || profile?.accountName || 'Dueño';
  const currency = useCurrency();
  const { format: formatCurrency, getSymbol, convert } = currency;
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [completedReconciliation, setCompletedReconciliation] = useState<DailyReconciliation | null>(null);
  const [notes, setNotes] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [showAllMethods, setShowAllMethods] = useState(false);
  const [countedAmounts, setCountedAmounts] = useState<Record<PaymentMethod, number>>({
    'Efectivo USD': 0,
    'Efectivo Bs': 0,
    'Tarjeta': 0,
    'Pago Móvil': 0,
    'Transferencia': 0,
    'Tarjeta / Pago Móvil': 0,
    'USDT / Crypto': 0,
  });

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
      'Tarjeta / Pago Móvil': 0,
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
        // Conversión a tasa de reposición (valor real del bolívar en caja)
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

  // Solo se cuentan los metodos con movimiento; el resto se puede mostrar.
  const methodsToCount = useMemo(() => {
    if (showAllMethods) return paymentMethodsOrder;
    return paymentMethodsOrder.filter((method) => expectedAmounts[method] !== 0 || (countedAmounts[method] || 0) !== 0);
  }, [showAllMethods, expectedAmounts, countedAmounts]);

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
        // Valuamos lo contado físicamente a tasa de reposición
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
      'Tarjeta / Pago Móvil': 0,
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
    const nowIso = now.toISOString();
    const todayStr = formatDate(now, 'yyyy-MM-dd');
    const reconciliationId = `RECON-${todayStr}-${now.getTime()}`;
    const updatedInitialBalances = { ...countedAmounts };
    
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
      closedAt: nowIso,
      paymentMethods: paymentMethodDetails,
      totalExpected: netExpectedInUSD,
      totalCounted: totalCountedInUSD,
      totalDifference: totalDifference,
      totalPaymentsReceived: totalPaymentsInUSD,
      totalChangeGiven: totalChangeGivenInUSD,
      notes: notes.trim() || "",
      cashierId: closingCashierId,
      cashierName: closingCashierName,
      registerName,
    };
    batch.set(reconciliationRef, newReconciliation);

    const settingsRef = doc(firestore, 'users', user.uid, 'app-settings', 'main');
    batch.set(settingsRef, {
      balancesUpdatedAt: nowIso,
      initialBalances: updatedInitialBalances,
    }, { merge: true });

    const BATCH_LIMIT = 400;
    const batches = [batch];
    let currentBatch = batch;
    let operationCount = 2; // reconciliationRef and settingsRef

    openSales.forEach(sale => {
      if (operationCount >= BATCH_LIMIT) {
        currentBatch = writeBatch(firestore);
        batches.push(currentBatch);
        operationCount = 0;
      }
      const saleRef = doc(firestore, 'users', user.uid, 'sale_transactions', sale.id!);
      currentBatch.update(saleRef, { reconciliationId: reconciliationId });
      operationCount++;
    });

    try {
      await Promise.all(batches.map(b => b.commit()));

      // INYECCIÓN ATÓMICA EN MEMORIA (Reactividad Instantánea 0ms - Sin lecturas)
      // 1. Marcamos las ventas como conciliadas en el caché global para que desaparezcan de la vista "Abierta"
      openSales.forEach(sale => {
          updateCachedItem(sale.id!, { reconciliationId: reconciliationId });
          // También la caché paginada: sin esto la venta sigue contando como "abierta".
          queryCache.patchItem(user.uid, 'sale_transactions', sale.id!, { reconciliationId: reconciliationId });
      });
      // 2. Añadimos el nuevo reporte de cierre al historial en memoria
      addItemToCache('daily_reconciliations', newReconciliation);
      queryCache.mergeIntoCatalog(user.uid, 'daily_reconciliations', [newReconciliation as any]);

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
      <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 sm:p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600">
              <DoorClosed className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Cierre de Caja</h2>
                {cashierMode && (
                  <span className="inline-flex items-center rounded-full border border-blue-200/80 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    {closingCashierName}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {cashierMode
                  ? `Gaveta individual de ${closingCashierName} lista para arquear`
                  : "Ventas abiertas listas para arquear"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center lg:gap-3">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/75 px-3 py-2 sm:py-1.5 text-xs">
                <span className="text-slate-500 truncate">Por procesar</span>
                <span className="font-semibold tabular-nums text-slate-900 shrink-0">{transactionCount}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-200/80 bg-blue-50/50 px-3 py-2 sm:py-1.5 text-xs">
                <span className="text-slate-500 truncate">Estimado</span>
                <span className="font-semibold tabular-nums text-blue-700 shrink-0">${formatCurrency(netExpectedInUSD)}</span>
              </div>
            </div>

            <DialogTrigger asChild>
              <Button
                className="h-10 sm:h-9 w-full sm:w-auto shrink-0 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 px-4 text-xs font-semibold text-white shadow-sm shadow-emerald-500/20"
                disabled={transactionCount === 0}
              >
                <DoorClosed className="mr-1.5 h-4 w-4" />
                Cierre de Turno
              </Button>
            </DialogTrigger>
          </div>
        </div>

        {hasOldSales && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-[11px] font-medium text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>Tienes ventas pendientes de días anteriores sin cerrar.</span>
          </div>
        )}
      </div>

      <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-3xl max-h-[90dvh] flex flex-col gap-0 p-0 sm:p-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {completedReconciliation ? (
            <div className="flex flex-col max-h-[90dvh] overflow-hidden bg-white">
                <div className="px-4 py-4 sm:px-6 border-b border-slate-100 bg-white pr-14">
                    <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" />
                        </span>
                        <DialogTitle className="text-sm sm:text-base font-semibold text-slate-900">Cierre de Caja Completado</DialogTitle>
                    </div>
                </div>
                <div className="flex-1 min-h-0 p-4 overflow-y-auto sm:p-6 bg-white">
                    <div className="max-w-sm mx-auto border border-slate-200 p-4 rounded-xl bg-white shadow-sm">
                        <ReconciliationTicket 
                            reconciliation={completedReconciliation} 
                            currency={currency} 
                            businessName={profile?.businessName}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-2 border-t border-slate-100 bg-white px-4 py-3.5 sm:flex-row sm:gap-2.5 sm:px-6 sm:py-3">
                    <Button onClick={onPrint} variant="outline" className="h-10 sm:h-9 flex-1 rounded-xl sm:rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50">
                        <Printer className="mr-1.5 h-4 w-4 text-blue-600" /> Imprimir Ticket
                    </Button>
                    <Button onClick={handleFinishAndReset} className="h-10 sm:h-9 flex-1 rounded-xl sm:rounded-lg bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-xs font-medium text-white shadow-sm">
                        Finalizar y Salir
                    </Button>
                </div>
            </div>
        ) : (
            <div className="flex flex-col max-h-[90dvh] overflow-hidden bg-white">
                <div className="px-4 py-4 sm:px-6 border-b border-slate-100 bg-white pr-14">
                    <DialogHeader className="space-y-0 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                <DoorClosed className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <DialogTitle className="text-sm sm:text-base font-semibold text-slate-900 leading-none sm:leading-tight">Cuadre de Caja</DialogTitle>
                                <DialogDescription className="mt-0.5 text-[11px] font-normal text-slate-500">
                                    {transactionCount} ventas acumuladas hasta {formatDate(new Date(), "p", { locale: es })}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>
                
                <div className="flex-1 min-h-0 p-4 overflow-y-auto sm:p-6 bg-white">
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                        <div className="space-y-4">
                            <div className="space-y-3">
                                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                    <DoorClosed className="w-3.5 h-3.5 text-blue-600" /> 1. Cuenta el dinero físico
                                </h3>
                                <div className="grid grid-cols-1 gap-2">
                                    {methodsToCount.map(method => {
                                        const symbol = (method === 'Efectivo USD' || method === 'USDT / Crypto') ? '$' : 'Bs';
                                        const expected = expectedAmounts[method];
                                        const counted = countedAmounts[method] || 0;
                                        const diff = differences[method];
                                        const touched = counted > 0;

                                        return (
                                        <div key={method} className="space-y-1 rounded-xl border border-slate-200/90 bg-white p-2.5 transition-all focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/10">
                                            <div className="flex items-center justify-between gap-2">
                                                <Label htmlFor={`counted-${method}`} className="text-[11px] font-medium text-slate-600">{method}</Label>
                                                {touched && (
                                                    <span className={cn(
                                                        "shrink-0 rounded-full border px-2 py-px text-[10px] font-medium tabular-nums",
                                                        Math.abs(diff) <= 0.01
                                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                            : diff > 0
                                                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                                                : "border-rose-200 bg-rose-50 text-rose-700"
                                                    )}>
                                                        {Math.abs(diff) <= 0.01 ? "Cuadra" : `${diff > 0 ? '+' : ''}${symbol}${formatCurrency(diff)}`}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="relative">
                                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">{symbol}</span>
                                                <Input 
                                                    id={`counted-${method}`} 
                                                    type="number" 
                                                    step="any"
                                                    value={countedAmounts[method] || ''} 
                                                    onChange={(e) => handleAmountChange(method, e.target.value)} 
                                                    className="h-9 border-0 bg-transparent pl-7 text-base font-semibold tabular-nums text-slate-900 shadow-none focus-visible:ring-0" 
                                                    placeholder="0.00"
                                                />
                                            </div>
                                            <p className="text-[11px] tabular-nums text-slate-400">
                                                Esperado: <span className="font-medium text-slate-700">{symbol}{formatCurrency(expected)}</span>
                                            </p>
                                        </div>
                                        );
                                    })}
                                </div>
                                {!showAllMethods && methodsToCount.length < paymentMethodsOrder.length && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAllMethods(true)}
                                        className="text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2 cursor-pointer"
                                    >
                                        Mostrar métodos sin movimiento ({paymentMethodsOrder.length - methodsToCount.length})
                                    </button>
                                )}
                                {showAllMethods && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAllMethods(false)}
                                        className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 cursor-pointer"
                                    >
                                        Ver solo los que tuvieron movimiento
                                    </button>
                                )}
                            </div>

                            <div className="space-y-1.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                                <Label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                                    <StickyNote className="w-3.5 h-3.5 text-blue-600" /> 2. Nota o turno (opcional)
                                </Label>
                                <Input 
                                    value={notes} 
                                    onChange={(e) => setNotes(e.target.value)} 
                                    placeholder="Ej: Turno mañana, corte parcial..." 
                                    className="h-9 rounded-lg border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> 3. Resultado del cuadre
                            </h3>
                            <div className="space-y-2.5 rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
                                {paymentMethodsOrder.map(method => {
                                    if (expectedAmounts[method] === 0 && countedAmounts[method] === 0) return null;
                                    const diff = differences[method];
                                    const symbol = (method === 'Efectivo USD' || method === 'USDT / Crypto') ? '$' : 'Bs';
                                    
                                    let statusLabel = "Cuadrado";
                                    if (diff > 0.01) statusLabel = "Sobrante";
                                    else if (diff < -0.01) statusLabel = "Faltante";

                                    return (
                                        <div key={method} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 text-xs last:border-0 last:pb-0">
                                            <div className="flex min-w-0 flex-col">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-medium text-slate-800">{method}</span>
                                                    <span className={cn(
                                                        "text-[10px] font-medium",
                                                        diff < -0.01 ? "text-rose-600" : diff > 0.01 ? "text-blue-600" : "text-emerald-600"
                                                    )}>
                                                        ({statusLabel})
                                                    </span>
                                                </div>
                                                <span className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                                                    Esp. {symbol}{formatCurrency(expectedAmounts[method])} · Cont. {symbol}{formatCurrency(countedAmounts[method])}
                                                </span>
                                            </div>
                                            <span className={cn("shrink-0 font-semibold tabular-nums", diff < -0.01 ? "text-rose-600" : diff > 0.01 ? "text-blue-600" : "text-slate-800")}>
                                                {diff > 0.01 ? '+' : ''}{symbol}{formatCurrency(diff)}
                                            </span>
                                        </div>
                                    );
                                })}
                                
                                <div className={cn(
                                    "p-3.5 rounded-xl mt-2 flex flex-col items-center justify-center space-y-0.5 border transition-colors",
                                    totalDifference < -0.01
                                        ? "bg-rose-50/80 border-rose-200 text-rose-700"
                                        : totalDifference > 0.01
                                            ? "bg-blue-50/80 border-blue-200 text-blue-700"
                                            : "bg-emerald-50/80 border-emerald-200 text-emerald-700"
                                )}>
                                    <span className="text-[11px] font-medium opacity-80">Diferencia total ($)</span>
                                    <p className="text-2xl font-semibold tabular-nums">
                                        {totalDifference > 0.01 ? '+' : ''}${formatCurrency(totalDifference)}
                                    </p>
                                    <p className="text-[11px] font-medium">
                                        {totalDifference < -0.01 ? "Faltante detectado" : totalDifference > 0.01 ? "Sobrante detectado" : "Caja cuadrada perfecta"}
                                    </p>
                                </div>
                            </div>

                            {/* En móvil arranca plegada; en escritorio siempre visible. */}
                            <div className="rounded-xl border border-amber-200/80 bg-amber-50/60">
                                <button
                                    type="button"
                                    onClick={() => setShowGuide((prev) => !prev)}
                                    aria-expanded={showGuide}
                                    className="flex w-full items-center gap-2 p-3 text-left text-xs font-medium text-amber-900 md:cursor-default"
                                >
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                    <span className="flex-1">Guía rápida de saldos</span>
                                    <span className="text-[11px] font-medium text-amber-700 md:hidden">
                                        {showGuide ? "Ocultar" : "Ver"}
                                    </span>
                                </button>
                                <div
                                    className={cn(
                                        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none md:grid-rows-[1fr] md:opacity-100 md:pointer-events-auto",
                                        showGuide ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                                    )}
                                >
                                    <div className="overflow-hidden">
                                        <div className="px-3 pb-3 text-[11px] leading-relaxed text-amber-900/90 space-y-1">
                                            <p><span className="font-semibold text-emerald-700">Positivo (+):</span> tienes más dinero físico del que el sistema registró (sobrante).</p>
                                            <p><span className="font-semibold text-rose-700">Negativo (-):</span> tienes menos dinero físico del esperado (faltante).</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-row items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-6 sm:py-3">
                    <Button variant="outline" onClick={() => setIsOpen(false)} className="h-10 sm:h-9 flex-1 sm:flex-none rounded-xl sm:rounded-lg border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        Continuar vendiendo
                    </Button>
                    <Button onClick={handleCloseDay} disabled={isClosing} className="h-10 sm:h-9 flex-1 sm:flex-none rounded-xl sm:rounded-lg bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-5 text-xs font-medium text-white shadow-sm">
                        {isClosing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                        Procesar cierre ahora
                    </Button>
                </div>
            </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
