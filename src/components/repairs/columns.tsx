"use client"

import { safeJsonStringify, cleanObject } from "@/lib/json-guard"
import type { ColumnDef } from "@tanstack/react-table"
import type { RepairJob, RepairStatus, UserProfile, Product, ReservedPart, Sale } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Edit, Trash2, DollarSign, Printer, ArrowUpDown, Loader2, History, Clock, FileText, Tag, StickyNote, Lock, CheckCircle } from "lucide-react"
import { Badge } from "../ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { format, parseISO, addDays, differenceInMinutes, differenceInHours, differenceInDays } from "date-fns"
import { es } from "date-fns/locale"
import { useCurrency } from "@/hooks/use-currency"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { useFirebase, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, runTransaction, type DocumentSnapshot, collection, query, where, getDoc } from "firebase/firestore"
import { handlePrintAllTickets, handlePrintCustomerTicket, handlePrintInternalTicket, handlePrintStickerTicket } from "./repair-ticket"
import { AdminAuthDialog } from "../admin-auth-dialog"
import { useState, type ReactNode, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog"
import { useDashboardStore } from "@/contexts/dashboard-context"
import { queryCache } from "@/lib/firestore/query-cache"
import { ensureOnline } from "@/lib/offline-guard"
import { getOfflineQueue } from "@/lib/offline-sync-manager"

const repairStatuses: RepairStatus[] = ['Pendiente', 'Pagado', 'Completado', 'Garantía'];

function ServiceTimer({ createdAt, completedAt, status }: { createdAt: string, completedAt?: string, status: RepairStatus }) {
    const [duration, setDuration] = useState("");

    useEffect(() => {
        const calculateDuration = () => {
            const start = parseISO(createdAt);
            const end = (status === 'Completado' && completedAt) ? parseISO(completedAt) : new Date();
            
            const days = differenceInDays(end, start);
            const hours = differenceInHours(end, start) % 24;
            const minutes = differenceInMinutes(end, start) % 60;

            let result = "";
            if (days > 0) result += `${days}d `;
            if (hours > 0 || days > 0) result += `${hours}h `;
            result += `${minutes}m`;
            
            setDuration(result);
        };

        calculateDuration();

        if (status !== 'Completado') {
            const interval = setInterval(calculateDuration, 60000);
            return () => clearInterval(interval);
        }
    }, [createdAt, completedAt, status]);

    return (
        <div className={cn(
            "flex items-center gap-1.5 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit mx-auto",
            status === 'Completado' 
                ? "bg-slate-100 text-slate-500 border-slate-200" 
                : "bg-blue-50 text-blue-600 border-blue-100 animate-pulse"
        )}>
            <Clock className="w-3 h-3" />
            {duration || "0m"}
        </div>
    );
}

function RepairHistoryDialog({ repairJob, children }: { repairJob: RepairJob, children: ReactNode }) {
  const { firestore, user } = useFirebase();
  const [open, setOpen] = useState(false);
  const { format: formatCurrency } = useCurrency();
  
  const salesQuery = useMemoFirebase(() => {
    if (!firestore || !user || !repairJob.id || !open) return null;
    return query(
      collection(firestore, "users", user.uid, "sale_transactions"),
      where("repairJobId", "==", repairJob.id)
    );
  }, [firestore, user?.uid, repairJob.id, open]);

  const { data: rawSales, isLoading } = useCollection<Sale>(salesQuery);
  
  const sales = (rawSales || []).sort((a, b) => 
    (a.transactionDate || "").localeCompare(b.transactionDate || "")
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase font-black flex items-center gap-2">
            <History className="w-5 h-5 text-primary" /> Historial del Trabajo
          </DialogTitle>
          <DialogDescription className="font-bold text-slate-600">
            {repairJob.id} — {repairJob.deviceMake} {repairJob.deviceModel}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-6 max-h-[60vh] overflow-y-auto">
          <div className="relative pl-8 border-l-2 border-slate-200 ml-4 space-y-8">
            <div className="relative">
              <div className="absolute -left-[41px] top-0.5 w-5 h-5 rounded-full bg-primary border-4 border-white shadow-md" />
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase text-primary tracking-widest">Ingreso al Taller</p>
                <p className="text-xs font-bold text-slate-800">
                  {repairJob.createdAt ? format(parseISO(repairJob.createdAt), "dd/MM/yyyy — hh:mm:ss a", { locale: es }) : 'N/A'}
                </p>
              </div>
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Sincronizando cobros...</span>
                </div>
            ) : sales.length > 0 ? (
              sales.map((sale) => (
                <div key={sale.id} className="relative">
                  <div className="absolute -left-[41px] top-0.5 w-5 h-5 rounded-full bg-green-500 border-4 border-white shadow-md" />
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase text-green-600 tracking-widest">Abono / Pago Recibido</p>
                    <p className="text-xs font-bold text-slate-800">
                      {sale.transactionDate ? format(parseISO(sale.transactionDate), "dd/MM/yyyy — hh:mm:ss a", { locale: es }) : 'N/A'}
                    </p>
                    <div className="flex items-center gap-2">
                        <span className="text-base font-black text-slate-900">${formatCurrency(sale.actualPaidAmount || sale.totalAmount)}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : null}

            {repairJob.completedAt && (
                <div className="relative">
                    <div className="absolute -left-[41px] top-0.5 w-5 h-5 rounded-full bg-blue-600 border-4 border-white shadow-md" />
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Trabajo Finalizado</p>
                        <p className="text-xs font-bold text-slate-800">
                            {format(parseISO(repairJob.completedAt), "dd/MM/yyyy — hh:mm:ss a", { locale: es })}
                        </p>
                    </div>
                </div>
            )}
          </div>
        </div>

        <DialogFooter className="bg-slate-50 -mx-6 -mb-6 p-6 border-t">
            <div className="w-full flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-tighter">Acumulado Abonado</span>
                <span className="text-2xl font-black text-green-600">${formatCurrency(repairJob.amountPaid || 0)}</span>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ActionsCell = ({ repairJob, table }: { repairJob: RepairJob, table: any }) => {
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const { removeCachedItem, updateCachedItem, profile } = useDashboardStore();
    const router = useRouter();
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isDeliverDialogOpen, setIsDeliverDialogOpen] = useState(false);
    const [isDelivering, setIsDelivering] = useState(false);
    const { bcvRate, parallelRate } = useCurrency();

    const estimatedCost = Number(repairJob.estimatedCost || 0);
    const amountPaid = Number(repairJob.amountPaid || 0);
    const remainingBalance = Math.max(0, estimatedCost - amountPaid);
    const isFullyPaid = repairJob.isPaid === true || remainingBalance <= 0.009;
    const hasPendingDebt = !isFullyPaid && remainingBalance > 0.009;

    const handlePay = () => {
        // Evita un segundo pago mientras el primero sigue en la cola offline:
        // el saldo real no se puede validar sin internet.
        if (user) {
            const hasPendingPayment = getOfflineQueue(user.uid).some(
                (op) => op.payload?.repairUpdate?.repairJobId === repairJob.id,
            );
            if (hasPendingPayment) {
                toast({
                    variant: "destructive",
                    title: "Pago pendiente de sincronizar",
                    description: "Ya hay un pago offline para esta reparación. Conecta a internet para validar el saldo antes de cobrar de nuevo.",
                });
                return;
            }
        }

        const cleanJob = cleanObject({
            id: repairJob.id,
            customerName: repairJob.customerName,
            customerPhone: repairJob.customerPhone,
            customerID: repairJob.customerID,
            deviceMake: repairJob.deviceMake,
            deviceModel: repairJob.deviceModel,
            reportedIssue: repairJob.reportedIssue,
            estimatedCost: repairJob.estimatedCost,
            amountPaid: repairJob.amountPaid,
            isPaid: repairJob.isPaid,
            status: repairJob.status,
            createdAt: repairJob.createdAt,
            isPromo: repairJob.isPromo,
            reservedParts: repairJob.reservedParts,
            consumedParts: repairJob.consumedParts
        });
        const repairData = encodeURIComponent(safeJsonStringify(cleanJob));
        router.push(`/dashboard/pos?repairJob=${repairData}`);
    };

    const handleDeliverConfirm = async () => {
        if (!firestore || !user || !repairJob.id || isDelivering) return;
        if (hasPendingDebt) {
            toast({
                variant: "destructive",
                title: "Entrega Bloqueada por Deuda",
                description: `Esta reparación tiene un saldo pendiente de $${remainingBalance.toFixed(2)}. Cobra el saldo antes de entregar el equipo.`
            });
            return;
        }

        setIsDelivering(true);
        if (!ensureOnline(toast, 'Entregar equipo')) {
            setIsDelivering(false);
            return;
        }
        try {
            await runTransaction(firestore, async (transaction) => {
                const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', repairJob.id!);
                const jobSnap = await transaction.get(jobRef);
                if (!jobSnap.exists()) return;
                const jobData = jobSnap.data() as RepairJob;

                const jobRemaining = Math.max(0, Number(jobData.estimatedCost || 0) - Number(jobData.amountPaid || 0));
                if (jobRemaining > 0.009 && !jobData.isPaid) {
                    throw new Error(`Entrega bloqueada: Saldo deudor pendiente de $${jobRemaining.toFixed(2)}.`);
                }

                const reservedParts = jobData.reservedParts || [];
                const currentConsumed = jobData.consumedParts || [];

                for (const part of reservedParts) {
                    if (part.isManual) continue;
                    const pRef = doc(firestore, 'users', user.uid, 'products', part.productId);
                    const pSnap = await transaction.get(pRef);
                    if (pSnap?.exists()) {
                        const pData = pSnap.data() as Product;
                        transaction.update(pSnap.ref, {
                            stockLevel: (pData.stockLevel || 0) - part.quantity,
                            reservedStock: Math.max(0, (pData.reservedStock || 0) - part.quantity)
                        });
                    }
                }

                const completionDate = new Date();
                const updateData: Partial<RepairJob> = {
                    status: 'Completado',
                    completedAt: completionDate.toISOString(),
                    warrantyEndDate: addDays(completionDate, 4).toISOString(),
                    partsConsumed: true,
                    consumedParts: [...currentConsumed, ...reservedParts],
                    reservedParts: []
                };

                updateCachedItem(repairJob.id!, updateData);
                queryCache.patchItem(user.uid, 'repair_jobs', repairJob.id!, updateData);
                transaction.update(jobRef, updateData);
            });

            toast({ title: "Equipo Entregado con Éxito", description: "Se ha finalizado la orden y activado la garantía." });
            setIsDeliverDialogOpen(false);
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error al entregar", description: error.message });
        } finally {
            setIsDelivering(false);
        }
    };

    const handleDelete = async () => {
        if (!firestore || !repairJob.id || !user) return;
        if (!ensureOnline(toast, 'Eliminar reparación')) return;
        const jobId = repairJob.id;
        
        try {
            await runTransaction(firestore, async (transaction) => {
                const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', jobId);
                const jobSnap = await transaction.get(jobRef);
                if (!jobSnap.exists()) return;
                const data = jobSnap.data() as RepairJob;

                const reservedParts = data.reservedParts || [];
                const consumedParts = data.consumedParts || [];
                
                const productIds = Array.from(new Set([
                    ...reservedParts.map(p => p.productId),
                    ...consumedParts.map(p => p.productId)
                ])).filter(id => !id.startsWith('manual-'));

                const productSnapshots = new Map<string, DocumentSnapshot>();
                for (const pid of productIds) {
                    const productRef = doc(firestore, 'users', user.uid, 'products', pid);
                    const snap = await transaction.get(productRef);
                    productSnapshots.set(pid, snap);
                }

                for (const part of reservedParts) {
                    if (part.isManual) continue;
                    const pSnap = productSnapshots.get(part.productId);
                    if (pSnap?.exists()) {
                        const pData = pSnap.data() as Product;
                        transaction.update(pSnap.ref, { 
                            reservedStock: Math.max(0, (pData.reservedStock || 0) - part.quantity) 
                        });
                    }
                }

                for (const part of consumedParts) {
                    if (part.isManual) continue;
                    const pSnap = productSnapshots.get(part.productId);
                    if (pSnap?.exists()) {
                        const pData = pSnap.data() as Product;
                        transaction.update(pSnap.ref, { 
                            stockLevel: (pData.stockLevel || 0) + part.quantity 
                        });
                    }
                }
                
                transaction.delete(jobRef);
            });

            // Limpiar AMBAS cachés: la legacy (dataCache) y la paginada (queryCache).
            // Sin esto el documento se borra en Firestore pero la fila sigue visible.
            removeCachedItem(jobId);
            queryCache.removeItem(user.uid, 'repair_jobs', jobId);

            toast({ title: "Trabajo Eliminado", variant: "destructive" });
        } catch (error: any) {
             toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
        } finally {
            setIsDeleteDialogOpen(false);
        }
    }
    
    const onPrintAll = () => {
        handlePrintAllTickets({ repairJob, businessName: profile?.businessName, profile, bcvRate, parallelRate }, (error) => {
             toast({ variant: "destructive", title: "Error", description: error })
        });
    }

    const onPrintCustomer = () => {
        handlePrintCustomerTicket({ repairJob, businessName: profile?.businessName, profile, bcvRate, parallelRate }, (error) => {
            toast({ variant: "destructive", title: "Error", description: error })
        });
    }

    const onPrintInternal = () => {
        handlePrintInternalTicket({ repairJob, businessName: profile?.businessName, profile, bcvRate, parallelRate }, (error) => {
            toast({ variant: "destructive", title: "Error", description: error })
        });
    }

    const onPrintSticker = () => {
        handlePrintStickerTicket({ repairJob, businessName: profile?.businessName, profile, bcvRate, parallelRate }, (error) => {
            toast({ variant: "destructive", title: "Error", description: error })
        });
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Abrir menú</span>
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                    
                    {hasPendingDebt ? (
                        <DropdownMenuItem
                            onSelect={() => handlePay()}
                            className="text-amber-600 font-bold bg-amber-50/50"
                            title="La entrega se habilita al saldar la deuda"
                        >
                            <DollarSign className="mr-2 h-4 w-4" />
                            Cobrar Saldo (${remainingBalance.toFixed(2)})
                        </DropdownMenuItem>
                    ) : repairJob.status !== 'Completado' ? (
                        <DropdownMenuItem 
                            onSelect={() => setIsDeliverDialogOpen(true)} 
                            className="text-green-600 font-bold bg-green-50/50"
                        >
                            <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                            Entregar Equipo al Cliente
                        </DropdownMenuItem>
                    ) : null}

                    <RepairHistoryDialog repairJob={repairJob}>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                            <History className="mr-2 h-4 w-4" />
                            Ver Historial
                        </DropdownMenuItem>
                    </RepairHistoryDialog>

                    <DropdownMenuItem onSelect={() => (table.options.meta as any)?.onEditRepair?.(repairJob)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Editar / Detalles
                    </DropdownMenuItem>
                    
                    <DropdownMenuSeparator />

                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <Printer className="mr-2 h-4 w-4 text-primary" />
                            Imprimir
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem onSelect={() => onPrintAll()}>
                                <Printer className="mr-2 h-4 w-4 text-primary" />
                                Imprimir todo (3)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => onPrintCustomer()}>
                                <FileText className="mr-2 h-4 w-4 opacity-70" />
                                Nota de entrega
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onPrintInternal()}>
                                <StickyNote className="mr-2 h-4 w-4 opacity-70" />
                                Control interno
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onPrintSticker()}>
                                <Tag className="mr-2 h-4 w-4 opacity-70" />
                                Etiqueta de equipo
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    <DropdownMenuSeparator />
                    <AdminAuthDialog actionType="deleteRepairs" onAuthorized={() => setIsDeleteDialogOpen(true)}>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => { e.preventDefault(); }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                        </DropdownMenuItem>
                    </AdminAuthDialog>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Modal de confirmación de entrega segura */}
            <AlertDialog open={isDeliverDialogOpen} onOpenChange={setIsDeliverDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-green-700">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            ¿Entregar equipo al cliente?
                        </AlertDialogTitle>
                        <p className="text-sm text-muted-foreground">
                            Esta orden se encuentra <strong>totalmente saldada</strong> ($0.00 de deuda). Al confirmar la entrega:
                        </p>
                        <ul className="text-xs space-y-1 list-disc pl-5 text-muted-foreground pt-1">
                            <li>El estado pasará a <strong>ENTREGADO (Completado)</strong>.</li>
                            <li>Se descontarán definitivamente los repuestos utilizados del inventario.</li>
                            <li>Se activará la garantía de entrega para el cliente.</li>
                        </ul>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDelivering}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeliverConfirm} disabled={isDelivering} className="bg-green-600 hover:bg-green-700 text-white font-bold">
                            {isDelivering ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Confirmar Entrega
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar este trabajo?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

const StatusCell = ({ repairJob, table }: { repairJob: RepairJob, table: any }) => {
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const { updateCachedItem } = useDashboardStore();
    const [isUpdating, setIsUpdating] = useState(false);

    const estimatedCost = Number(repairJob.estimatedCost || 0);
    const amountPaid = Number(repairJob.amountPaid || 0);
    const remainingBalance = Math.max(0, estimatedCost - amountPaid);
    const isFullyPaid = repairJob.isPaid === true || remainingBalance <= 0.009;
    const hasPendingDebt = !isFullyPaid && remainingBalance > 0.009;

    const handleStatusChange = async (newStatus: RepairStatus) => {
        if (!firestore || !user || !repairJob.id || repairJob.status === 'Completado' || isUpdating) return;

        // Guardia de interfaz: Bloqueo de entrega si hay deuda
        if (newStatus === 'Completado' && hasPendingDebt) {
            toast({
                variant: "destructive",
                title: "Entrega Bloqueada por Deuda",
                description: `No se puede entregar el equipo. Esta reparación tiene un saldo pendiente de $${remainingBalance.toFixed(2)}. Cobra el saldo antes de marcar como completado.`
            });
            return;
        }
        
        setIsUpdating(true);
        if (!ensureOnline(toast, 'Actualizar estado de reparación')) {
            setIsUpdating(false);
            return;
        }
        try {
            await runTransaction(firestore, async (transaction) => {
                const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', repairJob.id!);
                const jobSnap = await transaction.get(jobRef);
                if (!jobSnap.exists()) return;
                const jobData = jobSnap.data() as RepairJob;

                // Verificación atómica en base de datos
                if (newStatus === 'Completado') {
                    const dbEstimated = Number(jobData.estimatedCost || 0);
                    const dbPaid = Number(jobData.amountPaid || 0);
                    const dbRemaining = Math.max(0, dbEstimated - dbPaid);
                    if (dbRemaining > 0.009 && !jobData.isPaid) {
                        throw new Error(`Entrega bloqueada: Saldo pendiente de $${dbRemaining.toFixed(2)}. Debes cobrar el saldo antes de entregar.`);
                    }
                }

                const reservedParts = jobData.reservedParts || [];
                const currentConsumed = jobData.consumedParts || [];

                const productSnapshots = new Map<string, DocumentSnapshot>();
                if (newStatus === 'Completado') {
                    for (const part of reservedParts) {
                        if (part.isManual) continue;
                        const pRef = doc(firestore, 'users', user.uid, 'products', part.productId);
                        productSnapshots.set(part.productId, await transaction.get(pRef));
                    }
                }

                let updateData: Partial<RepairJob> = { status: newStatus };

                if (newStatus === 'Completado') {
                    for (const part of reservedParts) {
                        if (part.isManual) continue;
                        const pSnap = productSnapshots.get(part.productId);
                        if (pSnap?.exists()) {
                            const pData = pSnap.data() as Product;
                            transaction.update(pSnap.ref, {
                                stockLevel: (pData.stockLevel || 0) - part.quantity,
                                reservedStock: Math.max(0, (pData.reservedStock || 0) - part.quantity)
                            });
                        }
                    }
                    
                    const completionDate = new Date();
                    updateData.completedAt = completionDate.toISOString();
                    updateData.warrantyEndDate = addDays(completionDate, 4).toISOString();
                    updateData.partsConsumed = true;
                    updateData.consumedParts = [...currentConsumed, ...reservedParts];
                    updateData.reservedParts = [];
                }

                // ACTUALIZACIÓN GLOBAL INSTANTÁNEA (0ms)
                updateCachedItem(repairJob.id!, updateData);
                queryCache.patchItem(user.uid, 'repair_jobs', repairJob.id!, updateData);

                transaction.update(jobRef, updateData);
            });

            toast({ title: newStatus === 'Completado' ? 'Equipo Entregado y Finalizado' : 'Estado Actualizado' });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e.message });
        } finally {
            setIsUpdating(false);
        }
    }

    const status: RepairStatus = repairJob.status;
    let badgeVariant: "default" | "secondary" | "destructive" | "outline" = 'secondary';
    let badgeClassName = '';

    if (status === 'Completado') {
        badgeVariant = 'secondary';
        badgeClassName = 'bg-green-500 text-white hover:bg-green-600';
    } else if (status === 'Pagado') {
        badgeVariant = 'default';
        badgeClassName = 'bg-blue-500 text-white hover:bg-blue-600';
    } else if (status === 'Garantía') {
        badgeVariant = 'destructive';
        badgeClassName = 'bg-orange-600 text-white animate-pulse';
    } else { 
        badgeVariant = 'destructive';
    }
    
    if (status === 'Completado') {
        return (
            <div className="flex flex-col items-center gap-1">
                <Badge variant={badgeVariant} className={cn(badgeClassName)}>ENTREGADO</Badge>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1 items-start">
            <div className="flex items-center gap-2">
                {isUpdating && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                <Select value={repairJob.status} onValueChange={handleStatusChange} disabled={repairJob.status === 'Completado' || isUpdating}>
                    <SelectTrigger className="w-auto min-w-[120px] border-0 bg-transparent shadow-none focus:ring-0 p-0 h-auto">
                        <SelectValue asChild>
                             <Badge variant={badgeVariant} className={cn(badgeClassName, "cursor-pointer")}>{repairJob.status}</Badge>
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        {repairStatuses.map(s => {
                            const isOptionDisabled = s === 'Completado' && hasPendingDebt;
                            return (
                                <SelectItem 
                                    key={s} 
                                    value={s}
                                    disabled={isOptionDisabled}
                                    className={isOptionDisabled ? "opacity-60 cursor-not-allowed" : ""}
                                >
                                    <div className="flex items-center gap-1.5">
                                        {s === 'Completado' && hasPendingDebt ? (
                                            <>
                                                <Lock className="w-3 h-3 text-destructive shrink-0" />
                                                <span className="text-destructive font-medium">Completado (Debe ${remainingBalance.toFixed(2)})</span>
                                            </>
                                        ) : (
                                            <span>{s}</span>
                                        )}
                                    </div>
                                </SelectItem>
                            );
                        })}
                    </SelectContent>
                </Select>
            </div>
            {hasPendingDebt && (
                <div className="flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200" title="Entrega bloqueada hasta saldar deuda">
                    <Lock className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                    <span>Debe ${remainingBalance.toFixed(2)}</span>
                </div>
            )}
        </div>
    )
}

export const columns: ColumnDef<RepairJob>[] = [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => <div className="font-mono text-[10px] text-muted-foreground">{row.original.id}</div>,
  },
  {
    accessorKey: "customerName",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Cliente
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => <div className="font-medium uppercase text-xs">{row.getValue("customerName")}</div>
  },
  {
    accessorKey: "device",
    header: "Dispositivo",
    cell: ({ row }) => <span className="uppercase text-xs">{row.original.deviceMake} {row.original.deviceModel}</span>,
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ row, table }) => <StatusCell repairJob={row.original} table={table} />,
  },
  {
    id: "timer",
    header: () => <div className="text-center">Duración</div>,
    cell: ({ row }) => (
        <ServiceTimer 
            createdAt={row.original.createdAt} 
            completedAt={row.original.completedAt} 
            status={row.original.status} 
        />
    )
  },
  {
    accessorKey: "estimatedCost",
    header: () => <div className="text-right">Total</div>,
    cell: function Cell({ row }) {
      const { format, getSymbol } = useCurrency();
      const amount = parseFloat(row.getValue("estimatedCost"))
      return <div className="text-right font-black text-xs">{getSymbol()}{format(amount)}</div>
    },
  },
   {
    accessorKey: "amountPaid",
    header: () => <div className="text-right">Pagado</div>,
    cell: function Cell({ row }) {
      const { format, getSymbol } = useCurrency();
      const amount = parseFloat(String(row.getValue("amountPaid") || 0))
      return <div className="text-right font-medium text-green-600 text-xs">{getSymbol()}{format(amount)}</div>
    },
  },
  {
    id: "remainingBalance",
    header: () => <div className="text-right">Saldo Deudor</div>,
    cell: function Cell({ row }) {
      const { format, getSymbol } = useCurrency();
      const estimated = parseFloat(String(row.original.estimatedCost || 0));
      const paid = parseFloat(String(row.original.amountPaid || 0));
      const debt = Math.max(0, estimated - paid);
      const isPaid = row.original.isPaid || debt <= 0.009;

      if (isPaid || debt <= 0.009) {
        return (
          <div className="text-right">
            <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 font-semibold">
              $0.00 Al día
            </Badge>
          </div>
        );
      }

      return (
        <div className="text-right flex items-center justify-end gap-1">
          <Lock className="w-3 h-3 text-destructive" />
          <span className="font-bold text-destructive text-xs">
            {getSymbol()}{format(debt)}
          </span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => <ActionsCell repairJob={row.original} table={table} />,
  },
]
