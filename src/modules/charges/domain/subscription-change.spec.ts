import { subscriptionChange } from './subscription-change.js';

describe('subscriptionChange', () => {
  const now = new Date('2026-11-04T10:00:00.000Z');

  it('stamps canceledAt and the cancel reason when canceling', () => {
    expect(
      subscriptionChange(
        { status: 'active' },
        'canceled',
        now,
        'payment_failed',
      ),
    ).toEqual({
      fromAnyOf: ['incomplete', 'active', 'past_due'],
      to: 'canceled',
      canceledAt: now,
      cancelReason: 'payment_failed',
    });
  });

  it('carries no cancellation data for other targets', () => {
    expect(subscriptionChange({ status: 'active' }, 'past_due', now)).toEqual({
      fromAnyOf: ['incomplete', 'active'],
      to: 'past_due',
    });
  });

  it('returns null without a target or for a forbidden transition', () => {
    expect(subscriptionChange({ status: 'active' }, null, now)).toBeNull();
    expect(
      subscriptionChange({ status: 'canceled' }, 'active', now),
    ).toBeNull();
  });
});
