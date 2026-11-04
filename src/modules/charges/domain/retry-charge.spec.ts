import type { Charge } from '../charge.js';
import { newRetryCharge } from './retry-charge.js';

describe('newRetryCharge', () => {
  const expired: Charge = {
    id: 'ch_old',
    subscriptionId: 'sub_1',
    amountCents: 1990,
    method: 'pix',
    status: 'expired',
    gatewayChargeId: 'gch_old',
    gatewayAttemptKey: 'ch_old:1',
    attemptStartedAt: new Date('2026-03-01T10:00:00.000Z'),
    attemptCount: 1,
    retryCount: 1,
    firstFailedAt: new Date('2026-03-02T10:00:00.000Z'),
    nextRetryAt: null,
    dueDate: new Date('2026-03-01T10:00:00.000Z'),
    periodStart: new Date('2026-03-01T10:00:00.000Z'),
    periodEnd: new Date('2026-04-01T10:00:00.000Z'),
    paidAt: null,
    expiresAt: new Date('2026-03-02T10:00:00.000Z'),
    paymentInstructions: null,
    correlationId: 'cor_journey',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-02T10:00:00.000Z'),
  };

  it('covers the same period and amount with a fresh attempt and carries the dunning state', () => {
    const startedAt = new Date('2026-03-05T10:00:00.000Z');

    expect(
      newRetryCharge(
        expired,
        2,
        { id: 'ch_new', correlationId: 'cor_current' },
        startedAt,
      ),
    ).toEqual({
      id: 'ch_new',
      correlationId: 'cor_journey',
      subscriptionId: 'sub_1',
      amountCents: 1990,
      method: 'pix',
      dueDate: expired.dueDate,
      periodStart: expired.periodStart,
      periodEnd: expired.periodEnd,
      retryCount: 2,
      firstFailedAt: expired.firstFailedAt,
      gatewayAttemptKey: 'ch_new:1',
      attemptStartedAt: startedAt,
    });
  });

  it('starts from the given correlation id when the expired charge predates it', () => {
    const reissued = newRetryCharge(
      { ...expired, correlationId: null },
      2,
      { id: 'ch_new', correlationId: 'cor_current' },
      new Date('2026-03-05T10:00:00.000Z'),
    );

    expect(reissued.correlationId).toBe('cor_current');
  });
});
