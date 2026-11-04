import type {
  GatewayChargeStatus,
  GatewayEventType,
  GatewayFailureReason,
} from '../../../gateway/index.js';
import type { ChargeStatus } from '../../charges/charge-status.js';
import {
  canTransition,
  statusesAllowedToTransitionTo as chargeStatusesAllowedToTransitionTo,
  subscriptionStatusAfterCharge,
  subscriptionStatusAfterExpiry,
  toChargeOutcome,
  type ChargeOutcome,
} from '../../charges/domain/index.js';
import {
  canTransition as canSubscriptionTransition,
  statusesAllowedToTransitionTo as subscriptionStatusesAllowedToTransitionTo,
} from '../../subscriptions/domain/index.js';
import type {
  StatusChange,
  Subscription,
} from '../../subscriptions/subscription.js';
import type { WebhookDecision, WebhookTarget } from '../webhook-event.js';

export interface WebhookChargeEvent {
  type: GatewayEventType;
  gatewayChargeId: string;
  failureReason?: GatewayFailureReason;
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

function subscriptionChange(
  subscription: Subscription,
  to: Subscription['status'] | null,
  now: Date,
): StatusChange | null {
  if (!to || !canSubscriptionTransition(subscription.status, to)) return null;
  return {
    fromAnyOf: subscriptionStatusesAllowedToTransitionTo(to),
    to,
    ...(to === 'canceled' && { canceledAt: now }),
  };
}

function subscriptionStatusAfter(
  current: Subscription['status'],
  outcome: ChargeOutcome | null,
): Subscription['status'] | null {
  return outcome
    ? subscriptionStatusAfterCharge(current, outcome.chargeStatus)
    : subscriptionStatusAfterExpiry(current);
}

export function decideWebhookEffect({
  event,
  target,
  now,
  attemptId,
}: WebhookDecisionInput): WebhookDecision {
  if (!target) return { outcome: 'ignored_unknown_charge' };
  const to = CHARGE_STATUS_BY_EVENT[event.type];
  if (isAlreadyApplied(target, event, to)) {
    return { outcome: 'ignored_duplicate_state' };
  }
  const { charge, subscription } = target;
  if (!canTransition(charge.status, to)) {
    return { outcome: 'rejected_out_of_order' };
  }
  const outcome = toChargeOutcome({
    status: to,
    failureReason: event.failureReason,
  });
  return {
    outcome: 'applied',
    settlement: {
      charge: {
        id: charge.id,
        fromAnyOf: chargeStatusesAllowedToTransitionTo(to),
        to,
        gatewayChargeId: event.gatewayChargeId,
        paidAt: to === 'paid' ? (event.paidAt ?? event.occurredAt) : null,
      },
      attempt: outcome && {
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
          subscriptionStatusAfter(subscription.status, outcome),
          now,
        ),
      },
    },
  };
}
