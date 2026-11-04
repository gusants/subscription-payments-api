import { Injectable, Logger } from '@nestjs/common';
import type { GatewayWebhookPayload } from '../../gateway/index.js';
import { Clock } from '../../shared/clock/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import { decideWebhookEffect } from './domain/decide-webhook-effect.js';
import type { WebhookIngestion } from './webhook-event.js';
import { WebhookEventsRepository } from './webhook-events.repository.js';

@Injectable()
export class WebhookEventProcessor {
  private readonly logger = new Logger(WebhookEventProcessor.name);

  constructor(
    private readonly events: WebhookEventsRepository,
    private readonly clock: Clock,
  ) {}

  async process(payload: GatewayWebhookPayload): Promise<WebhookIngestion> {
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
            occurredAt: new Date(payload.createdAt),
          },
          target,
          now,
          attemptId: generateId(ID_PREFIXES.paymentAttempt),
        }),
    );
    this.report(payload, ingestion);
    return ingestion;
  }

  private report(
    { id, type, data }: GatewayWebhookPayload,
    ingestion: WebhookIngestion,
  ): void {
    const subject = `event ${id} (${type}) for charge ${data.charge.externalRef}`;
    if (ingestion.kind === 'duplicate') {
      this.logger.debug(`Duplicate webhook ${subject} ignored`);
    } else if (ingestion.outcome === 'rejected_out_of_order') {
      this.logger.warn(`Out-of-order webhook ${subject} rejected`);
    } else {
      this.logger.log(`Webhook ${subject}: ${ingestion.outcome}`);
    }
  }
}
