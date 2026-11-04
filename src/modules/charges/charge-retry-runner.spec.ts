import { Logger } from '@nestjs/common';
import { GatewayUnavailableError } from '../../gateway/index.js';
import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { RecordingBillingQueue } from '../billing-queue/testing/recording-billing-queue.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import { ChargeRetryRunner } from './charge-retry-runner.js';
import { buildChargeProcessor } from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';
import { InMemoryChargesRepository } from './testing/in-memory-charges.repository.js';

describe('ChargeRetryRunner', () => {
  const failedAt = new Date('2026-03-01T10:00:00.000Z');
  const periodEnd = new Date('2026-04-01T10:00:00.000Z');
  const dayMs = 24 * 60 * 60 * 1000;
  let subscriptions: InMemorySubscriptionsRepository;
  let billing: InMemoryBillingRepository;
  let customers: InMemoryCustomersRepository;
  let gateway: StubPaymentGateway;
  let clock: FixedClock;
  let queue: RecordingBillingQueue;
  let runner: ChargeRetryRunner;

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionsRepository();
    billing = new InMemoryBillingRepository(subscriptions);
    customers = new InMemoryCustomersRepository();
    gateway = new StubPaymentGateway();
    clock = new FixedClock(failedAt);
    queue = new RecordingBillingQueue();
    runner = new ChargeRetryRunner(
      new InMemoryChargesRepository(billing, subscriptions),
      buildChargeProcessor({
        billing,
        subscriptions,
        customers,
        gateway,
        clock,
        queue,
      }),
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedFailedCharge(method: 'card' | 'pix' = 'card') {
    await customers.create({ id: 'cus_1', name: 'Ana', email: 'ana@e.com' });
    await customers.assignGatewayCustomerId('cus_1', 'gcus_1');
    await billing.createSubscriptionWithFirstCharge(
      {
        id: 'sub_1',
        customerId: 'cus_1',
        planId: 'plan_1',
        paymentMethod: method,
        status: 'incomplete',
        cardToken: method === 'card' ? 'tok_success' : null,
        billingAnchor: failedAt,
        currentPeriodStart: failedAt,
        currentPeriodEnd: periodEnd,
      },
      {
        id: 'ch_1',
        subscriptionId: 'sub_1',
        amountCents: 1990,
        method,
        dueDate: failedAt,
        periodStart: failedAt,
        periodEnd,
        gatewayAttemptKey: 'ch_1:1',
        attemptStartedAt: failedAt,
      },
    );
    await billing.recordChargeOutcome({
      charge: {
        id: 'ch_1',
        fromAnyOf: ['pending'],
        to: method === 'card' ? 'failed' : 'expired',
        gatewayChargeId: 'gch_1',
        paidAt: null,
        firstFailedAt: failedAt,
      },
      attempt: null,
      subscription: {
        id: 'sub_1',
        change: { fromAnyOf: ['incomplete'], to: 'past_due' },
      },
    });
    clock.set(new Date(failedAt.getTime() + dayMs));
  }

  it('resubmits a failed charge through the gateway and settles it', async () => {
    await seedFailedCharge();

    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    expect(billing.charges()[0]).toMatchObject({
      status: 'paid',
      retryCount: 1,
    });
    expect((await subscriptions.findById('sub_1'))?.status).toBe('active');
  });

  it('issues a new charge when the failed one was an expired pix', async () => {
    await seedFailedCharge('pix');

    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    expect(billing.charges().map(({ status }) => status)).toEqual([
      'expired',
      'pending',
    ]);
    expect(gateway.chargesRequested).toHaveLength(1);
  });

  it('does nothing when the same retry runs again', async () => {
    await seedFailedCharge();
    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    expect(gateway.chargesRequested).toHaveLength(1);
  });

  it('skips a retry whose charge is already paid', async () => {
    await seedFailedCharge();
    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    await runner.run({ chargeId: 'ch_1', attempt: 2 });

    expect(gateway.chargesRequested).toHaveLength(1);
  });

  it('skips a retry numbered ahead of the retries made', async () => {
    await seedFailedCharge();

    await runner.run({ chargeId: 'ch_1', attempt: 2 });

    expect(gateway.chargesRequested).toEqual([]);
    expect(billing.charges()[0]?.status).toBe('failed');
  });

  it('skips a charge that no longer exists', async () => {
    await runner.run({ chargeId: 'ch_missing', attempt: 1 });

    expect(gateway.chargesRequested).toEqual([]);
  });

  it('skips without failing when the subscription was canceled meanwhile', async () => {
    await seedFailedCharge();
    await subscriptions.changeStatus('sub_1', {
      fromAnyOf: ['past_due'],
      to: 'canceled',
    });

    await expect(
      runner.run({ chargeId: 'ch_1', attempt: 1 }),
    ).resolves.toBeUndefined();

    expect(gateway.chargesRequested).toEqual([]);
  });

  it('lets a transient failure reach the worker so the job is retried', async () => {
    await seedFailedCharge();
    await customers.assignGatewayCustomerId('cus_1', 'gcus_1');
    const withoutGatewayCustomer = new InMemoryCustomersRepository();
    await withoutGatewayCustomer.create({
      id: 'cus_1',
      name: 'Ana',
      email: 'ana@e.com',
    });
    const strictRunner = new ChargeRetryRunner(
      new InMemoryChargesRepository(billing, subscriptions),
      buildChargeProcessor({
        billing,
        subscriptions,
        customers: withoutGatewayCustomer,
        gateway,
        clock,
        queue,
      }),
    );

    await expect(
      strictRunner.run({ chargeId: 'ch_1', attempt: 1 }),
    ).rejects.toMatchObject({ transient: true });
  });

  it('keeps the next retry scheduled when the resubmission is declined again', async () => {
    await seedFailedCharge();
    gateway.respondWith({ status: 'failed', failureReason: 'expired_card' });

    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    expect(queue.scheduled()).toEqual([
      { chargeId: 'ch_1', attempt: 2, delayMs: 2 * dayMs },
    ]);
  });

  it('leaves the charge pending when the gateway is unavailable', async () => {
    await seedFailedCharge();
    gateway.failChargeCreationWith(new GatewayUnavailableError('down'));

    await runner.run({ chargeId: 'ch_1', attempt: 1 });

    expect(billing.charges()[0]?.status).toBe('pending');
  });
});
