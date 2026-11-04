import type {
  BillingPeriod,
  Subscription,
} from '../../subscriptions/subscription.js';
import { computePeriodEnd } from '../../subscriptions/domain/index.js';
import type {
  Charge,
  NewCharge,
  NewChargeIdentity,
  RenewalCandidate,
} from '../charge.js';
import { nextGatewayAttempt } from './gateway-attempt.js';

export function nextBillingPeriod(
  { billingAnchor, currentPeriodEnd }: RenewalCandidate['subscription'],
  interval: RenewalCandidate['plan']['interval'],
): BillingPeriod {
  let periodsElapsed = 1;
  let end = computePeriodEnd(billingAnchor, interval, periodsElapsed);
  while (end.getTime() <= currentPeriodEnd.getTime()) {
    periodsElapsed += 1;
    end = computePeriodEnd(billingAnchor, interval, periodsElapsed);
  }
  return { start: currentPeriodEnd, end };
}

export function newRenewalCharge(
  { subscription, plan }: RenewalCandidate,
  { id, correlationId }: NewChargeIdentity,
  startedAt: Date,
): NewCharge {
  const period = nextBillingPeriod(subscription, plan.interval);
  return {
    id,
    correlationId,
    subscriptionId: subscription.id,
    amountCents: plan.amountCents,
    method: subscription.paymentMethod,
    dueDate: period.start,
    periodStart: period.start,
    periodEnd: period.end,
    ...nextGatewayAttempt({ id, attemptCount: 0 }, startedAt),
  };
}

export function periodAdvanceAfterPaid(
  charge: Pick<Charge, 'periodStart' | 'periodEnd'>,
  subscription: Pick<Subscription, 'status' | 'currentPeriodEnd'>,
): BillingPeriod | null {
  const advances =
    charge.periodEnd.getTime() > subscription.currentPeriodEnd.getTime();
  if (!advances || subscription.status === 'canceled') return null;
  return { start: charge.periodStart, end: charge.periodEnd };
}
