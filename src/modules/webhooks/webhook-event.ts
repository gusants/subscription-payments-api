import type { GatewayWebhookPayload } from '../../gateway/index.js';
import type { ChargeSettlementRecord, Charge } from '../charges/charge.js';
import type { Subscription } from '../subscriptions/subscription.js';

export const WEBHOOK_EVENT_OUTCOMES = [
  'applied',
  'ignored_duplicate_state',
  'ignored_unknown_charge',
  'rejected_out_of_order',
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
}

export type WebhookDecision =
  | { outcome: 'applied'; settlement: ChargeSettlementRecord }
  | { outcome: Exclude<WebhookEventOutcome, 'applied'> };

export type WebhookDecider = (target: WebhookTarget | null) => WebhookDecision;

export type WebhookIngestion =
  { kind: 'duplicate' } | { kind: 'processed'; outcome: WebhookEventOutcome };
