import { Logger } from '@nestjs/common';
import { statusChangeTo } from '../subscriptions/testing/status-change-to.js';
import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/errors/index.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import type { ChargeStatus } from './charge-status.js';
import { runWithCorrelationId } from '../../shared/correlation/index.js';
import { correlationIdsSeenBy } from '../../shared/correlation/testing/correlation-ids-seen-by.js';
import { ChargesService } from './charges.service.js';
import { InvalidTransitionError } from '../subscriptions/domain/index.js';
import { InvalidChargeTransitionError } from './domain/index.js';
import { RecordingBillingQueue } from '../billing-queue/testing/recording-billing-queue.js';
import {
  buildChargeDunning,
  buildChargeProcessor,
} from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';
import { InMemoryChargesRepository } from './testing/in-memory-charges.repository.js';

describe('ChargesService', () => {
  const retriedAt = new Date('2026-02-10T09:00:00.000Z');
  const periodStart = new Date('2026-01-31T10:30:00.000Z');
  const periodEnd = new Date('2026-02-28T10:30:00.000Z');
  let customers: InMemoryCustomersRepository;
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let gateway: StubPaymentGateway;
  let clock: FixedClock;
  let queue: RecordingBillingQueue;
  let service: ChargesService;

  beforeEach(() => {
    customers = new InMemoryCustomersRepository();
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    gateway = new StubPaymentGateway();
    clock = new FixedClock(retriedAt);
    queue = new RecordingBillingQueue();
    service = new ChargesService(
      new InMemoryChargesRepository(billing, subscriptions),
      customers,
      buildChargeProcessor({
        billing,
        subscriptions,
        customers,
        gateway,
        clock,
        queue,
      }),
      buildChargeDunning(billing, clock, queue),
    );
  });

  async function seedCustomer(id = 'cus_1', withGatewayCustomer = true) {
    await customers.create({ id, name: 'Ana', email: `${id}@example.com` });
    if (withGatewayCustomer) {
      await customers.assignGatewayCustomerId(id, `gcus_${id}`);
    }
  }

  async function seedCharge({
    customerId = 'cus_1',
    chargeId = 'ch_1',
    chargeStatus = 'failed',
    subscriptionStatus = 'past_due',
    retryCount = 0,
  }: {
    customerId?: string;
    chargeId?: string;
    chargeStatus?: ChargeStatus;
    subscriptionStatus?: SubscriptionStatus;
    retryCount?: number;
  } = {}) {
    const subscriptionId = `sub_${chargeId}`;
    await billing.createSubscriptionWithFirstCharge(
      {
        id: subscriptionId,
        customerId,
        planId: 'plan_1',
        paymentMethod: 'card',
        status: 'incomplete',
        cardToken: 'tok_success',
        billingAnchor: periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      {
        id: chargeId,
        correlationId: 'cor_test_journey',
        subscriptionId,
        amountCents: 1990,
        method: 'card',
        dueDate: periodStart,
        periodStart,
        periodEnd,
        gatewayAttemptKey: `${chargeId}:1`,
        attemptStartedAt: periodStart,
        retryCount,
      },
    );
    if (chargeStatus === 'failed' || chargeStatus === 'paid') {
      const declined = chargeStatus === 'failed';
      await billing.recordChargeOutcome({
        charge: {
          id: chargeId,
          fromAnyOf: ['pending'],
          to: chargeStatus,
          gatewayChargeId: `gch_${chargeId}`,
          paidAt: declined ? null : periodStart,
        },
        attempt: {
          id: `pa_${chargeId}`,
          chargeId,
          gatewayChargeId: `gch_${chargeId}`,
          result: declined ? 'declined' : 'succeeded',
          failureReason: declined ? 'insufficient_funds' : null,
        },
        subscription: {
          id: subscriptionId,
          change: {
            fromAnyOf: ['incomplete'],
            to: declined ? 'past_due' : 'active',
          },
        },
      });
    }
    if (subscriptionStatus !== 'past_due') {
      await subscriptions.changeStatus(
        subscriptionId,
        statusChangeTo('past_due', subscriptionStatus),
      );
    }
    return { subscriptionId, chargeId };
  }

  describe('listByCustomer', () => {
    it('rejects an unknown customer', async () => {
      await expect(
        service.listByCustomer('cus_missing', { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('lists only the customer charges across subscriptions, newest first, with attempts', async () => {
      await seedCustomer('cus_1');
      await seedCustomer('cus_2');
      await seedCharge({ chargeId: 'ch_1' });
      await seedCharge({ chargeId: 'ch_2' });
      await seedCharge({ customerId: 'cus_2', chargeId: 'ch_3' });

      const { data, meta } = await service.listByCustomer('cus_1', {
        page: 1,
        limit: 20,
      });

      expect(data.map(({ id }) => id)).toEqual(['ch_2', 'ch_1']);
      expect(data[0]?.attempts).toEqual([
        expect.objectContaining({ id: 'pa_ch_2', result: 'declined' }),
      ]);
      expect(meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it('paginates the history', async () => {
      await seedCustomer();
      await seedCharge({ chargeId: 'ch_1' });
      await seedCharge({ chargeId: 'ch_2' });
      await seedCharge({ chargeId: 'ch_3' });

      const { data, meta } = await service.listByCustomer('cus_1', {
        page: 2,
        limit: 2,
      });

      expect(data.map(({ id }) => id)).toEqual(['ch_1']);
      expect(meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('returns an empty page for a customer without charges', async () => {
      await seedCustomer();

      const { data, meta } = await service.listByCustomer('cus_1', {
        page: 1,
        limit: 20,
      });

      expect(data).toEqual([]);
      expect(meta.total).toBe(0);
    });
  });

  describe('retry', () => {
    it('rejects an unknown charge', async () => {
      await expect(service.retry('ch_missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('queues the next dunning retry to run now and leaves the failed charge untouched', async () => {
      await seedCustomer();
      const { subscriptionId } = await seedCharge();

      const { charge, subscription, queued } = await service.retry('ch_1');

      expect(queued).toBe(true);
      expect(queue.scheduled()).toEqual([
        {
          chargeId: 'ch_1',
          attempt: 1,
          delayMs: 0,
          correlationId: 'cor_test_journey',
        },
      ]);
      expect(charge).toMatchObject({ id: 'ch_1', status: 'failed' });
      expect(subscription).toMatchObject({
        id: subscriptionId,
        status: 'past_due',
      });
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('queues the attempt that follows the retries already made', async () => {
      await seedCustomer();
      await seedCharge({ retryCount: 2 });

      await service.retry('ch_1');

      expect(queue.scheduled()).toEqual([
        {
          chargeId: 'ch_1',
          attempt: 3,
          delayMs: 0,
          correlationId: 'cor_test_journey',
        },
      ]);
    });

    it('queues a retry for a failed charge of an active subscription', async () => {
      await seedCustomer();
      await seedCharge({ subscriptionStatus: 'active' });

      const { queued } = await service.retry('ch_1');

      expect(queued).toBe(true);
    });

    it('queues the same job when asked twice', async () => {
      await seedCustomer();
      await seedCharge();

      await service.retry('ch_1');
      await service.retry('ch_1');

      expect(queue.scheduled()).toHaveLength(1);
    });

    it('rejects a charge that used all its dunning retries', async () => {
      await seedCustomer();
      await seedCharge({ retryCount: 3 });

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(ConflictError);
      expect(queue.scheduled()).toEqual([]);
    });

    it('answers service unavailable and queues nothing when the queue is down', async () => {
      await seedCustomer();
      await seedCharge();
      queue.failure = new Error('redis down');
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    });

    async function expire(chargeId: string, subscriptionId: string) {
      await billing.recordChargeOutcome({
        charge: {
          id: chargeId,
          fromAnyOf: ['failed'],
          to: 'expired',
          gatewayChargeId: null,
          paidAt: null,
        },
        attempt: null,
        subscription: { id: subscriptionId, change: null },
      });
    }

    it('queues the reissue of an expired charge like the dunning would', async () => {
      await seedCustomer();
      const { chargeId, subscriptionId } = await seedCharge();
      await expire(chargeId, subscriptionId);

      const result = await service.retry(chargeId);

      expect(result.queued).toBe(true);
      expect(queue.scheduled()).toEqual([
        { chargeId, attempt: 1, delayMs: 0, correlationId: 'cor_test_journey' },
      ]);
    });

    it('rejects retrying an expired charge a newer charge of its period superseded', async () => {
      await seedCustomer();
      const { chargeId, subscriptionId } = await seedCharge();
      await expire(chargeId, subscriptionId);
      await billing.createPeriodCharge({
        id: 'ch_newer',
        correlationId: 'cor_test_journey',
        subscriptionId,
        amountCents: 1990,
        method: 'card',
        dueDate: periodStart,
        periodStart,
        periodEnd,
        gatewayAttemptKey: 'ch_newer:1',
        attemptStartedAt: periodStart,
        retryCount: 1,
      });

      await expect(service.retry(chargeId)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(queue.scheduled()).toEqual([]);
    });

    it('rejects retrying a paid charge without queueing', async () => {
      await seedCustomer();
      await seedCharge({
        chargeStatus: 'paid',
        subscriptionStatus: 'incomplete',
      });

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(
        InvalidChargeTransitionError,
      );
      expect(queue.scheduled()).toEqual([]);
    });

    it('rejects retrying a charge of a canceled subscription without queueing', async () => {
      await seedCustomer();
      await seedCharge({ subscriptionStatus: 'canceled' });

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
      expect(queue.scheduled()).toEqual([]);
    });

    it('reconciles a pending charge whose lease expired inline instead of queueing', async () => {
      await seedCustomer();
      await seedCharge({
        chargeStatus: 'pending',
        subscriptionStatus: 'incomplete',
      });

      const { charge, subscription, queued } = await service.retry('ch_1');

      expect(queued).toBe(false);
      expect(charge.status).toBe('paid');
      expect(subscription.status).toBe('active');
      expect(gateway.chargesRequested).toHaveLength(1);
      expect(queue.scheduled()).toEqual([]);
    });

    it('rejects retrying a pending charge still within its lease as in flight', async () => {
      await seedCustomer();
      await seedCharge({
        chargeStatus: 'pending',
        subscriptionStatus: 'incomplete',
      });
      clock.set(periodStart);

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(ConflictError);
      expect(gateway.chargesRequested).toEqual([]);
    });
  });

  describe('correlation', () => {
    it('reconciles a pending charge within its correlation id and links the request to it', async () => {
      await seedCustomer();
      await seedCharge({
        chargeStatus: 'pending',
        subscriptionStatus: 'incomplete',
      });
      const log = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const seen = correlationIdsSeenBy(gateway, 'createCharge');

      await runWithCorrelationId('cor_request_0001', () =>
        service.retry('ch_1'),
      );

      expect(seen).toEqual(['cor_test_journey']);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeId: 'ch_1',
          requestCorrelationId: 'cor_request_0001',
        }),
      );
    });
  });
});
