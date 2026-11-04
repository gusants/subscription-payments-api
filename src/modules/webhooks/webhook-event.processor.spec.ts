import { Logger } from '@nestjs/common';
import type {
  GatewayChargeJson,
  GatewayWebhookPayload,
} from '../../gateway/index.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import type { ChargeStatus } from '../charges/charge-status.js';
import { InMemoryBillingRepository } from '../charges/testing/in-memory-billing.repository.js';
import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import { InMemoryWebhookEventsRepository } from './testing/in-memory-webhook-events.repository.js';
import { WebhookEventProcessor } from './webhook-event.processor.js';

describe('WebhookEventProcessor', () => {
  const periodStart = new Date('2026-03-01T10:00:00.000Z');
  const now = new Date('2026-03-01T12:00:00.000Z');
  const eventTime = new Date('2026-03-01T11:30:00.000Z');
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let events: InMemoryWebhookEventsRepository;
  let processor: WebhookEventProcessor;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    events = new InMemoryWebhookEventsRepository(billing, subscriptions);
    processor = new WebhookEventProcessor(events, new FixedClock(now));
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seed(subscriptionStatus: SubscriptionStatus = 'incomplete') {
    await billing.createSubscriptionWithFirstCharge(
      {
        id: 'sub_1',
        customerId: 'cus_1',
        planId: 'plan_1',
        paymentMethod: 'pix',
        status: 'incomplete',
        cardToken: null,
        billingAnchor: periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: new Date('2026-04-01T10:00:00.000Z'),
      },
      {
        id: 'ch_1',
        subscriptionId: 'sub_1',
        amountCents: 1990,
        method: 'pix',
        dueDate: periodStart,
        periodStart,
        periodEnd: new Date('2026-04-01T10:00:00.000Z'),
        gatewayAttemptKey: 'ch_1:1',
        attemptStartedAt: periodStart,
      },
    );
    if (subscriptionStatus !== 'incomplete') {
      await subscriptions.changeStatus('sub_1', {
        fromAnyOf: ['incomplete'],
        to: subscriptionStatus,
      });
    }
  }

  const event = (
    type: GatewayWebhookPayload['type'],
    overrides: Partial<GatewayChargeJson> = {},
    id = 'evt_1',
  ): GatewayWebhookPayload => ({
    id,
    type,
    createdAt: eventTime.toISOString(),
    data: {
      charge: {
        id: 'gch_1',
        customerId: 'gcus_1',
        externalRef: 'ch_1',
        amountCents: 1990,
        method: 'pix',
        status: type.replace('charge.', '') as GatewayChargeJson['status'],
        createdAt: periodStart.toISOString(),
        ...overrides,
      },
    },
  });

  const chargeNow = () => billing.charges()[0]!;
  const subscriptionNow = async () => (await subscriptions.findById('sub_1'))!;
  const recordedOutcomes = () => events.events().map(({ outcome }) => outcome);

  async function settleCharge(
    status: Extract<ChargeStatus, 'paid' | 'failed'>,
  ) {
    await billing.recordChargeOutcome({
      charge: {
        id: 'ch_1',
        fromAnyOf: ['pending'],
        to: status,
        gatewayChargeId: 'gch_1',
        paidAt: status === 'paid' ? now : null,
      },
      attempt: {
        id: 'pa_seed',
        chargeId: 'ch_1',
        gatewayChargeId: 'gch_1',
        result: status === 'paid' ? 'succeeded' : 'declined',
        failureReason: null,
      },
      subscription: { id: 'sub_1', change: null },
    });
  }

  it('settles a pending pix charge as paid and activates the first subscription', async () => {
    await seed();

    const result = await processor.process(event('charge.paid'));

    expect(result).toEqual({ kind: 'processed', outcome: 'applied' });
    expect(chargeNow()).toMatchObject({
      status: 'paid',
      gatewayChargeId: 'gch_1',
      paidAt: eventTime,
      attemptCount: 1,
    });
    expect((await subscriptionNow()).status).toBe('active');
    expect(billing.attempts()).toEqual([
      expect.objectContaining({
        chargeId: 'ch_1',
        gatewayChargeId: 'gch_1',
        result: 'succeeded',
      }),
    ]);
    expect(events.events()).toEqual([
      {
        gatewayEventId: 'evt_1',
        type: 'charge.paid',
        outcome: 'applied',
        processedAt: now,
      },
    ]);
  });

  it('stores the payment instant carried by the gateway charge instead of the event time', async () => {
    await seed();
    const paidAt = new Date('2026-03-01T11:20:00.000Z');

    await processor.process(
      event('charge.paid', { paidAt: paidAt.toISOString() }),
    );

    expect(chargeNow().paidAt).toEqual(paidAt);
  });

  it('reactivates a past_due subscription when its renewal is paid', async () => {
    await seed('past_due');

    await processor.process(event('charge.paid'));

    expect((await subscriptionNow()).status).toBe('active');
  });

  it('applies a duplicated event id once and answers duplicate without touching anything', async () => {
    await seed();
    await processor.process(event('charge.paid'));

    const second = await processor.process(event('charge.paid'));

    expect(second).toEqual({ kind: 'duplicate' });
    expect(billing.attempts()).toHaveLength(1);
    expect(events.events()).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('records a charge.paid for a card charge already settled by the charge flow as duplicate state', async () => {
    await seed();
    await settleCharge('paid');

    const result = await processor.process(event('charge.paid'));

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'ignored_duplicate_state',
    });
    expect(billing.attempts()).toHaveLength(1);
    expect(chargeNow().attemptCount).toBe(1);
  });

  it('records a charge.failed already recorded for the same gateway charge as duplicate state', async () => {
    await seed();
    await settleCharge('failed');

    const result = await processor.process(event('charge.failed'));

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'ignored_duplicate_state',
    });
    expect(billing.attempts()).toHaveLength(1);
  });

  it('records a charge.failed that settles a still pending charge', async () => {
    await seed('active');

    const result = await processor.process(
      event('charge.failed', { failureReason: 'insufficient_funds' }),
    );

    expect(result).toEqual({ kind: 'processed', outcome: 'applied' });
    expect(chargeNow()).toMatchObject({ status: 'failed', paidAt: null });
    expect(billing.attempts()).toEqual([
      expect.objectContaining({
        result: 'declined',
        failureReason: 'insufficient_funds',
      }),
    ]);
    expect((await subscriptionNow()).status).toBe('past_due');
  });

  it('expires the first charge and cancels the never-paid subscription', async () => {
    await seed();

    const result = await processor.process(event('charge.expired'));

    expect(result).toEqual({ kind: 'processed', outcome: 'applied' });
    expect(chargeNow()).toMatchObject({ status: 'expired', attemptCount: 0 });
    expect(billing.attempts()).toEqual([]);
    expect(await subscriptionNow()).toMatchObject({
      status: 'canceled',
      canceledAt: now,
    });
  });

  it('expires a renewal charge and moves the active subscription to past_due', async () => {
    await seed('active');

    await processor.process(event('charge.expired'));

    expect(chargeNow().status).toBe('expired');
    expect(await subscriptionNow()).toMatchObject({
      status: 'past_due',
      canceledAt: null,
    });
  });

  it('records an event for an unknown charge and changes nothing', async () => {
    await seed();

    const result = await processor.process(
      event('charge.paid', { externalRef: 'ch_unknown' }),
    );

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'ignored_unknown_charge',
    });
    expect(chargeNow().status).toBe('pending');
  });

  it('rejects a paid event after the charge expired, logging a warning and changing nothing', async () => {
    await seed();
    await processor.process(event('charge.expired', {}, 'evt_expired'));

    const result = await processor.process(
      event('charge.paid', {}, 'evt_paid'),
    );

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'rejected_out_of_order',
    });
    expect(chargeNow().status).toBe('expired');
    expect((await subscriptionNow()).status).toBe('canceled');
    expect(billing.attempts()).toEqual([]);
    expect(recordedOutcomes()).toEqual(['applied', 'rejected_out_of_order']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('evt_paid'));
  });

  it('rejects an expired event after the charge was paid', async () => {
    await seed();
    await processor.process(event('charge.paid', {}, 'evt_paid'));

    const result = await processor.process(
      event('charge.expired', {}, 'evt_expired'),
    );

    expect(result).toEqual({
      kind: 'processed',
      outcome: 'rejected_out_of_order',
    });
    expect(chargeNow().status).toBe('paid');
    expect((await subscriptionNow()).status).toBe('active');
  });

  it('never fails the delivery on a rejected transition', async () => {
    await seed();
    await processor.process(event('charge.paid', {}, 'evt_paid'));

    await expect(
      processor.process(event('charge.failed', {}, 'evt_failed')),
    ).resolves.toEqual({ kind: 'processed', outcome: 'rejected_out_of_order' });
    expect(error).not.toHaveBeenCalled();
  });
});
