import type { ChargeStatus } from '../../charges/charge-status.js';
import type { HistoryCharge, PaymentHistory } from './payment-history.js';

export interface PaymentMetrics {
  monthsAsCustomer: number;
  totalPaidCents: number;
  failedAttempts: number;
  averageDaysLate: number | null;
  paymentSuccessRate: number | null;
}

const MILLISECONDS_PER_DAY = 86_400_000;
const FINALIZED_STATUSES: readonly ChargeStatus[] = [
  'paid',
  'failed',
  'expired',
  'uncollectible',
];

export function monthsAsCustomer(customerSince: Date, now: Date): number {
  const calendarMonths =
    (now.getUTCFullYear() - customerSince.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    customerSince.getUTCMonth();
  const anniversaryNotReached =
    now.getTime() < addUtcMonths(customerSince, calendarMonths).getTime();
  return Math.max(0, calendarMonths - (anniversaryNotReached ? 1 : 0));
}

function addUtcMonths(date: Date, months: number): Date {
  const shifted = new Date(date);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  return shifted;
}

export function totalPaidCents(charges: readonly HistoryCharge[]): number {
  return charges
    .filter((charge) => charge.status === 'paid')
    .reduce((total, charge) => total + charge.amountCents, 0);
}

export function failedAttempts(attempts: PaymentHistory['attempts']): number {
  return attempts.filter((attempt) => attempt.result === 'declined').length;
}

export function averageDaysLate(
  charges: readonly HistoryCharge[],
): number | null {
  const delays = charges.flatMap((charge) =>
    charge.status === 'paid' && charge.paidAt
      ? [daysLate(charge.dueDate, charge.paidAt)]
      : [],
  );
  return delays.length === 0 ? null : roundTo(mean(delays), 1);
}

export function paymentSuccessRate(
  charges: readonly HistoryCharge[],
): number | null {
  const finalized = charges.filter((charge) =>
    FINALIZED_STATUSES.includes(charge.status),
  );
  if (finalized.length === 0) {
    return null;
  }
  const paid = finalized.filter((charge) => charge.status === 'paid');
  return roundTo(paid.length / finalized.length, 2);
}

export function computePaymentMetrics(
  history: PaymentHistory,
  now: Date,
): PaymentMetrics {
  return {
    monthsAsCustomer: monthsAsCustomer(history.customerSince, now),
    totalPaidCents: totalPaidCents(history.charges),
    failedAttempts: failedAttempts(history.attempts),
    averageDaysLate: averageDaysLate(history.charges),
    paymentSuccessRate: paymentSuccessRate(history.charges),
  };
}

function daysLate(dueDate: Date, paidAt: Date): number {
  const elapsedDays =
    (paidAt.getTime() - dueDate.getTime()) / MILLISECONDS_PER_DAY;
  return Math.max(0, elapsedDays);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
