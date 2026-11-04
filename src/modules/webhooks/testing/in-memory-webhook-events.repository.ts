import type { InMemoryBillingRepository } from '../../charges/testing/in-memory-billing.repository.js';
import type { InMemorySubscriptionsRepository } from '../../subscriptions/testing/in-memory-subscriptions.repository.js';
import type {
  IncomingWebhookEvent,
  WebhookDecider,
  WebhookEventOutcome,
  WebhookIngestion,
  WebhookTarget,
} from '../webhook-event.js';
import { WebhookEventsRepository } from '../webhook-events.repository.js';

export interface StoredWebhookEvent {
  gatewayEventId: string;
  type: string;
  outcome: WebhookEventOutcome;
  processedAt: Date;
}

export class InMemoryWebhookEventsRepository extends WebhookEventsRepository {
  private readonly stored = new Map<string, StoredWebhookEvent>();

  constructor(
    private readonly billing: InMemoryBillingRepository,
    private readonly subscriptions: InMemorySubscriptionsRepository,
  ) {
    super();
  }

  async ingest(
    event: IncomingWebhookEvent,
    decide: WebhookDecider,
  ): Promise<WebhookIngestion> {
    if (this.stored.has(event.gatewayEventId)) return { kind: 'duplicate' };
    const decision = decide(await this.findTarget(event));
    if (decision.outcome === 'applied') {
      await this.billing.recordChargeOutcome(decision.settlement);
    }
    this.stored.set(event.gatewayEventId, {
      gatewayEventId: event.gatewayEventId,
      type: event.type,
      outcome: decision.outcome,
      processedAt: event.at,
    });
    return { kind: 'processed', outcome: decision.outcome };
  }

  events(): StoredWebhookEvent[] {
    return [...this.stored.values()];
  }

  private async findTarget({
    chargeId,
    gatewayChargeId,
  }: IncomingWebhookEvent): Promise<WebhookTarget | null> {
    const charge = this.billing.charges().find(({ id }) => id === chargeId);
    if (!charge) return null;
    const subscription = await this.subscriptions.findById(
      charge.subscriptionId,
    );
    if (!subscription) return null;
    return {
      charge,
      subscription,
      attemptRecorded: this.billing
        .attempts()
        .some((attempt) => attempt.gatewayChargeId === gatewayChargeId),
    };
  }
}
