import { UnprocessableError } from '../../../shared/errors/index.js';
import { assertTransition } from '../../subscriptions/domain/index.js';
import type { Subscription } from '../../subscriptions/subscription.js';
import type { ChargeOutcome } from './charge-outcome.js';
import { subscriptionStatusAfterCharge } from './subscription-status-after-charge.js';

const POSSIBLE_OUTCOMES: readonly ChargeOutcome['chargeStatus'][] = [
  'paid',
  'failed',
];

export type BillableSubscription = Subscription &
  (
    | { paymentMethod: 'card'; cardToken: string }
    | { paymentMethod: Exclude<Subscription['paymentMethod'], 'card'> }
  );

export function assertHasPaymentCredentials(
  subscription: Subscription,
): asserts subscription is BillableSubscription {
  const { id, paymentMethod, cardToken } = subscription;
  if (paymentMethod === 'card' && !cardToken) {
    throw new UnprocessableError(`Subscription ${id} has no card token`);
  }
}

export function assertBillable(
  subscription: Subscription,
): asserts subscription is BillableSubscription {
  assertHasPaymentCredentials(subscription);
  const { status } = subscription;
  for (const outcome of POSSIBLE_OUTCOMES) {
    const target = subscriptionStatusAfterCharge(status, outcome);
    if (target) assertTransition(status, target);
  }
}
