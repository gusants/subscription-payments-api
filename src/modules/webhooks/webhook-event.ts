import type { GatewayWebhookPayload } from '../../gateway/index.js';
import type {
  ChargeSettlementRecord,
  Charge,
  RecordedOutcome,
} from '../charges/charge.js';
import type { Subscription } from '../subscriptions/subscription.js';
import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';

export const WEBHOOK_EVENT_OUTCOMES = [
  'applied',
  'ignored_duplicate_state',
  'ignored_unknown_charge',
  'rejected_out_of_order',
  'requires_refund',
  'rejected_mismatch',
] as const;

export type WebhookEventOutcome = (typeof WEBHOOK_EVENT_OUTCOMES)[number];

export interface IncomingWebhookEvent {
  id: string;
  gatewayEventId: string;
  type: GatewayWebhookPayload['type'];
  chargeId: string;
  gatewayChargeId: string;
  payload: GatewayWebhookPayload;
  at: Date;
}

export interface WebhookTarget {
  charge: Charge;
  subscription: Subscription;
  attemptRecorded: boolean;
  gatewayCustomerId: string | null;
}

export interface RefundRisk {
  subscriptionId: string;
}

export type WebhookDecision =
  | {
      outcome: 'applied';
      settlement: ChargeSettlementRecord;
      refundRisk?: RefundRisk;
    }
  | { outcome: 'requires_refund'; refundRisk: RefundRisk }
  | { outcome: Exclude<WebhookEventOutcome, 'applied' | 'requires_refund'> };

export type WebhookDecider = (target: WebhookTarget | null) => WebhookDecision;

export type WebhookIngestion =
  | { kind: 'duplicate' }
  | {
      kind: 'processed';
      outcome: WebhookEventOutcome;
      refundRisk?: RefundRisk;
      settled?: SettledByWebhook;
    };

export interface SettledByWebhook {
  settlement: ChargeSettlementRecord;
  recorded: RecordedOutcome;
  previousSubscriptionStatus: SubscriptionStatus;
}

export function toProcessedIngestion(
  decision: WebhookDecision,
  target: WebhookTarget | null,
  recorded?: RecordedOutcome,
): WebhookIngestion {
  const refundRisk = 'refundRisk' in decision ? decision.refundRisk : undefined;
  const settled =
    decision.outcome === 'applied' && recorded && target
      ? {
          settlement: decision.settlement,
          recorded,
          previousSubscriptionStatus: target.subscription.status,
        }
      : undefined;
  return {
    kind: 'processed',
    outcome: decision.outcome,
    ...(refundRisk && { refundRisk }),
    ...(settled && { settled }),
  };
}
