import type { SubscriptionStatus } from '../../subscriptions/subscription-status.js';
import type { PlanInterval } from '../../plans/plan.js';
import type { Period } from './period.js';

export interface ActivePlanGroup {
  interval: PlanInterval;
  amountCents: number;
  subscriptions: number;
}

export interface SubscriptionStatusCount {
  status: SubscriptionStatus;
  count: number;
}

export interface MonthlyRevenue {
  month: string;
  revenueCents: number;
}

export interface MetricsSnapshot {
  statusCounts: readonly SubscriptionStatusCount[];
  activePlans: readonly ActivePlanGroup[];
  paymentFailedCancellations: number;
  paidRevenueByMonth: readonly MonthlyRevenue[];
}

export interface MetricsOverview {
  period: Period;
  monthlyRecurringRevenueCents: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  delinquencyRate: number | null;
  revenueByMonth: MonthlyRevenue[];
  subscriptionsByStatus: Record<SubscriptionStatus, number>;
}
