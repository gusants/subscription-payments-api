import type { Charge, RenewalCandidate } from '../charge.js';
import {
  newRenewalCharge,
  nextBillingPeriod,
  periodAdvanceAfterPaid,
} from './renewal.js';

const at = (iso: string) => new Date(iso);

function candidate(
  overrides: Partial<RenewalCandidate['subscription']> = {},
  interval: RenewalCandidate['plan']['interval'] = 'monthly',
): RenewalCandidate {
  return {
    subscription: {
      id: 'sub_1',
      customerId: 'cus_1',
      planId: 'pln_1',
      paymentMethod: 'card',
      status: 'active',
      cardToken: 'tok_success',
      billingAnchor: at('2026-01-31T10:30:00.000Z'),
      currentPeriodStart: at('2026-01-31T10:30:00.000Z'),
      currentPeriodEnd: at('2026-02-28T10:30:00.000Z'),
      canceledAt: null,
      createdAt: at('2026-01-31T10:30:00.000Z'),
      updatedAt: at('2026-01-31T10:30:00.000Z'),
      ...overrides,
    },
    plan: { amountCents: 1990, interval },
  };
}

describe('nextBillingPeriod', () => {
  it('starts at the current period end and ends one interval after the anchor count', () => {
    const { subscription } = candidate();

    expect(nextBillingPeriod(subscription, 'monthly')).toEqual({
      start: at('2026-02-28T10:30:00.000Z'),
      end: at('2026-03-31T10:30:00.000Z'),
    });
  });

  it('keeps the anchor day after a short month', () => {
    const { subscription } = candidate({
      currentPeriodEnd: at('2026-03-31T10:30:00.000Z'),
    });

    expect(nextBillingPeriod(subscription, 'monthly').end).toEqual(
      at('2026-04-30T10:30:00.000Z'),
    );
  });

  it('advances yearly plans by twelve months', () => {
    const { subscription } = candidate({
      currentPeriodEnd: at('2027-01-31T10:30:00.000Z'),
    });

    expect(nextBillingPeriod(subscription, 'yearly')).toEqual({
      start: at('2027-01-31T10:30:00.000Z'),
      end: at('2028-01-31T10:30:00.000Z'),
    });
  });
});

describe('newRenewalCharge', () => {
  it('bills the plan amount for the next period with a fresh gateway attempt', () => {
    const startedAt = at('2026-03-01T00:00:00.000Z');

    expect(newRenewalCharge(candidate(), 'chg_9', startedAt)).toEqual({
      id: 'chg_9',
      subscriptionId: 'sub_1',
      amountCents: 1990,
      method: 'card',
      dueDate: at('2026-02-28T10:30:00.000Z'),
      periodStart: at('2026-02-28T10:30:00.000Z'),
      periodEnd: at('2026-03-31T10:30:00.000Z'),
      gatewayAttemptKey: 'chg_9:1',
      attemptStartedAt: startedAt,
    });
  });
});

describe('periodAdvanceAfterPaid', () => {
  const renewal: Pick<Charge, 'periodStart' | 'periodEnd'> = {
    periodStart: at('2026-02-28T10:30:00.000Z'),
    periodEnd: at('2026-03-31T10:30:00.000Z'),
  };

  it('moves the subscription to the paid period when it is newer', () => {
    expect(periodAdvanceAfterPaid(renewal, candidate().subscription)).toEqual({
      start: renewal.periodStart,
      end: renewal.periodEnd,
    });
  });

  it('keeps the period when the paid charge belongs to the current one', () => {
    const { subscription } = candidate({
      currentPeriodEnd: renewal.periodEnd,
    });

    expect(periodAdvanceAfterPaid(renewal, subscription)).toBeNull();
  });

  it('never advances a canceled subscription', () => {
    const { subscription } = candidate({ status: 'canceled' });

    expect(periodAdvanceAfterPaid(renewal, subscription)).toBeNull();
  });
});
