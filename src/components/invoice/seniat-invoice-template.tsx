
"use client";

import React from 'react';
import type { Sale, UserProfile, FiscalSettings } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { useDoc, useFirebase, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';

interface SeniatInvoiceProps {
  sale: Sale;
  profile: UserProfile;
  fiscalData: any;
}

export function SeniatInvoiceTemplate({ sale, profile, fiscalData }: SeniatInvoiceProps) {
  const { firestore, user } = useFirebase();
  
  const fiscalRef = useMemoFirebase(() =>
    (firestore && user) ? doc(firestore, 'users', user.uid, 'metadata', 'fiscal_settings') : null,
    [firestore, user?.uid]
  );
  const { data: globalFiscal } = useDoc<FiscalSettings>(fiscalRef);
  
  const f = (val: number) => {
    return new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val || 0);
  };

  const bcv = fiscalData?.bcvRate || sale.bcvRateAtTime || 1;
  const totalCobradoUSD = sale.actualPaidAmount ?? sale.totalAmount;
  const totalBsConImpuestos = totalCobradoUSD * bcv;

  const totals = (sale.items || []).reduce((acc, item) => {
    const isExempt = !!(item as any).isExempt;
    const lineTotalBs = (item.price * item.quantity) * bcv;
    if (isExempt) acc.exemptBs += lineTotalBs;
    else acc.taxableBs += lineTotalBs;
    return acc;
  }, { taxableBs: 0, exemptBs: 0 });

  const baseImponibleBs = totals.taxableBs / 1.16;
  const montoIvaBs = totals.taxableBs - baseImponibleBs;
  
  const totalPaidInDivisasUSD = (sale.payments || [])
    .filter(p => p.method === 'Efectivo USD' || p.method === 'USDT / Crypto')
    .reduce((sum, p) => sum + p.amount, 0);
  
  const totalChangeInUSD = sale.totalChangeInUSD || 0;
  const netDivisasUSD = Math.max(0, totalPaidInDivisasUSD - totalChangeInUSD);
  const igtfBs = (netDivisasUSD * bcv) * 0.03;
  
  const totalFacturaBs = baseImponibleBs + totals.exemptBs + montoIvaBs + igtfBs;

  // Datos dinámicos configurados en Ajustes
  const bizName = globalFiscal?.businessName || profile.businessName || 'POS MARICHE';
  const bizRIF = globalFiscal?.businessRIF || profile.businessRIF || 'J-00000000-0';
  const bizAddr = globalFiscal?.businessAddress || profile.businessAddress || 'DIRECCIÓN FISCAL';
  const bizPhone = globalFiscal?.businessPhone || profile.customerPhone || 'N/A';

  const printShop = {
    name: globalFiscal?.printShopName || 'IMPRENTA POR CONFIGURAR',
    rif: globalFiscal?.printShopRIF || 'J-00000000-0',
    providence: globalFiscal?.providenceNumber || 'PROV-0000-0000',
    date: globalFiscal?.formatDate || '00/00/0000',
    range: globalFiscal?.authorizedRange || '000001 - 999999'
  };

  return (
    <div className="flex flex-col items-center bg-white p-0 min-h-full">
      <div className="bg-white w-full max-w-[80mm] p-2 font-mono text-[11px] leading-tight text-black print:w-[72mm]">
        
        <div className="text-center space-y-1 mb-3">
          <h2 className="text-sm font-black uppercase">{bizName}</h2>
          <p className="font-bold">RIF: {bizRIF.toUpperCase()}</p>
          <p className="text-[9px] uppercase leading-none">{bizAddr.toUpperCase()}</p>
          <p className="text-[9px]">TELÉFONO: {bizPhone}</p>
        </div>

        <div className="border-t border-black border-dashed pt-2 mb-2 text-center">
          <p className="font-black text-[12px] tracking-tighter">FACTURA FISCAL</p>
          <p className="text-[9px] font-bold">SENIAT - FORMATO LIBRE</p>
          <div className="flex justify-between mt-1">
            <span className="font-bold uppercase">Factura N°:</span>
            <span className="font-black text-red-600">{fiscalData?.invoiceNumber || '00000000'}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold uppercase">Control N°:</span>
            <span className="font-black">{fiscalData?.controlNumber || '00-00000000'}</span>
          </div>
          <div className="flex justify-between text-[9px] mt-1 italic uppercase">
            <span>Fecha: {sale.transactionDate ? format(parseISO(sale.transactionDate), "dd/MM/yyyy") : 'N/A'}</span>
            <span>Hora: {sale.transactionDate ? format(parseISO(sale.transactionDate), "hh:mm a") : 'N/A'}</span>
          </div>
        </div>

        <div className="border-t border-black border-dashed py-2 space-y-0.5">
          <p className="font-bold uppercase">Cliente: {sale.customerName?.toUpperCase() || 'CLIENTE DE CONTADO'}</p>
          <p className="font-bold uppercase">C.I./RIF: {sale.customerID?.toUpperCase() || 'V-00000000'}</p>
          {sale.customerAddress && <p className="text-[9px] uppercase italic">Dir: {sale.customerAddress.toUpperCase()}</p>}
        </div>

        <div className="border-t border-black border-dashed py-2">
          <div className="flex justify-between font-black text-[10px] mb-1">
            <span>DESCRIPCIÓN</span>
            <span>TOTAL BS</span>
          </div>
          <div className="space-y-3">
            {(sale.items || []).map((item, idx) => {
              const isExempt = !!(item as any).isExempt;
              const lineTotalBs = (item.price * item.quantity) * bcv;
              return (
                <div key={idx} className="flex flex-col">
                  <div className="flex justify-between items-start gap-1">
                    <span className="uppercase font-bold">{item.quantity} x {item.name} ({isExempt ? 'E' : 'G'})</span>
                  </div>
                  <div className="flex justify-between items-end text-[10px] pl-4 opacity-90 italic">
                    <span>P.Unit: {f(item.price * bcv)}</span>
                    <span className="font-black not-italic">{f(lineTotalBs)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-black border-dashed py-1 text-[9px] font-bold text-center italic">
          TASA OFICIAL BCV: {f(bcv)} BS/$
        </div>

        <div className="border-t border-black border-dashed pt-2 space-y-1">
          <div className="flex justify-between"><span>SUBTOTAL GRAVABLE:</span><span>{f(baseImponibleBs)}</span></div>
          <div className="flex justify-between"><span>SUBTOTAL EXENTO:</span><span>{f(totals.exemptBs)}</span></div>
          <div className="flex justify-between font-bold"><span>IVA (16,00%):</span><span>{f(montoIvaBs)}</span></div>
          {igtfBs > 0 && <div className="flex justify-between font-black text-blue-800"><span>IGTF (3,00%):</span><span>{f(igtfBs)}</span></div>}
          <div className="flex justify-between items-center bg-black text-white px-1 py-1 mt-2">
            <span className="text-[12px] font-black uppercase">Total Bs:</span>
            <span className="text-[14px] font-black">{f(totalFacturaBs)}</span>
          </div>
          <div className="text-right font-black text-[10px] opacity-70">REF. FISCAL: ${f(totalFacturaBs / bcv)}</div>
        </div>

        <div className="mt-4 pt-2 border-t border-black border-dotted text-center space-y-1 text-[8px]">
          <p className="font-black uppercase">¡Gracias por su compra!</p>
          <div className="text-left italic space-y-0.5 opacity-80 uppercase">
            <p>Imprenta: {printShop.name}</p>
            <p>RIF: {printShop.rif} / Prov: {printShop.providence}</p>
            <p>Fecha: {printShop.date} / Rango: {printShop.range}</p>
          </div>
          <p className="text-[7px] font-bold mt-2 uppercase tracking-tighter">Copia Certificada del Original</p>
        </div>
      </div>
    </div>
  );
}
