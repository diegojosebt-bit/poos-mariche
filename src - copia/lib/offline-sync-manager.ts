'use client';

import { 
  Firestore, 
  writeBatch, 
  doc, 
  increment, 
  serverTimestamp 
} from 'firebase/firestore';
import type { Sale } from '@/lib/types';
import { dailyRef, monthlyRef, saleStatsWrites } from '@/lib/firestore/rollups';

export interface StockDeduction {
  productId: string;
  stock: number;
  reserved: number;
  salesCount: number;
}

export interface OfflineSaleOperation {
  id: string; // saleId
  userId: string;
  type: 'SALE_CHECKOUT';
  createdAt: string;
  payload: {
    saleId: string;
    saleData: any;
    stockDeductions: StockDeduction[];
    repairUpdate?: {
      repairJobId: string;
      data: any;
    } | null;
    statsUpdate: {
      incomeUSD: number;
      profitUSD: number;
    };
  };
}

const QUEUE_PREFIX = 'pos_offline_ops_';
export const OFFLINE_QUEUE_EVENT = 'pos_offline_queue_changed';

/**
 * Obtiene la clave de almacenamiento exclusiva para el usuario activo.
 */
function getStorageKey(userId: string): string {
  return `${QUEUE_PREFIX}${userId}`;
}

/**
 * Dispara un evento del navegador para que los componentes UI (pills, indicadores)
 * se actualicen de inmediato sin lecturas ni llamadas a Firebase.
 */
function notifyQueueChanged(userId: string, count: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(OFFLINE_QUEUE_EVENT, { 
      detail: { userId, count } 
    })
  );
}

/**
 * Recupera todas las operaciones en cola para un usuario determinado.
 */
export function getOfflineQueue(userId: string): OfflineSaleOperation[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[OfflineQueue] Error leyendo la cola local:', err);
    return [];
  }
}

/**
 * Encola una nueva operación de venta para sincronización diferida.
 */
export function enqueueOfflineOperation(
  userId: string,
  data: Omit<OfflineSaleOperation, 'userId' | 'createdAt'>
): OfflineSaleOperation {
  if (typeof window === 'undefined' || !userId) {
    throw new Error('Almacenamiento no disponible o usuario no especificado.');
  }

  const existing = getOfflineQueue(userId);
  const exists = existing.some(item => item.id === data.id);
  
  const newOp: OfflineSaleOperation = {
    ...data,
    userId,
    createdAt: new Date().toISOString(),
  };

  const updated = exists 
    ? existing.map(item => item.id === data.id ? newOp : item)
    : [newOp, ...existing];

  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(updated));
    notifyQueueChanged(userId, updated.length);
  } catch (err) {
    console.error('[OfflineQueue] Error guardando operación offline:', err);
  }

  return newOp;
}

/**
 * Elimina una operación específica por su ID una vez confirmada su sincronización.
 */
export function removeOfflineOperation(userId: string, opId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  const existing = getOfflineQueue(userId);
  const updated = existing.filter(item => item.id !== opId);
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(updated));
    notifyQueueChanged(userId, updated.length);
  } catch (err) {
    console.error('[OfflineQueue] Error removiendo de cola local:', err);
  }
}

/**
 * Limpia toda la cola del usuario.
 */
export function clearOfflineQueue(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.removeItem(getStorageKey(userId));
    notifyQueueChanged(userId, 0);
  } catch (err) {
    console.error('[OfflineQueue] Error limpiando cola local:', err);
  }
}

/**
 * SINCRONIZADOR POR LOTES (Batch Sync):
 * Despacha las operaciones pendientes directamente con writeBatch().
 * GARANTÍA DE COSTO: Cero (0) lecturas en Firebase.
 */
let isSyncInProgress = false;

export async function syncOfflineQueue(
  firestore: Firestore, 
  userId: string
): Promise<{ syncedCount: number; errors: any[] }> {
  if (typeof window === 'undefined' || !firestore || !userId) {
    return { syncedCount: 0, errors: [] };
  }

  if (isSyncInProgress) {
    return { syncedCount: 0, errors: [] };
  }

  const queue = getOfflineQueue(userId);
  if (queue.length === 0) {
    return { syncedCount: 0, errors: [] };
  }

  isSyncInProgress = true;
  let syncedCount = 0;
  const errors: any[] = [];

  try {
    // Procesamos en lotes de hasta 20 operaciones por lote para garantizar no superar el límite de 500 ops de Firestore
    const batchSize = 20;
    for (let i = 0; i < queue.length; i += batchSize) {
      const chunk = queue.slice(i, i + batchSize);
      const batch = writeBatch(firestore);

      for (const op of chunk) {
        if (op.type === 'SALE_CHECKOUT') {
          const { saleId, saleData, stockDeductions, repairUpdate, statsUpdate } = op.payload;

          // 1. Guardar documento de venta
          const saleRef = doc(firestore, 'users', userId, 'sale_transactions', saleId);
          batch.set(saleRef, saleData);

          // 2. Aplicar deducción atómica de inventario (0 lecturas)
          for (const ded of stockDeductions) {
            const productRef = doc(firestore, 'users', userId, 'products', ded.productId);
            batch.update(productRef, {
              stockLevel: increment(-ded.stock),
              reservedStock: increment(-ded.reserved),
              salesCount: increment(ded.salesCount),
              updatedAt: serverTimestamp()
            });
          }

          // 3. Acumular estadísticas 30d (0 lecturas)
          if (statsUpdate) {
            const statsRef = doc(firestore, 'users', userId, 'system', 'estadisticas_actuales');
            batch.set(statsRef, {
              totalRealSales30d: increment(statsUpdate.incomeUSD || 0),
              totalRealProfit30d: increment(statsUpdate.profitUSD || 0),
              updatedAt: serverTimestamp()
            }, { merge: true });
          }

          // 3b. Fase 1: agregados diarios/mensuales de la venta offline.
          try {
            const stats = saleStatsWrites(saleData as Sale);
            batch.set(dailyRef(firestore, userId, stats.day), stats.daily, { merge: true });
            batch.set(monthlyRef(firestore, userId, stats.day.slice(0, 7)), stats.monthly, { merge: true });
          } catch (statsError) {
            console.warn('[offline-sync] No se pudieron preparar los agregados:', statsError);
          }

          // 4. Actualizar estado de reparación si aplica
          if (repairUpdate?.repairJobId && repairUpdate?.data) {
            const jobRef = doc(firestore, 'users', userId, 'repair_jobs', repairUpdate.repairJobId);
            batch.update(jobRef, repairUpdate.data);
          }
        }
      }

      // Ejecutar lote atómico
      await batch.commit();

      // Al confirmar el lote en Firestore, removemos cada una de la cola local
      for (const op of chunk) {
        removeOfflineOperation(userId, op.id);
        syncedCount++;
      }
    }
  } catch (err) {
    console.error('[OfflineQueue] Error durante la sincronización a Firebase:', err);
    errors.push(err);
  } finally {
    isSyncInProgress = false;
  }

  return { syncedCount, errors };
}
