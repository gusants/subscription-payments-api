import type { Charge, GatewayAttempt } from '../charge.js';

export function nextGatewayAttempt(
  { id, attemptCount }: Pick<Charge, 'id' | 'attemptCount'>,
  startedAt: Date,
): GatewayAttempt {
  return {
    gatewayAttemptKey: `${id}:${attemptCount + 1}`,
    attemptStartedAt: startedAt,
  };
}
