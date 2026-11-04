import { Logger } from '@nestjs/common';
import type { GatewayWebhookPayload } from '../../gateway/index.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { InMemoryBillingRepository } from '../charges/testing/in-memory-billing.repository.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import { InMemoryWebhookEventsRepository } from './testing/in-memory-webhook-events.repository.js';
import { WebhookEventProcessor } from './webhook-event.processor.js';
import { WebhooksController } from './webhooks.controller.js';

describe('WebhooksController', () => {
  const unknownChargeEvent: GatewayWebhookPayload = {
    id: 'evt_1',
    type: 'charge.paid',
    createdAt: '2026-03-01T11:30:00.000Z',
    data: {
      charge: {
        id: 'gch_1',
        externalRef: 'ch_unknown',
        customerId: 'gcus_1',
        amountCents: 1990,
        method: 'pix',
        status: 'paid',
        createdAt: '2026-03-01T11:00:00.000Z',
      },
    },
  };
  let controller: WebhooksController;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const subscriptions = new InMemorySubscriptionsRepository();
    const billing = new InMemoryBillingRepository(subscriptions);
    const processor = new WebhookEventProcessor(
      new InMemoryWebhookEventsRepository(billing, subscriptions),
      new FixedClock(new Date('2026-03-01T12:00:00.000Z')),
    );
    controller = new WebhooksController(processor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('WebhooksController — receive an event — answers received true', async () => {
    const response = await controller.receive(unknownChargeEvent);

    expect(response).toEqual({ received: true });
  });

  it('WebhooksController — receive the same event twice — answers received true both times', async () => {
    await controller.receive(unknownChargeEvent);

    const second = await controller.receive(unknownChargeEvent);

    expect(second).toEqual({ received: true });
  });
});
