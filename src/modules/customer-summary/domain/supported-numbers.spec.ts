import {
  buildAnonymizedContext,
  type AnonymizedContext,
  type ContextCharge,
} from './anonymized-context.js';
import { findUnsupportedNumbers } from './supported-numbers.js';

const metrics = {
  monthsAsCustomer: 14,
  totalPaidCents: 39920,
  failedAttempts: 3,
  averageDaysLate: 2.4,
  paymentSuccessRate: 0.67,
};

function charge(overrides: Partial<ContextCharge> = {}): ContextCharge {
  return {
    subscriptionId: 'sub_1',
    periodStart: new Date('2026-03-10T00:00:00.000Z'),
    status: 'paid',
    method: 'pix',
    amountCents: 1990,
    dueDate: new Date('2026-03-10T00:00:00.000Z'),
    paidAt: new Date('2026-03-12T00:00:00.000Z'),
    failureReason: null,
    ...overrides,
  };
}

const context: AnonymizedContext = buildAnonymizedContext({
  customerId: 'cus_1',
  plan: { interval: 'monthly', amountCents: 1990 },
  charges: [
    charge({ status: 'expired', paidAt: null }),
    charge(),
    charge({ periodStart: new Date('2026-04-10T00:00:00.000Z') }),
  ],
  metrics,
});

const narrate = (summary: string, suggestedAction = 'No action needed.') =>
  findUnsupportedNumbers({ summary, suggestedAction }, context);

describe('findUnsupportedNumbers', () => {
  it('accepts text without numbers', () => {
    expect(narrate('The customer pays reliably.')).toEqual([]);
  });

  it.each([
    ['months from the metrics', 'Customer for 14 months.'],
    ['years and leftover months', 'About 1 year and 2 months as a customer.'],
    ['failed attempts', '3 failed attempts on record.'],
    ['cents', 'Paid 39920 cents in total.'],
    ['currency with decimals', 'Paid 399.20 in total.'],
    ['currency with a comma decimal', 'Paid R$ 399,20 in total.'],
    ['currency without decimals', 'Paid about 399 in total.'],
    ['rounded currency', 'Paid roughly 400 in total.'],
    ['currency with thousands separator', 'Paid 39,920 cents.'],
    ['plan price', 'Plan costs 19.90 per month.'],
    ['success rate as percentage', '67% of periods were paid.'],
    ['success rate as ratio', 'Success rate of 0.67.'],
    ['average delay', 'Pays 2.4 days late on average.'],
    ['rounded delay', 'Pays about 2 days late.'],
    ['period count', 'Across 2 billing periods.'],
    ['charge count', 'It took 3 charges.'],
    ['expired count', '1 Pix charge expired.'],
    ['ISO date', 'Last paid on 2026-03-12.'],
    ['year', 'Active since 2026.'],
    ['days late of a single charge', 'Paid 2 days after the due date.'],
    ['suggested action', 'Remind the customer before day 10.'],
  ])('accepts %s', (_name, summary) => {
    expect(narrate(summary)).toEqual([]);
  });

  it.each([
    ['invented cents', 'Paid 999999 cents.', '999999'],
    ['invented count', '42 failures on record.', '42'],
    ['invented percentage', '77% were paid.', '77'],
    ['invented decimal', 'Pays 7.5 days late.', '7.5'],
    ['invented amount', 'Owes 1.234,56.', '1.234,56'],
  ])('rejects %s', (_name, summary, token) => {
    expect(narrate(summary)).toEqual([token]);
  });

  it('checks the suggested action as well', () => {
    expect(narrate('Pays on time.', 'Call within 48 hours.')).toEqual(['48']);
  });

  it('reports every unsupported number', () => {
    expect(narrate('Paid 999999 cents with 42 failures.')).toEqual([
      '999999',
      '42',
    ]);
  });

  it('supports nothing but the metrics for a customer without history', () => {
    const empty = buildAnonymizedContext({
      customerId: 'cus_1',
      plan: null,
      charges: [],
      metrics: {
        monthsAsCustomer: 0,
        totalPaidCents: 0,
        failedAttempts: 0,
        averageDaysLate: null,
        paymentSuccessRate: null,
      },
    });

    expect(
      findUnsupportedNumbers(
        {
          summary: '0 months and 0 failures, 5 payments.',
          suggestedAction: 'Wait.',
        },
        empty,
      ),
    ).toEqual(['5']);
  });
});
