import { delinquencyRate } from './delinquency-rate.js';
import type { MetricsOverview, MetricsSnapshot } from './metrics-overview.js';
import { monthlyRecurringRevenueCents } from './monthly-recurring-revenue.js';
import type { Period } from './period.js';
import { revenueByMonth } from './revenue-by-month.js';
import { subscriptionsByStatus } from './subscriptions-by-status.js';

export function computeOverview(
  snapshot: MetricsSnapshot,
  period: Period,
): MetricsOverview {
  const byStatus = subscriptionsByStatus(snapshot.statusCounts);
  return {
    period,
    monthlyRecurringRevenueCents: monthlyRecurringRevenueCents(
      snapshot.activePlans,
    ),
    activeSubscriptions: byStatus.active,
    pastDueSubscriptions: byStatus.past_due,
    delinquencyRate: delinquencyRate({
      active: byStatus.active,
      pastDue: byStatus.past_due,
      canceledForPaymentFailure: snapshot.paymentFailedCancellations,
    }),
    revenueByMonth: revenueByMonth(period, snapshot.paidRevenueByMonth),
    subscriptionsByStatus: byStatus,
  };
}
