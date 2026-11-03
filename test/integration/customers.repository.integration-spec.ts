import { ConflictError } from '../../src/shared/errors/index.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { PrismaCustomersRepository } from '../../src/modules/customers/prisma-customers.repository.js';
import type { SubscriptionStatus } from '../../src/modules/subscriptions/subscription-status.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaCustomersRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaCustomersRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaCustomersRepository(prisma);
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

  const newCustomer = (
    name: string,
    email = `${name.toLowerCase()}@example.com`,
  ) => ({
    id: generateId(ID_PREFIXES.customer),
    name,
    email,
  });

  const names = (items: { name: string }[]) => items.map(({ name }) => name);

  async function insertSubscription(
    customerId: string,
    planId: string,
    status: SubscriptionStatus,
  ) {
    return prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId,
        planId,
        paymentMethod: 'pix',
        status,
        billingAnchor: new Date('2026-11-03T00:00:00.000Z'),
        currentPeriodStart: new Date('2026-11-03T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-12-03T00:00:00.000Z'),
      },
    });
  }

  async function insertPlan() {
    return prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Basic',
        amountCents: 1990,
        interval: 'monthly',
      },
    });
  }

  describe('create', () => {
    it('persists the customer and exposes only domain fields', async () => {
      const input = newCustomer('Ana');

      const created = await repository.create(input);

      expect(created).toEqual({
        ...input,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('rejects a duplicate email with ConflictError', async () => {
      await repository.create(newCustomer('Ana', 'same@example.com'));

      await expect(
        repository.create(newCustomer('Other', 'same@example.com')),
      ).rejects.toThrow(ConflictError);
    });

    it('keeps only the first customer when the email is duplicated', async () => {
      await repository.create(newCustomer('Ana', 'same@example.com'));

      await repository
        .create(newCustomer('Other', 'same@example.com'))
        .catch(() => undefined);

      expect(await prisma.customer.count()).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns the customer without gateway fields', async () => {
      const created = await repository.create(newCustomer('Ana'));

      expect(await repository.findById(created.id)).toEqual(created);
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById('cus_missing')).toBeNull();
    });
  });

  describe('findDetailById', () => {
    it('returns the customer with subscription summaries ordered by id', async () => {
      const customer = await repository.create(newCustomer('Ana'));
      const plan = await insertPlan();
      const first = await insertSubscription(customer.id, plan.id, 'active');
      const second = await insertSubscription(customer.id, plan.id, 'canceled');

      const detail = await repository.findDetailById(customer.id);

      expect(detail).toEqual({
        ...customer,
        subscriptions: [
          {
            id: first.id,
            planId: plan.id,
            status: 'active',
            currentPeriodEnd: new Date('2026-12-03T00:00:00.000Z'),
          },
          {
            id: second.id,
            planId: plan.id,
            status: 'canceled',
            currentPeriodEnd: new Date('2026-12-03T00:00:00.000Z'),
          },
        ],
      });
    });

    it('returns an empty subscriptions list for a customer without any', async () => {
      const customer = await repository.create(newCustomer('Ana'));

      expect(await repository.findDetailById(customer.id)).toEqual({
        ...customer,
        subscriptions: [],
      });
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findDetailById('cus_missing')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns the requested window ordered by id with the full total', async () => {
      for (const name of ['A', 'B', 'C']) {
        await repository.create(newCustomer(name));
      }

      const page = await repository.list({}, { skip: 1, take: 1 });

      expect(names(page.items)).toEqual(['B']);
      expect(page.total).toBe(3);
    });

    it('returns an empty window beyond the last page keeping the total', async () => {
      await repository.create(newCustomer('A'));

      expect(await repository.list({}, { skip: 5, take: 5 })).toEqual({
        items: [],
        total: 1,
      });
    });

    it('searches name or email case-insensitively', async () => {
      await repository.create(newCustomer('Ana Souza', 'ana@example.com'));
      await repository.create(newCustomer('Bruno', 'bruno@souza-corp.io'));
      await repository.create(newCustomer('Carla', 'carla@example.com'));

      const page = await repository.list(
        { search: 'SOUZA' },
        { skip: 0, take: 10 },
      );

      expect(names(page.items)).toEqual(['Ana Souza', 'Bruno']);
      expect(page.total).toBe(2);
    });

    it.each([
      { search: '%', expected: ['100% Real'] },
      { search: '_', expected: ['snake_case'] },
      { search: '\\', expected: ['back\\slash'] },
    ])('treats $search in search literally', async ({ search, expected }) => {
      await repository.create(newCustomer('100% Real', 'percent@example.com'));
      await repository.create(
        newCustomer('snake_case', 'underscore@example.com'),
      );
      await repository.create(
        newCustomer('back\\slash', 'backslash@example.com'),
      );
      await repository.create(newCustomer('Plain', 'plain@example.com'));

      const page = await repository.list({ search }, { skip: 0, take: 10 });

      expect(names(page.items)).toEqual(expected);
      expect(page.total).toBe(expected.length);
    });

    it('filters by subscription status without duplicating customers', async () => {
      const plan = await insertPlan();
      const withActive = await repository.create(newCustomer('WithActive'));
      const withCanceled = await repository.create(newCustomer('WithCanceled'));
      await repository.create(newCustomer('Without'));
      await insertSubscription(withActive.id, plan.id, 'active');
      await insertSubscription(withActive.id, plan.id, 'active');
      await insertSubscription(withCanceled.id, plan.id, 'canceled');

      const page = await repository.list(
        { subscriptionStatus: 'active' },
        { skip: 0, take: 10 },
      );

      expect(names(page.items)).toEqual(['WithActive']);
      expect(page.total).toBe(1);
    });

    it('combines search and subscription status', async () => {
      const plan = await insertPlan();
      const ana = await repository.create(newCustomer('Ana'));
      const bruno = await repository.create(newCustomer('Bruno'));
      await insertSubscription(ana.id, plan.id, 'active');
      await insertSubscription(bruno.id, plan.id, 'active');

      const page = await repository.list(
        { search: 'bru', subscriptionStatus: 'active' },
        { skip: 0, take: 10 },
      );

      expect(names(page.items)).toEqual(['Bruno']);
    });
  });
});
