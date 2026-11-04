import type {
  GatewayCharge,
  GatewayFailureReason,
} from '../../../gateway/index.js';
import type { ChargeStatus, PaymentAttemptResult } from '../charge-status.js';

export interface ChargeOutcome {
  chargeStatus: Extract<ChargeStatus, 'paid' | 'failed'>;
  attemptResult: PaymentAttemptResult;
  failureReason: GatewayFailureReason | null;
}

export function toChargeOutcome(
  gatewayCharge: Pick<GatewayCharge, 'status' | 'failureReason'>,
): ChargeOutcome | null {
  switch (gatewayCharge.status) {
    case 'paid':
      return {
        chargeStatus: 'paid',
        attemptResult: 'succeeded',
        failureReason: null,
      };
    case 'failed':
      return {
        chargeStatus: 'failed',
        attemptResult: 'declined',
        failureReason: gatewayCharge.failureReason ?? null,
      };
    case 'pending':
    case 'expired':
      return null;
  }
}
