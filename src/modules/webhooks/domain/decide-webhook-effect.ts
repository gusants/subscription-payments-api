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
