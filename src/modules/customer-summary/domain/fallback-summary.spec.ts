import {
  assessRisk,
  buildFallbackSummary,
  classifyPaymentBehavior,
} from './fallback-summary.js';
import type { PaymentMetrics } from './payment-metrics.js';
import { summaryOutputSchema } from './summary-output.js';

function metrics(overrides: Partial<PaymentMetrics> = {}): PaymentMetrics {
  return {
    monthsAsCustomer: 8,
    totalPaidCents: 39920,
    failedAttempts: 0,
    averageDaysLate: 0,
    paymentSuccessRate: 1,
    ...overrides,
  };
}

describe('classifyPaymentBehavior', () => {
  it.each([
    [
      'no settled charge',
      metrics({ paymentSuccessRate: null }),
      'insufficient_history',
    ],
    ['everything paid on time', metrics(), 'on_time'],
    ['paid with one day of delay', metrics({ averageDaysLate: 1 }), 'on_time'],
    [
      'paid but delayed more than a day',
      metrics({ averageDaysLate: 2.4 }),
      'occasional_delays',
    ],
    [
      'a declined attempt that recovered',
      metrics({ failedAttempts: 1 }),
      'occasional_delays',
    ],
    [
      'a charge that was never paid',
      metrics({ paymentSuccessRate: 0.85 }),
      'occasional_delays',
    ],
    [
      'success rate at 0.8',
      metrics({ paymentSuccessRate: 0.8 }),
      'occasional_delays',
    ],
    [
      'success rate below 0.8',
      metrics({ paymentSuccessRate: 0.79 }),
      'frequent_delays',
    ],
    [
      'average delay above five days',
      metrics({ averageDaysLate: 5.1 }),
      'frequent_delays',
    ],
    [
      'average delay of exactly five days',
      metrics({ averageDaysLate: 5 }),
      'occasional_delays',
    ],
    [
      'success rate below 0.5',
      metrics({ paymentSuccessRate: 0.49 }),
      'unreliable',
    ],
    [
      'success rate at 0.5',
      metrics({ paymentSuccessRate: 0.5 }),
      'frequent_delays',
    ],
    [
      'no average delay with a perfect rate',
      metrics({ averageDaysLate: null }),
      'on_time',
    ],
  ])('%s', (_case, input, expected) => {
    expect(classifyPaymentBehavior(input)).toBe(expected);
  });
});

describe('assessRisk', () => {
  it.each([
    ['on_time', 'low'],
    ['occasional_delays', 'medium'],
    ['frequent_delays', 'high'],
    ['unreliable', 'high'],
  ] as const)('%s is %s', (behavior, risk) => {
    expect(assessRisk(behavior, metrics())).toBe(risk);
  });

  it('keeps insufficient history low without declined attempts', () => {
    expect(assessRisk('insufficient_history', metrics())).toBe('low');
  });

  it('raises insufficient history to medium when attempts were declined', () => {
    expect(
      assessRisk('insufficient_history', metrics({ failedAttempts: 1 })),
    ).toBe('medium');
  });
});

describe('buildFallbackSummary', () => {
  it('describes a customer without history', () => {
    const output = buildFallbackSummary(
      metrics({
        monthsAsCustomer: 0,
        totalPaidCents: 0,
        averageDaysLate: null,
        paymentSuccessRate: null,
      }),
      'card',
    );

    expect(output).toEqual({
      summary:
        'Customer for 0 months, with 0.00 paid in total. There is no settled charge yet, so the payment history is too short to assess. 0 failed payment attempts on record.',
      paymentBehavior: 'insufficient_history',
      riskLevel: 'low',
      suggestedAction:
        'Wait for more payment history before taking any action.',
    });
  });

  it('builds the text from the metrics', () => {
    const output = buildFallbackSummary(
      metrics({
        monthsAsCustomer: 1,
        totalPaidCents: 39920,
        failedAttempts: 1,
        averageDaysLate: 2.4,
        paymentSuccessRate: 0.85,
      }),
      'card',
    );

    expect(output.summary).toBe(
      'Customer for 1 month, with 399.20 paid in total. 85% of settled charges were paid, on average 2.4 days after the due date. 1 failed payment attempt on record.',
    );
    expect(output).toMatchObject({
      paymentBehavior: 'occasional_delays',
      riskLevel: 'medium',
    });
  });

  it('omits the delay when no paid charge has one', () => {
    const output = buildFallbackSummary(
      metrics({ averageDaysLate: null, paymentSuccessRate: 0 }),
      'card',
    );

    expect(output.summary).toContain('0% of settled charges were paid.');
    expect(output.paymentBehavior).toBe('unreliable');
  });

  const frequentDelays = metrics({
    paymentSuccessRate: 0.7,
    averageDaysLate: 1,
  });

  it('offers Pix to a card customer with frequent delays', () => {
    expect(
      buildFallbackSummary(frequentDelays, 'card').suggestedAction,
    ).toContain('Pix');
  });

  it('does not offer Pix to a customer who already pays with it', () => {
    const { suggestedAction } = buildFallbackSummary(frequentDelays, 'pix');

    expect(suggestedAction).toContain('Pix payments are late');
    expect(suggestedAction).not.toContain('offer');
  });

  it.each([
    metrics(),
    metrics({ paymentSuccessRate: null, averageDaysLate: null }),
    metrics({ paymentSuccessRate: 0.3, failedAttempts: 40 }),
    metrics({ averageDaysLate: 90, totalPaidCents: 2_000_000_000 }),
  ])('always satisfies the output schema (%#)', (input) => {
    expect(
      summaryOutputSchema.safeParse(buildFallbackSummary(input, 'card'))
        .success,
    ).toBe(true);
  });
});
