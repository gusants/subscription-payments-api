import { Logger } from '@nestjs/common';
import {
  GatewayOutcomeUnknownError,
  GatewayUnavailableError,
} from '../../gateway/index.js';
import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { RecordingBillingQueue } from '../billing-queue/testing/recording-billing-queue.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import type { Subscription } from '../subscriptions/subscription.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import { runWithCorrelationId } from '../../shared/correlation/index.js';
import { correlationIdsSeenBy } from '../../shared/correlation/testing/correlation-ids-seen-by.js';
import { ChargeReconciliationRunner } from './charge-reconciliation-runner.js';
import {
  buildChargeDunning,
  buildChargeProcessor,
} from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';
import { InMemoryChargesRepository } from './testing/in-memory-charges.repository.js';

describe('ChargeReconciliationRunner', () => {
  const minuteMs = 60_000;
  const dayMs = 24 * 60 * 60 * 1000;
  const staleAfterMs = 5 * minuteMs;
  const startedAt = new Date('2026-03-01T10:00:00.000Z');
  const periodEnd = new Date('2026-04-01T10:00:00.000Z');
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let customers: InMemoryCustomersRepository;
  let gateway: StubPaymentGateway;
  let clock: FixedClock;
  let queue: RecordingBillingQueue;
  let runner: ChargeReconciliationRunner;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    customers = new InMemoryCustomersRepository();
    gateway = new StubPaymentGateway();
    clock = new FixedClock(startedAt);
    queue = new RecordingBillingQueue();
    await customers.create({ id: 'cus_1', name: 'Ana', email: 'ana@e.com' });
    await customers.assignGatewayCustomerId('cus_1', 'gcus_1');
    runner = new ChargeReconciliationRunner(
      new InMemoryChargesRepository(billing, subscriptions),
      buildChargeProcessor({
        billing,
        subscriptions,
        customers,
        gateway,
        clock,
        queue,
      }),
      buildChargeDunning(billing, clock, queue),
      clock,
      'days',
      staleAfterMs,
      10,
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedCharge(
    id: string,
    overrides: {
      method?: 'card' | 'pix';
      subscriptionStatus?: Subscription['status'];
      customerId?: string;
      cardToken?: string | null;
      correlationId?: string;
    } = {},
  ) {
    const method = overrides.method ?? 'card';
    await billing.createSubscriptionWithFirstCharge(
      {
        id: `sub_${id}`,
        customerId: overrides.customerId ?? 'cus_1',
        planId: 'plan_1',
        paymentMethod: method,
        status: 'incomplete',
        cardToken:
          overrides.cardToken !== undefined
            ? overrides.cardToken
            : method === 'card'
              ? 'tok_success'
              : null,
        billingAnchor: startedAt,
        currentPeriodStart: startedAt,
        currentPeriodEnd: periodEnd,
      },
      {
        id,
        correlationId: overrides.correlationId ?? 'cor_test_journey',
        subscriptionId: `sub_${id}`,
        amountCents: 1990,
        method,
        dueDate: startedAt,
        periodStart: startedAt,
        periodEnd,
        gatewayAttemptKey: `${id}:1`,
        attemptStartedAt: startedAt,
      },
    );
    if (overrides.subscriptionStatus) {
      await subscriptions.changeStatus(`sub_${id}`, {
        fromAnyOf: ['incomplete'],
        to: overrides.subscriptionStatus,
      });
    }
  }

  describe('stale pending card charges', () => {
    it('reconciles a pending card charge whose attempt started before the stale window', async () => {
      await seedCharge('ch_1');
      clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));

      const summary = await runner.run();

      expect(summary).toMatchObject({ stalePending: 1, checked: 1, failed: 0 });
      expect(billing.charges()[0]?.status).toBe('paid');
    });

    it('leaves a charge inside the stale window alone', async () => {
      await seedCharge('ch_1');
      clock.set(new Date(startedAt.getTime() + staleAfterMs));

      const summary = await runner.run();

      expect(summary.stalePending).toBe(0);
      expect(billing.charges()[0]?.status).toBe('pending');
    });

    it('leaves pix charges awaiting payment at the gateway alone', async () => {
      await seedCharge('ch_1', { method: 'pix' });
      await billing.attachGatewayCharge('ch_1', {
        gatewayChargeId: 'gch_1',
        expiresAt: new Date(startedAt.getTime() + dayMs),
        paymentInstructions: null,
      });
      clock.set(new Date(startedAt.getTime() + dayMs));

      expect((await runner.run()).stalePending).toBe(0);
    });

    it('sends a pix charge that never reached the gateway', async () => {
      await seedCharge('ch_1', { method: 'pix' });
      clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));

      const summary = await runner.run();

      expect(summary).toMatchObject({ stalePending: 1, checked: 1, failed: 0 });
      expect(gateway.chargesRequested).toHaveLength(1);
      expect(billing.charges()[0]).toMatchObject({
        status: 'pending',
        gatewayChargeId: expect.any(String),
      });
    });

    it('adopts the gateway charge of a pix whose response was lost instead of sending it again', async () => {
      await seedCharge('ch_1', { method: 'pix' });
      gateway.failChargeCreationWith(new GatewayOutcomeUnknownError('lost'), {
        times: 1,
        afterProcessing: true,
      });
      clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));
      await runner.run();
      gateway.failChargeCreationWith(new GatewayUnavailableError('down'));
      clock.set(new Date(startedAt.getTime() + 3 * staleAfterMs));

      await runner.run();

      expect(gateway.chargesRequested).toHaveLength(1);
      expect(billing.charges()[0]?.gatewayChargeId).toEqual(expect.any(String));
    });

    it('skips a card charge whose subscription has no card token', async () => {
      await seedCharge('ch_1', { cardToken: null });
      clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));

      expect((await runner.run()).stalePending).toBe(0);
    });

    it('asks the gateway about a charge on a canceled subscription instead of rejecting it', async () => {
      await seedCharge('ch_1', { subscriptionStatus: 'canceled' });
      clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));

      const summary = await runner.run();

      expect(summary).toMatchObject({ checked: 1, failed: 0 });
      expect(billing.charges()[0]?.status).toBe('expired');
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('keeps reconciling the batch when one charge fails and logs which one', async () => {
      await customers.create({ id: 'cus_2', name: 'Bia', email: 'bia@e.com' });
      await seedCharge('ch_1', { customerId: 'cus_2' });
      await seedCharge('ch_2');
      clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));

      const summary = await runner.run();

      expect(summary).toMatchObject({ stalePending: 2, checked: 1, failed: 1 });
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(
          'Reconciling charge ch_1 (subscription sub_ch_1',
        ),
        expect.any(String),
      );
      expect(billing.charges().find(({ id }) => id === 'ch_2')?.status).toBe(
        'paid',
      );
    });
  });

  describe('lost dunning follow-ups', () => {
    async function seedFailed(id: string, retryCount: number, failedAt: Date) {
      await seedCharge(id);
      await billing.recordChargeOutcome({
        charge: {
          id,
          fromAnyOf: ['pending'],
          to: 'failed',
          gatewayChargeId: `gch_${id}`,
          paidAt: null,
          firstFailedAt: failedAt,
        },
        attempt: null,
        subscription: {
          id: `sub_${id}`,
          change: { fromAnyOf: ['incomplete'], to: 'past_due' },
        },
      });
      for (let retry = 1; retry <= retryCount; retry += 1) {
        await billing.markChargePending(
          id,
          ['failed'],
          { gatewayAttemptKey: `${id}:r${retry}`, attemptStartedAt: failedAt },
          retry,
        );
        await billing.recordChargeOutcome({
          charge: {
            id,
            fromAnyOf: ['pending'],
            to: 'failed',
            gatewayChargeId: `gch_${id}_${retry}`,
            paidAt: null,
          },
          attempt: null,
          subscription: { id: `sub_${id}`, change: null },
        });
      }
    }

    it('re-enqueues the retry of a failed charge whose job never fired', async () => {
      const failedAt = new Date(startedAt.getTime());
      await seedFailed('ch_1', 0, failedAt);
      clock.set(new Date(failedAt.getTime() + dayMs + staleAfterMs + 1));

      const summary = await runner.run();

      expect(summary.dunningFollowUps).toBe(1);
      expect(queue.scheduled()).toEqual([
        {
          chargeId: 'ch_1',
          attempt: 1,
          delayMs: 0,
          correlationId: 'cor_test_journey',
        },
      ]);
    });

    it('is idempotent: a second sweep schedules the same job id once', async () => {
      await seedFailed('ch_1', 0, startedAt);
      clock.set(new Date(startedAt.getTime() + dayMs + staleAfterMs + 1));

      await runner.run();
      await runner.run();

      expect(queue.scheduled()).toHaveLength(1);
    });

    it('does not touch a failed charge whose retry is not yet overdue', async () => {
      await seedFailed('ch_1', 0, startedAt);
      clock.set(new Date(startedAt.getTime() + dayMs));

      expect((await runner.run()).dunningFollowUps).toBe(0);
      expect(queue.scheduled()).toEqual([]);
    });

    it('uses the calendar slot of the retries already made', async () => {
      await seedFailed('ch_1', 1, startedAt);
      clock.set(new Date(startedAt.getTime() + 2 * dayMs));
      expect((await runner.run()).dunningFollowUps).toBe(0);

      clock.set(new Date(startedAt.getTime() + 3 * dayMs + staleAfterMs + 1));
      await runner.run();

      expect(queue.scheduled()).toEqual([
        {
          chargeId: 'ch_1',
          attempt: 2,
          delayMs: 0,
          correlationId: 'cor_test_journey',
        },
      ]);
    });

    it('closes a charge whose exhaustion was lost', async () => {
      await seedFailed('ch_1', 3, startedAt);
      clock.set(new Date(startedAt.getTime() + 8 * dayMs));

      await runner.run();

      expect(billing.charges()[0]?.status).toBe('uncollectible');
      expect((await subscriptions.findById('sub_ch_1'))?.status).toBe(
        'canceled',
      );
    });

    it('ignores failed charges of canceled subscriptions', async () => {
      await seedFailed('ch_1', 0, startedAt);
      await subscriptions.changeStatus('sub_ch_1', {
        fromAnyOf: ['past_due'],
        to: 'canceled',
      });
      clock.set(new Date(startedAt.getTime() + 2 * dayMs));

      expect((await runner.run()).dunningFollowUps).toBe(0);
    });
  });

  it('reconciles every charge within its own correlation id', async () => {
    await seedCharge('ch_1');
    await seedCharge('ch_2', { correlationId: 'cor_other_journey' });
    clock.set(new Date(startedAt.getTime() + staleAfterMs + 1));
    const seen = correlationIdsSeenBy(gateway, 'createCharge');

    await runWithCorrelationId('cor_sweep_context', () => runner.run());

    expect(seen).toEqual(['cor_test_journey', 'cor_other_journey']);
  });
});
