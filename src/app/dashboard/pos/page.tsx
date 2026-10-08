"use client";

import { ProductGrid } from "@/components/pos/product-grid";
import { Suspense, useEffect, useState } from "react";
import type { CartItem, Product, RepairJob, HeldSale, Sale, ReservedPart } from "@/lib/types";
import { CartDisplay } from "@/components/pos/cart-display";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRouter } from "next/navigation";
import { useCollection, useFirebase, useMemoFirebase, deleteDocumentNonBlocking, setDocumentNonBlocking } from "@/firebase";
import { collection, doc, query, limit, orderBy } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Calculator } from "lucide-react";
import { HeldSalesSheet } from "@/components/pos/held-sales-sheet";
import { PriceCalculatorDialog } from "@/components/tools/price-calculator-dialog";
import { CustomItemDialog } from "@/components/pos/custom-item-dialog";
import { SecurityGate } from "@/components/security-gate";
import { useDashboardStore } from "@/contexts/dashboard-context";

function POSContent() {
    const { firestore, user, isUserLoading } = useFirebase();
    const { toast } = useToast();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [cart, setCart] = useState<CartItem[]>([]);
    const [activeRepairJob, setActiveRepairJob] = useState<RepairJob | null>(null);
    const { addItemToCache } = useDashboardStore();

    // ESTANDARIZADO: Límite 200 productos para compartir cache global
    const productsCollection = useMemoFirebase(() => 
        (firestore && user) ? query(collection(firestore, 'users', user.uid, 'products'), orderBy('name'), limit(200)) : null,
        [firestore, user?.uid]
    );
    const { data: products, isLoading: productsLoading, mutate: mutateProducts } = useCollection<Product>(productsCollection);
    
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
                const restoredCart = itemsToRestore.map(item => {
                    if (item.isCustom) return item;
                    const product = products.find(p => p.id === item.productId);
                    if (!product) return null;
                    return { ...item, name: product.name };
                }).filter((item): item is CartItem => item !== null);

                setCart(restoredCart);
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
                    name: `Reparación: ${job.deviceMake} ${job.deviceModel}`, 
                    quantity: 1, 
                    isRepair: true,
                    isPromo: !!job.isPromo 
                }]);
            } catch (error) {
                router.push('/dashboard/repairs');
            }
        }
    }, [searchParams, user, isUserLoading, products, firestore]);

    const getAvailableStock = (product: Product) => {
        if (!products) return 0;
        if (product.isCombo) {
             if (!product.comboItems || product.comboItems.length === 0) return 0;
             const stockCounts = product.comboItems.map(item => {
                 const component = products.find(p => p.id === item.productId);
                 if (!component) return 0;
                 const available = (Number(component.stockLevel) || 0) - (Number(component.reservedStock) || 0) - (Number(component.damagedStock) || 0);
                 return Math.floor(available / (item.quantity || 1));
             });
             return Math.min(...stockCounts);
        }
        return (Number(product.stockLevel) || 0) - (Number(product.reservedStock) || 0) - (Number(product.damagedStock) || 0);
    };

    const handleProductSelect = (product: Product) => {
        const available = getAvailableStock(product);
        
        setCart(prev => {
            const existing = prev.find(i => i.productId === product.id && !i.isRepair && !i.isCustom);
            const currentQty = existing ? existing.quantity : 0;

            if (currentQty + 1 > available) {
                toast({
                    variant: "destructive",
                    title: "Stock Insuficiente",
                    description: `Solo quedan ${available} unidades disponibles de "${product.name}".`
                });
                return prev;
            }

            if (existing) return prev.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
            
            const discountToApply = product.hasDiscount ? (product.discountAmount || 0) : 0;
            
            return [...prev, { 
                productId: product.id!, 
                name: product.name, 
                quantity: 1, 
                isPromo: false, // REQUERIMIENTO: No aplicar oferta automáticamente al añadir
                discount: discountToApply
            }];
        });
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
        }, false);
        
        setActiveRepairJob(null);
        localStorage.removeItem('mm_repair_draft');
    };

    return (
        <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
             <header className="bg-white flex h-14 items-center gap-4 border-b px-4 sm:h-16 sm:px-6">
                <div className="flex items-center gap-2">
                    <SidebarTrigger />
                    <h1 className="text-lg font-semibold truncate max-w-[120px] sm:max-w-none">Punto de Venta</h1>
                </div>
                <div className="ml-auto flex items-center gap-1 sm:gap-2">
                    <PriceCalculatorDialog><Button variant="outline" size="icon" className="h-8 w-8 sm:h-10 sm:w-10"><Calculator className="h-4 w-4" /></Button></PriceCalculatorDialog>
                    <CustomItemDialog onAddCustomItem={handleAddCustomItem} />
                    <HeldSalesSheet heldSales={heldSales || []} />
                </div>
            </header>
            <main className="flex-1 flex flex-col md:grid md:grid-cols-3 lg:grid-cols-5 overflow-hidden">
                <div className="order-1 md:order-2 md:col-span-2 lg:col-span-3 p-2 sm:p-4 overflow-hidden flex flex-col">
                     <ProductGrid 
                        products={products || []} 
                        onProductSelect={handleProductSelect} 
                        isLoading={productsLoading}
                        mutateProducts={mutateProducts}
                    />
                </div>
                <div className="order-2 md:order-1 md:col-span-1 lg:col-span-2 bg-white border-t md:border-t-0 md:border-r flex flex-col h-[45vh] md:h-full">
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
                    />
                </div>
            </main>
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
