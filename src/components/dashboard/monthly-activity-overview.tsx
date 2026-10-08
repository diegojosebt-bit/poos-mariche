"use client"

import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import type { Sale, RepairJob } from "@/lib/types";
import { format as formatDate, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { es } from 'date-fns/locale';
import { useCurrency } from "@/hooks/use-currency";
import { Skeleton } from "../ui/skeleton";
import { useMemo } from "react";

type MonthlyActivityOverviewProps = {
  sales: Sale[];
  repairJobs: RepairJob[];
  isLoading?: boolean;
};

export default function MonthlyActivityOverview({ sales, repairJobs, isLoading }: MonthlyActivityOverviewProps) {
  const { format: formatCurrency, getSymbol } = useCurrency();
  
  const { chartData, currentMonth } = useMemo(() => {
    if (isLoading || !sales || !repairJobs) return { chartData: [], currentMonth: '' };

    const now = new Date();
    const currentMonthName = formatDate(now, 'MMMM yyyy', { locale: es });
    const firstDayOfMonth = startOfMonth(now);
    const lastDayOfMonth = endOfMonth(now);
    const daysInMonth = eachDayOfInterval({ start: firstDayOfMonth, end: lastDayOfMonth });

    const data = daysInMonth.map(day => {
      const dailySales = sales
        .filter(s => s.transactionDate && isSameDay(new Date(s.transactionDate), day) && s.status !== 'refunded')
        .reduce((acc, s) => acc + (s.actualPaidAmount ?? s.totalAmount), 0);
      
      const dailyRepairs = repairJobs
        .filter(r => r.createdAt && isSameDay(new Date(r.createdAt), day))
        .length;

      return {
        name: formatDate(day, 'd'),
        ventas: dailySales,
        reparaciones: dailyRepairs,
      };
    });

    return { chartData: data, currentMonth: currentMonthName };
  }, [sales, repairJobs, isLoading]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad Mensual ({currentMonth})</CardTitle>
        <CardDescription>Resumen de ingresos netos y reparaciones registradas.</CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        {isLoading ? (
            <div className="w-full h-[350px] flex items-center justify-center">
                <Skeleton className="h-full w-full" />
            </div>
        ) : (
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData}>
            <XAxis
              dataKey="name"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `Día ${value}`}
            />
            <YAxis
              yAxisId="left"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${getSymbol()}${formatCurrency(value)}`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
            />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted))' }}
              contentStyle={{ 
                background: 'hsl(var(--background))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
              }}
              formatter={(value, name) => {
                if (name === 'ventas') {
                  return [`${getSymbol()}${(formatCurrency(value as number))}`, 'Ingreso Neto'];
                }
                if (name === 'reparaciones') {
                  return [value, 'Reparaciones'];
                }
                return [value, name];
              }}
            />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="ventas" name="ventas" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 4, fill: "hsl(var(--chart-1))" }} activeDot={{ r: 6 }} />
            <Line yAxisId="right" type="monotone" dataKey="reparaciones" name="reparaciones" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 4, fill: "hsl(var(--chart-2))" }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
