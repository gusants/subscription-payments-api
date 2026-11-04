import {
  toChargeHistoryItemResponse,
  toChargeSummaryResponse,
} from './charge-presenter.js';

describe('toChargeSummaryResponse', () => {
  it('exposes the failure reason of a declined charge', () => {
    expect(
      toChargeSummaryResponse({
        id: 'ch_1',
        status: 'failed',
        amountCents: 1990,
        failureReason: 'insufficient_funds',
        expiresAt: null,
        paymentInstructions: null,
      }),
    ).toEqual({
      id: 'ch_1',
      status: 'failed',
      amountCents: 1990,
      failureReason: 'insufficient_funds',
    });
  });

  it('omits the failure reason when there is none', () => {
    expect(
      toChargeSummaryResponse({
        id: 'ch_1',
        status: 'paid',
        amountCents: 1990,
        failureReason: null,
        expiresAt: null,
        paymentInstructions: null,
      }),
    ).toEqual({ id: 'ch_1', status: 'paid', amountCents: 1990 });
  });

  it('exposes the expiry and the payment instructions of a pending pix', () => {
    expect(
      toChargeSummaryResponse({
        id: 'ch_1',
        status: 'pending',
        amountCents: 1990,
        failureReason: null,
        expiresAt: new Date('2026-01-31T11:00:00.000Z'),
        paymentInstructions: { type: 'pix', copyPaste: '000201' },
      }),
    ).toEqual({
      id: 'ch_1',
      status: 'pending',
      amountCents: 1990,
      expiresAt: '2026-01-31T11:00:00.000Z',
      paymentInstructions: { type: 'pix', copyPaste: '000201' },
    });
  });
});

describe('toChargeHistoryItemResponse', () => {
  const at = new Date('2026-01-31T10:30:00.000Z');

  it('serializes dates, nests attempts and hides gateway identifiers', () => {
    const response = toChargeHistoryItemResponse({
      id: 'ch_1',
      subscriptionId: 'sub_1',
      amountCents: 1990,
      method: 'card',
      status: 'failed',
      gatewayChargeId: 'gch_1',
      gatewayAttemptKey: 'ch_1:1',
      attemptStartedAt: at,
      attemptCount: 1,
      nextRetryAt: null,
      dueDate: at,
      periodStart: at,
      periodEnd: at,
      paidAt: null,
      expiresAt: null,
      paymentInstructions: null,
      createdAt: at,
      updatedAt: at,
      attempts: [
        {
          id: 'pa_1',
          chargeId: 'ch_1',
          gatewayChargeId: 'gch_1',
          result: 'declined',
          failureReason: 'expired_card',
          createdAt: at,
        },
      ],
    });

    expect(response).toEqual({
      id: 'ch_1',
      subscriptionId: 'sub_1',
      amountCents: 1990,
      method: 'card',
      status: 'failed',
      attemptCount: 1,
      dueDate: '2026-01-31T10:30:00.000Z',
      periodStart: '2026-01-31T10:30:00.000Z',
      periodEnd: '2026-01-31T10:30:00.000Z',
      paidAt: null,
      createdAt: '2026-01-31T10:30:00.000Z',
      attempts: [
        {
          id: 'pa_1',
          result: 'declined',
          failureReason: 'expired_card',
          createdAt: '2026-01-31T10:30:00.000Z',
        },
      ],
    });
  });
});
