import { Injectable, Logger } from '@nestjs/common';
import type { GatewayWebhookPayload } from '../../gateway/index.js';
import { Clock } from '../../shared/clock/index.js';
import { currentCorrelationId } from '../../shared/correlation/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import { runWithinChargeCorrelation } from '../charges/charge-correlation.js';
import { ChargeDunning } from '../charges/charge-dunning.js';
import { logSettlementEvents } from '../charges/charge-events.js';
import { logPaymentEvent, PAYMENT_EVENTS } from '../charges/payment-events.js';
import { decideWebhookEffect } from './domain/decide-webhook-effect.js';
import type { WebhookIngestion } from './webhook-event.js';
import { WebhookEventsRepository } from './webhook-events.repository.js';

function logReceived(
  { id, type, data }: GatewayWebhookPayload,
  requestCorrelationId: string | undefined,
): void {
  logPaymentEvent(
    {
      event: PAYMENT_EVENTS.webhookReceived,
      gatewayEventId: id,
      eventType: type,
      chargeId: data.charge.externalRef,
      gatewayChargeId: data.charge.id,
      ...(requestCorrelationId && { requestCorrelationId }),
    },
    `Webhook event ${id} (${type}) received for charge ${data.charge.externalRef}`,
  );
}

@Injectable()
export class WebhookEventProcessor {
  private readonly logger = new Logger(WebhookEventProcessor.name);

  constructor(
    private readonly events: WebhookEventsRepository,
    private readonly clock: Clock,
    private readonly dunning: ChargeDunning,
  ) {}

  async process(payload: GatewayWebhookPayload): Promise<WebhookIngestion> {
    const requestCorrelationId = currentCorrelationId();
    const correlationId = await this.events.findChargeCorrelationId(
      payload.data.charge.externalRef,
    );
    return runWithinChargeCorrelation({ correlationId }, () => {
      logReceived(payload, requestCorrelationId);
      return this.ingest(payload);
    });
  }

  private async ingest(
    payload: GatewayWebhookPayload,
  ): Promise<WebhookIngestion> {
    const now = this.clock.now();
    const { charge } = payload.data;
    const ingestion = await this.events.ingest(
      {
        id: generateId(ID_PREFIXES.webhookEvent),
        gatewayEventId: payload.id,
        type: payload.type,
        chargeId: charge.externalRef,
        gatewayChargeId: charge.id,
        payload,
        at: now,
      },
      (target) =>
        decideWebhookEffect({
          event: {
            type: payload.type,
            gatewayChargeId: charge.id,
            failureReason: charge.failureReason,
            amountCents: charge.amountCents,
            gatewayCustomerId: charge.customerId,
            paidAt: charge.paidAt ? new Date(charge.paidAt) : undefined,
            occurredAt: new Date(payload.createdAt),
          },
          target,
          now,
          attemptId: generateId(ID_PREFIXES.paymentAttempt),
        }),
    );
    this.report(payload, ingestion);
    if (ingestion.kind === 'processed' && ingestion.settled) {
      await this.dunning.afterSettlement(ingestion.settled.recorded);
    }
    return ingestion;
  }

  private report(
    { id, type, data }: GatewayWebhookPayload,
    ingestion: WebhookIngestion,
  ): void {
    const subject = `event ${id} (${type}) for charge ${data.charge.externalRef}`;
    if (ingestion.kind === 'duplicate') {
      logPaymentEvent(
        {
          event: PAYMENT_EVENTS.webhookDuplicateIgnored,
          gatewayEventId: id,
          eventType: type,
          chargeId: data.charge.externalRef,
        },
        `Duplicate webhook ${subject} ignored`,
      );
      return;
    }
    if (ingestion.settled) {
      logSettlementEvents({ ...ingestion.settled, source: 'webhook' });
    }
    if (ingestion.refundRisk) {
      logPaymentEvent(
        {
          event: PAYMENT_EVENTS.chargeRefundRequired,
          chargeId: data.charge.externalRef,
          subscriptionId: ingestion.refundRisk.subscriptionId,
          gatewayChargeId: data.charge.id,
          reason: `webhook_${ingestion.outcome}`,
        },
        `Webhook ${subject} (gateway charge ${data.charge.id}, subscription ${ingestion.refundRisk.subscriptionId}): ${ingestion.outcome}; money was captured that needs a refund`,
      );
    } else if (ingestion.outcome === 'rejected_mismatch') {
      this.logger.error(
        `Webhook ${subject} (gateway charge ${data.charge.id}) rejected: amount ${data.charge.amountCents} or customer ${data.charge.customerId} does not match our records`,
      );
    } else if (ingestion.outcome === 'rejected_out_of_order') {
      this.logger.warn(`Out-of-order webhook ${subject} rejected`);
    } else {
      this.logger.log(`Webhook ${subject}: ${ingestion.outcome}`);
    }
  }
}
