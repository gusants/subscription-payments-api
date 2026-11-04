import { computeOverview } from './compute-overview.js';
import type { MetricsSnapshot } from './metrics-overview.js';

describe('computeOverview', () => {
  const period = {
    from: new Date('2026-11-01T00:00:00.000Z'),
    to: new Date('2026-11-30T23:59:59.999Z'),
  };

  it('combines the snapshot into the overview figures', () => {
    const snapshot: MetricsSnapshot = {
      statusCounts: [
        { status: 'active', count: 6 },
        { status: 'past_due', count: 2 },
        { status: 'canceled', count: 5 },
      ],
      activePlans: [
        { interval: 'monthly', amountCents: 1000, subscriptions: 4 },
        { interval: 'yearly', amountCents: 12_000, subscriptions: 2 },
      ],
      paymentFailedCancellations: 2,
      paidRevenueByMonth: [{ month: '2026-11', revenueCents: 7000 }],
    };

    expect(computeOverview(snapshot, period)).toEqual({
      period,
      monthlyRecurringRevenueCents: 6000,
      activeSubscriptions: 6,
      pastDueSubscriptions: 2,
      delinquencyRate: 0.4,
      revenueByMonth: [{ month: '2026-11', revenueCents: 7000 }],
      subscriptionsByStatus: {
        incomplete: 0,
        active: 6,
        past_due: 2,
        canceled: 5,
      },
    });
  });

  it('reports a null delinquency rate for an empty base', () => {
    const overview = computeOverview(
      {
        statusCounts: [],
        activePlans: [],
        paymentFailedCancellations: 0,
        paidRevenueByMonth: [],
      },
      period,
    );

    expect(overview.delinquencyRate).toBeNull();
    expect(overview.monthlyRecurringRevenueCents).toBe(0);
  });
});
