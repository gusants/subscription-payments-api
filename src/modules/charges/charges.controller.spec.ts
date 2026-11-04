import { StubPaymentGateway } from '../../gateway/testing/stub-payment-gateway.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import { InMemorySubscriptionsRepository } from '../subscriptions/testing/in-memory-subscriptions.repository.js';
import { ChargesController } from './charges.controller.js';
import { ChargesService } from './charges.service.js';
import type { Response } from 'express';
import {
  buildChargeDunning,
  buildChargeProcessor,
} from './testing/build-charge-processor.js';
import { InMemoryBillingRepository } from './testing/in-memory-billing.repository.js';
import { InMemoryChargesRepository } from './testing/in-memory-charges.repository.js';

const responseStub = () => ({ status: vi.fn() }) as unknown as Response;

describe('ChargesController', () => {
  const at = new Date('2026-01-31T10:30:00.000Z');
  let controller: ChargesController;

  beforeEach(async () => {
    const customers = new InMemoryCustomersRepository();
    const subscriptions = new InMemorySubscriptionsRepository();
    const billing = new InMemoryBillingRepository(subscriptions);
    await customers.create({ id: 'cus_1', name: 'Ana', email: 'a@e.com' });
    await customers.assignGatewayCustomerId('cus_1', 'gcus_1');
    await billing.createSubscriptionWithFirstCharge(
      {
        id: 'sub_1',
        customerId: 'cus_1',
        planId: 'plan_1',
        paymentMethod: 'card',
        status: 'incomplete',
        cardToken: 'tok_success',
        billingAnchor: at,
        currentPeriodStart: at,
        currentPeriodEnd: at,
      },
      {
        id: 'ch_1',
        subscriptionId: 'sub_1',
        amountCents: 1990,
        method: 'card',
        dueDate: at,
        periodStart: at,
        periodEnd: at,
        gatewayAttemptKey: 'ch_1:1',
        attemptStartedAt: at,
      },
    );
    controller = new ChargesController(
      new ChargesService(
        new InMemoryChargesRepository(billing, subscriptions),
        customers,
        buildChargeProcessor({
          billing,
          subscriptions,
          customers,
          gateway: new StubPaymentGateway(),
          clock: new FixedClock(at),
        }),
        buildChargeDunning(billing, new FixedClock(at)),
      ),
    );
  });

  it('serializes the customer charge history with pagination meta', async () => {
    const result = await controller.history('cus_1', { page: 1, limit: 20 });

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'ch_1',
        status: 'pending',
        dueDate: '2026-01-31T10:30:00.000Z',
        attempts: [],
      }),
    ]);
    expect(result.meta.total).toBe(1);
  });

  it('propagates NotFoundError for an unknown customer', async () => {
    await expect(
      controller.history('cus_missing', { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('propagates NotFoundError when retrying an unknown charge', async () => {
    await expect(
      controller.retry('ch_missing', responseStub()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
