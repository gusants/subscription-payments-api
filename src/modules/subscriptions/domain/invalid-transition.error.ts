import { ConflictError } from '../../../shared/errors/conflict.error.js';
import type { SubscriptionStatus } from '../subscription-status.js';

export class InvalidTransitionError extends ConflictError {
  constructor(from: SubscriptionStatus, to: SubscriptionStatus) {
    super(`Cannot transition subscription from ${from} to ${to}`);
  }
}
