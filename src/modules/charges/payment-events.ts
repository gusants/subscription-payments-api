import { Logger } from '@nestjs/common';
import type { GatewayFailureReason } from '../../gateway/index.js';
import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';
import type { PaymentMethod } from '../subscriptions/subscription.js';

export const PAYMENT_EVENTS = {
  chargeCreated: 'charge.created',
  chargeAttemptFailed: 'charge.attempt.failed',
  chargeRetryScheduled: 'charge.retry.scheduled',
  chargePaid: 'charge.paid',
  chargeExpired: 'charge.expired',
  chargeRefundRequired: 'charge.refund_required',
  chargeDunningExhausted: 'charge.dunning_exhausted',
  subscriptionStatusChanged: 'subscription.status_changed',
  webhookReceived: 'webhook.received',
  webhookDuplicateIgnored: 'webhook.duplicate_ignored',
} as const;

export type PaymentEventName =
  (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS];

export type SettlementSource = 'charge_flow' | 'webhook';

export type ChargeCreationOrigin = 'first_period' | 'renewal' | 'reissue';

interface ChargeFields {
  chargeId: string;
  subscriptionId: string;
}

export type PaymentEvent =
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargeCreated;
      origin: ChargeCreationOrigin;
      amountCents: number;
      method: PaymentMethod;
      retryCount: number;
    })
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargeAttemptFailed;
      source: SettlementSource;
      gatewayChargeId: string | null;
      failureReason: GatewayFailureReason | null;
      attemptCount: number;
      retryCount: number;
    })
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargePaid;
      source: SettlementSource;
      gatewayChargeId: string | null;
      amountCents: number;
      attemptCount: number;
      retryCount: number;
    })
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargeExpired;
      source: SettlementSource;
      gatewayChargeId: string | null;
      retryCount: number;
    })
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargeRetryScheduled;
      attempt: number;
      delayMs: number;
      runAt: string;
    })
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargeRefundRequired;
      gatewayChargeId: string | null;
      reason: string;
    })
  | (ChargeFields & {
      event: typeof PAYMENT_EVENTS.chargeDunningExhausted;
      retryCount: number;
    })
  | {
      event: typeof PAYMENT_EVENTS.subscriptionStatusChanged;
      subscriptionId: string;
      from: SubscriptionStatus;
      to: SubscriptionStatus;
      cause: string;
      chargeId?: string;
    }
  | {
      event: typeof PAYMENT_EVENTS.webhookReceived;
      gatewayEventId: string;
      eventType: string;
      chargeId: string;
      gatewayChargeId: string;
      requestCorrelationId?: string;
    }
  | {
      event: typeof PAYMENT_EVENTS.webhookDuplicateIgnored;
      gatewayEventId: string;
      eventType: string;
      chargeId: string;
    };

type LogLevel = 'log' | 'warn' | 'error';

const LEVEL_OF: Record<PaymentEventName, LogLevel> = {
  'charge.created': 'log',
  'charge.attempt.failed': 'log',
  'charge.retry.scheduled': 'log',
  'charge.paid': 'log',
  'charge.expired': 'log',
  'charge.refund_required': 'error',
  'charge.dunning_exhausted': 'warn',
  'subscription.status_changed': 'log',
  'webhook.received': 'log',
  'webhook.duplicate_ignored': 'log',
};

const logger = new Logger('PaymentEvents');

export function logPaymentEvent(event: PaymentEvent, msg: string): void {
  logger[LEVEL_OF[event.event]]({ ...event, msg });
}
