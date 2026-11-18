"use client";

import type { Product } from "@/lib/types";
import { Card, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { useMemo, useState, useEffect } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { Search, Sparkles, Loader2, PlusCircle } from "lucide-react";import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "../ui/button";
import { useDebounce } from "use-debounce";
import { normalizeText } from "@/lib/search-index";
import { formatCategoryName } from "@/lib/inventory-utils";

type ProductGridProps = {
  products: Product[];
  onProductSelect: (product: Product) => void;
  isLoading?: boolean;
  mutateProducts: (updater: any) => void;
  /** Catálogo paginado: hay más productos en el servidor. */
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Notifica el término para disparar la búsqueda en servidor. */
  onSearchChange?: (term: string) => void;
  isServerSearching?: boolean;
};

const ITEMS_PER_PAGE = 24;

export function ProductGrid({ products, onProductSelect, isLoading, mutateProducts, hasMore, isLoadingMore, onLoadMore, onSearchChange, isServerSearching }: ProductGridProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch] = useDebounce(searchTerm, 300);
  const { format, getSymbol, getFinalPrice, convert } = useCurrency();
  const [currentPage, setCurrentPage] = useState(1);

  const categories = useMemo(() => {
    if (!products) return ['Todos'];
    const seen = new Map<string, string>();
    for (const p of products) {
      const formatted = formatCategoryName(p.category);
      if (formatted) {
        const key = formatted.toLowerCase();
        if (!seen.has(key)) seen.set(key, formatted);
      }
    }
    return ['Todos', ...Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [products]);

  const [activeCategory, setActiveCategory] = useState('Todos');

  // En pantallas táctiles el autoFocus abre el teclado y empuja la rejilla.
  const [autoFocusSearch, setAutoFocusSearch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    setAutoFocusSearch(window.matchMedia('(pointer: fine)').matches);
  }, []);

  // FILTRADO EN MEMORIA RAM (0 LECTURAS, 0ms DE LATENCIA)
  // Normaliza acentos y signos para que "bateria" encuentre "Batería".
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const term = normalizeText(debouncedSearch);

    return products.filter((product) => {
        if (activeCategory !== 'Todos' && formatCategoryName(product.category).toLowerCase() !== activeCategory.toLowerCase()) return false;
        if (!term) return true;

        return (
            normalizeText(product.name).includes(term) ||
            normalizeText(product.sku).includes(term) ||
            normalizeText(product.barcode).includes(term) ||
            normalizeText((product.compatibleModels ?? []).join(' ')).includes(term)
        );
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [products, activeCategory, debouncedSearch]);

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
        <div className="mb-2.5 flex shrink-0 items-center gap-2">
            <Select value={activeCategory} onValueChange={setActiveCategory}>
                <SelectTrigger className="h-10 w-[116px] shrink-0 truncate text-xs sm:h-9 sm:w-[160px] rounded-xl border-slate-200 bg-white text-slate-800 shadow-2xs hover:bg-slate-50 focus:ring-blue-500/20">
                    <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-800 shadow-xl">
                    {categories.map(cat => (
                        <SelectItem key={cat} value={cat} className="text-xs text-slate-700 focus:bg-slate-100 focus:text-slate-900">{cat}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    type="search"
                    name="mm-pos-search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Buscar producto o escanear código..."
                    className="h-10 w-full pl-9 text-base sm:h-9 sm:text-xs rounded-xl border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 shadow-2xs focus-visible:border-blue-500 focus-visible:ring-blue-500/20"
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        onSearchChange?.(e.target.value);
                    }}
                    enterKeyHint="search"
                    autoFocus={autoFocusSearch}
                />
                {isServerSearching && (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-blue-600" />
                )}
            </div>
        </div>

        <div className="relative flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-1 gap-1.5 pr-2 sm:grid-cols-3 sm:gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                {isLoading ? (
                    Array.from({ length: 18 }).map((_, i) => (
                        <Card key={`skeleton-${i}`} className="h-[120px] bg-white border-slate-200 shadow-2xs">
                            <CardHeader className="p-2 space-y-2">
                               <Skeleton className="h-4 w-3/4 bg-slate-100" />
                               <Skeleton className="h-3 w-1/2 bg-slate-100" />
                            </CardHeader>
                            <CardFooter className="p-2 flex justify-end mt-auto">
                                <Skeleton className="h-4 w-1/3 bg-slate-100" />
                            </CardFooter>
                        </Card>
                    ))
                ) : paginatedProducts.map((product) => {
                    const availableStock = getAvailableStock(product);
                    // Combo con componentes fuera de la página: se deja seleccionar
                    // para que el POS los traiga por id y calcule el stock real.
                    const missingComboComponent = !!product.isCombo &&
                        (product.comboItems ?? []).some((item) => !products.some((p) => p.id === item.productId));
                    const canSelect = availableStock > 0 || missingComboComponent;
                    const unitLabel = product.unit && product.unit !== 'unit' ? product.unit : '';
                    const lowThreshold = product.lowStockThreshold || 1;
                    const stockTone = availableStock <= 0
                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                        : availableStock <= lowThreshold
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200";
                    
                    const basePrice = getFinalPrice(product);
                    // REQUERIMIENTO: Mostrar siempre el precio base en la rejilla
                    const displayPrice = basePrice;
                    const displayPriceBs = convert(displayPrice, 'USD', 'Bs');

                    const isNewInCache = product.createdAt === undefined; 

                    return (
                        <Card
                            key={product.id}
                            onClick={() => canSelect && onProductSelect(product)}
                            className={cn(
                                // Móvil: fila ancha. Escritorio: ficha en columna.
                                "group relative flex cursor-pointer flex-row items-center gap-3 overflow-hidden rounded-xl border border-slate-200/90 bg-white p-2.5 shadow-2xs transition-all duration-150 hover:border-blue-400 hover:shadow-md active:scale-[0.99] sm:flex-col sm:items-stretch sm:gap-0 sm:p-0",
                                !canSelect && "opacity-45 cursor-not-allowed bg-slate-50 border-slate-200/60 border-dashed"
                            )}
                        >
                            {isNewInCache && (
                                <div className="absolute right-0 top-0 z-10 hidden rounded-bl-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-1.5 py-0.5 text-white shadow-xs sm:block">
                                    <Sparkles className="w-2.5 h-2.5" />
                                </div>
                            )}

                            {/* 1. Nombre + unidad/stock (móvil) */}
                            <div className="min-w-0 flex-1 overflow-hidden sm:p-2.5 sm:pb-1.5">
                                <h3 className="line-clamp-2 w-full break-words text-xs font-medium leading-snug text-slate-800 group-hover:text-blue-600 transition-colors">
                                    {product.name}
                                </h3>
                                <p className={cn(
                                    "mt-0.5 truncate text-[10px] font-normal sm:hidden",
                                    canSelect ? "text-slate-500" : "text-rose-600 font-medium"
                                )}>
                                    {unitLabel ? `/${unitLabel} · ` : ''}
                                    {missingComboComponent ? '?' : availableStock} disp.
                                </p>
                                {product.compatibleModels && product.compatibleModels.length > 0 && (
                                    <p className="hidden truncate text-[10px] font-normal text-slate-400 sm:block mt-0.5">
                                        {product.compatibleModels.join(', ')}
                                    </p>
                                )}
                            </div>

                            {/* 2. Precio (+ stock en escritorio) */}
                            <div className="shrink-0 text-right sm:mt-auto sm:flex sm:items-center sm:justify-between sm:gap-1.5 sm:border-t sm:border-slate-100 sm:bg-slate-50/70 sm:p-2 sm:text-left sm:transition-colors sm:group-hover:bg-slate-100/70">
                                <div className="sm:min-w-0">
                                    <div className="text-[13px] font-semibold leading-none tabular-nums text-slate-900">
                                        {getSymbol('USD')}{format(displayPrice, 'USD')}
                                    </div>
                                    <div className="mt-1 truncate text-[11px] font-normal tabular-nums text-emerald-700">
                                        {getSymbol('Bs')}{format(displayPriceBs, 'Bs')}
                                    </div>
                                </div>
                                <span
                                    title={`Disponibles: ${missingComboComponent ? '?' : availableStock}`}
                                    className={cn(
                                        "hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums sm:inline-block",
                                        stockTone
                                    )}
                                >
                                    {missingComboComponent ? '?' : availableStock}
                                </span>
                            </div>
                        </Card>
                    )
                })}
            </div>
          </ScrollArea>
        </div>
        <div className="flex items-center justify-between pt-2.5 pb-1 flex-shrink-0 bg-transparent mt-auto border-t border-slate-200/90 gap-2">
            <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-normal">
                    Pág. <span className="text-slate-800 font-medium">{currentPage}</span> de {totalPages} ({filteredProducts.length} producto{filteredProducts.length === 1 ? '' : 's'})
                </span>
                {onLoadMore && hasMore && (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-9 px-2.5 text-xs font-medium sm:h-7 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm"
                        onClick={onLoadMore}
                        disabled={isLoadingMore}
                    >
                        {isLoadingMore
                            ? <Loader2 className="w-3 h-3 animate-spin text-white" />
                            : <PlusCircle className="w-3 h-3 text-white" />}
                        <span className="ml-1">Cargar 100 más</span>
                    </Button>
                )}
            </div>
            {totalPages > 1 && (
                <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-9 px-2.5 text-xs font-medium sm:h-7 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-2xs" onClick={handlePreviousPage} disabled={currentPage === 1}>Anterior</Button>
                    <Button variant="outline" size="sm" className="h-9 px-2.5 text-xs font-medium sm:h-7 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-2xs" onClick={handleNextPage} disabled={currentPage >= totalPages}>Siguiente</Button>
                </div>
            )}
        </div>
    </div>
  );
}