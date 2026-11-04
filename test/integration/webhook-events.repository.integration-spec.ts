import { Logger } from '@nestjs/common';
import type {
  GatewayChargeJson,
  GatewayWebhookPayload,
} from '../../src/gateway/index.js';
import { PrismaBillingRepository } from '../../src/modules/charges/prisma-billing.repository.js';
import type { NewCharge } from '../../src/modules/charges/charge.js';
import { PrismaWebhookEventsRepository } from '../../src/modules/webhooks/prisma-webhook-events.repository.js';
import { WebhookEventProcessor } from '../../src/modules/webhooks/webhook-event.processor.js';
import type { NewSubscription } from '../../src/modules/subscriptions/subscription.js';
import { RecordingBillingQueue } from '../../src/modules/billing-queue/testing/recording-billing-queue.js';
import { ChargeDunning } from '../../src/modules/charges/charge-dunning.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaWebhookEventsRepository (integration)', () => {
  const periodStart = new Date('2026-03-01T10:00:00.000Z');
  const periodEnd = new Date('2026-04-01T10:00:00.000Z');
  const now = new Date('2026-03-01T12:00:00.000Z');
  let prisma: PrismaService;
  let repository: PrismaWebhookEventsRepository;
  let billing: PrismaBillingRepository;
  let processor: WebhookEventProcessor;
  let subscriptionId: string;
  let chargeId: string;

  beforeAll(() => {
    Logger.overrideLogger(false);
    prisma = createPrismaService();
    repository = new PrismaWebhookEventsRepository(prisma);
    billing = new PrismaBillingRepository(prisma);
    processor = new WebhookEventProcessor(
      repository,
      new FixedClock(now),
      new ChargeDunning(
        billing,
        new RecordingBillingQueue(),
        new FixedClock(now),
        'days',
      ),
    );
  });

  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    const customer = await prisma.customer.create({
      data: {
        id: generateId(ID_PREFIXES.customer),
        name: 'Ana',
        email: 'ana@example.com',
        gatewayCustomerId: 'gcus_1',
      },
    });
    const plan = await prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Basic',
        amountCents: 1990,
        interval: 'monthly',
      },
    });
    const subscription: NewSubscription = {
      id: generateId(ID_PREFIXES.subscription),
      customerId: customer.id,
      planId: plan.id,
      paymentMethod: 'pix',
      status: 'incomplete',
      cardToken: null,
      billingAnchor: periodStart,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    };
    const charge: NewCharge = {
      id: generateId(ID_PREFIXES.charge),
      subscriptionId: subscription.id,
      amountCents: 1990,
      method: 'pix',
      dueDate: periodStart,
      periodStart,
      periodEnd,
      gatewayAttemptKey: 'attempt-1',
      attemptStartedAt: periodStart,
    };
    await billing.createSubscriptionWithFirstCharge(subscription, charge);
    subscriptionId = subscription.id;
    chargeId = charge.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const event = (
    type: GatewayWebhookPayload['type'],
    eventId: string,
    overrides: Partial<GatewayChargeJson> = {},
  ): GatewayWebhookPayload => ({
    id: eventId,
    type,
    createdAt: now.toISOString(),
    data: {
      charge: {
        id: 'gch_1',
        customerId: 'gcus_1',
        externalRef: chargeId,
        amountCents: 1990,
        method: 'pix',
        status: type.replace('charge.', '') as GatewayChargeJson['status'],
        createdAt: periodStart.toISOString(),
        ...overrides,
      },
    },
  });

  const outcomes = async () =>
    (await prisma.webhookEvent.findMany({ orderBy: { id: 'asc' } })).map(
      ({ outcome }) => outcome,
    );

  const chargeRow = () =>
    prisma.charge.findUniqueOrThrow({ where: { id: chargeId } });

  const subscriptionRow = () =>
    prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

  it('stores the event, settles the charge and activates the subscription in one go', async () => {
    const result = await processor.process(event('charge.paid', 'evt_1'));

    expect(result).toEqual({ kind: 'processed', outcome: 'applied' });
    expect(await chargeRow()).toMatchObject({
      status: 'paid',
      gatewayChargeId: 'gch_1',
      paidAt: now,
      attemptCount: 1,
    });
    expect((await subscriptionRow()).status).toBe('active');
    expect(await prisma.paymentAttempt.findMany()).toEqual([
      expect.objectContaining({
        gatewayChargeId: 'gch_1',
        result: 'succeeded',
      }),
    ]);
    expect(
      await prisma.webhookEvent.findUniqueOrThrow({
        where: { gatewayEventId: 'evt_1' },
      }),
    ).toMatchObject({
      type: 'charge.paid',
      gatewayChargeId: 'gch_1',
      outcome: 'applied',
      processedAt: now,
      receivedAt: now,
      payload: expect.objectContaining({ id: 'evt_1' }),
    });
  });

  it('answers duplicate for a repeated event id and leaves the first effect alone', async () => {
    await processor.process(event('charge.paid', 'evt_1'));

    const second = await processor.process(event('charge.paid', 'evt_1'));

    expect(second).toEqual({ kind: 'duplicate' });
    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await prisma.paymentAttempt.count()).toBe(1);
  });

  it('applies exactly one of many identical events delivered in parallel', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        processor.process(event('charge.paid', 'evt_same')),
      ),
    );

    expect(results.filter(({ kind }) => kind === 'duplicate')).toHaveLength(7);
    expect(results.filter(({ kind }) => kind === 'processed')).toEqual([
      { kind: 'processed', outcome: 'applied' },
    ]);
    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await prisma.paymentAttempt.count()).toBe(1);
    expect((await chargeRow()).attemptCount).toBe(1);
  });

  it('applies one of two different events racing for the same charge and rejects the other', async () => {
    const results = await Promise.all([
      processor.process(event('charge.paid', 'evt_paid')),
      processor.process(event('charge.expired', 'evt_expired')),
    ]);

    const processedOutcomes = results.map((result) =>
      result.kind === 'processed' ? result.outcome : result.kind,
    );
    const loser = processedOutcomes.includes('requires_refund')
      ? 'requires_refund'
      : 'rejected_out_of_order';
    expect(processedOutcomes).toHaveLength(2);
    expect(processedOutcomes).toEqual(
      expect.arrayContaining(['applied', loser]),
    );
    expect(await prisma.webhookEvent.count()).toBe(2);
    expect(await outcomes()).toEqual(
      expect.arrayContaining(['applied', loser]),
    );
    const charge = await chargeRow();
    const subscription = await subscriptionRow();
    expect(
      (charge.status === 'paid' && subscription.status === 'active') ||
        (charge.status === 'expired' && subscription.status === 'canceled'),
    ).toBe(true);
  });

  it('never double-inserts the attempt when the webhook races the charge flow', async () => {
    const settle = billing.recordChargeOutcome({
      charge: {
        id: chargeId,
        fromAnyOf: ['pending'],
        to: 'paid',
        gatewayChargeId: 'gch_1',
        paidAt: now,
      },
      attempt: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId,
        gatewayChargeId: 'gch_1',
        result: 'succeeded',
        failureReason: null,
      },
      subscription: {
        id: subscriptionId,
        change: { fromAnyOf: ['incomplete'], to: 'active' },
      },
    });

    const [flow, webhook] = await Promise.allSettled([
      settle,
      processor.process(event('charge.paid', 'evt_1')),
    ]);

    expect(await prisma.paymentAttempt.count()).toBe(1);
    expect((await chargeRow()).attemptCount).toBe(1);
    expect((await subscriptionRow()).status).toBe('active');
    expect(flow.status).toBe('fulfilled');
    expect(webhook).toMatchObject({
      status: 'fulfilled',
      value: { kind: 'processed' },
    });
    const webhookOutcome =
      webhook.status === 'fulfilled' && webhook.value.kind === 'processed'
        ? webhook.value.outcome
        : undefined;
    expect(['ignored_duplicate_state', 'applied']).toContain(webhookOutcome);
  });

  it('records ignored_duplicate_state when the charge flow already settled it', async () => {
    await billing.recordChargeOutcome({
      charge: {
        id: chargeId,
        fromAnyOf: ['pending'],
        to: 'paid',
        gatewayChargeId: 'gch_1',
        paidAt: now,
      },
      attempt: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId,
        gatewayChargeId: 'gch_1',
        result: 'succeeded',
        failureReason: null,
      },
      subscription: {
        id: subscriptionId,
        change: { fromAnyOf: ['incomplete'], to: 'active' },
      },
    });

    const result = await processor.process(event('charge.paid', 'evt_1'));

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'ignored_duplicate_state',
    });
    expect(await prisma.paymentAttempt.count()).toBe(1);
  });

  it('persists requires_refund for a paid event on an expired charge and changes nothing', async () => {
    await processor.process(event('charge.expired', 'evt_expired'));

    const result = await processor.process(event('charge.paid', 'evt_paid'));

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'requires_refund',
      refundRisk: { subscriptionId },
    });
    expect(await chargeRow()).toMatchObject({ status: 'expired' });
    expect(await prisma.paymentAttempt.count()).toBe(0);
    expect(await outcomes()).toEqual(
      expect.arrayContaining(['applied', 'requires_refund']),
    );
  });

  it('persists rejected_mismatch for an amount that differs from the charge and changes nothing', async () => {
    const result = await processor.process(
      event('charge.paid', 'evt_1', { amountCents: 1 }),
    );

    expect(result).toEqual({ kind: 'processed', outcome: 'rejected_mismatch' });
    expect(await chargeRow()).toMatchObject({ status: 'pending' });
    expect(await outcomes()).toEqual(['rejected_mismatch']);
  });

  it('rejects an event whose customer is not the gateway customer of the subscription owner', async () => {
    const result = await processor.process(
      event('charge.paid', 'evt_1', { customerId: 'gcus_other' }),
    );

    expect(result).toEqual({ kind: 'processed', outcome: 'rejected_mismatch' });
    expect((await subscriptionRow()).status).toBe('incomplete');
  });

  it('records the payment of a canceled subscription as applied with a refund risk', async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'canceled', canceledAt: now },
    });

    const result = await processor.process(event('charge.paid', 'evt_1'));

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'applied',
      refundRisk: { subscriptionId },
    });
    expect(await chargeRow()).toMatchObject({ status: 'paid' });
    expect((await subscriptionRow()).status).toBe('canceled');
  });

  it('records an unknown charge as ignored without touching anything', async () => {
    const result = await processor.process(
      event('charge.paid', 'evt_1', { externalRef: 'ch_unknown' }),
    );

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'ignored_unknown_charge',
    });
    expect((await chargeRow()).status).toBe('pending');
    expect(await outcomes()).toEqual(['ignored_unknown_charge']);
  });

  it('cancels the subscription of an expired first charge with canceled_at set', async () => {
    await processor.process(event('charge.expired', 'evt_1'));

    expect(await chargeRow()).toMatchObject({
      status: 'expired',
      attemptCount: 0,
    });
    expect(await subscriptionRow()).toMatchObject({
      status: 'canceled',
      canceledAt: now,
    });
    expect(await prisma.paymentAttempt.count()).toBe(0);
  });

  it('rolls back the event row when the effect cannot be stored', async () => {
    await prisma.paymentAttempt.create({
      data: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId,
        gatewayChargeId: 'gch_1',
        result: 'declined',
        failureReason: null,
      },
    });
    const incoming = {
      id: generateId(ID_PREFIXES.webhookEvent),
      gatewayEventId: 'evt_1',
      type: 'charge.paid' as const,
      chargeId,
      gatewayChargeId: 'gch_1',
      payload: event('charge.paid', 'evt_1'),
      at: now,
    };

    await expect(
      repository.ingest(incoming, () => ({
        outcome: 'applied',
        settlement: {
          charge: {
            id: chargeId,
            fromAnyOf: ['pending'],
            to: 'paid',
            gatewayChargeId: 'gch_1',
            paidAt: now,
          },
          attempt: {
            id: generateId(ID_PREFIXES.paymentAttempt),
            chargeId,
            gatewayChargeId: 'gch_1',
            result: 'succeeded',
            failureReason: null,
          },
          subscription: { id: subscriptionId, change: null },
        },
      })),
    ).rejects.toThrow();

    expect(await prisma.webhookEvent.count()).toBe(0);
    expect((await chargeRow()).status).toBe('pending');
  });
});
