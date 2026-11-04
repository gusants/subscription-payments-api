import { GatewayUnavailableError } from '../../gateway/index.js';
import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import type { ChargeStatus } from './charge-status.js';
import { ChargesService } from './charges.service.js';
import { InvalidTransitionError } from '../subscriptions/domain/index.js';
import { InvalidChargeTransitionError } from './domain/index.js';
import { buildChargeProcessor } from './testing/build-charge-processor.js';
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
  let service: ChargesService;

  beforeEach(() => {
    customers = new InMemoryCustomersRepository();
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    gateway = new StubPaymentGateway();
    clock = new FixedClock(retriedAt);
    service = new ChargesService(
      new InMemoryChargesRepository(billing, subscriptions),
      customers,
      buildChargeProcessor({
        billing,
        subscriptions,
        customers,
        gateway,
        clock,
      }),
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
  }: {
    customerId?: string;
    chargeId?: string;
    chargeStatus?: ChargeStatus;
    subscriptionStatus?: SubscriptionStatus;
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
        subscriptionId,
        amountCents: 1990,
        method: 'card',
        dueDate: periodStart,
        periodStart,
        periodEnd,
        gatewayAttemptKey: `${chargeId}:1`,
        attemptStartedAt: periodStart,
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
      await subscriptions.changeStatus(subscriptionId, {
        fromAnyOf: ['past_due'],
        to: subscriptionStatus,
      });
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

    it('pays the charge and reactivates the subscription when the gateway approves', async () => {
      await seedCustomer();
      const { subscriptionId } = await seedCharge();

      const { charge, subscription } = await service.retry('ch_1');

      expect(charge).toMatchObject({
        id: 'ch_1',
        status: 'paid',
        attemptCount: 2,
        paidAt: retriedAt,
      });
      expect(charge.attempts.map(({ result }) => result)).toEqual([
        'declined',
        'succeeded',
      ]);
      expect(subscription).toMatchObject({
        id: subscriptionId,
        status: 'active',
      });
    });

    it('charges the stored card token for the customer gateway account using the charge id as reference', async () => {
      await seedCustomer();
      await seedCharge();

      await service.retry('ch_1');

      expect(gateway.chargesRequested).toEqual([
        {
          gatewayCustomerId: 'gcus_cus_1',
          amountCents: 1990,
          method: 'card',
          cardToken: 'tok_success',
          externalRef: 'ch_1',
          idempotencyKey: 'ch_1:2',
        },
      ]);
    });

    it('returns the charge to failed, records the reason and keeps the subscription past_due when declined again', async () => {
      await seedCustomer();
      await seedCharge();
      gateway.respondWith({ status: 'failed', failureReason: 'expired_card' });

      const { charge, subscription } = await service.retry('ch_1');

      expect(charge).toMatchObject({
        status: 'failed',
        attemptCount: 2,
        paidAt: null,
      });
      expect(charge.attempts[1]).toMatchObject({
        result: 'declined',
        failureReason: 'expired_card',
      });
      expect(subscription.status).toBe('past_due');
    });

    it('keeps an active subscription active when the retried charge is paid', async () => {
      await seedCustomer();
      await seedCharge({ subscriptionStatus: 'active' });

      const { subscription } = await service.retry('ch_1');

      expect(subscription.status).toBe('active');
    });

    it('rejects retrying a paid charge without calling the gateway', async () => {
      await seedCustomer();
      await seedCharge({
        chargeStatus: 'paid',
        subscriptionStatus: 'incomplete',
      });

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(
        InvalidChargeTransitionError,
      );
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('reconciles a pending charge whose lease expired instead of rejecting it', async () => {
      await seedCustomer();
      await seedCharge({
        chargeStatus: 'pending',
        subscriptionStatus: 'incomplete',
      });

      const { charge, subscription } = await service.retry('ch_1');

      expect(charge.status).toBe('paid');
      expect(subscription.status).toBe('active');
      expect(gateway.chargesRequested).toHaveLength(1);
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

    it('rejects retrying a charge of a canceled subscription without calling the gateway', async () => {
      await seedCustomer();
      await seedCharge({ subscriptionStatus: 'canceled' });

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('rejects a customer that has no gateway account', async () => {
      await seedCustomer('cus_1', false);
      await seedCharge();

      await expect(service.retry('ch_1')).rejects.toBeInstanceOf(
        UnprocessableError,
      );
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('lets only one of two concurrent retries reach the gateway', async () => {
      await seedCustomer();
      await seedCharge();

      const results = await Promise.allSettled([
        service.retry('ch_1'),
        service.retry('ch_1'),
      ]);

      expect(results.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('leaves the charge pending for reconciliation when the gateway is unavailable', async () => {
      await seedCustomer();
      await seedCharge();
      gateway.failChargeCreationWith(new GatewayUnavailableError('down'));

      const { charge, subscription } = await service.retry('ch_1');

      expect(charge).toMatchObject({ status: 'pending', attemptCount: 1 });
      expect(charge.attempts).toHaveLength(1);
      expect(subscription.status).toBe('past_due');
    });
  });
});
