import type { ChargeStatus } from '../../charges/charge-status.js';
import type { HistoryCharge } from './payment-history.js';
import {
  averageDaysLate,
  computePaymentMetrics,
  failedAttempts,
  monthsAsCustomer,
  paymentSuccessRate,
  totalPaidCents,
} from './payment-metrics.js';

const day = (isoDay: string) => new Date(`${isoDay}T00:00:00.000Z`);

function charge(overrides: Partial<HistoryCharge> = {}): HistoryCharge {
  return {
    status: 'paid',
    amountCents: 1990,
    dueDate: day('2026-01-10'),
    paidAt: day('2026-01-10'),
    ...overrides,
  };
}

function paidLate(daysLate: number): HistoryCharge {
  const dueDate = day('2026-01-10');
  return charge({
    dueDate,
    paidAt: new Date(dueDate.getTime() + daysLate * 86_400_000),
  });
}

describe('monthsAsCustomer', () => {
  it.each([
    ['2026-01-15', '2026-01-15', 0],
    ['2026-01-15', '2026-02-14', 0],
    ['2026-01-15', '2026-02-15', 1],
    ['2025-11-04', '2026-11-04', 12],
    ['2026-01-31', '2026-02-28', 0],
    ['2026-01-31', '2026-03-31', 2],
  ])('counts full months from %s to %s as %i', (since, now, expected) => {
    expect(monthsAsCustomer(day(since), day(now))).toBe(expected);
  });

  it('never goes negative when the customer starts after now', () => {
    expect(monthsAsCustomer(day('2026-05-01'), day('2026-01-01'))).toBe(0);
  });
});

describe('totalPaidCents', () => {
  it('is zero without charges', () => {
    expect(totalPaidCents([])).toBe(0);
  });

  it('sums only paid charges', () => {
    const statuses: ChargeStatus[] = [
      'paid',
      'failed',
      'pending',
      'expired',
      'uncollectible',
      'paid',
    ];

    expect(
      totalPaidCents(
        statuses.map((status) => charge({ status, amountCents: 1000 })),
      ),
    ).toBe(2000);
  });
});

describe('failedAttempts', () => {
  it('is zero without attempts', () => {
    expect(failedAttempts([])).toBe(0);
  });

  it('counts declined attempts and ignores succeeded ones', () => {
    expect(
      failedAttempts([
        { result: 'declined' },
        { result: 'succeeded' },
        { result: 'declined' },
      ]),
    ).toBe(2);
  });
});

describe('averageDaysLate', () => {
  it('is null when no charge was paid', () => {
    expect(
      averageDaysLate([charge({ status: 'failed', paidAt: null })]),
    ).toBeNull();
  });

  it('is null without charges', () => {
    expect(averageDaysLate([])).toBeNull();
  });

  it('is zero when everything is paid on the due date', () => {
    expect(averageDaysLate([charge(), charge()])).toBe(0);
  });

  it('counts an early payment as zero days late, not negative', () => {
    expect(averageDaysLate([paidLate(-5), paidLate(3)])).toBe(1.5);
  });

  it('averages days between due date and payment over paid charges only', () => {
    expect(
      averageDaysLate([
        paidLate(0),
        paidLate(2),
        paidLate(5),
        charge({ status: 'failed', paidAt: null }),
      ]),
    ).toBe(2.3);
  });

  it('keeps fractional days and rounds to one decimal', () => {
    const dueDate = day('2026-01-10');
    const paidAt = new Date(dueDate.getTime() + 1.26 * 86_400_000);

    expect(averageDaysLate([charge({ dueDate, paidAt })])).toBe(1.3);
  });

  it('ignores a paid charge without a payment date', () => {
    expect(averageDaysLate([paidLate(4), charge({ paidAt: null })])).toBe(4);
  });
});

describe('paymentSuccessRate', () => {
  it('is null without charges', () => {
    expect(paymentSuccessRate([])).toBeNull();
  });

  it('is null while every charge is still pending', () => {
    expect(paymentSuccessRate([charge({ status: 'pending' })])).toBeNull();
  });

  it('is paid charges over finalized charges, ignoring pending ones', () => {
    expect(
      paymentSuccessRate([
        charge({ status: 'paid' }),
        charge({ status: 'failed' }),
        charge({ status: 'expired' }),
        charge({ status: 'uncollectible' }),
        charge({ status: 'pending' }),
      ]),
    ).toBe(0.25);
  });

  it('is one when every finalized charge was paid', () => {
    expect(paymentSuccessRate([charge(), charge()])).toBe(1);
  });

  it('is zero when no finalized charge was paid', () => {
    expect(paymentSuccessRate([charge({ status: 'failed' })])).toBe(0);
  });

  it('rounds to two decimals', () => {
    expect(
      paymentSuccessRate([charge(), charge(), charge({ status: 'failed' })]),
    ).toBe(0.67);
  });
});

describe('computePaymentMetrics', () => {
  it('returns zeros and nulls for a customer without history', () => {
    expect(
      computePaymentMetrics(
        { customerSince: day('2026-11-01'), charges: [], attempts: [] },
        day('2026-11-04'),
      ),
    ).toEqual({
      monthsAsCustomer: 0,
      totalPaidCents: 0,
      failedAttempts: 0,
      averageDaysLate: null,
      paymentSuccessRate: null,
    });
  });

  it('combines every metric from the same history', () => {
    expect(
      computePaymentMetrics(
        {
          customerSince: day('2026-03-10'),
          charges: [paidLate(2), charge({ status: 'failed', paidAt: null })],
          attempts: [{ result: 'declined' }, { result: 'succeeded' }],
        },
        day('2026-11-04'),
      ),
    ).toEqual({
      monthsAsCustomer: 7,
      totalPaidCents: 1990,
      failedAttempts: 1,
      averageDaysLate: 2,
      paymentSuccessRate: 0.5,
    });
  });
});
