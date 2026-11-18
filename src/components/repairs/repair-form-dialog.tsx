"use client";

import { cleanObject } from "@/lib/json-guard";
import { ensureOnline } from "@/lib/offline-guard";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import type { RepairJob, RepairStatus, Product, UserProfile, ReservedPart, AppSettings } from "@/lib/types";
import { useState, useEffect, useRef, ReactNode, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { Label } from "../ui/label";
import { useFirebase, useCollection, useMemoFirebase, useDoc, setDocumentNonBlocking } from "@/firebase";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { persistDraft } from "@/contexts/draft-modals-context";
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { useServerSearch } from '@/lib/firestore/use-server-search';
import { queryCache } from '@/lib/firestore/query-cache';
import { useFeatureFlag } from '@/lib/features';
import { normalizeText } from '@/lib/search-index';
import { doc, runTransaction, type DocumentSnapshot, collection, query, orderBy, limit, increment, getDoc, where, getDocs, getDocsFromCache } from "firebase/firestore";
import { handlePrintBatchCustomerTicket } from "./repair-ticket";
import { User, Smartphone, Package, Search, Plus, Trash2, Loader2, DollarSign, Calculator, UserCheck, Hammer, TicketPercent, Landmark, X, Minimize2, Wrench } from "lucide-react";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { ProductFormDialog } from "../inventory/product-form-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { SmoothCollapse } from "@/components/ui/smooth-collapse";

const formSchema = z.object({
  customerName: z.string().min(2, "Nombre obligatorio"),
  customerPhone: z.string().min(10, "Teléfono inválido"),
  customerID: z.string().min(5, "Cédula requerida"),
  customerAddress: z.string().default(""),
  deviceMake: z.string().min(2, "Marca obligatoria"),
  deviceModel: z.string().min(1, "Modelo obligatorio"),
  reportedIssue: z.string().min(5, "Detalla la falla del equipo"),
  status: z.enum(['Pendiente', 'Pagado', 'Completado', 'Garantía']),
  notes: z.string().default(""),
  reservedParts: z.array(z.any()).default([]),
  isPromo: z.boolean().default(false),
});

/**
 * Regla de negocio: una reparación sólo puede quedar en "Pagado" cuando el
 * saldo está cubierto. Si se marca pagada con deuda, vuelve a "Pendiente".
 * "Completado" (entregado) no se toca para no revertir entregas ya hechas.
 */
function resolveRepairStatus(
    status: z.infer<typeof formSchema>["status"],
    paid: number,
    total: number,
): z.infer<typeof formSchema>["status"] {
    const fullyPaid = paid >= total - 0.01;
    if (status === "Pagado" && !fullyPaid) return "Pendiente";
    if (status === "Pendiente" && fullyPaid) return "Pagado";
    return status;
}

/**
 * Pieza manual: repuesto o servicio que no existe en el inventario.
 *
 * La superficie es la misma del formulario de reparación (tonos neutros del
 * tema) para que no aparezcan bloques blancos sobre el fondo gris.
 */
function ManualPartDialog({ onAdd, open, onOpenChange }: { onAdd: (part: any) => void, open: boolean, onOpenChange: (v: boolean) => void }) {
    const { getDynamicPrice, bcvRate, parallelRate, profitMargin, format: formatCurrency } = useCurrency();

    const [description, setDescription] = useState("");
    const [cost, setCost] = useState("");
    const [priceBcv, setPriceBcv] = useState("");
    const [priceOferta, setPriceOferta] = useState("");
    const [focusedField, setFocusedField] = useState<string | null>(null);

    // Lógica reactiva de sugerencia automática al escribir el costo
    const handleCostChange = (val: string) => {
        setCost(val);
        const numCost = parseFloat(val);
        if (!isNaN(numCost) && numCost > 0) {
            // Sugerencia BCV: Protege capital con tasa de reposición pero expresa en $ BCV
            const bcvSug = getDynamicPrice(numCost);
            setPriceBcv(bcvSug.toFixed(6));

            // Sugerencia Oferta: Costo + Margen de ganancia directo (precio de calle)
            const offerSug = numCost * (1 + profitMargin / 100);
            setPriceOferta(offerSug.toFixed(6));
        } else {
            setPriceBcv("");
            setPriceOferta("");
        }
    };

    const canAdd = description.trim().length > 0 && priceBcv.trim() !== "" && priceOferta.trim() !== "";
    const selectedPrice = parseFloat(priceBcv) || 0;

    const handleAdd = () => {
        if (!canAdd) return;

        onAdd({
            productId: `manual-${Date.now()}`,
            productName: description.toUpperCase(),
            quantity: 1,
            costPrice: parseFloat(cost) || 0,
            manualPrice: parseFloat(priceBcv) || 0,
            manualPriceOffer: parseFloat(priceOferta) || 0,
            isManual: true,
            isPromo: false,
            isWarranty: false,
            isConsumed: false
        });

        // Limpiar estados
        setDescription(""); setCost(""); setPriceBcv(""); setPriceOferta("");
        onOpenChange(false);
    };

    // Cálculos de equivalencia en Bs para visualización en tiempo real
    const eqBsBcv = (parseFloat(priceBcv) || 0) * bcvRate;
    const eqBsOferta = (parseFloat(priceOferta) || 0) * parallelRate;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-[440px] max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 sm:p-0 shadow-2xl">
                {/* ENCABEZADO */}
                <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
                    <DialogHeader className="space-y-0 pr-14 text-left">
                        <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                                <Wrench className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 text-left">
                                <DialogTitle className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900 sm:text-base sm:leading-tight">
                                    Pieza manual
                                </DialogTitle>
                                <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                                    Repuesto o servicio que no está en el inventario.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <form
                    onSubmit={(event) => { event.preventDefault(); handleAdd(); }}
                    className="flex min-h-0 flex-1 flex-col bg-white"
                >
                    <div className="flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                        <div className="space-y-1">
                            <Label htmlFor="manual-part-description" className="flex h-4 items-center text-[11px] font-medium text-slate-500">
                                Descripción
                            </Label>
                            <Input
                                id="manual-part-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value.toUpperCase())}
                                placeholder="Ej: Cambio de flex, pantalla..."
                                className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900 placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus-visible:border-blue-500"
                                autoFocus
                                autoComplete="off"
                            />
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="manual-part-cost" className="flex h-4 items-center text-[11px] font-medium text-slate-500">
                                Costo de inversión
                            </Label>
                            <div className="relative">
                                <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                    id="manual-part-cost"
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    min="0"
                                    value={cost}
                                    onChange={(e) => handleCostChange(e.target.value)}
                                    placeholder="0.00"
                                    className="h-9 rounded-lg border-slate-200 bg-white pl-7 text-xs font-medium tabular-nums text-slate-900 focus-visible:border-blue-500"
                                />
                            </div>
                        </div>

                        {/* PRECIOS SUGERIDOS */}
                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-xl border border-blue-200/80 bg-blue-50/35 px-3 py-2.5 focus-within:border-blue-400">
                                <span className="text-[11px] font-medium text-slate-500">
                                    Sugerido BCV
                                </span>
                                <div className="mt-1 flex items-center">
                                    <span className="mr-0.5 text-sm font-medium text-blue-600">$</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="any"
                                        min="0"
                                        aria-label="Precio sugerido BCV en dólares"
                                        value={focusedField === "bcv" ? priceBcv : (priceBcv ? Number(priceBcv).toFixed(2) : "")}
                                        onFocus={() => setFocusedField("bcv")}
                                        onBlur={() => setFocusedField(null)}
                                        onChange={(e) => setPriceBcv(e.target.value)}
                                        className="h-7 w-full min-w-0 bg-transparent p-0 text-base font-semibold tabular-nums text-blue-700 outline-none placeholder:text-slate-400"
                                        placeholder="0.00"
                                    />
                                </div>
                                <span className="mt-0.5 block truncate text-[11px] font-medium tabular-nums text-emerald-700">
                                    Bs {formatCurrency(eqBsBcv)}
                                </span>
                            </div>

                            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/35 px-3 py-2.5 focus-within:border-emerald-400">
                                <span className="text-[11px] font-medium text-slate-500">
                                    Sugerido oferta
                                </span>
                                <div className="mt-1 flex items-center">
                                    <span className="mr-0.5 text-sm font-medium text-emerald-600">$</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="any"
                                        min="0"
                                        aria-label="Precio sugerido de oferta en dólares"
                                        value={focusedField === "oferta" ? priceOferta : (priceOferta ? Number(priceOferta).toFixed(2) : "")}
                                        onFocus={() => setFocusedField("oferta")}
                                        onBlur={() => setFocusedField(null)}
                                        onChange={(e) => setPriceOferta(e.target.value)}
                                        className="h-7 w-full min-w-0 bg-transparent p-0 text-base font-semibold tabular-nums text-emerald-700 outline-none placeholder:text-slate-400"
                                        placeholder="0.00"
                                    />
                                </div>
                                <span className="mt-0.5 block truncate text-[11px] font-normal tabular-nums text-slate-500">
                                    Bs {formatCurrency(eqBsOferta)}
                                </span>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-5 sm:py-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-10 flex-1 rounded-xl border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:h-9 sm:flex-none sm:rounded-lg"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={!canAdd}
                            className="h-10 flex-1 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-5 text-xs font-medium text-white shadow-sm hover:from-blue-500 hover:to-indigo-500 sm:h-9 sm:flex-none sm:rounded-lg"
                        >
                            {canAdd ? `Agregar · $${selectedPrice.toFixed(2)}` : 'Agregar pieza'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

const DEFAULT_ISSUES = ["Pantalla rota", "Pin de carga", "Cambio de batería", "No enciende"];

export function RepairFormDialog({ repairJob, children, isOpen, onOpenChange, onSaved, initialDraft, onMinimize, suggestedIssues = DEFAULT_ISSUES }: { repairJob?: RepairJob | null, children?: ReactNode, isOpen?: boolean, onOpenChange?: (v: boolean) => void, onSaved?: (job: RepairJob) => void, initialDraft?: z.infer<typeof formSchema>, onMinimize?: (values: z.infer<typeof formSchema>) => void, suggestedIssues?: string[] }) {
  const { firestore, user } = useFirebase();
  const [internalOpen, setInternalOpen] = useState(false);
  const [partsPopoverOpen, setPartsPopoverOpen] = useState(false);
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [manualQuickAddOpen, setManualQuickAddOpen] = useState(false);
  
  const [productSearch, setProductSearch] = useState("");
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const { toast } = useToast();
  const { getFinalPrice, getDynamicPrice, format: formatCurrency, bcvRate, parallelRate } = useCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [lookedUpCustomer, setLookedUpCustomer] = useState<any>(null);
  const [sessionJobs, setSessionJobs] = useState<RepairJob[]>([]);
  const addAnotherRef = useRef(false);
  const deviceMakeInputRef = useRef<HTMLInputElement | null>(null);
  const autoFilledIdRef = useRef<string>("");

  useEffect(() => {
    if (!open) {
      setSessionJobs([]);
      addAnotherRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    const sync = () => setIsOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) setPartsPopoverOpen(false);
  }, [isOnline]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: "", customerPhone: "", customerID: "", customerAddress: "",
      deviceMake: "", deviceModel: "", reportedIssue: "",
      status: "Pendiente", reservedParts: [],
      isPromo: false, notes: "",
    },
  });

  const { profile } = useDashboardStore();
  const uid = user?.uid ?? '';
  const usePaged = useFeatureFlag(profile, 'pagedData');

  const productsQuery = useMemoFirebase(() => 
    (firestore && user && open && !usePaged) ? query(collection(firestore, 'users', user.uid, 'products'), orderBy('name'), limit(200)) : null,
    [firestore, user?.uid, open, usePaged]
  );
  const legacyProducts = useCollection<Product>(productsQuery);

  // FASE 2: 100 repuestos + búsqueda en servidor (los resultados se fusionan
  // al catálogo cacheado y el filtro local los encuentra).
  const pagedProducts = usePagedQuery<Product>({
    collectionName: 'products',
    orderField: 'name',
    orderDir: 'asc',
    pageSize: 100,
    enabled: open && usePaged,
  });

  useServerSearch<Product>({
    collectionName: 'products',
    term: productSearch,
    orderField: 'name',
    orderDir: 'asc',
    pageSize: 20,
    enabled: open && usePaged,
    onResults: (found) => {
      if (user?.uid) queryCache.mergeIntoCatalog(user.uid, 'products', found.filter((product) => !product.isDeleted));
    },
  });

  const allProducts = useMemo(() => {
    const source = (usePaged ? pagedProducts.items : legacyProducts.data) || [];
    const seen = new Set<string>();
    return source.filter((product) => {
      if (!product?.id || product.isDeleted || seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });
  }, [usePaged, pagedProducts.items, legacyProducts.data]);
  const productsLoading = usePaged ? pagedProducts.isLoading : legacyProducts.isLoading;

  const searchResults = useMemo(() => {
    if (!allProducts) return [];
    const term = normalizeText(productSearch);
    if (!term) return allProducts.slice(0, 15);
    
    return allProducts.filter(p => 
        normalizeText(p.name).includes(term) || 
        normalizeText(p.sku).includes(term) ||
        normalizeText(p.barcode).includes(term) ||
        normalizeText((p.compatibleModels ?? []).join(' ')).includes(term)
    ).slice(0, 20);
  }, [allProducts, productSearch]);

  const reservedParts = form.watch("reservedParts") as (ReservedPart & { isPromo?: boolean, isWarranty?: boolean, isManual?: boolean, isConsumed?: boolean, manualPriceBs?: number, manualPriceOffer?: number })[];
  const watchedID = form.watch("customerID");
  const watchedName = form.watch("customerName");

  useEffect(() => {
    let cancelled = false;

    const fetchCustomer = async () => {
      const id = watchedID?.toUpperCase().trim() || "";
      const digits = id.replace(/\D/g, "");
      if (!open || !firestore || !user || id.length < 5 || digits.length < 7) {
        setLookedUpCustomer(null);
        return;
      }

      const variants = Array.from(new Set([
        id,
        digits,
        `V-${digits}`,
        `V${digits}`,
        `E-${digits}`,
        `J-${digits}`,
      ].filter(Boolean))).slice(0, 10);

      const findOne = async (collectionName: "repair_jobs" | "fiados") => {
        const q = query(
          collection(firestore, "users", user.uid, collectionName),
          where("customerID", "in", variants),
          limit(1),
        );
        try {
          const cached = await getDocsFromCache(q);
          if (!cached.empty) return cached.docs[0].data();
        } catch {
          // Sin caché disponible para esta consulta.
        }
        const server = await getDocs(q);
        return server.empty ? null : server.docs[0].data();
      };

      try {
        const repairCustomer = await findOne("repair_jobs");
        const data = repairCustomer || await findOne("fiados");
        if (cancelled) return;

        if (!data) {
          setLookedUpCustomer(null);
          return;
        }

        setLookedUpCustomer(data);
        const current = form.getValues();
        const updates: Record<string, string> = {};
        if (!current.customerName?.trim() && data.customerName) {
          updates.customerName = String(data.customerName).toUpperCase();
        }
        if (!current.customerPhone?.trim() && data.customerPhone) {
          updates.customerPhone = String(data.customerPhone);
        }
        if (!current.customerAddress?.trim() && data.customerAddress) {
          updates.customerAddress = String(data.customerAddress).toUpperCase();
        }

        Object.entries(updates).forEach(([field, value]) => {
          form.setValue(field as "customerName" | "customerPhone" | "customerAddress", value, {
            shouldDirty: true,
            shouldValidate: true,
          });
        });

        if (Object.keys(updates).length > 0 && autoFilledIdRef.current !== id) {
          autoFilledIdRef.current = id;
          toast({ title: "Cliente encontrado", description: "Datos cargados automáticamente." });
        }
      } catch {
        if (!cancelled) setLookedUpCustomer(null);
      }
    };

    const debounce = setTimeout(fetchCustomer, 500);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [watchedID, firestore, user, open, form, toast]);

  const handleApplyCustomerData = () => {
    if (lookedUpCustomer) {
        form.setValue("customerName", lookedUpCustomer.customerName.toUpperCase());
        form.setValue("customerPhone", lookedUpCustomer.customerPhone);
        form.setValue("customerAddress", (lookedUpCustomer.customerAddress || "").toUpperCase());
        toast({ title: "Datos cargados" });
    }
  };
  
  const effectiveIsPromo = useMemo(() => reservedParts.some(p => p.isPromo && !p.isWarranty), [reservedParts]);

  useEffect(() => {
    form.setValue("isPromo", effectiveIsPromo);
  }, [effectiveIsPromo, form]);

  const partsTotalForClient = useMemo(() => {
    return reservedParts.reduce((sum, part) => {
        if (part.isWarranty) return sum;
        let price = 0;
        if (part.isManual) {
            price = part.isPromo ? (part.manualPriceOffer || 0) : (part.manualPrice || 0);
            if (price === 0) price = getDynamicPrice(part.costPrice);
        } else {
            const product = allProducts?.find(p => p.id === part.productId);
            if (product) {
                price = (part.isPromo && product.promoPrice) ? product.promoPrice : getFinalPrice(product);
            } else {
                price = getDynamicPrice(part.costPrice);
            }
        }
        return sum + (price * part.quantity);
    }, 0);
  }, [reservedParts, allProducts, getFinalPrice, getDynamicPrice]);

  const estimatedTotal = partsTotalForClient;
  const currentPaid = repairJob?.amountPaid || 0;

  useEffect(() => {
    if (open) {
        if (repairJob) {
            const allParts = [
                ...(repairJob.consumedParts || []).map(p => ({ ...p, isConsumed: true })),
                ...(repairJob.reservedParts || []).map(p => ({ ...p, isConsumed: false }))
            ];
            form.reset({ ...repairJob, status: repairJob.status as any, reservedParts: allParts });
        } else {
            form.reset({
                customerName: "", customerPhone: "", customerID: "", customerAddress: "",
                deviceMake: "", deviceModel: "", reportedIssue: "", status: "Pendiente",
                reservedParts: [], isPromo: false, notes: "",
                ...(initialDraft || {}),
            });
        }
    }
  }, [repairJob, open, form, initialDraft]);

  const handleAddPartFromInventory = async (p: Product) => {
    if (!ensureOnline(toast, 'Agregar repuesto de inventario')) return;
    if (!p || p.isDeleted) return;
      let freshProduct = p;
      if (firestore && user) {
          const snap = await getDoc(doc(firestore, 'users', user.uid, 'products', p.id!));
          if (snap.exists()) freshProduct = { ...snap.data(), id: snap.id } as Product;
      }
      const existing = reservedParts.find(item => item.productId === freshProduct.id);
      const qtyInForm = existing ? existing.quantity : 0;
      const originalInJob = repairJob?.reservedParts?.find(rp => rp.productId === freshProduct.id)?.quantity || 0;
      const available = (freshProduct.stockLevel - (freshProduct.reservedStock || 0) - (freshProduct.damagedStock || 0)) + originalInJob;
      
      if (available < qtyInForm + 1) {
          setReplenishProduct(freshProduct);
          setPartsPopoverOpen(false);
          return;
      }
      if (existing) {
          form.setValue('reservedParts', reservedParts.map(item => item.productId === freshProduct.id ? { ...item, quantity: item.quantity + 1 } : item));
      } else {
          form.setValue('reservedParts', [...reservedParts, { 
              productId: freshProduct.id!, 
              productName: freshProduct.name.toUpperCase(), 
              quantity: 1, costPrice: freshProduct.costPrice, 
              isPromo: false, isWarranty: false, isManual: false, isConsumed: false 
          }]);
      }
      setPartsPopoverOpen(false);
  };

  const handleAddManualPart = (part: any) => form.setValue('reservedParts', [...reservedParts, part]);
  const handleRemovePart = (productId: string) => form.setValue('reservedParts', reservedParts.filter(p => p.productId !== productId));
  const handleTogglePartPromo = (productId: string) => form.setValue('reservedParts', reservedParts.map(p => p.productId === productId ? { ...p, isPromo: !p.isPromo } : p));

  const finishOrAddAnother = (savedJob: RepairJob, values: z.infer<typeof formSchema>, isOfflineMode: boolean) => {
    onSaved?.(savedJob);

    if (addAnotherRef.current && !repairJob) {
      const nextCount = sessionJobs.length + 1;
      setSessionJobs((prev) => [...prev, savedJob]);
      addAnotherRef.current = false;
      form.reset({
        customerName: values.customerName,
        customerPhone: values.customerPhone,
        customerID: values.customerID,
        customerAddress: values.customerAddress || "",
        deviceMake: "",
        deviceModel: "",
        reportedIssue: "",
        status: "Pendiente",
        reservedParts: [],
        isPromo: false,
        notes: "",
      });
      setPartsPopoverOpen(false);
      setProductSearch("");
      toast({
        title: isOfflineMode ? `Equipo #${nextCount} guardado sin conexión` : `Equipo #${nextCount} guardado`,
        description: `Ingresa el siguiente equipo de ${values.customerName}. La nota del cliente se imprimirá al finalizar.`,
      });
      window.setTimeout(() => {
        deviceMakeInputRef.current?.focus();
      }, 60);
      return;
    }

    const batchToPrint = [...sessionJobs, savedJob];
    toast({
      title: isOfflineMode
        ? 'Reparación guardada sin conexión'
        : batchToPrint.length > 1
          ? `${batchToPrint.length} órdenes guardadas`
          : 'Orden Guardada',
      description: isOfflineMode ? 'Se sincronizará automáticamente cuando vuelva el internet.' : undefined,
    });
    if (!repairJob) {
      handlePrintBatchCustomerTicket(
        { repairJobs: batchToPrint, businessName: profile?.businessName, profile, bcvRate, parallelRate },
        () => {}
      );
    }
    setSessionJobs([]);
    setOpen(false);
  };

  const handleCloseWithPendingPrint = () => {
    if (sessionJobs.length > 0 && !repairJob) {
      handlePrintBatchCustomerTicket(
        { repairJobs: sessionJobs, businessName: profile?.businessName, profile, bcvRate, parallelRate },
        () => {}
      );
      toast({
        title: `Nota impresa (${sessionJobs.length} equipo${sessionJobs.length === 1 ? '' : 's'})`,
      });
    }
    setSessionJobs([]);
    setOpen(false);
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!firestore || !user || isSubmitting) return;

    // Regla B: una reparación pagada o entregada queda bloqueada.
    // Sólo un reembolso de la venta la devuelve a "Pendiente".
    if (repairJob) {
      const jobTotal = Number(repairJob.estimatedCost || 0);
      const jobPaid = Number(repairJob.amountPaid || 0);
      const jobSettled = repairJob.isPaid === true || jobPaid >= jobTotal - 0.01;
      if (jobSettled || repairJob.status === 'Completado') {
        toast({
          variant: 'destructive',
          title: 'Reparación bloqueada',
          description: repairJob.status === 'Completado'
            ? 'Esta reparación ya fue entregada. Procesa un reembolso si necesitas modificarla.'
            : 'Esta reparación ya está pagada. Procesa un reembolso si necesitas modificarla.',
        });
        return;
      }
    }

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (offline) {
      if (repairJob) {
        toast({
          variant: 'destructive',
          title: 'Sin conexión',
          description: 'No puedes editar una reparación existente sin internet.',
        });
        return;
      }
      if (values.status === 'Completado') {
        toast({
          variant: 'destructive',
          title: 'Sin conexión',
          description: 'No puedes completar ni entregar una reparación sin internet.',
        });
        return;
      }
      if (values.reservedParts.some((part) => !part.isManual)) {
        toast({
          variant: 'destructive',
          title: 'Sin conexión',
          description: 'Solo puedes usar piezas manuales mientras estás offline.',
        });
        return;
      }
    }

    const remainingDebt = Math.max(0, estimatedTotal - currentPaid);
    const hasPendingDebt = remainingDebt > 0.009 && !repairJob?.isPaid;

    if (values.status === 'Completado' && hasPendingDebt) {
        toast({
            variant: "destructive",
            title: "Entrega Bloqueada por Deuda",
            description: `No se puede guardar en estado 'Completado'. Esta reparación tiene un saldo pendiente de $${remainingDebt.toFixed(2)}. Debe saldarse el monto antes de la entrega.`
        });
        return;
    }

    if (offline) {
        setIsSubmitting(true);
        try {
            const jobId = `R-${format(new Date(), "yyMMdd")}-${Math.floor(1000 + Math.random() * 9000)}`;
            const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', jobId);
            const finalReservedParts = values.reservedParts.filter(p => !p.isConsumed);
            const finalConsumedParts = values.reservedParts.filter(p => p.isConsumed);
            const calculatedPartsCost = [...finalReservedParts, ...finalConsumedParts]
                .reduce((sum, p) => sum + (Number(p.costPrice || 0) * Number(p.quantity || 1)), 0);

            const finalData = cleanObject({
                ...values,
                id: jobId,
                estimatedCost: Number(estimatedTotal.toFixed(2)),
                partsCost: Number(calculatedPartsCost.toFixed(2)),
                amountPaid: currentPaid,
                isPaid: currentPaid >= (estimatedTotal - 0.01),
                status: resolveRepairStatus(values.status, currentPaid, estimatedTotal),
                createdAt: new Date().toISOString(),
                reservedParts: finalReservedParts.map(({ isConsumed, ...p }) => p),
                consumedParts: finalConsumedParts.map(({ isConsumed, ...p }) => p),
                partsConsumed: false,
                isPromo: effectiveIsPromo,
            });

            // Sin await: offline la escritura queda en la caché persistente y se
            // sincroniza sola. Esperar la confirmación del servidor colgaría el modal.
            void setDocumentNonBlocking(jobRef, finalData, { merge: true }).catch(() => {});

            finishOrAddAnother(finalData as RepairJob, values, true);
        } catch (error: any) {
            addAnotherRef.current = false;
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsSubmitting(false);
        }
        return;
    }

    setIsSubmitting(true);
    try {
        const finalJob = await runTransaction(firestore, async (transaction) => {
            const jobId = repairJob?.id || `R-${format(new Date(), "yyMMdd")}-${Math.floor(1000 + Math.random() * 9000)}`;
            const jobRef = doc(firestore, 'users', user.uid, 'repair_jobs', jobId);

            if (values.status === 'Completado' && hasPendingDebt) {
                throw new Error(`Entrega bloqueada: Saldo deudor pendiente de $${remainingDebt.toFixed(2)}.`);
            }
            const allFormParts = values.reservedParts;
            const newReservedItems = allFormParts.filter(p => !p.isConsumed);
            const newConsumedItems = allFormParts.filter(p => p.isConsumed);
            const productIdsToRead = new Set<string>();
            allFormParts.filter(p => !p.isManual).forEach(p => productIdsToRead.add(p.productId));
            (repairJob?.reservedParts || []).filter(p => !p.isManual).forEach(p => productIdsToRead.add(p.productId));
            const productSnapshots = new Map<string, DocumentSnapshot>();
            for (const pid of Array.from(productIdsToRead)) productSnapshots.set(pid, await transaction.get(doc(firestore, 'users', user.uid, 'products', pid)));
            
            const reservedDeltas = new Map<string, { delta: number, name: string }>();
            (repairJob?.reservedParts || []).filter(p => !p.isManual).forEach(old => reservedDeltas.set(old.productId, { delta: -old.quantity, name: old.productName }));
            newReservedItems.filter(p => !p.isManual).forEach(updated => {
                const cur = reservedDeltas.get(updated.productId) || { delta: 0, name: updated.productName };
                reservedDeltas.set(updated.productId, { delta: cur.delta + updated.quantity, name: updated.productName });
            });
            for (const [pid, change] of Array.from(reservedDeltas.entries())) {
                if (change.delta === 0) continue;
                const pSnap = productSnapshots.get(pid);
                if (pSnap?.exists()) {
                    const data = pSnap.data() as Product;
                    if (change.delta > 0 && ((data.stockLevel - (data.reservedStock || 0) - (data.damagedStock || 0)) < change.delta)) throw new Error(`Stock insuficiente: ${change.name}`);
                    transaction.update(pSnap.ref, { reservedStock: increment(change.delta) });
                }
            }

            let finalReservedParts = [...newReservedItems];
            let finalConsumedParts = [...newConsumedItems];
            let completionData: any = {};
            if (values.status === 'Completado') {
                for (const part of newReservedItems.filter(p => !p.isManual)) {
                    const pSnap = productSnapshots.get(part.productId);
                    if (pSnap?.exists()) transaction.update(pSnap.ref, { stockLevel: increment(-part.quantity), reservedStock: increment(-part.quantity) });
                }
                const completionDate = new Date();
                completionData = { completedAt: completionDate.toISOString(), warrantyEndDate: addDays(completionDate, 4).toISOString() };
                finalConsumedParts = [...finalConsumedParts, ...newReservedItems];
                finalReservedParts = [];
            }

            const calculatedPartsCost = [...finalReservedParts, ...finalConsumedParts].reduce((sum, p) => sum + (Number(p.costPrice || 0) * Number(p.quantity || 1)), 0);

            const finalData = cleanObject({ 
                ...values, id: jobId, 
                estimatedCost: Number(estimatedTotal.toFixed(2)),
                partsCost: Number(calculatedPartsCost.toFixed(2)),
                amountPaid: currentPaid,
                isPaid: currentPaid >= (estimatedTotal - 0.01),
                // Regla: "Pagado" sólo existe si el saldo quedó cubierto.
                status: resolveRepairStatus(values.status, currentPaid, estimatedTotal),
                createdAt: repairJob?.createdAt || new Date().toISOString(),
                reservedParts: finalReservedParts.map(({isConsumed, ...p}) => p), 
                consumedParts: finalConsumedParts.map(({isConsumed, ...p}) => p), 
                partsConsumed: values.status === 'Completado', isPromo: effectiveIsPromo, ...completionData
            });
            transaction.set(jobRef, finalData, { merge: true });
            return finalData as RepairJob;
        });
        finishOrAddAnother(finalJob, values, false);
    } catch (e: any) {
        addAnotherRef.current = false;
        toast({ variant: "destructive", title: "Error", description: e.message });
    } 
    finally { setIsSubmitting(false); }
  }

  // Pagada o entregada: el formulario se abre en solo lectura (nada editable).
  const isReadOnly = !!repairJob && (
    repairJob.isPaid === true ||
    Number(repairJob.amountPaid || 0) >= Number(repairJob.estimatedCost || 0) - 0.01 ||
    repairJob.status === 'Completado'
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent
        className="w-[calc(100%-1.5rem)] sm:max-w-[560px] max-h-[90dvh] overflow-hidden flex flex-col gap-0 p-0 sm:p-0 rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onMinimize={!repairJob && onMinimize ? () => {
            const values = form.getValues();
            persistDraft('repair', values);
            try {
                onMinimize(values);
            } finally {
                setOpen(false);
            }
        } : undefined}
      >
        {/* Cabecera limpia y alineada con los iconos de minimizar y cerrar (igual a Nuevo Producto) */}
        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-4 sm:px-6">
            <DialogHeader className="space-y-0 pr-24 text-left sm:pr-16">
                <div className="flex h-11 items-center gap-2.5 sm:h-auto">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white shadow-sm">
                        <Wrench className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 text-left">
                        <DialogTitle className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900 sm:text-base sm:leading-tight">
                            {isReadOnly ? 'Ver Reparación' : repairJob ? 'Editar Reparación' : 'Nueva Reparación'}
                        </DialogTitle>
                        <DialogDescription className="sr-only sm:not-sr-only sm:mt-0.5 sm:block text-[11px] font-normal text-slate-500">
                            {isReadOnly ? "Consulta los datos de la reparación." : "Registra los datos del cliente, equipo y repuestos."}
                        </DialogDescription>
                    </div>
                </div>
            </DialogHeader>
        </div>
        
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off" className="flex min-h-0 flex-1 flex-col bg-white">
                <div className={cn("flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6", isReadOnly && "opacity-95")}>
                    {!isOnline && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-800">
                            Sin conexión: solo reparaciones nuevas con piezas manuales. Editar o completar una reparación requiere internet.
                        </div>
                    )}

                    {/* Resumen de equipos ya registrados en este lote (mismo cliente) */}
                    <SmoothCollapse open={!repairJob && sessionJobs.length > 0}>
                        <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-3.5 py-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-emerald-800">
                                    {sessionJobs.length} equipo{sessionJobs.length === 1 ? '' : 's'} registrado{sessionJobs.length === 1 ? '' : 's'} · Agregando #{sessionJobs.length + 1}
                                </span>
                                <span className="text-[10px] font-medium text-emerald-700/80">
                                    1 nota al finalizar
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {sessionJobs.map((job, index) => (
                                    <span key={job.id || index} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                        <span className="font-semibold text-emerald-700">#{index + 1}</span>
                                        <span className="truncate max-w-[140px]">{job.deviceMake} {job.deviceModel}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </SmoothCollapse>

                    {/* Sección 1: Información del cliente */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <User className="h-3.5 w-3.5 text-blue-600" />
                            <span>Información del cliente</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <FormField control={form.control} name="customerID" render={({field}) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Cédula / RIF</FormLabel>
                                    <FormControl>
                                        <Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="V-12345678" className="h-9 rounded-lg border-slate-200 bg-white font-mono text-xs uppercase text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus-visible:border-blue-500" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="customerPhone" render={({field}) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Teléfono</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="0412-0000000" className="h-9 rounded-lg border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                        <SmoothCollapse open={Boolean(lookedUpCustomer && watchedName.toUpperCase() !== lookedUpCustomer.customerName.toUpperCase())}>
                            <Button type="button" variant="outline" size="sm" className="h-8 w-full rounded-lg border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-700 hover:bg-emerald-100 flex items-center gap-1.5" onClick={handleApplyCustomerData}>
                                <UserCheck className="h-3.5 w-3.5" /> Cargar datos de {lookedUpCustomer?.customerName}
                            </Button>
                        </SmoothCollapse>
                        <FormField control={form.control} name="customerName" render={({field}) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Nombre completo</FormLabel>
                                <FormControl>
                                    <Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="Ej: Juan Pérez" className="h-9 rounded-lg border-slate-200 bg-white text-xs font-medium uppercase text-slate-900 placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus-visible:border-blue-500" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                    </section>

                    {/* Sección 2: Detalles del equipo */}
                    <section className="border-t border-slate-100 pt-3.5 space-y-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <Smartphone className="h-3.5 w-3.5 text-indigo-600" />
                            <span>Detalles del equipo</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <FormField control={form.control} name="deviceMake" render={({field}) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Marca</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            ref={(el) => {
                                                field.ref(el);
                                                deviceMakeInputRef.current = el;
                                            }}
                                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                            placeholder="Ej: Samsung, Xiaomi..."
                                            className="h-9 rounded-lg border-slate-200 bg-white text-xs uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="deviceModel" render={({field}) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Modelo</FormLabel>
                                    <FormControl>
                                        <Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="Ej: A54, Note 12..." className="h-9 rounded-lg border-slate-200 bg-white text-xs uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                        <FormField control={form.control} name="reportedIssue" render={({field}) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="flex h-4 items-center text-[11px] font-medium text-slate-500">Falla reportada</FormLabel>
                                <FormControl>
                                    <Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} placeholder="Ej: Pantalla rota, no carga..." className="h-9 rounded-lg border-slate-200 bg-white text-xs uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus-visible:border-blue-500" />
                                </FormControl>
                                {!isReadOnly && suggestedIssues.length > 0 && (
                                    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pt-1 sm:flex-wrap">
                                        {suggestedIssues.slice(0, 4).map((issue) => {
                                            const active = String(field.value || "").trim().toLowerCase() === issue.toLowerCase();
                                            return (
                                                <button
                                                    key={issue}
                                                    type="button"
                                                    onClick={() => field.onChange(issue.toUpperCase())}
                                                    className={cn(
                                                        "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                                                        active
                                                            ? "border-blue-300 bg-blue-50 text-blue-700"
                                                            : "border-slate-200/90 bg-slate-50/70 text-slate-600 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700"
                                                    )}
                                                >
                                                    {issue}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <FormMessage />
                            </FormItem>
                        )} />
                    </section>

                    {/* Sección 3: Repuestos y servicios */}
                    <section className="border-t border-slate-100 pt-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                <Package className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Repuestos y servicios</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!isOnline}
                                    title={!isOnline ? 'Sin conexión: usa una pieza manual' : undefined}
                                    className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                    onClick={() => setPartsPopoverOpen((prev) => !prev)}
                                >
                                    <Search className="mr-1 h-3.5 w-3.5 text-blue-600" />
                                    {isOnline ? 'Inventario' : 'Sin conexión'}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg border-blue-200 bg-blue-50 px-2.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 hover:text-blue-800"
                                    onClick={() => setManualQuickAddOpen(true)}
                                >
                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                    Manual
                                </Button>
                            </div>
                        </div>

                        <SmoothCollapse open={partsPopoverOpen && isOnline}>
                            <div className="rounded-xl border border-blue-200/80 bg-blue-50/30 p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                        <Input
                                            placeholder="Buscar repuesto en inventario..."
                                            className="h-9 rounded-lg border-slate-200 bg-white pl-8 text-xs text-slate-900 placeholder:text-slate-400"
                                            value={productSearch}
                                            onChange={(event) => setProductSearch(event.target.value)}
                                        />
                                    </div>
                                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg text-slate-500 hover:bg-white" onClick={() => setPartsPopoverOpen(false)} aria-label="Cerrar búsqueda">
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="max-h-52 space-y-1.5 overflow-y-auto">
                                    {productsLoading && <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-blue-600" /></div>}
                                    {!productsLoading && searchResults.length === 0 && (
                                        <p className="p-3 text-center text-xs text-slate-400">Sin resultados.</p>
                                    )}
                                    {searchResults.map((p) => (
                                        <button
                                            type="button"
                                            key={p.id}
                                            onClick={() => handleAddPartFromInventory(p)}
                                            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-xs font-medium text-slate-800">{p.name}</p>
                                                <p className="text-[11px] text-slate-500">
                                                    {p.stockLevel - (p.reservedStock || 0)} disponibles
                                                </p>
                                            </div>
                                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                                                <Plus className="h-3 w-3" /> Agregar
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </SmoothCollapse>

                        <div className="space-y-2">
                            {reservedParts.length === 0 && (
                                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 py-4 text-center text-xs text-slate-400">
                                    Sin materiales ni servicios añadidos.
                                </p>
                            )}
                            {reservedParts.map((part) => {
                                const pData = allProducts?.find(p => p.id === part.productId);
                                const price = part.isWarranty ? 0 : (part.isManual ? (part.isPromo ? (part.manualPriceOffer || 0) : (part.manualPrice || 0)) : (part.isPromo && pData?.promoPrice ? pData.promoPrice : getFinalPrice(pData || { costPrice: part.costPrice } as Product)));
                                return (
                                    <div key={part.productId} className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors", part.isConsumed ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200/80 bg-slate-50/50")}>
                                        <div className="flex min-w-0 flex-col gap-0.5">
                                            <div className="flex items-center gap-1.5">
                                                {part.isManual && <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-700">Manual</span>}
                                                <span className="truncate text-xs font-medium text-slate-800 max-w-[200px]">{part.productName}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-[11px] tabular-nums text-slate-500">1x ${price.toFixed(2)}</span>
                                                {part.isConsumed && <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-700">Cobrado</span>}
                                                {part.isPromo && !part.isWarranty && <span className="rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-medium text-blue-700">Oferta</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className={cn("h-7 w-7 rounded-lg", part.isPromo ? "text-blue-600 bg-blue-50" : "text-slate-400 hover:text-slate-700")} onClick={() => handleTogglePartPromo(part.productId)} disabled={part.isConsumed}><TicketPercent className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent><p>Oferta</p></TooltipContent></Tooltip></TooltipProvider>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => handleRemovePart(part.productId)} disabled={part.isConsumed}><Trash2 className="h-3.5 w-3.5" /></Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* Resumen financiero luminoso (sin caja negra pesada) */}
                    <div className="rounded-xl border border-blue-200/80 bg-gradient-to-br from-blue-50/50 via-white to-emerald-50/40 px-4 py-3">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>Total estimado: <strong className="font-medium tabular-nums text-slate-800">${estimatedTotal.toFixed(2)}</strong></span>
                            <span className="font-medium tabular-nums text-emerald-700">
                                Bs {formatCurrency(estimatedTotal * (effectiveIsPromo ? parallelRate : bcvRate))}
                            </span>
                        </div>
                        <div className="mt-2 flex items-end justify-between border-t border-slate-200/70 pt-2">
                            <div className="flex flex-col">
                                <span className="text-xs font-medium text-slate-600">Saldo pendiente</span>
                                {currentPaid > 0 && (
                                    <span className="text-[11px] font-medium tabular-nums text-emerald-700">
                                        Abonado: -${currentPaid.toFixed(2)}
                                    </span>
                                )}
                            </div>
                            <span className="text-xl font-semibold leading-none tabular-nums text-slate-900">
                                ${(estimatedTotal - currentPaid).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Pie limpio y compacto (igual a Nuevo Producto) */}
                <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3.5 sm:flex-nowrap sm:px-6 sm:py-3">
                    {isReadOnly ? (
                        <Button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="h-10 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-5 text-xs font-medium text-white shadow-sm sm:h-9 sm:w-auto sm:rounded-lg"
                        >
                            Cerrar
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleCloseWithPendingPrint}
                                disabled={isSubmitting}
                                className="h-10 rounded-xl border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 sm:h-9 sm:rounded-lg"
                            >
                                {sessionJobs.length > 0 ? `Terminar (${sessionJobs.length})` : "Cancelar"}
                            </Button>
                            {!repairJob && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isSubmitting}
                                    onClick={() => {
                                        addAnotherRef.current = true;
                                        void form.handleSubmit(onSubmit)();
                                    }}
                                    className="h-10 flex-1 rounded-xl border-blue-200 bg-blue-50/70 px-3.5 text-xs font-medium text-blue-700 hover:bg-blue-100 hover:text-blue-800 sm:h-9 sm:flex-none sm:rounded-lg"
                                    title="Guardar este equipo y agregar otro del mismo cliente"
                                >
                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                    Otro equipo
                                </Button>
                            )}
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                onClick={() => { addAnotherRef.current = false; }}
                                className="h-10 flex-1 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-4 text-xs font-medium text-white shadow-sm shadow-blue-500/20 hover:from-blue-500 hover:to-indigo-500 sm:h-9 sm:flex-none sm:px-5 sm:rounded-lg"
                            >
                                {isSubmitting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                                {repairJob
                                    ? "Guardar Cambios"
                                    : sessionJobs.length > 0
                                        ? `Finalizar (${sessionJobs.length + 1})`
                                        : "Registrar Reparación"}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </form>
        </Form>
        <ManualPartDialog open={manualQuickAddOpen} onOpenChange={setManualQuickAddOpen} onAdd={handleAddManualPart} />
        {replenishProduct && <ProductFormDialog product={replenishProduct} isOpen={!!replenishProduct} onOpenChange={(v) => !v && setReplenishProduct(null)} onSaved={handleAddPartFromInventory} />}
      </DialogContent>
    </Dialog>
  );
}
