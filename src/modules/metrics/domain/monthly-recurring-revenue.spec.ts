import { monthlyRecurringRevenueCents } from './monthly-recurring-revenue.js';

describe('monthlyRecurringRevenueCents', () => {
  it('is zero without active plans', () => {
    expect(monthlyRecurringRevenueCents([])).toBe(0);
  });

  it('multiplies monthly plans by their subscriber count', () => {
    expect(
      monthlyRecurringRevenueCents([
        { interval: 'monthly', amountCents: 1990, subscriptions: 3 },
        { interval: 'monthly', amountCents: 4990, subscriptions: 1 },
      ]),
    ).toBe(10_960);
  });

  it('divides yearly plans by twelve', () => {
    expect(
      monthlyRecurringRevenueCents([
        { interval: 'yearly', amountCents: 12_000, subscriptions: 2 },
      ]),
    ).toBe(2000);
  });

  it('rounds the yearly share once, not per plan', () => {
    expect(
      monthlyRecurringRevenueCents([
        { interval: 'yearly', amountCents: 10_000, subscriptions: 1 },
        { interval: 'yearly', amountCents: 10_000, subscriptions: 1 },
        { interval: 'monthly', amountCents: 1000, subscriptions: 1 },
      ]),
    ).toBe(2667);
  });
});
