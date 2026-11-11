"use client";

import { useMemo, useState } from "react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X, AlertTriangle } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useFirebase } from "@/firebase";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { ensureOnline } from "@/lib/offline-guard";
import type { Product } from "@/lib/types";
import type { WithId } from "@/lib/firestore/query-cache";

const TEMPLATE_ROWS = 500;
const BATCH_SIZE = 400;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type ParsedRow = {
  name: string;
  category: string;
  costPrice: number;
  stockLevel: number;
  sku: string;
  salePrice: number;
  promoPrice: number;
  error?: string;
};

function normalizeHeader(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const normalized = text.includes(",") && text.includes(".")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(",", ".");
  const parsed = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeKeywords(name: string, category: string, sku: string) {
  return Array.from(new Set(
    `${name} ${category} ${sku}`
      .toLowerCase()
      .split(/[\s,./-]+/)
      .filter((word) => word.length > 1),
  ));
}

export function BulkImportDialog({
  onImported,
  children,
}: {
  onImported: (products: WithId<Product>[]) => void;
  children: React.ReactNode;
}) {
  const { firestore, user } = useFirebase();
  const { bcvRate, parallelRate, profitMargin, getDynamicPrice } = useCurrency();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const validRows = useMemo(() => rows.filter((row) => !row.error), [rows]);
  const errorRows = useMemo(() => rows.filter((row) => row.error), [rows]);
  const canImport = validRows.length > 0 && errorRows.length === 0 && !isImporting;

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const data: (string | number)[][] = [
      ["Nombre", "Precio Base USD", "Categoría", "SKU", "Stock inicial (Opcional)", "Precio Venta USD (Opcional)", "Oferta (Sí/No)", "Precio Oferta USD (Opcional)"],
    ];
    for (let index = 1; index <= TEMPLATE_ROWS; index++) {
      data.push(["", "", "", `IMP-${String(index).padStart(4, "0")}`, "", "", "", ""]);
    }

    const workbook = XLSX.utils.book_new();
    const productsSheet = XLSX.utils.aoa_to_sheet(data);
    productsSheet["!cols"] = [
      { wch: 38 },
      { wch: 18 },
      { wch: 22 },
      { wch: 16 },
      { wch: 22 },
      { wch: 24 },
      { wch: 16 },
      { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(workbook, productsSheet, "Productos");

    const instructions = XLSX.utils.aoa_to_sheet([
      ["Instrucciones"],
      ["1. Llena Nombre, Precio Base USD y Categoría. Las filas sin nombre se ignoran."],
      ["2. Precio Base USD es el COSTO de compra. El margen y las tasas se aplican automáticamente."],
      ["3. El SKU ya viene generado. Puedes reemplazarlo por tu código real."],
      ["4. Stock inicial es opcional; si lo dejas vacío se carga en 0."],
      ["5. Precio Venta USD es opcional. Si lo dejas vacío, el sistema aplica margen, BCV y reposición."],
      ["6. Para activar una oferta, escribe Sí en Oferta y el precio de oferta en USD."],
      ["7. Si Oferta está vacío o dice No, el producto se carga sin oferta."],
      ["8. Máximo 500 productos por archivo."],
      ["9. No cambies los nombres de las columnas."],
      [],
      ["Margen actual", `${profitMargin}%`],
      ["Tasa BCV actual", `${bcvRate} Bs/$`],
      ["Tasa reposición actual", `${parallelRate} Bs/$`],
    ]);
    instructions["!cols"] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(workbook, instructions, "Instrucciones");

    XLSX.writeFile(workbook, "plantilla-productos-500.xlsx");
  };

  const processFile = async (file: File) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast({ variant: "destructive", title: "Archivo demasiado grande", description: "El máximo es 5 MB." });
      return;
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast({ variant: "destructive", title: "Formato no válido", description: "Sube un archivo .xlsx o .xls." });
      return;
    }

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      if (matrix.length < 2) {
        toast({ variant: "destructive", title: "Archivo vacío" });
        return;
      }

      const headers = (matrix[0] as unknown[]).map(normalizeHeader);
      const findColumn = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const nameIndex = findColumn("nombre", "producto", "nombre del producto");
      const costIndex = findColumn("precio base usd", "precio base", "costo", "costo usd", "precio");
      const categoryIndex = findColumn("categoria", "categoría");
      const skuIndex = findColumn("sku", "codigo", "código");
      const stockIndex = findColumn("stock inicial opcional", "stock inicial", "stock", "cantidad");
      const salePriceIndex = findColumn("precio venta usd opcional", "precio venta usd", "precio venta", "precio final");
      const offerIndex = findColumn("oferta si no", "oferta", "en oferta");
      const promoIndex = findColumn("precio oferta usd opcional", "precio oferta usd", "precio oferta", "oferta usd");

      if (nameIndex < 0 || costIndex < 0 || categoryIndex < 0) {
        toast({
          variant: "destructive",
          title: "Columnas faltantes",
          description: "El archivo debe tener Nombre, Precio Base USD y Categoría.",
        });
        return;
      }

      const meaningfulRows = matrix.slice(1).filter((rawRow) => {
        const row = rawRow as unknown[];
        return Boolean(
          String(row[nameIndex] ?? "").trim() ||
          String(row[costIndex] ?? "").trim() ||
          String(row[categoryIndex] ?? "").trim() ||
          (stockIndex >= 0 && String(row[stockIndex] ?? "").trim()) ||
          (salePriceIndex >= 0 && String(row[salePriceIndex] ?? "").trim()) ||
          (offerIndex >= 0 && String(row[offerIndex] ?? "").trim()) ||
          (promoIndex >= 0 && String(row[promoIndex] ?? "").trim()),
        );
      });
      if (meaningfulRows.length > TEMPLATE_ROWS) {
        toast({
          variant: "destructive",
          title: "Demasiados productos",
          description: `El máximo es ${TEMPLATE_ROWS} productos por archivo.`,
        });
        return;
      }

      const timestamp = Date.now();
      const parsed: ParsedRow[] = [];
      const usedSkus = new Set<string>();

      matrix.slice(1, TEMPLATE_ROWS + 1).forEach((rawRow, index) => {
        const row = rawRow as unknown[];
        const name = String(row[nameIndex] ?? "").trim().toUpperCase();
        const category = String(row[categoryIndex] ?? "").trim().toUpperCase();
        const rawCost = row[costIndex];
        const rawStock = stockIndex >= 0 ? row[stockIndex] : "";
        const rawSku = skuIndex >= 0 ? String(row[skuIndex] ?? "").trim().toUpperCase() : "";
        const rawSalePrice = salePriceIndex >= 0 ? row[salePriceIndex] : "";
        const rawOffer = offerIndex >= 0 ? normalizeHeader(row[offerIndex]) : "";
        const rawPromo = promoIndex >= 0 ? row[promoIndex] : "";
        const hasOffer = ["si", "sí", "yes", "1", "true", "x"].includes(rawOffer);

        const hasAnyData = name || category || String(rawCost ?? "").trim() || String(rawStock ?? "").trim();
        if (!hasAnyData) return;

        const costPrice = parseNumber(rawCost);
        const stockLevel = stockIndex >= 0 ? parseNumber(rawStock) : 0;
        const salePrice = salePriceIndex >= 0 ? parseNumber(rawSalePrice) : 0;
        const promoPrice = hasOffer ? parseNumber(rawPromo) : 0;
        const normalSalePrice = salePrice > 0 ? salePrice : getDynamicPrice(costPrice);
        let sku = rawSku || `IMP-${timestamp}-${String(index + 1).padStart(4, "0")}`;
        let error = "";

        if (!name) error = "Falta el nombre";
        else if (name.length < 2) error = "Nombre demasiado corto";
        else if (!category) error = "Falta la categoría";
        else if (costPrice <= 0) error = "Precio base inválido";
        else if (stockLevel < 0 || !Number.isFinite(stockLevel)) error = "Stock inválido";
        else if (salePrice < 0 || !Number.isFinite(salePrice)) error = "Precio de venta inválido";
        else if (salePrice > 0 && salePrice < costPrice) error = "Precio de venta menor al costo";
        else if (hasOffer && promoPrice <= 0) error = "Falta el precio de oferta";
        else if (hasOffer && promoPrice >= normalSalePrice) error = "La oferta debe ser menor al precio normal";
        else if (usedSkus.has(sku)) error = "SKU repetido en el archivo";

        if (sku) usedSkus.add(sku);
        if (!sku) sku = `IMP-${timestamp}-${String(index + 1).padStart(4, "0")}`;

        parsed.push({ name, category, costPrice, stockLevel, sku, salePrice, promoPrice, error: error || undefined });
      });

      if (parsed.length === 0) {
        toast({ variant: "destructive", title: "No hay productos para importar" });
        return;
      }

      setFileName(file.name);
      setRows(parsed);
      setProgress(0);
    } catch {
      toast({ variant: "destructive", title: "No se pudo leer el Excel", description: "Verifica que el archivo no esté dañado." });
    }
  };

  const handleImport = async () => {
    if (!firestore || !user || !canImport) return;
    if (!ensureOnline(toast, "Importar productos")) return;

    setIsImporting(true);
    setProgress(0);
    try {
      const products: WithId<Product>[] = validRows.map((row) => {
        const productRef = doc(collection(firestore, "users", user.uid, "products"));
        const product: Product = {
          id: productRef.id,
          name: row.name,
          category: row.category,
          sku: row.sku,
          barcode: "",
          costPrice: Number(row.costPrice.toFixed(6)),
          stockLevel: Math.max(0, Math.floor(row.stockLevel)),
          reservedStock: 0,
          damagedStock: 0,
          lowStockThreshold: 1,
          unit: "unit",
          isFixedPrice: row.salePrice > 0,
          fixedPrice: row.salePrice > 0 ? Number(row.salePrice.toFixed(6)) : 0,
          hasCustomMargin: false,
          customMargin: 0,
          hasIVA: false,
          hasDiscount: false,
          discountAmount: 0,
          promoPrice: row.promoPrice,
          isGiftable: false,
          isCombo: false,
          comboItems: [],
          isDeleted: false,
          salesCount: 0,
          searchKeywords: makeKeywords(row.name, row.category, row.sku),
          createdAt: new Date().toISOString(),
        };
        return {
          ...product,
          id: productRef.id,
        } as WithId<Product>;
      });

      for (let start = 0; start < products.length; start += BATCH_SIZE) {
        const chunk = products.slice(start, start + BATCH_SIZE);
        const batch = writeBatch(firestore);
        chunk.forEach((product) => {
          const { id, ...data } = product;
          batch.set(doc(firestore, "users", user.uid, "products", id), {
            ...data,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        setProgress(Math.min(products.length, start + BATCH_SIZE));
      }

      onImported(products);
      toast({
        title: "Productos importados",
        description: `${products.length} productos cargados correctamente.`,
      });
      setOpen(false);
      setRows([]);
      setFileName("");
      setProgress(0);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al importar",
        description: error?.message || "No se pudieron guardar los productos.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isImporting) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setRows([]);
      setFileName("");
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="border-b p-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-black uppercase">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Importar productos desde Excel
          </DialogTitle>
          <DialogDescription className="text-xs">
            Hasta 500 productos. Precio Base USD es el costo; el margen, BCV y reposición se aplican automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3 text-[10px] font-bold uppercase">
            <Badge variant="outline">Margen {profitMargin}%</Badge>
            <Badge variant="outline">BCV {bcvRate.toFixed(2)}</Badge>
            <Badge variant="outline">Reposición {parallelRate.toFixed(2)}</Badge>
            <span className="ml-auto text-muted-foreground">0 lecturas al importar</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => void downloadTemplate()} disabled={isImporting}>
              <Download className="mr-2 h-4 w-4" /> Descargar plantilla
            </Button>
            <div>
              <Input
                type="file"
                accept=".xlsx,.xls"
                disabled={isImporting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void processFile(file);
                }}
                className="h-10 cursor-pointer text-xs"
              />
            </div>
          </div>

          <div
            className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/20"}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void processFile(file);
            }}
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-xs font-bold">Arrastra el Excel aquí o selecciónalo arriba</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Máximo 500 filas y 5 MB</p>
          </div>

          {fileName && (
            <div className="flex items-center justify-between rounded-lg border bg-white p-3">
              <div className="flex items-center gap-2 text-xs font-bold">
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
                {fileName}
              </div>
              <Badge variant="secondary">{validRows.length} válidos</Badge>
            </div>
          )}

          {errorRows.length > 0 && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <p className="flex items-center gap-1 text-[10px] font-black uppercase text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Errores ({errorRows.length})
              </p>
              <div className="mt-2 max-h-28 overflow-y-auto text-[10px]">
                {errorRows.slice(0, 20).map((row, index) => (
                  <p key={`${row.sku}-${index}`}>{row.name || "Fila sin nombre"}: {row.error}</p>
                ))}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-muted/50 uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Nombre</th>
                    <th className="p-2">Costo USD</th>
                    <th className="p-2">Categoría</th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Stock</th>
                    <th className="p-2">Oferta USD</th>
                    <th className="p-2">Venta USD</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 12).map((row, index) => (
                    <tr key={`${row.sku}-${index}`} className={row.error ? "bg-destructive/5 text-destructive" : "border-t"}>
                      <td className="p-2 font-bold">{row.name || "—"}</td>
                      <td className="p-2">${row.costPrice.toFixed(2)}</td>
                      <td className="p-2">{row.category || "—"}</td>
                      <td className="p-2 font-mono">{row.sku}</td>
                      <td className="p-2">{row.stockLevel}</td>
                      <td className="p-2 font-bold text-amber-600">
                        {row.promoPrice > 0 ? `$${row.promoPrice.toFixed(2)}` : "—"}
                      </td>
                      <td className="p-2 font-bold text-green-700">
                        ${(row.salePrice > 0 ? row.salePrice : getDynamicPrice(row.costPrice)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 12 && (
                <p className="border-t p-2 text-center text-[10px] text-muted-foreground">
                  Mostrando 12 de {rows.length} filas
                </p>
              )}
            </div>
          )}

          {isImporting && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-bold uppercase">
                <span>Importando...</span>
                <span>{progress} / {validRows.length}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-green-600 transition-all" style={{ width: `${validRows.length ? (progress / validRows.length) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t p-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isImporting}>
            <X className="mr-2 h-4 w-4" /> Cancelar
          </Button>
          <Button onClick={handleImport} disabled={!canImport} className="font-bold uppercase">
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {isImporting ? `Importando ${progress}/${validRows.length}` : `Importar ${validRows.length || ""} productos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
