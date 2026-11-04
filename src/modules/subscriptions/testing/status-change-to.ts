import type { SubscriptionStatus } from '../subscription-status.js';
import type { StatusChange } from '../subscription.js';

export const statusChangeTo = (
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): StatusChange =>
  to === 'canceled'
    ? {
        fromAnyOf: [from],
        to,
        canceledAt: new Date(),
        cancelReason: 'customer_request',
      }
    : { fromAnyOf: [from], to };
