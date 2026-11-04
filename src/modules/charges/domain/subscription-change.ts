import {
  canTransition as canSubscriptionTransition,
  statusesAllowedToTransitionTo as subscriptionStatusesAllowedToTransitionTo,
} from '../../subscriptions/domain/index.js';
import type { CancelReason } from '../../subscriptions/cancel-reason.js';
import type { SubscriptionStatus } from '../../subscriptions/subscription-status.js';
import type {
  StatusChange,
  Subscription,
} from '../../subscriptions/subscription.js';

type CancelReasonFor<To extends SubscriptionStatus> = To extends 'canceled'
  ? [cancelReason: CancelReason]
  : [];

export function subscriptionChange<To extends SubscriptionStatus>(
  subscription: Pick<Subscription, 'status'>,
  to: To | null,
  now: Date,
  ...[cancelReason]: CancelReasonFor<To>
): StatusChange | null {
  if (!to || !canSubscriptionTransition(subscription.status, to)) return null;
  const fromAnyOf = subscriptionStatusesAllowedToTransitionTo(to);
  if (to === 'canceled') {
    if (!cancelReason) throw new TypeError('A cancellation needs a reason');
    return { fromAnyOf, to, canceledAt: now, cancelReason };
  }
  return { fromAnyOf, to };
}
