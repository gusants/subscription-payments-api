import { delinquencyRate } from './delinquency-rate.js';

describe('delinquencyRate', () => {
  it('is null when there is nothing to measure', () => {
    expect(
      delinquencyRate({ active: 0, pastDue: 0, canceledForPaymentFailure: 0 }),
    ).toBeNull();
  });

  it('is zero when only active subscriptions exist', () => {
    expect(
      delinquencyRate({ active: 10, pastDue: 0, canceledForPaymentFailure: 0 }),
    ).toBe(0);
  });

  it('counts past_due and payment-failure cancellations over the whole base', () => {
    expect(
      delinquencyRate({ active: 6, pastDue: 2, canceledForPaymentFailure: 2 }),
    ).toBe(0.4);
  });

  it('is one when every subscription is delinquent', () => {
    expect(
      delinquencyRate({ active: 0, pastDue: 1, canceledForPaymentFailure: 1 }),
    ).toBe(1);
  });

  it('measures a base made only of cancellations', () => {
    expect(
      delinquencyRate({ active: 0, pastDue: 0, canceledForPaymentFailure: 3 }),
    ).toBe(1);
  });
});
