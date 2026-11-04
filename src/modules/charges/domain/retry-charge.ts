import type { Charge, NewCharge, NewChargeIdentity } from '../charge.js';
import { nextGatewayAttempt } from './gateway-attempt.js';

export function newRetryCharge(
  expired: Charge,
  retryNumber: number,
  { id, correlationId }: NewChargeIdentity,
  startedAt: Date,
): NewCharge {
  return {
    id,
    correlationId: expired.correlationId ?? correlationId,
    subscriptionId: expired.subscriptionId,
    amountCents: expired.amountCents,
    method: expired.method,
    dueDate: expired.dueDate,
    periodStart: expired.periodStart,
    periodEnd: expired.periodEnd,
    retryCount: retryNumber,
    firstFailedAt: expired.firstFailedAt,
    ...nextGatewayAttempt({ id, attemptCount: 0 }, startedAt),
  };
}
