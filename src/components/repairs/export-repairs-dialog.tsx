"use client";

import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { format, startOfDay, endOfDay, isWithinInterval, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, FileDown, Calendar, Percent, Loader2, Sparkles, Filter, CheckCircle2 } from "lucide-react";
import type { RepairJob } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useFirebase } from "@/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

type ExportRepairsDialogProps = {
  repairs: RepairJob[];
};

export function ExportRepairsDialog({ repairs: initialRepairs }: ExportRepairsDialogProps) {
  const [open, setOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [allDbRepairs, setAllDbRepairs] = useState<RepairJob[] | null>(null);

  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { bcvRate, settings } = useCurrency();

  // Fechas por defecto: Mes en curso
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const firstDayMonthStr = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(firstDayMonthStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [profitMarginPercent, setProfitMarginPercent] = useState<number>(settings?.profitMargin || 35);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Al abrir el modal, cargamos el catálogo completo de reparaciones desde Firestore si hace falta
  const handleOpenChange = async (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && !allDbRepairs && firestore && user) {
      setIsLoadingAll(true);
      try {
        const q = query(
          collection(firestore, "users", user.uid, "repair_jobs"),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }) as RepairJob);
        setAllDbRepairs(list);
      } catch (e) {
        console.warn("No se pudo cargar historial completo, usando datos en memoria:", e);
      } finally {
        setIsLoadingAll(false);
      }
    }
  };

  // Datos base: si se descargó el histórico completo usamos ese; sino los de la tabla
  const availableRepairs = allDbRepairs || initialRepairs || [];

  // Atajos rápidos de fecha
  const applyPreset = (preset: 'today' | '7days' | 'thisMonth' | 'lastMonth' | 'all') => {
    const now = new Date();
    if (preset === 'today') {
      setDateFrom(format(now, "yyyy-MM-dd"));
      setDateTo(format(now, "yyyy-MM-dd"));
    } else if (preset === '7days') {
      setDateFrom(format(subDays(now, 7), "yyyy-MM-dd"));
      setDateTo(format(now, "yyyy-MM-dd"));
    } else if (preset === 'thisMonth') {
      setDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
      setDateTo(format(now, "yyyy-MM-dd"));
    } else if (preset === 'lastMonth') {
      const lastMonth = subMonths(now, 1);
      setDateFrom(format(startOfMonth(lastMonth), "yyyy-MM-dd"));
      setDateTo(format(endOfMonth(lastMonth), "yyyy-MM-dd"));
    } else if (preset === 'all') {
      setDateFrom("");
      setDateTo("");
    }
  };

  // Helper functions for real profit calculation
  const getJobIncome = (job: RepairJob) => {
    const paid = Number(job.amountPaid || 0);
    if (paid > 0) return paid;
    if (job.isPaid) return Number(job.estimatedCost || 0);
    return 0;
  };

  const getJobInvestmentCost = (job: RepairJob) => {
    const allParts = [
      ...(job.consumedParts || []),
      ...(job.reservedParts || [])
    ];
    const partsSum = allParts.reduce((sum, p) => {
      const cost = Number(p.costPrice || 0);
      const qty = Number(p.quantity || 1);
      return sum + (cost * qty);
    }, 0);

    if (partsSum > 0) return partsSum;
    return Number(job.partsCost || 0);
  };

  // Filtrado reactivo en tiempo real para la previsualización
  const filteredData = useMemo(() => {
    return availableRepairs.filter((job) => {
      // Filtro por fecha si hay valores
      if (dateFrom || dateTo) {
        if (!job.createdAt) return false;
        const jobDate = new Date(job.createdAt);
        
        if (dateFrom && dateTo) {
          const from = startOfDay(new Date(dateFrom + "T00:00:00"));
          const to = endOfDay(new Date(dateTo + "T23:59:59"));
          if (!isWithinInterval(jobDate, { start: from, end: to })) return false;
        } else if (dateFrom) {
          const from = startOfDay(new Date(dateFrom + "T00:00:00"));
          if (jobDate < from) return false;
        } else if (dateTo) {
          const to = endOfDay(new Date(dateTo + "T23:59:59"));
          if (jobDate > to) return false;
        }
      }

      // Filtro de estado
      const income = getJobIncome(job);
      const estimated = Number(job.estimatedCost || 0);
      const isUnpaid = !job.isPaid && (estimated > income);

      if (statusFilter === "completed" && job.status !== "Completado") return false;
      if (statusFilter === "paid" && !job.isPaid && income < (estimated - 0.01)) return false;
      if (statusFilter === "unpaid" && !isUnpaid) return false;
      if (statusFilter === "pending" && job.status === "Completado") return false;

      return true;
    });
  }, [availableRepairs, dateFrom, dateTo, statusFilter]);

  // Métricas calculadas para la tarjeta resumen según la fórmula exacta requerida:
  // 1. Ingreso Real = Total Pagado (job.amountPaid / isPaid)
  // 2. Costo de Inversión = Costo de repuestos / piezas
  // 3. Ganancia Real = Ingreso Real - Costo de Inversión
  // 4. Ganancia según % = Ganancia Real * (% / 100)
  const summaryMetrics = useMemo(() => {
    let totalPresupuesto = 0;
    let totalIngresoReal = 0;
    let totalCostoInversion = 0;
    let totalGananciaReal = 0;
    let totalGananciaSegunPorcentaje = 0;

    const marginFactor = Number(profitMarginPercent || 0) / 100;

    filteredData.forEach((job) => {
      const presupuesto = Number(job.estimatedCost || 0);
      const ingresoReal = getJobIncome(job);
      const costoInversion = getJobInvestmentCost(job);
      const gananciaReal = ingresoReal - costoInversion;
      const gananciaSegunPorcentaje = gananciaReal * marginFactor;

      totalPresupuesto += presupuesto;
      totalIngresoReal += ingresoReal;
      totalCostoInversion += costoInversion;
      totalGananciaReal += gananciaReal;
      totalGananciaSegunPorcentaje += gananciaSegunPorcentaje;
    });

    const totalSaldoPendiente = Math.max(0, totalPresupuesto - totalIngresoReal);

    return {
      totalPresupuesto,
      totalIngresoReal,
      totalCostoInversion,
      totalGananciaReal,
      totalGananciaSegunPorcentaje,
      totalSaldoPendiente,
      totalIngresoRealBs: totalIngresoReal * bcvRate
    };
  }, [filteredData, profitMarginPercent, bcvRate]);

  // Generador del archivo Excel
  const handleExport = () => {
    if (filteredData.length === 0) {
      toast({
        variant: "destructive",
        title: "Sin datos",
        description: "No se encontraron reparaciones con los filtros seleccionados."
      });
      return;
    }

    setIsExporting(true);

    try {
      const marginFactor = Number(profitMarginPercent || 0) / 100;

      // Generar filas para la hoja de cálculo con la fórmula exacta de ganancia real
      const rows = filteredData.map((job) => {
        const presupuesto = Number(job.estimatedCost || 0);
        const ingresoReal = getJobIncome(job);
        const costoInversion = getJobInvestmentCost(job);
        
        // Ganancia Real = Ingreso Real (Total Pagado) - Costo de Inversión
        const gananciaReal = ingresoReal - costoInversion;
        // Porcentaje sacado directamente de la ganancia real
        const gananciaSegunPorcentaje = Number((gananciaReal * marginFactor).toFixed(2));
        const saldoPendiente = Math.max(0, presupuesto - ingresoReal);
        const totalBs = Number((ingresoReal * bcvRate).toFixed(2));

        // Lista de repuestos consumidos o reservados
        const partsList = [
          ...(job.consumedParts || []),
          ...(job.reservedParts || [])
        ].map(p => `${p.productName} (x${p.quantity}, costo: $${Number(p.costPrice || 0).toFixed(2)})`).join("; ");

        return {
          "N° Orden": job.id || "N/D",
          "Fecha Recepción": job.createdAt ? format(new Date(job.createdAt), "dd/MM/yyyy HH:mm") : "N/D",
          "Fecha Entrega": job.completedAt ? format(new Date(job.completedAt), "dd/MM/yyyy HH:mm") : "En taller",
          "Cliente": job.customerName || "Cliente General",
          "Cédula / RIF": job.customerID || "N/A",
          "Teléfono": job.customerPhone || "N/A",
          "Equipo / Dispositivo": `${job.deviceMake || ""} ${job.deviceModel || ""}`.trim() || "Equipo",
          "Falla Reportada": job.reportedIssue || "",
          "Estado": job.status || "Pendiente",
          "¿Pagado?": job.isPaid ? "SÍ" : (ingresoReal >= presupuesto && presupuesto > 0 ? "SÍ" : "NO"),
          "Presupuesto Total ($)": Number(presupuesto.toFixed(2)),
          "Ingreso Real (Total Pagado) ($)": Number(ingresoReal.toFixed(2)),
          "Costo de Inversión ($)": Number(costoInversion.toFixed(2)),
          "Ganancia Real (Ingreso Real - Costo) ($)": Number(gananciaReal.toFixed(2)),
          "% Ingresado": `${profitMarginPercent}%`,
          [`Ganancia Calculada (${profitMarginPercent}% de Ganancia Real) ($)`]: gananciaSegunPorcentaje,
          "Saldo Pendiente ($)": Number(saldoPendiente.toFixed(2)),
          "Total Pagado Real (Bs)": totalBs,
          "Tasa BCV Aplicada": Number(bcvRate.toFixed(2)),
          "Repuestos / Inversión Detalle": partsList || "Sin repuestos registrados",
          "Notas / Observaciones": job.notes || ""
        };
      });

      // Agregar fila de Totales para cuadre contable
      const totalRow = {
        "N° Orden": "TOTALES",
        "Fecha Recepción": "",
        "Fecha Entrega": "",
        "Cliente": `${rows.length} órdenes`,
        "Cédula / RIF": "",
        "Teléfono": "",
        "Equipo / Dispositivo": "",
        "Falla Reportada": "",
        "Estado": "",
        "¿Pagado?": "",
        "Presupuesto Total ($)": Number(summaryMetrics.totalPresupuesto.toFixed(2)),
        "Ingreso Real (Total Pagado) ($)": Number(summaryMetrics.totalIngresoReal.toFixed(2)),
        "Costo de Inversión ($)": Number(summaryMetrics.totalCostoInversion.toFixed(2)),
        "Ganancia Real (Ingreso Real - Costo) ($)": Number(summaryMetrics.totalGananciaReal.toFixed(2)),
        "% Ingresado": `${profitMarginPercent}%`,
        [`Ganancia Calculada (${profitMarginPercent}% de Ganancia Real) ($)`]: Number(summaryMetrics.totalGananciaSegunPorcentaje.toFixed(2)),
        "Saldo Pendiente ($)": Number(summaryMetrics.totalSaldoPendiente.toFixed(2)),
        "Total Pagado Real (Bs)": Number(summaryMetrics.totalIngresoRealBs.toFixed(2)),
        "Tasa BCV Aplicada": Number(bcvRate.toFixed(2)),
        "Repuestos / Inversión Detalle": "",
        "Notas / Observaciones": ""
      };

      const dataToExport = [...rows, totalRow];

      // Crear hoja de cálculo
      const worksheet = XLSX.utils.json_to_sheet(dataToExport);

      // Auto-ajustar anchos de columnas
      if (rows.length > 0) {
        const colNames = Object.keys(rows[0]);
        worksheet["!cols"] = colNames.map(col => ({
          wch: Math.max(
            ...dataToExport.map(row => (row[col as keyof typeof row] ?? "").toString().length),
            col.length + 3
          )
        }));
      }

      // Crear libro de Excel y anexar hoja
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Reparaciones");

      // Nombre de archivo con fecha
      const fileNameDate = dateFrom && dateTo ? `${dateFrom}_al_${dateTo}` : format(new Date(), "yyyy-MM-dd");
      const fileName = `Reporte_Reparaciones_GananciaReal_${fileNameDate}.xlsx`;

      XLSX.writeFile(workbook, fileName);

      toast({
        title: "¡Excel exportado con éxito!",
        description: `Se han exportado ${filteredData.length} reparaciones con cálculo de Ganancia Real.`
      });

      setOpen(false);
    } catch (err) {
      console.error("Error al exportar Excel:", err);
      toast({
        variant: "destructive",
        title: "Error al generar archivo",
        description: "Ocurrió un inconveniente al crear la hoja de cálculo."
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="icon" 
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-emerald-600 hover:border-emerald-300 transition-colors shadow-2xs" 
          title="Exportar reparaciones a Excel"
        >
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          <span className="sr-only">Exportar a Excel</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-bold text-foreground">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            Exportar Reparaciones a Excel
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Filtra por fechas y define el porcentaje a calcular sobre la <strong>Ganancia Real</strong> (Ingreso Real pagado menos el Costo de Inversión).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Botones de Atajo Rápido */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Periodo Rápido
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs px-2.5" 
                onClick={() => applyPreset('today')}
              >
                Hoy
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs px-2.5" 
                onClick={() => applyPreset('7days')}
              >
                Últimos 7 días
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs px-2.5" 
                onClick={() => applyPreset('thisMonth')}
              >
                Este Mes
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs px-2.5" 
                onClick={() => applyPreset('lastMonth')}
              >
                Mes Anterior
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs px-2.5" 
                onClick={() => applyPreset('all')}
              >
                Todo el Historial
              </Button>
            </div>
          </div>

          {/* Rango de Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dateFrom" className="text-xs font-medium">Fecha Desde</Label>
              <div className="relative">
                <Input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateTo" className="text-xs font-medium">Fecha Hasta</Label>
              <div className="relative">
                <Input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Configuración de Porcentaje de Ganancia & Filtro de Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="profitMargin" className="text-xs font-medium flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-emerald-600" />
                % a calcular s/ Ganancia Real
              </Label>
              <div className="relative">
                <Input
                  id="profitMargin"
                  type="number"
                  min="0"
                  max="1000"
                  step="1"
                  value={profitMarginPercent}
                  onChange={(e) => setProfitMarginPercent(Number(e.target.value) || 0)}
                  placeholder="50"
                  className="h-9 text-xs pr-8 font-semibold"
                />
                <span className="absolute right-3 top-2.5 text-xs text-muted-foreground font-bold pointer-events-none">
                  %
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Se extrae de la ganancia real (Ingreso pagado - Costo de inversión). Ej: $20 pagados - $10 costo = $10 ganancia real.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-primary" />
                Estado de la Orden
              </Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todas las órdenes</SelectItem>
                  <SelectItem value="completed" className="text-xs">Solo Entregadas (Completadas)</SelectItem>
                  <SelectItem value="paid" className="text-xs">Solo Pagadas</SelectItem>
                  <SelectItem value="unpaid" className="text-xs">Solo Por Cobrar</SelectItem>
                  <SelectItem value="pending" className="text-xs">Solo En Taller / Pendientes</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Filtra si deseas solo reparaciones liquidadas o entregadas.
              </p>
            </div>
          </div>

          {/* Tarjeta de Resumen / Previsualización en Tiempo Real */}
          <div className="p-3 bg-muted/40 rounded-xl border space-y-2 text-xs">
            <div className="flex items-center justify-between text-muted-foreground font-semibold pb-1 border-b">
              <span>Vista previa de cálculos</span>
              <span className="text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isLoadingAll ? (
                  <span className="flex items-center gap-1 text-[10px]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando historial...
                  </span>
                ) : (
                  `${filteredData.length} orden${filteredData.length === 1 ? '' : 'es'}`
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Ingreso Real (Total Pagado):</p>
                <p className="font-black text-foreground text-sm">
                  ${summaryMetrics.totalIngresoReal.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Bs {summaryMetrics.totalIngresoRealBs.toFixed(2)}
                </p>
              </div>

              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Costo de Inversión:</p>
                <p className="font-black text-destructive text-sm">
                  ${summaryMetrics.totalCostoInversion.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Saldo pendiente: ${summaryMetrics.totalSaldoPendiente.toFixed(2)}
                </p>
              </div>

              <div className="col-span-2 pt-2 border-t grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-background border">
                  <p className="text-[10px] text-muted-foreground font-semibold">Ganancia Real (Ingreso - Costo):</p>
                  <p className={cn("font-black text-sm", summaryMetrics.totalGananciaReal >= 0 ? "text-emerald-600" : "text-destructive")}>
                    ${summaryMetrics.totalGananciaReal.toFixed(2)}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    Ganancia ganada neta
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-[10px] text-emerald-800 dark:text-emerald-300 font-semibold">
                    Ganancia según % ({profitMarginPercent}%):
                  </p>
                  <p className="font-black text-emerald-600 text-sm">
                    ${summaryMetrics.totalGananciaSegunPorcentaje.toFixed(2)}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    Del monto de ganancia real
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          <Button 
            type="button" 
            variant="ghost" 
            size="sm" 
            onClick={() => setOpen(false)}
            disabled={isExporting}
          >
            Cancelar
          </Button>

          <Button 
            type="button" 
            size="sm" 
            onClick={handleExport} 
            disabled={isExporting || filteredData.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 shadow-sm"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generando Excel...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                Descargar Excel ({filteredData.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
