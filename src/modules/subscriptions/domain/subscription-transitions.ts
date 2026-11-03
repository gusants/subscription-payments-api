import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '../subscription-status.js';
import { InvalidTransitionError } from './invalid-transition.error.js';

const ALLOWED_TRANSITIONS: Readonly<
  Record<SubscriptionStatus, readonly SubscriptionStatus[]>
> = {
  incomplete: ['active', 'past_due', 'canceled'],
  active: ['past_due', 'canceled'],
  past_due: ['active', 'canceled'],
  canceled: [],
};

export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function statusesAllowedToTransitionTo(
  to: SubscriptionStatus,
): SubscriptionStatus[] {
  return SUBSCRIPTION_STATUSES.filter((from) => canTransition(from, to));
}

export function assertTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
