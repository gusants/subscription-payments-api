import type { SubscriptionStatus } from '../../src/generated/prisma/enums.js';
import type { CancelReason } from '../../src/modules/subscriptions/cancel-reason.js';
import { PrismaMetricsRepository } from '../../src/modules/metrics/prisma-metrics.repository.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

const period = {
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-11-30T23:59:59.999Z'),
};

describe('PrismaMetricsRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaMetricsRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaMetricsRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createPlan = (interval: 'monthly' | 'yearly', amountCents: number) =>
    prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Plan',
        interval,
        amountCents,
      },
    });

  const createSubscription = async (
    planId: string,
    status: SubscriptionStatus,
    cancellation?: { reason: CancelReason; at: Date },
  ) => {
    const customer = await prisma.customer.create({
      data: {
        id: generateId(ID_PREFIXES.customer),
        name: 'Ana',
        email: `${generateId(ID_PREFIXES.customer)}@example.com`,
      },
    });
    return prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId: customer.id,
        planId,
        paymentMethod: 'card',
        status,
        billingAnchor: new Date('2026-01-10T00:00:00.000Z'),
        currentPeriodStart: new Date('2026-11-10T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-12-10T00:00:00.000Z'),
        canceledAt: cancellation?.at,
        cancelReason: cancellation?.reason,
      },
    });
  };

  const createCharge = (
    subscriptionId: string,
    status: 'paid' | 'failed',
    paidAt: Date | null,
    amountCents: number,
  ) =>
    prisma.charge.create({
      data: {
        id: generateId(ID_PREFIXES.charge),
        subscriptionId,
        amountCents,
        method: 'card',
        status,
        dueDate: new Date('2026-11-10T00:00:00.000Z'),
        periodStart: paidAt ?? new Date('2026-11-10T00:00:00.000Z'),
        periodEnd: new Date('2026-12-10T00:00:00.000Z'),
        paidAt,
      },
    });

  it('returns an empty snapshot for an empty database', async () => {
    await expect(repository.loadSnapshot(period)).resolves.toEqual({
      statusCounts: [],
      activePlans: [],
      paymentFailedCancellations: 0,
      paidRevenueByMonth: [],
    });
  });

  it('counts subscriptions per status', async () => {
    const { id: planId } = await createPlan('monthly', 1990);
    await createSubscription(planId, 'active');
    await createSubscription(planId, 'active');
    await createSubscription(planId, 'past_due');

    const { statusCounts } = await repository.loadSnapshot(period);

    expect(statusCounts).toHaveLength(2);
    expect(statusCounts).toEqual(
      expect.arrayContaining([
        { status: 'active', count: 2 },
        { status: 'past_due', count: 1 },
      ]),
    );
  });

  it('groups only active subscriptions by plan', async () => {
    const monthly = await createPlan('monthly', 1990);
    const yearly = await createPlan('yearly', 19_900);
    await createPlan('monthly', 5000);
    await createSubscription(monthly.id, 'active');
    await createSubscription(monthly.id, 'active');
    await createSubscription(monthly.id, 'past_due');
    await createSubscription(yearly.id, 'active');
    await createSubscription(yearly.id, 'canceled');

    const { activePlans } = await repository.loadSnapshot(period);

    expect(activePlans).toHaveLength(2);
    expect(activePlans).toEqual(
      expect.arrayContaining([
        { interval: 'monthly', amountCents: 1990, subscriptions: 2 },
        { interval: 'yearly', amountCents: 19_900, subscriptions: 1 },
      ]),
    );
  });

  it('counts only payment-failure cancellations canceled inside the period', async () => {
    const { id: planId } = await createPlan('monthly', 1990);
    const inside = new Date('2026-11-15T00:00:00.000Z');
    await createSubscription(planId, 'canceled', {
      reason: 'payment_failed',
      at: inside,
    });
    await createSubscription(planId, 'canceled', {
      reason: 'payment_failed',
      at: period.to,
    });
    await createSubscription(planId, 'canceled', {
      reason: 'payment_failed',
      at: new Date('2026-10-31T23:59:59.999Z'),
    });
    await createSubscription(planId, 'canceled', {
      reason: 'payment_failed',
      at: new Date('2026-12-01T00:00:00.000Z'),
    });
    await createSubscription(planId, 'canceled', {
      reason: 'customer_request',
      at: inside,
    });
    await createSubscription(planId, 'canceled', {
      reason: 'initial_payment_expired',
      at: inside,
    });
    await createSubscription(planId, 'canceled');

    const { paymentFailedCancellations } =
      await repository.loadSnapshot(period);

    expect(paymentFailedCancellations).toBe(2);
  });

  it('sums paid charges per UTC month of paidAt inside the period only', async () => {
    const { id: planId } = await createPlan('monthly', 1990);
    const { id: subscriptionId } = await createSubscription(planId, 'active');
    const range = {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-11-30T23:59:59.999Z'),
    };
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-10-31T23:30:00.000Z'),
      1000,
    );
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-11-01T00:00:00.000Z'),
      2000,
    );
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-11-30T23:59:59.999Z'),
      500,
    );
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-09-30T23:59:59.999Z'),
      7000,
    );
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-12-01T00:00:00.000Z'),
      7000,
    );
    await createCharge(subscriptionId, 'failed', null, 9000);

    const { paidRevenueByMonth } = await repository.loadSnapshot(range);

    expect(paidRevenueByMonth).toEqual([
      { month: '2026-10', revenueCents: 1000 },
      { month: '2026-11', revenueCents: 2500 },
    ]);
  });

  it('leaves out charges paid after their subscription was canceled, which are refund-due', async () => {
    const { id: planId } = await createPlan('monthly', 1990);
    const canceledAt = new Date('2026-11-10T12:00:00.000Z');
    const { id: subscriptionId } = await createSubscription(
      planId,
      'canceled',
      { reason: 'customer_request', at: canceledAt },
    );
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-11-10T11:00:00.000Z'),
      1990,
    );
    await createCharge(
      subscriptionId,
      'paid',
      new Date('2026-11-10T13:00:00.000Z'),
      4990,
    );

    const { paidRevenueByMonth } = await repository.loadSnapshot(period);

    expect(paidRevenueByMonth).toEqual([
      { month: '2026-11', revenueCents: 1990 },
    ]);
  });
});
