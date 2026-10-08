import type { RepairJob, UserProfile } from "@/lib/types";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { renderToString } from "react-dom/server";

type RepairTicketProps = {
    repairJob: RepairJob;
    businessName?: string;
    profile?: UserProfile | null;
    bcvRate?: number;
    parallelRate?: number;
}

// SECCIÓN 1: NOTA DE ENTREGA (CLIENTE)
export function CustomerTicket({ repairJob, businessName, profile, bcvRate = 1, parallelRate = 1 }: RepairTicketProps) {
    const total = repairJob.estimatedCost || 0;
    const abono = repairJob.amountPaid || 0;
    const saldo = Math.max(0, total - abono);
    const date = repairJob.createdAt ? parseISO(repairJob.createdAt) : new Date();
    const fecha = format(date, "dd/MM/yyyy HH:mm:ss", { locale: es });

    // USAR TASA DE REPOSICIÓN SI EL TRABAJO ES PROMO
    const appliedRate = repairJob.isPromo ? parallelRate : bcvRate;
    
    const totalBs = total * appliedRate;
    const saldoBs = saldo * appliedRate;

    const warranty = profile?.repairWarrantyPolicy || "4 DÍAS POR EL SERVICIO REALIZADO.";
    const pickup = profile?.repairPickupPolicy || "7 DÍAS MÁXIMO UNA VEZ NOTIFICADO. EL NEGOCIO NO SE HACE RESPONSABLE PASADO ESTE TIEMPO.";
    const disclaimer = profile?.repairDisclaimer || "NO NOS HACEMOS RESPONSABLES POR TELÉFONOS MOJADOS O QUE SUFRIERON CAÍDAS.";
    const showRate = profile?.showRateOnReceipt !== false;
    const showTerms = profile?.showTermsOnReceipt !== false;

    return (
        <div className="ticket-body">
            <div className="text-center mb-2">
                <h3 className="business-title bold-header" style={{ fontSize: '12pt' }}>{businessName || 'POOS MARICHE'}</h3>
                <p className="ticket-type mt-1 bold-header" style={{ fontSize: '10pt' }}>ORDEN DE REPARACIÓN</p>
                <p className="meta-info">{repairJob.id}</p>
                <p className="meta-info">Fecha: {fecha}</p>
            </div>
            
            <div className="section-divider mt-2 mb-1"></div>
            
            <div className="details-section">
                <p className="section-subtitle text-center">DATOS DEL CLIENTE</p>
                <p className="meta-info"><span className="bold-header">Cliente:</span> {repairJob.customerName.toUpperCase()}</p>
                <p className="meta-info"><span className="bold-header">Documento:</span> {repairJob.customerID || 'N/A'}</p>
                <p className="meta-info"><span className="bold-header">Teléfono:</span> {repairJob.customerPhone}</p>
                {repairJob.customerAddress && <p className="meta-info"><span className="bold-header">Dirección:</span> {repairJob.customerAddress.toUpperCase()}</p>}
                
                <div className="mt-2">
                    <p className="section-subtitle text-center">DETALLES DEL EQUIPO</p>
                    <p className="meta-info"><span className="bold-header">Marca/Modelo:</span> {repairJob.deviceMake.toUpperCase()} {repairJob.deviceModel.toUpperCase()}</p>
                    <p className="meta-info"><span className="bold-header">Falla:</span> {repairJob.reportedIssue.toUpperCase()}</p>
                </div>

                {repairJob.reservedParts && repairJob.reservedParts.length > 0 && (
                    <div className="mt-2">
                        <p className="section-subtitle text-center">REPUESTOS / SERVICIOS</p>
                        {repairJob.reservedParts.map((part, idx) => (
                            <p key={idx} className="meta-info text-[7pt]">
                                • {part.productName.toUpperCase()} 
                                {part.isWarranty && <span className="bold-header"> [GARANTÍA]</span>}
                                {part.isPromo && !part.isWarranty && <span className="bold-header"> [OFERTA]</span>}
                            </p>
                        ))}
                    </div>
                )}
            </div>

            <div className="billing-section mt-3 pt-1 border-t" style={{ borderTopStyle: 'dashed' }}>
                <div className="flex-row-between text-[8pt]">
                    <span>Costo estimado:</span>
                    <span>${total.toFixed(2)}</span>
                </div>
                <div className="flex-row-between text-[8pt]">
                    <span>Abono recibido:</span>
                    <span>${abono.toFixed(2)}</span>
                </div>
                <div className="flex-row-between total-row mt-1 bold-header" style={{ fontSize: '10pt' }}>
                    <span>SALDO PENDIENTE:</span>
                    <span>${saldo.toFixed(2)}</span>
                </div>
                
                {saldo > 0 && (
                    <div className="mt-1 flex-row-between text-[8pt] font-black">
                        <span>EQUIVALENTE EN BS:</span>
                        <span>Bs {saldoBs.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                    </div>
                )}
            </div>

            {showTerms && (
                <div className="disclaimer-section mt-3 text-[6.5pt]">
                    <p className="text-center font-bold mb-1" style={{ fontSize: '8pt' }}>TÉRMINOS Y CONDICIONES</p>
                    <p className="policy-text"><span className="bold-header">GARANTÍA:</span> {warranty.toUpperCase()}</p>
                    <p className="policy-text"><span className="bold-header">RETIRO:</span> {pickup.toUpperCase()}</p>
                    <p className="mt-1 font-bold policy-text">{disclaimer.toUpperCase()}</p>
                    <p className="text-center uppercase mt-3 bold-header" style={{ fontSize: '8pt' }}>INDISPENSABLE PRESENTAR TICKET</p>
                </div>
            )}

            <div className="text-center mt-4 footer-thanks">
                <p className="bold-header text-[8pt]">¡GRACIAS POR SU CONFIANZA!</p>
                {showRate && (
                    <p className="meta-info text-[6pt] mt-1 italic">TASA REF: {appliedRate.toFixed(2)} Bs/$</p>
                )}
            </div>
        </div>
    );
}

// SECCIÓN 2: CONTROL INTERNO (NEGOCIO)
export function InternalTicket({ repairJob, bcvRate = 1, parallelRate = 1, profile }: RepairTicketProps) {
    const total = repairJob.estimatedCost || 0;
    const abono = repairJob.amountPaid || 0;
    const saldo = Math.max(0, total - abono);
    const date = repairJob.createdAt ? parseISO(repairJob.createdAt) : new Date();
    const fecha = format(date, "dd/MM/yyyy HH:mm:ss", { locale: es });
    
    const appliedRate = repairJob.isPromo ? parallelRate : bcvRate;
    const showRate = profile?.showRateOnReceipt !== false;

    return (
        <div className="ticket-body internal">
            <div className="text-center mb-2">
                <h3 className="section-header bold-header" style={{ fontSize: '10pt' }}>CONTROL INTERNO</h3>
                <p className="meta-info">{repairJob.id}</p>
                <p className="meta-info">{fecha}</p>
            </div>

            <div className="service-info mt-2">
                <p className="section-subtitle text-center border-b">DATOS DE SERVICIO</p>
                <p className="meta-info"><span className="bold-header">CLIENTE:</span> {repairJob.customerName.toUpperCase()}</p>
                <p className="meta-info"><span className="bold-header">EQUIPO:</span> {repairJob.deviceMake.toUpperCase()} {repairJob.deviceModel.toUpperCase()}</p>
                <p className="meta-info"><span className="bold-header">FALLA:</span> {repairJob.reportedIssue.toUpperCase()}</p>
                
                <div className="mt-3 p-2 border text-center" style={{ borderStyle: 'solid' }}>
                    <p className="bold-header" style={{ fontSize: '11pt' }}>SALDO: ${saldo.toFixed(2)}</p>
                    {showRate && (
                        <p className="text-[8pt] font-bold">Bs { (saldo * appliedRate).toLocaleString('de-DE', { minimumFractionDigits: 2 }) }</p>
                    )}
                </div>
            </div>

            <div className="signatures-container mt-10">
                <div className="signature-box" style={{ borderTop: '1px solid #000', paddingTop: '4px' }}>
                    <p className="bold-header text-[8pt]">FIRMA DEL CLIENTE</p>
                    <p className="text-[6pt] mt-1">ACEPTO TÉRMINOS Y RECIBO CONFORME</p>
                </div>
            </div>
        </div>
    );
}

// SECCIÓN 3: ETIQUETA DE EQUIPO (PEGATINA)
export function StickerTicket({ repairJob }: RepairTicketProps) {
    const total = repairJob.estimatedCost || 0;
    const abono = repairJob.amountPaid || 0;
    const saldo = Math.max(0, total - abono);

    return (
        <div className="sticker-body">
            <div className="sticker-border" style={{ border: '1.5px solid #000', padding: '4px' }}>
                <p className="sticker-id bold-header" style={{ fontSize: '12pt' }}>ID: {repairJob.id}</p>
                <p className="sticker-text bold-header" style={{ fontSize: '9pt' }}>{repairJob.customerName.toUpperCase()}</p>
                <p className="sticker-text" style={{ fontSize: '8pt' }}>{repairJob.deviceMake.toUpperCase()} {repairJob.deviceModel.toUpperCase()}</p>
                
                <div className="sticker-issue-box mt-1 border py-1" style={{ borderStyle: 'solid' }}>
                    <p className="sticker-issue-text font-bold" style={{ fontSize: '7pt' }}>FALLA: {repairJob.reportedIssue.toUpperCase()}</p>
                </div>

                <div className="sticker-balance-row mt-1">
                    <p className="sticker-balance bold-header" style={{ fontSize: '11pt' }}>SALDO: ${saldo.toFixed(2)}</p>
                </div>
            </div>
        </div>
    );
}

const getPrintStyles = (leftMargin: number = 0) => `
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
    .ticket-container { 
        width: 52mm; 
        margin: 0; 
        padding: 5px 1mm;
        padding-left: ${leftMargin}mm;
    }
    .text-center { text-align: center; }
    .bold-header { font-weight: bold; }
    .flex-row-between { display: flex; justify-content: space-between; align-items: baseline; }
    .meta-info { font-size: 7pt; margin: 1px 0; }
    .section-subtitle { font-size: 7pt; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; margin-top: 4px; }
    .details-section p { margin: 1px 0; }
    .signature-box { text-align: center; }
    .cut-line { 
        border-top: 1px dashed #000 !important; 
        margin: 15px 0; 
        height: 1px;
        width: 100%;
    }
    .policy-text {
        line-height: 1.4;
        margin-bottom: 3px;
    }
    .mt-1 { margin-top: 2px; }
    .mt-2 { margin-top: 4px; }
    .mt-3 { margin-top: 6px; }
    .mt-4 { margin-top: 8px; }
    .mt-10 { margin-top: 25px; }
    .mb-1 { margin-bottom: 2px; }
    .mb-2 { margin-bottom: 4px; }
    .font-black { font-weight: 900; }
`;

function iframePrint(html: string, leftMargin: number = 0) {
    try {
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
            doc.write(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${getPrintStyles(leftMargin)}</style></head><body><div class="ticket-container">${html}</div></body></html>`);
            doc.close();

            setTimeout(() => {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
                setTimeout(() => {
                    document.body.removeChild(iframe);
                }, 1500);
            }, 500);
        }
    } catch (e) {
        console.error("Print Error:", e);
    }
}

export const handlePrintCustomerTicket = (props: RepairTicketProps, onError: (message: string) => void) => {
    try {
        const leftMargin = props.profile?.printLeftMargin || 0;
        const html = renderToString(<CustomerTicket {...props} />);
        iframePrint(html, leftMargin);
    } catch (e: any) {
        onError(e.message);
    }
};

export const handlePrintInternalTicket = (props: RepairTicketProps, onError: (message: string) => void) => {
    try {
        const leftMargin = props.profile?.printLeftMargin || 0;
        const html = renderToString(<InternalTicket {...props} />);
        iframePrint(html, leftMargin);
    } catch (e: any) {
        onError(e.message);
    }
};

export const handlePrintStickerTicket = (props: RepairTicketProps, onError: (message: string) => void) => {
    try {
        const leftMargin = props.profile?.printLeftMargin || 0;
        const html = renderToString(<StickerTicket {...props} />);
        iframePrint(html, leftMargin);
    } catch (e: any) {
        onError(e.message);
    }
};

export const handlePrintAllTickets = (props: RepairTicketProps, onError: (message: string) => void) => {
    try {
        const leftMargin = props.profile?.printLeftMargin || 0;
        const html = renderToString(
            <>
                <CustomerTicket {...props} />
                <div className="cut-line"></div>
                <InternalTicket {...props} />
                <div className="cut-line"></div>
                <StickerTicket {...props} />
            </>
        );
        iframePrint(html, leftMargin);
    } catch (e: any) {
        onError(e.message);
    }
};