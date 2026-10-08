"use client";

import type { Product } from "@/lib/types";
import { Card, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { useMemo, useState, useEffect } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { TicketPercent, Search, PackagePlus, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "../ui/button";
import { useDebounce } from "use-debounce";
import { useFirebase } from "@/firebase";
import { collection, query, where, limit, getDocs } from "firebase/firestore";

type ProductGridProps = {
  products: Product[];
  onProductSelect: (product: Product) => void;
  isLoading?: boolean;
  mutateProducts: (updater: any) => void;
};

const ITEMS_PER_PAGE = 20;

export function ProductGrid({ products, onProductSelect, isLoading, mutateProducts }: ProductGridProps) {
  const { firestore, user } = useFirebase();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch] = useDebounce(searchTerm, 400);
  const { format, getSymbol, getFinalPrice, convert } = useCurrency();
  const [currentPage, setCurrentPage] = useState(1);
  const [isFallbackLoading, setIsFallbackLoading] = useState(false);
  const [lastSearchedTerm, setLastSearchedTerm] = useState("");

  const categories = useMemo(() => {
    if (!products) return ['Todos'];
    const cats = products.map(p => p.category);
    return ['Todos', ...Array.from(new Set(cats))];
  }, [products]);

  const [activeCategory, setActiveCategory] = useState('Todos');

  // FILTRADO LOCAL (PASO 1 - 0 LECTURAS)
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const term = debouncedSearch.toLowerCase().trim();
    
    return products.filter(
        (product) =>
        (activeCategory === 'Todos' || product.category === activeCategory) &&
        (
            product.name.toLowerCase().includes(term) ||
            (product.sku && product.sku.toLowerCase().includes(term)) ||
            (product.barcode && product.barcode.toLowerCase().includes(term)) ||
            (product.compatibleModels && product.compatibleModels.some(model => model.toLowerCase().includes(term)))
        )
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [products, activeCategory, debouncedSearch]);

  // BÚSQUEDA BAJO DEMANDA (PASO 2 - FALLBACK DE 1 LECTURA)
  useEffect(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!firestore || !user || term.length < 3 || term === lastSearchedTerm) return;

    // Solo consultamos a la nube si la memoria RAM no tiene resultados para este término
    if (filteredProducts.length === 0 && !isLoading) {
        const performFallbackSearch = async () => {
            setIsFallbackLoading(true);
            setLastSearchedTerm(term);
            try {
                // Buscamos por palabras clave en el índice global del servidor
                const q = query(
                    collection(firestore, 'users', user.uid, 'products'),
                    where('searchKeywords', 'array-contains', term),
                    limit(5)
                );
                
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const newProducts = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Product);
                    
                    // INYECCIÓN EN MEMORIA GLOBAL
                    mutateProducts((prev: Product[] | null) => {
                        const existingIds = new Set((prev || []).map(p => p.id));
                        const uniqueNew = newProducts.filter(p => !existingIds.has(p.id));
                        return [...(prev || []), ...uniqueNew];
                    });
                }
            } catch (e) {
                console.error("Fallback search failed:", e);
            } finally {
                setIsFallbackLoading(false);
            }
        };

        performFallbackSearch();
    }
  }, [debouncedSearch, filteredProducts.length, firestore, user, isLoading, mutateProducts, lastSearchedTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, debouncedSearch]);
  
  const { paginatedProducts, totalPages } = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginated = filteredProducts.slice(startIndex, endIndex);
    const pages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
    return { paginatedProducts: paginated, totalPages: pages };
  }, [currentPage, filteredProducts]);

  const getAvailableStock = (product: Product) => {
      if (product.isCombo) {
           if (!product.comboItems || product.comboItems.length === 0 || !products) return 0;
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
  
  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-2 mb-3 shrink-0">
            <Select value={activeCategory} onValueChange={setActiveCategory}>
                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs">
                    <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                    {categories.map(cat => (
                        <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                    type="search"
                    placeholder="Buscar producto o escanear código..."
                    className="w-full pl-8 h-8 text-xs"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                />
                {isFallbackLoading && (
                    <div className="absolute right-2 top-1.5 flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 border border-blue-100 animate-in fade-in duration-300">
                        <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                        <span className="text-[9px] font-black text-blue-600 uppercase tracking-tighter">Buscando...</span>
                    </div>
                )}
            </div>
        </div>

        <div className="relative flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-1.5 sm:gap-2 pr-2">
                {isLoading ? (
                    Array.from({ length: 18 }).map((_, i) => (
                        <Card key={`skeleton-${i}`} className="h-[120px]">
                            <CardHeader className="p-2 space-y-2">
                               <Skeleton className="h-4 w-3/4" />
                               <Skeleton className="h-3 w-1/2" />
                            </CardHeader>
                            <CardFooter className="p-2 flex justify-end mt-auto">
                                <Skeleton className="h-4 w-3/3" />
                            </CardFooter>
                        </Card>
                    ))
                ) : paginatedProducts.map((product) => {
                    const availableStock = getAvailableStock(product);
                    const promoPrice = (typeof product.promoPrice === 'number' && product.promoPrice > 0) ? product.promoPrice : 0;
                    const hasPromo = promoPrice > 0;
                    const unitLabel = product.unit && product.unit !== 'unit' ? product.unit : 'pza';
                    
                    const basePrice = getFinalPrice(product);
                    // REQUERIMIENTO: Mostrar siempre el precio base en la rejilla
                    const displayPrice = basePrice;
                    const displayPriceBs = convert(displayPrice, 'USD', 'Bs');

                    const isNewInCache = product.createdAt === undefined; 

                    return (
                        <Card
                            key={product.id}
                            onClick={() => availableStock > 0 && onProductSelect(product)}
                            className={cn(
                                "cursor-pointer hover:border-primary transition-all flex flex-col justify-between h-full group border shadow-sm relative overflow-hidden",
                                availableStock <= 0 && "opacity-50 cursor-not-allowed bg-slate-50 border-dashed"
                            )}
                        >
                            {isNewInCache && (
                                <div className="absolute top-0 right-0 p-0.5 bg-blue-600 text-white z-10 rounded-bl-md shadow-md">
                                    <Sparkles className="w-2.5 h-2.5" />
                                </div>
                            )}
                            <CardHeader className="p-1.5 pb-1 space-y-0.5">
                                <CardTitle className="text-[10px] sm:text-[11px] font-bold leading-tight line-clamp-2 min-h-[1.8rem] flex gap-1 items-start">
                                  <span className="flex-1 uppercase">{product.name}</span>
                                </CardTitle>
                                {product.compatibleModels && product.compatibleModels.length > 0 && (
                                  <p className="text-[8px] text-muted-foreground truncate opacity-70">{product.compatibleModels.join(', ')}</p>
                                )}
                            </CardHeader>
                            <CardFooter className="p-1.5 flex flex-col items-stretch gap-0.5 mt-auto border-t bg-slate-50/50 group-hover:bg-white transition-colors">
                                <div className="flex justify-between items-center">
                                    <span className={cn("text-[8px] font-black uppercase", availableStock <= 0 ? "text-destructive" : "text-slate-500")}>
                                        S: {availableStock}
                                    </span>
                                    <div className="text-xs font-black text-primary">
                                      {getSymbol('USD')}{format(displayPrice, 'USD')}
                                      {hasPromo && (
                                          <span className="ml-1 text-[8px] text-green-600 font-bold" title={`Oferta: $${promoPrice}`}>
                                              <TicketPercent className="w-2 h-2 inline-block mr-0.5"/>
                                              ${format(promoPrice, 'USD')}
                                          </span>
                                      )}
                                    </div>
                                </div>
                                <div className="text-[8px] sm:text-[9px] text-muted-foreground font-bold flex justify-between pt-0.5 opacity-80">
                                  <span className="text-[7px]">{unitLabel.toUpperCase()}</span>
                                  <span>{getSymbol('Bs')}{format(displayPriceBs, 'Bs')}</span>
                                </div>
                            </CardFooter>
                        </Card>
                    )
                })}
            </div>
          </ScrollArea>
        </div>
         {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 flex-shrink-0 bg-white/80 backdrop-blur-sm mt-auto border-t">
                <span className="text-[9px] text-muted-foreground font-black uppercase">
                    Pág. {currentPage} / {totalPages}
                </span>
                <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-6 text-[9px] px-2 font-bold" onClick={handlePreviousPage} disabled={currentPage === 1}>Anterior</Button>
                    <Button variant="outline" size="sm" className="h-6 text-[9px] px-2 font-bold" onClick={handleNextPage} disabled={currentPage >= totalPages}>Siguiente</Button>
                </div>
            </div>
        )}
    </div>
  );
}