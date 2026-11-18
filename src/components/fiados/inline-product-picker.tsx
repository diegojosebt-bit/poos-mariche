"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PackageSearch, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { normalizeText } from "@/lib/search-index";
import type { Product } from "@/lib/types";

/**
 * Selector de productos EN LÍNEA (sin popover portal ni cmdk).
 *
 * Usa un contenedor único con transición suave de altura (`grid-rows`)
 * para evitar saltos bruscos al abrir/cerrar y funcionar de forma 100%
 * confiable con mouse, teclado y toque dentro de Radix Dialog.
 */
export function InlineProductPicker({
  products,
  onPick,
  getPrice,
  label = "Buscar producto...",
}: {
  products: Product[];
  onPick: (product: Product) => void;
  getPrice?: (product: Product) => number;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [term, setTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [isOpen]);

  const results = useMemo(() => {
    const q = normalizeText(term);
    const list = (products || []).filter((p) => !p.isDeleted);
    if (!q) return list.slice(0, 30);
    return list
      .filter((p) => {
        return (
          normalizeText(p.name).includes(q) ||
          normalizeText(p.sku).includes(q) ||
          normalizeText(p.barcode).includes(q) ||
          normalizeText(p.category).includes(q) ||
          normalizeText((p.compatibleModels ?? []).join(" ")).includes(q)
        );
      })
      .slice(0, 30);
  }, [products, term]);

  const handleSelect = (product: Product) => {
    onPick(product);
    setTerm("");
    setIsOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden rounded-xl border bg-white transition-all duration-200 ease-out",
        isOpen
          ? "border-blue-300 shadow-sm ring-2 ring-blue-500/10"
          : "border-slate-200 hover:border-slate-300"
      )}
    >
      {/* Barra de búsqueda unificada (siempre en su sitio, sin saltos bruscos) */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 transition-colors duration-200",
          isOpen ? "bg-slate-50/70" : "bg-white"
        )}
      >
        {isOpen ? (
          <Search className="h-4 w-4 shrink-0 text-blue-600 transition-colors" />
        ) : (
          <PackageSearch className="h-4 w-4 shrink-0 text-blue-600 transition-colors" />
        )}
        <Input
          ref={inputRef}
          type="search"
          name="mm-catalog-filter"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          value={term}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsOpen(false);
              setTerm("");
              inputRef.current?.blur();
            } else if (event.key === "Enter" && results.length > 0) {
              event.preventDefault();
              handleSelect(results[0]);
            }
          }}
          placeholder={label}
          className="h-10 sm:h-9 border-0 bg-transparent px-0 text-xs text-slate-900 placeholder:text-slate-500 shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={() => {
            setTerm("");
            setIsOpen(false);
            inputRef.current?.blur();
          }}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 transition-all duration-150 cursor-pointer",
            isOpen || term ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"
          )}
          tabIndex={isOpen ? 0 : -1}
          aria-label="Cerrar buscador"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Lista desplegable con animación fluida de altura y opacidad */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        <div className="overflow-hidden">
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 border-t border-slate-100">
            {results.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                Sin productos que coincidan con la búsqueda.
              </p>
            ) : (
              results.map((product) => {
                const price = getPrice ? getPrice(product) : undefined;
                const availableStock = Number(product.stockLevel) || 0;
                const isOutOfStock = availableStock <= 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    tabIndex={isOpen ? 0 : -1}
                    disabled={isOutOfStock}
                    onClick={() => handleSelect(product)}
                    className={cn(
                      "group flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors",
                      isOutOfStock
                        ? "opacity-60 bg-slate-50/50 cursor-not-allowed"
                        : "hover:bg-blue-50/50 active:bg-blue-50 cursor-pointer"
                    )}
                    title={isOutOfStock ? "Sin stock disponible para fiar" : undefined}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-xs font-medium", isOutOfStock ? "text-slate-500" : "text-slate-800 group-hover:text-blue-700")}>
                        {product.name}
                      </p>
                      {product.sku && (
                        <p className="truncate text-[10px] font-mono text-slate-400">
                          {product.sku}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {typeof price === "number" && (
                        <span className="text-xs font-semibold tabular-nums text-slate-700">
                          ${price.toFixed(2)}
                        </span>
                      )}
                      {isOutOfStock ? (
                        <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                          0 disp. (Agotado)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          {availableStock} disp.
                        </Badge>
                      )}
                      {!isOutOfStock && (
                        <span className="hidden sm:flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
