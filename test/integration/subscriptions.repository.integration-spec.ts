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

  const newSubscription = (): NewSubscription => ({
    id: generateId(ID_PREFIXES.subscription),
    customerId,
    planId,
    paymentMethod: 'boleto',
    status: 'incomplete',
    cardToken: null,
    billingAnchor: new Date('2026-01-31T00:00:00.000Z'),
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
        cancelReason: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });
  });

  describe('billingAnchor', () => {
    it('keeps the anchor apart from the current period start', async () => {
      const anchor = new Date('2026-01-31T10:30:15.123Z');
      const input: NewSubscription = {
        ...newSubscription(),
        billingAnchor: anchor,
        currentPeriodStart: new Date('2026-03-31T10:30:15.123Z'),
        currentPeriodEnd: new Date('2026-04-30T10:30:15.123Z'),
      };

      const created = await repository.create(input);

      expect(created.billingAnchor).toEqual(anchor);
      expect((await repository.findById(created.id))?.billingAnchor).toEqual(
        anchor,
      );
    });

    it('rejects a subscription without a billing anchor at the database', async () => {
      const { billingAnchor: _omitted, ...withoutAnchor } = newSubscription();

      await expect(
        prisma.$executeRaw`INSERT INTO subscriptions (id, customer_id, plan_id, payment_method, current_period_start, current_period_end, updated_at)
          VALUES (${withoutAnchor.id}, ${customerId}, ${planId}, 'pix', now(), now(), now())`,
      ).rejects.toThrow();
    });
  });

  describe('schema', () => {
    it('stores every timestamp column with time zone', async () => {
      const columns = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT DISTINCT data_type FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('plans', 'customers', 'subscriptions')
          AND data_type LIKE 'timestamp%'`;

      expect(columns).toEqual([{ data_type: 'timestamp with time zone' }]);
    });

    it('indexes the plan and the status with period end lookups', async () => {
      const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'subscriptions'`;

      expect(indexes.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          'subscriptions_plan_id_idx',
          'subscriptions_status_current_period_end_idx',
        ]),
      );
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
        fromAnyOf: ['incomplete'],
        to: 'active',
      });

      expect(changed).toMatchObject({ id: created.id, status: 'active' });
      expect(changed?.canceledAt).toBeNull();
    });

    it('moves the status when it matches any of the allowed from-statuses', async () => {
      const created = await repository.create({
        ...newSubscription(),
        status: 'past_due',
      });

      const changed = await repository.changeStatus(created.id, {
        fromAnyOf: ['incomplete', 'active', 'past_due'],
        to: 'canceled',
        canceledAt: new Date('2026-02-10T12:00:00.000Z'),
        cancelReason: 'customer_request',
      });

      expect(changed).toMatchObject({ status: 'canceled' });
    });

    it('stamps canceledAt when provided', async () => {
      const created = await repository.create(newSubscription());
      const canceledAt = new Date('2026-02-10T12:00:00.000Z');

      const changed = await repository.changeStatus(created.id, {
        fromAnyOf: ['incomplete'],
        to: 'canceled',
        canceledAt,
        cancelReason: 'customer_request',
      });

      expect(changed).toMatchObject({
        status: 'canceled',
        canceledAt,
        cancelReason: 'customer_request',
      });
    });

    it('returns null and leaves the row untouched when the from-status does not match', async () => {
      const created = await repository.create(newSubscription());

      const changed = await repository.changeStatus(created.id, {
        fromAnyOf: ['active'],
        to: 'canceled',
        canceledAt: new Date(),
        cancelReason: 'customer_request',
      });

      expect(changed).toBeNull();
      expect(await repository.findById(created.id)).toEqual(created);
    });

    it('returns null for an unknown id', async () => {
      expect(
        await repository.changeStatus('sub_missing', {
          fromAnyOf: ['incomplete'],
          to: 'active',
        }),
      ).toBeNull();
    });

    it('lets only one of two concurrent changes win', async () => {
      const created = await repository.create(newSubscription());
      const change = {
        fromAnyOf: ['incomplete'],
        to: 'canceled',
        canceledAt: new Date(),
        cancelReason: 'customer_request',
      } as const;

      const results = await Promise.all([
        repository.changeStatus(created.id, change),
        repository.changeStatus(created.id, change),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });
  });
});
