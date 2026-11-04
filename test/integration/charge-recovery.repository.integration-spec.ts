import type { ChargeStatus } from '../../src/modules/charges/charge-status.js';
import { overdueDunningCutoffs } from '../../src/modules/charges/domain/dunning-recovery.js';
import { PrismaChargesRepository } from '../../src/modules/charges/prisma-charges.repository.js';
import type { PaymentMethod } from '../../src/modules/subscriptions/subscription.js';
import type { SubscriptionStatus } from '../../src/modules/subscriptions/subscription-status.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaChargesRepository recovery queries (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaChargesRepository;
  let customerId: string;
  let planId: string;

  const now = new Date('2026-03-10T12:00:00.000Z');
  const minute = 60_000;
  const day = 24 * 60 * minute;
  const before = (ms: number) => new Date(now.getTime() - ms);

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaChargesRepository(prisma);
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
    status: SubscriptionStatus = 'past_due',
    method: PaymentMethod = 'card',
  ) {
    return prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId,
        planId,
        paymentMethod: method,
        status,
        cardToken: method === 'card' ? 'tok_success' : null,
        billingAnchor: before(30 * day),
        currentPeriodStart: before(30 * day),
        currentPeriodEnd: now,
      },
    });
  }

  async function seedCharge(
    subscriptionId: string,
    overrides: {
      status?: ChargeStatus;
      method?: PaymentMethod;
      attemptStartedAt?: Date | null;
      createdAt?: Date;
      retryCount?: number;
      firstFailedAt?: Date | null;
      periodStart?: Date;
    } = {},
  ) {
    const id = generateId(ID_PREFIXES.charge);
    await prisma.charge.create({
      data: {
        id,
        subscriptionId,
        amountCents: 1990,
        method: overrides.method ?? 'card',
        status: overrides.status ?? 'pending',
        attemptStartedAt: overrides.attemptStartedAt ?? null,
        createdAt: overrides.createdAt ?? before(10 * day),
        retryCount: overrides.retryCount ?? 0,
        firstFailedAt: overrides.firstFailedAt ?? null,
        dueDate: before(30 * day),
        periodStart: overrides.periodStart ?? before(30 * day),
        periodEnd: now,
      },
    });
    return id;
  }

  describe('findStalePendingCardCharges', () => {
    const cutoff = before(5 * minute);
    const ids = async (limit = 10) =>
      (await repository.findStalePendingCardCharges(cutoff, limit)).map(
        ({ id }) => id,
      );

    it('returns pending card charges whose attempt started before the cutoff', async () => {
      const { id: subscriptionId } = await seedSubscription();
      const stale = await seedCharge(subscriptionId, {
        attemptStartedAt: before(6 * minute),
      });
      await seedCharge(subscriptionId, {
        attemptStartedAt: before(4 * minute),
        periodStart: before(60 * day),
      });

      expect(await ids()).toEqual([stale]);
    });

    it('falls back to the creation time when the attempt never started', async () => {
      const { id: subscriptionId } = await seedSubscription();
      const stranded = await seedCharge(subscriptionId, {
        attemptStartedAt: null,
        createdAt: before(6 * minute),
      });

      expect(await ids()).toEqual([stranded]);
    });

    it('skips settled charges and pix or boleto charges awaiting payment', async () => {
      const { id: subscriptionId } = await seedSubscription();
      const old = before(10 * minute);
      await seedCharge(subscriptionId, {
        status: 'paid',
        attemptStartedAt: old,
        periodStart: before(60 * day),
      });
      await seedCharge(subscriptionId, {
        status: 'failed',
        attemptStartedAt: old,
        periodStart: before(70 * day),
      });
      const pix = await seedSubscription('incomplete', 'pix');
      await seedCharge(pix.id, { method: 'pix', attemptStartedAt: old });

      expect(await ids()).toEqual([]);
    });

    it('includes pending charges of canceled subscriptions', async () => {
      const { id: subscriptionId } = await seedSubscription('canceled');
      const charge = await seedCharge(subscriptionId, {
        attemptStartedAt: before(10 * minute),
      });

      expect(await ids()).toEqual([charge]);
    });

    it('returns the oldest attempts first within the limit', async () => {
      const { id: subscriptionId } = await seedSubscription();
      await seedCharge(subscriptionId, {
        attemptStartedAt: before(10 * minute),
        periodStart: before(60 * day),
      });
      const oldest = await seedCharge(subscriptionId, {
        attemptStartedAt: before(20 * minute),
      });

      expect(await ids(1)).toEqual([oldest]);
    });
  });

  describe('findOverdueDunningFollowUps', () => {
    const grace = 5 * minute;
    const overdueIds = async (limit = 10) =>
      (
        await repository.findOverdueDunningFollowUps(
          overdueDunningCutoffs(now, 'days', grace),
          limit,
        )
      ).map(({ charge }) => charge.id);

    it('returns a failed charge whose retry slot passed beyond the grace', async () => {
      const { id: subscriptionId } = await seedSubscription();
      const lost = await seedCharge(subscriptionId, {
        status: 'failed',
        firstFailedAt: before(day + grace + 1),
      });
      await seedCharge(subscriptionId, {
        status: 'failed',
        firstFailedAt: before(day),
        periodStart: before(60 * day),
      });

      const found = await repository.findOverdueDunningFollowUps(
        overdueDunningCutoffs(now, 'days', grace),
        10,
      );

      expect(found.map(({ charge }) => charge.id)).toEqual([lost]);
      expect(found[0]?.subscription.id).toBe(subscriptionId);
    });

    it('applies the slot of the retries already made', async () => {
      const { id: subscriptionId } = await seedSubscription();
      await seedCharge(subscriptionId, {
        status: 'failed',
        retryCount: 1,
        firstFailedAt: before(2 * day),
      });
      const lost = await seedCharge(subscriptionId, {
        status: 'failed',
        retryCount: 1,
        firstFailedAt: before(3 * day + grace + 1),
        periodStart: before(60 * day),
      });

      expect(await overdueIds()).toEqual([lost]);
    });

    it('returns a charge that used all its retries so its exhaustion can be recovered', async () => {
      const { id: subscriptionId } = await seedSubscription();
      const exhausted = await seedCharge(subscriptionId, {
        status: 'failed',
        retryCount: 3,
        firstFailedAt: before(grace + 1),
      });

      expect(await overdueIds()).toEqual([exhausted]);
    });

    it('skips canceled subscriptions and charges that left dunning', async () => {
      const canceled = await seedSubscription('canceled');
      await seedCharge(canceled.id, {
        status: 'failed',
        firstFailedAt: before(10 * day),
      });
      const { id: subscriptionId } = await seedSubscription();
      await seedCharge(subscriptionId, {
        status: 'pending',
        firstFailedAt: before(10 * day),
      });
      await seedCharge(subscriptionId, {
        status: 'uncollectible',
        retryCount: 3,
        firstFailedAt: before(10 * day),
        periodStart: before(60 * day),
      });

      expect(await overdueIds()).toEqual([]);
    });

    it('returns an expired charge only while its period has no live charge', async () => {
      const { id: subscriptionId } = await seedSubscription();
      const orphan = await seedCharge(subscriptionId, {
        status: 'expired',
        firstFailedAt: before(2 * day),
      });
      const superseded = await seedCharge(subscriptionId, {
        status: 'expired',
        firstFailedAt: before(2 * day),
        periodStart: before(60 * day),
      });
      await seedCharge(subscriptionId, {
        status: 'pending',
        retryCount: 1,
        periodStart: before(60 * day),
      });

      const ids = await overdueIds();

      expect(ids).toContain(orphan);
      expect(ids).not.toContain(superseded);
    });

    it('bounds the batch and returns the oldest failures first', async () => {
      const { id: subscriptionId } = await seedSubscription();
      await seedCharge(subscriptionId, {
        status: 'failed',
        firstFailedAt: before(3 * day),
      });
      const oldest = await seedCharge(subscriptionId, {
        status: 'failed',
        firstFailedAt: before(5 * day),
        periodStart: before(60 * day),
      });

      expect(await overdueIds(1)).toEqual([oldest]);
    });
  });
});
