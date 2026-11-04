import { GatewayUnavailableError } from '../../gateway/index.js';
import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { ChargeProcessor } from '../charges/charge-processor.js';
import { InMemoryBillingRepository } from '../charges/testing/in-memory-billing.repository.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import type { PlanInterval } from '../plans/plan.js';
import { InMemoryPlansRepository } from '../plans/testing/in-memory-plans.repository.js';
import { InvalidTransitionError } from './domain/index.js';
import {
  SubscriptionsService,
  type CreateSubscriptionInput,
} from './subscriptions.service.js';
import { InMemorySubscriptionsRepository } from './testing/in-memory-subscriptions.repository.js';

describe('SubscriptionsService', () => {
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let customers: InMemoryCustomersRepository;
  let plans: InMemoryPlansRepository;
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let gateway: StubPaymentGateway;
  let clock: FixedClock;
  let service: SubscriptionsService;

  beforeEach(() => {
    customers = new InMemoryCustomersRepository();
    plans = new InMemoryPlansRepository();
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    gateway = new StubPaymentGateway();
    clock = new FixedClock(startedAt);
    service = new SubscriptionsService(
      subscriptions,
      billing,
      customers,
      plans,
      gateway,
      clock,
      new ChargeProcessor(billing, gateway, clock),
    );
  });

  async function seed(interval: PlanInterval = 'monthly') {
    const customer = await customers.create({
      id: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
    });
    const plan = await plans.create({
      id: 'plan_1',
      name: 'Basic',
      amountCents: 1990,
      interval,
    });
    return { customer, plan };
  }

  const cardInput = {
    customerId: 'cus_1',
    planId: 'plan_1',
    paymentMethod: 'card',
    cardToken: 'tok_success',
  } as const satisfies CreateSubscriptionInput;

  const pixInput = {
    customerId: 'cus_1',
    planId: 'plan_1',
    paymentMethod: 'pix',
  } as const satisfies CreateSubscriptionInput;

  describe('create with card', () => {
    it('charges the first period and activates the subscription when paid', async () => {
      await seed();

      const { subscription, latestCharge } = await service.create(cardInput);

      expect(subscription).toMatchObject({
        customerId: 'cus_1',
        planId: 'plan_1',
        paymentMethod: 'card',
        status: 'active',
        cardToken: 'tok_success',
        canceledAt: null,
        billingAnchor: startedAt,
        currentPeriodStart: startedAt,
        currentPeriodEnd: new Date('2026-02-28T10:30:00.000Z'),
      });
      expect(subscription.id).toMatch(/^sub_[0-9a-z]{26}$/);
      expect(latestCharge).toEqual({
        id: expect.stringMatching(/^ch_[0-9a-z]{26}$/),
        status: 'paid',
        amountCents: 1990,
        failureReason: null,
      });
    });

    it('persists the paid charge for the subscription period with its attempt', async () => {
      await seed();

      const { subscription, latestCharge } = await service.create(cardInput);

      const [charge] = billing.charges();
      expect(charge).toMatchObject({
        id: latestCharge?.id,
        subscriptionId: subscription.id,
        amountCents: 1990,
        method: 'card',
        status: 'paid',
        attemptCount: 1,
        nextRetryAt: null,
        dueDate: startedAt,
        periodStart: startedAt,
        periodEnd: new Date('2026-02-28T10:30:00.000Z'),
        paidAt: startedAt,
        gatewayChargeId: expect.stringMatching(/^gch_/),
      });
      expect(billing.attempts()).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^pa_[0-9a-z]{26}$/),
          chargeId: charge?.id,
          gatewayChargeId: charge?.gatewayChargeId,
          result: 'succeeded',
          failureReason: null,
        }),
      ]);
    });

    it('sends the charge to the gateway with the charge id as external reference', async () => {
      await seed();

      const { latestCharge } = await service.create(cardInput);

      expect(gateway.chargesRequested).toEqual([
        {
          gatewayCustomerId: expect.stringMatching(/^gcus_/),
          amountCents: 1990,
          method: 'card',
          cardToken: 'tok_success',
          externalRef: latestCharge?.id,
          idempotencyKey: `${latestCharge?.id}:1`,
        },
      ]);
    });

    it('moves to past_due and records the declined attempt when the card is declined', async () => {
      await seed();
      gateway.respondWith({
        status: 'failed',
        failureReason: 'insufficient_funds',
      });

      const { subscription, latestCharge } = await service.create(cardInput);

      expect(subscription.status).toBe('past_due');
      expect(latestCharge).toMatchObject({
        status: 'failed',
        failureReason: 'insufficient_funds',
      });
      expect(billing.charges()).toEqual([
        expect.objectContaining({
          status: 'failed',
          attemptCount: 1,
          paidAt: null,
        }),
      ]);
      expect(billing.attempts()).toEqual([
        expect.objectContaining({
          result: 'declined',
          failureReason: 'insufficient_funds',
        }),
      ]);
    });

    it('creates the gateway customer once and persists its id', async () => {
      await seed();
      await service.create(cardInput);
      await service.create(cardInput);

      expect(gateway.customersRequested).toEqual([
        { externalRef: 'cus_1', name: 'Ana', email: 'ana@example.com' },
      ]);
      const [first, second] = gateway.chargesRequested;
      expect(first?.gatewayCustomerId).toBe(second?.gatewayCustomerId);
      expect((await customers.findById('cus_1'))?.gatewayCustomerId).toBe(
        first?.gatewayCustomerId,
      );
    });

    it('reuses the gateway customer the customer already has', async () => {
      await seed();
      await customers.assignGatewayCustomerId('cus_1', 'gcus_existing');

      await service.create(cardInput);

      expect(gateway.customersRequested).toEqual([]);
      expect(gateway.chargesRequested[0]?.gatewayCustomerId).toBe(
        'gcus_existing',
      );
    });

    it('answers ServiceUnavailableError and creates nothing when the gateway customer cannot be created', async () => {
      await seed();
      gateway.failCustomerCreationWith(new GatewayUnavailableError('down'));

      await expect(service.create(cardInput)).rejects.toThrow(
        ServiceUnavailableError,
      );

      expect(billing.charges()).toEqual([]);
      expect((await customers.findById('cus_1'))?.gatewayCustomerId).toBeNull();
    });

    it('rethrows unexpected gateway customer errors', async () => {
      await seed();
      gateway.failCustomerCreationWith(new Error('boom'));

      await expect(service.create(cardInput)).rejects.toThrow('boom');
    });

    it('keeps the subscription incomplete and the charge pending when the gateway is unavailable', async () => {
      await seed();
      gateway.failChargeCreationWith(new GatewayUnavailableError('down'));

      const { subscription, latestCharge } = await service.create(cardInput);

      expect(subscription.status).toBe('incomplete');
      expect(latestCharge).toEqual({
        id: expect.stringMatching(/^ch_/),
        status: 'pending',
        amountCents: 1990,
        failureReason: null,
      });
      expect(billing.charges()).toEqual([
        expect.objectContaining({ status: 'pending', attemptCount: 0 }),
      ]);
      expect(billing.attempts()).toEqual([]);
    });

    it('keeps the charge pending when the gateway has not decided yet', async () => {
      await seed();
      gateway.respondWith({ status: 'pending' });

      const { subscription, latestCharge } = await service.create(cardInput);

      expect(subscription.status).toBe('incomplete');
      expect(latestCharge?.status).toBe('pending');
      expect(billing.attempts()).toEqual([]);
    });

    it('rethrows unexpected gateway charge errors leaving the charge pending', async () => {
      await seed();
      gateway.failChargeCreationWith(new Error('boom'));

      await expect(service.create(cardInput)).rejects.toThrow('boom');

      expect(billing.charges()).toEqual([
        expect.objectContaining({ status: 'pending' }),
      ]);
    });

    it('still records the charge when the subscription was canceled while the gateway answered', async () => {
      await seed();
      const original = gateway.createCharge.bind(gateway);
      vi.spyOn(gateway, 'createCharge').mockImplementationOnce(
        async (input) => {
          await subscriptions.changeStatus(
            billing.charges()[0]!.subscriptionId,
            {
              fromAnyOf: ['incomplete'],
              to: 'canceled',
              canceledAt: startedAt,
            },
          );
          return original(input);
        },
      );

      const { subscription, latestCharge } = await service.create(cardInput);

      expect(subscription.status).toBe('canceled');
      expect(latestCharge?.status).toBe('paid');
    });

    it('rejects an unknown customer with NotFoundError', async () => {
      await seed();

      await expect(
        service.create({ ...cardInput, customerId: 'cus_missing' }),
      ).rejects.toThrow(new NotFoundError('Customer cus_missing not found'));
      expect(gateway.customersRequested).toEqual([]);
    });

    it('rejects an unknown plan with NotFoundError', async () => {
      await seed();

      await expect(
        service.create({ ...cardInput, planId: 'plan_missing' }),
      ).rejects.toThrow(new NotFoundError('Plan plan_missing not found'));
    });

    it('rejects an inactive plan with UnprocessableError before touching the gateway', async () => {
      await seed();
      plans.deactivate('plan_1');

      await expect(service.create(cardInput)).rejects.toBeInstanceOf(
        UnprocessableError,
      );
      expect(gateway.customersRequested).toEqual([]);
    });

    it('computes a yearly period end from the plan interval', async () => {
      await seed('yearly');

      const { subscription, latestCharge } = await service.create(cardInput);

      expect(subscription.currentPeriodEnd).toEqual(
        new Date('2027-01-31T10:30:00.000Z'),
      );
      expect(billing.charges()[0]).toMatchObject({
        id: latestCharge?.id,
        periodEnd: new Date('2027-01-31T10:30:00.000Z'),
      });
    });
  });

  describe.each(['pix', 'boleto'] as const)('create with %s', (method) => {
    const input = { ...pixInput, paymentMethod: method };

    it('creates an incomplete subscription without a charge or card token', async () => {
      await seed();

      const { subscription, latestCharge } = await service.create(input);

      expect(subscription).toMatchObject({
        paymentMethod: method,
        status: 'incomplete',
        cardToken: null,
        billingAnchor: startedAt,
      });
      expect(latestCharge).toBeNull();
      expect(billing.charges()).toEqual([]);
      expect(gateway.customersRequested).toEqual([]);
      expect(gateway.chargesRequested).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns the subscription', async () => {
      await seed();
      const { subscription } = await service.create(pixInput);

      await expect(service.getById(subscription.id)).resolves.toMatchObject({
        id: subscription.id,
      });
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(service.getById('sub_missing')).rejects.toThrow(
        new NotFoundError('Subscription sub_missing not found'),
      );
    });
  });

  describe('cancel', () => {
    it('cancels and stamps canceledAt from the clock', async () => {
      await seed();
      const { subscription } = await service.create(pixInput);
      const canceledAt = new Date('2026-02-10T00:00:00.000Z');
      clock.set(canceledAt);

      const canceled = await service.cancel(subscription.id);

      expect(canceled).toMatchObject({
        id: subscription.id,
        status: 'canceled',
        canceledAt,
      });
      await expect(service.getById(subscription.id)).resolves.toMatchObject({
        status: 'canceled',
      });
    });

    it('rejects cancelling twice via the transition rule', async () => {
      await seed();
      const { subscription } = await service.create(pixInput);
      await service.cancel(subscription.id);

      await expect(service.cancel(subscription.id)).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(service.cancel('sub_missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('cancels when the status moved to another cancellable one after it was read', async () => {
      await seed();
      const { subscription } = await service.create(pixInput);
      const staleRead = { ...subscription, status: 'active' as const };
      await subscriptions.changeStatus(subscription.id, {
        fromAnyOf: ['incomplete'],
        to: 'past_due',
      });
      vi.spyOn(subscriptions, 'findById').mockResolvedValueOnce(staleRead);

      await expect(service.cancel(subscription.id)).resolves.toMatchObject({
        status: 'canceled',
      });
    });

    it('answers ConflictError when the status changed after it was read', async () => {
      await seed();
      const { subscription } = await service.create(pixInput);
      vi.spyOn(subscriptions, 'changeStatus').mockResolvedValueOnce(null);

      await expect(service.cancel(subscription.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });
});
