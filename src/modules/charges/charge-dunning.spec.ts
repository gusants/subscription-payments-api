import { Logger } from '@nestjs/common';
import { runWithCorrelationId } from '../../shared/correlation/index.js';
import {
  eventNames,
  recordPaymentEvents,
} from './testing/record-payment-events.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { RecordingBillingQueue } from '../billing-queue/testing/recording-billing-queue.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import type { Charge } from './charge.js';
import { ChargeDunning } from './charge-dunning.js';
import { buildChargeDunning } from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';

describe('ChargeDunning', () => {
  const failedAt = new Date('2026-03-01T10:00:00.000Z');
  const dayMs = 24 * 60 * 60 * 1000;
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let queue: RecordingBillingQueue;
  let dunning: ChargeDunning;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    queue = new RecordingBillingQueue();
    dunning = buildChargeDunning(billing, new FixedClock(failedAt), queue);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedFailedCharge(retryCount: number): Promise<Charge> {
    const { subscription, charge } =
      await billing.createSubscriptionWithFirstCharge(
        {
          id: 'sub_1',
          customerId: 'cus_1',
          planId: 'plan_1',
          paymentMethod: 'card',
          status: 'incomplete',
          cardToken: 'tok_x',
          billingAnchor: failedAt,
          currentPeriodStart: failedAt,
          currentPeriodEnd: new Date(failedAt.getTime() + 30 * dayMs),
        },
        {
          id: 'ch_1',
          correlationId: 'cor_test_journey',
          subscriptionId: 'sub_1',
          amountCents: 1990,
          method: 'card',
          dueDate: failedAt,
          periodStart: failedAt,
          periodEnd: new Date(failedAt.getTime() + 30 * dayMs),
          gatewayAttemptKey: 'ch_1:1',
          attemptStartedAt: failedAt,
          retryCount,
        },
      );
    const recorded = await billing.recordChargeOutcome({
      charge: {
        id: charge.id,
        fromAnyOf: ['pending'],
        to: 'failed',
        gatewayChargeId: 'gch_1',
        paidAt: null,
        firstFailedAt: failedAt,
      },
      attempt: null,
      subscription: {
        id: subscription.id,
        change: { fromAnyOf: ['incomplete'], to: 'past_due' },
      },
    });
    return recorded.charge;
  }

  it('schedules the next retry of a failed charge at the calendar delay', async () => {
    const charge = await seedFailedCharge(0);
    const { subscription } = await subscriptions
      .findById('sub_1')
      .then((found) => ({ subscription: found! }));

    await dunning.afterSettlement({ charge, subscription });

    expect(queue.scheduled()).toEqual([
      {
        chargeId: 'ch_1',
        attempt: 1,
        delayMs: dayMs,
        correlationId: 'cor_test_journey',
      },
    ]);
  });

  it('schedules the same retry once when told twice', async () => {
    const charge = await seedFailedCharge(0);
    const subscription = (await subscriptions.findById('sub_1'))!;

    await dunning.afterSettlement({ charge, subscription });
    await dunning.afterSettlement({ charge, subscription });

    expect(queue.scheduled()).toHaveLength(1);
  });

  it('keeps the settlement and logs the context when the queue is down', async () => {
    const charge = await seedFailedCharge(1);
    const subscription = (await subscriptions.findById('sub_1'))!;
    queue.failure = new Error('redis down');

    await expect(
      dunning.afterSettlement({ charge, subscription }),
    ).resolves.toBe(false);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'charge ch_1 (subscription sub_1, retries made 1)',
      ),
      expect.stringContaining('redis down'),
    );
    expect(billing.charges()[0]).toMatchObject({ status: 'failed' });
  });

  it('makes the charge uncollectible and cancels the subscription after the third retry', async () => {
    const charge = await seedFailedCharge(3);
    const subscription = (await subscriptions.findById('sub_1'))!;

    const exhausted = await dunning.afterSettlement({ charge, subscription });

    expect(exhausted).toBe(true);
    expect(billing.charges()[0]).toMatchObject({ status: 'uncollectible' });
    expect((await subscriptions.findById('sub_1'))?.status).toBe('canceled');
    expect(queue.scheduled()).toEqual([]);
  });

  it('does not touch a charge settled as paid', async () => {
    const charge = await seedFailedCharge(0);
    const subscription = (await subscriptions.findById('sub_1'))!;

    await dunning.afterSettlement({
      charge: { ...charge, status: 'paid' },
      subscription,
    });

    expect(queue.scheduled()).toEqual([]);
  });

  it('queues a retry to run now numbered after the retries already made', async () => {
    const charge = await seedFailedCharge(1);

    await dunning.requestRetryNow(charge);

    expect(queue.scheduled()).toEqual([
      {
        chargeId: 'ch_1',
        attempt: 2,
        delayMs: 0,
        correlationId: 'cor_test_journey',
      },
    ]);
  });

  it('tags the job with the current correlation id for a charge that has none', async () => {
    const charge = await seedFailedCharge(1);

    await runWithCorrelationId('cor_request_0001', () =>
      dunning.requestRetryNow({ ...charge, correlationId: null }),
    );

    expect(queue.scheduled()[0]?.correlationId).toBe('cor_request_0001');
  });

  describe('payment events', () => {
    it('logs the exhaustion and the cancellation it causes', async () => {
      const charge = await seedFailedCharge(3);
      const subscription = (await subscriptions.findById('sub_1'))!;
      const recorded = recordPaymentEvents();

      await dunning.afterSettlement({ charge, subscription });

      expect(recorded).toEqual([
        expect.objectContaining({
          event: 'charge.dunning_exhausted',
          chargeId: 'ch_1',
          retryCount: 3,
        }),
        expect.objectContaining({
          event: 'subscription.status_changed',
          from: 'past_due',
          to: 'canceled',
          cause: 'charge.dunning_exhausted',
        }),
      ]);
    });

    it('logs a scheduled retry with when it will run', async () => {
      const charge = await seedFailedCharge(0);
      const subscription = (await subscriptions.findById('sub_1'))!;
      const recorded = recordPaymentEvents();

      await dunning.afterSettlement({ charge, subscription });

      expect(recorded).toEqual([
        expect.objectContaining({
          event: 'charge.retry.scheduled',
          chargeId: 'ch_1',
          subscriptionId: 'sub_1',
          attempt: 1,
          delayMs: dayMs,
          runAt: new Date(failedAt.getTime() + dayMs).toISOString(),
        }),
      ]);
    });

    it('logs a retry once when the same settlement is followed up twice', async () => {
      const charge = await seedFailedCharge(0);
      const subscription = (await subscriptions.findById('sub_1'))!;
      const recorded = recordPaymentEvents();

      await dunning.afterSettlement({ charge, subscription });
      await dunning.afterSettlement({ charge, subscription });

      expect(eventNames(recorded)).toEqual(['charge.retry.scheduled']);
    });

    it('logs a retry run now when it moves a retry already scheduled for later', async () => {
      const charge = await seedFailedCharge(0);
      const subscription = (await subscriptions.findById('sub_1'))!;
      await dunning.afterSettlement({ charge, subscription });
      const recorded = recordPaymentEvents();

      await dunning.requestRetryNow(charge);
      await dunning.requestRetryNow(charge);

      expect(recorded).toEqual([
        expect.objectContaining({
          event: 'charge.retry.scheduled',
          attempt: 1,
          delayMs: 0,
        }),
      ]);
    });

    it('logs no scheduled retry when the queue refuses it', async () => {
      const charge = await seedFailedCharge(0);
      const subscription = (await subscriptions.findById('sub_1'))!;
      queue.failure = new Error('redis down');
      const recorded = recordPaymentEvents();

      await dunning.afterSettlement({ charge, subscription });

      expect(eventNames(recorded)).toEqual([]);
    });
  });
});
