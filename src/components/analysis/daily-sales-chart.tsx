"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface DailyPoint {
  day: string | number;
  value: number;
  profit?: number;
  count?: number;
}

/**
 * Gráfico de ventas por día (2026).
 *
 * SVG puro (sin librerías): área con degradado azul eléctrico, línea suavizada,
 * guía punteada en el promedio y tarjeta flotante blanca al pasar el dedo o el cursor.
 */
export function DailySalesChart({
  days,
  maxDay,
  symbol,
  format,
  className,
}: {
  days: DailyPoint[];
  maxDay: number;
  symbol: string;
  format: (value: number) => string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const W = 100;
  const H = 42;
  const TOP = 4;

  const { points, linePath, areaPath, average, best, activeDaysCount } = useMemo(() => {
    const total = days.length;
    const max = Math.max(maxDay, 0.01);
    const pts = days.map((d, index) => ({
      x: total > 1 ? (index / (total - 1)) * W : W / 2,
      y: TOP + (H - TOP) * (1 - Math.min(1, d.value / max)),
      ...d,
    }));

    // Curva suave: punto de control en el punto medio horizontal entre cada par.
    let path = pts.length > 0 ? `M ${pts[0].x} ${pts[0].y}` : "";
    for (let i = 1; i < pts.length; i++) {
      const previous = pts[i - 1];
      const current = pts[i];
      const cx = (previous.x + current.x) / 2;
      path += ` C ${cx} ${previous.y}, ${cx} ${current.y}, ${current.x} ${current.y}`;
    }

    const values = days.map((d) => d.value);
    const sum = values.reduce((acc, value) => acc + value, 0);
    const nonZeroDays = days.filter((d) => d.value > 0);
    const bestIndex = values.indexOf(Math.max(...values, 0));

    return {
      points: pts,
      linePath: path,
      areaPath: pts.length > 0 ? `${path} L ${W} ${H} L 0 ${H} Z` : "",
      average: nonZeroDays.length > 0 ? sum / nonZeroDays.length : 0,
      best: bestIndex >= 0 ? days[bestIndex] : null,
      activeDaysCount: nonZeroDays.length,
    };
  }, [days, maxDay]);

  const activePoint = active !== null ? points[active] : null;
  const averageY = TOP + (H - TOP) * (1 - Math.min(1, average / Math.max(maxDay, 0.01)));
  const midDay = Math.ceil(days.length / 2);

  return (
    <div className={cn("select-none", className)}>
      <div className="relative pt-8">
        {activePoint && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-[11px] shadow-md"
            style={{ left: `${Math.min(84, Math.max(16, (activePoint.x / W) * 100))}%` }}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-500">Día {activePoint.day}</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {symbol}
                {format(activePoint.value)}
              </span>
              {typeof activePoint.count === "number" && activePoint.count > 0 && (
                <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  {activePoint.count} {activePoint.count === 1 ? "venta" : "ventas"}
                </span>
              )}
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-40 w-full overflow-visible sm:h-48"
          onMouseLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id="dailySalesFill2026" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
              <stop offset="65%" stopColor="#4f46e5" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="dailySalesStroke2026" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>

          {/* Guías horizontales sutiles */}
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              x2={W}
              y1={TOP + (H - TOP) * ratio}
              y2={TOP + (H - TOP) * ratio}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray={ratio === 1 ? undefined : "3 4"}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Línea de promedio */}
          {average > 0 && (
            <line
              x1={0}
              x2={W}
              y1={averageY}
              y2={averageY}
              stroke="#3b82f6"
              strokeWidth={1.25}
              strokeDasharray="4 4"
              strokeOpacity={0.45}
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path d={areaPath} fill="url(#dailySalesFill2026)" />
          <path
            d={linePath}
            fill="none"
            stroke="url(#dailySalesStroke2026)"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Zonas táctiles por día */}
          {points.map((point, index) => (
            <rect
              key={point.day}
              x={point.x - W / Math.max(points.length - 1, 1) / 2}
              y={0}
              width={W / Math.max(points.length - 1, 1)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setActive(index)}
              onTouchStart={() => setActive(index)}
            />
          ))}

          {activePoint && (
            <>
              <line
                x1={activePoint.x}
                x2={activePoint.x}
                y1={TOP}
                y2={H}
                stroke="#2563eb"
                strokeWidth={1.25}
                strokeOpacity={0.3}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={1.35}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={0.55}
              />
            </>
          )}
        </svg>
      </div>

      {/* Eje X y métricas rápidas */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
        <div className="flex items-center gap-3 tabular-nums text-slate-400">
          <span>Día 1</span>
          <span className="hidden sm:inline">· Día {midDay}</span>
          <span>· Día {days.length}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums">
            Prom. activo: {symbol}
            {format(average)}
          </span>
          {best && best.value > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 tabular-nums">
              Mejor día ({best.day}): {symbol}
              {format(best.value)}
            </span>
          )}
          {activeDaysCount > 0 && (
            <span className="hidden rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 text-[11px] text-slate-500 sm:inline-flex">
              {activeDaysCount} días con ventas
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
