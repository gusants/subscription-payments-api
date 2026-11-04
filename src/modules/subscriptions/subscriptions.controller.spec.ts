import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { buildChargeProcessor } from '../charges/testing/build-charge-processor.js';
import { InMemoryBillingRepository } from '../charges/testing/in-memory-billing.repository.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import { InMemoryPlansRepository } from '../plans/testing/in-memory-plans.repository.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { InMemorySubscriptionsRepository } from './testing/in-memory-subscriptions.repository.js';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;

  beforeEach(async () => {
    const customers = new InMemoryCustomersRepository();
    const plans = new InMemoryPlansRepository();
    await customers.create({
      id: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
    });
    await plans.create({
      id: 'plan_1',
      name: 'Basic',
      amountCents: 1990,
      interval: 'monthly',
    });
    const subscriptions = new InMemorySubscriptionsRepository();
    const billing = new InMemoryBillingRepository(subscriptions);
    const gateway = new StubPaymentGateway();
    const clock = new FixedClock(new Date('2026-11-03T10:00:00.000Z'));
    controller = new SubscriptionsController(
      new SubscriptionsService(
        subscriptions,
        billing,
        customers,
        plans,
        gateway,
        clock,
        buildChargeProcessor({
          billing,
          subscriptions,
          customers,
          gateway,
          clock,
        }),
      ),
    );
  });

  const body = {
    customerId: 'cus_1',
    planId: 'plan_1',
    paymentMethod: 'pix',
  } as const;

  it('creates a serialized subscription', async () => {
    const created = await controller.create(body);

    expect(created).toMatchObject({
      ...body,
      status: 'incomplete',
      billingAnchor: '2026-11-03T10:00:00.000Z',
      currentPeriodStart: '2026-11-03T10:00:00.000Z',
      currentPeriodEnd: '2026-12-03T10:00:00.000Z',
      canceledAt: null,
      latestCharge: {
        status: 'pending',
        amountCents: 1990,
        expiresAt: expect.any(String),
        paymentInstructions: { type: 'pix' },
      },
    });
  });

  it('creates a card subscription exposing the charge outcome but never the card token', async () => {
    const created = await controller.create({
      customerId: 'cus_1',
      planId: 'plan_1',
      paymentMethod: 'card',
      cardToken: 'tok_success',
    });

    expect(created).toMatchObject({
      status: 'active',
      latestCharge: { status: 'paid', amountCents: 1990 },
    });
    expect(JSON.stringify(created)).not.toContain('tok_success');
  });

  it('returns the detail', async () => {
    const { id } = await controller.create(body);

    await expect(controller.detail(id)).resolves.toMatchObject({ id });
  });

  it('propagates NotFoundError for an unknown subscription', async () => {
    await expect(controller.detail('sub_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('cancels and serializes canceledAt', async () => {
    const { id } = await controller.create(body);

    const canceled = await controller.cancel(id);

    expect(canceled).toMatchObject({
      status: 'canceled',
      canceledAt: '2026-11-03T10:00:00.000Z',
    });
  });
});
