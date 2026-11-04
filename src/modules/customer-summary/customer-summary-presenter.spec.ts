import { toCustomerSummaryResponse } from './customer-summary-presenter.js';
import { customerSummaryResponseSchema } from './dto/customer-summary-response.dto.js';

describe('toCustomerSummaryResponse', () => {
  const summary = {
    customerId: 'cus_1',
    metrics: {
      monthsAsCustomer: 8,
      totalPaidCents: 39920,
      failedAttempts: 3,
      averageDaysLate: null,
      paymentSuccessRate: 0.85,
    },
    record: {
      source: 'llm' as const,
      promptVersion: 'v1',
      generatedAt: new Date('2026-06-01T10:00:00.000Z'),
      output: {
        summary: 'Pays on time.',
        paymentBehavior: 'on_time' as const,
        riskLevel: 'low' as const,
        suggestedAction: 'No action needed.',
      },
    },
  };

  it('flattens the record and serializes the generation instant', () => {
    expect(toCustomerSummaryResponse(summary)).toEqual({
      customerId: 'cus_1',
      source: 'llm',
      promptVersion: 'v1',
      generatedAt: '2026-06-01T10:00:00.000Z',
      metrics: summary.metrics,
      summary: 'Pays on time.',
      paymentBehavior: 'on_time',
      riskLevel: 'low',
      suggestedAction: 'No action needed.',
    });
  });

  it('produces a body that satisfies the response schema', () => {
    expect(
      customerSummaryResponseSchema.safeParse(
        toCustomerSummaryResponse(summary),
      ).success,
    ).toBe(true);
  });
});
