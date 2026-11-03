import { subscriptionStatusAfterCharge } from './subscription-status-after-charge.js';

describe('subscriptionStatusAfterCharge', () => {
  it.each([
    ['incomplete', 'paid', 'active'],
    ['incomplete', 'failed', 'past_due'],
    ['past_due', 'paid', 'active'],
    ['active', 'failed', 'past_due'],
  ] as const)('moves %s to %s -> %s', (current, chargeStatus, expected) => {
    expect(subscriptionStatusAfterCharge(current, chargeStatus)).toBe(expected);
  });

  it.each([
    ['past_due', 'failed'],
    ['active', 'paid'],
  ] as const)(
    'keeps %s unchanged after a %s charge',
    (current, chargeStatus) => {
      expect(subscriptionStatusAfterCharge(current, chargeStatus)).toBeNull();
    },
  );
});
