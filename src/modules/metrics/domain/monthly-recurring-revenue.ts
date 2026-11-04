import type { ActivePlanGroup } from './metrics-overview.js';

const MONTHS_PER_YEAR = 12;

export function monthlyRecurringRevenueCents(
  plans: readonly ActivePlanGroup[],
): number {
  const revenueOf = (interval: ActivePlanGroup['interval']) =>
    plans
      .filter((plan) => plan.interval === interval)
      .reduce(
        (total, plan) => total + plan.amountCents * plan.subscriptions,
        0,
      );
  return (
    revenueOf('monthly') + Math.round(revenueOf('yearly') / MONTHS_PER_YEAR)
  );
}
