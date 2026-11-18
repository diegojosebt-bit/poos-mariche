
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
import { useState, type ReactNode, useEffect, useMemo, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useFirebase, setDocumentNonBlocking, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { persistDraft } from "@/contexts/draft-modals-context";
import { doc, collection, arrayUnion, query, limit } from "firebase/firestore";
import { Check, ChevronDown, Calculator, Smartphone, Barcode, Tag, Scale, Lock, Percent, Landmark, Gift, BadgePercent, Sparkles, RefreshCcw, Loader2, Minimize2, Package, PackagePlus, Boxes, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "../ui/checkbox";
import { SmoothCollapse } from "@/components/ui/smooth-collapse";
import { useCurrency } from "@/hooks/use-currency";
import { formatCategoryInput, formatCategoryName } from "@/lib/inventory-utils";

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
    initialDraft?: Partial<ProductFormData>;
    onMinimize?: (values: ProductFormData) => void;
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

export function ProductFormDialog({ product, children, productCount = 0, isOpen, onOpenChange, onSaved, initialDraft, onMinimize }: ProductFormDialogProps) {
  const { firestore, user } = useFirebase();
  const [internalOpen, setInternalOpen] = useState(false);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const categoryPickerRef = useRef<HTMLDivElement>(null);
  const categorySheetRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { getDynamicPrice, convert, format: formatCurrency, profitMargin, bcvRate, parallelRate, getFinalPrice } = useCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingFixedPrice, setIsEditingFixedPrice] = useState(false);
  const [fixedPriceDraft, setFixedPriceDraft] = useState("");
  const [isEditingPromoPrice, setIsEditingPromoPrice] = useState(false);
  const [promoPriceDraft, setPromoPriceDraft] = useState("");

  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const { profile } = useDashboardStore();

  const inventorySettingsRef = useMemoFirebase(() => 
    (firestore && user && open) ? doc(firestore, 'users', user.uid, 'settings', 'inventory') : null,
    [firestore, user?.uid, open]
  );
  const { data: inventorySettings } = useDoc<any>(inventorySettingsRef);

  const categories = useMemo(() => {
    const rawList = Array.isArray(inventorySettings?.categories) ? inventorySettings.categories : [];
    const seen = new Map<string, string>();
    for (const raw of rawList) {
      const formatted = formatCategoryName(String(raw ?? ""));
      if (formatted) {
        const key = formatted.toLowerCase();
        if (!seen.has(key)) seen.set(key, formatted);
      }
    }
    if (!seen.has("general")) seen.set("general", "General");
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "es"));
  }, [inventorySettings]);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(formSchema),    defaultValues: {
      name: "",
      category: "General",
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

  useEffect(() => {
    if (!categoryPopoverOpen) return;

    // En móvil la hoja ya tiene fondo propio que cierra al tocar fuera.
    // Escuchar `pointerdown` ahí cancelaba el click del item y la categoría
    // nunca se seleccionaba.
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (categoryPickerRef.current?.contains(target)) return;
      if (categorySheetRef.current?.contains(target)) return;
      setCategoryPopoverOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCategoryPopoverOpen(false);
    };

    if (!isMobile) {
      document.addEventListener("pointerdown", closeOnOutside);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryPopoverOpen, isMobile]);

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
    return parseFloat(retail.toFixed(6));
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
              category: formatCategoryName(product.category) || "General",
              sku: (product.sku || "").toUpperCase(),
              customMargin: String(product.customMargin || 0),
              compatibleModels: product.compatibleModels?.join(", ").toUpperCase() || "",
            });
        } else {
            const autoSKU = `SKU-${format(new Date(), "ddMMyy-HHmm")}`;
            form.reset({
                name: "", category: "General", sku: autoSKU, barcode: "", unit: "unit",
                costPrice: 0, isFixedPrice: false, fixedPrice: 0, hasCustomMargin: false, customMargin: "0",
                hasDiscount: false, discountAmount: 0,
                promoPrice: 0, stockLevel: 1, reservedStock: 0, damagedStock: 0, lowStockThreshold: 1,
                compatibleModels: "", isCombo: false, comboItems: [], isGiftable: false, hasIVA: false,
                createdAt: new Date().toISOString().split('T')[0],
                salesCount: 0,
                ...(initialDraft || {}),
            } as any);
        }
    }
  }, [product, form, open, initialDraft]);

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
        const cat = formatCategoryName(values.category) || "General";
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
  const thresholdWatch = form.watch('lowStockThreshold') || 1;
  const fixedPriceWatch = Number(form.watch('fixedPrice') || 0);
  const costPriceWatch = Number(costPrice || 0);
  const estimatedProfit = fixedPriceWatch - costPriceWatch;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent 
        className="w-[calc(100%-1.5rem)] sm:max-w-[560px] max-h-[90dvh] overflow-hidden flex flex-col gap-0 p-0 sm:p-0 rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onMinimize={!product && onMinimize ? () => {
          const values = form.getValues();
          persistDraft('product', values);
          try {
            onMinimize(values);
          } finally {
            setOpen(false);
          }
        } : undefined}
      >
        {/* Cabecera limpia y alineada con los iconos de minimizar y cerrar */}
        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-4 sm:px-6">
            <DialogHeader className="space-y-0 pr-24 text-left sm:pr-16">
                <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                        {isEditing ? <Package className="h-4 w-4" /> : <PackagePlus className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 text-left">
                        <DialogTitle className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900 sm:text-base sm:leading-tight">
                            {isEditing ? 'Editar Producto' : 'Nuevo Producto'}
                        </DialogTitle>
                        <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                            {isEditing
                                ? 'Actualiza los datos, precios o existencias del artículo.'
                                : 'Completa los datos básicos, precio de venta y stock inicial.'}
                        </DialogDescription>
                    </div>
                </div>
            </DialogHeader>
        </div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex min-h-0 flex-1 flex-col bg-white">
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-4 space-y-4">
              {/* Sección 1: Información general */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <Tag className="h-3.5 w-3.5 text-blue-600" />
                    <span>Información general</span>
                </div>

                <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem className="space-y-1">
                        <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Nombre del artículo</FormLabel>
                        <FormControl>
                            <Input
                                {...field}
                                placeholder="Ej: Cable USB-C Carga Rápida 1m"
                                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900 placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="category" render={({ field }) => {
                        const options = (
                            <div className="max-h-56 overflow-y-auto p-1">
                                {categories.map((cat) => {
                                    const selected = cat.toLowerCase() === String(field.value || '').trim().toLowerCase();
                                    return (
                                        <button
                                            type="button"
                                            key={cat}
                                            onClick={() => {
                                                field.onChange(cat);
                                                setCategoryPopoverOpen(false);
                                            }}
                                            className={cn(
                                                "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-left text-xs font-medium text-slate-700 outline-none transition-colors hover:bg-blue-50 hover:text-blue-700",
                                                selected && "text-blue-700 bg-blue-50/50",
                                            )}
                                        >
                                            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                                                <Check className={cn("h-3.5 w-3.5 text-blue-600", selected ? "opacity-100" : "opacity-0")} />
                                            </span>
                                            <span className="truncate">{cat}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        );

                        return (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center gap-1.5 text-[11px] font-medium text-slate-500">
                                <Tag className="h-3 w-3 text-slate-400" /> Categoría
                            </FormLabel>
                            <div ref={categoryPickerRef} className="relative">
                                <FormControl>
                                    <Input
                                        {...field}
                                        placeholder="General"
                                        onFocus={() => setCategoryPopoverOpen(true)}
                                        onChange={(e) => field.onChange(formatCategoryInput(e.target.value))}
                                        className="h-9 w-full rounded-lg border-slate-200 bg-white pl-3 pr-8 text-xs font-normal text-slate-800 shadow-2xs focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
                                    />
                                </FormControl>
                                <button
                                    type="button"
                                    onClick={() => setCategoryPopoverOpen((prev) => !prev)}
                                    aria-label="Ver categorías"
                                    className="absolute right-0 top-0 flex h-9 w-8 items-center justify-center text-slate-400 transition-colors hover:text-slate-600"
                                >
                                    <ChevronDown className={cn("h-4 w-4 transition-transform duration-150", categoryPopoverOpen && "rotate-180")} />
                                </button>

                                {categoryPopoverOpen && (
                                    isMobile ? (
                                        <div
                                            className="fixed inset-0 z-[200] bg-slate-950/40 backdrop-blur-[2px]"
                                            onClick={() => setCategoryPopoverOpen(false)}
                                        >
                                            <div
                                                ref={categorySheetRef}
                                                className="absolute inset-x-3 bottom-3 max-h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                {options}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="absolute inset-x-0 top-10 z-[200] overflow-hidden rounded-xl border border-slate-200/90 bg-white text-slate-800 shadow-[0_14px_34px_-12px_rgba(15,23,42,0.18)]">
                                            {options}
                                        </div>
                                    )
                                )}
                            </div>
                            <FormMessage />
                        </FormItem>
                        );
                    }} />

                    <FormField control={form.control} name="unit" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center gap-1.5 text-[11px] font-medium text-slate-500">
                                <Scale className="h-3 w-3 text-slate-400" /> Unidad de medida
                            </FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white text-xs text-slate-800">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="unit" className="text-xs">Unidad (pza)</SelectItem>
                                    <SelectItem value="kg" className="text-xs">Kilos (kg)</SelectItem>
                                    <SelectItem value="g" className="text-xs">Gramos (g)</SelectItem>
                                    <SelectItem value="liter" className="text-xs">Litros (L)</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="sku" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">SKU / Código interno</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    className="h-9 rounded-lg border-slate-200 bg-white font-mono text-xs uppercase text-slate-800 focus-visible:border-blue-500"
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="barcode" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center gap-1.5 text-[11px] font-medium text-slate-500">
                                <Barcode className="h-3 w-3 text-slate-400" /> Código de barras <span className="font-normal text-slate-400">(opcional)</span>
                            </FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    placeholder="Escanea o escribe el código"
                                    className="h-9 rounded-lg border-slate-200 bg-white font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus-visible:border-blue-500"
                                />
                            </FormControl>
                        </FormItem>
                    )} />
                </div>

                {showRepairsFeature && (
                    <FormField control={form.control} name="compatibleModels" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center gap-1.5 text-[11px] font-medium text-slate-500">
                                <Smartphone className="h-3 w-3 text-slate-400" /> Modelos compatibles <span className="font-normal text-slate-400">(separados por coma)</span>
                            </FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    placeholder="Ej: Samsung A14, Redmi Note 12"
                                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                    className="h-9 rounded-lg border-slate-200 bg-white text-xs uppercase text-slate-800 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500"
                                />
                            </FormControl>
                        </FormItem>
                    )} />
                )}
              </section>

              {/* Sección 2: Precios y rentabilidad */}
              <section className="border-t border-slate-100 pt-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        <Calculator className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Precios y estrategia</span>
                    </div>
                    <span className="text-[11px] font-normal tabular-nums text-slate-400">
                        BCV {bcvRate.toFixed(2)} Bs · Margen base {profitMargin}%
                    </span>
                </div>

                {/* Costo */}
                <FormField control={form.control} name="costPrice" render={({ field }) => (
                    <FormItem className="space-y-1">
                        <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Precio de costo</FormLabel>
                        <FormControl>
                            <div className="relative">
                                <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    className="h-9 rounded-lg border-slate-200 bg-white pl-7 text-xs font-medium tabular-nums text-slate-900 focus-visible:border-blue-500"
                                />
                            </div>
                        </FormControl>
                    </FormItem>
                )} />

                {/* Chips compactos */}
                <div className="flex flex-wrap gap-1.5">
                    <FormField control={form.control} name="hasCustomMargin" render={({ field }) => (
                        <FormItem className="space-y-0">
                            <label className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all select-none",
                                field.value
                                    ? "border-blue-300 bg-blue-50 text-blue-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            )}>
                                <FormControl>
                                    <Checkbox checked={field.value} onCheckedChange={field.onChange} className="h-3.5 w-3.5 rounded-[4px]" />
                                </FormControl>
                                <Percent className="h-3 w-3" />
                                <span>Margen individual</span>
                            </label>
                        </FormItem>
                    )} />

                    <FormField control={form.control} name="hasDiscount" render={({ field }) => (
                        <FormItem className="space-y-0">
                            <label className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all select-none",
                                field.value
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            )}>
                                <FormControl>
                                    <Checkbox checked={field.value} onCheckedChange={field.onChange} className="h-3.5 w-3.5 rounded-[4px]" />
                                </FormControl>
                                <BadgePercent className="h-3 w-3" />
                                <span>Descuento</span>
                            </label>
                        </FormItem>
                    )} />

                    <FormField control={form.control} name="hasIVA" render={({ field }) => (
                        <FormItem className="space-y-0">
                            <label className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all select-none",
                                field.value
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            )}>
                                <FormControl>
                                    <Checkbox checked={field.value} onCheckedChange={field.onChange} className="h-3.5 w-3.5 rounded-[4px]" />
                                </FormControl>
                                <Landmark className="h-3 w-3" />
                                <span>Aplica IVA (16%)</span>
                            </label>
                        </FormItem>
                    )} />
                </div>

                {/* Campos opcionales desplegables con suavidad */}
                <SmoothCollapse open={Boolean(hasCustomMargin || hasDiscount)}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-0.5">
                        <SmoothCollapse open={Boolean(hasCustomMargin)} collapseMargin={false}>
                            <FormField control={form.control} name="customMargin" render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="flex h-4 items-center text-[11px] font-medium text-blue-600">Margen (%)</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            className="h-9 rounded-lg border-blue-200 bg-white text-xs font-medium tabular-nums text-blue-700 focus-visible:border-blue-500"
                                        />
                                    </FormControl>
                                </FormItem>
                            )} />
                        </SmoothCollapse>

                        <SmoothCollapse open={Boolean(hasDiscount)} collapseMargin={false}>
                            <FormField control={form.control} name="discountAmount" render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="flex h-4 items-center text-[11px] font-medium text-amber-600">Descuento ($)</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            {...field}
                                            className="h-9 rounded-lg border-amber-200 bg-white text-xs font-medium tabular-nums text-amber-700 focus-visible:border-amber-500"
                                        />
                                    </FormControl>
                                </FormItem>
                            )} />
                        </SmoothCollapse>
                    </div>
                </SmoothCollapse>

                {/* Mini-tarjetas de precios calculados */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl border border-blue-200/80 bg-blue-50/35 px-3.5 py-2.5 transition-colors focus-within:border-blue-400">
                        <FormField control={form.control} name="fixedPrice" render={({ field }) => (
                            <FormItem className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                    <FormLabel className="text-[11px] font-medium text-slate-500">Precio de venta (BCV)</FormLabel>
                                    <button 
                                        type="button" 
                                        onClick={() => form.setValue('isFixedPrice', false)}
                                        className={cn(
                                            "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                                            !isFixedPrice
                                                ? "bg-blue-600 text-white"
                                                : "border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
                                        )}
                                    >
                                        {!isFixedPrice ? "Automático" : "Restablecer"}
                                    </button>
                                </div>
                                <FormControl>
                                    <div className="flex items-center">
                                        <span className="mr-0.5 text-sm font-medium text-blue-600">$</span>
                                        <Input 
                                            type="number" 
                                            step="0.01"
                                            name={field.name}
                                            ref={field.ref}
                                            value={isEditingFixedPrice ? fixedPriceDraft : Number(field.value || 0).toFixed(2)}
                                            className="h-7 border-none bg-transparent p-0 text-lg font-semibold tabular-nums text-blue-700 focus-visible:ring-0 focus-visible:ring-offset-0"
                                            onFocus={() => {
                                                setIsEditingFixedPrice(true);
                                                const num = Number(field.value || 0);
                                                setFixedPriceDraft(num > 0 ? num.toFixed(2) : "");
                                            }}
                                            onBlur={() => {
                                                setIsEditingFixedPrice(false);
                                                field.onBlur();
                                            }}
                                            onChange={(e) => {
                                                setFixedPriceDraft(e.target.value);
                                                field.onChange(e);
                                                form.setValue('isFixedPrice', true);
                                            }}
                                        />
                                    </div>
                                </FormControl>
                                <div className="flex items-center justify-between text-[11px] tabular-nums">
                                    <span className="font-medium text-emerald-700">
                                        Bs {(Number(field.value || 0) * bcvRate).toFixed(2)}
                                    </span>
                                    {costPriceWatch > 0 && (
                                        <span className={cn("font-normal", estimatedProfit >= 0 ? "text-slate-500" : "text-rose-600")}>
                                            {estimatedProfit >= 0 ? `+$${estimatedProfit.toFixed(2)}` : `-$${Math.abs(estimatedProfit).toFixed(2)}`}
                                        </span>
                                    )}
                                </div>
                            </FormItem>
                        )} />
                    </div>

                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/35 px-3.5 py-2.5 transition-colors focus-within:border-emerald-400">
                        <FormField control={form.control} name="promoPrice" render={({ field }) => (
                            <FormItem className="space-y-0.5">
                                <FormLabel className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                                    <Sparkles className="h-3 w-3 text-emerald-600" /> Precio oferta (editable)
                                </FormLabel>
                                <FormControl>
                                    <div className="flex items-center">
                                        <span className="mr-0.5 text-sm font-medium text-emerald-600">$</span>
                                        <Input 
                                            type="number" 
                                            step="0.01"
                                            name={field.name}
                                            ref={field.ref}
                                            value={isEditingPromoPrice ? promoPriceDraft : Number(field.value || 0).toFixed(2)}
                                            className="h-7 border-none bg-transparent p-0 text-lg font-semibold tabular-nums text-emerald-700 focus-visible:ring-0 focus-visible:ring-offset-0"
                                            onFocus={() => {
                                                setIsEditingPromoPrice(true);
                                                const num = Number(field.value || 0);
                                                setPromoPriceDraft(num > 0 ? num.toFixed(2) : "");
                                            }}
                                            onBlur={() => {
                                                setIsEditingPromoPrice(false);
                                                field.onBlur();
                                            }}
                                            onChange={(e) => {
                                                setPromoPriceDraft(e.target.value);
                                                field.onChange(e);
                                            }}
                                        />
                                    </div>
                                </FormControl>
                                <p className="text-[11px] font-normal tabular-nums text-slate-500">
                                    Ref. Bs {(Number(field.value || 0) * parallelRate).toFixed(2)}
                                </p>
                            </FormItem>
                        )} />
                    </div>
                </div>
              </section>

              {/* Sección 3: Control de existencias */}
              <section className="border-t border-slate-100 pt-3.5 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <Boxes className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Control de inventario</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <FormField control={form.control} name="stockLevel" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Stock físico</FormLabel>
                            <FormControl>
                                <Input type="number" inputMode="decimal" {...field} className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium tabular-nums text-slate-900" />
                            </FormControl>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="reservedStock" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center text-[11px] font-medium text-amber-600">Reservado</FormLabel>
                            <FormControl>
                                <Input type="number" inputMode="decimal" {...field} className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium tabular-nums text-slate-900" />
                            </FormControl>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="lowStockThreshold" render={({ field }) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="flex h-4 items-center text-[11px] font-medium text-rose-600">Alerta mín.</FormLabel>
                            <FormControl>
                                <Input type="number" inputMode="decimal" {...field} className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium tabular-nums text-slate-900" />
                            </FormControl>
                        </FormItem>
                    )} />
                    <div className="space-y-1">
                        <Label className="flex h-4 items-center text-[11px] font-medium text-slate-500">Disponible</Label>
                        <div className={cn(
                            "flex h-9 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums",
                            avail <= 0
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : avail <= thresholdWatch
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        )}>
                            {avail}
                        </div>
                    </div>
                </div>
              </section>
            </div>

            {/* Pie limpio y compacto */}
            <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-6 sm:py-3">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={isSubmitting}
                    className="h-10 flex-1 rounded-xl border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 sm:h-9 sm:flex-none sm:rounded-lg"
                >
                    Cancelar
                </Button>
                <Button
                    type="submit"
                    className="h-10 flex-1 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-5 text-xs font-medium text-white shadow-sm shadow-blue-500/20 hover:from-blue-500 hover:to-indigo-500 sm:h-9 sm:flex-none sm:rounded-lg"
                    disabled={isSubmitting}
                >
                    {isSubmitting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    {isEditing ? 'Guardar Cambios' : 'Registrar Producto'}
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
