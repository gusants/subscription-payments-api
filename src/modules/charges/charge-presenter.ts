import type { ChargeSummary, ChargeWithAttempts } from './charge.js';
import type { ChargeHistoryItemResponse } from './dto/charge-history-item-response.dto.js';
import type { ChargeRetryResponse } from './dto/charge-retry-response.dto.js';
import type { ChargeSummaryResponse } from './dto/charge-summary-response.dto.js';
import type { ChargeRetryResult } from './charges.service.js';

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

export function toChargeHistoryItemResponse(
  charge: ChargeWithAttempts,
): ChargeHistoryItemResponse {
  return {
    id: charge.id,
    subscriptionId: charge.subscriptionId,
    amountCents: charge.amountCents,
    method: charge.method,
    status: charge.status,
    attemptCount: charge.attemptCount,
    dueDate: charge.dueDate.toISOString(),
    periodStart: charge.periodStart.toISOString(),
    periodEnd: charge.periodEnd.toISOString(),
    paidAt: charge.paidAt?.toISOString() ?? null,
    createdAt: charge.createdAt.toISOString(),
    attempts: charge.attempts.map((attempt) => ({
      id: attempt.id,
      result: attempt.result,
      failureReason: attempt.failureReason,
      createdAt: attempt.createdAt.toISOString(),
    })),
  };
}

export function toChargeRetryResponse({
  charge,
  subscription,
}: ChargeRetryResult): ChargeRetryResponse {
  return {
    charge: toChargeHistoryItemResponse(charge),
    subscription: { id: subscription.id, status: subscription.status },
  };
}
