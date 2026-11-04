import type {
  GatewayChargeStatus,
  GatewayEventType,
  GatewayFailureReason,
} from '../../../gateway/index.js';
import type { ChargeStatus } from '../../charges/charge-status.js';
import {
  canTransition,
  statusesAllowedToTransitionTo as chargeStatusesAllowedToTransitionTo,
  expirySettlement,
  subscriptionChange,
  subscriptionStatusAfterCharge,
  toChargeOutcome,
} from '../../charges/domain/index.js';
import type { WebhookDecision, WebhookTarget } from '../webhook-event.js';

export interface WebhookChargeEvent {
  type: GatewayEventType;
  gatewayChargeId: string;
  failureReason?: GatewayFailureReason;
  amountCents: number;
  gatewayCustomerId: string;
  paidAt?: Date;
  occurredAt: Date;
}

export interface WebhookDecisionInput {
  event: WebhookChargeEvent;
  target: WebhookTarget | null;
  now: Date;
  attemptId: string;
}

const CHARGE_STATUS_BY_EVENT: Readonly<
  Record<GatewayEventType, Exclude<GatewayChargeStatus, 'pending'>>
> = {
  'charge.paid': 'paid',
  'charge.failed': 'failed',
  'charge.expired': 'expired',
};

function isAlreadyApplied(
  { charge, attemptRecorded }: WebhookTarget,
  { gatewayChargeId }: WebhookChargeEvent,
  to: ChargeStatus,
): boolean {
  if (charge.status === to) return charge.gatewayChargeId === gatewayChargeId;
  const settlesAttempt = to !== 'expired';
  return charge.status === 'pending' && settlesAttempt && attemptRecorded;
}

function disagreesWithOurRecords(
  { charge, gatewayCustomerId }: WebhookTarget,
  event: WebhookChargeEvent,
): boolean {
  return (
    event.amountCents !== charge.amountCents ||
    event.gatewayCustomerId !== gatewayCustomerId
  );
}

const STATUSES_THAT_NEVER_ACCEPT_A_PAYMENT: readonly ChargeStatus[] = [
  'expired',
  'failed',
  'uncollectible',
];

function capturesMoneyAlreadySettledElsewhere(
  { charge }: WebhookTarget,
  { type, gatewayChargeId }: WebhookChargeEvent,
): boolean {
  if (type !== 'charge.paid') return false;
  return (
    STATUSES_THAT_NEVER_ACCEPT_A_PAYMENT.includes(charge.status) ||
    (charge.status === 'paid' && charge.gatewayChargeId !== gatewayChargeId)
  );
}

export function decideWebhookEffect({
  event,
  target,
  now,
  attemptId,
}: WebhookDecisionInput): WebhookDecision {
  if (!target) return { outcome: 'ignored_unknown_charge' };
  if (disagreesWithOurRecords(target, event)) {
    return { outcome: 'rejected_mismatch' };
  }
  const to = CHARGE_STATUS_BY_EVENT[event.type];
  if (isAlreadyApplied(target, event, to)) {
    return { outcome: 'ignored_duplicate_state' };
  }
  const { charge, subscription } = target;
  if (capturesMoneyAlreadySettledElsewhere(target, event)) {
    return {
      outcome: 'requires_refund',
      refundRisk: { subscriptionId: subscription.id },
    };
  }
  if (!canTransition(charge.status, to)) {
    return { outcome: 'rejected_out_of_order' };
  }
  const outcome = toChargeOutcome({
    status: to,
    failureReason: event.failureReason,
  });
  if (!outcome) {
    return {
      outcome: 'applied',
      settlement: expirySettlement({
        charge,
        subscription,
        gatewayChargeId: event.gatewayChargeId,
        now,
      }),
    };
  }
  return {
    outcome: 'applied',
    ...(to === 'paid' &&
      subscription.status === 'canceled' && {
        refundRisk: { subscriptionId: subscription.id },
      }),
    settlement: {
      charge: {
        id: charge.id,
        fromAnyOf: chargeStatusesAllowedToTransitionTo(outcome.chargeStatus),
        to: outcome.chargeStatus,
        gatewayChargeId: event.gatewayChargeId,
        paidAt:
          outcome.chargeStatus === 'paid'
            ? (event.paidAt ?? event.occurredAt)
            : null,
        ...(outcome.chargeStatus === 'failed' && { firstFailedAt: now }),
      },
      attempt: {
        id: attemptId,
        chargeId: charge.id,
        gatewayChargeId: event.gatewayChargeId,
        result: outcome.attemptResult,
        failureReason: outcome.failureReason,
      },
      subscription: {
        id: subscription.id,
        change: subscriptionChange(
          subscription,
          subscriptionStatusAfterCharge(
            subscription.status,
            outcome.chargeStatus,
          ),
          now,
        ),
      },
    },
  };
}
