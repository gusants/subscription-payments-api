import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { UnprocessableError } from '../../shared/errors/index.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import { ChargeProcessor } from './charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';

describe('ChargeProcessor', () => {
  const periodStart = new Date('2026-01-31T10:30:00.000Z');
  const periodEnd = new Date('2026-02-28T10:30:00.000Z');
  let billing: InMemoryBillingRepository;
  let gateway: StubPaymentGateway;
  let processor: ChargeProcessor;

  beforeEach(() => {
    billing = new InMemoryBillingRepository(
      new InMemorySubscriptionsRepository(),
    );
    gateway = new StubPaymentGateway();
    processor = new ChargeProcessor(
      billing,
      gateway,
      new FixedClock(periodStart),
    );
  });

  const seed = (cardToken: string | null) =>
    billing.createSubscriptionWithFirstCharge(
      {
        id: 'sub_1',
        customerId: 'cus_1',
        planId: 'plan_1',
        paymentMethod: 'card',
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
        method: 'card',
        dueDate: periodStart,
        periodStart,
        periodEnd,
      },
    );

  it('settles an approved charge and activates the incomplete subscription', async () => {
    const request = await seed('tok_success');

    const processed = await processor.process({
      ...request,
      gatewayCustomerId: 'gcus_1',
    });

    expect(processed.charge.status).toBe('paid');
    expect(processed.subscription.status).toBe('active');
    expect(processed.failureReason).toBeNull();
  });

  it('exposes the failure reason of a declined charge', async () => {
    const request = await seed('tok_insufficient_funds');
    gateway.respondWith({
      status: 'failed',
      failureReason: 'insufficient_funds',
    });

    const processed = await processor.process({
      ...request,
      gatewayCustomerId: 'gcus_1',
    });

    expect(processed.charge.status).toBe('failed');
    expect(processed.subscription.status).toBe('past_due');
    expect(processed.failureReason).toBe('insufficient_funds');
  });

  it('leaves the charge untouched when the gateway answers pending', async () => {
    const request = await seed('tok_success');
    gateway.respondWith({ status: 'pending' });

    const processed = await processor.process({
      ...request,
      gatewayCustomerId: 'gcus_1',
    });

    expect(processed.charge.status).toBe('pending');
    expect(billing.attempts()).toEqual([]);
  });

  it('refuses to charge a subscription without a card token', async () => {
    const request = await seed(null);

    await expect(
      processor.process({ ...request, gatewayCustomerId: 'gcus_1' }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(gateway.chargesRequested).toEqual([]);
  });
});
