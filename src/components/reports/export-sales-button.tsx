"use client";

import { useState } from "react";
import { format, isWithinInterval, startOfDay, endOfDay, subDays, differenceInCalendarDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, FileDown } from "lucide-react";
import type { Product, Sale, RepairJob, Fiado } from "@/lib/types";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { useFirebase } from "@/firebase";
import { collection, getCountFromServer, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore";
import { countServerReads } from "@/lib/firestore/read-meter";

type ExportSalesButtonProps = {
  sales: Sale[];
  products: Product[];
  repairJobs: RepairJob[];
  fiados: Fiado[];
};

const MAX_DAYS = 31;
const MAX_DOCS = 2000;
const PAGE_SIZE = 200;

export function ExportSalesButton({ products, repairJobs, fiados }: ExportSalesButtonProps) {
  const [date, setDate] = useState<DateRange | undefined>({
    from: subDays(new Date(), 6),
    to: new Date(),
  });
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { bcvRate: currentBcvRate, parallelRate: currentParallelRate } = useCurrency();

  const handleExport = async () => {
    if (!date?.from || !firestore || !user) {
      toast({
        variant: "destructive",
        title: "Error de Datos",
        description: "Selecciona un rango de fechas válido.",
      });
      return;
    }
    
    const from = startOfDay(date.from);
    const to = date.to ? endOfDay(date.to) : endOfDay(date.from);
    const days = differenceInCalendarDays(to, from) + 1;

    if (days > MAX_DAYS) {
      toast({
        variant: "destructive",
        title: "Rango demasiado amplio",
        description: `El máximo es ${MAX_DAYS} días. Para períodos mayores usa Reportes por rango.`,
      });
      return;
    }

    const baseQuery = query(
      collection(firestore, 'users', user.uid, 'sale_transactions'),
      where('transactionDate', '>=', from.toISOString()),
      where('transactionDate', '<=', to.toISOString()),
      orderBy('transactionDate', 'desc'),
    );

    setIsExporting(true);

    try {
      // Estimación barata: 1 lectura por cada 1.000 documentos.
      const countSnap = await getCountFromServer(baseQuery);
      countServerReads(Math.max(1, Math.ceil(countSnap.data().count / 1000)), 'export:count');
      const estimated = countSnap.data().count;

      if (estimated === 0) {
        toast({ title: "No hay datos", description: "No hay ventas en el rango seleccionado." });
        return;
      }

      if (estimated > MAX_DOCS) {
        toast({
          variant: "destructive",
          title: "Rango demasiado grande",
          description: `Hay ~${estimated} ventas. Reduce el rango (máximo ${MAX_DOCS}).`,
        });
        return;
      }

      const confirmed = window.confirm(
        `Se leerán ~${estimated} ventas del rango y se generará el Excel.\n\n¿Continuar?`,
      );
      if (!confirmed) return;

      const allSales: Sale[] = [];
      let last: any = null;

      for (;;) {
        const pageQuery = last
          ? query(baseQuery, startAfter(last), limit(PAGE_SIZE))
          : query(baseQuery, limit(PAGE_SIZE));

        const snapshot = await getDocs(pageQuery);
        countServerReads(snapshot.size, 'export:sales');
        allSales.push(...snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Sale));

        if (snapshot.size < PAGE_SIZE) break;
        last = snapshot.docs[snapshot.docs.length - 1];
      }

      const filteredSales = allSales.filter((sale) => sale.status === 'completed');

      if (filteredSales.length === 0) {
        toast({
          title: "No hay datos",
          description: "No se encontraron ventas completadas en el rango seleccionado.",
        });
        return;
      }
    
    // Map para consolidar actividad de reparaciones en el periodo
    const repairsActivity = new Map<string, {
        revenue: number,
        realRevenue: number,
        repairJob?: RepairJob | null,
        repairItemName?: string,
        cost?: number,
        lastDate: string,
        lastSaleId: string,
        paymentMethods: Set<string>,
        bcvRate: number,
        parallelRate: number,
        customerName?: string,
        customerID?: string
    }>();

    const productLines: any[] = [];

    filteredSales.forEach(sale => {
        const totalCollectedNominal = sale.actualPaidAmount ?? sale.totalAmount;
        const saleBcvRate = sale.bcvRateAtTime || currentBcvRate;
        const saleParallelRate = sale.parallelRateAtTime || currentParallelRate;
        
        // Calculamos el ratio de cobro
        const itemsTotalBillable = sale.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        const collectionRatio = itemsTotalBillable > 0 ? totalCollectedNominal / itemsTotalBillable : 1;

        const productItemsInSale = sale.items.filter(i => !i.isRepair);
        const frozenCostSum = productItemsInSale.reduce((acc, i) => {
            const c = i.costPrice ?? i.customCostPrice;
            return acc + ((c && c > 0 ? c : 0) * i.quantity);
        }, 0);
        const remainingSaleCost = typeof sale.costPrice === 'number' && sale.costPrice > 0
            ? Math.max(0, sale.costPrice - frozenCostSum)
            : 0;
        const itemsNeedingCost = productItemsInSale.filter(i => {
            const c = i.costPrice ?? i.customCostPrice;
            return !c || c <= 0;
        });
        const billableNeedingCost = itemsNeedingCost.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        
        productItemsInSale.forEach(item => {
            const nominalRevenue = (item.price * item.quantity) * collectionRatio;
            const realRevenue = nominalRevenue;
            
            let cost = 0;

            // --- MOTOR DE RESCATE HÍBRIDO EN EXCEL ---
            if (item.costPrice !== undefined && item.costPrice !== null && item.costPrice > 0) {
                // Caso A: Costo congelado presente (inmutable)
                cost = item.costPrice * item.quantity;
            } else {
                // Caso B: Rescate histórico desde Memoria RAM
                if (sale.fiadoId) {
                    const fiado = fiados.find(f => f.id === sale.fiadoId);
                    if (fiado) {
                        const costRatio = fiado.totalAmount > 0 ? (fiado.totalCost || 0) / fiado.totalAmount : 0;
                        cost = nominalRevenue * costRatio;
                    }
                } else if (item.isCustom) {
                    cost = (item.customCostPrice || 0) * item.quantity;
                } else {
                    // Lookup por ID, SKU o Nombre (Fuzzy rescue)
                    const matchedProduct = products.find(p => 
                        p.id === item.productId || 
                        p.sku === item.productId || 
                        p.name === item.name
                    );
                    cost = (matchedProduct?.costPrice || 0) * item.quantity;
                }

                // Rescate desde sale.costPrice si aún es 0 (0 lecturas)
                if (cost === 0 && remainingSaleCost > 0) {
                    if (itemsNeedingCost.length === 1) {
                        cost = remainingSaleCost;
                    } else if (billableNeedingCost > 0) {
                        cost = ((item.price * item.quantity) / billableNeedingCost) * remainingSaleCost;
                    } else {
                        cost = remainingSaleCost / (itemsNeedingCost.length || 1);
                    }
                }
            }
            
            const realProfit = realRevenue - cost;
            
            productLines.push({
                'Fecha': format(new Date(sale.transactionDate), 'dd/MM/yyyy HH:mm'),
                'Cliente': sale.customerName || 'GENERAL',
                'Cédula/RIF': sale.customerID || 'N/A',
                'Producto/Servicio': item.name + (item.isPromo ? ' [OFERTA]' : ''),
                'ID Transacción': sale.id,
                'Costo Inversión ($)': Number(cost.toFixed(2)),
                'Precio Venta Nom. ($)': Number(item.price.toFixed(2)),
                'Cantidad': item.quantity,
                'Ingreso Real ($ - Reposición)': Number(realRevenue.toFixed(2)),
                'Ganancia Real ($ - Reposición)': Number(realProfit.toFixed(2)),
                'Total Recibido (Bs)': Number((nominalRevenue * saleBcvRate).toFixed(2)),
                'Tasa BCV': Number(saleBcvRate.toFixed(2)),
                'Tasa Reposición': Number(saleParallelRate.toFixed(2)),
                'Método de Pago': sale.paymentMethod
            });
        });

        // Agrupar actividad de reparaciones
        const repairItem = sale.items.find(i => i.isRepair);
        const rId = sale.repairJobId || repairItem?.productId;
        
        if (rId && repairItem) {
            const repairRevenueInThisSaleNominal = (repairItem.price * repairItem.quantity) * collectionRatio;
            // Igual que en las líneas de producto: el ingreso ya viene prorrateado
            // por `collectionRatio`. Antes se multiplicaba por `rateFactor`, una
            // variable inexistente que hacía fallar la exportación con reparaciones.
            const repairRealRevenueInThisSale = repairRevenueInThisSaleNominal;
            
            if (repairRevenueInThisSaleNominal > 0) {
                const repairJob = repairJobs.find(job => job.id === rId);
                const repairFrozenCost = (repairItem.costPrice && repairItem.costPrice > 0)
                    ? (repairItem.costPrice * repairItem.quantity)
                    : (productItemsInSale.length === 0 && typeof sale.costPrice === 'number' && sale.costPrice > 0 ? sale.costPrice : 0);

                const existing = repairsActivity.get(rId);
                if (existing) {
                    existing.revenue += repairRevenueInThisSaleNominal;
                    existing.realRevenue += repairRealRevenueInThisSale;
                    existing.paymentMethods.add(sale.paymentMethod);
                    if (repairFrozenCost > 0 && (!existing.cost || existing.cost === 0)) {
                        existing.cost = repairFrozenCost;
                    }
                    if (new Date(sale.transactionDate) > new Date(existing.lastDate)) {
                        existing.lastDate = sale.transactionDate;
                        existing.lastSaleId = sale.id!;
                        existing.bcvRate = saleBcvRate;
                        existing.parallelRate = saleParallelRate;
                        existing.customerName = sale.customerName || repairJob?.customerName || existing.customerName;
                        existing.customerID = sale.customerID || repairJob?.customerID || existing.customerID;
                    }
                } else {
                    repairsActivity.set(rId, {
                        revenue: repairRevenueInThisSaleNominal,
                        realRevenue: repairRealRevenueInThisSale,
                        repairJob: repairJob || null,
                        repairItemName: repairItem.name || 'Servicio Técnico',
                        cost: repairFrozenCost,
                        lastDate: sale.transactionDate,
                        lastSaleId: sale.id!,
                        paymentMethods: new Set([sale.paymentMethod]),
                        bcvRate: saleBcvRate,
                        parallelRate: saleParallelRate,
                        customerName: sale.customerName || repairJob?.customerName || 'GENERAL',
                        customerID: sale.customerID || repairJob?.customerID || 'N/A'
                    });
                }
            }
        }
    });

    // Consolidar líneas de reparación con sus costos prorrateados
    const consolidatedRepairLines = Array.from(repairsActivity.values()).map(entry => {
        const repair = entry.repairJob;
        let proratedCost = entry.cost || 0;

        if (repair) {
            const totalPartsCost = [...(repair.reservedParts || []), ...(repair.consumedParts || [])]
                .reduce((sum, p) => sum + (p.costPrice * p.quantity), 0);
            
            const costRatio = repair.estimatedCost > 0 ? totalPartsCost / repair.estimatedCost : 0;
            if (costRatio > 0) {
                proratedCost = entry.revenue * costRatio;
            }
        }
        
        const nominalIncome = entry.revenue;
        const realIncome = entry.realRevenue;
        const realProfit = realIncome - proratedCost;
        const label = repair 
            ? `REPARACIÓN: ${repair.deviceMake} ${repair.deviceModel}` + (repair.isPromo ? ' [OFERTA]' : '')
            : (entry.repairItemName && entry.repairItemName.toUpperCase().includes('REPARACIÓN') ? entry.repairItemName : `REPARACIÓN: ${entry.repairItemName || 'Servicio Técnico'}`);

        return {
            'Fecha': format(new Date(entry.lastDate), 'dd/MM/yyyy HH:mm'),
            'Cliente': entry.customerName || repair?.customerName || 'GENERAL',
            'Cédula/RIF': entry.customerID || repair?.customerID || 'N/A',
            'Producto/Servicio': label,
            'ID Transacción': entry.lastSaleId,
            'Costo Inversión ($)': Number(proratedCost.toFixed(2)),
            'Precio Venta Nom. ($)': Number(nominalIncome.toFixed(2)),
            'Cantidad': 1,
            'Ingreso Real ($ - Reposición)': Number(realIncome.toFixed(2)),
            'Ganancia Real ($ - Reposición)': Number(realProfit.toFixed(2)),
            'Total Recibido (Bs)': Number((nominalIncome * entry.bcvRate).toFixed(2)),
            'Tasa BCV': Number(entry.bcvRate.toFixed(2)),
            'Tasa Reposición': Number(entry.parallelRate.toFixed(2)),
            'Método de Pago': Array.from(entry.paymentMethods).join(' + ')
        };
    });

    const dataToExport = [...productLines, ...consolidatedRepairLines].sort((a, b) => {
        const dateA = new Date(a['Fecha'].split(' ')[0].split('/').reverse().join('-') + ' ' + a['Fecha'].split(' ')[1]).getTime();
        const dateB = new Date(b['Fecha'].split(' ')[0].split('/').reverse().join('-') + ' ' + b['Fecha'].split(' ')[1]).getTime();
        return dateA - dateB;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ventas_MarichePOS");
    
    // Ajustar anchos de columna
    if (dataToExport.length > 0) {
        const cols = Object.keys(dataToExport[0] || {});
        const colWidths = cols.map(col => ({
            wch: Math.max(...dataToExport.map(row => (row[col as keyof typeof row] ?? '').toString().length), col.length + 2)
        }));
        worksheet["!cols"] = colWidths;
    }

    XLSX.writeFile(workbook, `Reporte_Ventas_Real_${format(from, "yyyy-MM-dd")}.xlsx`);
    toast({ title: "Excel de Utilidad Real generado" });
    } catch (error: any) {
      console.error('Export error:', error);
      toast({
        variant: "destructive",
        title: "Error al exportar",
        description: error?.message || "Intenta con un rango más pequeño.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className="w-full sm:w-[300px] justify-start text-left font-normal"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y", { locale: es })} -{" "}
                  {format(date.to, "LLL dd, y", { locale: es })}
                </>
              ) : (
                format(date.from, "LLL dd, y", { locale: es })
              )
            ) : (
              <span>Selecciona una fecha</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
            locale={es}
          />
        </PopoverContent>
      </Popover>
      <Button onClick={handleExport} disabled={!date?.from || isExporting}>
        <FileDown className="mr-2 h-4 w-4" />
        {isExporting ? 'Generando…' : 'Generar Excel de Utilidad Real'}
      </Button>
    </div>
  );
}
