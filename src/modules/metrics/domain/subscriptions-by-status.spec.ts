import { subscriptionsByStatus } from './subscriptions-by-status.js';

describe('subscriptionsByStatus', () => {
  it('reports every status, zero when absent', () => {
    expect(subscriptionsByStatus([])).toEqual({
      incomplete: 0,
      active: 0,
      past_due: 0,
      canceled: 0,
    });
  });

  it('sums the counts of each status', () => {
    expect(
      subscriptionsByStatus([
        { status: 'active', count: 4 },
        { status: 'canceled', count: 1 },
        { status: 'active', count: 2 },
      ]),
    ).toEqual({ incomplete: 0, active: 6, past_due: 0, canceled: 1 });
  });
});
