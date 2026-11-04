import { createHash } from 'node:crypto';
import type { GatewayFailureReason } from '../../../gateway/index.js';
import type { ChargeStatus } from '../../charges/charge-status.js';
import type { PlanInterval } from '../../plans/plan.js';
import type { PaymentMethod } from '../../subscriptions/subscription.js';
import type { PaymentMetrics } from './payment-metrics.js';

export interface ContextCharge {
  status: ChargeStatus;
  method: PaymentMethod;
  amountCents: number;
  dueDate: Date;
  paidAt: Date | null;
  failureReason: GatewayFailureReason | null;
}

export interface ContextPlan {
  interval: PlanInterval;
  amountCents: number;
}

export interface ContextSource {
  customerId: string;
  plan: ContextPlan | null;
  charges: readonly ContextCharge[];
  metrics: PaymentMetrics;
}

export interface TimelineEntry {
  dueDate: string;
  paidDate: string | null;
  status: ChargeStatus;
  method: PaymentMethod;
  amountCents: number;
  failureReason: GatewayFailureReason | null;
}

export interface AnonymizedContext {
  customerAlias: string;
  plan: ContextPlan | null;
  metrics: PaymentMetrics;
  paymentTimeline: TimelineEntry[];
}

const ALIAS_PREFIX = 'customer_';
const ALIAS_HASH_LENGTH = 8;
const ISO_DATE_LENGTH = 10;

export function customerAlias(customerId: string): string {
  const digest = createHash('sha256').update(customerId).digest('hex');
  return `${ALIAS_PREFIX}${digest.slice(0, ALIAS_HASH_LENGTH)}`;
}

export function buildAnonymizedContext(
  source: ContextSource,
): AnonymizedContext {
  return {
    customerAlias: customerAlias(source.customerId),
    plan: source.plan && {
      interval: source.plan.interval,
      amountCents: source.plan.amountCents,
    },
    metrics: { ...source.metrics },
    paymentTimeline: [...source.charges]
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .map(toTimelineEntry),
  };
}

function toTimelineEntry(charge: ContextCharge): TimelineEntry {
  return {
    dueDate: isoDate(charge.dueDate),
    paidDate: charge.paidAt && isoDate(charge.paidAt),
    status: charge.status,
    method: charge.method,
    amountCents: charge.amountCents,
    failureReason: charge.failureReason,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}
