"use client";

import { useState } from "react";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
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

type ExportSalesButtonProps = {
  sales: Sale[];
  products: Product[];
  repairJobs: RepairJob[];
  fiados: Fiado[];
};

export function ExportSalesButton({ sales, products, repairJobs, fiados }: ExportSalesButtonProps) {
  const [date, setDate] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const { toast } = useToast();
  const { bcvRate: currentBcvRate, parallelRate: currentParallelRate } = useCurrency();

  const handleExport = () => {
    if (!date?.from || !sales || !repairJobs || !products) {
      toast({
        variant: "destructive",
        title: "Error de Datos",
        description: "Asegúrate de seleccionar fechas y que los datos hayan cargado.",
      });
      return;
    }
    
    const from = startOfDay(date.from);
    const to = date.to ? endOfDay(date.to) : endOfDay(date.from);

    const filteredSales = sales.filter((sale) => {
      if (!sale.transactionDate || sale.status !== 'completed') return false;
      const saleDate = new Date(sale.transactionDate);
      return isWithinInterval(saleDate, { start: from, end: to });
    });

    if (filteredSales.length === 0) {
        toast({
            title: "No hay datos",
            description: "No se encontraron ventas completadas en el rango seleccionado."
        });
        return;
    }
    
    // Map para consolidar actividad de reparaciones en el periodo
    const repairsActivity = new Map<string, {
        revenue: number,
        realRevenue: number,
        repairJob: RepairJob,
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
        
        // AJUSTE DE VALOR REAL (REPOSICIÓN)
        const isSalePromo = sale.items.some(i => i.isPromo);
        const rateFactor = isSalePromo ? 1 : (saleBcvRate / saleParallelRate);
        
        // Calculamos el ratio de cobro
        const itemsTotalBillable = sale.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        const collectionRatio = itemsTotalBillable > 0 ? totalCollectedNominal / itemsTotalBillable : 1;

        const productItemsInSale = sale.items.filter(i => !i.isRepair);
        
        productItemsInSale.forEach(item => {
            const nominalRevenue = (item.price * item.quantity) * collectionRatio;
            const realRevenue = nominalRevenue * rateFactor;
            
            let cost = 0;

            // --- MOTOR DE RESCATE HÍBRIDO EN EXCEL ---
            if (item.costPrice !== undefined && item.costPrice !== null && item.costPrice !== 0) {
                // Caso A: Costo congelado presente
                cost = item.costPrice * item.quantity * collectionRatio;
            } else {
                // Caso B: Rescate histórico desde Memoria RAM
                if (sale.fiadoId) {
                    const fiado = fiados.find(f => f.id === sale.fiadoId);
                    if (fiado) {
                        const costRatio = fiado.totalAmount > 0 ? (fiado.totalCost || 0) / fiado.totalAmount : 0;
                        cost = nominalRevenue * costRatio;
                    }
                } else if (item.isCustom) {
                    cost = (item.customCostPrice || 0) * item.quantity * collectionRatio;
                } else {
                    // Lookup por ID, SKU o Nombre (Fuzzy rescue)
                    const matchedProduct = products.find(p => 
                        p.id === item.productId || 
                        p.sku === item.productId || 
                        p.name === item.name
                    );
                    cost = (matchedProduct?.costPrice || 0) * item.quantity * collectionRatio;
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
        
        if (rId) {
            const repairRevenueInThisSaleNominal = (repairItem ? (repairItem.price * repairItem.quantity) : 0) * collectionRatio;
            const repairRealRevenueInThisSale = repairRevenueInThisSaleNominal * rateFactor;
            
            if (repairRevenueInThisSaleNominal > 0) {
                const repairJob = repairJobs.find(job => job.id === rId);
                if (repairJob) {
                    const existing = repairsActivity.get(rId);
                    if (existing) {
                        existing.revenue += repairRevenueInThisSaleNominal;
                        existing.realRevenue += repairRealRevenueInThisSale;
                        existing.paymentMethods.add(sale.paymentMethod);
                        if (new Date(sale.transactionDate) > new Date(existing.lastDate)) {
                            existing.lastDate = sale.transactionDate;
                            existing.lastSaleId = sale.id!;
                            existing.bcvRate = saleBcvRate;
                            existing.parallelRate = saleParallelRate;
                            existing.customerName = sale.customerName || repairJob.customerName;
                            existing.customerID = sale.customerID || repairJob.customerID;
                        }
                    } else {
                        repairsActivity.set(rId, {
                            revenue: repairRevenueInThisSaleNominal,
                            realRevenue: repairRealRevenueInThisSale,
                            repairJob,
                            lastDate: sale.transactionDate,
                            lastSaleId: sale.id!,
                            paymentMethods: new Set([sale.paymentMethod]),
                            bcvRate: saleBcvRate,
                            parallelRate: saleParallelRate,
                            customerName: sale.customerName || repairJob.customerName,
                            customerID: sale.customerID || repairJob.customerID
                        });
                    }
                }
            }
        }
    });

    // Consolidar líneas de reparación con sus costos prorrateados
    const consolidatedRepairLines = Array.from(repairsActivity.values()).map(entry => {
        const repair = entry.repairJob;
        const totalPartsCost = [...(repair.reservedParts || []), ...(repair.consumedParts || [])]
            .reduce((sum, p) => sum + (p.costPrice * p.quantity), 0);
        
        const costRatio = repair.estimatedCost > 0 ? totalPartsCost / repair.estimatedCost : 0;
        
        const nominalIncome = entry.revenue;
        const realIncome = entry.realRevenue;
        const proratedCost = nominalIncome * costRatio;
        const realProfit = realIncome - proratedCost;

        return {
            'Fecha': format(new Date(entry.lastDate), 'dd/MM/yyyy HH:mm'),
            'Cliente': entry.customerName || repair.customerName,
            'Cédula/RIF': entry.customerID || repair.customerID,
            'Producto/Servicio': `REPARACIÓN: ${repair.deviceMake} ${repair.deviceModel}` + (repair.isPromo ? ' [OFERTA]' : ''),
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
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ventas_PoosMariche");
    
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
      <Button onClick={handleExport} disabled={!date?.from}>
        <FileDown className="mr-2 h-4 w-4" />
        Generar Excel de Utilidad Real
      </Button>
    </div>
  );
}
