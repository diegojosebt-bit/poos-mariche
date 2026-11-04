'use client';

import { doc, Firestore } from 'firebase/firestore';

/**
 * Motor Atómico de Correlativos Fiscales.
 * Extrae y aumenta el contador de facturas dentro de una transacción activa
 * para garantizar la secuencia lineal exigida por el SENIAT.
 */
export async function getNextFiscalCounter(transaction: any, db: Firestore, userId: string) {
    const counterRef = doc(db, 'users', userId, 'metadata', 'fiscal_counters');
    const counterSnap = await transaction.get(counterRef);
    
    let nextInvoice = 1;
    if (counterSnap.exists()) {
        nextInvoice = (counterSnap.data().lastInvoice || 0) + 1;
    }
    
    // Formateo estándar SENIAT: 8 dígitos con ceros a la izquierda
    const invoiceStr = nextInvoice.toString().padStart(8, '0');
    
    // Nro de Control en formato 00-00000000
    const controlStr = `00-${invoiceStr}`;
    
    transaction.set(counterRef, { 
        lastInvoice: nextInvoice,
        updatedAt: new Date().toISOString() 
    }, { merge: true });
    
    return { invoiceNumber: invoiceStr, controlNumber: controlStr };
}

/**
 * Determina si un producto es exento (E) o gravado (G) según su configuración de IVA.
 */
export function getFiscalIndicator(product: any): 'E' | 'G' {
    return product.hasIVA ? 'G' : 'E';
}

/**
 * Referencia de consulta para el historial de transacciones fiscales:
 * 
 * const vatSalesQuery = query(
 *   collection(firestore, 'users', user.uid, 'sale_transactions'),
 *   where('isFiscal', '==', true),
 *   orderBy('fiscalMetadata.invoiceNumber', 'asc')
 * );
 */
