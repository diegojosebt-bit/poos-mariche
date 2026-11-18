"use client";

import { ProductGrid } from "@/components/pos/product-grid";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CartItem, Product, RepairJob, HeldSale, Sale, ReservedPart } from "@/lib/types";
import { CartDisplay } from "@/components/pos/cart-display";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useCollection, useFirebase, useMemoFirebase, deleteDocumentNonBlocking, setDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, limit, orderBy } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Calculator, Plus, RefreshCw } from "lucide-react";
import { HeldSalesSheet } from "@/components/pos/held-sales-sheet";
import { POSActionsSheet } from "@/components/pos/pos-actions-sheet";
import { AddToCartFlash } from "@/components/pos/add-to-cart-flash";
import { PriceCalculatorDialog } from "@/components/tools/price-calculator-dialog";
import { CustomItemDialog } from "@/components/pos/custom-item-dialog";
import { SecurityGate } from "@/components/security-gate";
import { useDashboardStore } from "@/contexts/dashboard-context";
import { useCurrency } from '@/hooks/use-currency';
import { usePagedQuery } from '@/lib/firestore/use-paged-query';
import { useServerSearch } from '@/lib/firestore/use-server-search';
import { queryCache, type WithId } from '@/lib/firestore/query-cache';
import { fetchDocsByIds } from '@/lib/firestore/fetch-by-ids';
import { invalidateStatsRange } from '@/lib/firestore/stats-range';
import { useFeatureFlag } from '@/lib/features';
import { cn } from '@/lib/utils';

function POSContent() {
    const { firestore, user, isUserLoading } = useFirebase();
    const { toast } = useToast();
    const { getFinalPrice } = useCurrency();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [cart, setCart] = useState<CartItem[]>([]);
    const [mobilePane, setMobilePane] = useState<'products' | 'cart'>('products');
    // Confirmación al añadir: píldora flotante con check (se va sola).
    const [addFlash, setAddFlash] = useState<{ key: number; name: string; qty: number } | null>(null);
    const addFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [activeRepairJob, setActiveRepairJob] = useState<RepairJob | null>(null);
    const { addItemToCache, profile, desktopTopBarHost, mobileTopBarHost } = useDashboardStore();
    const uid = user?.uid ?? '';
    const usePaged = useFeatureFlag(profile, 'pagedData');
    const restoreFetchAttempts = useRef<Set<string>>(new Set());

    // LEGACY (bandera apagada): catálogo completo, como hasta ahora.
    const productsCollection = useMemoFirebase(() => 
        (firestore && user) ? collection(firestore, 'users', user.uid, 'products') : null,
        [firestore, user?.uid]
    );
    const legacy = useCollection<Product>(usePaged ? null : productsCollection);

    // FASE 2 (bandera encendida): 100 productos + "Cargar más".
    const paged = usePagedQuery<Product>({
        collectionName: 'products',
        orderField: 'name',
        orderDir: 'asc',
        pageSize: 100,
        enabled: usePaged,
    });

    const pagedProducts = useMemo(
        () => paged.items.filter((product) => !product.isDeleted),
        [paged.items],
    );

    const products = usePaged ? pagedProducts : legacy.data;
    const productsLoading = usePaged ? paged.isLoading : legacy.isLoading;

    /** Sustituye al `mutate` del hook legacy cuando la bandera está activa. */
    const mutateProducts = useCallback((updater: WithId<Product>[] | ((prev: WithId<Product>[] | null) => WithId<Product>[] | null)) => {
        if (!usePaged || !uid) {
            legacy.mutate(updater);
            return;
        }

        const current = paged.items;
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (!Array.isArray(next)) return;

        const currentById = new Map(current.map((item) => [item.id, item]));
        const nextIds = new Set(next.map((item) => item.id));

        next.forEach((item) => {
            if (!item?.id) return;
            const previous = currentById.get(item.id);
            if (!previous) {
                queryCache.mergeIntoCatalog(uid, 'products', [item]);
            } else if (previous !== item) {
                queryCache.patchItem(uid, 'products', item.id, item);
            }
        });

        current.forEach((item) => {
            if (item.id && !nextIds.has(item.id)) {
                queryCache.removeItem(uid, 'products', item.id);
            }
        });
    }, [usePaged, uid, paged.items, legacy.mutate]);

    // Búsqueda en servidor: los resultados se fusionan al catálogo y el grid
    // los muestra con su filtro local (sin cambiar el flujo de datos).
    const [productSearchTerm, setProductSearchTerm] = useState('');
    const serverSearchFlag = useFeatureFlag(profile, 'serverSearch');
    const productSearch = useServerSearch<Product>({
        collectionName: 'products',
        term: productSearchTerm,
        orderField: 'name',
        orderDir: 'asc',
        pageSize: 20,
        enabled: usePaged && serverSearchFlag,
        onResults: (found) => queryCache.mergeIntoCatalog(uid, 'products', found),
    });
    
    const heldSalesCollection = useMemoFirebase(() => 
        (firestore && user) ? collection(firestore, 'users', user.uid, 'held_sales') : null,
        [firestore, user?.uid]
    );
    const { data: heldSales } = useCollection<HeldSale>(heldSalesCollection);

    useEffect(() => {
        if (!user || isUserLoading) return;

        const repairJobData = searchParams.get('repairJob');
        const restoredSaleId = searchParams.get('restoredSaleId');
        const restoredCartItems = searchParams.get('items');
       
        if (restoredCartItems && products) {
            try {
                const itemsToRestore: CartItem[] = JSON.parse(decodeURIComponent(restoredCartItems));

                // Catálogo paginado: si la venta retenida apunta a productos que
                // no están en la página, se traen por id antes de restaurar.
                const missingIds = usePaged
                    ? Array.from(new Set(
                        itemsToRestore
                            .filter((item) => !item.isCustom && !products.some((p) => p.id === item.productId))
                            .map((item) => item.productId)
                            .filter((id) => !restoreFetchAttempts.current.has(id)),
                    ))
                    : [];

                if (missingIds.length > 0 && firestore && user) {
                    missingIds.forEach((id) => restoreFetchAttempts.current.add(id));
                    void fetchDocsByIds<Product>(firestore, user.uid, 'products', missingIds);
                    return; // el merge actualiza `products` y el efecto vuelve a entrar
                }

                // Si la venta retenida incluye combos, sus componentes también
                // deben estar en caché para descontar stock y calcular costo.
                const restoredProducts = itemsToRestore
                    .filter((item) => !item.isCustom)
                    .map((item) => products.find((p) => p.id === item.productId))
                    .filter((p): p is WithId<Product> => Boolean(p));

                const missingComboIds = usePaged
                    ? Array.from(new Set(
                        restoredProducts
                            .filter((p) => p.isCombo)
                            .flatMap((p) => (p.comboItems ?? []).map((c) => c.productId))
                            .filter((id) => !products.some((p) => p.id === id) && !restoreFetchAttempts.current.has(id)),
                    ))
                    : [];

                if (missingComboIds.length > 0 && firestore && user) {
                    missingComboIds.forEach((id) => restoreFetchAttempts.current.add(id));
                    void fetchDocsByIds<Product>(firestore, user.uid, 'products', missingComboIds);
                    return;
                }

                const restoredCart = itemsToRestore.map(item => {
                    if (item.isCustom) return item;
                    const product = products.find(p => p.id === item.productId);
                    if (!product) return null;
                    return { ...item, name: product.name };
                }).filter((item): item is CartItem => item !== null);

                setCart(restoredCart);
                setMobilePane('cart');
                if (restoredSaleId && firestore) {
                    deleteDocumentNonBlocking(doc(firestore, 'users', user.uid, 'held_sales', restoredSaleId));
                }
                router.replace('/dashboard/pos');
            } catch(e) {
                toast({ variant: "destructive", title: "Error", description: "No se pudo restaurar la venta." });
            }
        } else if (repairJobData) {
            try {
                const job: RepairJob = JSON.parse(decodeURIComponent(repairJobData));
                setActiveRepairJob(job);
                setCart([{ 
                    productId: job.id!, 
                    // El folio va en la línea del carrito: así se identifica la orden
                    // entre varias del mismo cliente y se puede buscar por él.
                    name: `Reparación: ${job.deviceMake} ${job.deviceModel} · ${job.id}`, 
                    quantity: 1, 
                    isRepair: true,
                    isPromo: !!job.isPromo 
                }]);
                // En móvil se abre directo el carrito: es lo que se va a cobrar.
                setMobilePane('cart');
            } catch (error) {
                router.push('/dashboard/repairs');
            }
        }
    }, [searchParams, user, isUserLoading, products, firestore, usePaged]);

    const getAvailableStock = (product: Product, catalog: Product[] = products ?? []) => {
        if (product.isCombo) {
             if (!product.comboItems || product.comboItems.length === 0) return 0;
             const stockCounts = product.comboItems.map(item => {
                 const component = catalog.find(p => p.id === item.productId);
                 if (!component) return 0;
                 const available = (Number(component.stockLevel) || 0) - (Number(component.reservedStock) || 0) - (Number(component.damagedStock) || 0);
                 return Math.floor(available / (item.quantity || 1));
             });
             return Math.min(...stockCounts);
        }
        return (Number(product.stockLevel) || 0) - (Number(product.reservedStock) || 0) - (Number(product.damagedStock) || 0);
    };

    const handleProductSelect = async (product: Product) => {
        let catalog = products ?? [];

        // Catálogo paginado: si el combo depende de productos fuera de la
        // página, se traen por id para calcular stock/costo correctamente.
        if (usePaged && product.isCombo && product.comboItems?.length && firestore && user) {
            const missing = product.comboItems
                .map((component) => component.productId)
                .filter((id) => !catalog.some((p) => p.id === id));

            if (missing.length > 0) {
                const fetched = await fetchDocsByIds<Product>(firestore, user.uid, 'products', missing);
                if (fetched.length > 0) catalog = [...catalog, ...fetched];
            }
        }

        const available = getAvailableStock(product, catalog);

        // Aviso inmediato: se comprueba antes de actualizar para poder confirmar.
        const existingItem = cart.find(i => i.productId === product.id && !i.isRepair && !i.isCustom);
        const nextQuantity = (existingItem?.quantity ?? 0) + 1;

        if (nextQuantity > available) {
            toast({
                variant: "warning",
                title: "Stock insuficiente",
                description: `Solo quedan ${available} unidades de "${product.name}".`,
            });
            return;
        }

        setCart(prev => {
            const existing = prev.find(i => i.productId === product.id && !i.isRepair && !i.isCustom);
            const currentQty = existing ? existing.quantity : 0;

            if (currentQty + 1 > available) return prev;

            if (existing) return prev.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
            
            const discountToApply = product.hasDiscount ? (product.discountAmount || 0) : 0;
            
            return [...prev, { 
                productId: product.id!, 
                name: product.name, 
                quantity: 1, 
                isPromo: false, // REQUERIMIENTO: No aplicar oferta automáticamente al añadir
                discount: discountToApply,
                // Costo y precio congelados: el checkout no depende de que el
                // producto siga en la página cargada.
                costPrice: product.costPrice,
                basePrice: getFinalPrice(product)
            }];
        });

        // Confirmación visible: sin esto, tocar un producto no daba ninguna señal.
        setAddFlash({ key: Date.now(), name: product.name, qty: nextQuantity });
        if (addFlashTimer.current) clearTimeout(addFlashTimer.current);
        addFlashTimer.current = setTimeout(() => setAddFlash(null), 1500);
        try { navigator.vibrate?.(15); } catch { /* sin vibración disponible */ }
    };

    const handleUpdateQuantity = (id: string, q: number) => {
        const product = products?.find(p => p.id === id);
        
        if (!product) {
            setCart(prev => prev.map(i => i.productId === id ? { ...i, quantity: q } : i));
            return;
        }

        const available = getAvailableStock(product);
        let finalQty = q;

        if (q > available) {
            toast({
                variant: "destructive",
                title: "Límite de Inventario",
                description: `No puedes vender más de ${available} unidades de este producto.`
            });
            finalQty = available;
        }

        setCart(prev => prev.map(i => i.productId === id ? { ...i, quantity: Math.max(0.001, finalQty) } : i));
    };

    const handleUpdateDiscount = (id: string, discount: number) => {
        setCart(prev => prev.map(i => i.productId === id ? { ...i, discount } : i));
    };

    const handleAddCustomItem = (name: string, price: number, costPrice: number) => {
        setCart(prev => [...prev, { productId: `custom-${Date.now()}`, name, quantity: 1, isCustom: true, customPrice: price, customCostPrice: costPrice }]);
    };

    const handleHoldSale = async (name: string) => {
        if (!firestore || !user || cart.length === 0) return;
        const ref = doc(collection(firestore, 'users', user.uid, 'held_sales'));
        const newHeldSale = { 
            id: ref.id, 
            name, 
            items: [...cart], 
            createdAt: new Date().toISOString() 
        };

        // INYECCIÓN ATÓMICA EN MEMORIA GLOBAL (0ms)
        addItemToCache('held_sales', newHeldSale);

        setDocumentNonBlocking(ref, newHeldSale, { merge: true });
        setCart([]);
    };

    const handleRemoveItem = (id: string, isRepair?: boolean) => {
        setCart(prev => prev.filter(i => {
            if (isRepair) return !(i.productId === id && i.isRepair);
            return !(i.productId === id && !i.isRepair);
        }));
    };

    const handleCheckoutSuccess = (sale: Sale, consumedParts?: ReservedPart[]) => {
        // 1. INYECCIÓN ATÓMICA EN REPORTE DE VENTAS (0ms)
        addItemToCache('sale_transactions', sale);
        if (user) {
            queryCache.mergeIntoCatalog(user.uid, 'sale_transactions', [sale as WithId<Sale>]);
            invalidateStatsRange(user.uid);
        }

        // 2. ACTUALIZACIÓN DE STOCK EN MEMORIA
        mutateProducts((currentProducts) => {
            if (!currentProducts) return null;
            const productsMap = new Map(currentProducts.map(p => [p.id, { ...p }]));
            let modified = false;

            sale.items.forEach(item => {
                if (item.isRepair || item.isCustom) return;
                const p = productsMap.get(item.productId);
                if (p) {
                    p.stockLevel -= item.quantity;
                    p.salesCount = (p.salesCount || 0) + item.quantity;
                    modified = true;
                }
            });

            if (consumedParts) {
                consumedParts.forEach(part => {
                    if (part.isManual) return;
                    const p = productsMap.get(part.productId);
                    if (p) {
                        p.stockLevel -= part.quantity;
                        p.reservedStock = Math.max(0, (p.reservedStock || 0) - part.quantity);
                        p.salesCount = (p.salesCount || 0) + part.quantity;
                        modified = true;
                    }
                });
            }

            return modified ? Array.from(productsMap.values()) : currentProducts;
        });
        
        setActiveRepairJob(null);
        localStorage.removeItem('mm_repair_draft');
    };

    const cartCount = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);

    useEffect(() => () => {
        if (addFlashTimer.current) clearTimeout(addFlashTimer.current);
    }, []);

    return (
        <div className="flex-1 flex flex-col bg-slate-100/70 text-slate-900 overflow-hidden">
            {/* Inyección unificada de acciones de POS en la barra superior (1 sola fila) */}
            {desktopTopBarHost && createPortal(
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <HeldSalesSheet heldSales={heldSales || []} />
                    <PriceCalculatorDialog>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-9 px-2.5 sm:px-3 rounded-full border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs text-xs font-medium flex items-center gap-1.5 transition-all" 
                            aria-label="Calculadora de precios" 
                            title="Calculadora de precios"
                        >
                            <Calculator className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                            <span className="hidden lg:inline">Calculadora</span>
                        </Button>
                    </PriceCalculatorDialog>
                    <CustomItemDialog 
                        onAddCustomItem={handleAddCustomItem} 
                        trigger={
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-9 px-2.5 sm:px-3 rounded-full border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs text-xs font-medium flex items-center gap-1.5 transition-all" 
                                title="Venta Rápida (Artículo Manual)"
                            >
                                <Plus className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                <span className="hidden lg:inline">Venta Rápida</span>
                            </Button>
                        }
                    />
                </div>,
                desktopTopBarHost
            )}

            {mobileTopBarHost && createPortal(
                <div className="flex items-center gap-1">
                    <HeldSalesSheet heldSales={heldSales || []} />
                    <POSActionsSheet onAddCustomItem={handleAddCustomItem} />
                </div>,
                mobileTopBarHost
            )}

            {/* En móvil sólo se ve un panel a la vez: evita dos scrolls anidados */}
            <div className="border-b border-slate-200/80 bg-white px-2 py-1.5 md:hidden">
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1 border border-slate-200/70" role="tablist" aria-label="Vista de venta">
                    <Button
                        role="tab"
                        aria-selected={mobilePane === 'products'}
                        variant="ghost"
                        className={cn(
                            "h-8 flex-1 rounded-lg text-xs font-semibold text-slate-600 transition-all",
                            mobilePane === 'products' && "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white shadow-xs font-bold hover:text-white"
                        )}
                        onClick={() => setMobilePane('products')}
                    >
                        Productos
                    </Button>
                    <Button
                        role="tab"
                        aria-selected={mobilePane === 'cart'}
                        variant="ghost"
                        className={cn(
                            "h-8 flex-1 gap-1.5 rounded-lg text-xs font-semibold text-slate-600 transition-all",
                            mobilePane === 'cart' && "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white shadow-xs font-bold hover:text-white"
                        )}
                        onClick={() => setMobilePane('cart')}
                    >
                        Carrito
                        {cartCount > 0 && (
                            <span
                                key={cartCount}
                                className="mm-bump rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white shadow-xs"
                            >
                                {cartCount}
                            </span>
                        )}
                    </Button>
                </div>
            </div>

            <main className="flex-1 flex flex-col md:grid md:grid-cols-3 lg:grid-cols-5 overflow-hidden bg-slate-100/70">
                <div className={cn(
                    "order-1 md:order-2 md:col-span-2 lg:col-span-3 p-2 sm:p-4 overflow-hidden flex flex-col flex-1 min-h-0 bg-slate-100/60",
                    mobilePane === 'cart' && "hidden md:flex"
                )}>
                     <ProductGrid 
                        products={products || []} 
                        onProductSelect={handleProductSelect} 
                        isLoading={productsLoading}
                        mutateProducts={mutateProducts}
                        hasMore={usePaged ? paged.hasMore : false}
                        isLoadingMore={paged.isLoadingMore}
                        onLoadMore={usePaged ? () => { void paged.loadMore(); } : undefined}
                        onSearchChange={setProductSearchTerm}
                        isServerSearching={usePaged && serverSearchFlag && productSearch.isSearching}
                    />
                </div>
                <div className={cn(
                    "order-2 md:order-1 md:col-span-1 lg:col-span-2 bg-white border-t md:border-t-0 md:border-r border-slate-200/80 flex flex-col flex-1 min-h-0 md:h-full",
                    mobilePane === 'products' && "hidden md:flex"
                )}>
                    <CartDisplay 
                        cart={cart}
                        allProducts={products || []}
                        onUpdateQuantity={handleUpdateQuantity}
                        onUpdateDiscount={handleUpdateDiscount}
                        onRemoveItem={handleRemoveItem}
                        onClearCart={() => setCart([])}
                        onTogglePromo={(id) => setCart(prev => prev.map(i => i.productId === id ? { ...i, isPromo: !i.isPromo } : i))}
                        onToggleGift={(id) => setCart(prev => prev.map(i => i.productId === id ? { ...i, isGift: !i.isGift } : i))}
                        onHoldSale={handleHoldSale}
                        onCheckoutSuccess={handleCheckoutSuccess}
                        repairJobId={activeRepairJob?.id}
                        onBrowseProducts={() => setMobilePane('products')}
                    />
                </div>
            </main>
        {addFlash && (
            <AddToCartFlash name={addFlash.name} quantity={addFlash.qty} flashKey={addFlash.key} />
        )}
        </div>
    )
}

export default function POSPage() {
    return (
        <SecurityGate module="pos">
            <Suspense fallback={<div>Cargando...</div>}>
                <POSContent />
            </Suspense>
        </SecurityGate>
    )
}
