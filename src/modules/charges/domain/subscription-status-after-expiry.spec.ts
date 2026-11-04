import { subscriptionStatusAfterExpiry } from './subscription-status-after-expiry.js';

describe('subscriptionStatusAfterExpiry', () => {
  it.each([
    ['incomplete', 'canceled'],
    ['active', 'past_due'],
  ] as const)('moves %s to %s', (current, expected) => {
    expect(subscriptionStatusAfterExpiry(current)).toBe(expected);
  });

  it.each(['past_due', 'canceled'] as const)(
    'keeps %s unchanged',
    (current) => {
      expect(subscriptionStatusAfterExpiry(current)).toBeNull();
    },
  );
});
