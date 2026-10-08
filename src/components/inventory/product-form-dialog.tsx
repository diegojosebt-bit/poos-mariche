
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Product, ComboItem, UserProfile, ProductUnit } from "@/lib/types";
import { useState, type ReactNode, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useFirebase, setDocumentNonBlocking, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { doc, collection, arrayUnion, query, limit } from "firebase/firestore";
import { Check, ChevronsUpDown, Calculator, Smartphone, Barcode, Tag, Scale, Lock, Percent, Landmark, Gift, BadgePercent, Sparkles, RefreshCcw, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "../ui/checkbox";
import { useCurrency } from "@/hooks/use-currency";

const comboItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  quantity: z.coerce.number().min(0.001, "La cantidad debe ser al menos 0.001."),
});

const formSchema = z.object({
  name: z.string().min(2, { message: "El nombre debe tener al menos 2 caracteres." }),
  category: z.string().min(2, { message: "La categoría es obligatoria." }),
  sku: z.string().min(1, { message: "El SKU o Código es obligatorio." }),
  barcode: z.string().optional().default(""),
  unit: z.enum(['unit', 'kg', 'g', 'lb', 'liter']),
  costPrice: z.coerce.number().min(0),
  isFixedPrice: z.boolean().default(false),
  fixedPrice: z.coerce.number().min(0).default(0),
  hasCustomMargin: z.boolean().default(false),
  customMargin: z.coerce.string().default("0"),
  hasDiscount: z.boolean().default(false),
  discountAmount: z.coerce.number().min(0).default(0),
  promoPrice: z.coerce.number().default(0),
  stockLevel: z.coerce.number().min(0, "El stock no puede ser negativo."),
  reservedStock: z.coerce.number().min(0, "Mínimo 0"),
  damagedStock: z.coerce.number().min(0, "Mínimo 0"),
  lowStockThreshold: z.coerce.number().min(0.001, "La alerta debe ser al menos 0.001."),
  compatibleModels: z.string().default(""),
  isCombo: z.boolean().default(false),
  comboItems: z.array(comboItemSchema).default([]),
  isGiftable: z.boolean().default(false),
  hasIVA: z.boolean().default(false),
  createdAt: z.string(),
  salesCount: z.coerce.number().default(0),
});

type ProductFormData = z.infer<typeof formSchema>;

interface ProductFormDialogProps {
    product?: Product;
    children?: ReactNode;
    productCount?: number;
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSaved?: (product: Product) => void;
}

function generateSearchKeywords(name: string, sku: string, category: string, models: string[]) {
    const keywords = new Set<string>();
    const addTerms = (text: string) => {
        if (!text) return;
        const terms = text.toLowerCase().split(/[\s,.-/]+/).filter(t => t.length > 1);
        terms.forEach(t => keywords.add(t));
        const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (clean.length > 1) keywords.add(clean);
    };
    addTerms(name);
    addTerms(sku);
    addTerms(category);
    models.forEach(m => addTerms(m));
    return Array.from(keywords);
}

export function ProductFormDialog({ product, children, productCount = 0, isOpen, onOpenChange, onSaved }: ProductFormDialogProps) {
  const { firestore, user } = useFirebase();
  const [internalOpen, setInternalOpen] = useState(false);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const { toast } = useToast();
  const { getDynamicPrice, convert, format: formatCurrency, profitMargin, bcvRate, parallelRate, getFinalPrice } = useCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const profileRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc<UserProfile>(profileRef);

  const inventorySettingsRef = useMemoFirebase(() => 
    (firestore && user) ? doc(firestore, 'users', user.uid, 'settings', 'inventory') : null,
    [firestore, user?.uid]
  );
  const { data: inventorySettings } = useDoc<any>(inventorySettingsRef);

  const categories = useMemo(() => {
    if (inventorySettings?.categories && Array.isArray(inventorySettings.categories)) {
      const list = [...inventorySettings.categories];
      if (!list.includes("GENERAL")) list.push("GENERAL");
      return list.sort();
    }
    return ["GENERAL"];
  }, [inventorySettings]);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      category: "GENERAL",
      sku: "",
      barcode: "",
      unit: "unit",
      costPrice: 0,
      isFixedPrice: false,
      fixedPrice: 0,
      hasCustomMargin: false,
      customMargin: "0",
      hasDiscount: false,
      discountAmount: 0,
      promoPrice: 0,
      stockLevel: 1,
      reservedStock: 0,
      damagedStock: 0,
      lowStockThreshold: 1,
      compatibleModels: "",
      isCombo: false,
      comboItems: [],
      isGiftable: false,
      hasIVA: false,
      createdAt: new Date().toISOString().split('T')[0],
      salesCount: 0,
    },
  });

  const costPrice = form.watch("costPrice");
  const isFixedPrice = form.watch("isFixedPrice");
  const hasCustomMargin = form.watch("hasCustomMargin");
  const customMarginValue = form.watch("customMargin");
  const hasIVA = form.watch("hasIVA");
  const hasDiscount = form.watch("hasDiscount");
  const isEditing = !!product;
  
  const showRepairsFeature = profile?.enabledModules?.includes('repairs') ?? true;

  const suggestedRetailPrice = useMemo(() => {
    let retail = getDynamicPrice(costPrice, hasCustomMargin ? Number(customMarginValue || 0) : profitMargin);
    if (hasIVA) retail = retail * 1.16;
    return parseFloat(retail.toFixed(2));
  }, [hasCustomMargin, customMarginValue, costPrice, getDynamicPrice, profitMargin, hasIVA]);

  const suggestedPromoPrice = useMemo(() => {
    const promo = costPrice > 0 ? costPrice * (1 + profitMargin / 100) : 0;
    return parseFloat(promo.toFixed(2));
  }, [costPrice, profitMargin]);

  useEffect(() => {
    if (open) {
        setIsSubmitting(false); 
        if (product) {
            form.reset({
              ...product,
              name: (product.name || "").toUpperCase(),
              category: (product.category || "").toUpperCase(),
              sku: (product.sku || "").toUpperCase(),
              customMargin: String(product.customMargin || 0),
              compatibleModels: product.compatibleModels?.join(", ").toUpperCase() || "",
            });
        } else {
            const autoSKU = `SKU-${format(new Date(), "ddMMyy-HHmm")}`;
            form.reset({
                name: "", category: "GENERAL", sku: autoSKU, barcode: "", unit: "unit",
                costPrice: 0, isFixedPrice: false, fixedPrice: 0, hasCustomMargin: false, customMargin: "0",
                hasDiscount: false, discountAmount: 0,
                promoPrice: 0, stockLevel: 1, reservedStock: 0, damagedStock: 0, lowStockThreshold: 1,
                compatibleModels: "", isCombo: false, comboItems: [], isGiftable: false, hasIVA: false,
                createdAt: new Date().toISOString().split('T')[0],
                salesCount: 0,
            });
        }
    }
  }, [product, form, open]);

  useEffect(() => {
    if (!isFixedPrice && suggestedRetailPrice > 0) {
        form.setValue("fixedPrice", suggestedRetailPrice);
    }
  }, [suggestedRetailPrice, isFixedPrice, form]);

  useEffect(() => {
    if (suggestedPromoPrice > 0) {
        form.setValue("promoPrice", suggestedPromoPrice);
    }
  }, [suggestedPromoPrice, form]);

  async function onSubmit(values: ProductFormData) {
    if (!firestore || !user || isSubmitting) return;
    setIsSubmitting(true);
    try {
        const cat = values.category.toUpperCase().trim();
        const modelsArray = values.compatibleModels ? values.compatibleModels.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
        
        const finalValues = {
            ...values,
            name: values.name.toUpperCase().trim(),
            category: cat,
            sku: values.sku.toUpperCase().trim(),
            compatibleModels: modelsArray,
            searchKeywords: generateSearchKeywords(values.name, values.sku, cat, modelsArray)
        };

        if (inventorySettingsRef) {
            await setDocumentNonBlocking(inventorySettingsRef, {
                categories: arrayUnion(cat)
            }, { merge: true });
        }

        const docId = product?.id || doc(collection(firestore, 'users', user.uid, 'products')).id;
        const productRef = doc(firestore, 'users', user.uid, 'products', docId);
        
        const finalProduct = { ...finalValues, id: docId };
        
        // CRITICAL: Await the save operation to prevent race conditions during repair registrations
        await setDocumentNonBlocking(productRef, finalProduct, { merge: true });
        
        toast({ title: isEditing ? "Producto Actualizado" : "Producto Añadido" });
        
        if (onSaved) onSaved(finalProduct as any);
        
        setIsSubmitting(false);
        setOpen(false);
    } catch (e) {
        setIsSubmitting(false);
        toast({ variant: "destructive", title: "Error", description: "No se pudo guardar el producto." });
    }
  }

  const avail = form.watch('stockLevel') - form.watch('reservedStock') - form.watch('damagedStock');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent 
        className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto flex flex-col p-0"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="p-4 sm:p-6 pb-2">
            <DialogHeader>
                <DialogTitle className="uppercase font-bold text-lg">{isEditing ? 'Gestionar Producto' : 'Añadir Producto'}</DialogTitle>
                <DialogDescription>Configura los precios y stock del inventario.</DialogDescription>
            </DialogHeader>
        </div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="px-4 sm:px-6 space-y-6 pb-6">
            <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                    <FormLabel className="text-[10px] font-bold uppercase">Nombre del Artículo</FormLabel>
                    <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} className="uppercase h-10" /></FormControl>
                    <FormMessage />
                </FormItem>
            )} />
            
            <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                    <FormItem>
                        <FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase"><Tag className="w-3" /> Categoría</FormLabel>
                        <div className="flex gap-2">
                            <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} className="uppercase h-10" /></FormControl>
                            <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                                <PopoverTrigger asChild><Button type="button" variant="outline" size="icon" className="h-10 w-10"><ChevronsUpDown className="h-4 w-4 opacity-50" /></Button></PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0" align="end">
                                    <Command><CommandInput placeholder="Buscar..." /><CommandList><CommandEmpty>Sin resultados.</CommandEmpty><CommandGroup>
                                        {categories.map((cat) => (
                                            <CommandItem key={cat} value={cat} onSelect={() => { form.setValue("category", cat.toUpperCase()); setCategoryPopoverOpen(false); }}>
                                                <Check className={cn("mr-2 h-4 w-4", cat.toUpperCase() === field.value.toUpperCase() ? "opacity-100" : "opacity-0")} />
                                                {cat.toUpperCase()}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup></CommandList></Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </FormItem>
                )} />
                <FormField control={form.control} name="unit" render={({ field }) => (
                    <FormItem>
                        <FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase"><Scale className="w-3" /> Unidad</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger className="h-10"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent><SelectItem value="unit">Unidad (pza)</SelectItem><SelectItem value="kg">Kilos (kg)</SelectItem><SelectItem value="g">Gramos (g)</SelectItem><SelectItem value="liter">Litros (L)</SelectItem></SelectContent>
                        </Select>
                    </FormItem>
                )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="sku" render={({ field }) => (
                    <FormItem><FormLabel className="text-[10px] font-bold uppercase">SKU / Código</FormLabel><FormControl><Input {...field} className="uppercase font-mono h-10" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="barcode" render={({ field }) => (
                    <FormItem><FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase"><Barcode className="w-3" /> Barra</FormLabel><FormControl><Input {...field} className="h-10" /></FormControl></FormItem>
                )} />
            </div>

            {showRepairsFeature && (
                <FormField control={form.control} name="compatibleModels" render={({ field }) => (
                    <FormItem><FormLabel className="flex items-center gap-2 text-[10px] font-bold uppercase"><Smartphone className="w-3" /> Modelos</FormLabel><FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} className="uppercase h-10" /></FormControl></FormItem>
                )} />
            )}

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase border-b pb-1"><Calculator className="w-3" /> Estrategia de Precios</div>
                <div className="flex flex-wrap gap-3 bg-muted/20 p-3 rounded-lg border">
                    <FormField control={form.control} name="hasCustomMargin" render={({ field }) => (
                        <FormItem className="flex items-center space-x-1.5 space-y-0">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="font-bold cursor-pointer text-[10px] uppercase flex items-center gap-1"><Percent className="w-3 h-3 text-blue-500" /> Margen %</FormLabel>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="hasDiscount" render={({ field }) => (
                        <FormItem className="flex items-center space-x-1.5 space-y-0">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="font-bold cursor-pointer text-[10px] uppercase flex items-center gap-1"><BadgePercent className="w-3 h-3 text-amber-500" /> Desc.</FormLabel>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="hasIVA" render={({ field }) => (
                        <FormItem className="flex items-center space-x-1.5 space-y-0">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="font-bold cursor-pointer text-[10px] uppercase flex items-center gap-1"><Landmark className="w-3 h-3 text-green-600" /> IVA</FormLabel>
                        </FormItem>
                    )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="costPrice" render={({ field }) => (
                        <FormItem><FormLabel className="text-[10px] font-bold uppercase">Costo ($)</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="h-10" /></FormControl></FormItem>
                    )} />
                    {hasCustomMargin && (
                        <FormField control={form.control} name="customMargin" render={({ field }) => (
                            <FormItem><FormLabel className="text-[10px] font-bold text-blue-600 uppercase">Margen (%)</FormLabel><FormControl><Input type="number" {...field} className="h-10 border-blue-200" /></FormControl></FormItem>
                        )} />
                    )}
                    {hasDiscount && (
                        <FormField control={form.control} name="discountAmount" render={({ field }) => (
                            <FormItem><FormLabel className="text-[10px] font-bold text-amber-600 uppercase">Monto Descuento ($)</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="h-10 border-amber-200" /></FormControl></FormItem>
                        )} />
                    )}
                </div>

                <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3 shadow-lg">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="border-r border-white/10 pr-2">
                            <FormField control={form.control} name="fixedPrice" render={({ field }) => (
                                <FormItem className="space-y-0.5">
                                    <FormLabel className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter flex items-center justify-between">
                                        <span>Venta Sugerido (BCV)</span>
                                        <button 
                                            type="button" 
                                            onClick={() => form.setValue('isFixedPrice', false)}
                                            className={cn(
                                                "text-[7px] px-1 rounded transition-colors uppercase font-black",
                                                !isFixedPrice ? "bg-blue-50 text-white" : "bg-white/10 text-white/40 hover:bg-white/20"
                                            )}
                                        >
                                            Auto
                                        </button>
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <span className="absolute left-0 top-1 text-blue-400 font-black">$</span>
                                            <Input 
                                                type="number" 
                                                step="0.01" 
                                                {...field} 
                                                className="bg-transparent border-none text-blue-400 font-black text-xl h-8 p-0 pl-3.5 focus-visible:ring-0 focus-visible:ring-offset-0"
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    form.setValue('isFixedPrice', true);
                                                }}
                                            />
                                        </div>
                                    </FormControl>
                                    <p className="text-[10px] text-blue-300/60 uppercase font-medium">
                                        Bs {(Number(field.value || 0) * bcvRate).toFixed(2)}
                                    </p>
                                </FormItem>
                            )} />
                        </div>
                        <div className="pl-2">
                            <FormField control={form.control} name="promoPrice" render={({ field }) => (
                                <FormItem className="space-y-0.5">
                                    <FormLabel className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-1">
                                        <Sparkles className="w-2 h-2 text-green-400" /> Oferta (Editable)
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <span className="absolute left-0 top-1 text-green-400 font-black">$</span>
                                            <Input 
                                                type="number" 
                                                step="0.01" 
                                                {...field} 
                                                className="bg-transparent border-none text-green-400 font-black text-xl h-8 p-0 pl-3.5 focus-visible:ring-0 focus-visible:ring-offset-0"
                                            />
                                        </div>
                                    </FormControl>
                                    <p className="text-[10px] text-green-300/60 uppercase font-medium">
                                        Bs {(Number(field.value || 0) * parallelRate).toFixed(2)}
                                    </p>
                                </FormItem>
                            )} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-4 gap-2 p-3 rounded-lg border bg-muted/20">
                <FormField control={form.control} name="stockLevel" render={({ field }) => <FormItem className="space-y-1"><FormLabel className="text-[9px] font-bold uppercase">Físico</FormLabel><FormControl><Input type="number" {...field} className="h-8 text-xs" /></FormControl></FormItem>} />
                <FormField control={form.control} name="reservedStock" render={({ field }) => <FormItem className="space-y-1"><FormLabel className="text-[9px] font-bold uppercase text-amber-600">Reser.</FormLabel><FormControl><Input type="number" {...field} className="h-8 text-xs" /></FormControl></FormItem>} />
                <FormField control={form.control} name="lowStockThreshold" render={({ field }) => <FormItem className="space-y-1"><FormLabel className="text-[9px] font-bold uppercase text-destructive">Alerta</FormLabel><FormControl><Input type="number" {...field} className="h-8 text-xs" /></FormControl></FormItem>} />
                <div className="space-y-1"><Label className="text-[9px] font-bold uppercase text-green-600">Venta</Label><div className="h-8 flex items-center justify-center font-black text-sm text-green-700 bg-green-50 rounded border border-green-200">{avail}</div></div>
            </div>

            <DialogFooter className="pt-4">
                <Button type="submit" className="w-full h-12 font-bold uppercase shadow-lg" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Guardar Producto
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
