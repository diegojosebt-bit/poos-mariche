"use client";

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
        
        const itemsParam = encodeURIComponent(JSON.stringify(sale.items));
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
        <Button variant="outline">
          <FolderClock className="mr-2 h-4 w-4" />
          Ventas en Espera ({heldSales.length})
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Ventas en Espera</SheetTitle>
          <SheetDescription>
            Aquí están las ventas que has aparcado. Puedes restaurarlas o eliminarlas.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-150px)]">
            <div className="py-4 space-y-4">
            {heldSales.length === 0 ? (
                <p className="text-center text-muted-foreground pt-10">No hay ventas en espera.</p>
            ) : (
                heldSales.map((sale) => (
                    <div key={sale.id} className="p-4 border rounded-lg flex justify-between items-center">
                        <div>
                            <p className="font-semibold">{sale.name}</p>
                            <p className="text-sm text-muted-foreground">
                                {format(parseISO(sale.createdAt), "hh:mm a", { locale: es })}
                            </p>
                            <p className="text-xs text-muted-foreground">{sale.items.length} artículo(s)</p>
                        </div>
                        <div className="flex items-center gap-1">
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>¿Eliminar esta venta en espera?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            La venta aparcada con el nombre "{sale.name}" será eliminada permanentemente.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteSale(sale.id)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>

                             <SheetClose asChild>
                                <Button variant="outline" size="sm" onClick={() => handleRestoreSale(sale)}>
                                    Restaurar <ArrowRight className="ml-2 h-4 w-4" />
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