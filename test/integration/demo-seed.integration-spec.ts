import { PrismaMetricsRepository } from '../../src/modules/metrics/prisma-metrics.repository.js';
import {
  computeOverview,
  currentMonthPeriod,
} from '../../src/modules/metrics/domain/index.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { applyDemoSeed } from '../../src/tools/demo-seed/apply-demo-seed.js';
import { buildDemoSeed } from '../../src/tools/demo-seed/build-demo-seed.js';
import { createPrismaService } from '../support/prisma-test-client.js';

const NOW = new Date('2026-11-04T15:30:00.000Z');
const LATER = new Date('2026-11-05T09:00:00.000Z');

describe('demo seed (integration)', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = createPrismaService();
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

  const countRows = async () => ({
    plans: await prisma.plan.count(),
    customers: await prisma.customer.count(),
    subscriptions: await prisma.subscription.count(),
    charges: await prisma.charge.count(),
    attempts: await prisma.paymentAttempt.count(),
  });

  it('inserts the whole seed', async () => {
    const seed = buildDemoSeed(NOW);

    await applyDemoSeed(prisma, seed);

    expect(await countRows()).toEqual({
      plans: seed.plans.length,
      customers: seed.customers.length,
      subscriptions: seed.subscriptions.length,
      charges: seed.charges.length,
      attempts: seed.attempts.length,
    });
  });

  it('is idempotent when run twice, even on a later day', async () => {
    await applyDemoSeed(prisma, buildDemoSeed(NOW));
    const afterFirstRun = await countRows();

    await applyDemoSeed(prisma, buildDemoSeed(NOW));
    expect(await countRows()).toEqual(afterFirstRun);

    const later = buildDemoSeed(LATER);
    await applyDemoSeed(prisma, later);
    expect(await countRows()).toEqual({
      plans: later.plans.length,
      customers: later.customers.length,
      subscriptions: later.subscriptions.length,
      charges: later.charges.length,
      attempts: later.attempts.length,
    });
  });

  it('leaves rows that are not part of the seed untouched', async () => {
    const plan = await prisma.plan.create({
      data: {
        id: 'plan_manual',
        name: 'Manual',
        amountCents: 100,
        interval: 'monthly',
      },
    });
    const customer = await prisma.customer.create({
      data: { id: 'cus_manual', name: 'Manual', email: 'manual@example.com' },
    });
    await prisma.subscription.create({
      data: {
        id: 'sub_manual',
        customerId: customer.id,
        planId: plan.id,
        paymentMethod: 'pix',
        billingAnchor: NOW,
        currentPeriodStart: NOW,
        currentPeriodEnd: LATER,
      },
    });

    await applyDemoSeed(prisma, buildDemoSeed(NOW));
    await applyDemoSeed(prisma, buildDemoSeed(NOW));

    expect(
      await prisma.subscription.count({ where: { id: 'sub_manual' } }),
    ).toBe(1);
  });

  it('produces a non-trivial metrics overview', async () => {
    await applyDemoSeed(prisma, buildDemoSeed(NOW));
    const period = currentMonthPeriod(NOW);

    const overview = computeOverview(
      await new PrismaMetricsRepository(prisma).loadSnapshot(period),
      period,
    );

    expect(overview.monthlyRecurringRevenueCents).toBeGreaterThan(0);
    expect(overview.activeSubscriptions).toBeGreaterThan(0);
    expect(overview.pastDueSubscriptions).toBeGreaterThan(0);
    expect(overview.delinquencyRate).toBeGreaterThan(0);
    expect(overview.delinquencyRate).toBeLessThan(1);
    expect(overview.subscriptionsByStatus.canceled).toBeGreaterThan(0);
    expect(
      overview.revenueByMonth.some(({ revenueCents }) => revenueCents > 0),
    ).toBe(true);
  });
});
