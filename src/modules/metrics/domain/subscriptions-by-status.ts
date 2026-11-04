import type { SubscriptionStatus } from '../../subscriptions/subscription-status.js';
import type { SubscriptionStatusCount } from './metrics-overview.js';

export function subscriptionsByStatus(
  counts: readonly SubscriptionStatusCount[],
): Record<SubscriptionStatus, number> {
  const totalOf = (status: SubscriptionStatus) =>
    counts
      .filter((row) => row.status === status)
      .reduce((total, row) => total + row.count, 0);
  return {
    incomplete: totalOf('incomplete'),
    active: totalOf('active'),
    past_due: totalOf('past_due'),
    canceled: totalOf('canceled'),
  };
}
