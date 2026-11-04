import { PrismaBillingRepository } from '../../src/modules/charges/prisma-billing.repository.js';
import { PrismaRenewalsRepository } from '../../src/modules/charges/prisma-renewals.repository.js';
import type { ChargeStatus } from '../../src/modules/charges/charge-status.js';
import type { SubscriptionStatus } from '../../src/modules/subscriptions/subscription-status.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaRenewalsRepository (integration)', () => {
  let prisma: PrismaService;
  let billing: PrismaBillingRepository;
  let repository: PrismaRenewalsRepository;
  let customerId: string;
  let planId: string;

  const anchor = new Date('2026-01-31T10:30:00.000Z');
  const periodEnd = new Date('2026-02-28T10:30:00.000Z');
  const now = new Date('2026-03-01T00:00:00.000Z');

  beforeAll(() => {
    prisma = createPrismaService();
    billing = new PrismaBillingRepository(prisma);
    repository = new PrismaRenewalsRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    customerId = (
      await prisma.customer.create({
        data: {
          id: generateId(ID_PREFIXES.customer),
          name: 'Ana',
          email: 'ana@example.com',
        },
      })
    ).id;
    planId = (
      await prisma.plan.create({
        data: {
          id: generateId(ID_PREFIXES.plan),
          name: 'Basic',
          amountCents: 1990,
          interval: 'monthly',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedSubscription(
    status: SubscriptionStatus = 'active',
    currentPeriodEnd = periodEnd,
  ): Promise<string> {
    const id = generateId(ID_PREFIXES.subscription);
    const chargeId = generateId(ID_PREFIXES.charge);
    await billing.createSubscriptionWithFirstCharge(
      {
        id,
        customerId,
        planId,
        paymentMethod: 'card',
        status,
        cardToken: 'tok_success',
        billingAnchor: anchor,
        currentPeriodStart: anchor,
        currentPeriodEnd,
      },
      {
        id: chargeId,
        subscriptionId: id,
        amountCents: 1990,
        method: 'card',
        dueDate: anchor,
        periodStart: anchor,
        periodEnd: currentPeriodEnd,
        gatewayAttemptKey: `${chargeId}:1`,
        attemptStartedAt: anchor,
      },
    );
    return id;
  }

  async function chargeNextPeriod(
    subscriptionId: string,
    status: ChargeStatus = 'pending',
  ) {
    const id = generateId(ID_PREFIXES.charge);
    await prisma.charge.create({
      data: {
        id,
        subscriptionId,
        amountCents: 1990,
        method: 'card',
        status,
        dueDate: periodEnd,
        periodStart: periodEnd,
        periodEnd: new Date('2026-03-31T10:30:00.000Z'),
      },
    });
  }

  const dueIds = async (limit = 10) =>
    (await repository.findDue(now, limit)).map(
      ({ subscription }) => subscription.id,
    );

  it('returns an active subscription whose period ended with its plan terms', async () => {
    const id = await seedSubscription();

    const [candidate] = await repository.findDue(now, 10);

    expect(candidate?.subscription.id).toBe(id);
    expect(candidate?.plan).toEqual({ amountCents: 1990, interval: 'monthly' });
  });

  it('skips subscriptions that are not active', async () => {
    await seedSubscription('canceled');
    await seedSubscription('past_due');
    await seedSubscription('incomplete');

    expect(await dueIds()).toEqual([]);
  });

  it('skips subscriptions whose period has not ended', async () => {
    await seedSubscription('active', new Date('2026-03-02T00:00:00.000Z'));

    expect(await dueIds()).toEqual([]);
  });

  it.each<ChargeStatus>([
    'pending',
    'failed',
    'paid',
    'expired',
    'uncollectible',
  ])(
    'skips a subscription that already has a %s charge for the next period',
    async (status) => {
      const id = await seedSubscription();
      await chargeNextPeriod(id, status);

      expect(await dueIds()).toEqual([]);
    },
  );

  it('returns the oldest overdue subscriptions first within the limit', async () => {
    await seedSubscription('active', new Date('2026-02-20T00:00:00.000Z'));
    const oldest = await seedSubscription(
      'active',
      new Date('2026-02-10T00:00:00.000Z'),
    );

    expect(await dueIds(1)).toEqual([oldest]);
  });

  it('does not let renewals already generated starve the batch', async () => {
    const generated = await seedSubscription(
      'active',
      new Date('2026-02-10T00:00:00.000Z'),
    );
    await prisma.charge.create({
      data: {
        id: generateId(ID_PREFIXES.charge),
        subscriptionId: generated,
        amountCents: 1990,
        method: 'card',
        dueDate: anchor,
        periodStart: new Date('2026-02-10T00:00:00.000Z'),
        periodEnd,
      },
    });
    const waiting = await seedSubscription();

    expect(await dueIds(1)).toEqual([waiting]);
  });
});
