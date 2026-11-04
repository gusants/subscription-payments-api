import { toMetricsOverviewResponse } from './metrics-presenter.js';

describe('toMetricsOverviewResponse', () => {
  it('serializes the period as ISO strings and keeps a null rate', () => {
    const response = toMetricsOverviewResponse({
      period: {
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: new Date('2026-11-30T23:59:59.999Z'),
      },
      monthlyRecurringRevenueCents: 0,
      activeSubscriptions: 0,
      pastDueSubscriptions: 0,
      delinquencyRate: null,
      revenueByMonth: [{ month: '2026-11', revenueCents: 0 }],
      subscriptionsByStatus: {
        incomplete: 0,
        active: 0,
        past_due: 0,
        canceled: 0,
      },
    });

    expect(response).toMatchObject({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.999Z',
      delinquencyRate: null,
    });
  });
});
