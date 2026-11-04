import { ConflictError } from '../../shared/errors/index.js';
import type { ChargeStatus } from './charge-status.js';

export class ChargeSettlementConflictError extends ConflictError {
  constructor(
    readonly chargeId: string,
    readonly currentStatus: ChargeStatus,
    readonly currentGatewayChargeId: string | null,
  ) {
    super(`Charge ${chargeId} was modified concurrently`, { transient: true });
  }
}
