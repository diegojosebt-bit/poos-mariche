"use client";

import type { Table } from "@tanstack/react-table";
import type { Product } from "@/lib/types";
import { Button } from "../ui/button";
import { Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { renderToString } from "react-dom/server";
import { ProductLabel } from "./product-label";
import { useCurrency } from "@/hooks/use-currency";

type PrintLabelsButtonProps = {
    table: Table<Product>;
}

export const handlePrint = (
  products: Product[],
  currency: ReturnType<typeof useCurrency>,
  onError: (message: string) => void
) => {
  const labelsHtml = renderToString(
    <div className="labels-grid">
      {products.map((product) => (
        <ProductLabel key={product.id} product={product} currency={currency} />
      ))}
    </div>
  );

  const fullHtml = `
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Etiquetas de Productos - Poos Mariche</title>
                <style>
                    @media print {
                        @page {
                            size: letter;
                            margin: 0.5in;
                        }
                        body {
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                            visibility: visible !important;
                        }
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        background-color: #fff;
                    }
                    .labels-grid {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 0;
                    }
                    .label-container {
                        border: 1px dotted #ccc;
                        padding: 10px 6px;
                        width: 1.75in;
                        height: 1.1in;
                        box-sizing: border-box;
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                        align-items: center;
                        text-align: center;
                        overflow: hidden;
                        position: relative;
                    }
                    .product-name {
                        font-size: 10px;
                        font-weight: 800;
                        line-height: 1.1;
                        margin: 0;
                        color: #000;
                        text-transform: uppercase;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                    }
                    .sku-box {
                        border: 1px solid #000;
                        padding: 1px 4px;
                        margin: 4px 0;
                        display: inline-block;
                    }
                    .product-sku {
                        font-size: 8px;
                        font-family: monospace;
                        font-weight: bold;
                        letter-spacing: 1px;
                    }
                    .label-footer {
                        width: 100%;
                        border-top: 1px solid #eee;
                        padding-top: 4px;
                    }
                    .price-usd-row {
                        display: flex;
                        justify-content: center;
                        align-items: baseline;
                        gap: 1px;
                        color: #000;
                    }
                    .currency-symbol {
                        font-size: 10px;
                        font-weight: bold;
                    }
                    .price-value {
                        font-size: 18px;
                        font-weight: 900;
                    }
                    .ref-only-text {
                        font-size: 6px;
                        font-weight: bold;
                        color: #666;
                        margin-top: -2px;
                        text-transform: uppercase;
                    }
                </style>
            </head>
            <body>
                ${labelsHtml}
            </body>
        </html>
    `;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = 'none';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(fullHtml);
    doc.close();

    setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 1500);
    }, 500);
  } else {
    onError("No se pudo inicializar el canal de impresión.");
  }
};


export function PrintLabelsButton({ table }: PrintLabelsButtonProps) {
    const { toast } = useToast();
    const currency = useCurrency();
    const selectedRows = table.getSelectedRowModel().rows;
    const selectedProducts = selectedRows.map(row => row.original);

    const handlePrintClick = () => {
        if(selectedProducts.length === 0) {
            toast({
                variant: 'destructive',
                title: 'Sin selección',
                description: 'Marca los productos que deseas etiquetar en la tabla.'
            });
            return;
        }

        handlePrint(selectedProducts, currency, (error) => {
             toast({
                variant: "destructive",
                title: "Error de Impresión",
                description: error,
            });
        });
    }

    return (
        <Button variant="outline" size="sm" onClick={handlePrintClick} disabled={selectedRows.length === 0} className="h-9 px-2 sm:px-4 font-bold">
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Etiquetas</span> ({selectedRows.length})
        </Button>
    )
}