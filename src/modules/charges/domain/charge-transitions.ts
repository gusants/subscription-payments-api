import { CHARGE_STATUSES, type ChargeStatus } from '../charge-status.js';
import { InvalidChargeTransitionError } from './invalid-charge-transition.error.js';

const ALLOWED_TRANSITIONS: Readonly<
  Record<ChargeStatus, readonly ChargeStatus[]>
> = {
  pending: ['paid', 'failed', 'expired'],
  failed: ['pending', 'uncollectible'],
  paid: [],
  expired: [],
  uncollectible: [],
};

export function canTransition(from: ChargeStatus, to: ChargeStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function statusesAllowedToTransitionTo(
  to: ChargeStatus,
): ChargeStatus[] {
  return CHARGE_STATUSES.filter((from) => canTransition(from, to));
}

export function assertTransition(from: ChargeStatus, to: ChargeStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidChargeTransitionError(from, to);
  }
}
