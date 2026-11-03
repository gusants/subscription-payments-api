import { PrismaChargesRepository } from '../../src/modules/charges/prisma-charges.repository.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaChargesRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaChargesRepository;
  let planId: string;

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

  const day = (offset: number) =>
    new Date(Date.UTC(2026, 0, 1 + offset, 10, 0, 0));

  async function createCustomer(email: string) {
    return prisma.customer.create({
      data: { id: generateId(ID_PREFIXES.customer), name: 'Ana', email },
    });
  }

  async function createSubscription(customerId: string) {
    return prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId,
        planId,
        paymentMethod: 'card',
        status: 'past_due',
        cardToken: 'tok_fail_then_success',
        billingAnchor: day(0),
        currentPeriodStart: day(0),
        currentPeriodEnd: day(30),
      },
    });
  }

  async function createCharge(
    subscriptionId: string,
    createdAt: Date,
    periodOffset = 0,
  ) {
    return prisma.charge.create({
      data: {
        id: generateId(ID_PREFIXES.charge),
        subscriptionId,
        amountCents: 1990,
        method: 'card',
        status: 'failed',
        dueDate: day(periodOffset),
        periodStart: day(periodOffset),
        periodEnd: day(periodOffset + 30),
        createdAt,
      },
    });
  }

  async function createAttempt(chargeId: string, createdAt: Date) {
    return prisma.paymentAttempt.create({
      data: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId,
        gatewayChargeId: generateId(ID_PREFIXES.gatewayCharge),
        result: 'declined',
        failureReason: 'insufficient_funds',
        createdAt,
      },
    });
  }

  describe('findWithSubscription', () => {
    it('returns the charge with its subscription', async () => {
      const customer = await createCustomer('ana@example.com');
      const subscription = await createSubscription(customer.id);
      const charge = await createCharge(subscription.id, day(1));

      const found = await repository.findWithSubscription(charge.id);

      expect(found?.charge).toEqual(charge);
      expect(found?.subscription).toEqual(subscription);
    });

    it('returns null for an unknown charge', async () => {
      expect(await repository.findWithSubscription('ch_missing')).toBeNull();
    });
  });

  describe('findWithAttempts', () => {
    it('returns the attempts oldest first', async () => {
      const customer = await createCustomer('ana@example.com');
      const subscription = await createSubscription(customer.id);
      const charge = await createCharge(subscription.id, day(1));
      const later = await createAttempt(charge.id, day(3));
      const earlier = await createAttempt(charge.id, day(2));

      const found = await repository.findWithAttempts(charge.id);

      expect(found?.attempts.map(({ id }) => id)).toEqual([
        earlier.id,
        later.id,
      ]);
      expect(found?.attempts[0]).toMatchObject({
        chargeId: charge.id,
        result: 'declined',
        failureReason: 'insufficient_funds',
      });
    });

    it('returns null for an unknown charge', async () => {
      expect(await repository.findWithAttempts('ch_missing')).toBeNull();
    });
  });

  describe('listByCustomer', () => {
    it('lists the charges of every subscription of the customer, newest first, excluding other customers', async () => {
      const ana = await createCustomer('ana@example.com');
      const bia = await createCustomer('bia@example.com');
      const first = await createSubscription(ana.id);
      const second = await createSubscription(ana.id);
      const oldest = await createCharge(first.id, day(1));
      const newest = await createCharge(second.id, day(3));
      const middle = await createCharge(first.id, day(2), 31);
      await createCharge((await createSubscription(bia.id)).id, day(4));

      const page = await repository.listByCustomer(ana.id, {
        skip: 0,
        take: 10,
      });

      expect(page.items.map(({ id }) => id)).toEqual([
        newest.id,
        middle.id,
        oldest.id,
      ]);
      expect(page.total).toBe(3);
    });

    it('breaks createdAt ties by id descending', async () => {
      const ana = await createCustomer('ana@example.com');
      const subscription = await createSubscription(ana.id);
      const sameInstant = day(1);
      const a = await createCharge(subscription.id, sameInstant);
      const b = await createCharge(subscription.id, sameInstant, 31);

      const page = await repository.listByCustomer(ana.id, {
        skip: 0,
        take: 10,
      });

      expect(page.items.map(({ id }) => id)).toEqual([b.id, a.id]);
    });

    it('applies the page window while reporting the full total', async () => {
      const ana = await createCustomer('ana@example.com');
      const subscription = await createSubscription(ana.id);
      await createCharge(subscription.id, day(1));
      const middle = await createCharge(subscription.id, day(2), 31);
      await createCharge(subscription.id, day(3), 62);

      const page = await repository.listByCustomer(ana.id, {
        skip: 1,
        take: 1,
      });

      expect(page.items.map(({ id }) => id)).toEqual([middle.id]);
      expect(page.total).toBe(3);
    });

    it('nests the attempts of each charge oldest first', async () => {
      const ana = await createCustomer('ana@example.com');
      const subscription = await createSubscription(ana.id);
      const charge = await createCharge(subscription.id, day(1));
      const later = await createAttempt(charge.id, day(3));
      const earlier = await createAttempt(charge.id, day(2));

      const page = await repository.listByCustomer(ana.id, {
        skip: 0,
        take: 10,
      });

      expect(page.items[0]?.attempts.map(({ id }) => id)).toEqual([
        earlier.id,
        later.id,
      ]);
    });

    it('returns an empty page for a customer without charges', async () => {
      const ana = await createCustomer('ana@example.com');

      expect(
        await repository.listByCustomer(ana.id, { skip: 0, take: 10 }),
      ).toEqual({ items: [], total: 0 });
    });
  });
});
