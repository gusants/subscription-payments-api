import { Logger } from '@nestjs/common';
import { GatewayUnavailableError } from '../../gateway/index.js';
import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import type { Subscription } from '../subscriptions/subscription.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import type { RenewalCandidate } from './charge.js';
import { runWithCorrelationId } from '../../shared/correlation/index.js';
import { correlationIdsSeenBy } from '../../shared/correlation/testing/correlation-ids-seen-by.js';
import { recordPaymentEvents } from './testing/record-payment-events.js';
import { SubscriptionRenewalRunner } from './subscription-renewal-runner.js';
import { buildChargeProcessor } from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';
import { InMemoryRenewalsRepository } from './testing/in-memory-renewals.repository.js';

describe('SubscriptionRenewalRunner', () => {
  const anchor = new Date('2026-01-31T10:30:00.000Z');
  const firstPeriodEnd = new Date('2026-02-28T10:30:00.000Z');
  const secondPeriodEnd = new Date('2026-03-31T10:30:00.000Z');
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let renewals: InMemoryRenewalsRepository;
  let customers: InMemoryCustomersRepository;
  let gateway: StubPaymentGateway;
  let clock: FixedClock;
  let runner: SubscriptionRenewalRunner;

  function buildRunner(batchSize = 10) {
    runner = new SubscriptionRenewalRunner(
      renewals,
      buildChargeProcessor({
        billing,
        subscriptions,
        customers,
        gateway,
        clock,
      }),
      clock,
      batchSize,
    );
  }

  beforeEach(async () => {
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    renewals = new InMemoryRenewalsRepository(billing);
    customers = new InMemoryCustomersRepository();
    gateway = new StubPaymentGateway();
    clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
    await customers.create({ id: 'cus_1', name: 'Ana', email: 'ana@e.com' });
    await customers.assignGatewayCustomerId('cus_1', 'gcus_1');
    buildRunner();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedSubscription(
    id: string,
    overrides: Partial<Subscription> = {},
    method: Subscription['paymentMethod'] = 'card',
  ): Promise<RenewalCandidate> {
    const subscription = await billing.createSubscriptionWithFirstCharge(
      {
        id,
        customerId: 'cus_1',
        planId: 'plan_1',
        paymentMethod: method,
        status: 'active',
        cardToken: method === 'card' ? 'tok_success' : null,
        billingAnchor: anchor,
        currentPeriodStart: anchor,
        currentPeriodEnd: firstPeriodEnd,
        ...overrides,
      },
      {
        id: `ch_first_${id}`,
        correlationId: 'cor_test_journey',
        subscriptionId: id,
        amountCents: 1990,
        method,
        dueDate: anchor,
        periodStart: anchor,
        periodEnd: firstPeriodEnd,
        gatewayAttemptKey: `ch_first_${id}:1`,
        attemptStartedAt: anchor,
      },
    );
    const candidate = {
      subscription: subscription.subscription,
      plan: { amountCents: 1990, interval: 'monthly' as const },
    };
    renewals.track(candidate);
    return candidate;
  }

  it('bills the next period and moves the subscription to it once paid', async () => {
    await seedSubscription('sub_1');

    const summary = await runner.run();

    expect(summary).toEqual({
      found: 1,
      renewed: 1,
      awaitingReconciliation: 0,
      alreadyGenerated: 0,
      failed: 0,
    });
    expect(billing.charges().at(-1)).toMatchObject({
      subscriptionId: 'sub_1',
      status: 'paid',
      amountCents: 1990,
      periodStart: firstPeriodEnd,
      periodEnd: secondPeriodEnd,
    });
    expect(await subscriptions.findById('sub_1')).toMatchObject({
      status: 'active',
      currentPeriodStart: firstPeriodEnd,
      currentPeriodEnd: secondPeriodEnd,
    });
  });

  it('bills a period only once when the renewal runs twice', async () => {
    await seedSubscription('sub_1');

    await runner.run();
    const second = await runner.run();

    expect(second.found).toBe(0);
    expect(billing.charges()).toHaveLength(2);
  });

  it('counts a period already taken by a concurrent run as already generated', async () => {
    const candidate = await seedSubscription('sub_1');
    vi.spyOn(renewals, 'findDue').mockResolvedValue([candidate]);
    await runner.run();

    const second = await runner.run();

    expect(second).toEqual({
      found: 1,
      renewed: 0,
      awaitingReconciliation: 0,
      alreadyGenerated: 1,
      failed: 0,
    });
    expect(billing.charges()).toHaveLength(2);
  });

  it('keeps the current period while a pix renewal is awaiting payment', async () => {
    await seedSubscription('sub_1', {}, 'pix');

    await runner.run();

    expect(billing.charges().at(-1)?.status).toBe('pending');
    expect((await subscriptions.findById('sub_1'))?.currentPeriodEnd).toEqual(
      firstPeriodEnd,
    );
  });

  it('leaves the period unchanged and flags past_due when the renewal is declined', async () => {
    await seedSubscription('sub_1');
    gateway.respondWith({
      status: 'failed',
      failureReason: 'insufficient_funds',
    });

    await runner.run();

    expect(billing.charges().at(-1)?.status).toBe('failed');
    expect(await subscriptions.findById('sub_1')).toMatchObject({
      status: 'past_due',
      currentPeriodEnd: firstPeriodEnd,
    });
  });

  it('does not renew subscriptions that are canceled, past_due or not yet due', async () => {
    await seedSubscription('sub_canceled', { status: 'canceled' });
    await seedSubscription('sub_past_due', { status: 'past_due' });
    await seedSubscription('sub_future', {
      currentPeriodEnd: new Date('2026-03-02T00:00:00.000Z'),
    });

    const summary = await runner.run();

    expect(summary.found).toBe(0);
    expect(billing.charges()).toHaveLength(3);
  });

  it('renews at most one batch per run', async () => {
    await seedSubscription('sub_1');
    await seedSubscription('sub_2');
    await seedSubscription('sub_3');
    buildRunner(2);

    const first = await runner.run();
    const second = await runner.run();

    expect([first.found, second.found]).toEqual([2, 1]);
  });

  it('keeps renewing the batch when one subscription fails', async () => {
    await seedSubscription('sub_1');
    await seedSubscription('sub_2');
    const error = vi.spyOn(Logger.prototype, 'error');
    await customers.create({ id: 'cus_2', name: 'Bia', email: 'bia@e.com' });
    await seedSubscription('sub_3', { customerId: 'cus_2' });

    const summary = await runner.run();

    expect(summary).toMatchObject({ found: 3, renewed: 2, failed: 1 });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Renewal of subscription sub_3'),
      expect.any(String),
    );
  });

  it('leaves the charge pending for reconciliation on a technical failure', async () => {
    await seedSubscription('sub_1');
    gateway.failChargeCreationWith(new GatewayUnavailableError('down'));

    const summary = await runner.run();

    expect(summary).toMatchObject({
      renewed: 0,
      awaitingReconciliation: 1,
      failed: 0,
    });
    expect(billing.charges().at(-1)?.status).toBe('pending');
  });

  it('counts a pix renewal that reached the gateway as renewed', async () => {
    await seedSubscription('sub_1', {}, 'pix');

    const summary = await runner.run();

    expect(summary).toMatchObject({ renewed: 1, awaitingReconciliation: 0 });
  });

  it('renews every subscription within a fresh correlation id that its charge keeps', async () => {
    await seedSubscription('sub_1');
    await seedSubscription('sub_2');
    const seen = correlationIdsSeenBy(gateway, 'createCharge');

    await runWithCorrelationId('cor_run_context', () => runner.run());

    const renewalIds = billing
      .charges()
      .filter(
        ({ periodStart }) => periodStart.getTime() === firstPeriodEnd.getTime(),
      )
      .map(({ correlationId }) => correlationId);
    expect(seen).toEqual(renewalIds);
    expect(new Set(renewalIds).size).toBe(2);
    expect(renewalIds).toEqual([
      expect.stringMatching(/^cor_/),
      expect.stringMatching(/^cor_/),
    ]);
    expect(renewalIds).not.toContain('cor_run_context');
  });

  it('logs the renewal charge as created before it is paid', async () => {
    await seedSubscription('sub_1');
    const recorded = recordPaymentEvents();

    await runner.run();

    expect(recorded.map(({ event }) => event)).toEqual([
      'charge.created',
      'charge.paid',
    ]);
    expect(recorded[0]).toMatchObject({ origin: 'renewal', retryCount: 0 });
  });
});
