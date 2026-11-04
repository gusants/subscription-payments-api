import type { Charge, NewCharge } from '../charge.js';
import { nextGatewayAttempt } from './gateway-attempt.js';

export function newRetryCharge(
  expired: Charge,
  retryNumber: number,
  id: string,
  startedAt: Date,
): NewCharge {
  return {
    id,
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
