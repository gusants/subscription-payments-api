import type { GatewayFailureReason } from '../../gateway/index.js';
import type {
  ChargeStatus,
  PaymentAttemptResult,
} from '../charges/charge-status.js';
import type { PlanInterval } from '../plans/plan.js';
import type { PaymentMethod } from '../subscriptions/subscription.js';
import type { CustomerPaymentRecord } from './customer-payment-record.js';
import type { ContextCharge } from './domain/index.js';

export interface PaymentAttemptRow {
  result: PaymentAttemptResult;
  failureReason: GatewayFailureReason | null;
  createdAt: Date;
}

export interface ChargeRow {
  status: ChargeStatus;
  method: PaymentMethod;
  amountCents: number;
  dueDate: Date;
  paidAt: Date | null;
  updatedAt: Date;
  attempts: PaymentAttemptRow[];
}

export interface SubscriptionRow {
  createdAt: Date;
  updatedAt: Date;
  plan: { interval: PlanInterval; amountCents: number };
  charges: ChargeRow[];
}

export interface CustomerPaymentRows {
  id: string;
  createdAt: Date;
  subscriptions: SubscriptionRow[];
}

export function toCustomerPaymentRecord(
  customer: CustomerPaymentRows,
): CustomerPaymentRecord {
  const charges = customer.subscriptions.flatMap(
    (subscription) => subscription.charges,
  );
  const attempts = charges.flatMap((charge) => charge.attempts);
  return {
    customerId: customer.id,
    customerSince: customer.createdAt,
    plan: currentPlan(customer.subscriptions),
    charges: charges.map(toContextCharge),
    attempts: attempts.map(({ result }) => ({ result })),
    activity: {
      lastActivityAt: latest([
        ...customer.subscriptions.flatMap(({ createdAt, updatedAt }) => [
          createdAt,
          updatedAt,
        ]),
        ...charges.map(({ updatedAt }) => updatedAt),
        ...attempts.map(({ createdAt }) => createdAt),
      ]),
      chargeCount: charges.length,
      attemptCount: attempts.length,
    },
  };
}

function currentPlan(
  subscriptions: SubscriptionRow[],
): CustomerPaymentRecord['plan'] {
  const newest = subscriptions.reduce<SubscriptionRow | null>(
    (best, candidate) =>
      best === null || candidate.createdAt > best.createdAt ? candidate : best,
    null,
  );
  return (
    newest && {
      interval: newest.plan.interval,
      amountCents: newest.plan.amountCents,
    }
  );
}

function toContextCharge(charge: ChargeRow): ContextCharge {
  return {
    status: charge.status,
    method: charge.method,
    amountCents: charge.amountCents,
    dueDate: charge.dueDate,
    paidAt: charge.paidAt,
    failureReason: lastFailureReason(charge.attempts),
  };
}

function lastFailureReason(
  attempts: PaymentAttemptRow[],
): GatewayFailureReason | null {
  const failed = attempts
    .filter(({ failureReason }) => failureReason !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return failed[0]?.failureReason ?? null;
}

function latest(instants: Date[]): Date | null {
  return instants.reduce<Date | null>(
    (best, instant) => (best === null || instant > best ? instant : best),
    null,
  );
}
