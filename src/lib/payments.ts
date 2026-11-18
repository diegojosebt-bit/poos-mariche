import type { Payment, PaymentMethod } from '@/lib/types';

/**
 * MOTOR DE COBRO COMPARTIDO
 *
 * Antes cada pantalla calculaba por su cuenta los totales del cobro
 * (POS, carrito y fiados), y por eso se arreglaba dos veces lo mismo.
 * Aquí vive una sola versión de la matemática: cuánto se pagó, cuánto
 * falta, cuánto vuelto toca y si se puede confirmar.
 */

export const USD_PAYMENT_METHODS: PaymentMethod[] = ['Efectivo USD', 'USDT / Crypto'];

export const isUsdMethod = (method: PaymentMethod) => USD_PAYMENT_METHODS.includes(method);

export type ConvertFn = (value: number, from: 'Bs' | 'USD', to: 'Bs' | 'USD', useParallel?: boolean) => number;

export interface PaymentTotalsParams {
  payments: Payment[];
  changePayments?: Payment[];
  /** Monto a cubrir en dólares. */
  total: number;
  /**
   * Cómo valorar los pagos en bolívares.
   * `true` = tasa de reposición; `false` = tasa BCV.
   */
  useParallelRate: boolean;
  convert: ConvertFn;
  /** Si se está registrando vuelto (solo se exige cubrirlo entonces). */
  isGivingChange?: boolean;
  currencyLoading?: boolean;
}

export interface PaymentTotals {
  paidUSD: number;
  changeGivenUSD: number;
  netPaidUSD: number;
  remainingUSD: number;
  potentialChangeUSD: number;
  requiredChangeUSD: number;
  changeDifference: number;
  isPaidInFull: boolean;
  progress: number;
  canConfirm: boolean;
}

/** Suma los pagos convirtiendo los bolívares a dólares con la tasa indicada. */
export function sumPaymentsInUSD(
  payments: Payment[] | undefined,
  convert: ConvertFn,
  useParallelRate: boolean,
): number {
  return (payments ?? []).reduce((acc, payment) => {
    const amount = Number(payment.amount) || 0;
    if (isUsdMethod(payment.method)) return acc + amount;
    return acc + convert(amount, 'Bs', 'USD', useParallelRate);
  }, 0);
}

export function computePaymentTotals({
  payments,
  changePayments,
  total,
  useParallelRate,
  convert,
  isGivingChange = false,
  currencyLoading = false,
}: PaymentTotalsParams): PaymentTotals {
  const paidUSD = currencyLoading ? 0 : sumPaymentsInUSD(payments, convert, useParallelRate);
  const changeGivenUSD = currencyLoading ? 0 : sumPaymentsInUSD(changePayments, convert, useParallelRate);

  const remainingUSD = Math.max(0, total - paidUSD);
  const potentialChangeUSD = paidUSD > total + 0.001 ? paidUSD - total : 0;
  const requiredChangeUSD = isGivingChange ? potentialChangeUSD : 0;

  return {
    paidUSD,
    changeGivenUSD,
    netPaidUSD: paidUSD - changeGivenUSD,
    remainingUSD,
    potentialChangeUSD,
    requiredChangeUSD,
    changeDifference: requiredChangeUSD - changeGivenUSD,
    isPaidInFull: paidUSD >= total - 0.01,
    progress: total > 0 ? Math.min(100, Math.round((paidUSD / total) * 100)) : 100,
    canConfirm: total > 0 && (payments?.length ?? 0) > 0 && paidUSD > 0,
  };
}
