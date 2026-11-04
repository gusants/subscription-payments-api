import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';
import type {
  Charge,
  ChargeSettlementRecord,
  RecordedOutcome,
} from './charge.js';
import {
  logPaymentEvent,
  PAYMENT_EVENTS,
  type ChargeCreationOrigin,
  type SettlementSource,
} from './payment-events.js';

export function logChargeCreated(
  charge: Charge,
  origin: ChargeCreationOrigin,
): void {
  logPaymentEvent(
    {
      event: PAYMENT_EVENTS.chargeCreated,
      chargeId: charge.id,
      subscriptionId: charge.subscriptionId,
      origin,
      amountCents: charge.amountCents,
      method: charge.method,
      retryCount: charge.retryCount,
    },
    `Charge ${charge.id} created for subscription ${charge.subscriptionId} (${origin})`,
  );
}

export interface SettlementReport {
  settlement: ChargeSettlementRecord;
  recorded: RecordedOutcome;
  previousSubscriptionStatus: SubscriptionStatus;
  source: SettlementSource;
}

function logChargeSettled({
  settlement,
  recorded: { charge },
  source,
}: SettlementReport): void {
  const fields = {
    chargeId: charge.id,
    subscriptionId: charge.subscriptionId,
    source,
    gatewayChargeId: charge.gatewayChargeId,
    retryCount: charge.retryCount,
  };
  if (charge.status === 'paid') {
    logPaymentEvent(
      {
        event: PAYMENT_EVENTS.chargePaid,
        ...fields,
        amountCents: charge.amountCents,
        attemptCount: charge.attemptCount,
      },
      `Charge ${charge.id} paid`,
    );
  } else if (charge.status === 'failed') {
    const failureReason = settlement.attempt?.failureReason ?? null;
    logPaymentEvent(
      {
        event: PAYMENT_EVENTS.chargeAttemptFailed,
        ...fields,
        failureReason,
        attemptCount: charge.attemptCount,
      },
      `Charge ${charge.id} attempt failed: ${failureReason ?? 'no reason given'}`,
    );
  } else if (charge.status === 'expired') {
    logPaymentEvent(
      { event: PAYMENT_EVENTS.chargeExpired, ...fields },
      `Charge ${charge.id} expired`,
    );
  }
}

function subscriptionMovedAsSettled({
  settlement,
  recorded,
  previousSubscriptionStatus,
}: SettlementReport): boolean {
  const { change } = settlement.subscription;
  return (
    change !== null &&
    recorded.subscriptionChangeApplied &&
    recorded.subscription.status === change.to &&
    previousSubscriptionStatus !== change.to
  );
}

export function logSettlementEvents(report: SettlementReport): void {
  if (!report.recorded.chargeSettledNow) return;
  logChargeSettled(report);
  if (!subscriptionMovedAsSettled(report)) return;
  const { charge, subscription } = report.recorded;
  logPaymentEvent(
    {
      event: PAYMENT_EVENTS.subscriptionStatusChanged,
      subscriptionId: subscription.id,
      from: report.previousSubscriptionStatus,
      to: subscription.status,
      cause: `charge.${charge.status}`,
      chargeId: charge.id,
    },
    `Subscription ${subscription.id} moved from ${report.previousSubscriptionStatus} to ${subscription.status} after charge ${charge.id} ${charge.status}`,
  );
}
