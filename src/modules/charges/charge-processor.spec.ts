import { Logger } from '@nestjs/common';
import {
  GatewayCustomerNotFoundError,
  GatewayOutcomeUnknownError,
  GatewayUnavailableError,
} from '../../gateway/index.js';
import {
  STUB_EXPIRES_AT,
  StubPaymentGateway,
} from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import { InvalidTransitionError } from '../subscriptions/domain/index.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import type { AttemptTarget } from './charge-processor.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargeSettlementConflictError } from './charge-settlement-conflict.error.js';
import { InvalidChargeTransitionError } from './domain/index.js';
import {
  buildChargeProcessor,
  TEST_ATTEMPT_LEASE_MS,
} from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';

describe('ChargeProcessor', () => {
  const periodStart = new Date('2026-01-31T10:30:00.000Z');
  const periodEnd = new Date('2026-02-28T10:30:00.000Z');
  const afterLease = new Date(
    periodStart.getTime() + TEST_ATTEMPT_LEASE_MS + 1,
  );
  const withinLease = new Date(periodStart.getTime() + TEST_ATTEMPT_LEASE_MS);
  let billing: InMemoryBillingRepository;
  let subscriptions: InMemorySubscriptionsRepository;
  let customers: InMemoryCustomersRepository;
  let gateway: StubPaymentGateway;
  let clock: FixedClock;
  let processor: ChargeProcessor;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    customers = new InMemoryCustomersRepository();
    gateway = new StubPaymentGateway();
    clock = new FixedClock(periodStart);
    processor = buildChargeProcessor({
      billing,
      subscriptions,
      customers,
      gateway,
      clock,
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seed(
    cardToken: string | null = 'tok_success',
    method: 'card' | 'pix' | 'boleto' = 'card',
  ) {
    await customers.create({ id: 'cus_1', name: 'Ana', email: 'ana@e.com' });
    await customers.assignGatewayCustomerId('cus_1', 'gcus_1');
    const { subscription, charge } =
      await billing.createSubscriptionWithFirstCharge(
        {
          id: 'sub_1',
          customerId: 'cus_1',
          planId: 'plan_1',
          paymentMethod: method,
          status: 'incomplete',
          cardToken,
          billingAnchor: periodStart,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
        {
          id: 'ch_1',
          subscriptionId: 'sub_1',
          amountCents: 1990,
          method,
          dueDate: periodStart,
          periodStart,
          periodEnd,
          gatewayAttemptKey: 'ch_1:1',
          attemptStartedAt: periodStart,
        },
      );
    const customer = await customers.findById('cus_1');
    return {
      charge,
      target: {
        charge,
        subscription: {
          ...subscription,
          paymentMethod: method,
          cardToken: cardToken ?? '',
        },
        customer: { ...customer!, gatewayCustomerId: 'gcus_1' },
      } satisfies AttemptTarget,
    };
  }

  const storedCharge = () => billing.charges()[0]!;

  describe('process', () => {
    it('settles an approved charge, activates the subscription and stores the gateway charge', async () => {
      const { target } = await seed();

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('paid');
      expect(processed.subscription.status).toBe('active');
      expect(processed.failureReason).toBeNull();
      expect(storedCharge().gatewayChargeId).toBe(
        [...gateway.chargesProcessed.values()][0]?.id,
      );
    });

    it('answers with the settled state when a webhook settled the same outcome during the gateway call', async () => {
      const { target } = await seed();
      const createCharge = gateway.createCharge.bind(gateway);
      vi.spyOn(gateway, 'createCharge').mockImplementation(async (input) => {
        const created = await createCharge(input);
        await billing.recordChargeOutcome({
          charge: {
            id: 'ch_1',
            fromAnyOf: ['pending'],
            to: 'paid',
            gatewayChargeId: created.id,
            paidAt: periodStart,
          },
          attempt: {
            id: 'att_webhook',
            chargeId: 'ch_1',
            gatewayChargeId: created.id,
            result: 'succeeded',
            failureReason: null,
          },
          subscription: {
            id: 'sub_1',
            change: { fromAnyOf: ['incomplete'], to: 'active' },
          },
        });
        return created;
      });

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('paid');
      expect(processed.subscription.status).toBe('active');
      expect(billing.attempts()).toHaveLength(1);
      expect(storedCharge().attemptCount).toBe(1);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('rejects with a conflict when the charge was settled differently during the gateway call', async () => {
      const { target } = await seed();
      const createCharge = gateway.createCharge.bind(gateway);
      vi.spyOn(gateway, 'createCharge').mockImplementation(async (input) => {
        const created = await createCharge(input);
        await billing.recordChargeOutcome({
          charge: {
            id: 'ch_1',
            fromAnyOf: ['pending'],
            to: 'paid',
            gatewayChargeId: 'gch_other',
            paidAt: periodStart,
          },
          attempt: null,
          subscription: { id: 'sub_1', change: null },
        });
        return created;
      });

      const rejection = processor.process(target);

      await expect(rejection).rejects.toBeInstanceOf(ConflictError);
      await expect(rejection).rejects.toMatchObject({ transient: true });
    });

    it('stores the payment instant reported by the gateway', async () => {
      const { target } = await seed();
      const paidAt = new Date('2026-01-31T10:30:07.000Z');
      gateway.respondWith({ status: 'paid', paidAt });

      await processor.process(target);

      expect(storedCharge().paidAt).toEqual(paidAt);
    });

    it('falls back to the clock when the gateway reports no payment instant', async () => {
      const { target } = await seed();

      await processor.process(target);

      expect(storedCharge().paidAt).toEqual(periodStart);
    });

    it('sends the persisted attempt key as the idempotency key', async () => {
      const { target } = await seed();

      await processor.process(target);

      expect(gateway.chargesRequested).toEqual([
        expect.objectContaining({
          gatewayCustomerId: 'gcus_1',
          externalRef: 'ch_1',
          idempotencyKey: 'ch_1:1',
          cardToken: 'tok_success',
        }),
      ]);
    });

    it('exposes the failure reason of a declined charge', async () => {
      const { target } = await seed('tok_insufficient_funds');
      gateway.respondWith({
        status: 'failed',
        failureReason: 'insufficient_funds',
      });

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('failed');
      expect(processed.subscription.status).toBe('past_due');
      expect(processed.failureReason).toBe('insufficient_funds');
    });

    it('keeps the charge pending but stores the gateway charge when the gateway answers pending', async () => {
      const { target } = await seed();
      gateway.respondWith({ status: 'pending' });

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('pending');
      expect(storedCharge()).toMatchObject({
        status: 'pending',
        gatewayChargeId: [...gateway.chargesProcessed.values()][0]?.id,
        gatewayAttemptKey: 'ch_1:1',
      });
      expect(billing.attempts()).toEqual([]);
    });

    it.each([
      ['GatewayUnavailableError', new GatewayUnavailableError('down')],
      ['GatewayOutcomeUnknownError', new GatewayOutcomeUnknownError('timeout')],
    ])('leaves the charge pending and recoverable on %s', async (_, error) => {
      const { target } = await seed();
      gateway.failChargeCreationWith(error);

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('pending');
      expect(processed.subscription.status).toBe('incomplete');
      expect(storedCharge()).toMatchObject({
        status: 'pending',
        gatewayAttemptKey: 'ch_1:1',
        attemptStartedAt: periodStart,
      });
      expect(billing.attempts()).toEqual([]);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it.each([
      ['an Error', new Error('EACCES')],
      ['a non-Error value', 'boom' as unknown as Error],
    ])(
      'leaves the charge pending and logs when the gateway throws %s',
      async (_, error) => {
        const { target } = await seed();
        gateway.failChargeCreationWith(error);

        const processed = await processor.process(target);

        expect(processed.charge.status).toBe('pending');
        expect(errorLog).toHaveBeenCalledOnce();
      },
    );

    it('recreates a missing gateway customer once and re-sends with the same key', async () => {
      const { target } = await seed();
      gateway.failChargeCreationWith(
        new GatewayCustomerNotFoundError('gcus_1'),
        {
          times: 1,
        },
      );

      const processed = await processor.process(target);

      const recreated = (await customers.findById('cus_1'))?.gatewayCustomerId;
      expect(processed.charge.status).toBe('paid');
      expect(gateway.customersRequested).toEqual([
        { externalRef: 'cus_1', name: 'Ana', email: 'ana@e.com' },
      ]);
      expect(recreated).not.toBe('gcus_1');
      expect(
        gateway.chargesRequested.map(({ idempotencyKey }) => idempotencyKey),
      ).toEqual(['ch_1:1', 'ch_1:1']);
      expect(gateway.chargesRequested[1]?.gatewayCustomerId).toBe(recreated);
    });

    it('leaves the charge pending when the customer is still missing after the recreation', async () => {
      const { target } = await seed();
      gateway.failChargeCreationWith(
        new GatewayCustomerNotFoundError('gcus_1'),
      );

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('pending');
      expect(gateway.chargesRequested).toHaveLength(2);
    });

    it('leaves the charge pending when the gateway customer cannot be recreated', async () => {
      const { target } = await seed();
      gateway.failChargeCreationWith(
        new GatewayCustomerNotFoundError('gcus_1'),
      );
      gateway.failCustomerCreationWith(new GatewayUnavailableError('down'));

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('pending');
      expect(gateway.chargesRequested).toHaveLength(1);
      expect((await customers.findById('cus_1'))?.gatewayCustomerId).toBe(
        'gcus_1',
      );
    });

    it('records the charge and logs an error when the subscription was canceled meanwhile', async () => {
      const { target } = await seed();
      await subscriptions.changeStatus('sub_1', {
        fromAnyOf: ['incomplete'],
        to: 'canceled',
        canceledAt: periodStart,
      });

      const processed = await processor.process(target);

      expect(processed.charge.status).toBe('paid');
      expect(processed.subscription.status).toBe('canceled');
      expect(billing.attempts()).toHaveLength(1);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringMatching(/ch_1.*gch_.*sub_1/),
      );
    });

    describe('when another writer settled the charge differently during the gateway call', () => {
      const settleElsewhere = (
        to: 'paid' | 'expired',
        gatewayChargeId: string,
      ) =>
        billing.recordChargeOutcome({
          charge: {
            id: 'ch_1',
            fromAnyOf: ['pending'],
            to,
            gatewayChargeId,
            paidAt: to === 'paid' ? periodStart : null,
          },
          attempt: null,
          subscription: { id: 'sub_1', change: null },
        });

      const interceptGatewayCall = (
        beforeAnswering: () => Promise<unknown>,
      ) => {
        const createCharge = gateway.createCharge.bind(gateway);
        vi.spyOn(gateway, 'createCharge').mockImplementation(async (input) => {
          const created = await createCharge(input);
          await beforeAnswering();
          return created;
        });
      };

      it.each([
        ['expired', 'gch_stale'],
        ['paid', 'gch_other'],
      ] as const)(
        'logs an error asking for a refund when money was captured for a charge already %s',
        async (settledStatus, gatewayChargeId) => {
          const { target } = await seed();
          interceptGatewayCall(() =>
            settleElsewhere(settledStatus, gatewayChargeId),
          );

          await expect(processor.process(target)).rejects.toBeInstanceOf(
            ChargeSettlementConflictError,
          );

          expect(errorLog).toHaveBeenCalledWith(
            expect.stringMatching(
              new RegExp(`ch_1.*sub_1.*${settledStatus}.*${gatewayChargeId}`),
            ),
          );
        },
      );

      it('does not ask for a refund when the gateway declined the charge', async () => {
        const { target } = await seed('tok_insufficient_funds');
        gateway.respondWith({
          status: 'failed',
          failureReason: 'insufficient_funds',
        });
        interceptGatewayCall(() => settleElsewhere('expired', 'gch_stale'));

        await expect(processor.process(target)).rejects.toBeInstanceOf(
          ChargeSettlementConflictError,
        );

        expect(errorLog).not.toHaveBeenCalled();
      });
    });

    it('rejects a pending charge that has no attempt key', async () => {
      const { target } = await seed();

      await expect(
        processor.process({
          ...target,
          charge: { ...target.charge, gatewayAttemptKey: null },
        }),
      ).rejects.toThrow('ch_1 has no gateway attempt key');
      expect(gateway.chargesRequested).toEqual([]);
    });
  });

  describe('retry', () => {
    async function seedFailed() {
      const { target } = await seed();
      gateway.respondWith({
        status: 'failed',
        failureReason: 'insufficient_funds',
      });
      const { charge } = await processor.process(target);
      gateway.respondWith({ status: 'paid' });
      clock.set(afterLease);
      return charge;
    }

    it('starts a new attempt with the next key and settles it', async () => {
      const failed = await seedFailed();

      const processed = await processor.retry(failed);

      expect(processed.charge).toMatchObject({
        status: 'paid',
        attemptCount: 2,
        gatewayAttemptKey: 'ch_1:2',
        attemptStartedAt: afterLease,
      });
      expect(gateway.chargesRequested.at(-1)?.idempotencyKey).toBe('ch_1:2');
    });

    it('rejects a charge that cannot return to pending before any write', async () => {
      const { target } = await seed();
      const { charge: paid } = await processor.process(target);

      await expect(processor.retry(paid)).rejects.toBeInstanceOf(
        InvalidChargeTransitionError,
      );
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('rejects a subscription without card token before any write', async () => {
      const { charge } = await seed(null);

      await expect(
        processor.retry({ ...charge, status: 'failed' }),
      ).rejects.toBeInstanceOf(UnprocessableError);
      expect(storedCharge().attemptStartedAt).toEqual(periodStart);
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('rejects a canceled subscription before any write', async () => {
      const failed = await seedFailed();
      await subscriptions.changeStatus('sub_1', {
        fromAnyOf: ['past_due'],
        to: 'canceled',
      });

      await expect(processor.retry(failed)).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
      expect(storedCharge()).toMatchObject({
        status: 'failed',
        gatewayAttemptKey: 'ch_1:1',
      });
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('rejects a customer without gateway account before any write', async () => {
      await customers.create({ id: 'cus_1', name: 'Ana', email: 'ana@e.com' });
      const { charge } = await billing.createSubscriptionWithFirstCharge(
        {
          id: 'sub_2',
          customerId: 'cus_1',
          planId: 'plan_1',
          paymentMethod: 'card',
          status: 'past_due',
          cardToken: 'tok_success',
          billingAnchor: periodStart,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
        {
          id: 'ch_9',
          subscriptionId: 'sub_2',
          amountCents: 1990,
          method: 'card',
          dueDate: periodStart,
          periodStart,
          periodEnd,
          gatewayAttemptKey: 'ch_9:1',
          attemptStartedAt: periodStart,
        },
      );

      await expect(
        processor.retry({ ...charge, status: 'failed' }),
      ).rejects.toBeInstanceOf(UnprocessableError);
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('rejects an unknown charge', async () => {
      const { charge } = await seed();

      await expect(
        processor.retry({ ...charge, id: 'ch_missing', status: 'failed' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('reports a concurrent modification when the charge is no longer failed', async () => {
      const { charge } = await seed();

      await expect(
        processor.retry({ ...charge, status: 'failed' }),
      ).rejects.toMatchObject({
        name: 'ConflictError',
        transient: true,
      });
      expect(gateway.chargesRequested).toEqual([]);
    });

    it('marks the missing gateway customer as transient', async () => {
      const { charge, target } = await seed();
      vi.spyOn(customers, 'findById').mockResolvedValue({
        ...target.customer,
        gatewayCustomerId: null,
      });

      await expect(processor.reconcile(charge)).rejects.toMatchObject({
        name: 'UnprocessableError',
        message: 'Customer cus_1 has no gateway customer',
        transient: true,
      });
    });
  });

  describe('reconcile', () => {
    async function seedStranded(
      strandedBy: Error = new GatewayOutcomeUnknownError('timeout'),
      afterProcessing = true,
    ) {
      const { target } = await seed();
      gateway.failChargeCreationWith(strandedBy, {
        times: 1,
        afterProcessing,
      });
      await processor.process(target);
      return storedCharge();
    }

    it('records the outcome the gateway already holds without charging again', async () => {
      const stranded = await seedStranded();
      clock.set(afterLease);

      const processed = await processor.reconcile(stranded);

      expect(processed.charge).toMatchObject({
        status: 'paid',
        gatewayChargeId: [...gateway.chargesProcessed.values()][0]?.id,
        attemptCount: 1,
      });
      expect(processed.subscription.status).toBe('active');
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('records a decline the gateway already holds', async () => {
      gateway.respondWith({
        status: 'failed',
        failureReason: 'expired_card',
      });
      const stranded = await seedStranded();
      clock.set(afterLease);

      const processed = await processor.reconcile(stranded);

      expect(processed).toMatchObject({
        charge: { status: 'failed' },
        subscription: { status: 'past_due' },
        failureReason: 'expired_card',
      });
    });

    it('re-sends with the same key when the gateway never received the attempt', async () => {
      const stranded = await seedStranded(
        new GatewayUnavailableError('down'),
        false,
      );
      clock.set(afterLease);

      const processed = await processor.reconcile(stranded);

      expect(processed.charge.status).toBe('paid');
      expect(
        gateway.chargesRequested.map(({ idempotencyKey }) => idempotencyKey),
      ).toEqual(['ch_1:1', 'ch_1:1']);
    });

    it('keeps the charge pending and does not re-send while the gateway holds it pending', async () => {
      gateway.respondWith({ status: 'pending' });
      const stranded = await seedStranded();
      clock.set(afterLease);

      const processed = await processor.reconcile(stranded);

      expect(processed.charge.status).toBe('pending');
      expect(storedCharge().gatewayChargeId).not.toBeNull();
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('rejects a reconciliation within the lease as in flight', async () => {
      const stranded = await seedStranded();
      clock.set(withinLease);

      await expect(processor.reconcile(stranded)).rejects.toMatchObject({
        message: 'Charge ch_1 has an attempt in flight',
        transient: true,
      });
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('lets only one of two concurrent reconcilers proceed', async () => {
      const stranded = await seedStranded();
      clock.set(afterLease);

      const results = await Promise.allSettled([
        processor.reconcile(stranded),
        processor.reconcile(stranded),
      ]);

      expect(results.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(billing.attempts()).toHaveLength(1);
    });

    it('renews the lease and stays pending when the gateway lookup fails', async () => {
      const stranded = await seedStranded();
      gateway.failLookupWith(new GatewayUnavailableError('down'));
      clock.set(afterLease);

      const processed = await processor.reconcile(stranded);

      expect(processed.charge.status).toBe('pending');
      expect(storedCharge().attemptStartedAt).toEqual(afterLease);
      await expect(processor.reconcile(stranded)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('rejects a charge that is no longer pending', async () => {
      const { target } = await seed();
      const { charge: paid } = await processor.process(target);

      await expect(processor.reconcile(paid)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('rejects an unknown charge', async () => {
      const stranded = await seedStranded();

      await expect(
        processor.reconcile({ ...stranded, id: 'ch_missing' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe.each(['pix', 'boleto'] as const)('%s charges', (method) => {
    const seedInvoice = () => seed(null, method);

    it('requests the gateway charge without card data and keeps it pending with its instructions', async () => {
      const { target } = await seedInvoice();

      const processed = await processor.process(target);

      expect(gateway.chargesRequested).toEqual([
        {
          gatewayCustomerId: 'gcus_1',
          amountCents: 1990,
          method,
          externalRef: 'ch_1',
          idempotencyKey: 'ch_1:1',
        },
      ]);
      expect(processed.charge).toMatchObject({
        status: 'pending',
        gatewayChargeId: expect.stringMatching(/^gch_/),
        expiresAt: STUB_EXPIRES_AT,
        paymentInstructions: expect.objectContaining({ type: method }),
      });
      expect(processed.subscription.status).toBe('incomplete');
      expect(billing.attempts()).toEqual([]);
    });

    it('reconciles a charge waiting for payment by lookup, without re-sending or erroring', async () => {
      const { target } = await seedInvoice();
      await processor.process(target);
      clock.set(afterLease);

      const processed = await processor.reconcile(storedCharge());

      expect(processed.charge).toMatchObject({
        status: 'pending',
        expiresAt: STUB_EXPIRES_AT,
        paymentInstructions: expect.objectContaining({ type: method }),
      });
      expect(gateway.chargesRequested).toHaveLength(1);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('settles as paid when reconciliation finds the gateway already paid it', async () => {
      const { target } = await seedInvoice();
      await processor.process(target);
      const [held] = [...gateway.chargesProcessed.values()];
      gateway.chargesProcessed.set('ch_1:1', { ...held!, status: 'paid' });
      clock.set(afterLease);

      const processed = await processor.reconcile(storedCharge());

      expect(processed.charge.status).toBe('paid');
      expect(processed.subscription.status).toBe('active');
      expect(gateway.chargesRequested).toHaveLength(1);
    });

    it('settles as expired when reconciliation finds the gateway expired it, canceling the incomplete subscription', async () => {
      const { target } = await seedInvoice();
      await processor.process(target);
      const [held] = [...gateway.chargesProcessed.values()];
      gateway.chargesProcessed.set('ch_1:1', { ...held!, status: 'expired' });
      clock.set(afterLease);

      const processed = await processor.reconcile(storedCharge());

      expect(processed.charge.status).toBe('expired');
      expect(processed.charge.gatewayChargeId).toBe(held!.id);
      expect(processed.subscription).toMatchObject({
        status: 'canceled',
        canceledAt: afterLease,
      });
      expect(processed.failureReason).toBeNull();
      expect(billing.attempts()).toEqual([]);
      expect(storedCharge().attemptCount).toBe(0);
    });

    it('moves an active subscription to past_due when reconciliation finds its renewal expired', async () => {
      const { target } = await seedInvoice();
      await processor.process(target);
      await subscriptions.changeStatus('sub_1', {
        fromAnyOf: ['incomplete'],
        to: 'active',
      });
      const [held] = [...gateway.chargesProcessed.values()];
      gateway.chargesProcessed.set('ch_1:1', { ...held!, status: 'expired' });
      clock.set(afterLease);

      const processed = await processor.reconcile(storedCharge());

      expect(processed.charge.status).toBe('expired');
      expect(processed.subscription.status).toBe('past_due');
    });

    it('does not retry a pending charge as a new attempt', async () => {
      const { target } = await seedInvoice();
      await processor.process(target);

      await expect(processor.retry(storedCharge())).rejects.toBeInstanceOf(
        InvalidChargeTransitionError,
      );
      expect(gateway.chargesRequested).toHaveLength(1);
    });
  });
});
