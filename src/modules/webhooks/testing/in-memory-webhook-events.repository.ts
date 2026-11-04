import type { CustomersRepository } from '../../customers/customers.repository.js';
import type { InMemoryBillingRepository } from '../../charges/testing/in-memory-billing.repository.js';
import type { InMemorySubscriptionsRepository } from '../../subscriptions/testing/in-memory-subscriptions.repository.js';
import {
  toProcessedIngestion,
  type IncomingWebhookEvent,
  type WebhookDecider,
  type WebhookEventOutcome,
  type WebhookIngestion,
  type WebhookTarget,
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
    private readonly customers: CustomersRepository,
  ) {
    super();
  }

  async ingest(
    event: IncomingWebhookEvent,
    decide: WebhookDecider,
  ): Promise<WebhookIngestion> {
    if (this.stored.has(event.gatewayEventId)) return { kind: 'duplicate' };
    const decision = decide(await this.findTarget(event));
    const recorded =
      decision.outcome === 'applied'
        ? await this.billing.recordChargeOutcome(decision.settlement)
        : undefined;
    this.stored.set(event.gatewayEventId, {
      gatewayEventId: event.gatewayEventId,
      type: event.type,
      outcome: decision.outcome,
      processedAt: event.at,
    });
    return toProcessedIngestion(decision, recorded);
  }

  findChargeCorrelationId(chargeId: string): Promise<string | null> {
    const charge = this.billing.charges().find(({ id }) => id === chargeId);
    return Promise.resolve(charge?.correlationId ?? null);
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
    const customer = await this.customers.findById(subscription.customerId);
    return {
      charge,
      subscription,
      gatewayCustomerId: customer?.gatewayCustomerId ?? null,
      attemptRecorded: this.billing
        .attempts()
        .some((attempt) => attempt.gatewayChargeId === gatewayChargeId),
    };
  }
}
