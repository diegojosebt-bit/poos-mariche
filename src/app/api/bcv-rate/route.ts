import { NextResponse } from 'next/server';

export const revalidate = 60; // Revalidate every 60 seconds

export async function GET() {
  try {
    let bcvRate: number | undefined = undefined;
    let parallelRate: number | undefined = undefined;
    let source = 'open.er-api.com';

    // Primary Source: open.er-api.com (returns live official VES rate e.g. 871.36)
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        next: { revalidate: 60 }
      });
      if (res.ok) {
        const data = await res.json();
        const vesRate = data?.rates?.VES;
        if (typeof vesRate === 'number' && vesRate > 0) {
          bcvRate = vesRate;
          source = 'open.er-api.com';
        }
      }
    } catch (e) {
      console.warn('open.er-api fetch failed:', e);
    }

    // Secondary Source: api.exchangerate-api.com
    if (!bcvRate) {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          next: { revalidate: 60 }
        });
        if (res.ok) {
          const data = await res.json();
          const vesRate = data?.rates?.VES;
          if (typeof vesRate === 'number' && vesRate > 0) {
            bcvRate = vesRate;
            source = 'exchangerate-api.com';
          }
        }
      } catch (e) {
        console.warn('exchangerate-api fetch failed:', e);
      }
    }

    // Fetch parallel rate from dolarapi as supplement if available
    try {
      const parRes = await fetch('https://ve.dolarapi.com/v1/dolares/paralelo', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 60 }
      });
      if (parRes.ok) {
        const parData = await parRes.json();
        if (parData?.promedio && parData.promedio > 0) {
          parallelRate = parData.promedio;
        }
      }
    } catch (_) {}

    // Fallback: ve.dolarapi.com
    if (!bcvRate) {
      try {
        const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          next: { revalidate: 60 }
        });
        if (res.ok) {
          const data = await res.json();
          const rate = data?.promedio || data?.venta || data?.compra;
          if (typeof rate === 'number' && rate > 0) {
            bcvRate = rate;
            source = 've.dolarapi.com';
          }
        }
      } catch (e) {
        console.warn('dolarapi fetch failed:', e);
      }
    }

    if (bcvRate && bcvRate > 0) {
      return NextResponse.json({
        bcvRate: parseFloat(bcvRate.toFixed(4)),
        parallelRate: parallelRate ? parseFloat(parallelRate.toFixed(4)) : undefined,
        source,
        lastUpdated: new Date().toISOString()
      });
    }

    return NextResponse.json({ error: 'No se pudo obtener la tasa BCV de ninguna fuente' }, { status: 502 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Error interno' }, { status: 500 });
  }
}
