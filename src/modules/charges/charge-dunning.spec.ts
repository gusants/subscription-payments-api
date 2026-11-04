import { Logger } from '@nestjs/common';
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
      { chargeId: 'ch_1', attempt: 1, delayMs: dayMs },
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
      { chargeId: 'ch_1', attempt: 2, delayMs: 0 },
    ]);
  });
});
