import type {
  IncomingWebhookEvent,
  WebhookDecider,
  WebhookIngestion,
} from './webhook-event.js';

export abstract class WebhookEventsRepository {
  abstract ingest(
    event: IncomingWebhookEvent,
    decide: WebhookDecider,
  ): Promise<WebhookIngestion>;

  abstract findChargeCorrelationId(chargeId: string): Promise<string | null>;
}
