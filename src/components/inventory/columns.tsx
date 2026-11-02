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
import { ArrowUpDown, MoreHorizontal, Edit, Trash2, TicketPercent, PackagePlus, Lock, Percent, Info, Clock, AlertTriangle, Landmark, PlusCircle, Barcode } from "lucide-react"
import { Badge } from "../ui/badge"
import { ProductFormDialog } from "./product-form-dialog"
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

const ActionsCell = ({ product, table }: { product: Product, table: any }) => {
    const { toast } = useToast();
    const { firestore, user } = useFirebase();
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    const handleDelete = () => {
        if (!firestore || !user || !product.id) return;
        
        // OPTIMISTIC DELETE
        const mutate = (table.options.meta as any)?.mutate;
        if (mutate) {
            mutate((prev: any) => prev?.filter((p: any) => p.id !== product.id) || null);
        }

        const productRef = doc(firestore, 'users', user.uid, 'products', product.id);
        deleteDocumentNonBlocking(productRef);
        toast({
            title: "Producto Eliminado",
            description: `${product.name} ha sido eliminado del inventario.`,
            variant: "destructive"
        })
        setIsDeleteDialogOpen(false);
    }
    
    const handleTriggerEdit = () => {
        document.getElementById(`edit-trigger-${product.id}`)?.click();
    }

    const handleOptimisticUpdate = (updatedProduct: Product) => {
        const mutate = (table.options.meta as any)?.mutate;
        if (mutate) {
            mutate((prev: any) => prev?.map((p: any) => p.id === updatedProduct.id ? updatedProduct : p) || null);
        }
    };

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
                    
                    <AdminAuthDialog onAuthorized={handleTriggerEdit}>
                        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); }}>
                            <Edit className="mr-2 h-4 w-4" />
                            Editar / Ajustar Stock
                        </DropdownMenuItem>
                    </AdminAuthDialog>
                    
                    <DropdownMenuSeparator />
                    <AdminAuthDialog onAuthorized={() => setIsDeleteDialogOpen(true)}>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => { e.preventDefault(); }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar permanentemente
                        </DropdownMenuItem>
                    </AdminAuthDialog>
                </DropdownMenuContent>
            </DropdownMenu>

            <ProductFormDialog product={product} onSaved={handleOptimisticUpdate}>
                <button id={`edit-trigger-${product.id}`} style={{ display: 'none' }}></button>
            </ProductFormDialog>

             <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                 <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta acción no se puede deshacer. Esto eliminará permanentemente el producto
                        <span className="font-semibold"> {product.name}</span>.
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
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
        if (!product.createdAt) return <div className="text-center text-muted-foreground text-[10px] italic">N/A</div>;
        
        const days = differenceInDays(new Date(), parseISO(product.createdAt));
        
        let colorClass = "bg-green-100 text-green-700 border-green-200";
        let label = "Nuevo";
        let Icon = Clock;

        if (days > 30) {
            colorClass = "bg-destructive/10 text-destructive border-destructive/20 animate-pulse";
            label = "Estancado";
            Icon = AlertTriangle;
        } else if (days > 15) {
            colorClass = "bg-amber-100 text-amber-700 border-amber-200";
            label = "Rotación Lenta";
        }

        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className={cn("flex flex-col items-center px-2 py-1 rounded-md border text-[10px] font-bold cursor-help", colorClass)}>
                            <div className="flex items-center gap-1">
                                <Icon className="w-3 h-3" />
                                <span>{days === 0 ? 'Hoy' : `${days} d.`}</span>
                            </div>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-center">
                        <p className="font-bold">{label}</p>
                        <p className="text-xs">Ingresó al almacén hace {days} días.</p>
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
                <span className="font-mono text-[10px] font-bold">{p.sku}</span>
                {p.barcode && (
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded w-fit">
                        <Barcode className="w-2.5 h-2.5" />
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
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Nombre
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row, table }) => {
        const product = row.original;
        const compatibleModels = product.compatibleModels || [];
        const showRepairs = (table.options.meta as any)?.showRepairs ?? true;

        return (
            <div className="max-w-xs">
                <div className="font-medium flex items-center gap-2">
                    {product.name}
                    {product.isCombo && <PackagePlus className="h-4 w-4 text-muted-foreground" title="Combo" />}
                    {product.isFixedPrice && <Lock className="h-3 w-3 text-amber-500" title="Precio Fijo" />}
                    {product.hasCustomMargin && !product.isFixedPrice && <Percent className="h-3 w-3 text-blue-500" title={`Margen Indiv: ${product.customMargin}%`} />}
                    {product.hasIVA && <Landmark className="h-3 w-3 text-green-600" title="Aplica IVA (16%)" />}
                </div>
                {showRepairs && compatibleModels.length > 0 && (
                    <div className="text-xs text-muted-foreground truncate" title={compatibleModels.join(', ')}>
                        Info Adicional: {compatibleModels.join(', ')}
                    </div>
                )}
            </div>
        )
    }
  },
  {
    accessorKey: "category",
    header: "Categoría",
  },
  {
    accessorKey: "stockLevel",
    header: ({ column }) => (
        <div className="text-center">
            <Button
                variant="ghost"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
                Total Físico
                <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        </div>
    ),
    cell: ({ row }) => {
        const product = row.original;
        const stock = product.stockLevel || 0;
        const unitLabel = product.unit && product.unit !== 'unit' ? ` ${product.unit}` : '';
        
        if (product.isCombo) return <div className="text-center"><Badge variant="outline">Combo</Badge></div>
        return (
            <div className="text-center">
                <Badge variant="secondary" className="font-bold">
                    {stock}{unitLabel}
                </Badge>
            </div>
        );
    }
  },
  {
    id: 'availableStock',
    header: () => <div className="text-center font-bold text-primary">Disponible (Venta)</div>,
    cell: ({ row, table }) => {
      const product = row.original;
      const allProducts = (table.options.meta as { allProducts: Product[] })?.allProducts || [];
      const showRepairs = (table.options.meta as any)?.showRepairs ?? true;
      const unitLabel = product.unit && product.unit !== 'unit' ? ` ${product.unit}` : '';

      let availableStock: number;
      if (product.isCombo) {
          const comboItems = product.comboItems || [];
          if (comboItems.length === 0 || allProducts.length === 0) {
              availableStock = 0;
          } else {
              availableStock = Math.min(
                  ...comboItems.map(item => {
                      const component = allProducts.find(p => p.id === item.productId);
                      if (!component) return 0;
                      const componentAvailable = (component.stockLevel || 0) - (component.reservedStock || 0) - (component.damagedStock || 0);
                      return Math.floor(componentAvailable / item.quantity);
                  })
              );
          }
      } else {
          availableStock = (product.stockLevel || 0) - (product.reservedStock || 0) - (product.damagedStock || 0);
      }
      
      const threshold = product.lowStockThreshold || 1;
      let variant: "default" | "secondary" | "destructive" | "outline" = "secondary";
      let className = "";
      
      if (availableStock <= 0) {
        variant = "destructive"
      } else if (availableStock <= threshold) {
        variant = "outline";
        className = "border-yellow-500 text-yellow-600 bg-yellow-50 font-black"
      } else {
        variant = "default";
        className = "bg-green-600 hover:bg-green-700"
      }

      return (
        <div className="flex justify-center items-center gap-1">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge variant={variant} className={cn(className, "cursor-help min-w-[40px] flex justify-center")}>
                            {availableStock}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="p-3 space-y-2 shadow-xl border-2" side="left">
                        <p className="font-black text-xs border-b pb-1">DESGLOSE DE STOCK:</p>
                        <div className="text-[10px] space-y-1">
                            <div className="flex justify-between gap-6"><span>Físico en estante:</span><span className="font-black">{product.stockLevel || 0}{unitLabel}</span></div>
                            <div className="flex justify-between gap-6 text-amber-600 font-bold">
                                <span>{showRepairs ? "En taller (Reservado):" : "Apartado / Reservado:"}</span>
                                <span className="font-black">-{product.reservedStock || 0}{unitLabel}</span>
                            </div>
                            <div className="flex justify-between gap-6 text-destructive font-bold"><span>Dañado/Garantía:</span><span className="font-black">-{product.damagedStock || 0}{unitLabel}</span></div>
                            <div className="border-t pt-1 flex justify-between gap-6 font-black text-primary text-[11px]"><span>DISPONIBLE REAL:</span><span className="font-black">{availableStock}{unitLabel}</span></div>
                        </div>
                        {availableStock <= 0 && <p className="text-[9px] text-destructive font-bold italic pt-1 animate-pulse">¡Este producto está bloqueado para la venta!</p>}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
      );
    }
  },
  {
    accessorKey: "costPrice",
    header: () => <div className="text-right">Precio de Costo</div>,
    cell: function Cell({ row }) {
        const { format } = useCurrency();
        const product = row.original;
        const amountUSD = parseFloat(row.getValue("costPrice"));
        const unitLabel = product.unit && product.unit !== 'unit' ? ` / ${product.unit}` : '';
        return (
          <div className="text-right">
            <div className="font-medium">${format(amountUSD)}{unitLabel}</div>
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
            <div className={cn("font-medium flex items-center justify-end gap-1", hasPromo && "text-green-600")}>
              {product.hasIVA && <Badge variant="outline" className="text-[8px] h-3 px-1 border-green-600 text-green-600 font-bold">IVA</Badge>}
              {product.isFixedPrice && !hasPromo && <Lock className="w-3 h-3 text-amber-500" title="Precio Fijo" />}
              {product.hasCustomMargin && !product.isFixedPrice && !hasPromo && <Percent className="w-3 h-3 text-blue-500" title={`Margen Individual: ${product.customMargin}%`} />}
              {hasPromo && <TicketPercent className="w-3 h-3 inline-block" />}
              ${format(displayPrice)}{unitLabel}
            </div>

            {hasPromo && basePrice !== promoPrice && (
              <div className="text-xs text-muted-foreground line-through">
                Ref: ${format(basePrice)}
              </div>
            )}
            
            <div className="text-xs text-muted-foreground">
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
