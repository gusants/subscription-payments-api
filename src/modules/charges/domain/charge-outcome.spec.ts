import type { GatewayFailureReason } from '../../../gateway/index.js';
import { toChargeOutcome } from './charge-outcome.js';

describe('toChargeOutcome', () => {
  it('maps a paid gateway charge to a paid charge and a succeeded attempt', () => {
    expect(toChargeOutcome({ status: 'paid' })).toEqual({
      chargeStatus: 'paid',
      attemptResult: 'succeeded',
      failureReason: null,
    });
  });

  it.each<GatewayFailureReason>([
    'insufficient_funds',
    'expired_card',
    'invalid_token',
  ])(
    'maps a failed gateway charge (%s) to a failed charge and a declined attempt',
    (failureReason) => {
      expect(toChargeOutcome({ status: 'failed', failureReason })).toEqual({
        chargeStatus: 'failed',
        attemptResult: 'declined',
        failureReason,
      });
    },
  );

  it('keeps a missing failure reason as null on a failed gateway charge', () => {
    expect(toChargeOutcome({ status: 'failed' })).toEqual({
      chargeStatus: 'failed',
      attemptResult: 'declined',
      failureReason: null,
    });
  });

  it('has no outcome while the gateway charge is still pending', () => {
    expect(toChargeOutcome({ status: 'pending' })).toBeNull();
  });
});
