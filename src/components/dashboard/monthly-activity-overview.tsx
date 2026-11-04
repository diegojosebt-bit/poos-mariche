"use client"

import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "../ui/skeleton"
import { useCurrency } from "@/hooks/use-currency"

export type MonthlyDayPoint = {
  name: string;
  ventas: number;
  utilidad: number;
};

type MonthlyActivityOverviewProps = {
  monthLabel: string;
  days: MonthlyDayPoint[];
  isLoading?: boolean;
};

/**
 * Gráfico mensual alimentado por `stats_monthly` (1 lectura por mes).
 * Antes se calculaba desde 50 ventas + 100 reparaciones (150 lecturas).
 */
export default function MonthlyActivityOverview({ monthLabel, days, isLoading }: MonthlyActivityOverviewProps) {
  const { format: formatCurrency, getSymbol } = useCurrency();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad Mensual ({monthLabel})</CardTitle>
        <CardDescription>Ventas netas y utilidad por día. Datos agregados del mes.</CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        {isLoading ? (
          <div className="w-full h-[350px] flex items-center justify-center">
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={days} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={(value) => `${getSymbol()}${formatCurrency(Number(value))}`}
                />
                <Tooltip
                  formatter={(value: any, name: any) => [
                    `${getSymbol()}${formatCurrency(Number(value))}`,
                    name === 'ventas' ? 'Ventas' : 'Utilidad',
                  ]}
                  labelFormatter={(label) => `Día ${label}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="ventas"
                  name="Ventas"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="utilidad"
                  name="Utilidad"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
