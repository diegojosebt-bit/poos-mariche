"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Product } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ArrowUpDown, MoreHorizontal, Pencil, Trash2, TicketPercent, Layers, Lock, Percent, Clock, AlertTriangle, Landmark, Barcode } from "lucide-react"
import { Badge } from "../ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useCurrency } from "@/hooks/use-currency"
import { useFirebase, deleteDocumentNonBlocking } from "@/firebase"
import { doc } from "firebase/firestore"
import { AdminAuthDialog } from "../admin-auth-dialog"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Checkbox } from "../ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"
import { differenceInDays, parseISO } from "date-fns"
import { getAvailableStock, formatCategoryName } from "@/lib/inventory-utils"

export const ActionsCell = ({ product, table }: { product: Product, table: any }) => {    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // Piezas apartadas en reparaciones: borrar el producto dejaría esas
    // órdenes sin poder descontar stock (y atasca la cola offline).
    const reservedUnits = Number(product.reservedStock) || 0;
    const isReservedElsewhere = reservedUnits > 0;

    const handleDelete = async () => {
        if (!firestore || !user || !product.id) return;

        if (isReservedElsewhere) {
            toast({
                variant: "destructive",
                title: "No se puede eliminar",
                description: `${product.name} tiene ${reservedUnits} unidad(es) reservadas en reparaciones.`,
            });
            return;
        }

        const productRef = doc(firestore, 'users', user.uid, 'products', product.id);

        try {
            // Primero Firestore; si falla, la fila no desaparece falsamente.
            await deleteDocumentNonBlocking(productRef);

            // Limpiar la caché recién cuando el borrado fue confirmado.
            const mutate = (table.options.meta as any)?.mutate;
            if (mutate) {
                mutate((prev: any) => prev?.filter((p: any) => p.id !== product.id) || null);
            }

            toast({
                title: "Producto Eliminado",
                description: `${product.name} ha sido eliminado del inventario.`,
                variant: "destructive"
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error al eliminar",
                description: "No se pudo eliminar el producto. Intenta de nuevo.",
            });
        } finally {
            setIsDeleteDialogOpen(false);
        }
    }
    
    const handleTriggerEdit = () => {
        (table.options.meta as any)?.onEditProduct?.(product);
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 rounded-lg p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                    <span className="sr-only">Abrir menú</span>
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 rounded-xl border-slate-200 bg-white p-1.5 shadow-xl">
                    <DropdownMenuLabel className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Acciones
                    </DropdownMenuLabel>
                    
                    <AdminAuthDialog actionType="editProducts" onAuthorized={handleTriggerEdit}>
                        <DropdownMenuItem
                            onSelect={(e) => { e.preventDefault(); }}
                            className="cursor-pointer rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 focus:bg-slate-100 focus:text-slate-900"
                        >
                            <Pencil className="mr-2 h-3.5 w-3.5 text-blue-600" />
                            Editar / Ajustar Stock
                        </DropdownMenuItem>
                    </AdminAuthDialog>
                    
                    <DropdownMenuSeparator className="my-1 bg-slate-100" />
                    <AdminAuthDialog actionType="deleteProducts" onAuthorized={() => setIsDeleteDialogOpen(true)}>
                        <DropdownMenuItem
                            className="cursor-pointer rounded-lg px-2.5 py-2 text-xs font-medium text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                            onSelect={(e) => { e.preventDefault(); }}
                        >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Eliminar
                            {isReservedElsewhere && <Lock className="ml-auto h-3.5 w-3.5 text-amber-600" />}
                        </DropdownMenuItem>
                    </AdminAuthDialog>
                </DropdownMenuContent>
            </DropdownMenu>

             <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                 <AlertDialogContent className="rounded-2xl border-slate-200 bg-white shadow-xl">
                    <AlertDialogHeader>
                    <AlertDialogTitle className="text-base font-semibold text-slate-900">
                        {isReservedElsewhere ? 'Producto con piezas reservadas' : '¿Estás seguro?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm text-slate-500">
                        {isReservedElsewhere ? (
                            <>
                                Este producto tiene <span className="font-semibold text-slate-700">{reservedUnits} unidad(es) reservadas</span> en
                                reparaciones. Si lo eliminas, esas órdenes no podrán descontar el stock al entregarse
                                (es justo lo que atasca la cola offline).
                            </>
                        ) : (
                            <>
                                Esta acción no se puede deshacer. Esto eliminará permanentemente el producto
                                <span className="font-semibold text-slate-800"> {product.name}</span>.
                            </>
                        )}
                    </AlertDialogDescription>
                    </AlertDialogHeader>

                    {isReservedElsewhere && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-800">
                            <p className="font-semibold">Cómo liberarlo</p>
                            <p className="mt-1">
                                Entrega o elimina las reparaciones que usan esta pieza, o ajusta el campo
                                <b> Reservado</b> a 0 desde la edición del producto.
                            </p>
                        </div>
                    )}

                    <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl border-slate-200 text-slate-700">Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        disabled={isReservedElsewhere}
                        className="rounded-xl bg-rose-600 text-white hover:bg-rose-500 font-medium"
                    >
                        Eliminar
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
             </AlertDialog>
        </>
    )
}

export const columns: ColumnDef<Product>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Seleccionar todo"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Seleccionar fila"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: "age",
    header: () => <div className="text-center">Antigüedad</div>,
    cell: ({ row, table }) => {
        const product = row.original;
        const showAging = (table.options.meta as any)?.showAging;
        
        if (!showAging) return null;
        if (!product.createdAt) return <div className="text-center text-slate-400 text-xs">N/A</div>;
        
        const days = differenceInDays(new Date(), parseISO(product.createdAt));
        
        let colorClass = "bg-emerald-50 text-emerald-700 border-emerald-200/80";
        let label = "Nuevo";
        let Icon = Clock;

        if (days > 30) {
            colorClass = "bg-rose-50 text-rose-700 border-rose-200/80";
            label = "Estancado";
            Icon = AlertTriangle;
        } else if (days > 15) {
            colorClass = "bg-amber-50 text-amber-700 border-amber-200/80";
            label = "Rotación Lenta";
        }

        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className={cn("inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium cursor-help mx-auto", colorClass)}>
                            <Icon className="w-3 h-3" />
                            <span className="tabular-nums">{days === 0 ? 'Hoy' : `${days}d`}</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="rounded-xl border-slate-200 bg-white text-slate-800 shadow-lg text-center">
                        <p className="font-semibold text-xs">{label}</p>
                        <p className="text-[11px] text-slate-500">Ingresó al almacén hace {days} días.</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
  },
  {
    accessorKey: "sku",
    header: "ID / Código",
    cell: ({ row }) => {
        const p = row.original;
        return (
            <div className="flex flex-col gap-1">
                <span className="font-mono text-xs font-medium text-slate-700">{p.sku}</span>
                {p.barcode && (
                    <div className="inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md w-fit font-mono">
                        <Barcode className="w-3 h-3 text-slate-400" />
                        <span>{p.barcode}</span>
                    </div>
                )}
            </div>
        )
    }
  },
  {
    accessorKey: "name",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="-ml-2 h-8 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          Nombre
          <ArrowUpDown className="ml-1.5 h-3.5 w-3.5 text-slate-400" />
        </Button>
      )
    },
    cell: ({ row, table }) => {
        const product = row.original;
        const compatibleModels = product.compatibleModels || [];
        const showRepairs = (table.options.meta as any)?.showRepairs ?? true;

        return (
            <div className="max-w-xs">
                <div className="font-medium text-sm text-slate-800 flex items-center gap-1.5">
                    <span className="truncate">{product.name}</span>
                    {product.isCombo && <span title="Combo" className="text-indigo-500"><Layers className="h-3.5 w-3.5" /></span>}
                    {product.isFixedPrice && <span title="Precio Fijo" className="text-amber-500"><Lock className="h-3.5 w-3.5" /></span>}
                    {product.hasCustomMargin && !product.isFixedPrice && <span title={`Margen Indiv: ${product.customMargin}%`} className="text-blue-500"><Percent className="h-3.5 w-3.5" /></span>}
                    {product.hasIVA && <span title="Aplica IVA (16%)" className="text-emerald-600"><Landmark className="h-3.5 w-3.5" /></span>}
                </div>
                {showRepairs && compatibleModels.length > 0 && (
                    <div className="mt-0.5 text-xs font-normal text-slate-500 truncate" title={compatibleModels.join(', ')}>
                        {compatibleModels.join(', ')}
                    </div>
                )}
            </div>
        )
    }
  },
  {
    accessorKey: "category",
    header: "Categoría",
    cell: ({ row }) => {
        const category = formatCategoryName(row.original.category);
        return category ? (
            <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-100/80 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                {category}
            </span>
        ) : (
            <span className="text-xs text-slate-400">—</span>
        );
    },
  },
  {
    accessorKey: "stockLevel",
    header: ({ column }) => (
        <div className="text-center">
            <Button
                variant="ghost"
                size="sm"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                className="h-8 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
                Total Físico
                <ArrowUpDown className="ml-1.5 h-3.5 w-3.5 text-slate-400" />
            </Button>
        </div>
    ),
    cell: ({ row }) => {
        const product = row.original;
        const stock = product.stockLevel || 0;
        const unitLabel = product.unit && product.unit !== 'unit' ? ` ${product.unit}` : '';
        
        if (product.isCombo) return <div className="text-center"><Badge variant="outline" className="rounded-full border-indigo-200 bg-indigo-50 text-indigo-700 font-medium text-xs">Combo</Badge></div>
        return (
            <div className="text-center">
                <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-700">
                    {stock}{unitLabel}
                </span>
            </div>
        );
    }
  },
  {
    id: 'availableStock',
    header: () => <div className="text-center text-blue-600">Disponible</div>,
    cell: ({ row, table }) => {
      const product = row.original;
      const allProducts = (table.options.meta as { allProducts: Product[] })?.allProducts || [];
      const showRepairs = (table.options.meta as any)?.showRepairs ?? true;
      const unitLabel = product.unit && product.unit !== 'unit' ? ` ${product.unit}` : '';

      const availableStock = getAvailableStock(product, allProducts);
      
      const threshold = product.lowStockThreshold || 1;
      let badgeStyle = "border-emerald-200/90 bg-emerald-50 text-emerald-700";
      
      if (availableStock <= 0) {
        badgeStyle = "border-rose-200/90 bg-rose-50 text-rose-700";
      } else if (availableStock <= threshold) {
        badgeStyle = "border-amber-200/90 bg-amber-50 text-amber-700";
      }

      return (
        <div className="flex justify-center items-center gap-1">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className={cn("inline-flex min-w-[42px] cursor-help items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums", badgeStyle)}>
                            {availableStock}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="p-3.5 space-y-2 shadow-xl border border-slate-200 bg-white text-slate-800 rounded-xl" side="left">
                        <p className="font-semibold text-xs text-slate-900 border-b border-slate-100 pb-1.5">Desglose de Stock</p>
                        <div className="text-xs space-y-1.5">
                            <div className="flex justify-between gap-6 text-slate-600"><span>Físico en estante:</span><span className="font-semibold tabular-nums text-slate-900">{product.stockLevel || 0}{unitLabel}</span></div>
                            <div className="flex justify-between gap-6 text-amber-700">
                                <span>{showRepairs ? "En taller (Reservado):" : "Apartado / Reservado:"}</span>
                                <span className="font-semibold tabular-nums">-{product.reservedStock || 0}{unitLabel}</span>
                            </div>
                            <div className="flex justify-between gap-6 text-rose-600"><span>Dañado / Garantía:</span><span className="font-semibold tabular-nums">-{product.damagedStock || 0}{unitLabel}</span></div>
                            <div className="border-t border-slate-100 pt-1.5 flex justify-between gap-6 font-semibold text-blue-700"><span>Disponible real:</span><span className="tabular-nums">{availableStock}{unitLabel}</span></div>
                        </div>
                        {availableStock <= 0 && <p className="text-[11px] text-rose-600 font-medium pt-0.5">Bloqueado para la venta hasta reponer stock.</p>}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
      );
    }
  },
  {
    accessorKey: "costPrice",
    header: () => <div className="text-right">Costo</div>,
    cell: function Cell({ row }) {
        const { format } = useCurrency();
        const product = row.original;
        const amountUSD = parseFloat(row.getValue("costPrice"));
        const unitLabel = product.unit && product.unit !== 'unit' ? ` / ${product.unit}` : '';
        return (
          <div className="text-right">
            <div className="text-sm font-medium tabular-nums text-slate-600">${format(amountUSD)}{unitLabel}</div>
          </div>
        );
    },
  },
  {
    accessorKey: "retailPrice",
    header: () => <div className="text-right">Precio de Venta</div>,
    cell: function Cell({ row }) {
        const { format, convert, getFinalPrice } = useCurrency();
        const product = row.original;
        const unitLabel = product.unit && product.unit !== 'unit' ? ` / ${product.unit}` : '';
        
        const basePrice = getFinalPrice(product);
        const promoPrice = (typeof product.promoPrice === 'number' && product.promoPrice > 0) ? product.promoPrice : 0;
        const hasPromo = promoPrice > 0;
        
        const displayPrice = hasPromo ? promoPrice : basePrice;
        const amountBs = convert(displayPrice, 'USD', 'Bs');
   
        return (
          <div className="text-right">
            <div className={cn("text-sm font-semibold tabular-nums flex items-center justify-end gap-1.5", hasPromo ? "text-emerald-700" : "text-slate-900")}>
              {product.hasIVA && <Badge variant="outline" className="text-[9px] h-4 px-1.5 rounded-full border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">IVA</Badge>}
              {product.isFixedPrice && !hasPromo && <span title="Precio Fijo"><Lock className="w-3 h-3 text-amber-500" /></span>}
              {product.hasCustomMargin && !product.isFixedPrice && !hasPromo && <span title={`Margen Individual: ${product.customMargin}%`}><Percent className="w-3 h-3 text-blue-500" /></span>}
              {hasPromo && <TicketPercent className="w-3.5 h-3.5 inline-block text-emerald-600" />}
              <span>${format(displayPrice)}{unitLabel}</span>
            </div>

            {hasPromo && basePrice !== promoPrice && (
              <div className="text-[11px] tabular-nums text-slate-400 line-through">
                Ref: ${format(basePrice)}
              </div>
            )}
            
            <div className="text-xs font-medium tabular-nums text-emerald-700/90">
              Bs {format(amountBs, 'Bs')}
            </div>
          </div>
        );
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => <ActionsCell product={row.original} table={table} />,
  },
]
