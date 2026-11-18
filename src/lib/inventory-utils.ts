import type { Product } from "@/lib/types";

/**
 * Stock realmente vendible de un producto.
 * Los combos se limitan por su componente más escaso.
 *
 * Fuente única para la tabla de escritorio y la tarjeta móvil.
 */
export function getAvailableStock(product: Product, allProducts: Product[] = []): number {
  const reserved = Number(product.reservedStock) || 0;
  const damaged = Number(product.damagedStock) || 0;

  if (product.isCombo) {
    const comboItems = product.comboItems || [];
    if (comboItems.length === 0 || allProducts.length === 0) return 0;

    return Math.min(
      ...comboItems.map((item) => {
        const component = allProducts.find((p) => p.id === item.productId);
        if (!component) return 0;
        const available =
          (Number(component.stockLevel) || 0) -
          (Number(component.reservedStock) || 0) -
          (Number(component.damagedStock) || 0);
        return Math.floor(available / (item.quantity || 1));
      })
    );
  }

  return (Number(product.stockLevel) || 0) - reserved - damaged;
}

/** Nivel de alerta de stock, para pintar el indicador en móvil. */
export function getStockLevel(available: number, threshold: number): "out" | "low" | "ok" {
  if (available <= 0) return "out";
  if (available <= (threshold || 1)) return "low";
  return "ok";
}

/** Formatea una categoría con la primera letra en mayúscula y el resto en minúsculas (para guardar y mostrar). */
export function formatCategoryName(value?: string | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Formatea mientras se escribe sin recortar espacios finales (permite escribir varias palabras). */
export function formatCategoryInput(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
