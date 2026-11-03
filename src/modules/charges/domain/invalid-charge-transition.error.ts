import { ConflictError } from '../../../shared/errors/conflict.error.js';
import type { ChargeStatus } from '../charge-status.js';

export class InvalidChargeTransitionError extends ConflictError {
  constructor(from: ChargeStatus, to: ChargeStatus) {
    super(`Cannot transition charge from ${from} to ${to}`);
  }
}
