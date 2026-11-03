import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { PrismaSubscriptionsRepository } from '../../src/modules/subscriptions/prisma-subscriptions.repository.js';
import type { NewSubscription } from '../../src/modules/subscriptions/subscription.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaSubscriptionsRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaSubscriptionsRepository;
  let customerId: string;
  let planId: string;

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaSubscriptionsRepository(prisma);
  });

  beforeEach(async () => {
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

  const newSubscription = (): NewSubscription => ({
    id: generateId(ID_PREFIXES.subscription),
    customerId,
    planId,
    paymentMethod: 'boleto',
    status: 'incomplete',
    currentPeriodStart: new Date('2026-01-31T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-28T00:00:00.000Z'),
  });

  describe('create', () => {
    it('persists the subscription mapping every column to the domain type', async () => {
      const input = newSubscription();

      const created = await repository.create(input);

      expect(created).toEqual({
        ...input,
        canceledAt: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });
  });

  describe('findById', () => {
    it('returns the stored subscription', async () => {
      const created = await repository.create(newSubscription());

      expect(await repository.findById(created.id)).toEqual(created);
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById('sub_missing')).toBeNull();
    });
  });

  describe('changeStatus', () => {
    it('moves the status when the expected from-status matches', async () => {
      const created = await repository.create(newSubscription());

      const changed = await repository.changeStatus(created.id, {
        from: 'incomplete',
        to: 'active',
      });

      expect(changed).toMatchObject({ id: created.id, status: 'active' });
      expect(changed?.canceledAt).toBeNull();
    });

    it('stamps canceledAt when provided', async () => {
      const created = await repository.create(newSubscription());
      const canceledAt = new Date('2026-02-10T12:00:00.000Z');

      const changed = await repository.changeStatus(created.id, {
        from: 'incomplete',
        to: 'canceled',
        canceledAt,
      });

      expect(changed).toMatchObject({ status: 'canceled', canceledAt });
    });

    it('returns null and leaves the row untouched when the from-status does not match', async () => {
      const created = await repository.create(newSubscription());

      const changed = await repository.changeStatus(created.id, {
        from: 'active',
        to: 'canceled',
        canceledAt: new Date(),
      });

      expect(changed).toBeNull();
      expect(await repository.findById(created.id)).toEqual(created);
    });

    it('returns null for an unknown id', async () => {
      expect(
        await repository.changeStatus('sub_missing', {
          from: 'incomplete',
          to: 'active',
        }),
      ).toBeNull();
    });

    it('lets only one of two concurrent changes win', async () => {
      const created = await repository.create(newSubscription());
      const change = {
        from: 'incomplete',
        to: 'canceled',
        canceledAt: new Date(),
      } as const;

      const results = await Promise.all([
        repository.changeStatus(created.id, change),
        repository.changeStatus(created.id, change),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });
  });
});
