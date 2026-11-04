import type { SubscriptionStatus } from '../../subscriptions/subscription-status.js';

const SUBSCRIPTION_STATUS_AFTER_EXPIRY: Partial<
  Record<SubscriptionStatus, SubscriptionStatus>
> = {
  incomplete: 'canceled',
  active: 'past_due',
};

export function subscriptionStatusAfterExpiry(
  current: SubscriptionStatus,
): SubscriptionStatus | null {
  return SUBSCRIPTION_STATUS_AFTER_EXPIRY[current] ?? null;
}
