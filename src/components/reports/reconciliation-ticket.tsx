'use client';

import type { DailyReconciliation, PaymentMethod } from "@/lib/types";
import { format as formatDate, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { renderToString } from "react-dom/server";
import { useCurrency } from "@/hooks/use-currency";

type ReconciliationTicketProps = {
    reconciliation: DailyReconciliation;
    currency: ReturnType<typeof useCurrency>;
    businessName?: string;
}

const paymentMethodsOrder: PaymentMethod[] = ['Efectivo USD', 'Efectivo Bs', 'Tarjeta', 'Pago Móvil', 'Transferencia', 'USDT / Crypto'];

export function ReconciliationTicket({ reconciliation, currency, businessName }: ReconciliationTicketProps) {
    const { format, getSymbol } = currency;
    
    let globalStatus = "CAJA CUADRADA";
    if (reconciliation.totalDifference > 0.01) globalStatus = "SOBRANTE DETECTADO";
    else if (reconciliation.totalDifference < -0.01) globalStatus = "FALTANTE DETECTADO";

    return (
        <div className="recon-ticket">
            <div className="text-center mb-2">
                <h3 className="business-name bold-header" style={{ fontSize: '12pt' }}>{businessName || 'SISTEMA POS'}</h3>
                <p className="recon-header mt-1 bold-header" style={{ fontSize: '10pt' }}>CIERRE DE CAJA</p>
                <p className="meta-info">ID: {reconciliation.id}</p>
                <p className="meta-info">Fecha: {formatDate(parseISO(reconciliation.closedAt), "dd/MM/yyyy HH:mm:ss", { locale: es })}</p>
            </div>

            <div className="status-banner mt-3 mb-3 border-y py-2 text-center" style={{ borderTopStyle: 'solid', borderBottomStyle: 'solid', borderWidth: '1px' }}>
                <p className="bold-header" style={{ fontSize: '10pt' }}>{globalStatus}</p>
            </div>

            {reconciliation.notes && (
                <div className="notes-section mb-3 border p-2" style={{ borderStyle: 'dotted' }}>
                    <p className="section-subtitle text-center">OBSERVACIONES</p>
                    <p className="meta-info text-center italic uppercase">{reconciliation.notes}</p>
                </div>
            )}

            <div className="summary-section mt-4">
                <p className="section-subtitle text-center border-b mb-1">RESUMEN GENERAL</p>
                <div className="flex-row-between">
                    <span>VENTAS BRUTAS:</span>
                    <span className="bold-header">${format(reconciliation.totalSales, 'USD')}</span>
                </div>
                 <div className="flex-row-between">
                    <span>TRANSACCIONES:</span>
                    <span>{reconciliation.totalTransactions}</span>
                </div>
            </div>
            
            <div className="cash-flow-section mt-3 pt-1 border-t" style={{ borderTopStyle: 'dashed' }}>
                 <div className="flex-row-between">
                    <span>PAGOS RECIBIDOS:</span>
                    <span className="bold-header">+${ format(reconciliation.totalPaymentsReceived ?? 0, 'USD') }</span>
                </div>
                <div className="flex-row-between">
                    <span>VUELTOS ENTREGADOS:</span>
                    <span className="bold-header">-${ format(reconciliation.totalChangeGiven ?? 0, 'USD') }</span>
                </div>
                <div className="flex-row-between bold-header mt-1" style={{ fontSize: '9pt' }}>
                    <span>NETO ESPERADO:</span>
                    <span>${ format(reconciliation.totalExpected, 'USD') }</span>
                </div>
            </div>

            <div className="methods-breakdown mt-4">
                <p className="section-subtitle text-center border-b mb-2">DESGLOSE POR MÉTODO</p>
                {paymentMethodsOrder.map(method => {
                    if (!reconciliation.paymentMethods || !reconciliation.paymentMethods[method]) return null;
                    const details = reconciliation.paymentMethods[method]!;
                    const isUSD = method === 'Efectivo USD' || method === 'USDT / Crypto';
                    const symbol = isUSD ? '$' : 'Bs';
                    
                    let methodStatus = "CUADRADO";
                    if (details.difference > 0.01) methodStatus = "SOBRANTE";
                    else if (details.difference < -0.01) methodStatus = "FALTANTE";

                    return (
                        <div key={method} className="method-box mb-2">
                            <p className="bold-header text-[8pt]" style={{ textTransform: 'uppercase' }}>{method}</p>
                            <div className="flex-row-between text-[7pt]"><span>Esperado:</span><span>{symbol}{format(details.expected)}</span></div>
                            <div className="flex-row-between text-[7pt]"><span>Contado:</span><span>{symbol}{format(details.counted)}</span></div>
                            <div className="flex-row-between bold-header text-[7pt] mt-0.5">
                                <span>Diferencia:</span>
                                <span>{details.difference >= 0 ? '+' : ''}{symbol}{format(details.difference)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

             <div className="grand-total-container mt-4 pt-2 border-t" style={{ borderTopStyle: 'solid', borderTopWidth: '1.5px' }}>
                <div className="flex-row-between bold-header" style={{ fontSize: '11pt' }}>
                    <span>DIFERENCIA TOTAL:</span>
                    <span>{reconciliation.totalDifference >= 0 ? '+' : ''}${format(reconciliation.totalDifference, 'USD')}</span>
                </div>
             </div>
             
             <div className="text-center mt-6 footer-note">
                <p className="bold-header text-[7pt]">REPORTE GENERADO POR SISTEMA</p>
                <p className="meta-info mt-1 text-[6pt]">Fin del documento</p>
             </div>
        </div>
    );
}

export const handlePrintReconciliation = (props: ReconciliationTicketProps, onError: (message: string) => void) => {
    const ticketHtml = renderToString(<ReconciliationTicket {...props} />);
    const fullHtml = `
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reporte de Cierre de Caja</title>
                <style>
                    @media print {
                        @page { margin: 0; size: auto; }
                        body { margin: 0; padding: 0; visibility: visible !important; }
                    }
                    * { 
                        -webkit-print-color-adjust: exact !important; 
                        print-color-adjust: exact !important;
                        box-sizing: border-box;
                        border: none;
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
                    .recon-container { 
                        width: 52mm; 
                        margin: 0 auto; 
                        padding: 5px 1mm;
                    }
                    .text-center { text-align: center; }
                    .flex-row-between { display: flex; justify-content: space-between; align-items: baseline; }
                    .bold-header { font-weight: bold; }
                    .meta-info { font-size: 7pt; margin: 1px 0; }
                    .section-subtitle { font-size: 7pt; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
                    .mt-1 { margin-top: 2px; }
                    .mt-2 { margin-top: 4px; }
                    .mt-3 { margin-top: 6px; }
                    .mt-4 { margin-top: 8px; }
                    .mb-1 { margin-bottom: 2px; }
                    .mb-2 { margin-bottom: 4px; }
                    .border-t { border-top: 1px solid #000; }
                    .border-b { border-bottom: 1px solid #000; }
                    .border-y { border-top: 1px solid #000; border-bottom: 1px solid #000; }
                </style>
            </head>
            <body>
                <div class="recon-container">${ticketHtml}</div>
            </body>
        </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.bottom = '0';
    iframe.style.right = '0';
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
}