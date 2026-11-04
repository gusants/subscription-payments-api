import {
  canTransition as canSubscriptionTransition,
  statusesAllowedToTransitionTo as subscriptionStatusesAllowedToTransitionTo,
} from '../../subscriptions/domain/index.js';
import type { CancelReason } from '../../subscriptions/cancel-reason.js';
import type {
  StatusChange,
  Subscription,
} from '../../subscriptions/subscription.js';

export function subscriptionChange(
  subscription: Pick<Subscription, 'status'>,
  to: Subscription['status'] | null,
  now: Date,
  cancelReason?: CancelReason,
): StatusChange | null {
  if (!to || !canSubscriptionTransition(subscription.status, to)) return null;
  return {
    fromAnyOf: subscriptionStatusesAllowedToTransitionTo(to),
    to,
    ...(to === 'canceled' && { canceledAt: now, cancelReason }),
  };
}
