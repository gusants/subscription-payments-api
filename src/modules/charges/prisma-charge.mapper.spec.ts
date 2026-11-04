import { Logger } from '@nestjs/common';
import { toCharge, type ChargeRow } from './prisma-charge.mapper.js';

const row = (overrides: Partial<ChargeRow> = {}): ChargeRow => ({
  id: 'ch_1',
  subscriptionId: 'sub_1',
  amountCents: 1990,
  method: 'pix',
  status: 'pending',
  gatewayChargeId: null,
  gatewayAttemptKey: null,
  attemptStartedAt: null,
  attemptCount: 0,
  nextRetryAt: null,
  dueDate: new Date('2026-01-31T00:00:00.000Z'),
  periodStart: new Date('2026-01-31T00:00:00.000Z'),
  periodEnd: new Date('2026-02-28T00:00:00.000Z'),
  paidAt: null,
  expiresAt: null,
  paymentInstructions: null,
  createdAt: new Date('2026-01-31T00:00:00.000Z'),
  updatedAt: new Date('2026-01-31T00:00:00.000Z'),
  ...overrides,
});

describe('toCharge', () => {
  it('keeps absent payment instructions as null', () => {
    expect(toCharge(row()).paymentInstructions).toBeNull();
  });

  it('parses stored pix instructions', () => {
    const stored = { type: 'pix', copyPaste: '000201' };

    expect(
      toCharge(row({ paymentInstructions: stored })).paymentInstructions,
    ).toEqual(stored);
  });

  describe('stored instructions of an unknown shape', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('exposes no instructions instead of failing the whole charge', () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const charge = toCharge(
        row({ paymentInstructions: { type: 'carrier-pigeon' } }),
      );

      expect(charge).toMatchObject({ id: 'ch_1', paymentInstructions: null });
    });

    it('logs an error naming the charge', () => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      toCharge(row({ paymentInstructions: { type: 'carrier-pigeon' } }));

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('ch_1'),
        expect.any(String),
      );
    });
  });
});
