'use client';

import type { Sale, Payment, UserProfile, RepairJob } from "@/lib/types";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { renderToString } from 'react-dom/server';
import React from "react";

type ReceiptViewProps = {
    sale: Sale;
    currency: {
        format: (value: number, targetCurrency?: any) => string;
        getSymbol: (targetCurrency?: any) => string;
        convert: (value: number, from: any, to: any) => number;
    };
    businessName?: string;
    profile?: UserProfile | null;
    repairData?: RepairJob | null;
}

export function ReceiptView({ sale, currency, businessName, profile, repairData }: ReceiptViewProps) {
    const { format: formatCurrency, getSymbol } = currency;

    const getPaymentAmountInCorrectCurrency = (payment: Payment) => {
        const isUSD = payment.method === 'Efectivo USD' || payment.method === 'USDT / Crypto';
        const symbol = isUSD ? getSymbol('USD') : getSymbol('Bs');
        return `${symbol}${formatCurrency(payment.amount, isUSD ? 'USD' : 'Bs')}`;
    };

    const showInfo = profile?.showInfoOnReceipt;
    const showRate = profile?.showRateOnReceipt !== false;
    const isRepairReceipt = !!sale.repairJobId && repairData;
    
    const bcvRate = sale.bcvRateAtTime || 1;
    const totalBs = sale.totalAmount * bcvRate;

    // Calcular ahorro total para el resumen
    const totalDiscount = sale.items.reduce((sum, item) => sum + ((item.discount || 0) * item.quantity), 0);
    const grossSubtotal = sale.totalAmount + totalDiscount;

    return (
         <div className="receipt-content">
            <div className="text-center mb-2">
                <h3 className="business-name bold-header" style={{ fontSize: '12pt' }}>{businessName || 'POS MARICHE'}</h3>
                {showInfo && profile?.businessRIF && (
                    <p className="meta-info font-bold">RIF: {profile.businessRIF.toUpperCase()}</p>
                )}
                {showInfo && profile?.businessAddress && (
                    <p className="meta-info text-[7pt] italic leading-tight">{profile.businessAddress}</p>
                )}
                
                <p className="ticket-title mt-2 bold-header" style={{ fontSize: '10pt' }}>NOTA DE VENTA</p>
                <p className="meta-info">{sale.id}</p>
                <p className="meta-info mt-1">Fecha: {format(parseISO(sale.transactionDate), "dd/MM/yyyy HH:mm:ss", { locale: es })}</p>
            </div>

            {(sale.customerName || sale.customerID) && !isRepairReceipt && (
                <div className="customer-info-section mb-2 border-y py-1 text-center">
                    <p className="section-subtitle">CLIENTE</p>
                    {sale.customerName && <p className="meta-info bold-header">{sale.customerName.toUpperCase()}</p>}
                    {sale.customerID && <p className="meta-info font-bold">C.I./RIF: {sale.customerID}</p>}
                </div>
            )}
            
            {isRepairReceipt && (
                <div className="repair-info-section mb-2 border-y py-1">
                    <p className="section-subtitle text-center">DATOS DEL SERVICIO</p>
                    <p className="meta-info"><span className="bold-header">CLIENTE:</span> {sale.customerName?.toUpperCase() || repairData.customerName.toUpperCase()}</p>
                    <p className="meta-info"><span className="bold-header">TRABAJO:</span> {sale.repairJobId}</p>
                    <p className="meta-info"><span className="bold-header">EQUIPO:</span> {repairData.deviceMake.toUpperCase()} {repairData.deviceModel.toUpperCase()}</p>
                </div>
            )}

            <div className="section-divider mt-2 mb-1"></div>
            
            <div className="items-list">
                {sale.items.map((item, idx) => {
                    const hasDiscount = (item.discount || 0) > 0;
                    const itemOriginalPrice = item.price + (item.discount || 0);

                    return (
                        <div key={idx} className="item-block border-b border-dotted pb-1 mb-1">
                            <div className="item-row flex-row-between text-[8pt]">
                                <span className="item-name flex-1 text-left">
                                    {item.name} ({item.quantity})
                                    {item.isWarranty && <span className="bold-header"> [GARANTÍA]</span>}
                                    {item.isGift && <span className="bold-header"> [OBSEQUIO]</span>}
                                </span>
                                <span className="item-total w-1/3 text-right">
                                    {formatCurrency(itemOriginalPrice * item.quantity, 'USD')}
                                </span>
                            </div>
                            {hasDiscount && (
                                <div className="flex-row-between text-[7pt] italic">
                                    <span className="pl-2">Descuento aplicado:</span>
                                    <span>-{formatCurrency(item.discount * item.quantity, 'USD')}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="totals-section mt-2 pt-1 border-t" style={{ borderTopStyle: 'dashed', borderTopWidth: '1px' }}>
                 <div className="flex-row-between text-[8pt]">
                    <span>Monto Bruto:</span>
                    <span>{formatCurrency(grossSubtotal, 'USD')}</span>
                </div>
                {totalDiscount > 0 && (
                    <div className="flex-row-between text-[8pt] italic">
                        <span>Descuento Total:</span>
                        <span>-{formatCurrency(totalDiscount, 'USD')}</span>
                    </div>
                )}
                 <div className="flex-row-between total-row bold-header mt-1" style={{ fontSize: '10pt' }}>
                    <span>TOTAL A PAGAR:</span>
                    <span>USD {formatCurrency(sale.totalAmount, 'USD')}</span>
                </div>
                <div className="flex-row-between font-black text-[8pt] mt-0.5">
                    <span>VALOR EN BS:</span>
                    <span>Bs {formatCurrency(totalBs, 'Bs')}</span>
                </div>
            </div>

            {isRepairReceipt && (
                <div className="repair-consolidation mt-2 border p-1 bg-slate-50">
                    <p className="section-subtitle text-center border-b mb-1">RESUMEN DE CUENTA</p>
                    <div className="flex-row-between text-[7pt]">
                        <span>COSTO ESTIMADO:</span>
                        <span>${formatCurrency(repairData.estimatedCost, 'USD')}</span>
                    </div>
                    <div className="flex-row-between text-[7pt]">
                        <span>ABONADO PREVIO:</span>
                        <span>-${formatCurrency(repairData.amountPaid - (sale.actualPaidAmount || 0), 'USD')}</span>
                    </div>
                    <div className="flex-row-between bold-header text-[8pt] border-t mt-1">
                        <span>SALDO RESTANTE:</span>
                        <span>${formatCurrency(Math.max(0, repairData.estimatedCost - repairData.amountPaid), 'USD')}</span>
                    </div>
                </div>
            )}
            
            <div className="payments-section mt-3">
                <p className="section-subtitle text-center mb-1">PAGOS RECIBIDOS</p>
                {sale.payments.map((p, index) => (
                    <div key={index} className="flex-row-between text-[7pt]">
                        <span className="method-name">{p.method}{p.reference ? ` (${p.reference})` : ''}:</span>
                        <span className="method-amount">{getPaymentAmountInCorrectCurrency(p)}</span>
                    </div>
                ))}
            </div>

            {sale.changeGiven && sale.changeGiven.length > 0 && (
                 <div className="change-section mt-2 border-t pt-1" style={{ borderTopStyle: 'dotted' }}>
                    <p className="section-subtitle text-center">VUELTO ENTREGADO</p>
                    {sale.changeGiven.map((change, index) => {
                        const isUSD = change.method === 'Efectivo USD' || change.method === 'USDT / Crypto';
                        const symbol = isUSD ? getSymbol('USD') : getSymbol('Bs');
                        return (
                            <div key={index} className="flex-row-between text-[7pt]">
                                <span className="method-name">{change.method}:</span>
                                <span>{symbol}{formatCurrency(change.amount, isUSD ? 'USD' : 'Bs')}</span>
                            </div>
                        );
                    })}
                </div>
            )}

             <div className="footer-section mt-4 border-t pt-2 text-center">
                <p className="bold-header text-[8pt]">¡GRACIAS POR SU CONFIANZA!</p>
                {showRate && (
                    <p className="meta-info text-[6pt] mt-1 italic">TASA REF: {bcvRate.toFixed(2)} Bs/$</p>
                )}
                <p className="meta-info text-[6pt] mt-2">Documento generado desde el sistema</p>
             </div>
        </div>
    )
};

export const handlePrintReceipt = (props: ReceiptViewProps, onError: (message: string) => void) => {
    try {
        const leftMargin = props.profile?.printLeftMargin || 0;
        const receiptHtml = renderToString(<ReceiptView {...props} />);
        const fullHtml = `
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Nota de Venta</title>
                    <style>
                        @media print {
                            @page { margin: 0; size: auto; }
                            body { margin: 0; padding: 0; }
                        }
                        * { 
                            -webkit-print-color-adjust: exact !important; 
                            print-color-adjust: exact !important;
                            box-sizing: border-box;
                            margin: 0;
                            padding: 0;
                        }
                        body { 
                            font-family: 'Helvetica', 'Arial', sans-serif; 
                            font-size: 8pt;
                            line-height: 1.6;
                            background-color: #fff; 
                            color: #000 !important;
                        }
                        .receipt-container { 
                            width: 52mm; 
                            margin: 0; 
                            padding: 5px 1mm;
                            padding-left: ${leftMargin}mm;
                        }
                        .text-center { text-align: center; }
                        .bold-header { 
                            font-weight: bold; 
                        }
                        .meta-info { font-size: 7pt; margin: 1px 0; }
                        .flex-row-between { display: flex; justify-content: space-between; align-items: baseline; }
                        .item-name { text-transform: uppercase; padding-right: 4px; }
                        .section-subtitle { font-size: 7pt; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
                        .total-row { border-top: 1px solid #000; padding-top: 2px; }
                        .footer-section { border-top: 1px solid #000; margin-top: 10px; }
                        .border-t { border-top: 1px solid #000; }
                        .border-b { border-bottom: 1px solid #000; }
                        .border-y { border-top: 1px solid #000; border-bottom: 1px solid #000; }
                        .mt-1 { margin-top: 2px; }
                        .mt-2 { margin-top: 4px; }
                        .mt-3 { margin-top: 6px; }
                        .mt-4 { margin-top: 8px; }
                        .mb-1 { margin-bottom: 2px; }
                        .mb-2 { margin-bottom: 4px; }
                        .font-black { font-weight: 900; }
                        .item-block { width: 100%; }
                    </style>
                </head>
                <body>
                    <div class="receipt-container">${receiptHtml}</div>
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
    } catch (e: any) {
        onError("Error al generar el recibo: " + e.message);
    }
};