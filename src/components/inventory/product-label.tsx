
import type { Product } from "@/lib/types";
import { useCurrency } from "@/hooks/use-currency";

type ProductLabelProps = {
    product: Product;
    currency: ReturnType<typeof useCurrency>;
}

export function ProductLabel({ product, currency }: ProductLabelProps) {
    const { format, getSymbol, getFinalPrice } = currency;
    
    let priceUsd = getFinalPrice(product);
    if (product.promoPrice && product.promoPrice > 0) {
        priceUsd = product.promoPrice;
    }

    return (
        <div className="label-container">
            <div className="label-header">
                <p className="product-name">{product.name}</p>
            </div>
            <div className="label-middle">
                <div className="sku-box">
                    <span className="product-sku">{product.sku}</span>
                </div>
            </div>
            <div className="label-footer">
                <div className="price-usd-row">
                    <span className="currency-symbol">{getSymbol('USD')}</span>
                    <span className="price-value">{format(priceUsd)}</span>
                </div>
                <div className="ref-only-text">
                    PRECIO REF. EN DIVISAS
                </div>
            </div>
        </div>
    )
}
