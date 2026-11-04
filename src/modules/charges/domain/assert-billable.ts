import { UnprocessableError } from '../../../shared/errors/index.js';
import { assertTransition } from '../../subscriptions/domain/index.js';
import type { Subscription } from '../../subscriptions/subscription.js';
import type { ChargeOutcome } from './charge-outcome.js';
import { subscriptionStatusAfterCharge } from './subscription-status-after-charge.js';

const POSSIBLE_OUTCOMES: readonly ChargeOutcome['chargeStatus'][] = [
  'paid',
  'failed',
];

export type BillableSubscription = Subscription & { cardToken: string };

export function assertBillable(
  subscription: Subscription,
): asserts subscription is BillableSubscription {
  const { id, status, cardToken } = subscription;
  if (!cardToken) {
    throw new UnprocessableError(`Subscription ${id} has no card token`);
  }
  for (const outcome of POSSIBLE_OUTCOMES) {
    const target = subscriptionStatusAfterCharge(status, outcome);
    if (target) assertTransition(status, target);
  }
}
