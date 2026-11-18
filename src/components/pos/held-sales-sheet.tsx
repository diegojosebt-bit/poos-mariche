"use client";

import { safeJsonStringify, cleanObject } from "@/lib/json-guard";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose
} from "@/components/ui/sheet";
import { FolderClock, Trash2, ArrowRight } from "lucide-react";
import type { HeldSale } from "@/lib/types";
import { ScrollArea } from "../ui/scroll-area";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useFirebase, deleteDocumentNonBlocking } from "@/firebase";
import { doc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDashboardStore } from "@/contexts/dashboard-context";

type HeldSalesSheetProps = {
  heldSales: HeldSale[];
};

export function HeldSalesSheet({ heldSales }: HeldSalesSheetProps) {
    const { firestore, user } = useFirebase();
    const { removeCachedItem } = useDashboardStore();
    const router = useRouter();

    const handleRestoreSale = (sale: HeldSale) => {
        // Al restaurar, removemos de la lista global de espera (0ms)
        removeCachedItem(sale.id);
        
        const cleanItems = cleanObject(sale.items || []);
        const itemsParam = encodeURIComponent(safeJsonStringify(cleanItems));
        router.push(`/dashboard/pos?restoredSaleId=${sale.id}&items=${itemsParam}`);
    };
    
    const handleDeleteSale = (saleId: string) => {
        if (!firestore || !user) return;
        
        // ELIMINACIÓN ATÓMICA EN MEMORIA GLOBAL (0ms)
        removeCachedItem(saleId);

        const saleRef = doc(firestore, 'users', user.uid, 'held_sales', saleId);
        deleteDocumentNonBlocking(saleRef);
    };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="relative h-8 md:h-9 px-2.5 md:px-3.5 rounded-full border-slate-200/90 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-2xs transition-all flex items-center gap-1.5"
          aria-label={`Ventas en espera (${heldSales.length})`}
          title={`Ventas en espera (${heldSales.length})`}
        >
          <FolderClock className="h-3.5 w-3.5 text-blue-600 shrink-0" />
          <span className="hidden lg:inline font-medium text-xs">En Espera</span>
          {heldSales.length > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-medium text-white">
              {heldSales.length}
            </span>
          ) : (
            <span className="hidden lg:inline text-[11px] font-normal text-slate-400">(0)</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-white border-slate-200 text-slate-900 shadow-xl">
        <SheetHeader>
          <SheetTitle className="text-slate-900 font-bold">Ventas en Espera</SheetTitle>
          <SheetDescription className="text-slate-500 text-xs">
            Aquí están las ventas que has aparcado. Puedes restaurarlas o eliminarlas.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-150px)]">
            <div className="py-4 space-y-3">
            {heldSales.length === 0 ? (
                <p className="text-center text-slate-400 pt-10 text-xs">No hay ventas en espera.</p>
            ) : (
                heldSales.map((sale) => (
                    <div key={sale.id} className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70 flex justify-between items-center hover:bg-slate-100/60 transition-colors shadow-2xs">
                        <div>
                            <p className="font-bold text-sm text-slate-900">{sale.name}</p>
                            <p className="text-xs text-slate-500">
                                {format(parseISO(sale.createdAt), "hh:mm a", { locale: es })}
                            </p>
                            <p className="text-[11px] text-blue-600 font-semibold">{sale.items.length} artículo(s)</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="bg-white border-slate-200 text-slate-900 shadow-xl">
                                    <AlertDialogHeader>
                                        <AlertDialogTitle className="text-slate-900 font-bold">¿Eliminar esta venta en espera?</AlertDialogTitle>
                                        <AlertDialogDescription className="text-slate-500 text-xs">
                                            La venta aparcada con el nombre "{sale.name}" será eliminada permanentemente.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel className="border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50">Cancelar</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteSale(sale.id)} className="bg-rose-600 hover:bg-rose-500 text-white font-bold">Eliminar</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>

                             <SheetClose asChild>
                                <Button variant="outline" size="sm" className="h-8 rounded-lg border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 font-bold text-xs shadow-2xs" onClick={() => handleRestoreSale(sale)}>
                                    Restaurar <ArrowRight className="ml-1.5 h-3.5 w-3.5 text-blue-600" />
                                </Button>
                             </SheetClose>
                        </div>
                    </div>
                ))
            )}
            </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}