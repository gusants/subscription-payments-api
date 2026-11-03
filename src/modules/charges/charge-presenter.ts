import type { ChargeSummary } from './charge.js';
import type { ChargeSummaryResponse } from './dto/charge-summary-response.dto.js';

export function toChargeSummaryResponse(
  charge: ChargeSummary,
): ChargeSummaryResponse {
  return {
    id: charge.id,
    status: charge.status,
    amountCents: charge.amountCents,
    ...(charge.failureReason && { failureReason: charge.failureReason }),
  };
}
